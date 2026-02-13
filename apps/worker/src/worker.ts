import os from 'os';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DashboardClient } from './dashboard-client.js';
import { EnvironmentTools } from '@ai-engine/agent-runtime';
import type { Tool, ToolContext } from '@ai-engine/agent-runtime';
import type { NodeCapabilities, WorkerConfig, DashboardWsMessage } from '@ai-engine/shared';

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

  /** Registered tools available for execution (browser, shell, filesystem, etc.) */
  private tools = new Map<string, Tool>();

  async start(): Promise<void> {
    console.log('[worker] Starting...');

    const config = await this.loadConfig();
    const capabilities = this.detectCapabilities(config);

    console.log(`[worker] Server: ${config.serverUrl}`);
    console.log(`[worker] OS: ${capabilities.os}, Browser: ${capabilities.browserCapable}`);

    // Register built-in environment tools (shell, filesystem, etc.)
    for (const tool of EnvironmentTools.getAll()) {
      this.tools.set(tool.name, tool);
    }
    console.log(`[worker] Registered ${this.tools.size} environment tools`);

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
      onToolExecute: (msg) => this.handleToolExecute(msg),
      onAgentCall: () => {}, // Agent calls are handled by dashboard now
      onAgentResponse: () => {},
      onConfigUpdate: (msg) => {
        console.log('[worker] Config updated:', Object.keys(msg.config).join(', '));
      },
      onUpdateAvailable: (msg) => {
        console.log(`[worker] Update available: v${msg.version} — ${msg.bundleUrl}`);
      },
    });

    const workerId = await this.client.connect();
    console.log(`[worker] Connected as ${workerId}. Ready for tool execution.`);
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
  // Tool execution (the core job of a worker)
  // -----------------------------------------------------------------------

  /**
   * Handle a tool execution request from the dashboard.
   * The dashboard's ChatExecutor dispatches worker-bound tools here.
   */
  private async handleToolExecute(
    msg: { type: 'tool:execute'; callId: string; toolName: string; input: Record<string, unknown> },
  ): Promise<void> {
    const { callId, toolName, input } = msg;
    console.log(`[worker] Tool execute: ${toolName} (call: ${callId})`);

    // Build per-call browser tools if the tool is browser-related
    let browserRelease: (() => Promise<void>) | null = null;
    if (toolName.startsWith('browser_') && this.browserPool && !this.tools.has(toolName)) {
      try {
        const { createPerTaskBrowserTools } = await import('@ai-engine/browser');
        const { tools, release } = createPerTaskBrowserTools(this.browserPool, callId);
        browserRelease = release;
        for (const t of tools) {
          this.tools.set(t.name, t);
        }
      } catch (err) {
        this.client?.sendToolResult(callId, false, `Browser tools unavailable: ${(err as Error).message}`);
        return;
      }
    }

    try {
      const tool = this.tools.get(toolName);
      if (!tool) {
        this.client?.sendToolResult(callId, false, `Unknown tool "${toolName}" — not registered on this worker.`);
        return;
      }

      const context: ToolContext = {
        nodeId: this.client?.getWorkerId() ?? 'worker',
        agentId: 'dashboard', // tool is being called by the dashboard's agent
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
    } catch (err: any) {
      this.client?.sendToolResult(callId, false, `Tool execution error: ${err.message}`);
    } finally {
      if (browserRelease) {
        try { await browserRelease(); } catch { /* ignore */ }
      }
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
