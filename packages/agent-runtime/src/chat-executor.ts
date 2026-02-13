import type { LLMPool, LLMStreamCallback } from '@ai-engine/llm';
import type { LLMMessage, LLMToolDefinition, LLMToolCall, LLMCallOptions } from '@ai-engine/shared';
import { ToolIndex, type ToolManifestEntry } from './tool-index.js';
import { ToolExecutor, type WorkerToolDispatcher } from './tool-executor.js';
import { EnvironmentTools } from './tools/environment.js';
import { createMetaTools, getMetaToolDefinitions } from './tools/meta-tools.js';
import { createWebSearchTools } from './tools/web-search-tools.js';
import { WebSearchService } from '@ai-engine/web-search';
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
  /** Chat session ID (for goal source tracking) */
  sessionId?: string;

  // ── Worker-compatible context ──────────────────────────────────────
  /** Node identifier (defaults to 'dashboard') */
  nodeId?: string;
  /** Agent identifier for tool context (defaults to 'chat') */
  agentId?: string;
  /** Work item ID for execution logging */
  workItemId?: string;
  /**
   * Serper.dev API key for web search tools.
   * When provided, all Serper-powered search tools are registered.
   */
  serperApiKey?: string;
  /**
   * Per-execution tools (e.g. browser tools scoped to a task).
   * These are registered for both discovery and execution alongside
   * the built-in tools, ensuring workers have the same capabilities.
   */
  additionalTools?: Tool[];
  /**
   * Worker dispatcher for routing tool calls to connected worker nodes.
   * When set, worker-bound tools (browser, shell, filesystem) are sent
   * to a worker via WebSocket instead of failing with "no worker".
   */
  workerDispatcher?: WorkerToolDispatcher;
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

/** Events emitted during streaming execution of the chat agent. */
export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'status'; message: string }
  | { type: 'tool_call_start'; name: string; id: string }
  | { type: 'tool_call_end'; name: string; id: string; success: boolean; output: string }
  | { type: 'iteration'; iteration: number; maxIterations: number }
  | { type: 'done'; result: ChatExecutorResult }
  | { type: 'error'; message: string };

/** Callback for receiving streaming events during chat execution. */
export type ChatStreamCallback = (event: ChatStreamEvent) => void;

// ---------------------------------------------------------------------------
// ChatExecutor — agentic loop with meta-tool discovery
// ---------------------------------------------------------------------------

/**
 * Wraps an LLMPool with a tool execution loop powered by 6 meta-tools.
 *
 * The agent starts with `discover_tools`, `execute_tool`, `search_memory`,
 * `store_memory`, `create_skill`, and `get_current_time` in context. It
 * discovers and executes additional tools on demand, keeping context minimal.
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

    // Connect worker dispatcher if provided (routes tool calls to workers via WebSocket)
    if (options.workerDispatcher) {
      this.toolExecutor.setWorkerDispatcher(options.workerDispatcher);
    }

    // Create the meta-tools (with references to index + executor)
    this.metaTools = createMetaTools({
      toolIndex: this.toolIndex,
      toolExecutor: this.toolExecutor,
      toolConfig: options.toolConfig,
      searchMemory: options.searchMemory,
      userId: options.userId,
      teamId: options.teamId,
      sessionId: options.sessionId,
    });

    // Register meta-tools in the executor so they can be dispatched
    this.toolExecutor.registerAllLocal(this.metaTools);

    // Register dashboard-safe built-in tools in the executor
    this.registerBuiltInExecutables();

    // Register per-execution additional tools (e.g. browser tools on workers)
    if (options.additionalTools && options.additionalTools.length > 0) {
      const additionalManifest: ToolManifestEntry[] = options.additionalTools.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.name.startsWith('browser_') ? 'browser' : 'system',
        inputSchema: t.inputSchema,
        executionTarget: 'dashboard' as const, // execute locally on this node
        source: 'tool' as const,
      }));
      this.toolIndex.registerAll(additionalManifest);
      this.toolExecutor.registerAllLocal(options.additionalTools);
    }

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
            nodeId: this.options.nodeId ?? 'dashboard',
            agentId: this.options.agentId ?? 'chat',
            workItemId: this.options.workItemId,
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

  /**
   * Streaming variant of `execute()`. Emits `ChatStreamEvent`s via the
   * callback as tokens arrive and tools are called, enabling real-time UI
   * updates while the agentic loop runs.
   *
   * The final `done` event carries the same `ChatExecutorResult` as `execute()`.
   */
  async executeStreaming(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    onEvent: ChatStreamCallback,
  ): Promise<ChatExecutorResult> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;

    const workingMessages = [...messages];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      onEvent({ type: 'iteration', iteration, maxIterations: this.maxIterations });

      const callOpts: LLMCallOptions = {
        tier: this.options.tier ?? 'standard',
        systemPrompt,
        tools: this.metaToolDefs,
      };

      // Use streaming LLM call — emit tokens as they arrive
      const response = await this.options.llm.callStreaming(
        workingMessages,
        callOpts,
        (llmEvent) => {
          if (llmEvent.type === 'token') {
            onEvent({ type: 'token', text: llmEvent.text });
          }
          // tool_use_start is informational during streaming
          if (llmEvent.type === 'tool_use_start') {
            onEvent({ type: 'status', message: `Calling ${llmEvent.name}...` });
          }
        },
      );

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // If no tool calls, we have the final response
      if (response.toolCalls.length === 0) {
        const result: ChatExecutorResult = {
          content: response.content,
          toolCallsCount,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          iterations: iteration + 1,
        };
        onEvent({ type: 'done', result });
        return result;
      }

      // The LLM wants to use tools — stop streaming text, start tool execution
      onEvent({ type: 'status', message: `Using ${response.toolCalls.length} tool(s)...` });

      // Append assistant message with tool calls
      workingMessages.push({
        role: 'assistant',
        content: [
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
        onEvent({ type: 'tool_call_start', name: toolCall.name, id: toolCall.id });

        const metaTool = this.metaTools.find((t) => t.name === toolCall.name);
        let result: ToolResult;

        if (metaTool) {
          const dummyContext: ToolContext = {
            nodeId: this.options.nodeId ?? 'dashboard',
            agentId: this.options.agentId ?? 'chat',
            workItemId: this.options.workItemId,
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
          result = {
            success: false,
            output: `Unknown tool "${toolCall.name}". Use discover_tools to find available tools, then execute_tool to run them.`,
          };
        }

        onEvent({ type: 'tool_call_end', name: toolCall.name, id: toolCall.id, success: result.success, output: result.output });

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

      // Emit status for next iteration
      onEvent({ type: 'status', message: 'Processing results...' });
    }

    // Max iterations reached
    const maxResult: ChatExecutorResult = {
      content: 'I reached the maximum number of tool-use iterations. Here is what I found so far — please try again with a more specific request.',
      toolCallsCount,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      iterations: this.maxIterations,
    };
    onEvent({ type: 'done', result: maxResult });
    return maxResult;
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
      // ── Serper.dev Web Search Tools ──
      {
        name: 'webSearch',
        description: 'Search the web using Google via Serper. Returns organic results with titles, links, and snippets.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchImages',
        description: 'Search for images on Google. Returns image URLs, dimensions, and sources.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchVideos',
        description: 'Search for videos on Google. Returns video links, titles, durations, and channels.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchPlaces',
        description: 'Search for local businesses and places. Returns names, addresses, ratings, and contact info.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchMaps',
        description: 'Search Google Maps for locations and points of interest with coordinates and details.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchReviews',
        description: 'Search for reviews on Google. Returns review ratings, sources, and snippets.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchNews',
        description: 'Search Google News for current events and recent articles with dates and sources.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchShopping',
        description: 'Search Google Shopping for products and prices with ratings and delivery info.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchLens',
        description: 'Reverse image search using Google Lens. Find visually similar images by URL.',
        category: 'web',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchScholar',
        description: 'Search Google Scholar for academic papers, citations, and research publications.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchPatents',
        description: 'Search Google Patents for patents and patent applications with inventor and filing info.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webAutocomplete',
        description: 'Get Google autocomplete suggestions for a query to discover related searches.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webGetPage',
        description: 'Fetch and extract the content of a web page by URL. Returns title and text/markdown.',
        category: 'web',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'createSkill',
        description: 'Create a new reusable skill — capture a workflow, technique, or procedure for future reuse by any agent.',
        category: 'skills',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            instructions: { type: 'string' },
            codeSnippet: { type: 'string' },
          },
          required: ['name', 'description', 'category', 'instructions'],
        },
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

    // Serper.dev web search tools — register when API key is available
    if (this.options.serperApiKey) {
      try {
        const searchService = new WebSearchService();
        searchService.setApiKey(this.options.serperApiKey);
        const searchTools = createWebSearchTools(searchService);
        this.toolExecutor.registerAllLocal(searchTools);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize web search tools:', err.message);
      }
    }

    // Skill search is handled by the execute_tool meta-tool (skill: prefix)
    // No additional registration needed
  }
}
