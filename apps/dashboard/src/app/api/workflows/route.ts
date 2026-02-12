import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const workflows = await db.workflow.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { workItems: true } },
      },
    });

    return NextResponse.json({
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        teamId: w.teamId,
        teamName: w.team?.name ?? null,
        stages: w.stages,
        workItemCount: w._count.workItems,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ workflows: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const workflow = await db.workflow.create({
      data: {
        name: body.name,
        teamId: body.teamId ?? null,
        stages: body.stages ?? [],
      },
    });

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
