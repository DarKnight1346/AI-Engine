import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { CronParser } from '@ai-engine/scheduler';

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
        // New fields
        userPrompt: s.userPrompt ?? null,
        intervalMs: s.intervalMs ? Number(s.intervalMs) : null,
        runAt: s.runAt?.toISOString() ?? null,
        endAt: s.endAt?.toISOString() ?? null,
        maxRuns: s.maxRuns ?? null,
        totalRuns: s.totalRuns ?? 0,
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

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Schedule name is required' }, { status: 400 });
    }

    const scheduleType = body.scheduleType ?? 'cron';

    // Validate required fields per schedule type
    if (scheduleType === 'cron' && !body.cronExpr?.trim()) {
      return NextResponse.json({ error: 'Cron expression is required for cron schedules' }, { status: 400 });
    }
    if (scheduleType === 'once' && !body.runAt && !body.cronExpr) {
      return NextResponse.json({ error: 'runAt or cronExpr is required for one-off schedules' }, { status: 400 });
    }
    if (scheduleType === 'interval' && !body.intervalMs) {
      return NextResponse.json({ error: 'intervalMs is required for interval schedules' }, { status: 400 });
    }

    // Compute nextRunAt based on schedule type
    let nextRunAt: Date;
    if (scheduleType === 'once' && body.runAt) {
      nextRunAt = new Date(body.runAt);
    } else if (scheduleType === 'interval' && body.intervalMs) {
      nextRunAt = new Date(Date.now() + Number(body.intervalMs));
    } else if (body.nextRunAt) {
      nextRunAt = new Date(body.nextRunAt);
    } else if (body.cronExpr) {
      nextRunAt = CronParser.getNextRun(body.cronExpr) ?? new Date();
    } else {
      nextRunAt = new Date();
    }

    const schedule = await db.scheduledTask.create({
      data: {
        name: body.name,
        cronExpr: body.cronExpr ?? (scheduleType === 'interval' ? '* * * * *' : ''),
        scheduleType,
        agentId: body.agentId || null,
        workflowId: body.workflowId || null,
        goalContextId: body.goalContextId ?? null,
        configJson: body.config ?? {},
        nextRunAt,
        isActive: body.isActive ?? true,
        userPrompt: body.userPrompt ?? null,
        intervalMs: body.intervalMs ? BigInt(body.intervalMs) : null,
        runAt: body.runAt ? new Date(body.runAt) : null,
        endAt: body.endAt ? new Date(body.endAt) : null,
        maxRuns: body.maxRuns ?? null,
      },
    });

    return NextResponse.json({
      schedule: {
        ...schedule,
        intervalMs: schedule.intervalMs ? Number(schedule.intervalMs) : null,
        nextRunAt: schedule.nextRunAt.toISOString(),
        runAt: schedule.runAt?.toISOString() ?? null,
        endAt: schedule.endAt?.toISOString() ?? null,
        createdAt: schedule.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH /api/schedules — Update schedule (toggle active, edit fields) */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.cronExpr !== undefined) updateData.cronExpr = body.cronExpr;
    if (body.agentId !== undefined) updateData.agentId = body.agentId || null;
    if (body.userPrompt !== undefined) updateData.userPrompt = body.userPrompt || null;
    if (body.intervalMs !== undefined) updateData.intervalMs = body.intervalMs ? BigInt(body.intervalMs) : null;
    if (body.endAt !== undefined) updateData.endAt = body.endAt ? new Date(body.endAt) : null;
    if (body.maxRuns !== undefined) updateData.maxRuns = body.maxRuns || null;
    if (body.scheduleType !== undefined) updateData.scheduleType = body.scheduleType;

    await db.scheduledTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE /api/schedules — Delete a schedule */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await db.scheduledTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
