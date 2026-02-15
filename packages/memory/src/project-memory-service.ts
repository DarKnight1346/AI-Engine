import type { MemoryService } from './memory-service.js';
import type { EmbeddingService } from './embedding-service.js';
import type { ScoredMemoryEntry } from '@ai-engine/shared';
import type { Prisma } from '@ai-engine/db';

/**
 * ProjectMemoryService - Specialized memory management for project planning
 * 
 * ## Problem: Context Management in Long Planning Sessions
 * During planning mode, conversations can become very long (50+ messages).
 * Loading the entire conversation history would overflow context windows.
 * 
 * ## Solution: Semantic Memory with Zero Decay
 * Instead of loading full conversation history:
 * 1. Extract key facts, decisions, and requirements from each message
 * 2. Store them as project-scoped memories with ZERO decay (permanent)
 * 3. Retrieve only semantically relevant memories when building AI context
 * 
 * ## Memory Scoping: Project vs User Separation
 * 
 * **Project Requirements** (scope='team', scopeOwnerId=projectId):
 * - Features, specifications, technical decisions
 * - Architecture choices, constraints, design decisions
 * - Target audience, business requirements
 * - Stored with decayRate=0.0 (NEVER forgotten)
 * - NEVER pollutes user or team context
 * 
 * **User Information** (scope='personal', scopeOwnerId=userId):
 * - Personal preferences ("I prefer React")
 * - User background ("I'm a backend developer")
 * - Working style preferences
 * - Stored with normal decayRate=0.15 (fades over time)
 * - Kept separate from project requirements
 * 
 * This architecture ensures:
 * - Project knowledge is permanent and never mixes with personal context
 * - Context stays manageable (15-50 memories vs 100+ messages)
 * - Semantic search retrieves only relevant information
 * - No pollution between projects, users, or teams
 */
export class ProjectMemoryService {
  constructor(
    private memoryService: MemoryService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Extract and store memories from a planning conversation message
   * 
   * IMPORTANT: Project memories are stored separately from user memories:
   * - Project requirements/decisions: scope='team', scopeOwnerId=projectId (NEVER decay)
   * - Personal user info: scope='personal', scopeOwnerId=userId (normal decay)
   * 
   * This ensures project requirements never pollute user context and never decay.
   */
  async extractPlanningMemories(
    projectId: string,
    userMessage: string,
    aiResponse: string,
    userId?: string,
  ): Promise<{ memoriesStored: number; userMemoriesStored: number }> {
    let memoriesStored = 0;
    let userMemoriesStored = 0;

    // Extract facts from user message
    const extractedFacts = this.extractFactsFromMessage(userMessage, 'user');
    
    for (const fact of extractedFacts) {
      try {
        // Determine if this is project-related or user-related
        if (fact.isProjectRequirement) {
          // Store as PROJECT memory (scope=team, owner=projectId)
          // CRITICAL: Use decayRate=0 so project requirements NEVER decay
          await this.storeProjectMemory(
            projectId,
            'knowledge',
            fact.content,
            fact.importance,
          );
          memoriesStored++;
        } else if (fact.isUserInfo && userId) {
          // Store as USER memory (scope=personal, owner=userId)
          // Uses normal decay (0.15) for personal information
          await this.memoryService.store(
            'personal',
            userId,
            'conversation',
            fact.content,
            fact.importance,
            'conversation',
          );
          userMemoriesStored++;
        }
      } catch (error) {
        console.error('Failed to store memory:', error);
      }
    }

    // Extract key insights from AI response (always project-scoped)
    const aiInsights = this.extractInsightsFromAI(aiResponse);
    for (const insight of aiInsights) {
      try {
        await this.storeProjectMemory(
          projectId,
          'reflection',
          insight.content,
          insight.importance,
        );
        memoriesStored++;
      } catch (error) {
        console.error('Failed to store AI insight:', error);
      }
    }

    return { memoriesStored, userMemoriesStored };
  }

  /**
   * Store a project-specific memory with ZERO decay
   * Project memories are permanent and scoped to the project
   */
  private async storeProjectMemory(
    projectId: string,
    type: 'knowledge' | 'reflection',
    content: string,
    importance: number,
  ): Promise<void> {
    const { getDb } = await import('@ai-engine/db');
    const db = getDb();

    // Generate embedding using injected service (not private MemoryService internals)
    const embedding = await this.embeddingService.generateEmbedding(content);

    // Create memory entry with ZERO decay (project requirements never fade)
    const data: Prisma.MemoryEntryUncheckedCreateInput = {
      scope: 'team',
      scopeOwnerId: projectId,
      type,
      content,
      importance,
      strength: 1.0,
      decayRate: 0.0, // CRITICAL: Zero decay for project memories
      accessCount: 0,
      source: 'conversation',
    };
    const entry = await db.memoryEntry.create({ data });

    // Store embedding
    await db.$executeRawUnsafe(
      `INSERT INTO memory_embeddings (id, entry_id, entry_type, embedding)
       VALUES (gen_random_uuid(), $1, 'memory', $2::vector)`,
      entry.id,
      `[${embedding.join(',')}]`,
    );
  }

  /**
   * Store a structured requirement as a memory (ZERO decay)
   */
  async storeRequirement(
    projectId: string,
    category: string,
    content: string,
    importance: number = 0.9,
  ): Promise<void> {
    const formattedContent = `[${category}] ${content}`;
    
    // Store with zero decay - project requirements are permanent
    await this.storeProjectMemory(
      projectId,
      'knowledge',
      formattedContent,
      importance,
    );
  }

  /**
   * Store a design decision as a memory (ZERO decay)
   */
  async storeDecision(
    projectId: string,
    decision: string,
    rationale: string,
    importance: number = 0.85,
  ): Promise<void> {
    const content = `DECISION: ${decision}\nRationale: ${rationale}`;
    
    // Store with zero decay - decisions are permanent
    await this.storeProjectMemory(
      projectId,
      'reflection',
      content,
      importance,
    );
  }

  /**
   * Retrieve relevant project context for AI
   * 
   * ONLY searches project-scoped memories (scope='team', scopeOwnerId=projectId)
   * This ensures project context never mixes with user or team context
   */
  async getRelevantContext(
    projectId: string,
    query: string,
    limit: number = 15,
  ): Promise<ScoredMemoryEntry[]> {
    // Search ONLY in project scope (team/projectId)
    return await this.memoryService.search(
      query,
      'team',
      projectId, // scopeOwnerId = projectId keeps it isolated
      limit,
      {
        strengthenOnRecall: false, // Don't strengthen - project memories have zero decay anyway
        weights: {
          similarity: 0.40,    // Semantic relevance most important
          strength: 0.15,      // All project memories have strength=1.0 (no decay)
          recency: 0.10,       // Slight preference for recent additions
          importance: 0.35,    // High importance facts critical
          frequency: 0.00,     // Frequency doesn't matter for project planning
        },
      },
    );
  }

  /**
   * Get comprehensive project knowledge (for PRD generation)
   * 
   * Uses multi-hop deep search to gather ALL project information.
   * ONLY searches project-scoped memories to avoid pollution.
   */
  async getComprehensiveKnowledge(
    projectId: string,
    query: string,
    limit: number = 50,
  ): Promise<ScoredMemoryEntry[]> {
    // Deep search ONLY in project scope
    return await this.memoryService.deepSearch(
      query,
      'team',
      projectId, // scopeOwnerId = projectId keeps it isolated
      limit,
      3, // 3 hops for comprehensive associative recall
    );
  }

  /**
   * Extract facts from user message
   * Classifies each fact as project-related or user-related
   */
  private extractFactsFromMessage(
    message: string,
    _source: 'user' | 'ai',
  ): Array<{ 
    content: string; 
    importance: number; 
    isProjectRequirement: boolean;
    isUserInfo: boolean;
  }> {
    const facts: Array<{ 
      content: string; 
      importance: number;
      isProjectRequirement: boolean;
      isUserInfo: boolean;
    }> = [];

    // Skip very short messages
    if (message.length < 15) return facts;

    // Split into sentences
    const sentences = message
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    for (const sentence of sentences) {
      const fact = this.analyzeSentence(sentence);
      if (fact) {
        facts.push(fact);
      }
    }

    return facts;
  }

  /**
   * Analyze a sentence to determine if it's worth storing
   * Also determines if it's project-related or user-related
   */
  private analyzeSentence(sentence: string): { 
    content: string; 
    importance: number;
    isProjectRequirement: boolean;
    isUserInfo: boolean;
  } | null {
    let importance = 0.5;
    let shouldStore = false;
    let isProjectRequirement = false;
    let isUserInfo = false;

    // Project goals and objectives - PROJECT REQUIREMENT
    if (/\b(want to|need to|goal|objective|purpose|solve|build|project)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.95;
    }

    // User requirements - PROJECT REQUIREMENT
    if (/\b(must have|required|requirement|should|need|expect)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.9;
    }

    // Technical preferences - PROJECT REQUIREMENT
    if (/\b(use|using|prefer|technology|framework|database|platform|deploy)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.85;
    }

    // User personas and target audience - PROJECT REQUIREMENT
    if (/\b(user|users|audience|customer|people who|target)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.8;
    }

    // Features and functionality - PROJECT REQUIREMENT
    if (/\b(feature|function|capability|can|will|allow|enable)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.75;
    }

    // Design and UX - PROJECT REQUIREMENT
    if (/\b(design|interface|UI|UX|look|feel|style|layout)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.7;
    }

    // Constraints and limitations - PROJECT REQUIREMENT
    if (/\b(limit|constraint|restriction|cannot|shouldn't|avoid)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.85;
    }

    // Timeline and priorities - PROJECT REQUIREMENT
    if (/\b(MVP|priority|first|later|phase|version|deadline|timeline)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.8;
    }

    // Integration requirements - PROJECT REQUIREMENT
    if (/\b(integrate|integration|connect|API|third-party|service)\b/i.test(sentence)) {
      shouldStore = true;
      isProjectRequirement = true;
      importance = 0.8;
    }

    // Personal user information - USER INFO (not project-related)
    if (/\b(I am|my name|I work|I'm a|I prefer|I like|I usually)\b/i.test(sentence) && 
        !/\b(want to build|need to create|project|application|app)\b/i.test(sentence)) {
      shouldStore = true;
      isUserInfo = true;
      isProjectRequirement = false; // Override if it was set
      importance = 0.6;
    }

    if (!shouldStore) return null;

    return {
      content: sentence,
      importance,
      isProjectRequirement,
      isUserInfo,
    };
  }

  /**
   * Extract insights from AI response
   */
  private extractInsightsFromAI(response: string): Array<{ content: string; importance: number }> {
    const insights: Array<{ content: string; importance: number }> = [];

    // Look for questions AI is asking (these indicate gaps in requirements)
    const questions = response.match(/^[?-]\s*(.+?)$/gm) || [];
    for (const question of questions) {
      const cleaned = question.replace(/^[?-]\s*/, '').trim();
      if (cleaned.length > 10) {
        insights.push({
          content: `CLARIFICATION NEEDED: ${cleaned}`,
          importance: 0.7,
        });
      }
    }

    // Look for AI summarizing requirements (usually after "Based on" or "I understand")
    const summaryMatch = response.match(/(?:Based on|I understand|Summary:)(.{50,500})/is);
    if (summaryMatch) {
      const summary = summaryMatch[1].trim();
      insights.push({
        content: `AI UNDERSTANDING: ${summary}`,
        importance: 0.75,
      });
    }

    // Look for technical recommendations
    const techPattern = /(?:recommend|suggest|propose|consider using)\s+(.{20,200})/gi;
    const techMatches = response.matchAll(techPattern);
    for (const match of techMatches) {
      insights.push({
        content: `RECOMMENDATION: ${match[1].trim()}`,
        importance: 0.65,
      });
    }

    return insights;
  }

  /**
   * Consolidate all project memories into a structured summary
   * Used for final PRD generation
   */
  async consolidateProjectKnowledge(projectId: string): Promise<{
    requirements: string[];
    decisions: string[];
    constraints: string[];
    features: string[];
  }> {
    // Get all project memories sorted by importance
    const memories = await this.memoryService.search(
      'project requirements features goals', // Broad query to get everything
      'team',
      projectId,
      100, // Get many memories
      { strengthenOnRecall: false },
    );

    const requirements: string[] = [];
    const decisions: string[] = [];
    const constraints: string[] = [];
    const features: string[] = [];

    for (const memory of memories) {
      const content = memory.content;

      if (content.includes('DECISION:')) {
        decisions.push(content);
      } else if (/\b(must|required|requirement|need)\b/i.test(content)) {
        requirements.push(content);
      } else if (/\b(constraint|limit|cannot|restriction)\b/i.test(content)) {
        constraints.push(content);
      } else if (/\b(feature|function|capability)\b/i.test(content)) {
        features.push(content);
      } else {
        // General requirement
        requirements.push(content);
      }
    }

    return {
      requirements,
      decisions,
      constraints,
      features,
    };
  }
}
