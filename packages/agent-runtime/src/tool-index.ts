// ---------------------------------------------------------------------------
// ToolIndex — searchable registry of all available tools + skills
//
// Supports two search modes:
//   1. SEMANTIC (primary) — uses EmbeddingService to compute 768-dim vectors
//      for every tool description at registration time. Searches by cosine
//      similarity against the query embedding. Scales to thousands of tools.
//   2. KEYWORD (fallback) — multi-signal substring matching used when
//      embeddings are not available (no EmbeddingService provided, or model
//      hasn't loaded yet).
//
// Both modes support:
//   - toolConfig filtering (only show tools the agent is allowed to use)
//   - Tier-label boosting (explicit "tier 2" queries boost matching tools)
//   - Skill search from DB (Prisma keyword search)
// ---------------------------------------------------------------------------

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

/**
 * Minimal interface for the embedding service.
 * Avoids hard-coupling to @ai-engine/memory at the type level.
 */
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
  cosineSimilarity(a: number[], b: number[]): number;
}

// ---------------------------------------------------------------------------
// ToolIndex
// ---------------------------------------------------------------------------

export class ToolIndex {
  /** In-memory manifest of built-in tools */
  private builtInTools: Map<string, ToolManifestEntry> = new Map();

  /** Cached embedding vectors keyed by tool name */
  private toolEmbeddings: Map<string, number[]> = new Map();

  /** Optional embedding provider for semantic search */
  private embeddingProvider: EmbeddingProvider | null = null;

  /** Whether we've computed embeddings for the current tool set */
  private embeddingsReady = false;

  /** Promise that resolves when background embedding computation is done */
  private embeddingBuildPromise: Promise<void> | null = null;

  // ── Configuration ───────────────────────────────────────────────

  /**
   * Set the embedding provider for semantic search.
   * Call this before or after registering tools — embeddings are computed
   * lazily on first search.
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    // Invalidate cached embeddings so they'll be recomputed with the new provider
    this.embeddingsReady = false;
    this.embeddingBuildPromise = null;
  }

  // ── Registration ─────────────────────────────────────────────────

  /** Register a built-in tool in the manifest */
  register(entry: ToolManifestEntry): void {
    this.builtInTools.set(entry.name, entry);
    // Invalidate embeddings — new tool added
    this.embeddingsReady = false;
  }

  /** Register multiple built-in tools */
  registerAll(entries: ToolManifestEntry[]): void {
    for (const e of entries) {
      this.builtInTools.set(e.name, e);
    }
    // Invalidate embeddings — new tools added
    this.embeddingsReady = false;
  }

  /** Get a specific tool entry by name */
  get(name: string): ToolManifestEntry | undefined {
    return this.builtInTools.get(name);
  }

  /** Get all registered built-in tools */
  getAllBuiltIn(): ToolManifestEntry[] {
    return Array.from(this.builtInTools.values());
  }

  /** Number of registered tools */
  get size(): number {
    return this.builtInTools.size;
  }

  // ── Embedding computation ───────────────────────────────────────

  /**
   * Compute embeddings for all registered tools (batch operation).
   * Called lazily on first semantic search. Idempotent.
   */
  private async ensureEmbeddings(): Promise<boolean> {
    if (this.embeddingsReady) return true;
    if (!this.embeddingProvider) return false;

    // Deduplicate concurrent calls
    if (this.embeddingBuildPromise) {
      await this.embeddingBuildPromise;
      return this.embeddingsReady;
    }

    this.embeddingBuildPromise = this._buildEmbeddings();
    await this.embeddingBuildPromise;
    return this.embeddingsReady;
  }

  private async _buildEmbeddings(): Promise<void> {
    if (!this.embeddingProvider) return;

    const tools = Array.from(this.builtInTools.values());
    if (tools.length === 0) {
      this.embeddingsReady = true;
      return;
    }

    // Build embedding text for each tool: name + description + category
    // This gives the embedding model the full semantic context
    const texts = tools.map(
      (t) => `${t.name}: ${t.description} [category: ${t.category}]`,
    );

    try {
      console.log(`[ToolIndex] Computing embeddings for ${tools.length} tools...`);
      const startMs = Date.now();

      // Batch in chunks of 64 to avoid memory spikes with very large tool sets
      const BATCH_SIZE = 64;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchEmbeddings = await this.embeddingProvider.generateBatchEmbeddings(batch);
        allEmbeddings.push(...batchEmbeddings);
      }

      // Store embeddings
      for (let i = 0; i < tools.length; i++) {
        this.toolEmbeddings.set(tools[i].name, allEmbeddings[i]);
      }

      const elapsed = Date.now() - startMs;
      console.log(`[ToolIndex] Embeddings ready for ${tools.length} tools (${elapsed}ms)`);
      this.embeddingsReady = true;
    } catch (err) {
      console.warn('[ToolIndex] Failed to compute embeddings, falling back to keyword search:', (err as Error).message);
      this.embeddingsReady = false;
    }
  }

  // ── Search ───────────────────────────────────────────────────────

  /**
   * Search across built-in tools AND skills.
   *
   * Uses semantic (embedding) search when available, with keyword signals
   * as a boosting factor. Falls back to pure keyword search when embeddings
   * are not available.
   *
   * Scoring (semantic mode):
   *   - Cosine similarity between query and tool embeddings (0..1)
   *   - Keyword boost: +0.15 for name match, +0.10 for description match
   *   - Tier boost: +0.30 when query explicitly mentions a tier
   *
   * Scoring (keyword fallback):
   *   - Full-phrase match in name / description / category
   *   - Per-word match ratio
   *   - Tier-label boost
   */
  async search(
    query: string,
    toolConfig?: Record<string, boolean>,
    limit = 20,
  ): Promise<ToolSearchResult[]> {
    // Try semantic search first
    const hasEmbeddings = await this.ensureEmbeddings();

    if (hasEmbeddings) {
      return this.semanticSearch(query, toolConfig, limit);
    }

    return this.keywordSearch(query, toolConfig, limit);
  }

  // ── Semantic search (primary) ───────────────────────────────────

  private async semanticSearch(
    query: string,
    toolConfig?: Record<string, boolean>,
    limit: number = 20,
  ): Promise<ToolSearchResult[]> {
    const results: ToolSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // ── toolConfig filtering ──
    const hasExplicitConfig = toolConfig && Object.keys(toolConfig).length > 0;
    const isToolAllowed = (name: string): boolean => {
      if (!hasExplicitConfig) return true;
      return toolConfig![name] === true;
    };

    // Detect tier request
    const tierRegex = /tier\s*(\d)/i;
    const tierMatch = query.match(tierRegex);
    const requestedTier = tierMatch ? tierMatch[1] : null;

    // Embed the query
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingProvider!.generateEmbedding(query);
    } catch {
      // Embedding failed — fall back to keyword search
      return this.keywordSearch(query, toolConfig, limit);
    }

    // ── 1. Score built-in tools by cosine similarity + keyword signals ──
    for (const tool of this.builtInTools.values()) {
      if (!isToolAllowed(tool.name)) continue;

      const toolEmb = this.toolEmbeddings.get(tool.name);
      if (!toolEmb) continue;

      // Primary signal: cosine similarity (0..1 for normalized vectors)
      let score = this.embeddingProvider!.cosineSimilarity(queryEmbedding, toolEmb);

      // Keyword boost: reward exact substring matches in name/description
      const lowerName = tool.name.toLowerCase();
      const lowerDesc = tool.description.toLowerCase();
      if (lowerName.includes(lowerQuery)) score += 0.15;
      else if (lowerDesc.includes(lowerQuery)) score += 0.10;

      // Tier boost: if user asked for a specific tier, heavily boost matches
      if (requestedTier) {
        const tierTag = `[tier ${requestedTier}`;
        if (lowerDesc.includes(tierTag)) {
          score += 0.30;
        }
      }

      // Minimum threshold — don't return irrelevant tools
      if (score > 0.35) {
        results.push({
          name: tool.name,
          description: tool.description,
          category: tool.category,
          source: 'tool',
          relevanceScore: score,
        });
      }
    }

    // ── 2. Search skills from DB ──
    await this.searchSkills(query, limit, results);

    // ── 3. Sort and limit ──
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // ── Keyword search (fallback) ───────────────────────────────────

  private async keywordSearch(
    query: string,
    toolConfig?: Record<string, boolean>,
    limit: number = 20,
  ): Promise<ToolSearchResult[]> {
    const results: ToolSearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2);

    // ── toolConfig filtering ──
    const hasExplicitConfig = toolConfig && Object.keys(toolConfig).length > 0;
    const isToolAllowed = (name: string): boolean => {
      if (!hasExplicitConfig) return true;
      return toolConfig![name] === true;
    };

    // Detect tier request
    const tierRegex = /tier\s*(\d)/i;
    const tierMatch = query.match(tierRegex);
    const requestedTier = tierMatch ? tierMatch[1] : null;

    // ── 1. Score built-in tools ──
    for (const tool of this.builtInTools.values()) {
      if (!isToolAllowed(tool.name)) continue;

      const lowerName = tool.name.toLowerCase();
      const lowerDesc = tool.description.toLowerCase();
      const lowerCat = tool.category.toLowerCase();
      const fullText = `${lowerName} ${lowerDesc} ${lowerCat}`;

      let score = 0;

      // Full-phrase match
      if (lowerName.includes(lowerQuery)) score += 1.0;
      else if (lowerDesc.includes(lowerQuery)) score += 0.7;
      else if (lowerCat.includes(lowerQuery)) score += 0.5;

      // Per-word matching
      if (queryWords.length > 0) {
        const matchedWords = queryWords.filter((w) => fullText.includes(w));
        const wordRatio = matchedWords.length / queryWords.length;
        score += wordRatio * 0.6;
      }

      // Tier boost
      if (requestedTier) {
        const tierTag = `[tier ${requestedTier}`;
        if (lowerDesc.includes(tierTag)) {
          score += 2.0;
        }
      }

      if (score > 0) {
        results.push({
          name: tool.name,
          description: tool.description,
          category: tool.category,
          source: 'tool',
          relevanceScore: score,
        });
      }
    }

    // ── 2. Search skills from DB ──
    await this.searchSkills(query, limit, results);

    // ── 3. Sort and limit ──
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // ── Shared: skill search from DB ────────────────────────────────

  private async searchSkills(
    query: string,
    limit: number,
    results: ToolSearchResult[],
  ): Promise<void> {
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
  }

  // ── Schema lookup ───────────────────────────────────────────────

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
