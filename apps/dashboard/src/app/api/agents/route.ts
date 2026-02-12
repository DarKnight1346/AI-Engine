import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const agents = await db.agent.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { executionLogs: true, scheduledTasks: true },
        },
      },
    });

    const agentsWithStatus = await Promise.all(
      agents.map(async (agent) => {
        const activeTask = await db.workItem.findFirst({
          where: {
            status: 'in_progress',
            dataJson: { path: ['agentId'], equals: agent.id },
          },
        });

        return {
          id: agent.id,
          name: agent.name,
          rolePrompt: agent.rolePrompt,
          toolConfig: agent.toolConfig,
          requiredCapabilities: agent.requiredCapabilities,
          workflowStageIds: agent.workflowStageIds,
          createdAt: agent.createdAt.toISOString(),
          status: activeTask ? 'executing' : 'idle',
          taskCount: agent._count.executionLogs,
          scheduledTaskCount: agent._count.scheduledTasks,
        };
      }),
    );

    return NextResponse.json({ agents: agentsWithStatus });
  } catch (err: any) {
    return NextResponse.json({ agents: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const agent = await db.agent.create({
      data: {
        name: body.name,
        rolePrompt: body.rolePrompt ?? '',
        toolConfig: body.toolConfig ?? {},
        requiredCapabilities: body.requiredCapabilities ?? null,
        workflowStageIds: body.workflowStageIds ?? [],
      },
    });

    return NextResponse.json({ agent }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const body = await request.json();
    const agent = await db.agent.update({
      where: { id },
      data: {
        name: body.name,
        rolePrompt: body.rolePrompt ?? '',
        toolConfig: body.toolConfig ?? {},
        requiredCapabilities: body.requiredCapabilities ?? null,
        workflowStageIds: body.workflowStageIds ?? [],
      },
    });

    return NextResponse.json({ agent });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await db.agent.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
