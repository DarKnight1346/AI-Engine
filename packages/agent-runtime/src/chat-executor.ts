import type { LLMPool } from '@ai-engine/llm';
import type { LLMMessage, LLMToolDefinition, LLMToolCall, LLMCallOptions } from '@ai-engine/shared';
import { ToolIndex, type ToolManifestEntry } from './tool-index.js';
import { ToolExecutor } from './tool-executor.js';
import { EnvironmentTools } from './tools/environment.js';
import { createMetaTools, getMetaToolDefinitions } from './tools/meta-tools.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatExecutorOptions {
  /** LLM pool for making API calls */
  llm: LLMPool;
  /** Agent's tool configuration (which tools are enabled) */
  toolConfig?: Record<string, boolean>;
  /** Max tool-use iterations before forcing a text response */
  maxIterations?: number;
  /** LLM tier to use */
  tier?: 'fast' | 'standard' | 'heavy';
  /** Memory search function */
  searchMemory?: (query: string, scope: string, scopeOwnerId: string | null) => Promise<string>;
  /** User context */
  userId?: string;
  teamId?: string;
}

export interface ChatExecutorResult {
  /** Final text response from the agent */
  content: string;
  /** Total tool calls executed */
  toolCallsCount: number;
  /** Total token usage */
  usage: { inputTokens: number; outputTokens: number };
  /** Number of LLM call iterations */
  iterations: number;
}

// ---------------------------------------------------------------------------
// ChatExecutor — agentic loop with meta-tool discovery
// ---------------------------------------------------------------------------

/**
 * Wraps an LLMPool with a tool execution loop powered by 3 meta-tools.
 *
 * The agent starts with only `discover_tools`, `execute_tool`, and
 * `search_memory` in context. It discovers and executes additional
 * tools on demand, keeping context usage minimal.
 *
 * Flow:
 *   1. Call LLM with messages + meta-tool definitions
 *   2. If LLM returns tool_calls → execute them
 *   3. Append tool results to messages
 *   4. Repeat until LLM returns a text-only response (or max iterations)
 */
export class ChatExecutor {
  private toolIndex: ToolIndex;
  private toolExecutor: ToolExecutor;
  private metaTools: Tool[];
  private metaToolDefs: LLMToolDefinition[];
  private maxIterations: number;

  constructor(private options: ChatExecutorOptions) {
    this.maxIterations = options.maxIterations ?? 15;

    // Initialize tool index with built-in dashboard-safe tools
    this.toolIndex = new ToolIndex();
    this.registerBuiltInTools();

    // Initialize hybrid executor with meta-tools
    this.toolExecutor = new ToolExecutor();

    // Create the 3 meta-tools (with references to index + executor)
    this.metaTools = createMetaTools({
      toolIndex: this.toolIndex,
      toolExecutor: this.toolExecutor,
      toolConfig: options.toolConfig,
      searchMemory: options.searchMemory,
      userId: options.userId,
      teamId: options.teamId,
    });

    // Register meta-tools in the executor so they can be dispatched
    this.toolExecutor.registerAllLocal(this.metaTools);

    // Register dashboard-safe built-in tools in the executor
    this.registerBuiltInExecutables();

    // LLM-compatible definitions (compact, ~240 tokens total)
    this.metaToolDefs = getMetaToolDefinitions();
  }

  /**
   * Execute an agentic chat turn.
   *
   * Takes conversation messages + system prompt, runs the tool loop,
   * and returns the final text response.
   */
  async execute(
    messages: LLMMessage[],
    systemPrompt?: string,
  ): Promise<ChatExecutorResult> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;

    // Working copy of messages for the agentic loop
    const workingMessages = [...messages];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const callOpts: LLMCallOptions = {
        tier: this.options.tier ?? 'standard',
        systemPrompt,
        tools: this.metaToolDefs,
      };

      const response = await this.options.llm.call(workingMessages, callOpts);

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // If no tool calls, we have the final response
      if (response.toolCalls.length === 0) {
        return {
          content: response.content,
          toolCallsCount,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          iterations: iteration + 1,
        };
      }

      // Append assistant message with tool calls
      workingMessages.push({
        role: 'assistant',
        content: [
          // Include any text the assistant generated alongside tool calls
          ...(response.content ? [{ type: 'text' as const, text: response.content }] : []),
          ...response.toolCalls.map((tc: LLMToolCall) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });

      // Execute each tool call
      const toolResults: Array<{ type: 'tool_result'; toolUseId: string; content: string }> = [];

      for (const toolCall of response.toolCalls) {
        toolCallsCount++;

        const metaTool = this.metaTools.find((t) => t.name === toolCall.name);
        let result: ToolResult;

        if (metaTool) {
          // Meta-tool — execute directly
          const dummyContext: ToolContext = {
            nodeId: 'dashboard',
            agentId: 'chat',
            capabilities: {
              os: process.platform as any,
              hasDisplay: false,
              browserCapable: false,
              environment: 'cloud' as any,
              customTags: [],
            },
          };
          try {
            result = await metaTool.execute(toolCall.input, dummyContext);
          } catch (err: any) {
            result = { success: false, output: `Error: ${err.message}` };
          }
        } else {
          // Unknown tool — shouldn't happen if the agent uses discover_tools first
          result = {
            success: false,
            output: `Unknown tool "${toolCall.name}". Use discover_tools to find available tools, then execute_tool to run them.`,
          };
        }

        toolResults.push({
          type: 'tool_result',
          toolUseId: toolCall.id,
          content: result.output,
        });
      }

      // Append tool results as a user message
      workingMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    // Max iterations reached — return whatever content we have
    return {
      content: 'I reached the maximum number of tool-use iterations. Here is what I found so far — please try again with a more specific request.',
      toolCallsCount,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      iterations: this.maxIterations,
    };
  }

  // ── Built-in tool registration ─────────────────────────────────────

  /**
   * Register built-in tools in the ToolIndex (for discovery).
   * These are the tools that `discover_tools` can find.
   */
  private registerBuiltInTools(): void {
    const dashboardTools: ToolManifestEntry[] = [
      {
        name: 'getDateTime',
        description: 'Get the current date, time, timezone, day of week, and Unix timestamp.',
        category: 'environment',
        inputSchema: { type: 'object', properties: { timezone: { type: 'string' } } },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'getSystemInfo',
        description: 'Get system information: OS, hostname, CPU, memory, capabilities.',
        category: 'environment',
        inputSchema: { type: 'object', properties: {} },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'wait',
        description: 'Pause execution for a specified number of seconds (max 300).',
        category: 'environment',
        inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'searchSkills',
        description: 'Search the skill library for reusable skills and capabilities.',
        category: 'skills',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearch',
        description: 'Search the web for real-time information, news, data, and research.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webGetPage',
        description: 'Fetch and read the content of a web page by URL.',
        category: 'web',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
    ];

    const workerTools: ToolManifestEntry[] = [
      {
        name: 'browser_navigate',
        description: 'Navigate a browser to a URL for interactive web automation.',
        category: 'browser',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current browser page.',
        category: 'browser',
        inputSchema: { type: 'object', properties: {} },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'browser_click',
        description: 'Click an element on the page by CSS selector or text.',
        category: 'browser',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'execShell',
        description: 'Execute a shell command on a worker node.',
        category: 'system',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'readFile',
        description: 'Read the contents of a file from the filesystem.',
        category: 'filesystem',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'writeFile',
        description: 'Write content to a file on the filesystem.',
        category: 'filesystem',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'listFiles',
        description: 'List files and directories at a given path.',
        category: 'filesystem',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        executionTarget: 'worker',
        source: 'tool',
      },
    ];

    this.toolIndex.registerAll([...dashboardTools, ...workerTools]);
  }

  /**
   * Register executable implementations for dashboard-safe tools
   * in the ToolExecutor.
   */
  private registerBuiltInExecutables(): void {
    // Environment tools — lightweight, safe to run in dashboard
    const envTools = EnvironmentTools.getAll();
    this.toolExecutor.registerAllLocal(envTools);

    // Skill search is handled by the execute_tool meta-tool (skill: prefix)
    // No additional registration needed
  }
}
