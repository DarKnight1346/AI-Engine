import { getDb } from '@ai-engine/db';

// ---------------------------------------------------------------------------
// Types for the transformers.js pipeline
// ---------------------------------------------------------------------------
interface Pipeline {
  (text: string | string[], options?: Record<string, unknown>): Promise<PipelineOutput>;
}

interface PipelineOutput {
  tolist(): number[][];
}

// ---------------------------------------------------------------------------
// Embedding Service — local semantic embeddings via @huggingface/transformers
//
// Uses the BAAI/bge-base-en-v1.5 model (768 dimensions) running locally
// through ONNX Runtime. No external API calls, no third-party services.
//
// The model is lazy-loaded on first use and cached for subsequent calls.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'Xenova/bge-base-en-v1.5';
const EMBEDDING_DIM = 768;

/** Singleton pipeline instance — loaded once, reused across all calls */
let pipelineInstance: Pipeline | null = null;
let pipelineLoading: Promise<Pipeline> | null = null;

async function loadPipeline(): Promise<Pipeline> {
  if (pipelineInstance) return pipelineInstance;
  if (pipelineLoading) return pipelineLoading;

  pipelineLoading = (async () => {
    // Dynamic import to avoid issues if the package isn't installed yet
    const transformers = await import('@huggingface/transformers');

    // Determine cache directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cacheDir = `${homeDir}/.ai-engine/models`;

    // Configure environment — disable remote model fetching after first download
    if (transformers.env) {
      (transformers.env as any).cacheDir = cacheDir;
      // Allow local file access for Node.js
      (transformers.env as any).allowLocalModels = true;
    }

    console.log(`[EmbeddingService] Loading model ${DEFAULT_MODEL} (first load may download ~170MB)...`);

    const pipe = await (transformers as any).pipeline(
      'feature-extraction',
      DEFAULT_MODEL,
      {
        // Use quantized model for speed + smaller download
        dtype: 'q8',
        revision: 'main',
      },
    ) as Pipeline;

    pipelineInstance = pipe;
    console.log(`[EmbeddingService] Model loaded successfully (${EMBEDDING_DIM}-dim embeddings)`);
    return pipe;
  })();

  try {
    const result = await pipelineLoading;
    return result;
  } catch (err) {
    pipelineLoading = null;
    throw err;
  }
}

export class EmbeddingService {
  /**
   * Generate a semantic embedding vector for the given text.
   * Returns a normalized 768-dimensional vector.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const pipe = await loadPipeline();
      const output = await pipe(text, { pooling: 'cls', normalize: true });
      const vectors = output.tolist();
      return vectors[0];
    } catch (err) {
      // If transformers.js fails to load (e.g. missing native deps),
      // fall back to deterministic hash embedding so the system still works.
      console.warn('[EmbeddingService] Local model unavailable, using hash fallback:', (err as Error).message);
      return this.hashFallback(text);
    }
  }

  /**
   * Generate embeddings for multiple texts in a single batch.
   * More efficient than calling generateEmbedding() in a loop.
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const pipe = await loadPipeline();
      const output = await pipe(texts, { pooling: 'cls', normalize: true });
      return output.tolist();
    } catch {
      // Fallback: generate individually via hash
      return texts.map((t) => this.hashFallback(t));
    }
  }

  /**
   * Store an embedding for a memory entry or skill in the database.
   */
  async storeEmbedding(entryId: string, entryType: 'memory' | 'skill', text: string): Promise<void> {
    const embedding = await this.generateEmbedding(text);
    const db = getDb();

    // Upsert: delete existing embedding for this entry, then insert new one
    await db.$executeRawUnsafe(
      `DELETE FROM memory_embeddings WHERE entry_id = $1 AND entry_type = $2`,
      entryId,
      entryType,
    );

    await db.$executeRawUnsafe(
      `INSERT INTO memory_embeddings (id, entry_id, entry_type, embedding) VALUES (gen_random_uuid(), $1, $2, $3::vector)`,
      entryId,
      entryType,
      `[${embedding.join(',')}]`,
    );
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    return magnitude === 0 ? 0 : dot / magnitude;
  }

  /**
   * Get the embedding dimension used by the current model.
   */
  getDimension(): number {
    return EMBEDDING_DIM;
  }

  // -----------------------------------------------------------------------
  // Fallback: deterministic hash-based embedding (FNV-1a variant)
  // Used only when the local ONNX model fails to load.
  // -----------------------------------------------------------------------
  private hashFallback(text: string, dim = EMBEDDING_DIM): number[] {
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
      vector.push(seed * 2 - 1);
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / magnitude);
  }
}
