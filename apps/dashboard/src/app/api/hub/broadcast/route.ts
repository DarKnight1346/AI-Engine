/**
 * POST /api/hub/broadcast — push a config update or notification to all workers.
 *
 * Body: { type: 'config' | 'update', config?, version?, bundleUrl? }
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const hub = (globalThis as any).__workerHub;
  if (!hub) {
    return NextResponse.json(
      { error: 'Worker hub not initialised' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();

    if (body.type === 'config') {
      hub.broadcastConfig(body.config ?? {});
      return NextResponse.json({ broadcasted: true, type: 'config' });
    }

    if (body.type === 'update') {
      hub.broadcastUpdate(body.version ?? '0.0.0', body.bundleUrl ?? '');
      return NextResponse.json({ broadcasted: true, type: 'update' });
    }

    return NextResponse.json(
      { error: 'type must be "config" or "update"' },
      { status: 400 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
