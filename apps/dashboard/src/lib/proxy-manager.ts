/**
 * ProxyManager — manages multiple claude-max-api-proxy instances.
 *
 * Each Claude Max account gets:
 *   1. An isolated config directory (~/.ai-engine/proxy-accounts/<id>/)
 *      containing the Claude Code .credentials.json credentials.
 *   2. A proxy child process running on its own port.
 *
 * The dashboard's LLM pool round-robins requests across all healthy proxies,
 * spreading load across multiple Max subscriptions to avoid per-account caps.
 *
 * Lifecycle:
 *   - On dashboard boot, `startAll()` reads saved accounts from the DB
 *     config table and starts a proxy for each.
 *   - The setup wizard / settings UI calls `addAccount()` to register new
 *     accounts and `removeAccount()` to clean them up.
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { getDb } from '@ai-engine/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyAccount {
  id: string;
  label: string;
  port: number;
  /** Raw contents of ~/.claude/.credentials.json for this Claude Max account */
  authJson: string;
  /** The directory where .credentials.json is stored */
  configDir: string;
}

export interface ProxyStatus {
  id: string;
  label: string;
  port: number;
  status: 'running' | 'stopped' | 'error';
  pid: number | null;
  error: string | null;
  /** Associated API key ID in the database (null if not yet registered) */
  apiKeyId: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNTS_BASE_DIR = join(
  process.env.HOME ?? '/root',
  '.ai-engine',
  'proxy-accounts',
);

const CONFIG_KEY = 'claude-max-proxy-accounts';
const BASE_PORT = 3456;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const PROXY_KEY = Symbol.for('ai-engine.proxy-manager');

export class ProxyManager {
  private processes: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, ProxyStatus> = new Map();
  private accounts: Map<string, ProxyAccount> = new Map();

  static getInstance(): ProxyManager {
    const g = globalThis as Record<symbol, ProxyManager | undefined>;
    if (!g[PROXY_KEY]) {
      g[PROXY_KEY] = new ProxyManager();
    }
    return g[PROXY_KEY]!;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Load saved accounts from the DB and start all proxies. */
  async startAll(): Promise<void> {
    await this.loadAccounts();
    for (const account of this.accounts.values()) {
      await this.startProxy(account);
    }
    console.log(`[proxy-manager] Started ${this.accounts.size} proxy instance(s)`);
  }

  /** Stop all running proxies. */
  async stopAll(): Promise<void> {
    for (const [id, proc] of this.processes) {
      proc.kill('SIGTERM');
      this.processes.delete(id);
      const s = this.statuses.get(id);
      if (s) { s.status = 'stopped'; s.pid = null; }
    }
  }

  /**
   * Add a new Claude Max account.
   *
   * @param label   Human-readable label (e.g. "Account 1")
   * @param authJson  Raw contents of ~/.claude/.credentials.json
   * @returns The created account info + status
   */
  async addAccount(label: string, authJson: string): Promise<ProxyStatus> {
    const id = `cmax-${Date.now().toString(36)}`;
    const port = this.nextAvailablePort();
    const configDir = join(ACCOUNTS_BASE_DIR, id);

    // Write .credentials.json to isolated ~/.claude/ directory
    mkdirSync(join(configDir, '.claude'), { recursive: true });
    writeFileSync(
      join(configDir, '.claude', '.credentials.json'),
      authJson,
      'utf-8',
    );

    const account: ProxyAccount = { id, label, port, authJson, configDir };
    this.accounts.set(id, account);

    // Persist to DB
    await this.saveAccounts();

    // Start the proxy
    await this.startProxy(account);

    // Register as an API key in the database
    await this.registerApiKey(account);

    return this.statuses.get(id)!;
  }

  /** Remove an account, stop its proxy, and clean up. */
  async removeAccount(id: string): Promise<void> {
    // Stop the proxy process
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(id);
    }

    // Remove the API key from the database
    const status = this.statuses.get(id);
    if (status?.apiKeyId) {
      try {
        const db = getDb();
        await db.apiKey.delete({ where: { id: status.apiKeyId } });
      } catch { /* may not exist */ }
    }

    // Clean up files
    const account = this.accounts.get(id);
    if (account?.configDir && existsSync(account.configDir)) {
      rmSync(account.configDir, { recursive: true, force: true });
    }

    this.accounts.delete(id);
    this.statuses.delete(id);

    // Persist
    await this.saveAccounts();
  }

  /** Get status of all proxy instances. */
  getAllStatuses(): ProxyStatus[] {
    return Array.from(this.statuses.values());
  }

  /** Get a single proxy status. */
  getStatus(id: string): ProxyStatus | undefined {
    return this.statuses.get(id);
  }

  /** Restart a specific proxy. */
  async restartProxy(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(id);
    }

    const account = this.accounts.get(id);
    if (account) {
      await new Promise((r) => setTimeout(r, 1000));
      await this.startProxy(account);
    }
  }

  /** Return the base URLs of all healthy (running) proxies. */
  getHealthyEndpoints(): Array<{ id: string; baseUrl: string; apiKeyId: string | null }> {
    return Array.from(this.statuses.values())
      .filter((s) => s.status === 'running')
      .map((s) => ({
        id: s.id,
        baseUrl: `http://localhost:${s.port}/v1`,
        apiKeyId: s.apiKeyId,
      }));
  }

  // -----------------------------------------------------------------------
  // Internal — process management
  // -----------------------------------------------------------------------

  private async startProxy(account: ProxyAccount): Promise<void> {
    const { id, port, configDir } = account;

    // Initialize status
    this.statuses.set(id, {
      id,
      label: account.label,
      port,
      status: 'stopped',
      pid: null,
      error: null,
      apiKeyId: null,
    });

    // Resolve the proxy binary.
    // claude-max-api-proxy installs a `claude-max-api` binary.
    // It does NOT accept a --port flag; it reads the PORT env var instead.
    let binPath: string;
    let args: string[];
    try {
      const { execSync } = await import('child_process');
      binPath = execSync('which claude-max-api 2>/dev/null || which claude-max-api-proxy 2>/dev/null', {
        encoding: 'utf-8',
      }).trim();
      args = [];
    } catch {
      // Fall back to npx
      binPath = 'npx';
      args = ['claude-max-api-proxy'];
    }

    // The proxy spawns the Claude CLI as a subprocess.
    // By setting HOME to our isolated config dir, the CLI will read
    // .credentials.json from <configDir>/.claude/.credentials.json.
    // PORT env var controls which port the proxy listens on.
    const env = {
      ...process.env,
      HOME: configDir,
      PORT: String(port),
    };

    console.log(`[proxy-manager] Starting proxy "${account.label}" on port ${port} (HOME=${configDir})`);

    try {
      const proc: ChildProcess = spawn(binPath, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.processes.set(id, proc);

      const status = this.statuses.get(id)!;
      status.pid = proc.pid ?? null;
      status.status = 'running';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.log(`[proxy:${account.label}] ${text}`);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) console.log(`[proxy:${account.label}:err] ${text}`);
      });

      proc.on('exit', (code: number | null) => {
        console.log(`[proxy-manager] Proxy "${account.label}" exited (code ${code})`);
        status.status = 'stopped';
        status.pid = null;
        this.processes.delete(id);

        // Auto-restart after 5s if not deliberately stopped
        setTimeout(() => {
          if (this.accounts.has(id) && !this.processes.has(id)) {
            console.log(`[proxy-manager] Auto-restarting "${account.label}"...`);
            this.startProxy(account).catch(console.error);
          }
        }, 5000);
      });

      proc.on('error', (err: Error) => {
        console.error(`[proxy-manager] Proxy "${account.label}" error: ${err.message}`);
        status.status = 'error';
        status.error = err.message;
      });

      // Wait a moment then health-check
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          status.status = 'running';
          console.log(`[proxy-manager] Proxy "${account.label}" healthy on port ${port}`);
        }
      } catch {
        // May not be ready yet — the status will update when it processes requests
      }
    } catch (err: any) {
      const status = this.statuses.get(id)!;
      status.status = 'error';
      status.error = err.message;
      console.error(`[proxy-manager] Failed to start proxy "${account.label}": ${err.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Internal — persistence (DB config table)
  // -----------------------------------------------------------------------

  private async loadAccounts(): Promise<void> {
    try {
      const db = getDb();
      const row = await db.config.findUnique({ where: { key: CONFIG_KEY } });
      if (!row) return;

      const saved = row.valueJson as Array<{
        id: string; label: string; port: number; authJson: string; configDir: string;
      }>;

      for (const s of saved) {
        // Ensure the config directory and .credentials.json still exist
        const authPath = join(s.configDir, '.claude', '.credentials.json');
        if (!existsSync(authPath) && s.authJson) {
          mkdirSync(join(s.configDir, '.claude'), { recursive: true });
          writeFileSync(authPath, s.authJson, 'utf-8');
        }
        this.accounts.set(s.id, s);
      }

      // Also restore API key associations
      const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
      for (const key of apiKeys) {
        const stats = key.usageStats as any;
        if (stats?.proxyAccountId && this.accounts.has(stats.proxyAccountId)) {
          // Will be populated when statuses are created during startProxy
        }
      }
    } catch (err: any) {
      console.warn(`[proxy-manager] Could not load accounts: ${err.message}`);
    }
  }

  private async saveAccounts(): Promise<void> {
    try {
      const db = getDb();
      const data = Array.from(this.accounts.values()).map((a) => ({
        id: a.id,
        label: a.label,
        port: a.port,
        authJson: a.authJson,
        configDir: a.configDir,
      }));

      await db.config.upsert({
        where: { key: CONFIG_KEY },
        update: { valueJson: data as any, version: { increment: 1 } },
        create: { key: CONFIG_KEY, valueJson: data as any },
      });
    } catch (err: any) {
      console.warn(`[proxy-manager] Could not save accounts: ${err.message}`);
    }
  }

  private async registerApiKey(account: ProxyAccount): Promise<void> {
    try {
      const db = getDb();
      const apiKey = await db.apiKey.create({
        data: {
          keyEncrypted: 'not-needed',
          label: `Claude Max: ${account.label}`,
          isActive: true,
          tierMapping: {
            fast: 'claude-haiku-4',
            standard: 'claude-sonnet-4',
            heavy: 'claude-opus-4',
          },
          usageStats: {
            tokensUsed: 0,
            requestCount: 0,
            keyType: 'api-key',
            provider: 'openai-compatible',
            baseUrl: `http://localhost:${account.port}/v1`,
            proxyAccountId: account.id,
          },
        },
      });

      const status = this.statuses.get(account.id);
      if (status) status.apiKeyId = apiKey.id;

      console.log(`[proxy-manager] Registered API key ${apiKey.id} for "${account.label}"`);
    } catch (err: any) {
      console.warn(`[proxy-manager] Could not register API key for "${account.label}": ${err.message}`);
    }
  }

  private nextAvailablePort(): number {
    const usedPorts = new Set(
      Array.from(this.accounts.values()).map((a) => a.port),
    );
    let port = BASE_PORT;
    while (usedPorts.has(port)) port++;
    return port;
  }
}
