import os from 'os';
import crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execFile as execFileCb, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { DashboardClient } from './dashboard-client.js';
import { EnvironmentTools, getWorkerTools, createDockerChatTools, cleanupDockerSession, getDockerSessions } from '@ai-engine/agent-runtime';
import type { Tool, ToolContext } from '@ai-engine/agent-runtime';
import type { NodeCapabilities, WorkerConfig, DashboardWsMessage } from '@ai-engine/shared';

const execFile = promisify(execFileCb);
const exec = promisify(execCb);

/**
 * Worker — a thin tool execution node.
 *
 * The worker does NOT run the LLM or access the database. All intelligence
 * (LLM, memory, context, agentic loops) lives on the dashboard server.
 *
 * Architecture:
 *   1. Dashboard runs the LLM agentic loop (ChatExecutor)
 *   2. When the agent needs a tool that requires a worker (browser, shell,
 *      filesystem), the dashboard sends a `tool:execute` message
 *   3. Worker runs the tool locally and sends `tool:result` back
 *   4. Dashboard feeds the result back to the LLM and continues
 *
 * The worker only needs: WebSocket connection, tool implementations, and
 * optionally a browser pool for browser automation.
 */
export class Worker {
  private client: DashboardClient | null = null;
  private running = false;
  private browserPool: any = null;
  private dockerAvailable = false;
  private keysReceived = false;

  /** Registered tools available for execution (browser, shell, filesystem, etc.) */
  private tools = new Map<string, Tool>();

  /**
   * Active browser sessions: browserSessionId → per-session tools.
   * Each agent gets its own isolated browser tab that persists across
   * multiple tool calls. Sessions are released explicitly when the agent
   * finishes, or reaped by the pool's idle timeout if the agent crashes.
   */
  private activeBrowserSessions = new Map<string, {
    tools: Map<string, Tool>;
    release: () => Promise<void>;
    createdAt: Date;
  }>();

  /** Path to stored SSH keys */
  private keysDir = join(os.homedir(), '.ai-engine', 'keys');

  /**
   * Active Docker containers: taskId → container info.
   * All Docker containers run HERE on the worker, not on the dashboard.
   */
  private activeContainers = new Map<string, {
    containerId: string;
    containerName: string;
    projectId: string;
    branchName: string;
  }>();

  async start(): Promise<void> {
    console.log('[worker] Starting...');

    const config = await this.loadConfig();
    const capabilities = this.detectCapabilities(config);

    console.log(`[worker] Server: ${config.serverUrl}`);
    console.log(`[worker] OS: ${capabilities.os}, Browser: ${capabilities.browserCapable}`);

    // Register built-in environment tools (datetime, system info, etc.)
    for (const tool of EnvironmentTools.getAll()) {
      this.tools.set(tool.name, tool);
    }

    // Register worker-specific tools (shell, filesystem)
    for (const tool of getWorkerTools()) {
      this.tools.set(tool.name, tool);
    }

    // Check Docker availability
    this.dockerAvailable = await this.detectDocker();
    console.log(`[worker] Docker: ${this.dockerAvailable ? 'available' : 'not available'}`);

    // Register Docker chat tools if Docker is available
    if (this.dockerAvailable) {
      for (const tool of createDockerChatTools()) {
        this.tools.set(tool.name, tool);
      }
    }

    console.log(`[worker] Registered ${this.tools.size} tools`);

    // Initialise browser pool if capable.
    // Linux workers run headless; macOS workers can run headed or headless.
    if (capabilities.browserCapable) {
      try {
        const { BrowserPool } = await import('@ai-engine/browser');
        const headless = capabilities.os !== 'darwin' || !capabilities.hasDisplay;
        this.browserPool = new BrowserPool({ headless });
        await this.browserPool.initialize();
        console.log(`[worker] Browser pool initialised (headless: ${headless})`);
      } catch (err) {
        console.warn('[worker] Browser pool init failed:', err);
      }
    }

    // Connect to the dashboard via WebSocket
    this.client = new DashboardClient({
      serverUrl: config.serverUrl,
      token: config.workerSecret,
      capabilities,

      onTaskAssigned: (msg) => this.handleTaskAssign(msg),
      onToolExecute: (msg) => this.handleToolExecute(msg),
      onAgentCall: () => {}, // Agent calls are handled by dashboard now
      onAgentResponse: () => {},
      onConfigUpdate: (msg) => {
        console.log('[worker] Config updated:', Object.keys(msg.config).join(', '));
      },
      onUpdateAvailable: (msg) => {
        console.log(`[worker] Update available: v${msg.version} — ${msg.bundleUrl}`);
      },
      onKeysSync: (msg) => this.handleKeysSync(msg),
      onBrowserSessionRelease: (msg) => this.handleBrowserSessionRelease(msg),
      onDockerSessionRelease: (msg) => this.handleDockerSessionRelease(msg),
      onDockerTaskAssign: (msg) => this.handleDockerTaskAssign(msg),
      onDockerTaskFinalize: (msg) => this.handleDockerTaskFinalize(msg),
      onDockerTaskCancel: (msg) => this.handleDockerTaskCancel(msg),
      onDockerCleanup: (msg) => this.handleDockerCleanup(msg),
      onDockerToolExecute: (msg) => this.handleDockerToolExecute(msg),
    });

    const workerId = await this.client.connect();
    this.client.dockerAvailable = this.dockerAvailable;
    console.log(`[worker] Connected as ${workerId}. Ready for tool execution.`);
    this.running = true;
  }

  async shutdown(): Promise<void> {
    console.log('[worker] Shutting down...');
    this.running = false;

    // Clean up all active Docker containers (project/SWARM mode)
    for (const [taskId, container] of this.activeContainers) {
      try {
        await exec(`docker rm -f ${container.containerName}`);
        console.log(`[worker] Cleaned up container ${container.containerName} for task ${taskId}`);
      } catch { /* ignore */ }
    }
    this.activeContainers.clear();

    // Clean up all Docker chat session containers
    const dockerSessions = getDockerSessions();
    for (const [sessionId] of dockerSessions) {
      try {
        await cleanupDockerSession(sessionId);
        console.log(`[worker] Cleaned up Docker chat session ${sessionId} during shutdown`);
      } catch { /* ignore */ }
    }

    // Release all active browser sessions before shutting down the pool
    for (const [sessionId, session] of this.activeBrowserSessions) {
      try { await session.release(); } catch { /* ignore */ }
      console.log(`[worker] Released browser session ${sessionId} during shutdown`);
    }
    this.activeBrowserSessions.clear();

    if (this.browserPool) {
      try { await this.browserPool.shutdown(); } catch { /* ignore */ }
    }

    this.client?.disconnect();
    console.log('[worker] Shutdown complete');
    process.exit(0);
  }

  // -----------------------------------------------------------------------
  // Tool execution (the core job of a worker)
  // -----------------------------------------------------------------------

  /**
   * Handle a tool execution request from the dashboard.
   * The dashboard's ChatExecutor dispatches worker-bound tools here.
   *
   * Browser tools use session-based management: all calls sharing the same
   * `browserSessionId` operate on the same browser tab. The session persists
   * until an explicit `browser:session:release` message arrives or the
   * pool's idle reaper reclaims it.
   */
  private async handleToolExecute(
    msg: { type: 'tool:execute'; callId: string; toolName: string; input: Record<string, unknown>; browserSessionId?: string },
  ): Promise<void> {
    const { callId, toolName, input, browserSessionId } = msg;
    console.log(`[worker] Tool execute: ${toolName} (call: ${callId}${browserSessionId ? `, session: ${browserSessionId}` : ''})`);

    try {
      let tool: Tool | undefined;

      if (toolName.startsWith('browser_') && this.browserPool) {
        // Look up (or create) a per-session set of browser tools
        tool = await this.getBrowserTool(toolName, browserSessionId ?? callId);
        if (!tool) {
          this.client?.sendToolResult(callId, false, `Browser tool "${toolName}" not found.`);
          return;
        }
      } else {
        tool = this.tools.get(toolName);
      }

      if (!tool) {
        this.client?.sendToolResult(callId, false, `Unknown tool "${toolName}" — not registered on this worker.`);
        return;
      }

      const context: ToolContext = {
        nodeId: this.client?.getWorkerId() ?? 'worker',
        agentId: 'dashboard',
        browserSessionId,
        capabilities: {
          os: os.platform() as any,
          hasDisplay: os.platform() === 'darwin',
          browserCapable: !!this.browserPool,
          environment: 'local',
          customTags: [],
        },
      };

      const result = await tool.execute(input, context);
      this.client?.sendToolResult(callId, result.success, result.output);

      // If the agent explicitly called browser_close, clean up the session
      if (toolName === 'browser_close' && browserSessionId) {
        await this.releaseBrowserSession(browserSessionId);
      }
    } catch (err: any) {
      this.client?.sendToolResult(callId, false, `Tool execution error: ${err.message}`);
    }
    // NOTE: We do NOT release the browser session here. The session persists
    // across tool calls until explicitly released by browser:session:release
    // or by the agent calling browser_close.
  }

  /**
   * Get a browser tool from an existing session, or create a new session.
   * Sessions are keyed by browserSessionId so the same agent always gets
   * the same browser tab across multiple tool calls.
   */
  private async getBrowserTool(toolName: string, browserSessionId: string): Promise<Tool | undefined> {
    // Check for existing session
    let session = this.activeBrowserSessions.get(browserSessionId);
    if (session) {
      return session.tools.get(toolName);
    }

    // Create a new session
    try {
      const { createPerTaskBrowserTools } = await import('@ai-engine/browser');
      const { tools, release } = await createPerTaskBrowserTools(this.browserPool, browserSessionId);

      const toolMap = new Map<string, Tool>();
      for (const t of tools) {
        toolMap.set(t.name, t);
      }

      this.activeBrowserSessions.set(browserSessionId, {
        tools: toolMap,
        release,
        createdAt: new Date(),
      });

      console.log(`[worker] Created browser session ${browserSessionId} (active: ${this.activeBrowserSessions.size})`);
      return toolMap.get(toolName);
    } catch (err) {
      console.error(`[worker] Failed to create browser session ${browserSessionId}:`, (err as Error).message);
      return undefined;
    }
  }

  /**
   * Release a browser session, closing its browser tab and freeing the pool slot.
   */
  private async releaseBrowserSession(browserSessionId: string): Promise<void> {
    const session = this.activeBrowserSessions.get(browserSessionId);
    if (!session) return;

    this.activeBrowserSessions.delete(browserSessionId);
    try {
      await session.release();
      console.log(`[worker] Released browser session ${browserSessionId} (active: ${this.activeBrowserSessions.size})`);
    } catch (err) {
      console.warn(`[worker] Error releasing browser session ${browserSessionId}:`, (err as Error).message);
    }
  }

  /**
   * Handle an explicit browser session release request from the dashboard.
   * Sent when an agent finishes execution.
   */
  private async handleBrowserSessionRelease(
    msg: { type: 'browser:session:release'; browserSessionId: string },
  ): Promise<void> {
    console.log(`[worker] Dashboard requested release of browser session ${msg.browserSessionId}`);
    await this.releaseBrowserSession(msg.browserSessionId);
  }

  /**
   * Handle a Docker session release request from the dashboard.
   * Cleans up all containers created during a chat/agent session.
   */
  private async handleDockerSessionRelease(
    msg: { type: 'docker:session:release'; dockerSessionId: string },
  ): Promise<void> {
    console.log(`[worker] Dashboard requested cleanup of Docker session ${msg.dockerSessionId}`);
    const cleaned = await cleanupDockerSession(msg.dockerSessionId);
    if (cleaned > 0) {
      console.log(`[worker] Cleaned up ${cleaned} Docker container(s) for session ${msg.dockerSessionId}`);
    }
  }

  // -----------------------------------------------------------------------
  // Legacy task:assign handler (kept for backwards compatibility)
  // In the new architecture, tasks are executed on the dashboard.
  // -----------------------------------------------------------------------

  private async handleTaskAssign(
    msg: Extract<DashboardWsMessage, { type: 'task:assign' }>,
  ): Promise<void> {
    console.warn(`[worker] Received task:assign (${msg.taskId}) — this worker runs tools only. Task execution should happen on the dashboard.`);
    this.client?.sendTaskFailed(
      msg.taskId,
      'This worker operates in tool-execution mode. Tasks (LLM agentic loops) should be run on the dashboard server.',
    );
  }

  // -----------------------------------------------------------------------
  // SSH key handling
  // -----------------------------------------------------------------------

  /**
   * Handle SSH key distribution from the dashboard.
   * Stores keys locally so Docker containers and Git can use them.
   */
  private async handleKeysSync(
    msg: { type: 'keys:sync'; publicKey: string; privateKey: string; fingerprint: string },
  ): Promise<void> {
    try {
      await mkdir(this.keysDir, { recursive: true });

      // Write private key (PEM format)
      await writeFile(join(this.keysDir, 'id_ed25519'), msg.privateKey, { mode: 0o600 });

      // Write public key (OpenSSH format)
      await writeFile(join(this.keysDir, 'id_ed25519.pub'), msg.publicKey + '\n', { mode: 0o644 });

      this.keysReceived = true;
      console.log(`[worker] SSH keys stored (fingerprint: ${msg.fingerprint})`);

      // Acknowledge receipt
      this.client?.sendKeysReceived(msg.fingerprint);
    } catch (err: any) {
      console.error('[worker] Failed to store SSH keys:', err.message);
    }
  }

  // -----------------------------------------------------------------------
  // Docker task execution (containers run HERE on the worker)
  // -----------------------------------------------------------------------

  /**
   * Handle a Docker-based task assignment from the dashboard.
   *
   * This is the FULL lifecycle — everything happens on this worker machine:
   *   1. Create a Docker container with the project repo cloned
   *   2. Create a feature branch for the task
   *   3. Execute the task prompt inside the container (shell commands)
   *   4. Commit all changes and merge branch to main
   *   5. Destroy the container
   *   6. Report results back to the dashboard
   */
  private async handleDockerTaskAssign(
    msg: {
      type: 'docker:task:assign';
      taskId: string;
      projectId: string;
      agentId: string;
      containerConfig: any;
      taskPrompt: string;
      rolePrompt?: string;
      repoUrl: string;
    },
  ): Promise<void> {
    if (!this.dockerAvailable) {
      this.client?.sendDockerTaskComplete(msg.taskId, {
        success: false,
        error: 'Docker is not available on this worker',
      });
      return;
    }

    console.log(`[worker] Docker task assigned: ${msg.taskId} (project: ${msg.projectId})`);
    this.client?.sendLog('info', `Creating Docker container for task ${msg.taskId}`, msg.taskId);

    const containerName = `aie-${msg.projectId.slice(0, 8)}-${msg.taskId.slice(0, 8)}`;
    const branchName = msg.containerConfig?.branchName ?? `task/${msg.taskId.slice(0, 8)}`;
    const image = msg.containerConfig?.image || 'ai-engine-worker:latest';
    let containerId = '';

    try {
      // ---------------------------------------------------------------
      // 1. Ensure the base Docker image exists on this worker
      // ---------------------------------------------------------------
      await this.ensureDockerImage(image);

      // ---------------------------------------------------------------
      // 2. Create and start the container
      // ---------------------------------------------------------------
      // Clamp CPU limit to available host CPUs (Docker rejects --cpus > available)
      let cpuLimitArgs: string[] = [];
      if (msg.containerConfig?.cpuLimit) {
        const requested = parseFloat(msg.containerConfig.cpuLimit);
        const available = os.cpus().length || 1;
        const clamped = Math.min(requested, available);
        cpuLimitArgs = ['--cpus', String(clamped)];
        if (clamped < requested) {
          console.log(`[worker] Clamped CPU limit from ${requested} to ${clamped} (host has ${available} CPU(s))`);
        }
      }

      const dockerArgs = [
        'run', '-d',
        '--name', containerName,
        '-v', `${this.keysDir}:/root/.ssh:ro`,
        '-w', '/workspace',
        '-e', `TASK_ID=${msg.taskId}`,
        '-e', `PROJECT_ID=${msg.projectId}`,
        '-e', `BRANCH_NAME=${branchName}`,
        '-e', 'GIT_SSH_COMMAND=ssh -i /tmp/git_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null',
        ...(msg.containerConfig?.memoryLimit ? ['--memory', msg.containerConfig.memoryLimit] : []),
        ...cpuLimitArgs,
        image,
        'tail', '-f', '/dev/null', // keep container alive
      ];

      const { stdout: cidRaw } = await execFile('docker', dockerArgs, { timeout: 60_000 });
      containerId = cidRaw.trim();

      // Track this container
      this.activeContainers.set(msg.taskId, {
        containerId,
        containerName,
        projectId: msg.projectId,
        branchName,
      });

      this.client?.sendDockerStatus(containerId, msg.taskId, 'created');

      // ---------------------------------------------------------------
      // 3. Setup inside the container: git config, clone repo, branch
      // ---------------------------------------------------------------
      const setupCommands = [
        'git config --global user.email "ai-engine@local"',
        'git config --global user.name "AI Engine"',
        // Copy SSH key to a location with correct perms (bind mount is read-only)
        'mkdir -p /tmp/.ssh',
        'cp /root/.ssh/id_ed25519 /tmp/.ssh/id_ed25519',
        'chmod 600 /tmp/.ssh/id_ed25519',
        'cp /root/.ssh/id_ed25519.pub /tmp/.ssh/id_ed25519.pub 2>/dev/null || true',
        // Clone the repo
        `GIT_SSH_COMMAND="ssh -i /tmp/.ssh/id_ed25519 -o StrictHostKeyChecking=no" git clone "${msg.repoUrl}" /workspace/project`,
        'cd /workspace/project',
        `git checkout -b "${branchName}"`,
      ].join(' && ');

      await this.dockerExec(containerName, ['sh', '-c', setupCommands], 120_000);
      this.client?.sendLog('info', `Container ${containerName} ready, branch: ${branchName}`, msg.taskId);
      this.client?.sendDockerStatus(containerId, msg.taskId, 'running');

      // ---------------------------------------------------------------
      // 4. Execute the task inside the container
      //    The agent loop runs on the dashboard and routes tool calls here.
      //    For now, tool:execute calls from the dashboard for this task
      //    will be intercepted and routed into this container.
      //    The container is kept alive until finalization.
      // ---------------------------------------------------------------
      // Nothing to do here — the container stays alive and the dashboard
      // will send tool:execute requests that we route into it.
      // Finalization happens when the dashboard sends docker:task:finalize.

    } catch (err: any) {
      console.error(`[worker] Docker task setup failed (${msg.taskId}):`, err.message);
      this.client?.sendDockerTaskComplete(msg.taskId, {
        success: false,
        error: `Container setup failed: ${err.message}`,
        merged: false,
        filesChanged: 0,
        commitsCreated: 0,
      });
      // Clean up the failed container
      await this.removeContainer(containerName);
      this.activeContainers.delete(msg.taskId);
    }
  }

  /**
   * Handle finalization of a Docker task.
   *
   * Workflow:
   *   1. Stage and commit all changes on the feature branch
   *   2. Push the feature branch to remote
   *   3. Pull latest main from remote (other agents may have pushed)
   *   4. Merge the branch into main
   *      - If merge conflict: abort, return to branch, report conflict
   *        (container stays alive so agent can resolve and retry)
   *   5. Push main to remote
   *   6. Clean up the container
   */
  private async handleDockerTaskFinalize(
    msg: { type: 'docker:task:finalize'; taskId: string; commitMessage?: string },
  ): Promise<void> {
    const container = this.activeContainers.get(msg.taskId);
    if (!container) {
      console.warn(`[worker] No active container for task ${msg.taskId}`);
      this.client?.sendDockerTaskComplete(msg.taskId, {
        success: false,
        error: 'No active container for this task',
        merged: false,
        filesChanged: 0,
        commitsCreated: 0,
      });
      return;
    }

    const { containerName, branchName } = container;
    const commitMsg = msg.commitMessage ?? `Task ${msg.taskId} completed`;
    const sshCmd = 'GIT_SSH_COMMAND="ssh -i /tmp/.ssh/id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"';

    try {
      this.client?.sendLog('info', `Finalizing task ${msg.taskId}: committing and pushing...`, msg.taskId);

      // Step 1: Stage and commit all changes on the feature branch
      const commitScript = [
        'cd /workspace/project',
        'git add -A',
        `git diff --cached --quiet || git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
      ].join(' && ');

      await this.dockerExec(containerName, ['sh', '-c', commitScript], 30_000);

      // Gather stats (best-effort)
      let filesChanged = 0;
      let commitsCreated = 0;
      try {
        const { stdout: diffStat } = await this.dockerExec(
          containerName,
          ['sh', '-c', 'cd /workspace/project && git diff --stat main...HEAD --shortstat'],
          10_000,
        );
        const filesMatch = diffStat.match(/(\d+) files? changed/);
        if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);

        const { stdout: logCount } = await this.dockerExec(
          containerName,
          ['sh', '-c', 'cd /workspace/project && git rev-list --count main..HEAD'],
          10_000,
        );
        commitsCreated = parseInt(logCount.trim(), 10) || 0;
      } catch { /* stats are best-effort */ }

      // Step 2: Push the feature branch to remote
      try {
        await this.dockerExec(
          containerName,
          ['sh', '-c', `cd /workspace/project && ${sshCmd} git push -u origin "${branchName}"`],
          60_000,
        );
        console.log(`[worker] Pushed branch ${branchName} for task ${msg.taskId}`);
      } catch (pushErr: any) {
        console.error(`[worker] Branch push failed for ${branchName}:`, pushErr.message);
        this.client?.sendLog('error', `Failed to push branch ${branchName}: ${pushErr.message}`, msg.taskId);
      }

      // Step 3: Pull latest main from remote (other agents may have pushed)
      try {
        const pullScript = [
          'cd /workspace/project',
          'git checkout main',
          `${sshCmd} git pull origin main`,
        ].join(' && ');
        await this.dockerExec(containerName, ['sh', '-c', pullScript], 60_000);
      } catch (pullErr: any) {
        console.warn(`[worker] Pull main failed (may be first push): ${pullErr.message}`);
        // Ensure we're on main even if pull failed
        try {
          await this.dockerExec(containerName, ['sh', '-c', 'cd /workspace/project && git checkout main'], 10_000);
        } catch { /* ignore */ }
      }

      // Step 4: Merge the branch into main
      let merged = false;
      let mergeConflict = false;
      let conflictFiles = '';
      try {
        await this.dockerExec(
          containerName,
          ['sh', '-c', `cd /workspace/project && git merge --no-ff "${branchName}" -m "Merge ${branchName}"`],
          30_000,
        );
        merged = true;
      } catch (mergeErr: any) {
        console.error(`[worker] Merge failed for ${branchName}:`, mergeErr.message);

        // Check if this is a merge conflict (vs other error)
        try {
          const { stdout: status } = await this.dockerExec(
            containerName,
            ['sh', '-c', 'cd /workspace/project && git diff --name-only --diff-filter=U 2>/dev/null'],
            10_000,
          );
          conflictFiles = status.trim();
          mergeConflict = conflictFiles.length > 0;
        } catch { /* ignore */ }

        // Abort the failed merge and return to branch
        try {
          await this.dockerExec(containerName, ['sh', '-c', 'cd /workspace/project && git merge --abort 2>/dev/null; true'], 10_000);
          await this.dockerExec(containerName, ['sh', '-c', `cd /workspace/project && git checkout "${branchName}"`], 10_000);
        } catch { /* ignore */ }

        if (mergeConflict) {
          // Report conflict — container stays alive so agent can resolve and retry
          this.client?.sendLog('warn', `Merge conflict in ${branchName}: ${conflictFiles}`, msg.taskId);
          this.client?.sendDockerTaskComplete(msg.taskId, {
            success: false,
            merged: false,
            mergeConflict: true,
            conflictFiles,
            filesChanged,
            commitsCreated,
            branchName,
            error: `Merge conflict with main. Conflicting files: ${conflictFiles}`,
            output: `Merge conflict detected. Branch ${branchName} is pushed. Conflicting files:\n${conflictFiles}`,
          });
          console.log(`[worker] Merge conflict for task ${msg.taskId} — container kept alive for resolution`);
          return; // Container stays alive — agent can resolve and call finalize again
        }

        this.client?.sendLog('error', `Merge of ${branchName} into main failed: ${mergeErr.message}`, msg.taskId);
      }

      // Step 5: Push main to remote
      if (merged) {
        try {
          await this.dockerExec(
            containerName,
            ['sh', '-c', `cd /workspace/project && ${sshCmd} git push origin main`],
            60_000,
          );
          console.log(`[worker] Pushed main for task ${msg.taskId}`);
        } catch (pushErr: any) {
          console.error(`[worker] Push main failed for task ${msg.taskId}:`, pushErr.message);
          this.client?.sendLog('error', `Failed to push main after merge: ${pushErr.message}`, msg.taskId);
        }
      }

      // Step 6: Clean up the container
      await this.removeContainer(containerName);
      this.activeContainers.delete(msg.taskId);

      this.client?.sendDockerTaskComplete(msg.taskId, {
        success: true,
        merged,
        filesChanged,
        commitsCreated,
        branchName,
        output: `${filesChanged} file(s) changed, ${commitsCreated} commit(s), merged: ${merged}`,
      });

      console.log(`[worker] Task ${msg.taskId} finalized: ${filesChanged} files, ${commitsCreated} commits, merged: ${merged}`);

    } catch (err: any) {
      console.error(`[worker] Finalization failed for task ${msg.taskId}:`, err.message);

      // Clean up on failure
      await this.removeContainer(containerName);
      this.activeContainers.delete(msg.taskId);

      this.client?.sendDockerTaskComplete(msg.taskId, {
        success: false,
        error: `Finalization failed: ${err.message}`,
        merged: false,
        filesChanged: 0,
        commitsCreated: 0,
      });
    }
  }

  /**
   * Handle cancellation of a single Docker task.
   * Destroys the container without committing.
   */
  private async handleDockerTaskCancel(
    msg: { type: 'docker:task:cancel'; taskId: string },
  ): Promise<void> {
    const container = this.activeContainers.get(msg.taskId);
    if (container) {
      console.log(`[worker] Cancelling Docker task ${msg.taskId}, removing container ${container.containerName}`);
      await this.removeContainer(container.containerName);
      this.activeContainers.delete(msg.taskId);
    }
  }

  /**
   * Handle cleanup of all Docker containers for a project.
   * Called when a project is paused, stopped, or deleted.
   */
  private async handleDockerCleanup(
    msg: { type: 'docker:cleanup'; projectId: string },
  ): Promise<void> {
    console.log(`[worker] Cleaning up all Docker containers for project ${msg.projectId}`);
    let removed = 0;

    for (const [taskId, container] of this.activeContainers) {
      if (container.projectId === msg.projectId) {
        await this.removeContainer(container.containerName);
        this.activeContainers.delete(taskId);
        removed++;
      }
    }

    // Also try to remove any orphaned containers matching the project ID prefix
    try {
      const prefix = `aie-${msg.projectId.slice(0, 8)}`;
      const { stdout } = await exec(`docker ps -a --filter "name=${prefix}" --format "{{.Names}}"`);
      const names = stdout.trim().split('\n').filter(Boolean);
      for (const name of names) {
        await this.removeContainer(name);
        removed++;
      }
    } catch { /* ignore */ }

    console.log(`[worker] Cleaned up ${removed} container(s) for project ${msg.projectId}`);
  }

  // -----------------------------------------------------------------------
  // Docker helpers
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Docker tool execution (routed from dashboard agent loop)
  // -----------------------------------------------------------------------

  /**
   * Handle a docker:tool:execute message from the dashboard.
   * Routes the tool call into the correct Docker container via `docker exec`.
   */
  private async handleDockerToolExecute(
    msg: { type: 'docker:tool:execute'; callId: string; taskId: string; toolName: string; input: Record<string, unknown> },
  ): Promise<void> {
    const { callId, taskId, toolName, input } = msg;

    const container = this.activeContainers.get(taskId);
    if (!container) {
      this.client?.sendDockerToolResult(callId, false, `No active container for task ${taskId} on this worker.`);
      return;
    }

    console.log(`[worker] Docker tool: ${toolName} in ${container.containerName} (call: ${callId})`);

    try {
      switch (toolName) {
        case 'docker_exec': {
          const command = input.command as string;
          if (!command) {
            this.client?.sendDockerToolResult(callId, false, 'Missing "command" parameter.');
            return;
          }
          const { stdout, stderr } = await this.dockerExec(
            container.containerName,
            ['sh', '-c', command],
            300_000,
          );
          const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');
          this.client?.sendDockerToolResult(callId, true, output.slice(0, 100_000));
          break;
        }

        default:
          this.client?.sendDockerToolResult(callId, false, `Unknown docker tool: ${toolName}`);
      }
    } catch (err: any) {
      const errMsg = err.stderr || err.message || String(err);
      this.client?.sendDockerToolResult(callId, false, `Docker exec failed: ${errMsg}`.slice(0, 50_000));
    }
  }

  // -----------------------------------------------------------------------
  // Docker utilities
  // -----------------------------------------------------------------------

  /** Check if Docker daemon is running. */
  private async detectDocker(): Promise<boolean> {
    try {
      await execFile('docker', ['info'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Execute a command inside a Docker container. */
  private async dockerExec(
    containerName: string,
    command: string[],
    timeoutMs = 30_000,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFile('docker', ['exec', containerName, ...command], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
  }

  /** Stop and remove a Docker container (best-effort). */
  private async removeContainer(containerName: string): Promise<void> {
    try {
      await exec(`docker rm -f ${containerName}`);
    } catch { /* container may not exist */ }
  }

  /**
   * Ensure a Docker image exists on this worker.
   * Builds the default ai-engine-worker image if it doesn't exist.
   */
  private async ensureDockerImage(imageName: string): Promise<void> {
    try {
      await execFile('docker', ['image', 'inspect', imageName], { timeout: 10_000 });
      return; // Image exists
    } catch {
      // Image doesn't exist, build it
    }

    if (imageName !== 'ai-engine-worker:latest') {
      // Try pulling non-default images
      try {
        await execFile('docker', ['pull', imageName], { timeout: 300_000 });
        return;
      } catch {
        throw new Error(`Docker image "${imageName}" not found and could not be pulled`);
      }
    }

    // Build the default worker image
    console.log('[worker] Building ai-engine-worker:latest Docker image...');
    const dockerfile = `
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \\
    git curl wget openssh-client ca-certificates gnupg \\
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
`.trim();

    await exec(`echo '${dockerfile}' | docker build -t ai-engine-worker:latest -`, { timeout: 600_000 });
    console.log('[worker] ai-engine-worker:latest image built successfully');
  }

  // -----------------------------------------------------------------------
  // Config
  // -----------------------------------------------------------------------

  private async loadConfig(): Promise<WorkerConfig> {
    const configPath = join(os.homedir(), '.ai-engine', 'worker.json');
    try {
      const data = await readFile(configPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {
        workerId: process.env.WORKER_ID ?? crypto.randomUUID(),
        workerSecret: process.env.WORKER_SECRET ?? process.env.WORKER_TOKEN ?? '',
        serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
        environment: (process.env.ENVIRONMENT as 'cloud' | 'local') ?? 'local',
        customTags: [],
      };
    }
  }

  private detectCapabilities(config: WorkerConfig): NodeCapabilities {
    const platform = os.platform();
    return {
      os: platform as NodeCapabilities['os'],
      hasDisplay: platform === 'darwin',
      // Browser automation works on all platforms:
      // macOS can run headed or headless, Linux runs headless.
      browserCapable: platform === 'darwin' || platform === 'linux',
      environment: config.environment,
      customTags: config.customTags,
    };
  }
}
