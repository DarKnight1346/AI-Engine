/**
 * GET /api/hub/workers — list all workers connected via WebSocket
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hub = (globalThis as any).__workerHub;
  if (!hub) {
    return NextResponse.json({
      connected: 0,
      workers: [],
      message: 'Worker hub not initialised (use custom server entry point)',
    });
  }

  const workers = hub.getConnectedWorkers();
  return NextResponse.json({
    connected: workers.length,
    workers,
  });
}
