import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { GitService } from '@ai-engine/agent-runtime';

export const dynamic = 'force-dynamic';

/**
 * Restart a project from scratch.
 *
 * This endpoint:
 *   1. Verifies the project is in 'paused' status
 *   2. Tells workers to clean up all Docker containers for the project
 *   3. Deletes and recreates the Git repository (clean slate)
 *   4. Resets ALL tasks (completed, failed, locked, in_progress) back to 'pending'
 *   5. Clears agent records, iterations, and logs
 *   6. Updates project status to 'building'
 *   7. Publishes project:start so the orchestrator spawns a fresh swarm
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

    if (project.status !== 'paused') {
      return NextResponse.json(
        { error: `Project must be paused to restart. Current status: ${project.status}` },
        { status: 400 },
      );
    }

    // 1. Tell workers to clean up Docker containers first
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

      await redis.publish('docker:cleanup', JSON.stringify({
        projectId: body.projectId,
      }));

      await redis.quit();
    } catch (redisError) {
      console.error('[restart] Failed to publish Docker cleanup event:', redisError);
    }

    // 2. Delete and recreate the Git repository
    const gitService = GitService.getInstance();
    const existingConfig = (project.config as Record<string, unknown>) ?? {};
    let gitConfig;

    try {
      await gitService.deleteProjectRepo(body.projectId);
      console.log(`[restart] Deleted Git repo for project ${body.projectId}`);
    } catch (gitErr: any) {
      console.warn('[restart] Failed to delete Git repo (may not exist):', gitErr.message);
    }

    try {
      gitConfig = await gitService.createProjectRepo(
        body.projectId,
        project.name,
        project.prd,
      );
      console.log(`[restart] Recreated Git repo for project ${body.projectId}: ${gitConfig.localPath}`);
    } catch (gitError: any) {
      console.error('[restart] Failed to recreate Git repo:', gitError.message);
      gitConfig = null;
    }

    // 3. Reset ALL tasks back to pending
    await db.projectTask.updateMany({
      where: {
        projectId: body.projectId,
      },
      data: {
        status: 'pending',
        lockedBy: null,
        lockedAt: null,
        assignedAgentId: null,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
      },
    });

    // 4. Delete all agent records
    await db.projectAgent.deleteMany({
      where: { projectId: body.projectId },
    });

    // 5. Delete all iterations
    await db.projectIteration.deleteMany({
      where: { projectId: body.projectId },
    });

    // 6. Delete all logs (clean slate)
    await db.projectLog.deleteMany({
      where: { projectId: body.projectId },
    });

    // 7. Create a fresh first iteration
    await db.projectIteration.create({
      data: {
        projectId: body.projectId,
        iteration: 1,
        phase: 'build',
        status: 'in_progress',
      },
    });

    // 8. Update project status and store new Git config
    const externalRepoUrl = project.repoUrl || null;
    const updatedConfig = {
      ...existingConfig,
      ...(gitConfig ? {
        git: {
          repoPath: gitConfig.localPath,
          remoteUrl: externalRepoUrl ?? gitConfig.remoteUrl,
          defaultBranch: gitConfig.defaultBranch,
        },
      } : {}),
    };

    const updatedProject = await db.project.update({
      where: { id: body.projectId },
      data: {
        status: 'building',
        startedAt: new Date(),
        completedAt: null,
        config: updatedConfig,
      },
    });

    // 9. Log the restart
    const repoLabel = externalRepoUrl
      ? `remote repo ${externalRepoUrl}`
      : gitConfig
        ? `Git repo created at ${gitConfig.localPath}`
        : 'no Git (fallback mode)';

    await db.projectLog.create({
      data: {
        projectId: body.projectId,
        level: 'info',
        message: `Project restarted from scratch — all tasks reset, repository wiped. ${repoLabel}`,
        metadata: {
          agentCount: body.agentCount ?? 4,
          config: updatedConfig,
        },
      },
    });

    // 10. Publish project:start so the orchestrator spawns a fresh swarm
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

      await redis.publish('project:start', JSON.stringify({
        projectId: body.projectId,
        config: {
          agentCount: body.agentCount ?? 4,
          model: 'standard',
          repoUrl: externalRepoUrl,
          ...(gitConfig ? { git: gitConfig } : {}),
        },
      }));

      await redis.quit();
    } catch (redisError) {
      console.error('[restart] Failed to publish project start event:', redisError);
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
