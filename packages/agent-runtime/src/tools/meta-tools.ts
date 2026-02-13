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
 * Includes: discover_tools, execute_tool, search_memory, create_skill,
 *           store_memory, manage_goal, update_profile
 */
export function createMetaTools(opts: MetaToolOptions): Tool[] {
  return [
    createDiscoverTool(opts),
    createExecuteTool(opts),
    createMemoryTool(opts),
    createCreateSkillTool(opts),
    createStoreMemoryTool(opts),
    createManageGoalTool(opts),
    createUpdateProfileTool(opts),
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
        'Search your persistent memory, user profile, and goals. Searches ALL scopes by default ' +
        '(personal + team + global). Returns profile data, semantic memory matches, and relevant goals. ' +
        'ALWAYS call this before saying "I don\'t know" or "I don\'t remember". ' +
        'Use for: recalling user info, past conversations, stored facts, preferences, goals.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language search query (e.g., "user name", "what brokerage", "project goals").',
          },
          scope: {
            type: 'string',
            description: 'Optional. "personal", "team", "global", or omit to search all scopes.',
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
      name: 'manage_goal',
      description:
        'Create, update, or complete goals. Use this when the user mentions objectives, priorities, ' +
        'targets, or things they want to achieve. Also use it proactively when you infer goals from ' +
        'conversation context. Goals are visible across all agents and sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'complete', 'pause'],
            description: 'Action to perform on the goal.',
          },
          id: {
            type: 'string',
            description: 'Goal ID (required for update/complete/pause actions).',
          },
          description: {
            type: 'string',
            description: 'Goal description (required for create, optional for update).',
          },
          priority: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Goal priority. Defaults to "medium".',
          },
          scope: {
            type: 'string',
            enum: ['personal', 'team'],
            description: 'Scope: "personal" or "team". Defaults to "personal".',
          },
        },
        required: ['action'],
      },
    },
    {
      name: 'update_profile',
      description:
        'Store or update a user profile attribute (key-value pair). Use when the user shares personal ' +
        'details: name, role, location, tools/services, accounts, preferences, expertise. ' +
        'Profile data is searchable via search_memory. Persists across all sessions.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Profile attribute name (e.g., "preferred_language", "expertise", "communication_style", "name", "role").',
          },
          value: {
            type: 'string',
            description: 'The value for this profile attribute.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence in this information from 0.0 to 1.0. Use lower values for inferred info, higher for explicitly stated. Defaults to 0.8.',
          },
        },
        required: ['key', 'value'],
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
      },
      required: ['query'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      const query = String(input.query || '');
      const scope = String(input.scope || '').toLowerCase();

      if (!query) {
        return { success: false, output: 'Please provide a search query.' };
      }

      const sections: string[] = [];

      // ── 1. Search user profile (always include for personal context) ──
      if (opts.userId) {
        try {
          const { getDb } = await import('@ai-engine/db');
          const db = getDb();
          const profileEntries = await db.userProfile.findMany({
            where: { userId: opts.userId },
          });

          if (profileEntries.length > 0) {
            // Filter profile entries by keyword relevance to the query
            const queryLower = query.toLowerCase();
            const queryWords = queryLower.split(/\s+/).filter((w: string) => w.length > 2);
            const relevant = profileEntries.filter((p: any) => {
              const entryText = `${p.key} ${p.value}`.toLowerCase();
              // Include if query words match, or if it's a broad recall query
              return queryWords.some((w: string) => entryText.includes(w))
                || queryLower.includes(p.key.toLowerCase())
                || /\b(who am i|my name|about me|my profile|what do you know|remember)\b/i.test(query);
            });

            if (relevant.length > 0) {
              const lines = relevant.map((p: any) => `- ${p.key}: ${p.value}`);
              sections.push(`**User Profile:**\n${lines.join('\n')}`);
            }
          }
        } catch {
          // Profile lookup failed — continue with memory search
        }
      }

      // ── 2. Search semantic memory across scopes ───────────────────
      if (opts.searchMemory) {
        try {
          if (scope && scope !== 'all') {
            // Specific scope requested
            const scopeOwnerId = scope === 'personal'
              ? opts.userId ?? null
              : scope === 'team'
                ? opts.teamId ?? null
                : null;
            const result = await opts.searchMemory(query, scope, scopeOwnerId);
            if (result && result !== 'No matching memories found.') {
              sections.push(`**Memory (${scope}):**\n${result}`);
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
                  sections.push(`**Memory (${s.name}):**\n${result}`);
                }
              } catch {
                // Individual scope search failed — continue
              }
            }
          }
        } catch (err: any) {
          sections.push(`Memory search error: ${err.message}`);
        }
      }

      // ── 3. Search active goals ────────────────────────────────────
      try {
        const { getDb } = await import('@ai-engine/db');
        const db = getDb();
        const queryLower = query.toLowerCase();
        if (/\b(goal|objective|target|aim|plan|working on|priority)\b/i.test(query)) {
          const goals = await db.userGoal.findMany({
            where: { status: 'active' },
            orderBy: { priority: 'asc' },
            take: 10,
          });
          if (goals.length > 0) {
            const lines = goals.map((g: any) => `- [${g.priority}] ${g.description}`);
            sections.push(`**Active Goals:**\n${lines.join('\n')}`);
          }
        }
      } catch {
        // Goal search failed — continue
      }

      if (sections.length === 0) {
        console.log(`[search_memory] No results for query="${query}" scope="${scope || 'all'}"`);
        return { success: true, output: 'No matching memories, profile data, or goals found for this query.' };
      }

      const output = sections.join('\n\n');
      console.log(`[search_memory] Found ${sections.length} section(s) for query="${query}" scope="${scope || 'all'}"`);
      return { success: true, output };
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
