import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { WorkerHub } from '@/lib/worker-hub';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: 'Missing worker id' }, { status: 400 });
  }

  try {
    const db = getDb();

    // Disconnect the worker from WebSocket if it's currently connected
    const hub = WorkerHub.getInstance();
    hub.disconnectWorker(id);

    // Delete the node record from the database
    await db.node.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    // Handle "record not found" gracefully
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
