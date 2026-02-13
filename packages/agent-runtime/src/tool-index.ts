import type { SkillSearchResult } from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolManifestEntry {
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
  /** Where this tool should be executed */
  executionTarget: 'dashboard' | 'worker';
  /** 'tool' = built-in tool, 'skill' = user/agent-created skill */
  source: 'tool' | 'skill';
  /** For skills, the DB id */
  sourceId?: string;
}

export interface ToolSearchResult {
  name: string;
  description: string;
  category: string;
  source: 'tool' | 'skill';
  sourceId?: string;
  relevanceScore: number;
}

// ---------------------------------------------------------------------------
// ToolIndex — searchable registry of all available tools + skills
// ---------------------------------------------------------------------------

export class ToolIndex {
  /** In-memory manifest of built-in tools */
  private builtInTools: Map<string, ToolManifestEntry> = new Map();

  // ── Registration ─────────────────────────────────────────────────

  /** Register a built-in tool in the manifest */
  register(entry: ToolManifestEntry): void {
    this.builtInTools.set(entry.name, entry);
  }

  /** Register multiple built-in tools */
  registerAll(entries: ToolManifestEntry[]): void {
    for (const e of entries) this.register(e);
  }

  /** Get a specific tool entry by name */
  get(name: string): ToolManifestEntry | undefined {
    return this.builtInTools.get(name);
  }

  /** Get all registered built-in tools */
  getAllBuiltIn(): ToolManifestEntry[] {
    return Array.from(this.builtInTools.values());
  }

  // ── Search ───────────────────────────────────────────────────────

  /**
   * Semantic + keyword search across built-in tools AND skills.
   *
   * Filters results by the agent's `toolConfig` if provided.
   * Returns a compact list — NO full input schemas (keeps LLM context small).
   */
  async search(
    query: string,
    toolConfig?: Record<string, boolean>,
    limit = 10,
  ): Promise<ToolSearchResult[]> {
    const results: ToolSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // ── toolConfig filtering logic ──
    // The agent UI stores toolConfig as { toolName: true } for enabled tools.
    // - If toolConfig is empty/undefined → all tools are available
    // - If toolConfig has explicit entries → only tools with `true` are available
    const hasExplicitConfig = toolConfig && Object.keys(toolConfig).length > 0;
    const isToolAllowed = (name: string): boolean => {
      if (!hasExplicitConfig) return true;
      return toolConfig![name] === true;
    };

    // ── 1. Search built-in tools (keyword match on name + description) ──
    for (const tool of this.builtInTools.values()) {
      if (!isToolAllowed(tool.name)) continue;

      const nameMatch = tool.name.toLowerCase().includes(lowerQuery);
      const descMatch = tool.description.toLowerCase().includes(lowerQuery);
      const catMatch = tool.category.toLowerCase().includes(lowerQuery);

      if (nameMatch || descMatch || catMatch) {
        results.push({
          name: tool.name,
          description: tool.description,
          category: tool.category,
          source: 'tool',
          relevanceScore: nameMatch ? 1.0 : descMatch ? 0.8 : 0.6,
        });
      }
    }

    // If no keyword matches, fuzzy-search: check if any word in query appears
    if (results.length === 0) {
      const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2);
      for (const tool of this.builtInTools.values()) {
        if (!isToolAllowed(tool.name)) continue;

        const text = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
        const wordMatch = queryWords.some((w) => text.includes(w));
        if (wordMatch) {
          results.push({
            name: tool.name,
            description: tool.description,
            category: tool.category,
            source: 'tool',
            relevanceScore: 0.4,
          });
        }
      }
    }

    // ── 2. Search skills from DB (keyword search — pgvector is optional) ──
    // Dynamic import: @ai-engine/db is NOT available on workers (they don't
    // ship the db package). Using import() lets us gracefully skip skill
    // search when the package is missing, instead of crashing at module load.
    try {
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();
      const skillResults = await db.skill.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        select: { id: true, name: true, description: true, category: true },
      });

      for (const s of skillResults) {
        results.push({
          name: `skill:${s.name}`,
          description: s.description,
          category: s.category,
          source: 'skill',
          sourceId: s.id,
          relevanceScore: 0.7,
        });
      }
    } catch {
      // DB not available — continue with built-in results only
    }

    // ── 3. Sort and limit ──
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Get the full input schema for a specific tool.
   * For skills, loads from DB.
   */
  async getSchema(toolName: string): Promise<Record<string, unknown> | null> {
    const builtIn = this.builtInTools.get(toolName);
    if (builtIn) return builtIn.inputSchema;

    // Check if it's a skill reference
    if (toolName.startsWith('skill:')) {
      // Skill schemas are their instructions, not JSON schema
      return null;
    }

    return null;
  }
}
