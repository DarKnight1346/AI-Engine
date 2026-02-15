import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const projectId = request.nextUrl.searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const tasks = await db.projectTask.findMany({
      where: { projectId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({
      tasks: tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        lockedAt: t.lockedAt?.toISOString() ?? null,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ tasks: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.projectId || !body.title) {
      return NextResponse.json({ error: 'projectId and title are required' }, { status: 400 });
    }

    const task = await db.projectTask.create({
      data: {
        projectId: body.projectId,
        title: body.title,
        description: body.description ?? '',
        taskType: body.taskType ?? 'feature',
        status: 'pending',
        priority: body.priority ?? 5,
        dependencies: body.dependencies ?? [],
      },
    });

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        lockedAt: task.lockedAt?.toISOString() ?? null,
      },
    }, { status: 201 });
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
    
    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.taskType !== undefined) updateData.taskType = body.taskType;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.dependencies !== undefined) updateData.dependencies = body.dependencies;
    if (body.assignedAgentId !== undefined) updateData.assignedAgentId = body.assignedAgentId;
    if (body.result !== undefined) updateData.result = body.result;
    if (body.errorMessage !== undefined) updateData.errorMessage = body.errorMessage;

    const task = await db.projectTask.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      task: {
        ...task,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        lockedAt: task.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Lock a task for agent execution (atomic operation)
 */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    
    if (!body.taskId || !body.agentId) {
      return NextResponse.json({ error: 'taskId and agentId are required' }, { status: 400 });
    }

    const { taskId, agentId, action } = body;

    if (action === 'lock') {
      // Atomic lock operation - only succeeds if task is pending
      const task = await db.projectTask.updateMany({
        where: {
          id: taskId,
          status: 'pending',
          lockedBy: null,
        },
        data: {
          status: 'locked',
          lockedBy: agentId,
          lockedAt: new Date(),
        },
      });

      if (task.count === 0) {
        return NextResponse.json({ success: false, message: 'Task already locked or not available' }, { status: 409 });
      }

      const updatedTask = await db.projectTask.findUnique({ where: { id: taskId } });
      return NextResponse.json({
        success: true,
        task: {
          ...updatedTask,
          createdAt: updatedTask!.createdAt.toISOString(),
          updatedAt: updatedTask!.updatedAt.toISOString(),
          startedAt: updatedTask!.startedAt?.toISOString() ?? null,
          completedAt: updatedTask!.completedAt?.toISOString() ?? null,
          lockedAt: updatedTask!.lockedAt?.toISOString() ?? null,
        },
      });
    }

    if (action === 'unlock') {
      // Unlock a task
      const task = await db.projectTask.update({
        where: { id: taskId },
        data: {
          status: 'pending',
          lockedBy: null,
          lockedAt: null,
        },
      });

      return NextResponse.json({
        success: true,
        task: {
          ...task,
          createdAt: task.createdAt.toISOString(),
          updatedAt: task.updatedAt.toISOString(),
          startedAt: task.startedAt?.toISOString() ?? null,
          completedAt: task.completedAt?.toISOString() ?? null,
          lockedAt: task.lockedAt?.toISOString() ?? null,
        },
      });
    }

    if (action === 'start') {
      // Start working on a locked task
      const task = await db.projectTask.update({
        where: {
          id: taskId,
          lockedBy: agentId,
        },
        data: {
          status: 'in_progress',
          assignedAgentId: agentId,
          startedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        task: {
          ...task,
          createdAt: task.createdAt.toISOString(),
          updatedAt: task.updatedAt.toISOString(),
          startedAt: task.startedAt?.toISOString() ?? null,
          completedAt: task.completedAt?.toISOString() ?? null,
          lockedAt: task.lockedAt?.toISOString() ?? null,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
