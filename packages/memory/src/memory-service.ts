import { getDb } from '@ai-engine/db';
import { EmbeddingService } from './embedding-service.js';
import {
  computeEffectiveStrength,
  computeRecencyScore,
  computeFrequencyScore,
  onBatchRecall,
} from './decay-engine.js';
import type {
  MemoryEntry,
  MemoryScope,
  MemoryEntryType,
  MemorySource,
  ScoredMemoryEntry,
} from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Hybrid scoring weights
// ---------------------------------------------------------------------------
export interface HybridWeights {
  similarity: number;   // weight for cosine similarity from embeddings
  strength: number;     // weight for effective memory strength (after decay)
  recency: number;      // weight for recency of creation
  importance: number;   // weight for user-assigned importance
  frequency: number;    // weight for access frequency
}

const DEFAULT_WEIGHTS: HybridWeights = {
  similarity: 0.40,
  strength: 0.25,
  recency: 0.15,
  importance: 0.15,
  frequency: 0.05,
};

// Similarity threshold for auto-linking new memories to existing ones
const ASSOCIATION_THRESHOLD = 0.70;
// Number of recent memories to check for auto-linking
const ASSOCIATION_CANDIDATES = 50;

// ---------------------------------------------------------------------------
// Memory Service
// ---------------------------------------------------------------------------

export class MemoryService {
  constructor(
    private embeddings: EmbeddingService,
    private weights: HybridWeights = DEFAULT_WEIGHTS,
  ) {}

  // -----------------------------------------------------------------------
  // Store
  // -----------------------------------------------------------------------

  /**
   * Store a new memory entry with embedding and automatic association linking.
   */
  async store(
    scope: MemoryScope,
    scopeOwnerId: string | null,
    type: MemoryEntryType,
    content: string,
    importance = 0.5,
    source: MemorySource = 'explicit',
  ): Promise<MemoryEntry> {
    const db = getDb();

    const entry = await db.memoryEntry.create({
      data: {
        scope,
        scopeOwnerId,
        type,
        content,
        importance,
        source,
        strength: 1.0,
        decayRate: 0.15,
        accessCount: 0,
      },
    });

    // Generate and store embedding
    await this.embeddings.storeEmbedding(entry.id, 'memory', content);

    // Auto-link: find similar recent memories and create associations
    try {
      await this.autoLink(entry.id, content, scope, scopeOwnerId);
    } catch {
      // Association linking is best-effort
    }

    return this.mapEntry(entry);
  }

  // -----------------------------------------------------------------------
  // Search — hybrid scoring with associative expansion
  // -----------------------------------------------------------------------

  /**
   * Search memories using hybrid scoring that combines:
   * - Semantic similarity (cosine distance via pgvector)
   * - Memory strength (Ebbinghaus decay)
   * - Recency of creation
   * - Importance score
   * - Access frequency
   *
   * Results are expanded via associative memory (1-hop neighbors).
   */
  async search(
    query: string,
    scope: MemoryScope,
    scopeOwnerId: string | null,
    limit = 10,
    options?: { strengthenOnRecall?: boolean; weights?: Partial<HybridWeights> },
  ): Promise<ScoredMemoryEntry[]> {
    const w = { ...this.weights, ...options?.weights };
    const shouldStrengthen = options?.strengthenOnRecall ?? true;

    // Ensure DB column dimension matches model before first vector query
    await this.embeddings.ensureCorrectDimension();

    // Generate query embedding
    const embedding = await this.embeddings.generateEmbedding(query);

    const db = getDb();

    // Fetch candidates: get more than needed so we can re-rank after hybrid scoring
    const candidateLimit = Math.min(limit * 4, 100);

    const rawResults = await db.$queryRawUnsafe<any[]>(
      `
      SELECT
        me.*,
        1 - (emb.embedding <=> $1::vector) as similarity
      FROM memory_entries me
      JOIN memory_embeddings emb ON emb.entry_id = me.id AND emb.entry_type = 'memory'
      WHERE me.scope = $2
      ${scopeOwnerId ? `AND me.scope_owner_id = $3` : ''}
      ORDER BY emb.embedding <=> $1::vector
      LIMIT $${scopeOwnerId ? '4' : '3'}
      `,
      `[${embedding.join(',')}]`,
      scope,
      ...(scopeOwnerId ? [scopeOwnerId] : []),
      candidateLimit,
    );

    if (rawResults.length === 0) return [];

    // Compute hybrid scores
    const scored = rawResults.map((row) => {
      const entry = this.mapEntry(row);
      const similarity = Number(row.similarity) || 0;
      const effectiveStr = computeEffectiveStrength(entry);
      const recency = computeRecencyScore(entry);
      const freq = computeFrequencyScore(entry);

      const finalScore =
        w.similarity * similarity +
        w.strength * effectiveStr +
        w.recency * recency +
        w.importance * entry.importance +
        w.frequency * freq;

      return {
        ...entry,
        similarity,
        effectiveStrength: effectiveStr,
        recencyScore: recency,
        finalScore,
      } as ScoredMemoryEntry;
    });

    // Sort by hybrid score (descending)
    scored.sort((a, b) => b.finalScore - a.finalScore);

    // Take top results before association expansion
    const topResults = scored.slice(0, limit);

    // Associative expansion: follow 1-hop links
    const expanded = await this.expandAssociations(topResults, scored, limit);

    // Strengthen recalled memories (spaced repetition effect)
    if (shouldStrengthen && expanded.length > 0) {
      const ids = expanded.map((m) => m.id);
      try {
        await onBatchRecall(ids);
      } catch {
        // Recall strengthening is best-effort
      }
    }

    return expanded.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Multi-scope search — searches personal + team + global in one call
  // -----------------------------------------------------------------------

  async searchAllScopes(
    query: string,
    userId: string | null,
    teamId: string | null,
    limit = 10,
    options?: { strengthenOnRecall?: boolean },
  ): Promise<ScoredMemoryEntry[]> {
    const results: ScoredMemoryEntry[] = [];

    // Search each applicable scope
    if (userId) {
      const personal = await this.search(query, 'personal', userId, Math.ceil(limit * 0.4), options);
      results.push(...personal);
    }
    if (teamId) {
      const team = await this.search(query, 'team', teamId, Math.ceil(limit * 0.3), options);
      results.push(...team);
    }
    const global = await this.search(query, 'global', null, Math.ceil(limit * 0.3), options);
    results.push(...global);

    // Deduplicate and re-sort by final score
    const seen = new Set<string>();
    const deduped = results.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    deduped.sort((a, b) => b.finalScore - a.finalScore);
    return deduped.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Legacy-compatible methods
  // -----------------------------------------------------------------------

  async getRecent(scope: MemoryScope, scopeOwnerId: string | null, limit = 20): Promise<MemoryEntry[]> {
    const db = getDb();
    const entries = await db.memoryEntry.findMany({
      where: { scope, ...(scopeOwnerId ? { scopeOwnerId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return entries.map(this.mapEntry);
  }

  async getByImportance(scope: MemoryScope, scopeOwnerId: string | null, minImportance = 0.7, limit = 20): Promise<MemoryEntry[]> {
    const db = getDb();
    const entries = await db.memoryEntry.findMany({
      where: { scope, ...(scopeOwnerId ? { scopeOwnerId } : {}), importance: { gte: minImportance } },
      orderBy: { importance: 'desc' },
      take: limit,
    });
    return entries.map(this.mapEntry);
  }

  // -----------------------------------------------------------------------
  // Associative memory
  // -----------------------------------------------------------------------

  /**
   * Auto-link a newly stored memory to similar existing memories.
   * Creates MemoryAssociation records for memories with similarity > threshold.
   */
  private async autoLink(
    entryId: string,
    content: string,
    scope: MemoryScope,
    scopeOwnerId: string | null,
  ): Promise<void> {
    const embedding = await this.embeddings.generateEmbedding(content);
    const db = getDb();

    // Find similar existing memories in the same scope
    const similar = await db.$queryRawUnsafe<any[]>(
      `
      SELECT
        me.id,
        1 - (emb.embedding <=> $1::vector) as similarity
      FROM memory_entries me
      JOIN memory_embeddings emb ON emb.entry_id = me.id AND emb.entry_type = 'memory'
      WHERE me.scope = $2
      ${scopeOwnerId ? `AND me.scope_owner_id = $3` : ''}
      AND me.id != $${scopeOwnerId ? '4' : '3'}
      ORDER BY emb.embedding <=> $1::vector
      LIMIT $${scopeOwnerId ? '5' : '4'}
      `,
      `[${embedding.join(',')}]`,
      scope,
      ...(scopeOwnerId ? [scopeOwnerId] : []),
      entryId,
      ASSOCIATION_CANDIDATES,
    );

    // Create associations for memories above the similarity threshold
    for (const row of similar) {
      const sim = Number(row.similarity) || 0;
      if (sim < ASSOCIATION_THRESHOLD) continue;

      // Weight proportional to similarity (normalized above threshold)
      const weight = Math.min(1.0, (sim - ASSOCIATION_THRESHOLD) / (1 - ASSOCIATION_THRESHOLD) * 0.8 + 0.2);

      try {
        await db.$executeRawUnsafe(
          `INSERT INTO memory_associations (id, source_entry_id, target_entry_id, weight)
           VALUES (gen_random_uuid(), $1, $2, $3)
           ON CONFLICT (source_entry_id, target_entry_id) DO UPDATE SET weight = GREATEST(memory_associations.weight, $3)`,
          entryId,
          row.id,
          weight,
        );
      } catch {
        // Skip individual association failures
      }
    }
  }

  /**
   * Expand search results by following association links (spreading activation).
   * Neighbors get a damped score based on the original score × association weight.
   */
  private async expandAssociations(
    topResults: ScoredMemoryEntry[],
    allCandidates: ScoredMemoryEntry[],
    limit: number,
  ): Promise<ScoredMemoryEntry[]> {
    if (topResults.length === 0) return topResults;

    const db = getDb();
    const resultIds = topResults.map((r) => r.id);

    // Load 1-hop associations from the top results
    const placeholders = resultIds.map((_, i) => `$${i + 1}`).join(', ');
    const associations = await db.$queryRawUnsafe<any[]>(
      `SELECT ma.source_entry_id, ma.target_entry_id, ma.weight
       FROM memory_associations ma
       WHERE ma.source_entry_id IN (${placeholders})
          OR ma.target_entry_id IN (${placeholders})`,
      ...resultIds,
    );

    if (associations.length === 0) return topResults;

    // Build a map of already-included result scores
    const scoreMap = new Map<string, ScoredMemoryEntry>();
    for (const r of topResults) {
      scoreMap.set(r.id, r);
    }

    // Build a map of all candidates for fast lookup
    const candidateMap = new Map<string, ScoredMemoryEntry>();
    for (const c of allCandidates) {
      candidateMap.set(c.id, c);
    }

    // Collect neighbor IDs we need to fetch
    const neighborIds = new Set<string>();
    for (const assoc of associations) {
      const sourceId = assoc.source_entry_id;
      const targetId = assoc.target_entry_id;

      // Find the neighbor (the one NOT already in results)
      for (const nid of [sourceId, targetId]) {
        if (!scoreMap.has(nid)) {
          neighborIds.add(nid);
        }
      }
    }

    // Fetch neighbor entries that aren't already in our candidate set
    const missingIds = [...neighborIds].filter((id) => !candidateMap.has(id));
    if (missingIds.length > 0) {
      const neighborEntries = await db.memoryEntry.findMany({
        where: { id: { in: missingIds } },
      });
      for (const ne of neighborEntries) {
        const mapped = this.mapEntry(ne);
        const effectiveStr = computeEffectiveStrength(mapped);
        candidateMap.set(ne.id, {
          ...mapped,
          similarity: 0,
          effectiveStrength: effectiveStr,
          recencyScore: computeRecencyScore(mapped),
          finalScore: 0, // will be set by damped score
        });
      }
    }

    // Apply spreading activation: neighbors get damped scores
    const DAMPING = 0.5;
    for (const assoc of associations) {
      const sourceId = assoc.source_entry_id;
      const targetId = assoc.target_entry_id;
      const weight = Number(assoc.weight) || 0.5;

      // For each association, propagate score from the included result to the neighbor
      for (const [fromId, toId] of [[sourceId, targetId], [targetId, sourceId]]) {
        const fromEntry = scoreMap.get(fromId);
        const toEntry = candidateMap.get(toId);
        if (fromEntry && toEntry && !scoreMap.has(toId)) {
          const dampedScore = fromEntry.finalScore * weight * DAMPING;
          const existing = scoreMap.get(toId);
          if (existing) {
            // Take the max if already added via another association
            if (dampedScore > existing.finalScore) {
              existing.finalScore = dampedScore;
            }
          } else {
            scoreMap.set(toId, { ...toEntry, finalScore: dampedScore });
          }
        }
      }
    }

    // Collect all results, sort by final score, return top N
    const allResults = [...scoreMap.values()];
    allResults.sort((a, b) => b.finalScore - a.finalScore);
    return allResults.slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private mapEntry(e: any): MemoryEntry {
    return {
      id: e.id,
      scope: e.scope as MemoryScope,
      scopeOwnerId: e.scopeOwnerId ?? e.scope_owner_id ?? null,
      type: e.type as MemoryEntryType,
      content: e.content,
      importance: Number(e.importance) || 0.5,
      strength: Number(e.strength) || 1.0,
      decayRate: Number(e.decayRate ?? e.decay_rate) || 0.15,
      lastAccessedAt: e.lastAccessedAt ?? e.last_accessed_at ?? e.createdAt ?? e.created_at ?? new Date(),
      accessCount: Number(e.accessCount ?? e.access_count) || 0,
      source: (e.source as MemorySource) || 'explicit',
      createdAt: e.createdAt ?? e.created_at ?? new Date(),
    };
  }
}
