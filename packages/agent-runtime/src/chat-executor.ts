import type { LLMPool, LLMStreamCallback } from '@ai-engine/llm';
import type { LLMMessage, LLMToolDefinition, LLMToolCall, LLMCallOptions } from '@ai-engine/shared';
import { ToolIndex, type ToolManifestEntry } from './tool-index.js';
import { ToolExecutor, type WorkerToolDispatcher } from './tool-executor.js';
import { EnvironmentTools } from './tools/environment.js';
import { createMetaTools, getMetaToolDefinitions, type MetaToolOptions } from './tools/meta-tools.js';
import { createWebSearchTools, createXaiSearchTools } from './tools/web-search-tools.js';
import { createDataForSeoTools, getDataForSeoManifest, getDataForSeoToolCount } from './tools/dataforseo-tools.js';
import { createImageTools, getImageToolManifest } from './tools/image-tools.js';
import { createWorkerManagementTools } from './tools/worker-management-tools.js';
import { createScheduleTools, getScheduleToolManifest, type ScheduleToolsDeps } from './tools/schedule-tools.js';
import { createCaptchaTools, getCaptchaToolManifest } from './tools/captcha-tools.js';
import { WebSearchService, XaiSearchService, DataForSeoService, XaiImageService } from '@ai-engine/web-search';
import { EmbeddingService } from '@ai-engine/memory';
import type { Tool, ToolContext, ToolResult } from './types.js';

// ---------------------------------------------------------------------------
// XML tool-call fallback parser
//
// Some LLM providers (OpenAI-compatible proxies, etc.) don't reliably
// return structured tool_use blocks. Claude may fall back to emitting
// XML-formatted tool calls as plain text:
//
//   <invoke name="execute_tool">
//   <parameter name="tool">seoKeywordVolume</parameter>
//   <parameter name="input">{"keywords":["foo"]}</parameter>
//   </invoke>
//
// This parser extracts those from the response text and converts them
// into proper LLMToolCall objects so the agentic loop can execute them.
// ---------------------------------------------------------------------------

interface ParsedXmlToolCall {
  name: string;
  input: Record<string, unknown>;
}

function parseXmlToolCalls(text: string): ParsedXmlToolCall[] {
  const results: ParsedXmlToolCall[] = [];
  // Match <invoke name="...">...</invoke> blocks (non-greedy)
  const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  let match;

  while ((match = invokeRegex.exec(text)) !== null) {
    const toolName = match[1];
    const body = match[2];

    // Extract <parameter name="...">value</parameter> pairs
    const params: Record<string, string> = {};
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      params[paramMatch[1]] = paramMatch[2].trim();
    }

    // For meta-tools like execute_tool, the 'input' parameter is JSON
    let input: Record<string, unknown> = {};
    if (params.input) {
      try {
        input = JSON.parse(params.input);
      } catch {
        input = { raw: params.input };
      }
    }

    // Build the final input: if the tool is execute_tool, wrap properly
    if (toolName === 'execute_tool') {
      results.push({
        name: 'execute_tool',
        input: {
          tool: params.tool ?? '',
          input,
        },
      });
    } else {
      // Generic tool — all params become the input
      const genericInput: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(params)) {
        try { genericInput[key] = JSON.parse(val); } catch { genericInput[key] = val; }
      }
      results.push({ name: toolName, input: genericInput });
    }
  }

  return results;
}

/** Strip XML tool call blocks from text content so it isn't shown to the user */
function stripXmlToolCalls(text: string): string {
  return text.replace(/<invoke\s+name="[^"]+">[\s\S]*?<\/invoke>/g, '').trim();
}

/**
 * Count how many times the last element of `history` repeats consecutively
 * from the tail.  e.g. ['a','b','b','b'] → 3
 */
function countTrailingRepeats(history: string[]): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1];
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] === last) count++;
    else break;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Long-running tools — executed in the background so the user can continue
// chatting. The agent gets a placeholder result and can respond immediately.
// ---------------------------------------------------------------------------

const LONG_RUNNING_TOOLS = new Set([
  'xaiGenerateVideo',
  // Future: add other slow tools here (e.g. heavy data analysis, bulk scraping)
]);

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
   * Serper.dev API key for Tier 1 (lightweight) web search tools.
   * When provided, all Serper-powered search tools are registered.
   */
  serperApiKey?: string;
  /**
   * xAI API key for Tier 2 (comprehensive) web search tools.
   * When provided, AI-powered deep search tools via Grok are registered.
   */
  xaiApiKey?: string;
  /**
   * DataForSEO login for Tier 3 (heavy/expensive) deep research tools.
   * Requires both login and password. When provided, ~122 SEO research
   * tools are registered (SERP, keywords, backlinks, content, etc.).
   */
  dataForSeoLogin?: string;
  /**
   * DataForSEO password (paired with dataForSeoLogin).
   */
  dataForSeoPassword?: string;
  /**
   * CapSolver API key for CAPTCHA solving.
   * When provided, agents can solve reCAPTCHA v2/v3, hCaptcha, Turnstile,
   * FunCaptcha, and image-based CAPTCHAs during browser automation.
   * Get an API key from capsolver.com.
   */
  capsolverApiKey?: string;
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

  /**
   * Shared EmbeddingService instance. When provided, reused for tool
   * index semantic search instead of creating a new one per executor.
   * Critical for multi-agent: without sharing, each sub-agent loads
   * its own copy of the embedding model, quickly exhausting memory.
   */
  sharedEmbeddingService?: any;

  /**
   * Callback for handling long-running tool executions in the background.
   *
   * When the agent calls a tool that's known to take >10 seconds (e.g.
   * video generation), the executor returns a placeholder result to the
   * LLM so it can respond immediately, while the actual tool runs in
   * the background. The caller is responsible for starting the execution
   * and storing the result.
   *
   * @param info.taskId  — Unique background task identifier
   * @param info.toolName — The inner tool being executed (e.g. "xaiGenerateVideo")
   * @param info.execute — Function that performs the actual tool execution
   */
  backgroundTaskCallback?: (info: {
    taskId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    execute: () => Promise<ToolResult>;
  }) => void;

  // ── Orchestration / sub-agent support ────────────────────────────

  /**
   * Schedule tools dependency injection. When provided, the agent can
   * create, list, update, and delete scheduled tasks.
   */
  scheduleDeps?: ScheduleToolsDeps;

  /**
   * Parent executor options — passed through so that the delegate_tasks
   * meta-tool can create sub-agent ChatExecutors with the same config.
   * When set, the `delegate_tasks` tool becomes available.
   */
  parentExecutorOptions?: ChatExecutorOptions;

  /**
   * Callback for emitting orchestration streaming events (report outline,
   * section updates, subtask completions) back through the SSE stream.
   */
  onSubtaskEvent?: (event: ChatStreamEvent) => void;

  /**
   * Callback for sending clarification questions to the user and receiving
   * answers. When set, the `ask_user` tool becomes available.
   */
  onClarificationRequest?: (
    questions: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }>; allowFreeText?: boolean }>,
    resolve: (answers: Record<string, string>) => void,
  ) => void;
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
  | { type: 'agent_start'; slot?: string; agentName: string }
  | { type: 'tool_call_start'; name: string; id: string }
  | { type: 'tool_call_end'; name: string; id: string; success: boolean; output: string }
  | { type: 'iteration'; iteration: number; maxIterations: number }
  | { type: 'background_task_start'; taskId: string; toolName: string }
  | { type: 'done'; result: ChatExecutorResult }
  | { type: 'error'; message: string }
  // ── Orchestration / sub-agent events ──
  | { type: 'clarification_request'; questions: Array<{ id: string; prompt: string; options?: Array<{ id: string; label: string }>; allowFreeText?: boolean }> }
  | { type: 'report_outline'; title: string; sections: Array<{ id: string; title: string; tier: string; dependsOn?: string[] }> }
  | { type: 'report_section_update'; sectionId: string; status: 'running' | 'complete' | 'failed'; content?: string; tier?: string }
  | { type: 'report_section_stream'; sectionId: string; text: string }
  | { type: 'report_section_added'; section: { id: string; title: string; content: string } }
  | { type: 'subtask_complete'; taskId: string; success: boolean; completed: number; total: number; tier: string };

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
  private currentTier: 'fast' | 'standard' | 'heavy';

  /**
   * Unique identifier for the browser session tied to this executor.
   * All browser tool calls from this executor share the same browser tab
   * on the same worker node. Auto-generated from sessionId/workItemId/agentId.
   */
  private readonly browserSessionId: string;

  /**
   * Dynamically switch the LLM tier used for subsequent calls.
   * Called by meta-tools (ask_user, delegate_tasks) to upgrade to Opus
   * for planning/orchestration, then drop back to Sonnet afterward.
   */
  public setTier(tier: 'fast' | 'standard' | 'heavy'): void {
    console.log(`[ChatExecutor] Tier switch: ${this.currentTier} → ${tier}`);
    this.currentTier = tier;
  }

  public getTier(): 'fast' | 'standard' | 'heavy' {
    return this.currentTier;
  }

  /**
   * Release resources held by this executor (browser sessions, etc.).
   * MUST be called when the chat session / agent execution finishes to
   * ensure browser tabs are closed and pool slots are freed.
   */
  public cleanup(): void {
    this.toolExecutor.releaseBrowserSession(this.browserSessionId);
  }

  /** Get the browser session ID tied to this executor. */
  public getBrowserSessionId(): string {
    return this.browserSessionId;
  }

  constructor(private options: ChatExecutorOptions) {
    this.maxIterations = options.maxIterations ?? 100;
    this.currentTier = options.tier ?? 'standard';
    this.browserSessionId = options.sessionId ?? options.workItemId ?? `browser_${crypto.randomUUID()}`;

    // Initialize tool index with built-in dashboard-safe tools
    this.toolIndex = new ToolIndex();

    // Reuse a shared EmbeddingService when provided (critical for sub-agents
    // to avoid loading the embedding model N times and exhausting memory).
    // Falls back to creating a new instance for top-level executors.
    const embeddingService = options.sharedEmbeddingService ?? new EmbeddingService();
    // Store on options so sub-agents created from parentExecutorOptions inherit it
    if (!options.sharedEmbeddingService) {
      (options as any).sharedEmbeddingService = embeddingService;
    }
    this.toolIndex.setEmbeddingProvider(embeddingService as any);

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
      // Pass-through for orchestration support
      parentExecutorOptions: options.parentExecutorOptions,
      onSubtaskEvent: options.onSubtaskEvent,
      onClarificationRequest: options.onClarificationRequest,
      setParentTier: (tier) => this.setTier(tier),
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

    // LLM-compatible definitions — include orchestration/clarification tools
    // when the corresponding options are provided
    this.metaToolDefs = getMetaToolDefinitions({
      includeOrchestration: !!options.parentExecutorOptions,
      includeClarification: !!options.onClarificationRequest,
    });
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

    // Track consecutive calls to the same tool to detect loops
    const toolCallHistory: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const callOpts: LLMCallOptions = {
        tier: this.currentTier,
        systemPrompt,
        tools: this.metaToolDefs,
      };

      const response = await this.options.llm.call(workingMessages, callOpts);

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // ── XML tool-call fallback ──
      // If the LLM returned no structured tool calls but the text contains
      // XML <invoke> blocks, parse them and treat them as tool calls.
      let effectiveToolCalls = response.toolCalls;
      let effectiveContent = response.content;

      if (effectiveToolCalls.length === 0 && response.content) {
        const xmlCalls = parseXmlToolCalls(response.content);
        if (xmlCalls.length > 0) {
          effectiveToolCalls = xmlCalls.map((xc, i) => ({
            id: `xml_${Date.now()}_${i}`,
            name: xc.name,
            input: xc.input,
          }));
          effectiveContent = stripXmlToolCalls(response.content);
          console.log(`[ChatExecutor] Recovered ${xmlCalls.length} tool call(s) from XML text fallback`);
        }
      }

      // If no tool calls (even after XML fallback), we have the final response
      if (effectiveToolCalls.length === 0) {
        return {
          content: effectiveContent,
          toolCallsCount,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          iterations: iteration + 1,
        };
      }

      // ── Repeated tool-call loop detection ──
      // If the model calls the same tool 3+ times in a row, it's stuck in a
      // loop.  Inject a hint and strip tools to force a text response.
      const currentToolSig = effectiveToolCalls.map((tc) => tc.name).sort().join(',');
      toolCallHistory.push(currentToolSig);
      const repeatedCount = countTrailingRepeats(toolCallHistory);
      if (repeatedCount >= 3) {
        console.warn(
          `[ChatExecutor] Loop detected: "${currentToolSig}" called ${repeatedCount}x in a row. ` +
          `Forcing text response.`
        );
        workingMessages.push({
          role: 'user',
          content: [{ type: 'text' as const, text:
            `IMPORTANT: You have already called "${currentToolSig}" ${repeatedCount} times and received results each time. ` +
            `You MUST now use the information you already have to respond to the user. ` +
            `Do NOT call any more tools. Respond directly with a helpful answer based on the results you have.`
          }],
        });
        // Make one more LLM call WITHOUT tools to force a text response
        const forcedResponse = await this.options.llm.call(
          workingMessages,
          { tier: this.currentTier, systemPrompt },
        );
        totalInputTokens += forcedResponse.usage.inputTokens;
        totalOutputTokens += forcedResponse.usage.outputTokens;
        return {
          content: forcedResponse.content || effectiveContent || 'I was unable to generate a response.',
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
          ...(effectiveContent ? [{ type: 'text' as const, text: effectiveContent }] : []),
          ...effectiveToolCalls.map((tc: LLMToolCall) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });

      // Execute each tool call
      const toolResults: Array<{ type: 'tool_result'; toolUseId: string; content: string }> = [];

      for (const toolCall of effectiveToolCalls) {
        toolCallsCount++;

        const metaTool = this.metaTools.find((t) => t.name === toolCall.name);
        let result: ToolResult;

        if (metaTool) {
          // Meta-tool — execute directly
          const dummyContext: ToolContext = {
            nodeId: this.options.nodeId ?? 'dashboard',
            agentId: this.options.agentId ?? 'chat',
            workItemId: this.options.workItemId,
            browserSessionId: this.browserSessionId,
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

    // Max iterations reached — return best-effort response with partial findings
    const lastToolResults = workingMessages
      .filter(m => m.role === 'user' && Array.isArray(m.content))
      .slice(-1);
    const partialFindings = lastToolResults.length > 0
      ? '\n\nPartial findings from the last tool results are included in the conversation above.'
      : '';

    return {
      content: `I reached the maximum number of tool-use iterations (${this.maxIterations}). Here is what I found so far — the task may need to be broken into smaller pieces or tried with a more specific request.${partialFindings}`,
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

    // Track consecutive calls to the same tool to detect loops
    const toolCallHistory: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      onEvent({ type: 'iteration', iteration, maxIterations: this.maxIterations });

      const callOpts: LLMCallOptions = {
        tier: this.currentTier,
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

      // ── XML tool-call fallback (streaming) ──
      let effectiveToolCalls = response.toolCalls;
      let effectiveContent = response.content;

      if (effectiveToolCalls.length === 0 && response.content) {
        const xmlCalls = parseXmlToolCalls(response.content);
        if (xmlCalls.length > 0) {
          effectiveToolCalls = xmlCalls.map((xc, i) => ({
            id: `xml_${Date.now()}_${i}`,
            name: xc.name,
            input: xc.input,
          }));
          effectiveContent = stripXmlToolCalls(response.content);
          console.log(`[ChatExecutor] Recovered ${xmlCalls.length} tool call(s) from XML text fallback (streaming)`);
        }
      }

      // If no tool calls, we have the final response
      if (effectiveToolCalls.length === 0) {
        const result: ChatExecutorResult = {
          content: effectiveContent,
          toolCallsCount,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          iterations: iteration + 1,
        };
        onEvent({ type: 'done', result });
        return result;
      }

      // The LLM wants to use tools — stop streaming text, start tool execution
      onEvent({ type: 'status', message: `Using ${effectiveToolCalls.length} tool(s)...` });

      // ── Repeated tool-call loop detection (streaming) ──
      const currentToolSig = effectiveToolCalls.map((tc) => tc.name).sort().join(',');
      toolCallHistory.push(currentToolSig);
      const repeatedCount = countTrailingRepeats(toolCallHistory);
      if (repeatedCount >= 3) {
        console.warn(
          `[ChatExecutor] Loop detected (streaming): "${currentToolSig}" called ${repeatedCount}x in a row. ` +
          `Forcing text response.`
        );
        onEvent({ type: 'status', message: 'Breaking out of tool loop...' });
        workingMessages.push({
          role: 'user',
          content: [{ type: 'text' as const, text:
            `IMPORTANT: You have already called "${currentToolSig}" ${repeatedCount} times and received results each time. ` +
            `You MUST now use the information you already have to respond to the user. ` +
            `Do NOT call any more tools. Respond directly with a helpful answer based on the results you have.`
          }],
        });
        // Make one more LLM call WITHOUT tools to force a text response
        const forcedResponse = await this.options.llm.callStreaming(
          workingMessages,
          { tier: this.currentTier, systemPrompt },
          (llmEvent) => {
            if (llmEvent.type === 'token') {
              onEvent({ type: 'token', text: llmEvent.text });
            }
          },
        );
        totalInputTokens += forcedResponse.usage.inputTokens;
        totalOutputTokens += forcedResponse.usage.outputTokens;
        const loopResult: ChatExecutorResult = {
          content: forcedResponse.content || effectiveContent || 'I was unable to generate a response.',
          toolCallsCount,
          usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          iterations: iteration + 1,
        };
        onEvent({ type: 'done', result: loopResult });
        return loopResult;
      }

      // Append assistant message with tool calls
      workingMessages.push({
        role: 'assistant',
        content: [
          ...(effectiveContent ? [{ type: 'text' as const, text: effectiveContent }] : []),
          ...effectiveToolCalls.map((tc: LLMToolCall) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });

      // Execute each tool call
      const toolResults: Array<{ type: 'tool_result'; toolUseId: string; content: string }> = [];

      for (const toolCall of effectiveToolCalls) {
        toolCallsCount++;
        onEvent({ type: 'tool_call_start', name: toolCall.name, id: toolCall.id });

        // ── Background task detection ──
        // If this is an execute_tool call for a long-running tool and we
        // have a background task callback, start it in the background and
        // return a placeholder result so the LLM can respond immediately.
        if (
          toolCall.name === 'execute_tool' &&
          this.options.backgroundTaskCallback &&
          typeof toolCall.input === 'object' &&
          toolCall.input !== null
        ) {
          const innerToolName = String((toolCall.input as Record<string, unknown>).tool ?? '');
          if (LONG_RUNNING_TOOLS.has(innerToolName)) {
            const taskId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const metaTool = this.metaTools.find((t) => t.name === 'execute_tool');
            const dummyContext: ToolContext = {
              nodeId: this.options.nodeId ?? 'dashboard',
              agentId: this.options.agentId ?? 'chat',
              workItemId: this.options.workItemId,
              browserSessionId: this.browserSessionId,
              capabilities: {
                os: process.platform as any,
                hasDisplay: false,
                browserCapable: false,
                environment: 'cloud' as any,
                customTags: [],
              },
            };

            // Notify frontend
            onEvent({ type: 'background_task_start', taskId, toolName: innerToolName });

            // Start execution in background (fire-and-forget via callback)
            this.options.backgroundTaskCallback({
              taskId,
              toolName: innerToolName,
              toolInput: (toolCall.input as Record<string, unknown>).input as Record<string, unknown> ?? {},
              execute: async () => {
                if (!metaTool) return { success: false, output: 'Tool not available' };
                return metaTool.execute(toolCall.input, dummyContext);
              },
            });

            // Return placeholder to the LLM
            const placeholderResult = `Background task started (ID: ${taskId}). The "${innerToolName}" tool is now processing in the background and will take 30 seconds to a few minutes. The result will be automatically delivered to the user when it's ready. Let the user know you're working on it and they can continue chatting in the meantime.`;

            onEvent({
              type: 'tool_call_end',
              name: toolCall.name,
              id: toolCall.id,
              success: true,
              output: `Background task started: ${innerToolName} (${taskId})`,
            });

            toolResults.push({
              type: 'tool_result',
              toolUseId: toolCall.id,
              content: placeholderResult,
            });
            continue;
          }
        }

        const metaTool = this.metaTools.find((t) => t.name === toolCall.name);
        let result: ToolResult;

        if (metaTool) {
          const dummyContext: ToolContext = {
            nodeId: this.options.nodeId ?? 'dashboard',
            agentId: this.options.agentId ?? 'chat',
            workItemId: this.options.workItemId,
            browserSessionId: this.browserSessionId,
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

    // Max iterations reached — return best-effort response with partial findings
    const maxResult: ChatExecutorResult = {
      content: `I reached the maximum number of tool-use iterations (${this.maxIterations}). Here is what I found so far — the task may need to be broken into smaller pieces or tried with a more specific request.`,
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
      // ── Tier 1: Serper.dev Web Search Tools (fast/cheap) ──
      {
        name: 'webSearch',
        description: '[Tier 1] Quick Google web search. Returns raw results with titles, links, and snippets. Use FIRST for any search.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchImages',
        description: '[Tier 1] Quick Google image search. Returns image URLs, dimensions, and sources.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchVideos',
        description: '[Tier 1] Quick Google video search. Returns video links, titles, durations, and channels.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchPlaces',
        description: '[Tier 1] Quick Google Places search. Returns names, addresses, ratings, and contact info.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchMaps',
        description: '[Tier 1] Quick Google Maps search. Returns locations with coordinates and details.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchReviews',
        description: '[Tier 1] Quick Google Reviews search. Returns review ratings, sources, and snippets.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchNews',
        description: '[Tier 1] Quick Google News search. Returns news titles, dates, and sources.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchShopping',
        description: '[Tier 1] Quick Google Shopping search. Returns products, prices, and ratings.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchLens',
        description: '[Tier 1] Google Lens reverse image search. Find similar images by URL.',
        category: 'web',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchScholar',
        description: '[Tier 1] Quick Google Scholar search. Returns academic papers and citations.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webSearchPatents',
        description: '[Tier 1] Quick Google Patents search. Returns patents with inventors and dates.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webAutocomplete',
        description: '[Tier 1] Google autocomplete suggestions for discovering related searches.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webGetPage',
        description: '[Tier 1] Fetch and extract the content of a web page by URL. Returns title and text/markdown.',
        category: 'web',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      // ── Tier 2: xAI / Grok Deep Search ──
      {
        name: 'webDeepSearch',
        description: '[Tier 2] AI-powered deep web search via xAI Grok. Searches the web and synthesizes a comprehensive answer with citations. Use when Tier 1 results are insufficient.',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, allowedDomains: { type: 'array' }, excludedDomains: { type: 'array' } }, required: ['query'] },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'webDeepSearchWithContext',
        description: '[Tier 2] AI-powered contextual deep search. Same as webDeepSearch but with a research context (technical, academic, business, medical, legal, news, comparison, tutorial).',
        category: 'web',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, context: { type: 'string' } }, required: ['query', 'context'] },
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
      // ── Worker Management (run on dashboard, query WorkerHub) ──
      {
        name: 'listWorkers',
        description:
          'List all connected worker nodes with their status, capabilities, load, active tasks, Docker/browser support, and uptime. ' +
          'Use this to discover available workers before targeting a specific one with workerId.',
        category: 'workers',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Filter: "all" (default), "idle", "busy", "docker", or "browser".',
            },
          },
        },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'getWorkerStatus',
        description:
          'Get detailed status for a specific worker node including capabilities, load, Docker status, SSH keys, and connection info. ' +
          'Provide workerId (UUID) or hostname.',
        category: 'workers',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string', description: 'Worker UUID.' },
            hostname: { type: 'string', description: 'Worker hostname (fallback if no workerId).' },
          },
        },
        executionTarget: 'dashboard',
        source: 'tool',
      },
      {
        name: 'disconnectWorker',
        description:
          'Disconnect a worker node by ID, closing its WebSocket connection. The worker will attempt to reconnect automatically.',
        category: 'workers',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string', description: 'Worker UUID to disconnect.' },
            reason: { type: 'string', description: 'Optional reason for disconnecting.' },
          },
          required: ['workerId'],
        },
        executionTarget: 'dashboard',
        source: 'tool',
      },
    ];

    // Worker tool schemas include an optional `workerId` so the agent can target a specific worker.
    // When omitted, the system auto-selects the least-loaded compatible worker.
    const workerIdProperty = {
      workerId: {
        type: 'string',
        description: 'Optional: target a specific worker by UUID. Use listWorkers to find worker IDs. If omitted, auto-selects the best available worker.',
      },
    };

    const workerTools: ToolManifestEntry[] = [
      {
        name: 'browser_navigate',
        description: 'Navigate a browser to a URL for interactive web automation.',
        category: 'browser',
        inputSchema: { type: 'object', properties: { url: { type: 'string' }, ...workerIdProperty }, required: ['url'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the current browser page.',
        category: 'browser',
        inputSchema: { type: 'object', properties: { ...workerIdProperty } },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'browser_click',
        description: 'Click an element on the page by CSS selector or text.',
        category: 'browser',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' }, ...workerIdProperty }, required: ['selector'] },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'execShell',
        description:
          'Execute a shell command on a worker node. Optionally specify workerId to target a specific worker, ' +
          'or omit to auto-select the best available worker. Use listWorkers to see available workers.',
        category: 'system',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string', description: 'The shell command to execute.' }, ...workerIdProperty },
          required: ['command'],
        },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'readFile',
        description:
          'Read the contents of a file from a worker node filesystem. Optionally specify workerId to target a specific worker.',
        category: 'filesystem',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute file path to read.' }, ...workerIdProperty },
          required: ['path'],
        },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'writeFile',
        description:
          'Write content to a file on a worker node filesystem. Optionally specify workerId to target a specific worker.',
        category: 'filesystem',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute file path to write.' },
            content: { type: 'string', description: 'File content to write.' },
            ...workerIdProperty,
          },
          required: ['path', 'content'],
        },
        executionTarget: 'worker',
        source: 'tool',
      },
      {
        name: 'listFiles',
        description:
          'List files and directories at a given path on a worker node. Optionally specify workerId to target a specific worker.',
        category: 'filesystem',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Directory path to list.' }, ...workerIdProperty },
          required: ['path'],
        },
        executionTarget: 'worker',
        source: 'tool',
      },
    ];

    // ── Tier 3: DataForSEO deep research tools (~122 endpoints) ──
    const dataForSeoTools = getDataForSeoManifest();

    // ── Image generation tools ──
    const imageGenTools = getImageToolManifest();

    // ── Scheduling tools (only available to Chat Agents with scheduleDeps) ──
    const scheduleManifest = this.options.scheduleDeps ? getScheduleToolManifest() : [];

    // ── CAPTCHA solving tools ──
    const captchaManifest = getCaptchaToolManifest();

    this.toolIndex.registerAll([...dashboardTools, ...workerTools, ...dataForSeoTools, ...imageGenTools, ...scheduleManifest, ...captchaManifest]);
  }

  /**
   * Register executable implementations for dashboard-safe tools
   * in the ToolExecutor.
   */
  private registerBuiltInExecutables(): void {
    // Environment tools — lightweight, safe to run in dashboard
    const envTools = EnvironmentTools.getAll();
    this.toolExecutor.registerAllLocal(envTools);

    // Worker management tools — query/control connected worker nodes
    if (this.options.workerDispatcher) {
      const workerMgmtTools = createWorkerManagementTools(this.options.workerDispatcher);
      this.toolExecutor.registerAllLocal(workerMgmtTools);
    }

    // Tier 1: Serper.dev web search tools — fast, cheap, structured results
    if (this.options.serperApiKey) {
      try {
        const searchService = new WebSearchService();
        searchService.setApiKey(this.options.serperApiKey);
        const searchTools = createWebSearchTools(searchService);
        this.toolExecutor.registerAllLocal(searchTools);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize Serper web search tools:', err.message);
      }
    }

    // Tier 2: xAI / Grok web search tools — comprehensive, AI-powered
    if (this.options.xaiApiKey) {
      try {
        const xaiService = new XaiSearchService();
        xaiService.setApiKey(this.options.xaiApiKey);
        const xaiTools = createXaiSearchTools(xaiService);
        this.toolExecutor.registerAllLocal(xaiTools);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize xAI web search tools:', err.message);
      }
    }

    // Image generation: xAI Grok Imagine (uses same API key as Tier 2)
    if (this.options.xaiApiKey) {
      try {
        const imgService = new XaiImageService();
        imgService.setApiKey(this.options.xaiApiKey);
        const imgTools = createImageTools(imgService);
        this.toolExecutor.registerAllLocal(imgTools);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize image generation tools:', err.message);
      }
    }

    // Tier 3: DataForSEO deep research tools — heavy, expensive, comprehensive
    if (this.options.dataForSeoLogin && this.options.dataForSeoPassword) {
      try {
        const dfsService = new DataForSeoService();
        dfsService.setCredentials(this.options.dataForSeoLogin, this.options.dataForSeoPassword);
        const dfsTools = createDataForSeoTools(dfsService);
        this.toolExecutor.registerAllLocal(dfsTools);
        console.log(`[ChatExecutor] Registered ${dfsTools.length} DataForSEO Tier 3 tools`);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize DataForSEO tools:', err.message);
      }
    }

    // CAPTCHA solving: CapSolver.com integration
    if (this.options.capsolverApiKey) {
      try {
        const captchaTools = createCaptchaTools(this.options.capsolverApiKey);
        this.toolExecutor.registerAllLocal(captchaTools);
      } catch (err: any) {
        console.warn('[ChatExecutor] Failed to initialize CAPTCHA tools:', err.message);
      }
    }

    // Scheduling tools — agent can create/manage scheduled tasks
    if (this.options.scheduleDeps) {
      const schedTools = createScheduleTools(this.options.scheduleDeps);
      this.toolExecutor.registerAllLocal(schedTools);
    }

    // Skill search is handled by the execute_tool meta-tool (skill: prefix)
    // No additional registration needed
  }
}
