import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { GitService, SshKeyService } from '@ai-engine/agent-runtime';

export const dynamic = 'force-dynamic';

/**
 * Start building a project - transitions from planning to building mode.
 *
 * This endpoint:
 *   1. Ensures SSH keys exist (for Git auth)
 *   2. Creates a Git repository for the project
 *   3. Updates project status to 'building'
 *   4. Publishes the start event to the orchestrator via Redis
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const project = await db.project.findUnique({
      where: { id: body.projectId },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'planning') {
      return NextResponse.json({ error: 'Project must be in planning status to start build' }, { status: 400 });
    }

    // 1. Ensure SSH key pair exists for Git authentication
    const sshKeyService = SshKeyService.getInstance();
    await sshKeyService.ensureKeyPair();

    // 2. Create Git repository for this project
    const gitService = GitService.getInstance();
    let gitConfig;
    try {
      gitConfig = await gitService.createProjectRepo(
        body.projectId,
        project.name,
        project.prd,
      );
      console.log(`[build] Git repo created for project ${body.projectId}: ${gitConfig.localPath}`);
    } catch (gitError: any) {
      console.error('[build] Failed to create Git repo:', gitError.message);
      // Non-fatal: project can still build without Git in fallback mode
      gitConfig = null;
    }

    // 3. Update project status to building, store Git config
    const existingConfig = (project.config as Record<string, unknown>) ?? {};
    const updatedConfig = {
      ...existingConfig,
      ...(gitConfig ? {
        git: {
          repoPath: gitConfig.localPath,
          remoteUrl: gitConfig.remoteUrl,
          defaultBranch: gitConfig.defaultBranch,
        },
      } : {}),
    };

    const updatedProject = await db.project.update({
      where: { id: body.projectId },
      data: {
        status: 'building',
        startedAt: new Date(),
        config: updatedConfig,
      },
    });

    // Create first iteration
    await db.projectIteration.create({
      data: {
        projectId: body.projectId,
        iteration: 1,
        phase: 'build',
        status: 'in_progress',
      },
    });

    // Log the start
    await db.projectLog.create({
      data: {
        projectId: body.projectId,
        level: 'info',
        message: gitConfig
          ? `Project build started — Git repo created at ${gitConfig.localPath}`
          : 'Project build started (Git repo creation failed, running in fallback mode)',
        metadata: {
          agentCount: body.agentCount ?? 4,
          config: updatedConfig,
          gitRepoPath: gitConfig?.localPath ?? null,
        },
      },
    });

    // 4. Trigger the project orchestrator via Redis pub/sub
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      
      await redis.publish('project:start', JSON.stringify({
        projectId: body.projectId,
        config: {
          agentCount: body.agentCount ?? 4,
          model: 'standard',
          ...(gitConfig ? { git: gitConfig } : {}),
        },
      }));
      
      await redis.quit();
    } catch (redisError) {
      console.error('Failed to publish project start event:', redisError);
    }

    return NextResponse.json({
      success: true,
      project: {
        ...updatedProject,
        createdAt: updatedProject.createdAt.toISOString(),
        updatedAt: updatedProject.updatedAt.toISOString(),
        startedAt: updatedProject.startedAt?.toISOString() ?? null,
        completedAt: updatedProject.completedAt?.toISOString() ?? null,
      },
      gitRepo: gitConfig ? {
        path: gitConfig.localPath,
        defaultBranch: gitConfig.defaultBranch,
      } : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Pause a running project.
 * Stops agents and tells workers to clean up Docker containers via Redis.
 * Docker containers run on WORKERS, not the dashboard.
 */
export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const project = await db.project.update({
      where: { id: body.projectId },
      data: {
        status: 'paused',
      },
    });

    // Update all agents to stopped
    await db.projectAgent.updateMany({
      where: { projectId: body.projectId },
      data: { status: 'stopped' },
    });

    // Trigger stop + Docker cleanup via Redis
    // The orchestrator handles stop; workers handle Docker cleanup
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      
      await redis.publish('project:stop', JSON.stringify({
        projectId: body.projectId,
      }));

      // Tell workers to clean up their Docker containers for this project
      await redis.publish('docker:cleanup', JSON.stringify({
        projectId: body.projectId,
      }));
      
      await redis.quit();
    } catch (redisError) {
      console.error('Failed to publish project stop / Docker cleanup events:', redisError);
    }

    await db.projectLog.create({
      data: {
        projectId: body.projectId,
        level: 'info',
        message: 'Project paused by user — workers instructed to clean up Docker containers',
      },
    });

    return NextResponse.json({
      success: true,
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
