import type { MemoryService } from './memory-service.js';

// ---------------------------------------------------------------------------
// MemoryExtractor — automatic fact extraction from conversations
//
// After a conversation turn, this service analyzes the exchange and stores
// important user-provided facts as semantic memories. This ensures
// information is captured even when the LLM doesn't proactively call
// `store_memory`.
//
// Everything goes through the unified semantic memory system — no separate
// profile or goal tables.
// ---------------------------------------------------------------------------

/**
 * Patterns that identify statements worth storing as memories.
 * These match "factual" statements the user makes about themselves or their situation.
 */
const FACT_PATTERNS: RegExp[] = [
  /\bI (?:have|own|use|prefer|like|love|hate|dislike|need|want)\b/i,
  /\bmy (?:name|job|role|company|team|project|goal|plan|budget|account|portfolio)\b/i,
  /\bI (?:work|live|study|invest|trade|develop|manage|run)\b/i,
  /\bI'm (?:a|an|the|interested|looking|trying|planning|working|building)\b/i,
  /\bI (?:recently|just|already|always|usually|currently|previously)\b/i,
  /\b(?:I'm|I am|my name is|call me)\s+[A-Z]/i,
];

export interface ExtractionResult {
  memoriesStored: number;
}

export class MemoryExtractor {
  constructor(private memoryService: MemoryService) {}

  /**
   * Analyze a conversation exchange and extract facts to store as semantic memories.
   */
  async extractAndStore(
    userMessage: string,
    _aiResponse: string,
    userId: string | null,
    _teamId: string | null,
  ): Promise<ExtractionResult> {
    let memoriesStored = 0;

    // Skip very short messages or greetings
    if (userMessage.length < 10 || /^(hi|hello|hey|thanks|ok|yes|no|bye)\b/i.test(userMessage.trim())) {
      return { memoriesStored };
    }

    const scope = userId ? 'personal' as const : 'global' as const;
    const scopeOwnerId = userId;

    // Split user message into sentences
    const sentences = userMessage
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    for (const sentence of sentences) {
      // Check if this sentence matches any fact pattern
      const isFact = FACT_PATTERNS.some((p) => p.test(sentence));
      if (!isFact) continue;

      // Determine importance based on content signals
      let importance = 0.5;
      if (/\b(very|really|extremely|critical|important|always|never)\b/i.test(sentence)) {
        importance = 0.7;
      }
      if (/\b(name|goal|budget|salary|investment|account)\b/i.test(sentence)) {
        importance = 0.75;
      }

      try {
        // Check for duplicate/similar memories before storing
        const existing = await this.memoryService.search(
          sentence,
          scope,
          scopeOwnerId,
          3,
          { strengthenOnRecall: false },
        );

        // Skip if a very similar memory already exists
        const hasSimilar = existing.some((m) => m.similarity > 0.85);
        if (hasSimilar) continue;

        await this.memoryService.store(
          scope,
          scopeOwnerId,
          'conversation',
          `User said: ${sentence}`,
          importance,
          'conversation',
        );
        memoriesStored++;
      } catch {
        // Memory storage failed — continue
      }
    }

    return { memoriesStored };
  }
}
