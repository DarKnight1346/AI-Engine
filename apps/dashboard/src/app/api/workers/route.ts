import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    const nodes = await db.node.findMany({
      orderBy: { lastHeartbeat: 'desc' },
    });

    // A node is considered online if its heartbeat is within the last 30 seconds
    const HEARTBEAT_TIMEOUT_MS = 30_000;
    const now = Date.now();

    const workers = nodes.map((node) => {
      const capabilities = (node.capabilities as Record<string, unknown>) ?? {};
      const online = now - node.lastHeartbeat.getTime() < HEARTBEAT_TIMEOUT_MS;

      return {
        id: node.id,
        hostname: node.hostname,
        ip: node.ip,
        os: node.os,
        environment: node.environment,
        capabilities,
        online,
        isLeader: node.isLeader,
        lastHeartbeat: node.lastHeartbeat.toISOString(),
      };
    });

    return NextResponse.json({ workers });
  } catch (err: any) {
    return NextResponse.json({ workers: [], error: err.message }, { status: 500 });
  }
}
