import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const projectId = request.nextUrl.searchParams.get('id');

    // Get single project with details
    if (projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            orderBy: { priority: 'desc' },
          },
          agents: {
            orderBy: { lastActiveAt: 'desc' },
          },
          iterations: {
            orderBy: { iteration: 'desc' },
          },
          logs: {
            orderBy: { timestamp: 'desc' },
            take: 100,
          },
        },
      });

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      return NextResponse.json({
        project: {
          ...project,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
          startedAt: project.startedAt?.toISOString() ?? null,
          completedAt: project.completedAt?.toISOString() ?? null,
          tasks: project.tasks.map((t) => ({
            ...t,
            createdAt: t.createdAt.toISOString(),
            updatedAt: t.updatedAt.toISOString(),
            startedAt: t.startedAt?.toISOString() ?? null,
            completedAt: t.completedAt?.toISOString() ?? null,
            lockedAt: t.lockedAt?.toISOString() ?? null,
          })),
          agents: project.agents.map((a) => ({
            ...a,
            startedAt: a.startedAt.toISOString(),
            lastActiveAt: a.lastActiveAt.toISOString(),
          })),
          iterations: project.iterations.map((i) => ({
            ...i,
            startedAt: i.startedAt.toISOString(),
            completedAt: i.completedAt?.toISOString() ?? null,
          })),
          logs: project.logs.map((l) => ({
            ...l,
            timestamp: l.timestamp.toISOString(),
          })),
        },
      });
    }

    // Get all projects
    const projects = await db.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { tasks: true, agents: true, logs: true },
        },
      },
    });

    const projectsWithStats = projects.map((project) => {
      const taskCounts = {
        total: project._count.tasks,
        pending: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
      };

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        startedAt: project.startedAt?.toISOString() ?? null,
        completedAt: project.completedAt?.toISOString() ?? null,
        taskCount: project._count.tasks,
        agentCount: project._count.agents,
      };
    });

    return NextResponse.json({ projects: projectsWithStats });
  } catch (err: any) {
    return NextResponse.json({ projects: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const project = await db.project.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        prd: body.prd ?? null,
        status: body.status ?? 'planning',
        config: body.config ?? {},
        planningSessionId: body.planningSessionId ?? null,
        teamId: body.teamId ?? null,
        createdByUserId: body.createdByUserId ?? 'system', // TODO: Get from auth
      },
    });

    return NextResponse.json({
      project: {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        startedAt: project.startedAt?.toISOString() ?? null,
        completedAt: project.completedAt?.toISOString() ?? null,
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
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.prd !== undefined) updateData.prd = body.prd;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.config !== undefined) updateData.config = body.config;
    
    // Handle status transitions
    if (body.status === 'building' && !body.startedAt) {
      updateData.startedAt = new Date();
    }
    if ((body.status === 'completed' || body.status === 'failed') && !body.completedAt) {
      updateData.completedAt = new Date();
    }

    const project = await db.project.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      project: {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        startedAt: project.startedAt?.toISOString() ?? null,
        completedAt: project.completedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Tell workers to clean up their Docker containers for this project (via Redis)
    // Docker containers run on WORKERS, not the dashboard
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      await redis.publish('docker:cleanup', JSON.stringify({ projectId: id }));
      await redis.quit();
    } catch { /* Docker cleanup is best-effort */ }

    // Clean up Git repository (bare repos live on the dashboard)
    try {
      const { GitService } = await import('@ai-engine/agent-runtime');
      const gitService = GitService.getInstance();
      await gitService.deleteProjectRepo(id);
    } catch { /* Git cleanup is best-effort */ }

    await db.project.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
