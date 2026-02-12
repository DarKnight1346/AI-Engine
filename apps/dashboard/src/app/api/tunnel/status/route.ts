import { NextResponse } from 'next/server';
import { TunnelManager } from '../../../../lib/tunnel-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  const manager = TunnelManager.getInstance();
  const state = manager.getState();

  return NextResponse.json({
    status: state.status,
    url: state.url,
    mode: state.mode,
    hostname: state.hostname,
    tunnelId: state.tunnelId,
    error: state.error,
  });
}
