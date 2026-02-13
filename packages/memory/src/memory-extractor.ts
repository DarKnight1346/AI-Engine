import { getDb } from '@ai-engine/db';
import type { MemoryService } from './memory-service.js';

// ---------------------------------------------------------------------------
// MemoryExtractor — automatic fact extraction from conversations
//
// After a conversation turn, this service analyzes the exchange and stores
// important user-provided facts as memories. This ensures information is
// captured even when the LLM doesn't proactively call `store_memory`.
//
// It also auto-populates UserProfile entries for common personal attributes
// (name, preferences, etc.) so they're always available in future prompts.
// ---------------------------------------------------------------------------

/** Patterns that extract key = value pairs from user messages */
const PROFILE_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  valueGroup: number;
  confidence: number;
}> = [
  // Name declarations
  { pattern: /\b(?:I'm|I am|my name is|call me|name's|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, key: 'name', valueGroup: 1, confidence: 0.95 },
  // Location
  { pattern: /\b(?:I live in|I'm in|I'm from|I am in|I am from|based in|located in)\s+([A-Z][a-zA-Z\s,]+)/i, key: 'location', valueGroup: 1, confidence: 0.85 },
  // Job / role
  { pattern: /\b(?:I work as|I'm a|I am a|my job is|my role is|I work at|I work for)\s+(.+?)(?:\.|$)/i, key: 'occupation', valueGroup: 1, confidence: 0.85 },
  // Services / accounts
  { pattern: /\b(?:I (?:have|use|got) (?:an? )?(?:account (?:at|with|on)))\s+(.+?)(?:\.|,|$)/i, key: 'financial_account', valueGroup: 1, confidence: 0.85 },
  { pattern: /\b(?:I use|I'm using|I prefer)\s+(.+?)(?:\s+for\s+|$)/i, key: 'tools_used', valueGroup: 1, confidence: 0.7 },
];

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
];

export interface ExtractionResult {
  profileUpdates: number;
  memoriesStored: number;
}

export class MemoryExtractor {
  constructor(private memoryService: MemoryService) {}

  /**
   * Analyze a conversation exchange and extract facts to store.
   *
   * @param userMessage - The user's message
   * @param aiResponse - The AI's response
   * @param userId - The user's ID (for profile storage)
   * @param teamId - Optional team ID
   */
  async extractAndStore(
    userMessage: string,
    aiResponse: string,
    userId: string | null,
    teamId: string | null,
  ): Promise<ExtractionResult> {
    let profileUpdates = 0;
    let memoriesStored = 0;

    // Skip very short messages or greetings
    if (userMessage.length < 10 || /^(hi|hello|hey|thanks|ok|yes|no|bye)\b/i.test(userMessage.trim())) {
      return { profileUpdates, memoriesStored };
    }

    // ── 1. Extract profile attributes ──────────────────────────────
    if (userId) {
      const db = getDb();

      for (const { pattern, key, valueGroup, confidence } of PROFILE_PATTERNS) {
        const match = userMessage.match(pattern);
        if (match && match[valueGroup]) {
          const value = match[valueGroup].trim().replace(/[.,!?]+$/, '');
          if (value.length < 2 || value.length > 200) continue;

          try {
            // Check if we already have this exact value
            const existing = await db.userProfile.findFirst({
              where: { userId, key },
            });

            if (!existing || existing.value.toLowerCase() !== value.toLowerCase()) {
              if (existing) {
                await db.userProfile.update({
                  where: { id: existing.id },
                  data: { value, confidence },
                });
              } else {
                await db.userProfile.create({
                  data: { userId, key, value, confidence },
                });
              }
              profileUpdates++;
            }
          } catch {
            // Profile update failed — continue
          }
        }
      }
    }

    // ── 2. Extract factual statements as memories ──────────────────
    // Split user message into sentences
    const sentences = userMessage
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

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

      // Determine scope
      const scope = userId ? 'personal' as const : 'global' as const;
      const scopeOwnerId = userId;

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

    // ── 3. Extract key facts from AI acknowledgments ───────────────
    // If the AI response acknowledges learning something, the user message
    // is likely important — store the whole exchange as context
    if (
      memoriesStored === 0 &&
      sentences.length > 0 &&
      /\b(noted|remember|got it|understood|I'll keep|stored|saved)\b/i.test(aiResponse)
    ) {
      const scope = userId ? 'personal' as const : 'global' as const;
      try {
        await this.memoryService.store(
          scope,
          userId,
          'conversation',
          `User shared: ${userMessage.slice(0, 500)}`,
          0.6,
          'conversation',
        );
        memoriesStored++;
      } catch {
        // Best effort
      }
    }

    return { profileUpdates, memoriesStored };
  }
}
