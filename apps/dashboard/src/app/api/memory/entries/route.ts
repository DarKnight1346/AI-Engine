import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const entries = await db.memoryEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        content: e.content,
        importance: e.importance,
        scope: e.scope,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ entries: [], error: err.message }, { status: 500 });
  }
}
