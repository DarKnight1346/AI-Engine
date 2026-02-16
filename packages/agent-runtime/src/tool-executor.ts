import type { Tool, ToolContext, ToolResult } from './types.js';
import type { ToolManifestEntry } from './tool-index.js';
import type { NodeCapabilities } from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Hybrid ToolExecutor — routes execution to dashboard or worker
//
// Dashboard-safe tools run inline in the dashboard process.
// Worker tools are dispatched to a connected worker node via WebSocket
// using the WorkerHub singleton.
// ---------------------------------------------------------------------------

/** Tools safe to run inline in the dashboard process */
const DASHBOARD_SAFE_TOOLS = new Set([
  // Meta-tools
  'discover_tools',
  'execute_tool',
  'search_memory',
  'create_skill',
  // Environment
  'getDateTime',
  'getSystemInfo',
  'getTaskContext',
  'wait',
  // Skills
  'searchSkills',
  'loadSkill',
  // Web — Tier 1: Serper.dev (fast/cheap, HTTP-based)
  'webSearch',
  'webSearchImages',
  'webSearchVideos',
  'webSearchPlaces',
  'webSearchMaps',
  'webSearchReviews',
  'webSearchNews',
  'webSearchShopping',
  'webSearchLens',
  'webSearchScholar',
  'webSearchPatents',
  'webAutocomplete',
  'webGetPage',
  // Web — Tier 2: xAI / Grok (comprehensive, AI-powered)
  'webDeepSearch',
  'webDeepSearchWithContext',
  // Notifications
  'sendNotification',
  // CAPTCHA solving (CapSolver — HTTP API, dashboard-safe)
  'solveCaptcha',
  'solveImageCaptcha',
  'getCaptchaBalance',
  // Worker management (run on dashboard, query WorkerHub)
  'listWorkers',
  'getWorkerStatus',
  'disconnectWorker',
]);

/** Tools that must be dispatched to a worker node */
const WORKER_TOOLS = new Set([
  // Browser automation
  'browser_navigate', 'browser_goBack', 'browser_getUrl',
  'browser_getPageContent', 'browser_getAccessibilityTree', 'browser_screenshot',
  'browser_click', 'browser_type', 'browser_fill', 'browser_hover', 'browser_scroll',
  'browser_selectOption', 'browser_uploadFile', 'browser_evaluate',
  'browser_getConsoleLogs', 'browser_getNetworkRequests', 'browser_getOpenTabs',
  'browser_newTab', 'browser_getCookies', 'browser_waitForSelector',
  'browser_pressKey', 'browser_close',
  // File operations
  'readFile', 'writeFile', 'listFiles',
  // Shell
  'execShell',
  // Docker (chat/agent mode — container + image management)
  'dockerRun', 'dockerExecChat', 'dockerStop', 'dockerRemove',
  'dockerLogs', 'dockerPs', 'dockerImages', 'dockerPull',
  'dockerSystemPrune',
]);

export type ToolExecutionRoute = 'dashboard' | 'worker' | 'unknown';

/**
 * Determine where a tool should execute.
 */
export function routeTool(toolName: string): ToolExecutionRoute {
  if (DASHBOARD_SAFE_TOOLS.has(toolName)) return 'dashboard';
  if (WORKER_TOOLS.has(toolName)) return 'worker';
  // Wildcard pattern: anything starting with browser_ goes to worker
  if (toolName.startsWith('browser_')) return 'worker';
  // Tier 3: DataForSEO tools (prefix convention avoids listing ~125 tools individually)
  if (toolName.startsWith('seo')) return 'dashboard';
  // xAI media generation tools (images + video)
  if (toolName.startsWith('xaiGenerate')) return 'dashboard';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Worker info type (returned by getConnectedWorkers / getWorkerDetails)
// ---------------------------------------------------------------------------

export interface WorkerInfo {
  workerId: string;
  hostname: string;
  capabilities: NodeCapabilities | null;
  load: number;
  activeTasks: number;
  connectedAt: string;
  lastHeartbeat: string;
  dockerAvailable: boolean;
  keysReceived: boolean;
}

/**
 * Interface for the WorkerHub's tool dispatch capability.
 * Defined here to avoid circular dependency on the dashboard package.
 */
export interface WorkerToolDispatcher {
  executeToolOnWorker(
    toolName: string,
    input: Record<string, unknown>,
    requiredCapabilities?: Record<string, unknown>,
    timeoutMs?: number,
    browserSessionId?: string,
  ): Promise<{ success: boolean; output: string }>;

  /**
   * Execute a tool on a specific worker identified by its ID.
   * Unlike executeToolOnWorker, this does NOT auto-pick — it targets
   * the exact worker. Returns an error if the worker is not connected.
   */
  executeToolOnSpecificWorker(
    workerId: string,
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ success: boolean; output: string }>;

  /**
   * Release a browser session on the worker that owns it.
   * Called when an agent finishes execution to free the browser tab.
   */
  releaseBrowserSession(browserSessionId: string): void;

  /**
   * Release a Docker session — clean up all containers created during
   * a chat/agent session. Called when the ChatExecutor finishes.
   */
  releaseDockerSession(dockerSessionId: string): void;

  /**
   * Get a list of all connected and authenticated workers.
   */
  getConnectedWorkers(): WorkerInfo[];

  /**
   * Get detailed status information for a specific worker.
   * Returns null if the worker is not connected.
   */
  getWorkerDetails(workerId: string): WorkerInfo | null;

  /**
   * Disconnect a worker by its ID, closing its WebSocket connection.
   * Returns true if the worker was found and disconnected.
   */
  disconnectWorkerNode(workerId: string): boolean;
}

/**
 * ToolExecutor manages a set of locally-executable tools and routes
 * worker-bound tools to a connected worker node via WebSocket.
 */
export class ToolExecutor {
  /** Locally registered executable tools (dashboard-safe) */
  private localTools: Map<string, Tool> = new Map();

  /** Worker dispatch function — set by the dashboard at startup */
  private workerDispatcher: WorkerToolDispatcher | null = null;

  /** Register a tool for local (dashboard-side) execution */
  registerLocal(tool: Tool): void {
    this.localTools.set(tool.name, tool);
  }

  /** Register multiple local tools */
  registerAllLocal(tools: Tool[]): void {
    for (const t of tools) this.registerLocal(t);
  }

  /** Check if a tool can be executed locally */
  hasLocal(name: string): boolean {
    return this.localTools.has(name);
  }

  /** Get a local tool by name */
  getLocal(name: string): Tool | undefined {
    return this.localTools.get(name);
  }

  /**
   * Set the worker dispatcher — called once at startup by the dashboard
   * to connect the ToolExecutor to the WorkerHub.
   */
  setWorkerDispatcher(dispatcher: WorkerToolDispatcher): void {
    this.workerDispatcher = dispatcher;
  }

  /**
   * Execute a tool, routing to local execution or worker dispatch.
   *
   * Worker tools support an optional `workerId` parameter in their input.
   * When provided, the tool is dispatched to that specific worker instead
   * of auto-selecting the least-loaded one. The `workerId` is stripped
   * from the input before being sent to the worker.
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const route = routeTool(toolName);

    if (route === 'dashboard' || this.localTools.has(toolName)) {
      const tool = this.localTools.get(toolName);
      if (!tool) {
        return {
          success: false,
          output: `Tool "${toolName}" is registered as dashboard-safe but has no implementation. It may not be available yet.`,
        };
      }
      try {
        return await tool.execute(input, context);
      } catch (err: any) {
        return {
          success: false,
          output: `Error executing "${toolName}": ${err.message}`,
        };
      }
    }

    if (route === 'worker') {
      // Dispatch to a connected worker via WebSocket
      if (!this.workerDispatcher) {
        return {
          success: false,
          output: `Tool "${toolName}" requires a worker node, but no worker dispatch is configured. Ensure at least one worker is connected.`,
        };
      }

      // Extract optional workerId from input (agent can target a specific worker)
      const { workerId: targetWorkerId, ...cleanInput } = input as { workerId?: string } & Record<string, unknown>;

      // If a specific worker is targeted, route directly to it
      if (targetWorkerId && typeof targetWorkerId === 'string') {
        return await this.workerDispatcher.executeToolOnSpecificWorker(
          targetWorkerId,
          toolName,
          cleanInput,
        );
      }

      // Browser tools require workers with browser capability.
      // Session ID ensures all browser calls from the same agent use the
      // same browser tab on the same worker (session affinity).
      const isBrowserTool = toolName.startsWith('browser_');
      const isDockerTool = toolName.startsWith('docker') && !toolName.startsWith('docker_');
      const requiredCaps = isBrowserTool
        ? { browserCapable: true }
        : undefined;

      // Pass session ID for browser tools (tab affinity) and Docker tools
      // (container cleanup tracking).  Both use the same session lifecycle.
      const sessionId = (isBrowserTool || isDockerTool)
        ? context.browserSessionId ?? context.workItemId ?? context.agentId
        : undefined;

      return await this.workerDispatcher.executeToolOnWorker(
        toolName,
        cleanInput,
        requiredCaps,
        undefined,
        sessionId,
      );
    }

    return {
      success: false,
      output: `Unknown tool "${toolName}". Use discover_tools to find available tools.`,
    };
  }

  /**
   * Release a browser session on the worker that owns it.
   * Should be called when an agent/chat session finishes to ensure the
   * browser tab is closed and the slot is freed for other agents.
   */
  releaseBrowserSession(browserSessionId: string): void {
    this.workerDispatcher?.releaseBrowserSession(browserSessionId);
  }

  /**
   * Release a Docker session — clean up all containers created during
   * a chat/agent session. Should be called when the agent finishes.
   */
  releaseDockerSession(dockerSessionId: string): void {
    this.workerDispatcher?.releaseDockerSession(dockerSessionId);
  }
}
