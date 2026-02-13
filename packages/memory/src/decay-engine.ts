import { getDb } from '@ai-engine/db';
import type { MemoryEntry } from '@ai-engine/shared';

// ---------------------------------------------------------------------------
// Ebbinghaus Decay Engine
//
// Models human-like memory decay using the Ebbinghaus forgetting curve:
//
//   effectiveStrength = strength × e^(-decayRate × hoursSinceLastAccess)
//
// Key behaviors:
//   - Memories naturally fade over time unless reinforced
//   - Each recall BOOSTS strength and REDUCES decay rate (spaced repetition)
//   - High-importance memories decay slower (importance as decay resistance)
//   - Effective strength is computed at query time (no cron needed)
// ---------------------------------------------------------------------------

/**
 * Compute the effective (current) strength of a memory after time-based decay.
 *
 * The forgetting curve is modulated by importance: high-importance memories
 * resist decay more strongly, simulating emotional salience in human memory.
 */
export function computeEffectiveStrength(entry: MemoryEntry): number {
  const now = Date.now();
  const lastAccessed = entry.lastAccessedAt instanceof Date
    ? entry.lastAccessedAt.getTime()
    : new Date(entry.lastAccessedAt).getTime();

  const hoursSinceAccess = Math.max(0, (now - lastAccessed) / (1000 * 60 * 60));

  // Importance modulates decay resistance: importance 1.0 → decay rate × 0.3
  // importance 0.0 → decay rate × 1.0 (no resistance)
  const decayResistance = 1 - (entry.importance * 0.7);
  const effectiveDecayRate = entry.decayRate * decayResistance;

  // Ebbinghaus forgetting curve: S(t) = S₀ × e^(-λt)
  const effectiveStrength = entry.strength * Math.exp(-effectiveDecayRate * hoursSinceAccess);

  return Math.max(0, Math.min(1, effectiveStrength));
}

/**
 * Compute a recency score based on how recently the memory was created.
 * Returns 0–1 where 1 is brand-new and approaches 0 over days.
 *
 * Uses a half-life of 72 hours (3 days).
 */
export function computeRecencyScore(entry: MemoryEntry): number {
  const now = Date.now();
  const created = entry.createdAt instanceof Date
    ? entry.createdAt.getTime()
    : new Date(entry.createdAt).getTime();

  const hoursSinceCreation = Math.max(0, (now - created) / (1000 * 60 * 60));
  const halfLifeHours = 72; // 3 days
  return Math.exp(-0.693 * hoursSinceCreation / halfLifeHours);
}

/**
 * Compute an access frequency score, log-scaled.
 * Returns 0–1 where more frequently accessed memories score higher.
 */
export function computeFrequencyScore(entry: MemoryEntry): number {
  // log1p gives log(1 + x), so 0 accesses = 0, 10 accesses ≈ 0.80, 100 ≈ 1.0
  return Math.min(1, Math.log1p(entry.accessCount) / Math.log1p(100));
}

/**
 * Record that a memory was recalled (accessed).
 * Strengthens the memory and slows its decay — mimicking spaced repetition.
 *
 * - strength increases asymptotically toward 1.0
 * - decayRate decreases by 15% each recall (minimum 0.01)
 * - accessCount increments
 * - lastAccessedAt is updated
 */
export async function onRecall(entryId: string): Promise<void> {
  const db = getDb();

  // Use a single raw update for atomicity and performance
  await db.$executeRawUnsafe(
    `UPDATE memory_entries SET
       strength = LEAST(1.0, strength + 0.1 * (1.0 - strength)),
       decay_rate = GREATEST(0.01, decay_rate * 0.85),
       access_count = access_count + 1,
       last_accessed_at = NOW()
     WHERE id = $1`,
    entryId,
  );
}

/**
 * Batch-recall: strengthen multiple memories at once.
 * Used when the context builder retrieves memories for a conversation.
 */
export async function onBatchRecall(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;

  const db = getDb();

  // Build a parameterized IN clause
  const placeholders = entryIds.map((_, i) => `$${i + 1}`).join(', ');
  await db.$executeRawUnsafe(
    `UPDATE memory_entries SET
       strength = LEAST(1.0, strength + 0.1 * (1.0 - strength)),
       decay_rate = GREATEST(0.01, decay_rate * 0.85),
       access_count = access_count + 1,
       last_accessed_at = NOW()
     WHERE id IN (${placeholders})`,
    ...entryIds,
  );
}

/**
 * Weaken memories that haven't been accessed in a long time.
 * Called periodically by the consolidation service.
 *
 * Persists the effective strength for memories that have decayed significantly,
 * so future queries don't need to recompute across huge time spans.
 */
export async function persistDecay(): Promise<number> {
  const db = getDb();

  // Update strength for memories not accessed in the last 24 hours
  // using the Ebbinghaus formula computed in SQL
  const result = await db.$executeRawUnsafe(`
    UPDATE memory_entries SET
      strength = GREATEST(0, LEAST(1.0,
        strength * EXP(
          -1.0 * decay_rate * (1.0 - importance * 0.7) *
          EXTRACT(EPOCH FROM (NOW() - last_accessed_at)) / 3600.0
        )
      )),
      last_accessed_at = NOW()
    WHERE last_accessed_at < NOW() - INTERVAL '24 hours'
      AND strength > 0.01
  `);

  return typeof result === 'number' ? result : 0;
}
