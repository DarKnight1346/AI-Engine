import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { registerDashboardService } from './service-installer.js';

export async function createServer(): Promise<void> {
  console.log('\n🚀 AI Engine Server Setup\n');

  const serverDir = resolve(process.cwd());

  // Parse optional --port flag
  const portIdx = process.argv.indexOf('--port');
  const port = portIdx !== -1 && process.argv[portIdx + 1]
    ? parseInt(process.argv[portIdx + 1], 10)
    : 3000;

  // Check if the project has been built
  const nextDir = join(serverDir, 'apps', 'dashboard', '.next');
  if (!existsSync(nextDir)) {
    console.error('❌ The dashboard has not been built yet.');
    console.error('   Run the following commands first:\n');
    console.error('   pnpm install');
    console.error('   pnpm build\n');
    process.exit(1);
  }

  // Generate instance secret
  const instanceSecret = randomBytes(32).toString('hex');

  // Write a minimal .env — database and Redis are configured through the
  // web-based setup wizard at /setup, not here in the CLI.
  const envFilePath = join(serverDir, '.env');
  const envContent = `# AI Engine Server Configuration
# Generated on ${new Date().toISOString()}
#
# Database and Redis will be configured through the setup wizard.

DATABASE_URL=""
REDIS_URL=""
INSTANCE_SECRET="${instanceSecret}"
DASHBOARD_PORT=${port}
NODE_ENV="production"
`;

  await writeFile(envFilePath, envContent);
  console.log('✅ Generated .env with instance secret');

  // Register as a system service (auto-start on boot, restart on crash)
  await registerDashboardService({
    projectDir: serverDir,
    envFilePath,
    port,
  });

  console.log('\n✅ Dashboard service started. Waiting for Cloudflare Tunnel...\n');

  // Poll the dashboard's tunnel status endpoint until the URL is available.
  // The server needs a few seconds to boot and establish the tunnel.
  const tunnelUrl = await waitForTunnelUrl(port);

  if (tunnelUrl) {
    const setupUrl = `${tunnelUrl}/setup`;
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║   AI Engine is ready!                                        ║');
    console.log('║                                                              ║');
    console.log('║   Open this URL in your browser to complete setup:           ║');
    console.log('║                                                              ║');
    console.log(`║   ${setupUrl.padEnd(57)}║`);
    console.log('║                                                              ║');
    console.log('║   The wizard will walk you through:                          ║');
    console.log('║     1. Connecting to PostgreSQL                              ║');
    console.log('║     2. Connecting to Redis                                   ║');
    console.log('║     3. Creating your admin account                           ║');
    console.log('║     4. Adding Claude API keys                                ║');
    console.log('║     5. Setting your vault passphrase                         ║');
    console.log('║     6. Adding your first worker node                         ║');
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('   The dashboard is registered as a system service and will');
    console.log('   auto-start on boot and restart if it crashes.');
    console.log('');
    console.log('   To view logs:');
    console.log('     • Linux:  journalctl -u ai-engine-dashboard -f');
    console.log('     • macOS:  tail -f /usr/local/var/log/ai-engine/dashboard.log');
    console.log('');
  } else {
    // Tunnel didn't come up in time — give the user manual instructions
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║   AI Engine is starting, but the tunnel URL is not ready     ║');
    console.log('║   yet. It should appear in the service logs shortly.         ║');
    console.log('║                                                              ║');
    console.log('║   Check the logs for the tunnel URL:                         ║');
    console.log('║     • Linux:  journalctl -u ai-engine-dashboard -f           ║');
    console.log('║     • macOS:  tail -f /usr/local/var/log/ai-engine/*.log     ║');
    console.log('║                                                              ║');
    console.log('║   Look for a line like:                                      ║');
    console.log('║     [tunnel] ✅ Setup wizard: https://xxx.trycloudflare.com  ║');
    console.log('║                                                              ║');
    console.log('║   Or check the local port directly:                          ║');
    console.log(`║     http://localhost:${String(port).padEnd(43)}║`);
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('   The dashboard is registered as a system service and will');
    console.log('   auto-start on boot and restart if it crashes.');
    console.log('');
  }
}

/**
 * Poll the dashboard's tunnel status API until a URL is available.
 * Returns the URL or null if it times out.
 */
async function waitForTunnelUrl(port: number, timeoutMs = 60_000): Promise<string | null> {
  const start = Date.now();
  const pollInterval = 2_000;
  let dots = 0;

  while (Date.now() - start < timeoutMs) {
    dots++;
    const spinner = '.'.repeat(dots % 4 + 1).padEnd(4);
    process.stdout.write(`\r   Waiting for tunnel${spinner}`);

    try {
      const res = await fetch(`http://localhost:${port}/api/tunnel/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) {
        const data = await res.json() as { status: string; url: string | null };
        if (data.status === 'connected' && data.url) {
          process.stdout.write('\r   Tunnel connected!             \n');
          return data.url;
        }
      }
    } catch {
      // Server not up yet, keep polling
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  process.stdout.write('\r   Tunnel not ready yet (timed out).  \n');
  return null;
}
