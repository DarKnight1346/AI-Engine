import { getDb } from '@ai-engine/db';
import { EmbeddingService } from './embedding-service.js';
import { persistDecay } from './decay-engine.js';

// ---------------------------------------------------------------------------
// Memory Consolidation Service
//
// Mimics human memory consolidation — the process by which the brain
// reorganizes, strengthens, and prunes memories (typically during sleep).
//
// This service runs periodically and performs:
//   1. Deduplication — merge near-identical memories (similarity > 0.92)
//   2. Pruning — remove memories that have effectively been forgotten
//   3. Decay persistence — write current effective strength to DB
//   4. Association maintenance — weaken stale links, remove dead ones
// ---------------------------------------------------------------------------

/** Similarity threshold above which two memories are considered duplicates */
const DEDUP_THRESHOLD = 0.92;

/** Memories with effective strength below this are pruned (forgotten) */
const PRUNE_THRESHOLD = 0.05;

export interface ConsolidationResult {
  memoriesDecayed: number;
  memoriesPruned: number;
  memoriesMerged: number;
  associationsCleaned: number;
}

export class ConsolidationService {
  constructor(private embeddings: EmbeddingService) {}

  /**
   * Run a full consolidation cycle.
   * Safe to call periodically (e.g., every 6–24 hours).
   */
  async consolidate(): Promise<ConsolidationResult> {
    console.log('[Consolidation] Starting memory consolidation cycle...');

    const result: ConsolidationResult = {
      memoriesDecayed: 0,
      memoriesPruned: 0,
      memoriesMerged: 0,
      associationsCleaned: 0,
    };

    // Step 1: Persist decay (update strength values in DB)
    try {
      result.memoriesDecayed = await persistDecay();
      console.log(`[Consolidation] Decayed ${result.memoriesDecayed} memories`);
    } catch (err) {
      console.error('[Consolidation] Decay persistence failed:', (err as Error).message);
    }

    // Step 2: Prune forgotten memories (very low strength)
    try {
      result.memoriesPruned = await this.pruneWeakMemories();
      console.log(`[Consolidation] Pruned ${result.memoriesPruned} forgotten memories`);
    } catch (err) {
      console.error('[Consolidation] Pruning failed:', (err as Error).message);
    }

    // Step 3: Deduplicate similar memories
    try {
      result.memoriesMerged = await this.deduplicateMemories();
      console.log(`[Consolidation] Merged ${result.memoriesMerged} duplicate memories`);
    } catch (err) {
      console.error('[Consolidation] Deduplication failed:', (err as Error).message);
    }

    // Step 4: Clean up associations
    try {
      result.associationsCleaned = await this.cleanAssociations();
      console.log(`[Consolidation] Cleaned ${result.associationsCleaned} stale associations`);
    } catch (err) {
      console.error('[Consolidation] Association cleanup failed:', (err as Error).message);
    }

    console.log('[Consolidation] Cycle complete:', result);
    return result;
  }

  /**
   * Remove memories whose strength has decayed below the prune threshold.
   * These are "forgotten" memories that are no longer useful.
   */
  private async pruneWeakMemories(): Promise<number> {
    const db = getDb();

    // Delete memories with very low strength that are also not high-importance
    // (high-importance memories are protected from pruning)
    const result = await db.$executeRawUnsafe(`
      DELETE FROM memory_entries
      WHERE strength < $1
        AND importance < 0.8
        AND source != 'consolidation'
    `, PRUNE_THRESHOLD);

    return typeof result === 'number' ? result : 0;
  }

  /**
   * Find and merge near-duplicate memories.
   * Keeps the entry with the highest strength/importance, deletes the other.
   */
  private async deduplicateMemories(): Promise<number> {
    const db = getDb();
    let merged = 0;

    // Find pairs of very similar memories
    const duplicates = await db.$queryRawUnsafe<any[]>(`
      SELECT
        e1.id as id1,
        e2.id as id2,
        e1.importance as imp1,
        e2.importance as imp2,
        e1.strength as str1,
        e2.strength as str2,
        e1.access_count as ac1,
        e2.access_count as ac2,
        1 - (emb1.embedding <=> emb2.embedding) as similarity
      FROM memory_embeddings emb1
      JOIN memory_embeddings emb2
        ON emb1.entry_type = 'memory'
        AND emb2.entry_type = 'memory'
        AND emb1.id < emb2.id
      JOIN memory_entries e1 ON e1.id = emb1.entry_id
      JOIN memory_entries e2 ON e2.id = emb2.entry_id
        AND e1.scope = e2.scope
      WHERE 1 - (emb1.embedding <=> emb2.embedding) > $1
      LIMIT 100
    `, DEDUP_THRESHOLD);

    for (const dup of duplicates) {
      const sim = Number(dup.similarity) || 0;
      if (sim < DEDUP_THRESHOLD) continue;

      // Keep the memory with higher combined score
      const score1 = (Number(dup.imp1) || 0) + (Number(dup.str1) || 0) + (Number(dup.ac1) || 0) * 0.01;
      const score2 = (Number(dup.imp2) || 0) + (Number(dup.str2) || 0) + (Number(dup.ac2) || 0) * 0.01;

      const keepId = score1 >= score2 ? dup.id1 : dup.id2;
      const removeId = score1 >= score2 ? dup.id2 : dup.id1;

      try {
        // Transfer associations from removed entry to kept entry
        await db.$executeRawUnsafe(`
          UPDATE memory_associations
          SET source_entry_id = $1
          WHERE source_entry_id = $2
            AND target_entry_id != $1
          ON CONFLICT (source_entry_id, target_entry_id) DO NOTHING
        `, keepId, removeId);

        await db.$executeRawUnsafe(`
          UPDATE memory_associations
          SET target_entry_id = $1
          WHERE target_entry_id = $2
            AND source_entry_id != $1
          ON CONFLICT (source_entry_id, target_entry_id) DO NOTHING
        `, keepId, removeId);

        // Boost the kept memory (it absorbed another)
        await db.$executeRawUnsafe(`
          UPDATE memory_entries SET
            strength = LEAST(1.0, strength + 0.05),
            access_count = access_count + $2
          WHERE id = $1
        `, keepId, Number(score1 >= score2 ? dup.ac2 : dup.ac1) || 0);

        // Delete the duplicate
        await db.memoryEntry.delete({ where: { id: removeId } });
        merged++;
      } catch {
        // Skip this pair if there's a constraint violation
      }
    }

    return merged;
  }

  /**
   * Clean up stale associations:
   * - Remove associations where one side has been deleted
   * - Weaken associations that haven't been reinforced
   */
  private async cleanAssociations(): Promise<number> {
    const db = getDb();

    // Remove orphaned associations (where source or target no longer exists)
    const orphaned = await db.$executeRawUnsafe(`
      DELETE FROM memory_associations ma
      WHERE NOT EXISTS (SELECT 1 FROM memory_entries me WHERE me.id = ma.source_entry_id)
         OR NOT EXISTS (SELECT 1 FROM memory_entries me WHERE me.id = ma.target_entry_id)
    `);

    // Remove very weak associations
    const weak = await db.$executeRawUnsafe(`
      DELETE FROM memory_associations WHERE weight < 0.1
    `);

    const total = (typeof orphaned === 'number' ? orphaned : 0) +
                  (typeof weak === 'number' ? weak : 0);
    return total;
  }
}
