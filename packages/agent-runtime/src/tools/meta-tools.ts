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
}

// ---------------------------------------------------------------------------
// Create the 3 core meta-tools
// ---------------------------------------------------------------------------

/**
 * Build the set of meta-tools that every agent gets.
 * These are the ONLY tools in the initial LLM context — everything
 * else is discovered and executed through them.
 */
export function createMetaTools(opts: MetaToolOptions): Tool[] {
  return [
    createDiscoverTool(opts),
    createExecuteTool(opts),
    createMemoryTool(opts),
  ];
}

/**
 * Get LLM-compatible tool definitions for the 3 meta-tools.
 * These are compact and total ~240 tokens of context.
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
        'Search your memory for relevant context, past conversations, user preferences, ' +
        'or previously learned information. Returns matching memory entries ranked by relevance.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for in memory.',
          },
          scope: {
            type: 'string',
            description: 'Memory scope: "personal" (user-specific), "team", or "global". Defaults to "global".',
          },
        },
        required: ['query'],
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
      const scope = String(input.scope || 'global');

      if (!query) {
        return { success: false, output: 'Please provide a search query.' };
      }

      if (opts.searchMemory) {
        try {
          const scopeOwnerId = scope === 'personal'
            ? opts.userId ?? null
            : scope === 'team'
              ? opts.teamId ?? null
              : null;
          const result = await opts.searchMemory(query, scope, scopeOwnerId);
          return { success: true, output: result || 'No matching memories found.' };
        } catch (err: any) {
          return { success: false, output: `Memory search failed: ${err.message}` };
        }
      }

      return { success: true, output: 'Memory search is not configured.' };
    },
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
