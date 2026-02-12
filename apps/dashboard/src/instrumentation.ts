/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the Node.js server starts.
 *
 * NOTE: The Cloudflare tunnel and WebSocket hub are now started by
 * the custom server.js entry point (which shares the same port for
 * both HTTP and WebSocket).  This hook is kept as a no-op for
 * compatibility — if the dashboard is run via `next dev`, the tunnel
 * will still start here as a fallback.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // When running under the custom server.js, the tunnel is already
    // started.  Check the global flag to avoid a double-start.
    if ((globalThis as any).__tunnelStarted) return;

    try {
      const { TunnelManager } = await import('./lib/tunnel-manager');
      const manager = TunnelManager.getInstance();
      manager.start().catch((err) => {
        console.error('[tunnel] Auto-start failed:', err.message);
      });
      (globalThis as any).__tunnelStarted = true;
    } catch {
      // server.js will handle this
    }
  }
}
