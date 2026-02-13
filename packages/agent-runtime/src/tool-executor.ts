import type { Tool, ToolContext, ToolResult } from './types.js';
import type { ToolManifestEntry } from './tool-index.js';

// ---------------------------------------------------------------------------
// Hybrid ToolExecutor — routes execution to dashboard or worker
// ---------------------------------------------------------------------------

/** Tools safe to run inline in the dashboard process */
const DASHBOARD_SAFE_TOOLS = new Set([
  // Meta-tools
  'discover_tools',
  'execute_tool',
  'search_memory',
  // Environment
  'getDateTime',
  'getSystemInfo',
  'getTaskContext',
  'wait',
  // Skills
  'searchSkills',
  'loadSkill',
  // Web (HTTP-based, no persistent state)
  'webSearch',
  'webSearchNews',
  'webGetPage',
  'webGetPageStructured',
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
  return 'unknown';
}

/**
 * ToolExecutor manages a set of locally-executable tools and routes
 * worker-bound tools to the task queue.
 */
export class ToolExecutor {
  /** Locally registered executable tools (dashboard-safe) */
  private localTools: Map<string, Tool> = new Map();

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
      // TODO: Dispatch to worker via Redis task queue and await result.
      // For now, return a helpful message that the tool requires a worker.
      return {
        success: false,
        output: `Tool "${toolName}" requires a worker node for execution. Worker dispatch is not yet connected in chat mode. This tool works when tasks are assigned via the Boards/Workflows system.`,
      };
    }

    return {
      success: false,
      output: `Unknown tool "${toolName}". Use discover_tools to find available tools.`,
    };
  }
}
