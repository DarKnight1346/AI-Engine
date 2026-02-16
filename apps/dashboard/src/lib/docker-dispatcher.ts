/**
 * DockerDispatcherImpl — bridges the DockerDispatcher interface to the
 * WorkerHub for routing Docker tool calls to workers.
 *
 * This lives on the dashboard and is passed to createDockerTools() when
 * setting up Docker tools for SwarmAgent (build mode only).
 *
 * The dispatcher uses the WorkerHub singleton to:
 *   - Create containers on workers (with project affinity)
 *   - Route docker_exec/read/write/list tool calls to the correct worker
 *   - Finalize or destroy containers
 *   - List containers for a project
 */

import type {
  DockerDispatcher,
  DockerContainerConfig,
  DockerContainerInfo,
  DockerTaskResult,
} from '@ai-engine/shared';
import type { WorkerHub } from './worker-hub';

export class DockerDispatcherImpl implements DockerDispatcher {
  constructor(private hub: WorkerHub) {}

  async executeDockerTool(
    taskId: string,
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs = 300_000,
  ): Promise<{ success: boolean; output: string }> {
    return this.hub.executeDockerToolOnWorker(taskId, toolName, input, timeoutMs);
  }

  async createContainer(opts: {
    projectId: string;
    taskId: string;
    config: DockerContainerConfig;
    repoUrl: string;
  }): Promise<{ containerId: string; workerId: string }> {
    return this.hub.createDockerContainer({
      projectId: opts.projectId,
      taskId: opts.taskId,
      config: opts.config as Record<string, unknown>,
      repoUrl: opts.repoUrl,
    });
  }

  async finalizeContainer(
    taskId: string,
    commitMessage: string,
  ): Promise<DockerTaskResult> {
    await this.hub.finalizeDockerContainer(taskId, commitMessage);

    // The actual result comes back asynchronously via docker:task:complete.
    // We return a placeholder; the orchestrator listens on Redis for the real result.
    return {
      containerId: taskId,
      taskId,
      branchName: '',
      exitCode: 0,
      merged: false,
      output: 'Finalization command sent. Awaiting worker result.',
      filesChanged: 0,
      commitsCreated: 0,
    };
  }

  async destroyContainer(taskId: string): Promise<void> {
    await this.hub.destroyDockerContainer(taskId);
  }

  async listProjectContainers(projectId: string): Promise<DockerContainerInfo[]> {
    const raw = this.hub.getProjectContainers(projectId);
    return raw.map((c) => ({
      containerId: c.taskId,
      containerName: `task-${c.taskId}`,
      projectId,
      taskId: c.taskId,
      status: 'running' as const,
      branchName: '',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    }));
  }
}
