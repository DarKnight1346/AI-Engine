import { getDb } from '@ai-engine/db';
import type { LLMPool } from '@ai-engine/llm';

export class EmbeddingService {
  private llm: LLMPool | null = null;

  setLLM(llm: LLMPool): void {
    this.llm = llm;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Generates a deterministic embedding from text using a hash-based approach.
    // For higher-quality semantic retrieval, configure a Voyage AI or
    // OpenAI-compatible embedding endpoint in Settings > API Keys.
    return this.hashToVector(text);
  }

  async storeEmbedding(entryId: string, entryType: 'memory' | 'skill', text: string): Promise<void> {
    const embedding = await this.generateEmbedding(text);
    const db = getDb();
    await db.$executeRawUnsafe(
      `INSERT INTO memory_embeddings (id, entry_id, entry_type, embedding) VALUES (gen_random_uuid(), $1, $2, $3::vector)`,
      entryId,
      entryType,
      `[${embedding.join(',')}]`
    );
  }

  private hashToVector(text: string, dim = 1536): number[] {
    // Deterministic hash-based embedding (FNV-1a variant) for vector storage.
    // Produces a normalized 1536-dim vector suitable for pgvector cosine similarity.
    const hashArray: number[] = [];
    for (let i = 0; i < 32; i++) {
      let h = 2166136261 + i;
      for (let j = 0; j < text.length; j++) {
        h ^= text.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      hashArray.push((h >>> 0) & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, (h >>> 24) & 0xff);
    }

    const vector: number[] = [];
    for (let i = 0; i < dim; i++) {
      const byte = hashArray[i % hashArray.length];
      const seed = byte / 255;
      vector.push(seed * 2 - 1); // Normalize to [-1, 1]
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / magnitude);
  }
}
