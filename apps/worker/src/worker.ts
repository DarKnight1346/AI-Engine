import os from 'os';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DashboardClient } from './dashboard-client.js';
import { LLMPool } from '@ai-engine/llm';
import { AgentRunner, EnvironmentTools } from '@ai-engine/agent-runtime';
import { MemoryService, GoalTracker, ContextBuilder, EmbeddingService } from '@ai-engine/memory';
import type { NodeCapabilities, WorkerConfig, DashboardWsMessage } from '@ai-engine/shared';

/**
 * Worker — connects to the dashboard via WebSocket and executes tasks.
 *
 * No direct database or Redis access is required. All communication
 * happens through the dashboard's WebSocket hub at /ws/worker.
 */
export class Worker {
  private client: DashboardClient | null = null;
  private running = false;
  private browserPool: any = null;

  // Agent call resolution: callId -> { resolve, reject }
  private pendingCalls = new Map<string, { resolve: (out: string) => void; reject: (err: Error) => void }>();

  // LLM + context (initialised lazily when first task arrives)
  private llmPool: LLMPool | null = null;
  private agentRunner: AgentRunner | null = null;

  async start(): Promise<void> {
    console.log('[worker] Starting...');

    const config = await this.loadConfig();
    const capabilities = this.detectCapabilities(config);

    console.log(`[worker] Server: ${config.serverUrl}`);
    console.log(`[worker] OS: ${capabilities.os}, Browser: ${capabilities.browserCapable}`);

    // Initialise browser pool if capable
    if (capabilities.browserCapable) {
      try {
        const { BrowserPool } = await import('@ai-engine/browser');
        this.browserPool = new BrowserPool();
        await this.browserPool.initialize();
        console.log('[worker] Browser pool initialised');
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
      onAgentCall: (msg) => this.handleIncomingAgentCall(msg),
      onAgentResponse: (msg) => this.handleAgentResponse(msg),
      onConfigUpdate: (msg) => {
        console.log('[worker] Config updated:', Object.keys(msg.config).join(', '));
      },
      onUpdateAvailable: (msg) => {
        console.log(`[worker] Update available: v${msg.version} — ${msg.bundleUrl}`);
        // TODO: auto-update flow
      },
    });

    const workerId = await this.client.connect();
    console.log(`[worker] Connected as ${workerId}. Ready for tasks.`);
    this.running = true;
  }

  async shutdown(): Promise<void> {
    console.log('[worker] Shutting down...');
    this.running = false;

    if (this.browserPool) {
      try { await this.browserPool.shutdown(); } catch { /* ignore */ }
    }

    this.client?.disconnect();
    console.log('[worker] Shutdown complete');
    process.exit(0);
  }

  // -----------------------------------------------------------------------
  // Task execution (received from dashboard)
  // -----------------------------------------------------------------------

  private async handleTaskAssign(
    msg: Extract<DashboardWsMessage, { type: 'task:assign' }>,
  ): Promise<void> {
    console.log(`[worker] Task assigned: ${msg.taskId} (agent: ${msg.agentId})`);
    const startTime = Date.now();

    try {
      // Lazily initialise LLM and agent runner
      await this.ensureRuntime();

      // Build per-task browser tools
      let browserRelease: (() => Promise<void>) | null = null;
      let taskBrowserTools: any[] = [];

      if (this.browserPool) {
        try {
          const { createPerTaskBrowserTools } = await import('@ai-engine/browser');
          const { tools, release } = createPerTaskBrowserTools(this.browserPool, msg.taskId);
          browserRelease = release;
          taskBrowserTools = tools;
        } catch (err) {
          console.warn(`[worker] Browser tools init failed for ${msg.taskId}:`, err);
        }
      }

      try {
        const result = await this.agentRunner!.run({
          agent: {
            id: msg.agentId,
            name: (msg.agentConfig as any).name ?? 'Agent',
            rolePrompt: (msg.agentConfig as any).rolePrompt ?? 'You are a helpful AI assistant.',
            toolConfig: (msg.agentConfig as any).toolConfig ?? { enabledTools: [], disabledTools: [], customToolConfigs: {} },
            requiredCapabilities: null,
            workflowStageIds: [],
          },
          taskDetails: msg.input,
          workItemId: msg.taskId,
          additionalTools: taskBrowserTools,
        });

        const durationMs = Date.now() - startTime;
        const totalTokens = (result.tokensUsed?.input ?? 0) + (result.tokensUsed?.output ?? 0);
        this.client?.sendTaskComplete(
          msg.taskId,
          result.output ?? '',
          totalTokens,
          durationMs,
        );
      } finally {
        if (browserRelease) {
          try { await browserRelease(); } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      console.error(`[worker] Task ${msg.taskId} failed:`, err.message);
      this.client?.sendTaskFailed(msg.taskId, err.message);
    }
  }

  // -----------------------------------------------------------------------
  // Agent-to-agent calls
  // -----------------------------------------------------------------------

  /**
   * Called when ANOTHER agent (on any worker) wants to call an agent that
   * should run on THIS worker. We execute the agent and send the response.
   */
  private async handleIncomingAgentCall(
    msg: Extract<DashboardWsMessage, { type: 'agent:call' }>,
  ): Promise<void> {
    console.log(`[worker] Incoming agent call: ${msg.callId} from ${msg.fromAgentId}`);

    try {
      await this.ensureRuntime();

      const result = await this.agentRunner!.run({
        agent: {
          id: msg.fromAgentId + '-target',
          name: (msg.agentConfig as any).name ?? 'Agent',
          rolePrompt: (msg.agentConfig as any).rolePrompt ?? 'You are a helpful AI assistant.',
          toolConfig: (msg.agentConfig as any).toolConfig ?? { enabledTools: [], disabledTools: [], customToolConfigs: {} },
          requiredCapabilities: null,
          workflowStageIds: [],
        },
        taskDetails: msg.input,
      });

      this.client?.sendAgentResponse(msg.callId, result.output ?? '');
    } catch (err: any) {
      this.client?.sendAgentResponse(msg.callId, '', err.message);
    }
  }

  /**
   * Called when we receive a response to an agent call WE initiated.
   */
  private handleAgentResponse(
    msg: Extract<DashboardWsMessage, { type: 'agent:response' }>,
  ): void {
    const pending = this.pendingCalls.get(msg.callId);
    if (pending) {
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.output);
      }
      this.pendingCalls.delete(msg.callId);
    }
  }

  /**
   * Call another agent (from within a running agent's tool).
   * Routes through the dashboard hub, which dispatches to the appropriate worker.
   */
  async callAgent(fromAgentId: string, targetAgentId: string, input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const callId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error('Agent call timed out after 5 minutes'));
      }, 5 * 60 * 1000);

      this.pendingCalls.set(callId, {
        resolve: (out) => { clearTimeout(timeout); resolve(out); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      this.client?.sendAgentCall(callId, fromAgentId, targetAgentId, input);
    });
  }

  // -----------------------------------------------------------------------
  // Runtime initialisation
  // -----------------------------------------------------------------------

  private async ensureRuntime(): Promise<void> {
    if (this.agentRunner) return;

    // LLM pool starts empty — keys are provided per-task from dashboard config,
    // or loaded from the config the dashboard sends on auth.
    this.llmPool = new LLMPool({ keys: [] });

    const embeddingService = new EmbeddingService();
    const memoryService = new MemoryService(embeddingService);
    const goalTracker = new GoalTracker();
    const contextBuilder = new ContextBuilder(memoryService, goalTracker);

    this.agentRunner = new AgentRunner(this.llmPool, contextBuilder, {
      nodeId: this.client?.getWorkerId() ?? 'unknown',
      capabilities: {
        os: os.platform() as any,
        hasDisplay: os.platform() === 'darwin',
        browserCapable: !!this.browserPool,
        environment: 'local',
        customTags: [],
      },
    });

    this.agentRunner.getToolRegistry().registerAll(EnvironmentTools.getAll());
    console.log('[worker] Agent runtime initialised');
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
      browserCapable: platform === 'darwin',
      environment: config.environment,
      customTags: config.customTags,
    };
  }
}
