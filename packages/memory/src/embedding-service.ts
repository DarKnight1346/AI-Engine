import { getDb } from '@ai-engine/db';
import type { LLMPool } from '@ai-engine/llm';

export class EmbeddingService {
  private llm: LLMPool | null = null;

  setLLM(llm: LLMPool): void {
    this.llm = llm;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Use Claude to generate a text summary, then hash it into a pseudo-embedding
    // In production, you'd use a dedicated embedding model or API
    // For now, we generate a deterministic embedding from the text
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
    // Simple deterministic hash-based pseudo-embedding (FNV-1a variant)
    // Replace with real embedding API in production
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
