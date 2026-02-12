import { getDb } from '@ai-engine/db';
import { EmbeddingService } from '@ai-engine/memory';
import type { Skill, SkillSearchResult } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

export class SkillService {
  constructor(private embeddings: EmbeddingService) {}

  async createSkill(data: {
    name: string;
    description: string;
    category: string;
    instructions: string;
    toolSequenceJson?: Record<string, unknown>[];
    codeSnippet?: string;
    requiredCapabilities?: string[];
    createdBy?: string;
  }): Promise<Skill> {
    const db = getDb();
    const skill = await db.skill.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        instructions: data.instructions,
        toolSequenceJson: data.toolSequenceJson ? JSON.parse(JSON.stringify(data.toolSequenceJson)) : undefined,
        codeSnippet: data.codeSnippet,
        requiredCapabilities: data.requiredCapabilities ?? [],
        createdBy: data.createdBy ?? 'user',
      },
    });

    // Create version snapshot
    await db.skillVersion.create({
      data: {
        skillId: skill.id,
        version: 1,
        contentSnapshot: { name: skill.name, description: skill.description, instructions: skill.instructions },
      },
    });

    // Index for search
    await this.embeddings.storeEmbedding(skill.id, 'skill', `${skill.name}: ${skill.description}`);

    return this.mapSkill(skill);
  }

  async getSkill(id: string): Promise<Skill | null> {
    const db = getDb();
    const skill = await db.skill.findUnique({ where: { id } });
    return skill ? this.mapSkill(skill) : null;
  }

  async searchSkills(query: string, limit = DEFAULT_CONFIG.skills.searchResultLimit): Promise<SkillSearchResult[]> {
    const embedding = await this.embeddings.generateEmbedding(query);
    const db = getDb();

    const results = await db.$queryRawUnsafe<any[]>(
      `
      SELECT s.id, s.name, s.description, s.category,
             1 - (emb.embedding <=> $1::vector) as relevance_score
      FROM skills s
      JOIN memory_embeddings emb ON emb.entry_id = s.id AND emb.entry_type = 'skill'
      WHERE s.is_active = true
      ORDER BY emb.embedding <=> $1::vector
      LIMIT $2
    `,
      `[${embedding.join(',')}]`,
      limit
    );

    // Also do keyword search as fallback
    const keywordResults = await db.skill.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
    });

    // Merge and deduplicate
    const seen = new Set<string>();
    const merged: SkillSearchResult[] = [];

    for (const r of results) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push({ id: r.id, name: r.name, description: r.description, category: r.category, relevanceScore: r.relevance_score });
      }
    }

    for (const r of keywordResults) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push({ id: r.id, name: r.name, description: r.description, category: r.category, relevanceScore: 0.5 });
      }
    }

    return merged.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, limit);
  }

  async incrementUsage(skillId: string): Promise<void> {
    const db = getDb();
    await db.skill.update({ where: { id: skillId }, data: { usageCount: { increment: 1 } } });
  }

  async getPinnedSkills(agentId: string, stageId?: string): Promise<Skill[]> {
    const db = getDb();
    const pins = await db.agentPinnedSkill.findMany({
      where: { agentId, ...(stageId ? { workflowStageId: stageId } : {}) },
      include: { skill: true },
    });
    return pins.map((p: { skill: any }) => this.mapSkill(p.skill));
  }

  async pinSkill(agentId: string, skillId: string, stageId?: string): Promise<void> {
    const db = getDb();
    await db.agentPinnedSkill.upsert({
      where: { agentId_skillId: { agentId, skillId } },
      create: { agentId, skillId, workflowStageId: stageId },
      update: { workflowStageId: stageId },
    });
  }

  async listSkills(category?: string, activeOnly = true): Promise<Skill[]> {
    const db = getDb();
    const skills = await db.skill.findMany({
      where: { ...(activeOnly ? { isActive: true } : {}), ...(category ? { category } : {}) },
      orderBy: { usageCount: 'desc' },
    });
    return skills.map(this.mapSkill);
  }

  private mapSkill(s: any): Skill {
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      instructions: s.instructions,
      toolSequenceJson: s.toolSequenceJson as any,
      codeSnippet: s.codeSnippet,
      requiredCapabilities: s.requiredCapabilities as string[],
      version: s.version,
      isActive: s.isActive,
      usageCount: s.usageCount,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
    };
  }
}
