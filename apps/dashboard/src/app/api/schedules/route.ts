import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const schedules = await db.scheduledTask.findMany({
      orderBy: { nextRunAt: 'asc' },
      include: {
        agent: { select: { id: true, name: true } },
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { status: true, startedAt: true, finishedAt: true },
        },
      },
    });

    return NextResponse.json({
      schedules: schedules.map((s) => ({
        id: s.id,
        name: s.name,
        cronExpr: s.cronExpr,
        scheduleType: s.scheduleType,
        agentId: s.agentId,
        agentName: s.agent?.name ?? null,
        workflowId: s.workflowId,
        isActive: s.isActive,
        nextRunAt: s.nextRunAt.toISOString(),
        lastStatus: s.runs[0]?.status ?? null,
        lastRunAt: s.runs[0]?.startedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ schedules: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const schedule = await db.scheduledTask.create({
      data: {
        name: body.name,
        cronExpr: body.cronExpr,
        scheduleType: body.scheduleType ?? 'cron',
        agentId: body.agentId ?? null,
        workflowId: body.workflowId ?? null,
        goalContextId: body.goalContextId ?? null,
        configJson: body.config ?? {},
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : new Date(),
        isActive: body.isActive ?? true,
      },
    });

    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
