import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const goals = await db.userGoal.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({
      goals: goals.map((g) => ({
        id: g.id,
        description: g.description,
        priority: g.priority,
        status: g.status,
        scope: g.scope,
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ goals: [], error: err.message }, { status: 500 });
  }
}
