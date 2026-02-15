import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { MemoryService, EmbeddingService, ProjectMemoryService } from '@ai-engine/memory';
import { createPlanningTools, createPrdTools, createTaskTools, createWireframeTools, getPlanningModeSystemPrompt, createWebSearchTools, createXaiSearchTools } from '@ai-engine/agent-runtime';
import type { SerperServiceLike, XaiServiceLike } from '@ai-engine/agent-runtime';
import type { LLMMessage, LLMToolDefinition, LLMMessageContent } from '@ai-engine/shared';
import { getAuthFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Initialize services (in production, these would be singletons)
const embeddingService = new EmbeddingService();
const memoryService = new MemoryService(embeddingService);
const projectMemoryService = new ProjectMemoryService(memoryService, embeddingService);

/** Create an LLMPool from active API keys in the database. */
async function createLLMPool() {
  const { LLMPool } = await import('@ai-engine/llm');
  const db = getDb();

  const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
  if (apiKeys.length === 0) {
    throw new Error('No API keys configured. Please add API keys in Settings > API Keys.');
  }

  // Check for NVIDIA fallback key
  let nvidiaFallback: { provider: 'nvidia'; apiKey: string } | undefined;
  try {
    const nvidiaConfig = await db.config.findUnique({ where: { key: 'nvidiaApiKey' } });
    if (nvidiaConfig?.valueJson && typeof nvidiaConfig.valueJson === 'string' && nvidiaConfig.valueJson.trim()) {
      nvidiaFallback = { provider: 'nvidia', apiKey: nvidiaConfig.valueJson.trim() };
    }
  } catch { /* Config not found */ }

  return new LLMPool({
    keys: apiKeys.map((k: any) => {
      const stats = k.usageStats as any;
      return {
        id: k.id,
        apiKey: k.keyEncrypted,
        keyType: (stats?.keyType as 'api-key' | 'bearer' | undefined) ?? 'api-key',
        provider: (stats?.provider as 'anthropic' | 'openai-compatible' | undefined) ?? 'anthropic',
        baseUrl: stats?.baseUrl as string | undefined,
      };
    }),
    strategy: 'round-robin',
    fallback: nvidiaFallback,
  });
}

/**
 * Load search API keys from config and create Tier 1 + Tier 2 search tools.
 * Returns the tools as { defs, map } ready to merge into the planning agent's tool set.
 */
async function loadSearchTools(): Promise<{
  defs: LLMToolDefinition[];
  map: Array<[string, (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>]>;
}> {
  const defs: LLMToolDefinition[] = [];
  const mapEntries: Array<[string, (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>]> = [];

  const db = getDb();
  let serperApiKey: string | undefined;
  let xaiApiKey: string | undefined;

  try {
    const [serperConfig, xaiConfig] = await Promise.all([
      db.config.findUnique({ where: { key: 'serperApiKey' } }),
      db.config.findUnique({ where: { key: 'xaiApiKey' } }),
    ]);
    if (serperConfig?.valueJson && typeof serperConfig.valueJson === 'string' && serperConfig.valueJson.trim()) {
      serperApiKey = serperConfig.valueJson.trim();
    }
    if (xaiConfig?.valueJson && typeof xaiConfig.valueJson === 'string' && xaiConfig.valueJson.trim()) {
      xaiApiKey = xaiConfig.valueJson.trim();
    }
  } catch { /* Config not found */ }

  // Tier 1: Serper.dev web search
  if (serperApiKey) {
    try {
      const { WebSearchService } = await import('@ai-engine/web-search');
      const searchService = new WebSearchService();
      searchService.setApiKey(serperApiKey);
      // Only include the most useful planning search tools (not images/videos/shopping/etc.)
      const allSerperTools = createWebSearchTools(searchService as unknown as SerperServiceLike);
      const planningSearchNames = new Set(['webSearch', 'webSearchNews', 'webGetPage']);
      for (const tool of allSerperTools) {
        if (planningSearchNames.has(tool.name)) {
          defs.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
          mapEntries.push([tool.name, (input: Record<string, unknown>) => tool.execute(input, {} as any)]);
        }
      }
    } catch (err: any) {
      console.warn('[Planning] Failed to init Serper search tools:', err.message);
    }
  }

  // Tier 2: xAI / Grok deep search
  if (xaiApiKey) {
    try {
      const { XaiSearchService } = await import('@ai-engine/web-search');
      const xaiService = new XaiSearchService();
      xaiService.setApiKey(xaiApiKey);
      const xaiTools = createXaiSearchTools(xaiService as unknown as XaiServiceLike);
      for (const tool of xaiTools) {
        defs.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
        mapEntries.push([tool.name, (input: Record<string, unknown>) => tool.execute(input, {} as any)]);
      }
    } catch (err: any) {
      console.warn('[Planning] Failed to init xAI search tools:', err.message);
    }
  }

  // ── Fallback webGetPage (always available) ──
  // If Serper didn't provide webGetPage (no API key), create a fallback that
  // uses PageFetcher (plain fetch + JSDOM/Readability) — no API key required.
  const hasWebGetPage = defs.some((d) => d.name === 'webGetPage');
  if (!hasWebGetPage) {
    try {
      const { PageFetcher } = await import('@ai-engine/web-search');
      const pageFetcher = new PageFetcher();

      const webGetPageDef: LLMToolDefinition = {
        name: 'webGetPage',
        description:
          '[Tier 1 — free/fast] Fetch and extract content from a web page by URL. ' +
          'Returns the page title and readable text. Use to read articles, documentation, ' +
          'blog posts, or any web page after finding it via webSearch.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL of the web page to fetch' },
          },
          required: ['url'],
        },
      };

      defs.push(webGetPageDef);
      mapEntries.push(['webGetPage', async (input: Record<string, unknown>) => {
        try {
          const url = input.url as string;
          if (!url) return { success: false, output: 'URL is required.' };

          const page = await pageFetcher.getPage(url);
          const content = page.content;
          const maxLen = 15000;
          const truncated = content.length > maxLen
            ? content.slice(0, maxLen) + `\n\n... [content truncated, page was ${content.length} chars] ...`
            : content;

          return {
            success: true,
            output: `# ${page.title}\n\nSource: ${page.url}\n\n${truncated}`,
          };
        } catch (err: any) {
          return { success: false, output: `Failed to fetch page: ${err.message}` };
        }
      }]);
    } catch (err: any) {
      console.warn('[Planning] Failed to init fallback webGetPage:', err.message);
    }
  }

  return { defs, map: mapEntries };
}

/** Structured question the agent wants to ask the user. */
interface PlanningQuestion {
  id: string;
  prompt: string;
  options?: Array<{ id: string; label: string }>;
  allowFreeText?: boolean;
}

/** Result of the planning agent loop. */
interface PlanningLoopResult {
  content: string;
  toolCallsCount: number;
  usage: { inputTokens: number; outputTokens: number };
  /** If the agent called ask_user, these are the questions for the frontend. */
  questions?: PlanningQuestion[];
}

/** The ask_user tool definition exposed to the LLM. */
const ASK_USER_TOOL_DEF: LLMToolDefinition = {
  name: 'ask_user',
  description:
    'Ask the user structured clarifying questions during planning. ' +
    'Each question can have pre-defined options (rendered as clickable buttons the user can tap) ' +
    'and/or allow free-text input. Use this when you need specific information from the user — ' +
    'for example: target platform, preferred tech stack, authentication approach, must-have features, etc. ' +
    'Ask 1-5 focused questions at a time. Always provide helpful options when possible.',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Array of questions to present to the user.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique question ID (e.g. "q1").' },
            prompt: { type: 'string', description: 'The question text shown to the user.' },
            options: {
              type: 'array',
              description: 'Pre-defined answer options rendered as clickable buttons.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Option ID.' },
                  label: { type: 'string', description: 'Display text for the option button.' },
                },
                required: ['id', 'label'],
              },
            },
            allowFreeText: {
              type: 'boolean',
              description: 'If true, show a text input alongside the option buttons so the user can type a custom answer. Defaults to false.',
            },
          },
          required: ['id', 'prompt'],
        },
      },
    },
    required: ['questions'],
  },
};

/**
 * Run a lightweight agentic loop for the planning agent.
 *
 * Sends messages + planning tools to the LLM, executes any tool calls the
 * model makes (store_requirement, recall_project_context, etc.), and
 * returns the final text response once the model stops requesting tools.
 *
 * If the agent calls `ask_user`, the loop breaks early and returns the
 * questions so the frontend can render them as clickable suggestion chips.
 */
async function runPlanningAgentLoop(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLMPool is dynamically imported
  llm: any,
  messages: LLMMessage[],
  systemPrompt: string,
  toolDefs: LLMToolDefinition[],
  toolMap: Map<string, (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>>,
  maxIterations = 10,
): Promise<PlanningLoopResult> {
  const workingMessages = [...messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCallsCount = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await llm.call(workingMessages, {
      tier: 'standard' as const,
      systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    });

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;

    // No tool calls → final response
    if (response.toolCalls.length === 0) {
      return {
        content: response.content,
        toolCallsCount,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      };
    }

    // ── Check for ask_user calls ──
    // If the agent wants to ask the user something, we break out of the loop
    // and return the questions to the frontend (instead of blocking).
    const askUserCall = response.toolCalls.find((tc: any) => tc.name === 'ask_user');
    if (askUserCall) {
      const rawQuestions = (askUserCall.input as any)?.questions;
      const questions: PlanningQuestion[] = Array.isArray(rawQuestions)
        ? rawQuestions.map((q: any) => ({
            id: String(q.id ?? `q_${Math.random().toString(36).slice(2, 8)}`),
            prompt: String(q.prompt ?? ''),
            options: Array.isArray(q.options)
              ? q.options.map((o: any) => ({ id: String(o.id ?? ''), label: String(o.label ?? '') }))
              : undefined,
            allowFreeText: q.allowFreeText === true,
          }))
        : [];

      // Use the text content the agent produced alongside the ask_user call
      const textContent = response.content || '';

      return {
        content: textContent,
        toolCallsCount,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        questions: questions.length > 0 ? questions : undefined,
      };
    }

    // Append assistant message with tool calls
    const assistantContent: LLMMessageContent[] = [];
    if (response.content) {
      assistantContent.push({ type: 'text', text: response.content });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    workingMessages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool call (excluding ask_user which is handled above)
    const toolResults: LLMMessageContent[] = [];
    for (const tc of response.toolCalls) {
      toolCallsCount++;
      const executor = toolMap.get(tc.name);
      let output: string;
      if (executor) {
        try {
          const result = await executor(tc.input);
          output = result.output;
        } catch (err: any) {
          output = `Error executing ${tc.name}: ${err.message}`;
        }
      } else {
        output = `Unknown tool "${tc.name}". Available tools: ${Array.from(toolMap.keys()).join(', ')}`;
      }
      toolResults.push({ type: 'tool_result', toolUseId: tc.id, content: output });
    }

    workingMessages.push({ role: 'user', content: toolResults });
  }

  // Max iterations reached — force a text response without tools
  workingMessages.push({
    role: 'user',
    content: 'You have used many tool calls. Please now provide your response to the user based on what you have learned.',
  });

  const finalResponse = await llm.call(workingMessages, {
    tier: 'standard' as const,
    systemPrompt,
    // No tools — force text
  });

  totalInputTokens += finalResponse.usage.inputTokens;
  totalOutputTokens += finalResponse.usage.outputTokens;

  return {
    content: finalResponse.content || 'I was unable to generate a response. Please try again.',
    toolCallsCount,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}

/**
 * Generate AI planning response using memory-based context and actual LLM calls.
 * This endpoint is called by the planning mode UI.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, userMessage } = body;

    if (!projectId || !userMessage) {
      return NextResponse.json({ error: 'projectId and userMessage are required' }, { status: 400 });
    }

    const db = getDb();

    // Get project details
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Extract authenticated userId from JWT cookie (not from request body)
    // This ensures user-specific memories are properly scoped per user
    const auth = await getAuthFromRequest(request);
    const userId = auth?.userId ?? body.userId;
    await projectMemoryService.extractPlanningMemories(
      projectId,
      userMessage,
      '', // AI response stored after generation
      userId,
    );

    // Retrieve relevant context from PROJECT memory
    const relevantMemories = await projectMemoryService.getRelevantContext(
      projectId,
      userMessage,
      15,
    );

    // Build AI context from memories
    const memoryContext = relevantMemories
      .map((m) => {
        const confidence = m.finalScore >= 0.7 ? '★★★' : m.finalScore >= 0.5 ? '★★' : '★';
        return `${confidence} ${m.content}`;
      })
      .join('\n');

    // Get planning mode system prompt
    const baseSystemPrompt = getPlanningModeSystemPrompt(project.name);

    const systemPrompt = `${baseSystemPrompt}

${project.description ? `\nProject Description: ${project.description}` : ''}

## Relevant Project Knowledge (from previous discussions)
${memoryContext || 'No prior context yet - this is the beginning of our planning conversation.'}

## Conversation Guidelines
- Ask thoughtful, specific clarifying questions to understand the user's vision
- Store every requirement and decision in memory using your tools
- Be conversational and engaging — guide the user through planning
- When you have enough context, offer to generate the PRD and task breakdown
- DO NOT repeat back the same information verbatim — synthesize and build on it

## Asking Questions (IMPORTANT)
When you need information from the user, use the **ask_user** tool to present structured questions with clickable options. This gives the user a better experience than just typing questions in prose. For example:
- "What platform?" → options: ["Web app", "Mobile app", "Desktop app", "All platforms"]
- "Authentication?" → options: ["Email/password", "OAuth (Google/GitHub)", "Magic links", "No auth needed"]
- Always set allowFreeText: true so users can provide custom answers if none of the options fit
- Ask 1-5 focused questions at a time, don't overwhelm the user
- Combine ask_user with a brief text response explaining context or acknowledging what you've learned`;

    // Build all planning tools: memory, PRD, tasks, wireframes, search
    const planningTools = createPlanningTools(projectMemoryService, projectId);
    const prdTools = createPrdTools(db, projectId);
    const taskTools = createTaskTools(db, projectId);
    const wireframeTools = createWireframeTools(db, projectId);

    // Load web search tools (Tier 1 + Tier 2)
    const searchTools = await loadSearchTools();

    const allLocalTools = [...planningTools, ...prdTools, ...taskTools, ...wireframeTools];

    const toolDefs: LLMToolDefinition[] = [
      ...allLocalTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      // Tier 1 + Tier 2 search tools
      ...searchTools.defs,
      // Include ask_user so the agent can ask structured questions with clickable options
      ASK_USER_TOOL_DEF,
    ];
    // Planning tools don't use the context arg, but the Tool interface requires it
    const dummyContext = { nodeId: 'dashboard', agentId: 'planning', capabilities: { os: 'linux' as const, hasDisplay: false, browserCapable: false, environment: 'cloud' as const, customTags: [] } };
    const toolMap = new Map<string, (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>>([
      ...allLocalTools.map((t) => [t.name, (input: Record<string, unknown>) => t.execute(input, dummyContext)] as const),
      ...searchTools.map,
    ]);
    // ask_user is not in the toolMap — it's intercepted directly in the loop

    // Load conversation history from DB for full context
    const conversations = await db.projectConversation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    // Build LLM messages from conversation history + new user message
    const llmMessages: LLMMessage[] = [];
    for (const conv of conversations) {
      llmMessages.push({
        role: conv.role as 'user' | 'assistant',
        content: conv.content,
      });
    }
    // Append the current user message
    llmMessages.push({ role: 'user', content: userMessage });

    // Create LLM pool and run the planning agent loop
    const llm = await createLLMPool();
    const result = await runPlanningAgentLoop(
      llm,
      llmMessages,
      systemPrompt,
      toolDefs,
      toolMap,
      20, // max tool iterations (higher to allow proactive research + memory + ask_user)
    );

    const aiResponse = result.content;

    // Store AI response memories
    await projectMemoryService.extractPlanningMemories(
      projectId,
      userMessage,
      aiResponse,
      userId,
    );

    // Save conversation to database
    await db.projectConversation.create({
      data: {
        projectId,
        role: 'user',
        content: userMessage,
      },
    });

    await db.projectConversation.create({
      data: {
        projectId,
        role: 'assistant',
        content: aiResponse,
        metadata: {
          memoriesUsed: relevantMemories.length,
          toolCallsMade: result.toolCallsCount,
          tokensUsed: result.usage,
        },
      },
    });

    // ── Fetch current PRD, tasks, and wireframes from DB to include in response ──
    const [updatedProject, currentTasks, currentWireframes] = await Promise.all([
      db.project.findUnique({ where: { id: projectId }, select: { prd: true } }),
      db.projectTask.findMany({
        where: { projectId },
        orderBy: { priority: 'desc' },
      }),
      db.projectWireframe.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    // Map task IDs to titles for human-readable dependency display
    const taskIdToTitle = new Map(currentTasks.map((t: any) => [t.id, t.title]));
    const tasksForFrontend = currentTasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
      status: t.status,
      dependencies: Array.isArray(t.dependencies)
        ? t.dependencies.map((depId: string) => taskIdToTitle.get(depId) || depId)
        : [],
    }));

    // Build wireframe composition data for frontend
    const wfIdToName = new Map(currentWireframes.map((w: any) => [w.id, w.name]));
    const wfUsedIn = new Map<string, string[]>();
    for (const wf of currentWireframes) {
      const elements = Array.isArray(wf.elements) ? wf.elements : [];
      for (const el of elements) {
        if (el && el.type === 'wireframeRef' && el.wireframeRefId) {
          if (!wfUsedIn.has(el.wireframeRefId)) wfUsedIn.set(el.wireframeRefId, []);
          wfUsedIn.get(el.wireframeRefId)!.push(wf.name);
        }
      }
    }
    const wireframesForFrontend = currentWireframes.map((wf: any) => {
      const elements = Array.isArray(wf.elements) ? wf.elements : [];
      const refs = [...new Set(elements.filter((e: any) => e.type === 'wireframeRef' && e.wireframeRefId).map((e: any) => wfIdToName.get(e.wireframeRefId) || e.wireframeRefId))];
      return {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        wireframeType: wf.wireframeType,
        elements: wf.elements,
        featureTags: wf.featureTags,
        canvasWidth: wf.canvasWidth,
        canvasHeight: wf.canvasHeight,
        sortOrder: wf.sortOrder,
        elementCount: elements.length,
        contains: refs,
        usedIn: wfUsedIn.get(wf.id) || [],
      };
    });

    return NextResponse.json({
      response: aiResponse,
      // Structured questions the agent wants the user to answer (clickable options)
      questions: result.questions ?? null,
      // Current PRD, tasks, and wireframes from the database (updated by tool calls)
      prd: (updatedProject?.prd as string) || null,
      tasks: tasksForFrontend,
      wireframes: wireframesForFrontend,
      context: {
        memoriesUsed: relevantMemories.length,
        toolCallsMade: result.toolCallsCount,
        tokensUsed: result.usage,
        planningToolsAvailable: allLocalTools.length,
      },
    });
  } catch (err: any) {
    console.error('Planning error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * GET — Fetch the current PRD and tasks for a project.
 * Used by the frontend to load initial state and poll for updates.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId query param is required' }, { status: 400 });
    }

    const db = getDb();

    const [project, tasks, wireframes] = await Promise.all([
      db.project.findUnique({ where: { id: projectId }, select: { prd: true } }),
      db.projectTask.findMany({
        where: { projectId },
        orderBy: { priority: 'desc' },
      }),
      db.projectWireframe.findMany({
        where: { projectId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Map task IDs to titles for human-readable dependency display
    const taskIdToTitle = new Map(tasks.map((t: any) => [t.id, t.title]));
    const tasksForFrontend = tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      taskType: t.taskType,
      priority: t.priority,
      status: t.status,
      dependencies: Array.isArray(t.dependencies)
        ? t.dependencies.map((depId: string) => taskIdToTitle.get(depId) || depId)
        : [],
    }));

    // Build wireframe data with composition info
    const wfIdToName = new Map(wireframes.map((w: any) => [w.id, w.name]));
    const wfUsedIn = new Map<string, string[]>();
    for (const wf of wireframes) {
      const elements = Array.isArray(wf.elements) ? wf.elements : [];
      for (const el of elements) {
        if (el && el.type === 'wireframeRef' && el.wireframeRefId) {
          if (!wfUsedIn.has(el.wireframeRefId)) wfUsedIn.set(el.wireframeRefId, []);
          wfUsedIn.get(el.wireframeRefId)!.push(wf.name);
        }
      }
    }
    const wireframesForFrontend = wireframes.map((wf: any) => {
      const elements = Array.isArray(wf.elements) ? wf.elements : [];
      const refs = [...new Set(elements.filter((e: any) => e.type === 'wireframeRef' && e.wireframeRefId).map((e: any) => wfIdToName.get(e.wireframeRefId) || e.wireframeRefId))];
      return {
        id: wf.id, name: wf.name, description: wf.description, wireframeType: wf.wireframeType,
        elements: wf.elements, featureTags: wf.featureTags, canvasWidth: wf.canvasWidth, canvasHeight: wf.canvasHeight,
        sortOrder: wf.sortOrder, elementCount: elements.length, contains: refs, usedIn: wfUsedIn.get(wf.id) || [],
      };
    });

    return NextResponse.json({
      prd: (project.prd as string) || null,
      tasks: tasksForFrontend,
      wireframes: wireframesForFrontend,
    });
  } catch (err: any) {
    console.error('GET plan error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
