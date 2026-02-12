import os from 'os';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ClusterManager } from '@ai-engine/cluster';
import { LLMPool } from '@ai-engine/llm';
import { MemoryService, GoalTracker, ContextBuilder, EmbeddingService } from '@ai-engine/memory';
import { TaskRouter } from '@ai-engine/workflow-engine';
import { AgentRunner, EnvironmentTools } from '@ai-engine/agent-runtime';
import { Scheduler } from '@ai-engine/scheduler';
import { WebSearchService, PageFetcher } from '@ai-engine/web-search';
import { SkillService, SkillSearchTool } from '@ai-engine/skills';
import { VaultService, VaultCrypto } from '@ai-engine/vault';
import { FileRegistry, FileTransfer } from '@ai-engine/file-sync';
import type { NodeCapabilities, WorkerConfig } from '@ai-engine/shared';

export class Worker {
  private cluster: ClusterManager | null = null;
  private scheduler: Scheduler | null = null;
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    console.log('[worker] Starting...');

    // Load worker config
    const config = await this.loadConfig();
    const capabilities = this.detectCapabilities(config);

    console.log(`[worker] ID: ${config.workerId}`);
    console.log(`[worker] OS: ${capabilities.os}, Browser: ${capabilities.browserCapable}, Environment: ${capabilities.environment}`);

    // Initialize cluster
    this.cluster = new ClusterManager({
      redisUrl: config.redisUrl,
      workerId: config.workerId,
      capabilities,
    });
    await this.cluster.start();

    const redis = this.cluster.getRedis();

    // Initialize services
    const embeddingService = new EmbeddingService();
    const memoryService = new MemoryService(embeddingService);
    const goalTracker = new GoalTracker();
    const contextBuilder = new ContextBuilder(memoryService, goalTracker);

    // Initialize LLM pool (keys loaded from DB)
    const llmPool = new LLMPool({ keys: [] }); // Keys loaded dynamically

    // Initialize task consumer
    const taskRouter = new TaskRouter(redis);
    const agentRunner = new AgentRunner(llmPool, contextBuilder, {
      nodeId: config.workerId,
      capabilities,
    }, redis);

    // Register environment tools
    agentRunner.getToolRegistry().registerAll(EnvironmentTools.getAll());

    // Initialize web search
    const webSearch = new WebSearchService(redis);
    const pageFetcher = new PageFetcher(redis);

    // Initialize skills
    const skillService = new SkillService(embeddingService);
    const skillSearchTool = new SkillSearchTool(skillService);

    // Initialize vault
    const vaultCrypto = new VaultCrypto();
    const vaultService = new VaultService(vaultCrypto);

    // Initialize file sync
    const fileRegistry = new FileRegistry(config.workerId);
    const fileTransfer = new FileTransfer(redis, config.workerId, join(os.homedir(), '.ai-engine', 'cache'));
    fileTransfer.listenForRequests();

    // Initialize scheduler (only on leader)
    this.scheduler = new Scheduler(config.workerId, redis);

    // Listen for config updates
    this.cluster.onConfigUpdate((scope, version) => {
      console.log(`[worker] Config updated: ${scope} v${version}`);
    });

    // Conditionally initialize browser
    if (capabilities.browserCapable) {
      try {
        const { BrowserPool, BrowserTools, createBrowserToolDefinitions } = await import('@ai-engine/browser');
        const browserPool = new BrowserPool();
        await browserPool.initialize();
        const browserTools = new BrowserTools(browserPool);
        const browserToolDefs = createBrowserToolDefinitions(browserTools);
        for (const tool of browserToolDefs) {
          agentRunner.getToolRegistry().register({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (input) => tool.execute(input),
          });
        }
        console.log('[worker] Browser tools initialized');
      } catch (err) {
        console.warn('[worker] Browser initialization failed:', err);
      }
    }

    // Start task polling
    this.running = true;
    this.pollInterval = setInterval(async () => {
      // Start/stop scheduler based on leadership
      if (this.cluster?.isLeader() && this.scheduler) {
        this.scheduler.start();
      }

      // Poll for tasks
      try {
        const task = await taskRouter.dequeue(capabilities, config.workerId);
        if (task) {
          console.log(`[worker] Picked up task: ${task.workItemId}`);
          // Execute task in background
          this.executeTask(agentRunner, task).catch((err) => {
            console.error('[worker] Task execution failed:', err);
          });
        }
      } catch (err) {
        console.error('[worker] Task poll error:', err);
      }
    }, 2000);

    console.log('[worker] Ready and listening for tasks');
  }

  async shutdown(): Promise<void> {
    console.log('[worker] Shutting down...');
    this.running = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.scheduler?.stop();
    await this.cluster?.stop();
    console.log('[worker] Shutdown complete');
    process.exit(0);
  }

  private async executeTask(runner: AgentRunner, task: any): Promise<void> {
    const { getDb } = await import('@ai-engine/db');
    const db = getDb();

    // Get agent definition
    const agent = task.agentId ? await db.agent.findUnique({ where: { id: task.agentId } }) : null;

    const result = await runner.run({
      agent: agent ? {
        id: agent.id,
        name: agent.name,
        rolePrompt: agent.rolePrompt,
        toolConfig: agent.toolConfig as any,
        requiredCapabilities: agent.requiredCapabilities as any,
        workflowStageIds: agent.workflowStageIds as any,
      } : {
        id: 'default',
        name: 'Default Agent',
        rolePrompt: 'You are a helpful AI assistant.',
        toolConfig: { enabledTools: [], disabledTools: [], customToolConfigs: {} },
        requiredCapabilities: null,
        workflowStageIds: [],
      },
      taskDetails: JSON.stringify(task.data),
      workItemId: task.workItemId,
    });

    // Update work item status
    if (task.workItemId) {
      await db.workItem.update({
        where: { id: task.workItemId },
        data: { status: result.success ? 'completed' : 'failed' },
      });
    }

    console.log(`[worker] Task ${task.workItemId} completed: ${result.success ? 'success' : 'failed'}`);
  }

  private async loadConfig(): Promise<WorkerConfig> {
    const configPath = join(os.homedir(), '.ai-engine', 'worker.json');
    try {
      const data = await readFile(configPath, 'utf8');
      return JSON.parse(data);
    } catch {
      // Dev mode - use env vars
      return {
        workerId: process.env.WORKER_ID ?? crypto.randomUUID(),
        workerSecret: process.env.WORKER_SECRET ?? '',
        serverUrl: process.env.SERVER_URL ?? 'http://localhost:3000',
        postgresUrl: process.env.DATABASE_URL ?? '',
        redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
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
