import { getDb } from '@ai-engine/db';
import { EmbeddingService } from './embedding-service.js';
import type { MemoryEntry, MemoryScope, MemoryEntryType } from '@ai-engine/shared';

export class MemoryService {
  constructor(private embeddings: EmbeddingService) {}

  async store(scope: MemoryScope, scopeOwnerId: string | null, type: MemoryEntryType, content: string, importance = 0.5): Promise<MemoryEntry> {
    const db = getDb();
    const entry = await db.memoryEntry.create({
      data: { scope, scopeOwnerId, type, content, importance },
    });
    // Generate and store embedding
    await this.embeddings.storeEmbedding(entry.id, 'memory', content);
    return this.mapEntry(entry);
  }

  async search(query: string, scope: MemoryScope, scopeOwnerId: string | null, limit = 10): Promise<MemoryEntry[]> {
    const embedding = await this.embeddings.generateEmbedding(query);
    const db = getDb();
    // Use raw query for pgvector cosine similarity
    const results = await db.$queryRawUnsafe<any[]>(
      `
      SELECT me.*, 1 - (emb.embedding <=> $1::vector) as similarity
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
      limit
    );

    return results.map(this.mapEntry);
  }

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

  private mapEntry(e: any): MemoryEntry {
    return {
      id: e.id,
      scope: e.scope as MemoryScope,
      scopeOwnerId: e.scopeOwnerId,
      type: e.type as MemoryEntryType,
      content: e.content,
      importance: e.importance,
      createdAt: e.createdAt,
    };
  }
}
