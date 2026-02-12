import { NextRequest, NextResponse } from 'next/server';
import { TunnelManager } from '../../../../lib/tunnel-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tunnel/configure
 *
 * Switches the tunnel from quick mode to a persistent named tunnel
 * with a custom domain. Requires Cloudflare account credentials.
 *
 * Body: { apiToken, accountId, zoneId, hostname }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiToken, accountId, zoneId, hostname } = body;

    if (!apiToken || !accountId || !zoneId || !hostname) {
      return NextResponse.json(
        { error: 'apiToken, accountId, zoneId, and hostname are all required' },
        { status: 400 },
      );
    }

    const manager = TunnelManager.getInstance();
    const state = manager.getState();

    // Don't overwrite an existing named tunnel — return the current URL
    if (state.mode === 'named' && state.status === 'connected' && state.url) {
      return NextResponse.json({
        success: true,
        url: state.url,
        alreadyConfigured: true,
      });
    }

    const result = await manager.configureNamedTunnel({
      apiToken,
      accountId,
      zoneId,
      hostname,
    });

    if (result.success) {
      return NextResponse.json({ success: true, url: result.url });
    }
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tunnel/configure
 *
 * Reverts to a quick tunnel, removing the named tunnel config.
 */
export async function DELETE() {
  try {
    const manager = TunnelManager.getInstance();
    await manager.removeNamedTunnel();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
