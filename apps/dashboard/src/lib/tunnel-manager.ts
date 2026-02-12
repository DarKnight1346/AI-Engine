/**
 * TunnelManager — singleton managing the Cloudflare Tunnel lifecycle.
 *
 * Two modes:
 *   1. **Quick Tunnel** (default, no account) — launches
 *      `cloudflared tunnel --url http://localhost:<port>`.
 *      Gives a random *.trycloudflare.com URL that changes on restart.
 *
 *   2. **Named Tunnel** (user provides Cloudflare credentials) — uses the
 *      Cloudflare API to create a persistent tunnel + CNAME DNS record, then
 *      runs `cloudflared tunnel run --token <token>`.
 *      URL is static and survives restarts.
 *
 * State is kept in-memory and, once the DB is available, persisted to the
 * `config` table so named tunnels survive dashboard restarts.
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ensureCloudflared } from './cloudflared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TunnelState {
  status: 'starting' | 'connected' | 'disconnected' | 'error';
  url: string | null;
  mode: 'quick' | 'named';
  hostname: string | null;
  tunnelId: string | null;
  error: string | null;
  pid: number | null;
}

export interface NamedTunnelOptions {
  apiToken: string;
  accountId: string;
  zoneId: string;
  hostname: string;
}

// ---------------------------------------------------------------------------
// Singleton — stored on globalThis so the same instance is shared across
// all webpack chunks in the Next.js process (API routes, instrumentation, etc.)
// ---------------------------------------------------------------------------

const TUNNEL_KEY = Symbol.for('ai-engine.tunnel-manager');

class TunnelManager {
  private proc: ChildProcess | null = null;
  private state: TunnelState = {
    status: 'disconnected',
    url: null,
    mode: 'quick',
    hostname: null,
    tunnelId: null,
    error: null,
    pid: null,
  };
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false; // true when deliberately stopped

  static getInstance(): TunnelManager {
    const g = globalThis as Record<symbol, TunnelManager | undefined>;
    if (!g[TUNNEL_KEY]) {
      g[TUNNEL_KEY] = new TunnelManager();
    }
    return g[TUNNEL_KEY]!;
  }

  getState(): TunnelState {
    return { ...this.state };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.state.status === 'connected' || this.state.status === 'starting') return;
    this.stopped = false;
    this.state.status = 'starting';
    this.state.error = null;

    try {
      const cloudflaredPath = await ensureCloudflared();
      const port = process.env.DASHBOARD_PORT ?? process.env.PORT ?? '3000';

      // Check DB for a persisted named tunnel config
      let tunnelConfigPath: string | null = null;
      let tunnelHostname: string | null = null;
      let tunnelId: string | null = null;
      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();
        const configRow = await db.config.findUnique({ where: { key: 'tunnel.config_path' } });
        const hostRow = await db.config.findUnique({ where: { key: 'tunnel.hostname' } });
        const idRow = await db.config.findUnique({ where: { key: 'tunnel.tunnel_id' } });
        if (configRow) tunnelConfigPath = configRow.valueJson as string;
        if (hostRow) tunnelHostname = hostRow.valueJson as string;
        if (idRow) tunnelId = idRow.valueJson as string;
      } catch {
        // DB not ready yet (first-run / setup wizard)
      }

      if (tunnelConfigPath) {
        this.state.mode = 'named';
        this.state.hostname = tunnelHostname;
        this.state.tunnelId = tunnelId;
        this.state.url = tunnelHostname ? `https://${tunnelHostname}` : null;
        this.spawnProcess(cloudflaredPath, [
          'tunnel', '--config', tunnelConfigPath, 'run',
        ]);
      } else {
        this.state.mode = 'quick';
        this.spawnProcess(cloudflaredPath, [
          'tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate',
        ]);
      }
    } catch (err: any) {
      this.state.status = 'error';
      this.state.error = err.message;
      console.error('[tunnel] Start failed:', err.message);
      this.scheduleRestart();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearRestart();
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    this.state.status = 'disconnected';
    this.state.pid = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise((r) => setTimeout(r, 1500));
    await this.start();
  }

  // -----------------------------------------------------------------------
  // Configure named tunnel (switch from quick to persistent)
  // -----------------------------------------------------------------------

  async configureNamedTunnel(opts: NamedTunnelOptions): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const port = process.env.DASHBOARD_PORT ?? process.env.PORT ?? '3000';
      const crypto = await import('crypto');

      // Config directory for cloudflared credentials + config
      const cfDir = join(process.env.HOME ?? '/root', '.ai-engine', 'cloudflared');
      mkdirSync(cfDir, { recursive: true });

      // --- 1. Create the tunnel via Cloudflare API ---
      const tunnelSecret = crypto.randomBytes(32).toString('base64');
      const createRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/tunnels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'ai-engine-dashboard',
            tunnel_secret: tunnelSecret,
          }),
        },
      );
      const createData = await createRes.json() as any;
      if (!createData.success) {
        const msg = createData.errors?.[0]?.message ?? 'Failed to create tunnel';
        return { success: false, error: msg };
      }
      const tunnelId: string = createData.result.id;
      console.log(`[tunnel] Created tunnel ${tunnelId}`);

      // --- 2. Write credentials file + config.yml locally ---
      // This avoids the PUT /configurations API which doesn't support API tokens.
      const credentials = {
        AccountTag: opts.accountId,
        TunnelSecret: tunnelSecret,
        TunnelID: tunnelId,
      };
      const credPath = join(cfDir, `${tunnelId}.json`);
      writeFileSync(credPath, JSON.stringify(credentials, null, 2), 'utf-8');

      const configYaml = [
        `tunnel: ${tunnelId}`,
        `credentials-file: ${credPath}`,
        `ingress:`,
        `  - hostname: ${opts.hostname}`,
        `    service: http://localhost:${port}`,
        `  - service: http_status:404`,
      ].join('\n');
      const configPath = join(cfDir, 'config.yml');
      writeFileSync(configPath, configYaml, 'utf-8');
      console.log(`[tunnel] Wrote config to ${configPath}`);

      // --- 3. Create DNS CNAME record ---
      const dnsRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${opts.zoneId}/dns_records`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'CNAME',
            name: opts.hostname,
            content: `${tunnelId}.cfargotunnel.com`,
            proxied: true,
          }),
        },
      );
      const dnsData = await dnsRes.json() as any;
      if (!dnsData.success) {
        // Non-fatal — the record may already exist
        console.warn('[tunnel] DNS record creation note:', dnsData.errors?.[0]?.message);
      }

      // --- 4. Persist to DB ---
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      const entries = [
        { key: 'tunnel.mode', value: 'named' },
        { key: 'tunnel.config_path', value: configPath },
        { key: 'tunnel.cred_path', value: credPath },
        { key: 'tunnel.hostname', value: opts.hostname },
        { key: 'tunnel.tunnel_id', value: tunnelId },
        { key: 'tunnel.account_id', value: opts.accountId },
        { key: 'tunnel.zone_id', value: opts.zoneId },
      ];
      for (const { key, value } of entries) {
        await db.config.upsert({
          where: { key },
          update: { valueJson: value as any, version: { increment: 1 } },
          create: { key, valueJson: value as any },
        });
      }

      // --- 5. Switch to named tunnel ---
      await this.restart();

      return { success: true, url: `https://${opts.hostname}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Revert to a quick tunnel (remove named tunnel config).
   */
  async removeNamedTunnel(): Promise<void> {
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      const keys = [
        'tunnel.mode', 'tunnel.config_path', 'tunnel.cred_path',
        'tunnel.hostname', 'tunnel.tunnel_id', 'tunnel.account_id',
        'tunnel.zone_id',
      ];
      for (const key of keys) {
        await db.config.delete({ where: { key } }).catch(() => {});
      }
    } catch { /* DB may not be ready */ }

    this.state.hostname = null;
    this.state.tunnelId = null;
    await this.restart();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private spawnProcess(bin: string, args: string[]): void {
    // Mask the token in logs
    const safeArgs = args.map((a, i) => (args[i - 1] === '--token' ? '<redacted>' : a));
    console.log('[tunnel] Spawning:', bin, safeArgs.join(' '));

    this.proc = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.state.pid = this.proc.pid ?? null;

    const outputBuf: string[] = [];
    const handleData = (data: Buffer) => {
      const text = data.toString();
      outputBuf.push(text);

      // Quick tunnel: parse the trycloudflare.com URL
      if (this.state.mode === 'quick') {
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.state.url = match[0];
          this.state.status = 'connected';
          console.log('');
          console.log(`[tunnel] ✅ Tunnel connected: ${this.state.url}`);
          console.log(`[tunnel] ✅ Setup wizard:     ${this.state.url}/setup`);
          console.log('');
        }
      }

      // Named tunnel: detect registered connection
      if (text.includes('Registered tunnel connection') || text.includes('Connection registered')) {
        this.state.status = 'connected';
        console.log('');
        console.log(`[tunnel] ✅ Named tunnel connected: ${this.state.url}`);
        console.log('');
      }
    };

    this.proc.stdout?.on('data', handleData);
    this.proc.stderr?.on('data', handleData);

    this.proc.on('exit', (code) => {
      console.log(`[tunnel] cloudflared exited (code ${code})`);
      this.state.status = 'disconnected';
      this.state.pid = null;
      this.proc = null;
      if (!this.stopped) this.scheduleRestart();
    });

    this.proc.on('error', (err) => {
      console.error('[tunnel] Process error:', err.message);
      this.state.status = 'error';
      this.state.error = err.message;
    });

    // If we haven't connected after 20s (quick) check buffer once more
    if (this.state.mode === 'quick') {
      setTimeout(() => {
        if (this.state.status === 'starting') {
          const full = outputBuf.join('');
          const match = full.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match) {
            this.state.url = match[0];
            this.state.status = 'connected';
          }
        }
      }, 20_000);
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.stopped) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      console.log('[tunnel] Auto-restarting...');
      this.start().catch(console.error);
    }, 5_000);
  }

  private clearRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

export { TunnelManager };
