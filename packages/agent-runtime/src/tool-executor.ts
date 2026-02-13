import type { Tool, ToolContext, ToolResult } from './types.js';
import type { ToolManifestEntry } from './tool-index.js';

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
  ): Promise<{ success: boolean; output: string }>;
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

      // Browser tools require macOS workers with display capability
      const isBrowserTool = toolName.startsWith('browser_');
      const requiredCaps = isBrowserTool
        ? { browserCapable: true, os: 'darwin' }
        : undefined;

      return await this.workerDispatcher.executeToolOnWorker(
        toolName,
        input,
        requiredCaps,
      );
    }

    return {
      success: false,
      output: `Unknown tool "${toolName}". Use discover_tools to find available tools.`,
    };
  }
}
