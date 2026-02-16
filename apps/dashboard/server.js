/**
 * Custom server entry point — serves HTTP (Next.js) and WebSocket on the same port.
 *
 * Workers connect via `wss://<tunnel-url>/ws/worker` and all data flows
 * through this hub. No direct DB/Redis access is required on worker nodes.
 *
 * Usage:
 *   NODE_ENV=production node server.js
 *   (or in dev: npx next dev — the hub only starts in production)
 */

const { createServer } = require('http');
const { parse } = require('url');
const path = require('path');
const next = require('next');
const { WebSocketServer } = require('ws');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.DASHBOARD_PORT || process.env.PORT || '3000', 10);
const hostname = '0.0.0.0';

// Tell Next.js where the app lives — the CWD may be the monorepo root
// (e.g. /opt/ai-engine) while the Next.js app is in apps/dashboard/.
const app = next({ dev, hostname, port, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || '/', true));
  });

  // ── WebSocket servers (noServer mode — we handle upgrade ourselves) ──
  const wss = new WebSocketServer({ noServer: true });       // workers
  const wssClient = new WebSocketServer({ noServer: true }); // browser clients

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url || '');

    if (pathname === '/ws/worker') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/client') {
      wssClient.handleUpgrade(request, socket, head, (ws) => {
        wssClient.emit('connection', ws, request);
      });
    } else if (dev) {
      // In dev mode, let Next.js HMR WebSocket through (don't destroy)
      return;
    } else {
      socket.destroy();
    }
  });

  // ── Initialise the hub after Next.js is ready ──
  let hubReady = false;

  async function initHub() {
    try {
      const hubMod = require('./src/lib/worker-hub');
      const { WorkerHub } = hubMod;
      const hub = WorkerHub.getInstance();

      wss.on('connection', (ws, req) => {
        hub.handleConnection(ws, req);
      });

      globalThis.__workerHub = hub;
      hubReady = true;
      console.log('[ws] Worker hub initialised');
    } catch (err) {
      console.warn('[ws] Hub not ready yet (expected during first build):', err.message);
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'auth:error', message: 'Server starting up — retry in a moment' }));
        ws.close();
      });
    }
  }

  initHub();

  // ── Initialise the client hub for browser WebSocket connections ──
  async function initClientHub() {
    try {
      const clientHubMod = require('./src/lib/client-hub');
      const { ClientHub } = clientHubMod;
      const hub = ClientHub.getInstance();
      hub.setPort(port);

      wssClient.on('connection', (ws, req) => {
        hub.handleConnection(ws, req);
      });

      globalThis.__clientHub = hub;
      console.log('[ws] Client hub initialised');
    } catch (err) {
      console.warn('[ws] Client hub not ready yet:', err.message);
      wssClient.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'error', message: 'Server starting up — retry in a moment' }));
        ws.close();
      });
    }
  }

  initClientHub();

  // ── Start the Cloudflare tunnel ──
  (async () => {
    try {
      const tunnelMod = require('./src/lib/tunnel-manager');
      (globalThis).__tunnelStarted = true;
      const manager = tunnelMod.TunnelManager.getInstance();
      await manager.start();

      // Poll for the tunnel URL and print a prominent banner once connected
      waitForTunnelAndPrintBanner(manager);
    } catch (err) {
      // require() can't load .ts files in plain Node — the instrumentation
      // hook (which runs through Next.js compilation) will start the tunnel.
      console.warn('[tunnel] Deferring to instrumentation hook:', err.message);
    }
  })();

  server.listen(port, hostname, () => {
    console.log('');
    console.log(`> Dashboard ready on http://${hostname}:${port}`);
    console.log(`> Worker WebSocket: ws://${hostname}:${port}/ws/worker`);
    console.log('');
    console.log('  Establishing Cloudflare Tunnel...');
    console.log('');
  });
});

/**
 * Poll the TunnelManager until a URL is available, then print a
 * big prominent banner to the console so the SSH user can see it.
 */
function waitForTunnelAndPrintBanner(manager) {
  let attempts = 0;
  const maxAttempts = 60; // 60 × 2s = 2 minutes max

  const timer = setInterval(() => {
    attempts++;
    const state = manager.getState();

    if (state.status === 'connected' && state.url) {
      clearInterval(timer);
      const setupUrl = `${state.url}/setup`;
      const dashUrl = state.url;

      console.log('');
      console.log('╔══════════════════════════════════════════════════════════════════╗');
      console.log('║                                                                  ║');
      console.log('║   🌐 Cloudflare Tunnel connected!                                ║');
      console.log('║                                                                  ║');
      console.log('║   Dashboard URL:                                                 ║');
      console.log(`║     ${dashUrl.padEnd(61)}║`);
      console.log('║                                                                  ║');
      console.log('║   Setup Wizard (first-time setup):                               ║');
      console.log(`║     ${setupUrl.padEnd(61)}║`);
      console.log('║                                                                  ║');
      console.log('║   Worker WebSocket:                                              ║');
      console.log(`║     ${(dashUrl.replace(/^https?/, 'wss') + '/ws/worker').padEnd(61)}║`);
      console.log('║                                                                  ║');
      console.log('║   Open the Setup Wizard URL in your browser to get started.      ║');
      console.log('║                                                                  ║');
      console.log('╚══════════════════════════════════════════════════════════════════╝');
      console.log('');
      return;
    }

    if (state.status === 'error') {
      clearInterval(timer);
      console.error('');
      console.error(`[tunnel] ❌ Tunnel failed: ${state.error}`);
      console.error(`[tunnel] The dashboard is still accessible locally at http://localhost:${port}`);
      console.error('');
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
      console.warn('');
      console.warn('[tunnel] ⚠️  Tunnel URL not available after 2 minutes.');
      console.warn(`[tunnel] The dashboard is accessible locally at http://localhost:${port}`);
      console.warn('[tunnel] The tunnel may still connect — check the logs.');
      console.warn('');
    }
  }, 2000);
}
