/**
 * DockerService — manages Docker containers for isolated task execution.
 *
 * Each project task runs inside its own Docker container:
 *   1. Container is created from a base image with dev tools
 *   2. The project Git repo is cloned inside the container
 *   3. A feature branch is created for the task
 *   4. The agent does its work inside the container
 *   5. Changes are committed, pushed, and merged back to main
 *   6. The container is destroyed after the task completes
 *
 * This keeps the host system clean — no dependency bloat, no conflicts.
 * SSH keys are mounted read-only so the container can push to Git.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { homedir, cpus } from 'os';
import type {
  DockerContainerConfig,
  DockerContainerInfo,
  DockerContainerStatus,
  DockerTaskResult,
} from '@ai-engine/shared';

const execFile = promisify(execFileCb);

/** Track all managed containers for lifecycle cleanup. */
interface ManagedContainer {
  containerId: string;
  containerName: string;
  projectId: string;
  taskId: string;
  branchName: string;
  status: DockerContainerStatus;
  createdAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
}

export class DockerService {
  private static instance: DockerService;
  private containers = new Map<string, ManagedContainer>();
  private dockerAvailable: boolean | null = null;

  static getInstance(): DockerService {
    if (!DockerService.instance) {
      DockerService.instance = new DockerService();
    }
    return DockerService.instance;
  }

  // ---------------------------------------------------------------------------
  // Docker availability
  // ---------------------------------------------------------------------------

  /**
   * Check if Docker is available on this machine.
   */
  async isAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;

    try {
      await execFile('docker', ['info'], { timeout: 10_000 });
      this.dockerAvailable = true;
      console.log('[docker] Docker is available');
    } catch {
      this.dockerAvailable = false;
      console.warn('[docker] Docker is not available on this machine');
    }

    return this.dockerAvailable;
  }

  // ---------------------------------------------------------------------------
  // Container lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create and start a Docker container for a project task.
   *
   * The container:
   *   - Clones the project repo
   *   - Creates a feature branch for the task
   *   - Has SSH keys mounted for Git push access
   *   - Has a working directory set to the project root
   */
  async createTaskContainer(
    projectId: string,
    taskId: string,
    config: DockerContainerConfig,
  ): Promise<DockerContainerInfo> {
    if (!(await this.isAvailable())) {
      throw new Error('Docker is not available on this machine');
    }

    const containerName = `aie-${projectId.slice(0, 8)}-${taskId.slice(0, 8)}`;
    const keysDir = join(homedir(), '.ai-engine', 'keys');

    // Build docker run arguments
    const args: string[] = [
      'run', '-d',
      '--name', containerName,
      // Mount SSH keys (read-only) for Git operations
      '-v', `${keysDir}:/root/.ssh:ro`,
      // Mount the project repo
      '-v', `${config.repoPath}:${config.workDir}/repo.git:ro`,
      // Working directory
      '-w', config.workDir,
      // Environment variables
      '-e', `TASK_ID=${taskId}`,
      '-e', `PROJECT_ID=${projectId}`,
      '-e', `BRANCH_NAME=${config.branchName}`,
      '-e', 'GIT_SSH_COMMAND=ssh -i /root/.ssh/id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null',
    ];

    // Resource limits
    if (config.memoryLimit) {
      args.push('--memory', config.memoryLimit);
    }
    if (config.cpuLimit) {
      // Clamp CPU limit to available host CPUs (Docker rejects --cpus > available)
      const requested = parseFloat(config.cpuLimit);
      const available = cpus().length || 1;
      const clamped = Math.min(requested, available);
      args.push('--cpus', String(clamped));
      if (clamped < requested) {
        console.log(`[docker] Clamped CPU limit from ${requested} to ${clamped} (host has ${available} CPU(s))`);
      }
    }

    // Additional environment variables
    for (const [key, value] of Object.entries(config.envVars)) {
      args.push('-e', `${key}=${value}`);
    }

    // Additional volume mounts
    if (config.extraMounts) {
      for (const mount of config.extraMounts) {
        const mountStr = mount.readOnly
          ? `${mount.hostPath}:${mount.containerPath}:ro`
          : `${mount.hostPath}:${mount.containerPath}`;
        args.push('-v', mountStr);
      }
    }

    // Image and initial command: clone repo, create branch, keep alive
    args.push(config.image);
    args.push('sh', '-c', [
      // Configure git
      'git config --global user.email "ai-engine@local"',
      'git config --global user.name "AI Engine"',
      // Setup SSH key permissions
      'mkdir -p /root/.ssh && chmod 700 /root/.ssh',
      'cp /root/.ssh/id_ed25519 /tmp/git_key && chmod 600 /tmp/git_key',
      'export GIT_SSH_COMMAND="ssh -i /tmp/git_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"',
      // Clone the repo
      `git clone ${config.workDir}/repo.git ${config.workDir}/project`,
      `cd ${config.workDir}/project`,
      // Create feature branch
      `git checkout -b ${config.branchName}`,
      // Keep container alive for tool execution
      'tail -f /dev/null',
    ].join(' && '));

    try {
      const { stdout } = await execFile('docker', args, { timeout: 60_000 });
      const containerId = stdout.trim();

      const managed: ManagedContainer = {
        containerId,
        containerName,
        projectId,
        taskId,
        branchName: config.branchName,
        status: 'running',
        createdAt: new Date(),
        startedAt: new Date(),
        stoppedAt: null,
      };
      this.containers.set(taskId, managed);

      console.log(`[docker] Container created: ${containerName} (${containerId.slice(0, 12)})`);

      return {
        containerId,
        containerName,
        projectId,
        taskId,
        status: 'running',
        branchName: config.branchName,
        createdAt: managed.createdAt.toISOString(),
        startedAt: managed.startedAt!.toISOString(),
        stoppedAt: null,
      };
    } catch (error: any) {
      console.error(`[docker] Failed to create container: ${error.message}`);
      throw new Error(`Docker container creation failed: ${error.message}`);
    }
  }

  /**
   * Execute a command inside a running task container.
   */
  async execInContainer(taskId: string, command: string, timeout = 300_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = this.containers.get(taskId);
    if (!container) {
      throw new Error(`No container found for task ${taskId}`);
    }

    try {
      const { stdout, stderr } = await execFile(
        'docker',
        ['exec', container.containerName, 'sh', '-c', command],
        { timeout, maxBuffer: 10 * 1024 * 1024 },
      );
      return { exitCode: 0, stdout, stderr };
    } catch (error: any) {
      return {
        exitCode: error.code ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
      };
    }
  }

  /**
   * Commit and push changes from inside the container, then merge to main.
   */
  async finalizeTask(taskId: string, commitMessage: string): Promise<DockerTaskResult> {
    const container = this.containers.get(taskId);
    if (!container) {
      throw new Error(`No container found for task ${taskId}`);
    }

    const workDir = '/workspace/project';

    // Stage and commit all changes
    const addResult = await this.execInContainer(taskId, `cd ${workDir} && git add -A`);
    const statusResult = await this.execInContainer(taskId, `cd ${workDir} && git status --porcelain`);
    const filesChanged = statusResult.stdout.trim().split('\n').filter(Boolean).length;

    let commitsCreated = 0;
    if (filesChanged > 0) {
      const commitResult = await this.execInContainer(
        taskId,
        `cd ${workDir} && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
      );
      if (commitResult.exitCode === 0) commitsCreated = 1;
    }

    // Push the branch
    let pushSuccess = false;
    if (commitsCreated > 0) {
      const pushResult = await this.execInContainer(
        taskId,
        `cd ${workDir} && git push origin ${container.branchName}`,
      );
      pushSuccess = pushResult.exitCode === 0;
    }

    // Merge to main
    let merged = false;
    if (pushSuccess) {
      const mergeResult = await this.execInContainer(taskId, [
        `cd ${workDir}`,
        'git checkout main',
        'git pull origin main',
        `git merge --no-ff ${container.branchName} -m "Merge ${container.branchName}"`,
        'git push origin main',
      ].join(' && '));
      merged = mergeResult.exitCode === 0;
    }

    return {
      containerId: container.containerId,
      taskId,
      branchName: container.branchName,
      exitCode: merged ? 0 : 1,
      merged,
      output: merged ? 'Task completed and merged to main' : 'Task completed but merge failed',
      filesChanged,
      commitsCreated,
    };
  }

  /**
   * Stop and remove a container. Called after a task completes (success or failure).
   */
  async removeContainer(taskId: string): Promise<void> {
    const container = this.containers.get(taskId);
    if (!container) return;

    try {
      // Force stop and remove
      await execFile('docker', ['rm', '-f', container.containerName], { timeout: 30_000 });
      container.status = 'removed';
      container.stoppedAt = new Date();
      this.containers.delete(taskId);
      console.log(`[docker] Container removed: ${container.containerName}`);
    } catch (error: any) {
      console.error(`[docker] Failed to remove container ${container.containerName}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clean up all containers for a project.
   * Called when a project is completed, failed, or deleted.
   */
  async cleanupProject(projectId: string): Promise<{ removed: number; errors: number }> {
    let removed = 0;
    let errors = 0;

    const projectContainers = Array.from(this.containers.entries())
      .filter(([_, c]) => c.projectId === projectId);

    for (const [taskId, container] of projectContainers) {
      try {
        await this.removeContainer(taskId);
        removed++;
      } catch {
        errors++;
      }
    }

    // Also clean up any orphaned containers matching the project name pattern
    try {
      const { stdout } = await execFile('docker', [
        'ps', '-a', '--filter', `name=aie-${projectId.slice(0, 8)}`,
        '--format', '{{.Names}}',
      ]);
      const orphans = stdout.trim().split('\n').filter(Boolean);
      for (const name of orphans) {
        try {
          await execFile('docker', ['rm', '-f', name], { timeout: 30_000 });
          removed++;
          console.log(`[docker] Cleaned up orphaned container: ${name}`);
        } catch {
          errors++;
        }
      }
    } catch {}

    console.log(`[docker] Project cleanup: ${removed} removed, ${errors} errors`);
    return { removed, errors };
  }

  /**
   * Clean up all managed containers. Called during graceful shutdown.
   */
  async cleanupAll(): Promise<void> {
    console.log(`[docker] Cleaning up ${this.containers.size} containers...`);
    const tasks = Array.from(this.containers.keys());
    await Promise.allSettled(tasks.map((taskId) => this.removeContainer(taskId)));
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  /**
   * Get info about a container by task ID.
   */
  getContainerInfo(taskId: string): DockerContainerInfo | null {
    const container = this.containers.get(taskId);
    if (!container) return null;

    return {
      containerId: container.containerId,
      containerName: container.containerName,
      projectId: container.projectId,
      taskId: container.taskId,
      status: container.status,
      branchName: container.branchName,
      createdAt: container.createdAt.toISOString(),
      startedAt: container.startedAt?.toISOString() ?? null,
      stoppedAt: container.stoppedAt?.toISOString() ?? null,
    };
  }

  /**
   * List all active containers for a project.
   */
  getProjectContainers(projectId: string): DockerContainerInfo[] {
    return Array.from(this.containers.values())
      .filter((c) => c.projectId === projectId)
      .map((c) => ({
        containerId: c.containerId,
        containerName: c.containerName,
        projectId: c.projectId,
        taskId: c.taskId,
        status: c.status,
        branchName: c.branchName,
        createdAt: c.createdAt.toISOString(),
        startedAt: c.startedAt?.toISOString() ?? null,
        stoppedAt: c.stoppedAt?.toISOString() ?? null,
      }));
  }

  /**
   * Get count of active containers.
   */
  getActiveContainerCount(): number {
    return Array.from(this.containers.values())
      .filter((c) => c.status === 'running').length;
  }

  // ---------------------------------------------------------------------------
  // Docker image management
  // ---------------------------------------------------------------------------

  /**
   * Build the base worker Docker image if it doesn't exist.
   * This image includes common dev tools (Node, Python, Git, etc.)
   */
  async ensureBaseImage(imageName = 'ai-engine-worker:latest'): Promise<boolean> {
    if (!(await this.isAvailable())) return false;

    // Check if image already exists
    try {
      await execFile('docker', ['image', 'inspect', imageName], { timeout: 10_000 });
      return true; // Image exists
    } catch {
      // Image doesn't exist, build it
    }

    // Create a Dockerfile for the base worker image
    const tmpDir = join(homedir(), '.ai-engine', 'docker-build');
    await mkdir(tmpDir, { recursive: true });

    const dockerfile = `
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install minimal tools — agents can install additional software as needed
RUN apt-get update && apt-get install -y \\
    git \\
    curl \\
    wget \\
    openssh-client \\
    ca-certificates \\
    gnupg \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

# Setup workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Git config
RUN git config --global user.email "ai-engine@local" \\
    && git config --global user.name "AI Engine" \\
    && git config --global init.defaultBranch main
`.trim();

    await writeFile(join(tmpDir, 'Dockerfile'), dockerfile);

    try {
      console.log(`[docker] Building base image: ${imageName}...`);
      await execFile('docker', ['build', '-t', imageName, tmpDir], {
        timeout: 600_000, // 10 minutes
      });
      console.log(`[docker] Base image built: ${imageName}`);
      return true;
    } catch (error: any) {
      console.error(`[docker] Failed to build base image: ${error.message}`);
      return false;
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
