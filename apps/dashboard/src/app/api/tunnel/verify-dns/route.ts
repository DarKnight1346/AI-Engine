import { NextResponse } from 'next/server';
import { TunnelManager } from '../../../../lib/tunnel-manager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tunnel/verify-dns
 *
 * Verifies and fixes the DNS record for the named tunnel using
 * credentials stored on the server (.env). No client-side credentials needed.
 */
export async function POST() {
  try {
    const manager = TunnelManager.getInstance();
    const state = manager.getState();

    if (state.mode !== 'named' || !state.tunnelId) {
      return NextResponse.json({ success: false, error: 'No named tunnel configured' });
    }

    await manager.verifyDns(true);

    return NextResponse.json({ success: true, tunnelId: state.tunnelId, hostname: state.hostname });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
