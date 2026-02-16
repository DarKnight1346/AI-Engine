/**
 * WorkerHub — manages all WebSocket connections from workers.
 *
 * Responsibilities:
 *   - Authenticate workers via JWT
 *   - Track connected workers and their capabilities
 *   - Dispatch tasks to workers (choose best worker based on load/capabilities)
 *   - Route agent-to-agent calls between workers
 *   - Broadcast config updates
 *   - Record heartbeats in the DB
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import type {
  WorkerWsMessage,
  DashboardWsMessage,
  NodeCapabilities,
} from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectedWorker {
  ws: WebSocket;
  workerId: string;
  hostname: string;
  capabilities: NodeCapabilities | null;
  load: number;
  activeTasks: number;
  connectedAt: Date;
  lastHeartbeat: Date;
  authenticated: boolean;
  dockerAvailable: boolean;
  keysReceived: boolean;
}

interface PendingAgentCall {
  callId: string;
  sourceWorkerId: string;
  targetWorkerId: string;
  timestamp: number;
}

interface PendingToolCall {
  callId: string;
  workerId: string;
  resolve: (result: { success: boolean; output: string }) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export class WorkerHub {
  private static instance: WorkerHub;
  private workers = new Map<string, ConnectedWorker>();
  private pendingAgentCalls = new Map<string, PendingAgentCall>();
  private pendingToolCalls = new Map<string, PendingToolCall>();
  private pendingDockerToolCalls = new Map<string, PendingToolCall>();

  /** Track which worker hosts containers for each project (affinity). */
  private projectWorkerAffinity = new Map<string, string>(); // projectId → workerId

  /** Redis subscriber for Docker orchestration events from ProjectOrchestrator */
  private redisSub: any = null;
  /** Redis publisher for sending results back to ProjectOrchestrator */
  private redisPub: any = null;

  static getInstance(): WorkerHub {
    if (!WorkerHub.instance) {
      WorkerHub.instance = new WorkerHub();
    }
    return WorkerHub.instance;
  }

  /**
   * Initialize Redis pub/sub for Docker task orchestration.
   * The ProjectOrchestrator (in agent-runtime) communicates with
   * this hub via Redis since they live in different packages.
   *
   * Channels this hub SUBSCRIBES to (from orchestrator):
   *   - docker:task:dispatch  — create a container on a worker for a task
   *   - docker:task:finalize  — tell a worker to commit/merge/cleanup
   *   - docker:cleanup        — clean up all containers for a project
   *   - docker:task:cleanup   — clean up a single task's container
   *
   * Channels this hub PUBLISHES to (back to orchestrator):
   *   - docker:task:result:{taskId} — result of a Docker task
   */
  async initRedis(): Promise<void> {
    try {
      const Redis = (await import(/* webpackIgnore: true */ 'ioredis')).default;
      const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

      this.redisSub = new Redis(url);
      this.redisPub = new Redis(url);

      await this.redisSub.subscribe(
        'docker:task:dispatch',
        'docker:task:finalize',
        'docker:cleanup',
        'docker:task:cleanup',
      );

      this.redisSub.on('message', async (channel: string, message: string) => {
        try {
          const data = JSON.parse(message);
          await this.handleRedisMessage(channel, data);
        } catch (err: any) {
          console.error(`[hub] Redis message error (${channel}):`, err.message);
        }
      });

      console.log('[hub] Redis pub/sub initialized for Docker orchestration');
    } catch (err: any) {
      console.warn('[hub] Redis init failed — Docker dispatching will be unavailable:', err.message);
    }
  }

  /**
   * Handle Redis messages from the ProjectOrchestrator.
   * All Docker container management is dispatched to workers.
   */
  private async handleRedisMessage(channel: string, data: any): Promise<void> {
    switch (channel) {
      case 'docker:task:dispatch': {
        // Orchestrator wants to run a task in Docker on a worker
        const result = await this.dispatchDockerTask({
          taskId: data.taskId,
          projectId: data.projectId,
          agentId: data.agentId,
          containerConfig: data.containerConfig,
          taskPrompt: data.taskPrompt,
          rolePrompt: data.rolePrompt,
          repoUrl: data.repoUrl,
        });

        if (!result.dispatched) {
          // No workers available — tell orchestrator to fall back
          await this.publishDockerResult(data.taskId, {
            error: 'no_docker_workers',
            success: false,
          });
        }
        // If dispatched, worker will eventually send docker:task:complete
        // which we handle in handleDockerTaskComplete
        break;
      }

      case 'docker:task:finalize': {
        // Tell a specific worker to finalize (commit/merge/cleanup) a task
        const worker = this.findWorkerWithContainer(data.taskId);
        if (worker) {
          this.send(worker.ws, {
            type: 'docker:task:finalize',
            taskId: data.taskId,
            commitMessage: data.commitMessage,
          } as any);
        }
        break;
      }

      case 'docker:cleanup': {
        // Tell ALL workers to clean up containers for a project
        this.broadcastDockerCleanup(data.projectId);
        break;
      }

      case 'docker:task:cleanup': {
        // Tell the relevant worker to clean up a single task container
        const worker = this.findWorkerWithContainer(data.taskId);
        if (worker) {
          this.send(worker.ws, {
            type: 'docker:task:cancel',
            taskId: data.taskId,
          } as any);
        } else {
          // Broadcast cleanup in case we don't know which worker has it
          for (const w of this.workers.values()) {
            if (w.authenticated && w.dockerAvailable) {
              this.send(w.ws, { type: 'docker:task:cancel', taskId: data.taskId } as any);
            }
          }
        }
        break;
      }
    }
  }

  /**
   * Publish a Docker task result back to the orchestrator via Redis.
   */
  private async publishDockerResult(taskId: string, result: any): Promise<void> {
    if (this.redisPub) {
      await this.redisPub.publish(
        `docker:task:result:${taskId}`,
        JSON.stringify(result),
      );
    }
  }

  /**
   * Broadcast a Docker cleanup message to all Docker-capable workers.
   */
  private broadcastDockerCleanup(projectId: string): void {
    for (const worker of this.workers.values()) {
      if (worker.authenticated && worker.dockerAvailable) {
        this.send(worker.ws, {
          type: 'docker:cleanup',
          projectId,
        } as any);
      }
    }
  }

  /**
   * Find the worker that has a Docker container for a given task.
   */
  private findWorkerWithContainer(taskId: string): ConnectedWorker | null {
    const workerId = this.dockerTaskWorkers.get(taskId);
    if (workerId) {
      return this.workers.get(workerId) ?? null;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const entry: ConnectedWorker = {
      ws,
      workerId: '',
      hostname: req.headers.host ?? 'unknown',
      capabilities: null,
      load: 0,
      activeTasks: 0,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      authenticated: false,
      dockerAvailable: false,
      keysReceived: false,
    };

    // Must authenticate within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!entry.authenticated) {
        this.send(ws, { type: 'auth:error', message: 'Authentication timeout' });
        ws.close(4001, 'auth_timeout');
      }
    }, 10_000);

    ws.on('message', async (raw: Buffer | string) => {
      try {
        const msg: WorkerWsMessage = JSON.parse(
          typeof raw === 'string' ? raw : raw.toString('utf-8'),
        );
        await this.handleMessage(entry, msg);
      } catch (err: any) {
        console.error('[hub] Message parse error:', err.message);
      }
    });

    // Server-side ping every 30s to detect dead worker connections
    // (complements the worker's own 10s ping from the client side)
    const pingTimer = setInterval(() => {
      if (ws.readyState === 1) {
        (ws as any).ping?.();
      } else {
        clearInterval(pingTimer);
      }
    }, 30_000);

    ws.on('close', () => {
      clearTimeout(authTimeout);
      clearInterval(pingTimer);
      if (entry.workerId) {
        console.log(`[hub] Worker disconnected: ${entry.workerId}`);
        this.workers.delete(entry.workerId);
        this.updateNodeStatus(entry.workerId, false).catch(() => {});
      }
    });

    ws.on('error', (err) => {
      console.error(`[hub] WebSocket error (${entry.workerId || 'unauthenticated'}):`, err.message);
    });
  }

  // -----------------------------------------------------------------------
  // Message router
  // -----------------------------------------------------------------------

  private async handleMessage(worker: ConnectedWorker, msg: WorkerWsMessage): Promise<void> {
    // Pre-auth: only 'auth' is allowed
    if (!worker.authenticated && msg.type !== 'auth') {
      this.send(worker.ws, { type: 'auth:error', message: 'Not authenticated' });
      return;
    }

    switch (msg.type) {
      case 'auth':
        await this.handleAuth(worker, msg.token);
        break;

      case 'heartbeat':
        worker.load = msg.load;
        worker.activeTasks = msg.activeTasks;
        worker.capabilities = msg.capabilities;
        worker.dockerAvailable = (msg as any).dockerAvailable ?? false;
        worker.lastHeartbeat = new Date();
        this.updateNodeHeartbeat(worker.workerId).catch(() => {});
        break;

      case 'task:complete':
        await this.handleTaskComplete(worker.workerId, msg);
        break;

      case 'task:failed':
        await this.handleTaskFailed(worker.workerId, msg);
        break;

      case 'tool:result':
        this.handleToolResult(msg);
        break;

      case 'agent:call':
        await this.routeAgentCall(worker, msg);
        break;

      case 'agent:response':
        this.routeAgentResponse(msg);
        break;

      case 'log':
        this.handleWorkerLog(worker.workerId, msg);
        break;

      default: {
        // Handle new message types (keys:received, docker:status, docker:task:complete)
        // These are typed in the updated @ai-engine/shared but may not be in compiled dist yet
        const rawMsg = msg as any;
        if (rawMsg.type === 'keys:received') {
          worker.keysReceived = true;
          console.log(`[hub] Worker ${worker.workerId} received SSH keys (fingerprint: ${rawMsg.fingerprint})`);
        } else if (rawMsg.type === 'docker:status') {
          console.log(`[hub] Docker status from ${worker.workerId}: container=${rawMsg.containerId} task=${rawMsg.taskId} status=${rawMsg.status}`);
        } else if (rawMsg.type === 'docker:task:complete') {
          await this.handleDockerTaskComplete(worker.workerId, rawMsg);
        } else if (rawMsg.type === 'docker:tool:result') {
          this.handleDockerToolResult(rawMsg);
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  private async handleAuth(worker: ConnectedWorker, token: string): Promise<void> {
    try {
      const jwt = await import(/* webpackIgnore: true */ 'jsonwebtoken');
      const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';
      const decoded = jwt.default.verify(token, secret) as { workerId: string; [k: string]: unknown };

      worker.workerId = decoded.workerId;
      worker.authenticated = true;
      this.workers.set(decoded.workerId, worker);

      // Load config from DB to send to the worker
      let config: Record<string, unknown> = {};
      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();
        const configs = await db.config.findMany();
        configs.forEach((c) => { config[c.key] = c.valueJson; });
      } catch { /* DB may not be ready */ }

      this.send(worker.ws, { type: 'auth:ok', workerId: decoded.workerId, config });
      this.updateNodeStatus(decoded.workerId, true).catch(() => {});
      console.log(`[hub] Worker authenticated: ${decoded.workerId} (${this.workers.size} total)`);

      // Distribute SSH keys to the worker for Git operations
      this.syncKeysToWorker(worker).catch((err) => {
        console.warn(`[hub] Failed to sync SSH keys to ${decoded.workerId}:`, err.message);
      });
    } catch (err: any) {
      this.send(worker.ws, { type: 'auth:error', message: 'Invalid token: ' + err.message });
      worker.ws.close(4001, 'auth_failed');
    }
  }

  // -----------------------------------------------------------------------
  // Task dispatch
  // -----------------------------------------------------------------------

  /**
   * Dispatch a task to the best available worker.
   * Called by API routes / scheduler.
   */
  async dispatchTask(opts: {
    taskId: string;
    agentId: string;
    input: string;
    agentConfig: Record<string, unknown>;
    requiredCapabilities?: Partial<NodeCapabilities>;
    /** User context for memory scoping on the worker */
    userId?: string;
    teamId?: string;
  }): Promise<{ dispatched: boolean; workerId?: string; error?: string }> {
    const worker = this.pickWorker(opts.requiredCapabilities);
    if (!worker) {
      return { dispatched: false, error: 'No available workers' };
    }

    this.send(worker.ws, {
      type: 'task:assign',
      taskId: opts.taskId,
      agentId: opts.agentId,
      input: opts.input,
      agentConfig: opts.agentConfig,
      userId: opts.userId,
      teamId: opts.teamId,
    });

    worker.activeTasks += 1;
    return { dispatched: true, workerId: worker.workerId };
  }

  // -----------------------------------------------------------------------
  // Tool execution dispatch (dashboard → worker → result)
  // -----------------------------------------------------------------------

  /**
   * Execute a single tool on a worker and await the result.
   *
   * This is the core mechanism for the dashboard's ChatExecutor to
   * dispatch worker-bound tools (browser, shell, filesystem) to workers.
   * The LLM agentic loop runs on the dashboard; only tool execution
   * happens on the worker.
   *
   * For browser tools, `browserSessionId` enables session affinity: all
   * calls sharing the same ID are routed to the same worker so they
   * operate on the same browser tab.
   */
  async executeToolOnWorker(
    toolName: string,
    input: Record<string, unknown>,
    requiredCapabilities?: Partial<NodeCapabilities>,
    timeoutMs = 120_000,
    browserSessionId?: string,
  ): Promise<{ success: boolean; output: string }> {
    let worker: ConnectedWorker | null = null;

    // Browser session affinity: reuse the same worker for the same session
    if (browserSessionId) {
      const existingWorkerId = this.browserSessionWorkers.get(browserSessionId);
      if (existingWorkerId) {
        const existing = this.workers.get(existingWorkerId);
        if (existing?.authenticated && existing.ws.readyState === 1) {
          worker = existing;
        } else {
          // Worker disconnected; clear stale affinity
          this.browserSessionWorkers.delete(browserSessionId);
        }
      }
    }

    // Fall back to picking the best available worker
    if (!worker) {
      worker = this.pickWorker(requiredCapabilities);
    }

    if (!worker) {
      return {
        success: false,
        output: `No available worker to execute "${toolName}". Connect a worker node with the required capabilities.`,
      };
    }

    // Record session affinity for browser tools
    if (browserSessionId && !this.browserSessionWorkers.has(browserSessionId)) {
      this.browserSessionWorkers.set(browserSessionId, worker.workerId);
    }

    const callId = globalThis.crypto.randomUUID();

    return new Promise<{ success: boolean; output: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolCalls.delete(callId);
        resolve({ success: false, output: `Tool "${toolName}" timed out after ${timeoutMs / 1000}s on worker ${worker!.workerId}.` });
      }, timeoutMs);

      this.pendingToolCalls.set(callId, {
        callId,
        workerId: worker!.workerId,
        resolve,
        reject,
        timeout,
      });

      this.send(worker!.ws, {
        type: 'tool:execute',
        callId,
        toolName,
        input,
        browserSessionId,
      } as any);
    });
  }

  /**
   * Release a browser session on the worker that owns it.
   * Sends a message to the worker to close the browser tab and free the slot.
   * Also clears the session affinity mapping.
   */
  releaseBrowserSession(browserSessionId: string): void {
    const workerId = this.browserSessionWorkers.get(browserSessionId);
    if (!workerId) return;

    this.browserSessionWorkers.delete(browserSessionId);

    const worker = this.workers.get(workerId);
    if (worker?.authenticated && worker.ws.readyState === 1) {
      this.send(worker.ws, {
        type: 'browser:session:release',
        browserSessionId,
      } as any);
      console.log(`[hub] Released browser session ${browserSessionId} on worker ${workerId}`);
    }
  }

  /**
   * Handle a tool result from a worker.
   */
  private handleToolResult(msg: Extract<WorkerWsMessage, { type: 'tool:result' }>): void {
    const pending = this.pendingToolCalls.get(msg.callId);
    if (!pending) {
      console.warn(`[hub] Tool result for unknown call: ${msg.callId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingToolCalls.delete(msg.callId);
    pending.resolve({ success: msg.success, output: msg.output });
  }

  private pickWorker(required?: Partial<NodeCapabilities>): ConnectedWorker | null {
    let best: ConnectedWorker | null = null;
    let bestScore = Infinity;

    for (const worker of this.workers.values()) {
      if (!worker.authenticated) continue;

      // Check required capabilities
      if (required) {
        const caps = worker.capabilities;
        if (!caps) continue;
        if (required.browserCapable && !caps.browserCapable) continue;
        if (required.hasDisplay && !caps.hasDisplay) continue;
        if (required.os && caps.os !== required.os) continue;
      }

      // Score: lower is better (based on load and active tasks)
      const score = worker.load + worker.activeTasks * 10;
      if (score < bestScore) {
        bestScore = score;
        best = worker;
      }
    }

    return best;
  }

  // -----------------------------------------------------------------------
  // Task results
  // -----------------------------------------------------------------------

  private async handleTaskComplete(
    workerId: string,
    msg: Extract<WorkerWsMessage, { type: 'task:complete' }>,
  ): Promise<void> {
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();

      await db.workItem.update({
        where: { id: msg.taskId },
        data: { status: 'completed' },
      });

      // Find the agent for this work item to create an execution log
      const workItem = await db.workItem.findUnique({ where: { id: msg.taskId } });
      if (workItem) {
        const agentId = (workItem.dataJson as any)?.agentId;
        if (agentId) {
          await db.executionLog.create({
            data: {
              agentId,
              workItemId: msg.taskId,
              input: '',
              output: msg.output,
              tokensUsed: msg.tokensUsed,
              durationMs: msg.durationMs,
            },
          });
        }
      }

      console.log(`[hub] Task ${msg.taskId} completed by ${workerId}`);
    } catch (err: any) {
      console.error('[hub] Failed to record task completion:', err.message);
    }
  }

  private async handleTaskFailed(
    workerId: string,
    msg: Extract<WorkerWsMessage, { type: 'task:failed' }>,
  ): Promise<void> {
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();

      await db.workItem.update({
        where: { id: msg.taskId },
        data: { status: 'failed' },
      });

      console.error(`[hub] Task ${msg.taskId} failed on ${workerId}: ${msg.error}`);
    } catch (err: any) {
      console.error('[hub] Failed to record task failure:', err.message);
    }
  }

  // -----------------------------------------------------------------------
  // Agent-to-agent routing
  // -----------------------------------------------------------------------

  private async routeAgentCall(
    source: ConnectedWorker,
    msg: Extract<WorkerWsMessage, { type: 'agent:call' }>,
  ): Promise<void> {
    // Find a worker that can run the target agent
    // For now, pick the least-loaded worker (could be the same one)
    const target = this.pickWorker();
    if (!target) {
      this.send(source.ws, {
        type: 'agent:response',
        callId: msg.callId,
        output: '',
        error: 'No available worker to handle agent call',
      });
      return;
    }

    // Track the pending call so we can route the response back
    this.pendingAgentCalls.set(msg.callId, {
      callId: msg.callId,
      sourceWorkerId: source.workerId,
      targetWorkerId: target.workerId,
      timestamp: Date.now(),
    });

    // Load agent config from DB
    let agentConfig: Record<string, unknown> = {};
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      const agent = await db.agent.findUnique({ where: { id: msg.targetAgentId } });
      if (agent) {
        agentConfig = {
          name: agent.name,
          rolePrompt: agent.rolePrompt,
          toolConfig: agent.toolConfig,
        };
      }
    } catch { /* ignore */ }

    this.send(target.ws, {
      type: 'agent:call',
      callId: msg.callId,
      fromAgentId: msg.fromAgentId,
      input: msg.input,
      agentConfig,
    });

    console.log(`[hub] Agent call ${msg.callId}: ${msg.fromAgentId} → ${msg.targetAgentId} (${source.workerId} → ${target.workerId})`);
  }

  private routeAgentResponse(msg: Extract<WorkerWsMessage, { type: 'agent:response' }>): void {
    const pending = this.pendingAgentCalls.get(msg.callId);
    if (!pending) {
      console.warn(`[hub] Agent response for unknown call: ${msg.callId}`);
      return;
    }

    const source = this.workers.get(pending.sourceWorkerId);
    if (source) {
      this.send(source.ws, {
        type: 'agent:response',
        callId: msg.callId,
        output: msg.output,
        error: msg.error,
      });
    }

    this.pendingAgentCalls.delete(msg.callId);
  }

  // -----------------------------------------------------------------------
  // Worker log forwarding
  // -----------------------------------------------------------------------

  private handleWorkerLog(
    workerId: string,
    msg: Extract<WorkerWsMessage, { type: 'log' }>,
  ): void {
    const prefix = `[worker:${workerId}]`;
    switch (msg.level) {
      case 'error': console.error(prefix, msg.message); break;
      case 'warn': console.warn(prefix, msg.message); break;
      default: console.log(prefix, msg.message);
    }
  }

  // -----------------------------------------------------------------------
  // DB updates
  // -----------------------------------------------------------------------

  private async updateNodeHeartbeat(workerId: string): Promise<void> {
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      await db.node.update({
        where: { id: workerId },
        data: { lastHeartbeat: new Date() },
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  private async updateNodeStatus(workerId: string, online: boolean): Promise<void> {
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      if (online) {
        await db.node.update({
          where: { id: workerId },
          data: { lastHeartbeat: new Date() },
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  // -----------------------------------------------------------------------
  // Broadcast / query
  // -----------------------------------------------------------------------

  broadcastConfig(config: Record<string, unknown>): void {
    this.broadcast({ type: 'config:update', config });
  }

  broadcastUpdate(version: string, bundleUrl: string): void {
    this.broadcast({ type: 'update:available', version, bundleUrl });
  }

  getConnectedWorkers(): Array<{
    workerId: string;
    hostname: string;
    capabilities: NodeCapabilities | null;
    load: number;
    activeTasks: number;
    connectedAt: string;
    lastHeartbeat: string;
    dockerAvailable: boolean;
    keysReceived: boolean;
  }> {
    return Array.from(this.workers.values())
      .filter((w) => w.authenticated)
      .map((w) => ({
        workerId: w.workerId,
        hostname: w.hostname,
        capabilities: w.capabilities,
        load: w.load,
        activeTasks: w.activeTasks,
        connectedAt: w.connectedAt.toISOString(),
        lastHeartbeat: w.lastHeartbeat.toISOString(),
        dockerAvailable: w.dockerAvailable,
        keysReceived: w.keysReceived,
      }));
  }

  /**
   * Get detailed info about a specific connected worker.
   * Returns null if the worker is not connected.
   */
  getWorkerDetails(workerId: string): {
    workerId: string;
    hostname: string;
    capabilities: NodeCapabilities | null;
    load: number;
    activeTasks: number;
    connectedAt: string;
    lastHeartbeat: string;
    dockerAvailable: boolean;
    keysReceived: boolean;
  } | null {
    const w = this.workers.get(workerId);
    if (!w || !w.authenticated) return null;
    return {
      workerId: w.workerId,
      hostname: w.hostname,
      capabilities: w.capabilities,
      load: w.load,
      activeTasks: w.activeTasks,
      connectedAt: w.connectedAt.toISOString(),
      lastHeartbeat: w.lastHeartbeat.toISOString(),
      dockerAvailable: w.dockerAvailable,
      keysReceived: w.keysReceived,
    };
  }

  getWorkerCount(): number {
    return Array.from(this.workers.values()).filter((w) => w.authenticated).length;
  }

  /**
   * Disconnect a worker by ID, closing its WebSocket connection.
   * Returns true if the worker was found and disconnected.
   */
  disconnectWorker(workerId: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    try {
      this.send(worker.ws, { type: 'auth:error', message: 'Removed by administrator' });
      worker.ws.close(4002, 'removed_by_admin');
    } catch { /* ignore close errors */ }

    this.workers.delete(workerId);
    return true;
  }

  /**
   * Alias for disconnectWorker — satisfies the WorkerToolDispatcher interface.
   */
  disconnectWorkerNode(workerId: string): boolean {
    return this.disconnectWorker(workerId);
  }

  // -----------------------------------------------------------------------
  // Targeted tool execution (specific worker by ID)
  // -----------------------------------------------------------------------

  /**
   * Execute a tool on a specific worker identified by its ID.
   * Unlike executeToolOnWorker, this does NOT auto-pick — it targets
   * the exact worker. Returns an error if the worker is not connected.
   */
  async executeToolOnSpecificWorker(
    workerId: string,
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<{ success: boolean; output: string }> {
    const worker = this.workers.get(workerId);
    if (!worker || !worker.authenticated) {
      return {
        success: false,
        output: `Worker "${workerId}" is not connected. Use listWorkers to see available workers.`,
      };
    }

    const callId = globalThis.crypto.randomUUID();

    return new Promise<{ success: boolean; output: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolCalls.delete(callId);
        resolve({
          success: false,
          output: `Tool "${toolName}" timed out after ${timeoutMs / 1000}s on worker ${workerId} (${worker.hostname}).`,
        });
      }, timeoutMs);

      this.pendingToolCalls.set(callId, {
        callId,
        workerId,
        resolve,
        reject,
        timeout,
      });

      this.send(worker.ws, {
        type: 'tool:execute',
        callId,
        toolName,
        input,
      });
    });
  }

  // -----------------------------------------------------------------------
  // SSH key distribution
  // -----------------------------------------------------------------------

  /**
   * Send the SSH key pair to a worker so it can authenticate with Git.
   */
  private async syncKeysToWorker(worker: ConnectedWorker): Promise<void> {
    try {
      const runtime = await import(/* webpackIgnore: true */ '@ai-engine/agent-runtime') as any;
      const sshKeyService = runtime.SshKeyService.getInstance();
      const keys = await sshKeyService.getKeyPairForWorker();
      if (keys) {
        this.send(worker.ws, {
          type: 'keys:sync',
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          fingerprint: keys.fingerprint,
        } as any);
        console.log(`[hub] SSH keys sent to worker ${worker.workerId}`);
      }
    } catch (err: any) {
      console.warn('[hub] SSH key sync failed:', err.message);
    }
  }

  /**
   * Broadcast SSH keys to all connected workers.
   * Called when keys are regenerated.
   */
  async syncKeysToAllWorkers(): Promise<void> {
    for (const worker of this.workers.values()) {
      if (worker.authenticated) {
        await this.syncKeysToWorker(worker).catch(() => {});
      }
    }
  }

  // -----------------------------------------------------------------------
  // Docker task dispatch
  // -----------------------------------------------------------------------

  /** Track which worker is running which Docker task */
  private dockerTaskWorkers = new Map<string, string>(); // taskId → workerId

  /**
   * Browser session affinity: browserSessionId → workerId.
   * Ensures all browser tool calls from the same agent session are routed
   * to the same worker (and therefore the same browser tab).
   */
  private browserSessionWorkers = new Map<string, string>();

  /**
   * Dispatch a Docker-based task to a worker with Docker support.
   * The worker will handle the full lifecycle: container creation, execution,
   * git finalization, and cleanup. Results are reported back via WebSocket
   * and forwarded to the orchestrator via Redis.
   */
  async dispatchDockerTask(opts: {
    taskId: string;
    projectId: string;
    agentId: string;
    containerConfig: Record<string, unknown>;
    taskPrompt: string;
    rolePrompt?: string;
    repoUrl: string;
  }): Promise<{ dispatched: boolean; workerId?: string; error?: string }> {
    // Find a worker with Docker available (prefers affinity for same project)
    const worker = this.pickDockerWorker(opts.projectId);
    if (!worker) {
      return { dispatched: false, error: 'No available worker with Docker support' };
    }

    this.send(worker.ws, {
      type: 'docker:task:assign',
      taskId: opts.taskId,
      projectId: opts.projectId,
      agentId: opts.agentId,
      containerConfig: opts.containerConfig,
      taskPrompt: opts.taskPrompt,
      rolePrompt: opts.rolePrompt,
      repoUrl: opts.repoUrl,
    } as any);

    worker.activeTasks += 1;
    // Track which worker has this task so we can route finalize/cleanup
    this.dockerTaskWorkers.set(opts.taskId, worker.workerId);
    // Set affinity so future containers for the same project prefer this worker
    this.projectWorkerAffinity.set(opts.projectId, worker.workerId);

    return { dispatched: true, workerId: worker.workerId };
  }

  /**
   * Pick the best worker with Docker capability.
   * If a projectId is provided, apply affinity scoring to prefer the worker
   * that already hosts containers for this project (co-location).
   */
  private pickDockerWorker(projectId?: string): ConnectedWorker | null {
    const affinityWorkerId = projectId
      ? this.projectWorkerAffinity.get(projectId)
      : undefined;

    let best: ConnectedWorker | null = null;
    let bestScore = Infinity;

    for (const worker of this.workers.values()) {
      if (!worker.authenticated || !worker.dockerAvailable || !worker.keysReceived) continue;

      let score = worker.load + worker.activeTasks * 10;

      // Strong affinity bonus: prefer the worker that already hosts this project
      if (affinityWorkerId && worker.workerId === affinityWorkerId) {
        score -= 100;
      }

      if (score < bestScore) {
        bestScore = score;
        best = worker;
      }
    }

    if (affinityWorkerId && best && best.workerId !== affinityWorkerId) {
      console.warn(
        `[hub] Project ${projectId} has affinity to worker ${affinityWorkerId}, but picked ${best.workerId} (affinity worker overloaded or unavailable)`,
      );
    }

    return best;
  }

  // -----------------------------------------------------------------------
  // Docker tool execution (dashboard-driven agent loop)
  // -----------------------------------------------------------------------

  /**
   * Execute a Docker tool on the worker that owns the specified container.
   * Routes the call via WebSocket and waits for the result.
   * Used by the DockerDispatcher to bridge agent tool calls to workers.
   */
  async executeDockerToolOnWorker(
    taskId: string,
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs = 300_000,
  ): Promise<{ success: boolean; output: string }> {
    const workerId = this.dockerTaskWorkers.get(taskId);
    if (!workerId) {
      return { success: false, output: `No worker assigned for Docker task ${taskId}.` };
    }

    const worker = this.workers.get(workerId);
    if (!worker || !worker.authenticated) {
      return { success: false, output: `Worker ${workerId} for task ${taskId} is not connected.` };
    }

    const callId = globalThis.crypto.randomUUID();

    return new Promise<{ success: boolean; output: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDockerToolCalls.delete(callId);
        resolve({
          success: false,
          output: `Docker tool "${toolName}" timed out after ${timeoutMs / 1000}s on worker ${workerId}.`,
        });
      }, timeoutMs);

      this.pendingDockerToolCalls.set(callId, {
        callId,
        workerId,
        resolve,
        reject,
        timeout,
      });

      this.send(worker.ws, {
        type: 'docker:tool:execute',
        callId,
        taskId,
        toolName,
        input,
      } as any);
    });
  }

  /**
   * Handle a docker:tool:result message from a worker.
   * Resolves the pending promise for the tool call.
   */
  private handleDockerToolResult(msg: { callId: string; success: boolean; output: string }): void {
    const pending = this.pendingDockerToolCalls.get(msg.callId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingDockerToolCalls.delete(msg.callId);
    pending.resolve({ success: msg.success, output: msg.output });
  }

  /**
   * Create a Docker container on a worker for a given project/task.
   * Returns the container and worker IDs.
   * Used by DockerDispatcher.createContainer().
   */
  async createDockerContainer(opts: {
    projectId: string;
    taskId: string;
    config: Record<string, unknown>;
    repoUrl: string;
  }): Promise<{ containerId: string; workerId: string }> {
    const worker = this.pickDockerWorker(opts.projectId);
    if (!worker) {
      throw new Error('No available worker with Docker support');
    }

    this.send(worker.ws, {
      type: 'docker:task:assign',
      taskId: opts.taskId,
      projectId: opts.projectId,
      agentId: 'swarm-docker',
      containerConfig: opts.config,
      taskPrompt: '',
      repoUrl: opts.repoUrl,
    } as any);

    worker.activeTasks += 1;
    this.dockerTaskWorkers.set(opts.taskId, worker.workerId);
    this.projectWorkerAffinity.set(opts.projectId, worker.workerId);

    return {
      containerId: `${opts.taskId}`,
      workerId: worker.workerId,
    };
  }

  /**
   * Finalize a Docker task container: commit, push, merge, cleanup.
   * Sends finalize command and waits for result via Redis.
   */
  async finalizeDockerContainer(taskId: string, commitMessage: string): Promise<void> {
    const workerId = this.dockerTaskWorkers.get(taskId);
    if (!workerId) throw new Error(`No worker assigned for task ${taskId}`);

    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not connected`);

    this.send(worker.ws, {
      type: 'docker:task:finalize',
      taskId,
      commitMessage,
    });
  }

  /**
   * Destroy a Docker task container without finalizing.
   */
  async destroyDockerContainer(taskId: string): Promise<void> {
    const workerId = this.dockerTaskWorkers.get(taskId);
    if (!workerId) return;

    const worker = this.workers.get(workerId);
    if (worker) {
      this.send(worker.ws, {
        type: 'docker:task:cancel',
        taskId,
        containerId: taskId,
      });
      worker.activeTasks = Math.max(0, worker.activeTasks - 1);
    }

    this.dockerTaskWorkers.delete(taskId);
  }

  /**
   * List all active containers for a project (across workers).
   */
  getProjectContainers(projectId: string): Array<{ taskId: string; workerId: string }> {
    const containers: Array<{ taskId: string; workerId: string }> = [];
    for (const [taskId, workerId] of this.dockerTaskWorkers) {
      containers.push({ taskId, workerId });
    }
    return containers;
  }

  /**
   * Get the project → worker affinity map (for diagnostics).
   */
  getProjectAffinity(): Map<string, string> {
    return new Map(this.projectWorkerAffinity);
  }

  /**
   * Clear affinity for a project (e.g., when all containers are cleaned up).
   */
  clearProjectAffinity(projectId: string): void {
    this.projectWorkerAffinity.delete(projectId);
  }

  /**
   * Handle Docker task completion from a worker.
   * Forwards the result to the orchestrator via Redis so the swarm agent
   * can continue with the next task.
   */
  private async handleDockerTaskComplete(
    workerId: string,
    msg: any,
  ): Promise<void> {
    const result = msg.result ?? {};

    // Clean up tracking
    this.dockerTaskWorkers.delete(msg.taskId);
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.activeTasks = Math.max(0, worker.activeTasks - 1);
    }

    console.log(`[hub] Docker task ${msg.taskId} ${result.success ? 'completed' : 'failed'} on worker ${workerId}`);

    // Forward result to the orchestrator via Redis
    await this.publishDockerResult(msg.taskId, {
      ...result,
      workerId,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private send(ws: WebSocket, msg: DashboardWsMessage): void {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: DashboardWsMessage): void {
    for (const worker of this.workers.values()) {
      if (worker.authenticated) {
        this.send(worker.ws, msg);
      }
    }
  }
}
