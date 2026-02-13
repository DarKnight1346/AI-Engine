import type { Tool, ToolContext, ToolResult } from '../types.js';
import type { ToolIndex } from '../tool-index.js';
import type { ToolExecutor } from '../tool-executor.js';
import type { LLMToolDefinition } from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Meta-tool options
// ---------------------------------------------------------------------------

export interface MetaToolOptions {
  toolIndex: ToolIndex;
  toolExecutor: ToolExecutor;
  /** Agent's toolConfig for filtering discovery results */
  toolConfig?: Record<string, boolean>;
  /** Memory search function (injected to avoid circular dependency) */
  searchMemory?: (query: string, scope: string, scopeOwnerId: string | null) => Promise<string>;
  /** User/team context for memory scope */
  userId?: string;
  teamId?: string;
  /** Chat session ID (used for goal source tracking) */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Create the 7 core meta-tools
// ---------------------------------------------------------------------------

/**
 * Build the set of meta-tools that every agent gets.
 * These are the ONLY tools in the initial LLM context — everything
 * else is discovered and executed through them.
 *
 * Includes: discover_tools, execute_tool, search_memory, store_memory, create_skill, get_current_time
 */
export function createMetaTools(opts: MetaToolOptions): Tool[] {
  return [
    createDiscoverTool(opts),
    createExecuteTool(opts),
    createMemoryTool(opts),
    createStoreMemoryTool(opts),
    createCreateSkillTool(opts),
    createCurrentTimeTool(),
  ];
}

/**
 * Get LLM-compatible tool definitions for all meta-tools.
 */
export function getMetaToolDefinitions(): LLMToolDefinition[] {
  return [
    {
      name: 'discover_tools',
      description:
        'Search for available tools and skills by describing what you need. ' +
        'Returns a list of matching tools with names and descriptions. ' +
        'Use this BEFORE execute_tool to find the right tool for a task. ' +
        'Example queries: "web search", "file operations", "browser automation", "financial analysis".',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language description of the capability you need.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'execute_tool',
      description:
        'Execute a discovered tool by name. You MUST call discover_tools first to find ' +
        'the tool name, then pass it here with the appropriate input. ' +
        'For skills, use the name returned by discover_tools (e.g., "skill:ETF Analysis").',
      inputSchema: {
        type: 'object',
        properties: {
          tool: {
            type: 'string',
            description: 'The exact tool name from discover_tools results.',
          },
          input: {
            type: 'object',
            description: 'Input parameters for the tool. Check the tool description for expected parameters.',
          },
        },
        required: ['tool', 'input'],
      },
    },
    {
      name: 'search_memory',
      description:
        'Semantic search across all persistent memory — facts, knowledge, AND past conversations. ' +
        'Searches personal, team, and global scopes plus episodic memory (conversation summaries). ' +
        'ALWAYS call this before saying "I don\'t know" or "I don\'t remember". ' +
        'Use for questions like "what did we discuss last week?" as well as factual recall. ' +
        'Set deep=true for thorough multi-hop recall when simple search returns weak results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language search query (e.g., "user name", "what brokerage", "investment strategy").',
          },
          scope: {
            type: 'string',
            description: 'Optional. "personal", "team", "global", or omit to search all scopes.',
          },
          deep: {
            type: 'boolean',
            description: 'Optional. If true, performs multi-hop associative recall (follows chains of related memories 2-3 hops deep). Use when initial recall is insufficient or for "let me think about it" style deep retrieval.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_skill',
      description:
        'Create a new reusable skill in the skill library. Skills are step-by-step instructions ' +
        'that you or other agents can discover and follow later. Use this to capture a useful ' +
        'workflow, technique, or procedure so it can be reused. Good skills have a clear name, ' +
        'description, category, and detailed instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A short, descriptive name for the skill (e.g., "SEO Audit", "Deploy to Vercel").',
          },
          description: {
            type: 'string',
            description: 'A one-line summary of what this skill does and when to use it.',
          },
          category: {
            type: 'string',
            description: 'Category for organization (e.g., "web", "analysis", "development", "automation").',
          },
          instructions: {
            type: 'string',
            description: 'Detailed step-by-step instructions for performing this skill. Use markdown formatting.',
          },
          codeSnippet: {
            type: 'string',
            description: 'Optional code example or template associated with the skill.',
          },
        },
        required: ['name', 'description', 'category', 'instructions'],
      },
    },
    {
      name: 'store_memory',
      description:
        'Store information in persistent semantic memory. Use proactively when the user shares ' +
        'facts, decisions, preferences, or context worth remembering across sessions. ' +
        'Types: "knowledge", "decision", "fact", "pattern". Use scope "personal" for user-specific data.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The information to remember. Be concise but specific.',
          },
          type: {
            type: 'string',
            enum: ['knowledge', 'decision', 'fact', 'pattern'],
            description: 'Type of memory entry. Defaults to "knowledge".',
          },
          scope: {
            type: 'string',
            enum: ['personal', 'team', 'global'],
            description: 'Scope: "personal" (user-specific), "team" (shared with team), "global" (shared across system). Defaults to "global".',
          },
          importance: {
            type: 'number',
            description: 'Importance from 0.0 to 1.0. Higher = more likely to be surfaced. Defaults to 0.5.',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'get_current_time',
      description:
        'Get the current date, time, day of week, and timezone. Call this whenever you need temporal ' +
        'context — before interpreting relative time references like "today", "yesterday", "last week", ' +
        '"this month", or "this year". Essential for time-aware memory searches and scheduling.',
      inputSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional IANA timezone (e.g., "America/New_York", "Europe/London"). Defaults to server timezone.',
          },
        },
        required: [],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Individual meta-tool implementations
// ---------------------------------------------------------------------------

function createDiscoverTool(opts: MetaToolOptions): Tool {
  return {
    name: 'discover_tools',
    description: 'Search for available tools and skills.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What capability do you need?' },
      },
      required: ['query'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const query = String(input.query || '');
      if (!query) {
        return { success: false, output: 'Please provide a query describing the capability you need.' };
      }

      const results = await opts.toolIndex.search(query, opts.toolConfig, 10);

      if (results.length === 0) {
        return {
          success: true,
          output: `No tools or skills found matching "${query}". Try a different description or broader terms.`,
        };
      }

      const lines = results.map((r) => {
        const prefix = r.source === 'skill' ? '[skill] ' : '';
        return `- ${prefix}${r.name}: ${r.description} (category: ${r.category})`;
      });

      return {
        success: true,
        output: `Found ${results.length} matching tools/skills:\n${lines.join('\n')}\n\nUse execute_tool with the exact tool name to run one.`,
      };
    },
  };
}

function createExecuteTool(opts: MetaToolOptions): Tool {
  return {
    name: 'execute_tool',
    description: 'Execute a discovered tool by name.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['tool', 'input'],
    },
    execute: async (input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      const toolName = String(input.tool || '');
      const toolInput = (input.input as Record<string, unknown>) || {};

      if (!toolName) {
        return { success: false, output: 'Please provide the tool name to execute.' };
      }

      // Handle skill execution — load skill instructions
      if (toolName.startsWith('skill:')) {
        return await executeSkill(toolName, toolInput);
      }

      // Execute via the hybrid executor (routes to dashboard or worker)
      return await opts.toolExecutor.execute(toolName, toolInput, context);
    },
  };
}

function createMemoryTool(opts: MetaToolOptions): Tool {
  return {
    name: 'search_memory',
    description: 'Search memory entries by query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string' },
        deep: { type: 'boolean' },
      },
      required: ['query'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const query = String(input.query || '');
      const scope = String(input.scope || '').toLowerCase();
      const deep = input.deep === true || input.deep === 'true';

      if (!query) {
        return { success: false, output: 'Please provide a search query.' };
      }

      if (!opts.searchMemory) {
        return { success: true, output: 'Memory search is not configured.' };
      }

      const results: string[] = [];

      try {
        // Deep recall: multi-hop associative search
        if (deep) {
          console.log(`[search_memory] Deep recall: query="${query.slice(0, 80)}" scope="${scope || 'all'}"`);
          const { MemoryService: MemSvc, EmbeddingService: EmbSvc } = await import('@ai-engine/memory');
          const embSvc = new EmbSvc();
          const memSvc = new MemSvc(embSvc);

          const scopes: Array<{ name: string; id: string | null }> = [];
          if (scope && scope !== 'all') {
            const scopeOwnerId = scope === 'personal'
              ? opts.userId ?? null
              : scope === 'team'
                ? opts.teamId ?? null
                : null;
            scopes.push({ name: scope, id: scopeOwnerId });
          } else {
            if (opts.userId) scopes.push({ name: 'personal', id: opts.userId });
            if (opts.teamId) scopes.push({ name: 'team', id: opts.teamId });
            scopes.push({ name: 'global', id: null });
          }

          for (const s of scopes) {
            try {
              const deepResults = await memSvc.deepSearch(query, s.name as any, s.id, 8, 3);
              for (const m of deepResults) {
                const confidence = m.finalScore >= 0.7 ? 'high' : m.finalScore >= 0.4 ? 'medium' : 'low';
                results.push(`- [${m.scope}/${confidence}] ${m.content}`);
              }
            } catch {
              // Individual scope deep search failed
            }
          }
        } else if (scope && scope !== 'all') {
          // Specific scope requested
          const scopeOwnerId = scope === 'personal'
            ? opts.userId ?? null
            : scope === 'team'
              ? opts.teamId ?? null
              : null;
          const result = await opts.searchMemory(query, scope, scopeOwnerId);
          if (result && result !== 'No matching memories found.') {
            results.push(result);
          }
        } else {
          // Search ALL scopes — personal, team, and global
          const scopes: Array<{ name: string; id: string | null }> = [];
          if (opts.userId) scopes.push({ name: 'personal', id: opts.userId });
          if (opts.teamId) scopes.push({ name: 'team', id: opts.teamId });
          scopes.push({ name: 'global', id: null });

          for (const s of scopes) {
            try {
              const result = await opts.searchMemory(query, s.name, s.id);
              if (result && result !== 'No matching memories found.') {
                results.push(result);
              }
            } catch {
              // Individual scope search failed — continue
            }
          }
        }
      } catch (err: any) {
        console.error(`[search_memory] Error:`, err.message);
        return { success: false, output: `Memory search failed: ${err.message}` };
      }

      // Also search episodic memory (conversation summaries) for temporal context
      try {
        const { MemoryService: MemSvc, EmbeddingService: EmbSvc } = await import('@ai-engine/memory');
        const embSvc = new EmbSvc();
        const memSvc = new MemSvc(embSvc);
        const episodes = await memSvc.searchEpisodic(query, opts.userId ?? null, opts.teamId ?? null, 3);
        for (const ep of episodes) {
          if (ep.similarity > 0.3) {
            const start = ep.periodStart instanceof Date
              ? ep.periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : new Date(ep.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const topicStr = ep.topics.length > 0 ? ` Topics: ${ep.topics.join(', ')}.` : '';
            const decisionStr = ep.decisions.length > 0 ? ` Decisions: ${ep.decisions.join('; ')}.` : '';
            results.push(`- [episode/${start}] ${ep.summary}${topicStr}${decisionStr}`);
          }
        }
      } catch {
        // Episodic search is best-effort
      }

      if (results.length === 0) {
        console.log(`[search_memory] No results for query="${query}" scope="${scope || 'all'}"`);
        return { success: true, output: 'No matching memories found.' };
      }

      const output = results.join('\n');
      console.log(`[search_memory] Found results for query="${query}" scope="${scope || 'all'}"`);
      return { success: true, output };
    },
  };
}

// ---------------------------------------------------------------------------
// get_current_time meta-tool
// ---------------------------------------------------------------------------

function createCurrentTimeTool(): Tool {
  return {
    name: 'get_current_time',
    description: 'Get the current date, time, day of week, and timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: { type: 'string' },
      },
      required: [],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const tz = typeof input.timezone === 'string' && input.timezone.length > 0
        ? input.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;

      try {
        const now = new Date();

        // Full locale-formatted parts using the requested timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZoneName: 'short',
        });

        const parts = formatter.formatToParts(now);
        const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

        const dayOfWeek = get('weekday');
        const month = get('month');
        const day = get('day');
        const year = get('year');
        const hour = get('hour');
        const minute = get('minute');
        const second = get('second');
        const dayPeriod = get('dayPeriod');
        const timeZoneName = get('timeZoneName');

        // ISO 8601 for precision
        const iso = now.toISOString();

        // Unix timestamp
        const unixMs = now.getTime();

        const output = [
          `Current time: ${dayOfWeek}, ${month} ${day}, ${year} at ${hour}:${minute}:${second} ${dayPeriod} ${timeZoneName}`,
          `Day of week: ${dayOfWeek}`,
          `Month: ${month}`,
          `Year: ${year}`,
          `Timezone: ${tz} (${timeZoneName})`,
          `ISO 8601: ${iso}`,
          `Unix timestamp: ${unixMs}`,
        ].join('\n');

        return { success: true, output };
      } catch (err: any) {
        // Invalid timezone — fall back to UTC
        const now = new Date();
        return {
          success: true,
          output: `Current time (UTC): ${now.toUTCString()}\nNote: timezone "${tz}" was not recognized, showing UTC.`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// create_skill meta-tool
// ---------------------------------------------------------------------------

function createCreateSkillTool(opts: MetaToolOptions): Tool {
  return {
    name: 'create_skill',
    description: 'Create a new reusable skill in the skill library.',
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
    execute: async (input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      const name = String(input.name || '').trim();
      const description = String(input.description || '').trim();
      const category = String(input.category || '').trim();
      const instructions = String(input.instructions || '').trim();
      const codeSnippet = input.codeSnippet ? String(input.codeSnippet).trim() : undefined;

      if (!name || !description || !category || !instructions) {
        return {
          success: false,
          output: 'All of name, description, category, and instructions are required to create a skill.',
        };
      }

      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();

        // Check for duplicate skill name
        const existing = await db.skill.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          return {
            success: false,
            output: `A skill named "${name}" already exists (id: ${existing.id}). Choose a different name or update the existing skill.`,
          };
        }

        // Determine creator identity
        const createdBy = context.agentId && context.agentId !== 'chat'
          ? `agent:${context.agentId}`
          : 'agent';

        const skill = await db.skill.create({
          data: {
            name,
            description,
            category,
            instructions,
            codeSnippet: codeSnippet ?? null,
            requiredCapabilities: [],
            createdBy,
          },
        });

        // Create version snapshot
        await db.skillVersion.create({
          data: {
            skillId: skill.id,
            version: 1,
            contentSnapshot: { name, description, instructions },
          },
        });

        // Index for search (best-effort — embedding service may not be available)
        try {
          const { EmbeddingService } = await import('@ai-engine/memory');
          const embeddings = new EmbeddingService();
          await embeddings.storeEmbedding(skill.id, 'skill', `${name}: ${description}`);
        } catch {
          // Embedding indexing failed — skill is still created, just not vector-searchable yet
        }

        return {
          success: true,
          output: `Skill "${name}" created successfully (id: ${skill.id}, category: ${category}). It is now discoverable via discover_tools and can be loaded with execute_tool using "skill:${name}".`,
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to create skill: ${err.message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// store_memory meta-tool
// ---------------------------------------------------------------------------

function createStoreMemoryTool(opts: MetaToolOptions): Tool {
  return {
    name: 'store_memory',
    description: 'Store information in memory for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        type: { type: 'string' },
        scope: { type: 'string' },
        importance: { type: 'number' },
      },
      required: ['content'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const content = String(input.content || '').trim();
      if (!content) {
        return { success: false, output: 'Content is required to store a memory.' };
      }

      const type = String(input.type || 'knowledge');
      const scope = String(input.scope || 'global');
      const importance = typeof input.importance === 'number'
        ? Math.max(0, Math.min(1, input.importance))
        : 0.5;

      // Determine scope owner
      const scopeOwnerId = scope === 'personal'
        ? opts.userId ?? ''
        : scope === 'team'
          ? opts.teamId ?? ''
          : '';

      try {
        // Use the full MemoryService which handles embedding + auto-linking
        const { MemoryService, EmbeddingService } = await import('@ai-engine/memory');
        const embeddings = new EmbeddingService();
        const memService = new MemoryService(embeddings);

        console.log(`[store_memory] Storing: scope=${scope}, type=${type}, importance=${importance}, content="${content.slice(0, 80)}"`);

        const entry = await memService.store(
          scope as any,
          scopeOwnerId || null,
          type as any,
          content,
          importance,
          'explicit',
        );

        console.log(`[store_memory] Stored successfully (id: ${entry.id})`);

        return {
          success: true,
          output: `Memory stored (id: ${entry.id}, type: ${type}, scope: ${scope}, importance: ${importance}). Semantic embedding generated and associative links created. This information will be available in future conversations.`,
        };
      } catch (err: any) {
        console.error(`[store_memory] Failed:`, err.message);
        return { success: false, output: `Failed to store memory: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// manage_goal meta-tool
// ---------------------------------------------------------------------------

function createManageGoalTool(opts: MetaToolOptions): Tool {
  return {
    name: 'manage_goal',
    description: 'Create, update, or complete goals.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string' },
        scope: { type: 'string' },
      },
      required: ['action'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const action = String(input.action || '');
      if (!['create', 'update', 'complete', 'pause'].includes(action)) {
        return { success: false, output: 'Action must be one of: create, update, complete, pause.' };
      }

      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();

        if (action === 'create') {
          const description = String(input.description || '').trim();
          if (!description) {
            return { success: false, output: 'Description is required to create a goal.' };
          }

          const priority = String(input.priority || 'medium');
          const scope = String(input.scope || 'personal');
          const scopeOwnerId = scope === 'team'
            ? opts.teamId ?? opts.userId ?? ''
            : opts.userId ?? '';

          const goal = await db.userGoal.create({
            data: {
              description,
              priority,
              status: 'active',
              scope,
              scopeOwnerId,
              sourceSessionId: opts.sessionId ?? null,
            },
          });

          return {
            success: true,
            output: `Goal created (id: ${goal.id}, priority: ${priority}, scope: ${scope}): "${description}"`,
          };
        }

        // For update/complete/pause, we need a goal ID
        const goalId = String(input.id || '').trim();
        if (!goalId) {
          // If no ID provided, try to find a matching goal by description
          const searchDesc = String(input.description || '').trim();
          if (!searchDesc) {
            return { success: false, output: `Goal ID is required for ${action}. Use search_memory or check the active goals in your context to find the goal ID.` };
          }

          // Search for a matching active goal
          const goals = await db.userGoal.findMany({
            where: { status: 'active' },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });

          const searchLower = searchDesc.toLowerCase();
          const match = goals.find((g: any) =>
            g.description.toLowerCase().includes(searchLower) ||
            searchLower.includes(g.description.toLowerCase())
          );

          if (!match) {
            return { success: false, output: `No active goal found matching "${searchDesc}". Available goals:\n${goals.map((g: any) => `- ${g.id}: ${g.description}`).join('\n')}` };
          }

          // Use the matched goal
          return await executeGoalAction(db, action, match.id, input, opts);
        }

        return await executeGoalAction(db, action, goalId, input, opts);
      } catch (err: any) {
        return { success: false, output: `Failed to ${action} goal: ${err.message}` };
      }
    },
  };
}

/** Helper to execute update/complete/pause actions on a goal */
async function executeGoalAction(
  db: any,
  action: string,
  goalId: string,
  input: Record<string, unknown>,
  opts: MetaToolOptions,
): Promise<ToolResult> {
  const existing = await db.userGoal.findUnique({ where: { id: goalId } });
  if (!existing) {
    return { success: false, output: `Goal with id "${goalId}" not found.` };
  }

  const updateData: Record<string, unknown> = {};

  if (action === 'complete') {
    updateData.status = 'completed';
  } else if (action === 'pause') {
    updateData.status = 'paused';
  }

  if (input.description) {
    updateData.description = String(input.description).trim();
  }
  if (input.priority) {
    updateData.priority = String(input.priority);
  }

  await db.userGoal.update({ where: { id: goalId }, data: updateData });

  // Track the update in goal_updates if description changed
  if (updateData.description && updateData.description !== existing.description) {
    await db.goalUpdate.create({
      data: {
        goalId,
        previousDescription: existing.description,
        newDescription: String(updateData.description),
        sourceSessionId: opts.sessionId ?? null,
      },
    });
  }

  const statusText = action === 'complete' ? 'completed' : action === 'pause' ? 'paused' : 'updated';
  return {
    success: true,
    output: `Goal ${statusText} (id: ${goalId}): "${updateData.description || existing.description}"`,
  };
}

// ---------------------------------------------------------------------------
// update_profile meta-tool
// ---------------------------------------------------------------------------

function createUpdateProfileTool(opts: MetaToolOptions): Tool {
  return {
    name: 'update_profile',
    description: 'Store or update user profile information.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['key', 'value'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const key = String(input.key || '').trim();
      const value = String(input.value || '').trim();
      if (!key || !value) {
        return { success: false, output: 'Both key and value are required.' };
      }

      const confidence = typeof input.confidence === 'number'
        ? Math.max(0, Math.min(1, input.confidence))
        : 0.8;

      const userId = opts.userId;
      if (!userId) {
        // Fall back to first admin user
        try {
          const { getDb } = await import('@ai-engine/db');
          const db = getDb();
          const user = await db.user.findFirst({ where: { role: 'admin' } });
          if (!user) {
            return { success: false, output: 'No user found to associate profile data with.' };
          }
          return await upsertProfile(db, user.id, key, value, confidence);
        } catch (err: any) {
          return { success: false, output: `Failed to update profile: ${err.message}` };
        }
      }

      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();
        return await upsertProfile(db, userId, key, value, confidence);
      } catch (err: any) {
        return { success: false, output: `Failed to update profile: ${err.message}` };
      }
    },
  };
}

/** Helper to upsert a profile entry */
async function upsertProfile(
  db: any,
  userId: string,
  key: string,
  value: string,
  confidence: number,
): Promise<ToolResult> {
  const existing = await db.userProfile.findFirst({ where: { userId, key } });
  let action: string;

  if (existing) {
    await db.userProfile.update({
      where: { id: existing.id },
      data: { value, confidence },
    });
    action = 'updated';
  } else {
    await db.userProfile.create({
      data: { userId, key, value, confidence },
    });
    action = 'created';
  }

  console.log(`[update_profile] ${action}: "${key}" = "${value}" (confidence: ${confidence}, user: ${userId})`);

  return {
    success: true,
    output: `Profile ${action}: "${key}" = "${value}" (confidence: ${confidence}). This will be remembered across all conversations.`,
  };
}

// ---------------------------------------------------------------------------
// Skill execution helper
// ---------------------------------------------------------------------------

async function executeSkill(
  skillName: string,
  _input: Record<string, unknown>,
): Promise<ToolResult> {
  // Extract skill name (remove "skill:" prefix) and look up in DB
  const name = skillName.replace(/^skill:/, '');

  try {
    const { getDb } = await import('@ai-engine/db');
    const db = getDb();

    // Find skill by name
    const skill = await db.skill.findFirst({
      where: {
        isActive: true,
        name: { equals: name, mode: 'insensitive' },
      },
    });

    if (!skill) {
      return { success: false, output: `Skill "${name}" not found.` };
    }

    // Increment usage
    await db.skill.update({
      where: { id: skill.id },
      data: { usageCount: { increment: 1 } },
    });

    // Return skill content for the agent to follow
    const parts = [
      `# Skill: ${skill.name}`,
      `Category: ${skill.category}`,
      '',
      '## Instructions',
      skill.instructions,
    ];
    if (skill.codeSnippet) {
      parts.push('', '## Code', '```', skill.codeSnippet, '```');
    }

    return { success: true, output: parts.join('\n') };
  } catch (err: any) {
    return { success: false, output: `Failed to load skill: ${err.message}` };
  }
}
