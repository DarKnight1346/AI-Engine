import { getDb } from '@ai-engine/db';
import { EmbeddingService } from './embedding-service.js';

// ---------------------------------------------------------------------------
// Session Summarizer — Episodic Memory Layer
//
// Generates concise narrative summaries of conversation sessions, storing them
// as "episodes" that can be searched semantically. This mirrors human episodic
// memory: remembering WHAT happened, WHEN, and in what CONTEXT.
//
// Summaries are generated after a period of inactivity in a session (the
// "session boundary"), capturing the overall narrative rather than individual
// facts (which are already handled by the MemoryExtractor for semantic memory).
// ---------------------------------------------------------------------------

/** Minimum messages in a session window before we generate a summary */
const MIN_MESSAGES_FOR_SUMMARY = 4;

/** How long to wait after the last message before considering a session "ended" (ms) */
const SESSION_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface SessionSummaryResult {
  summariesCreated: number;
  sessionsProcessed: number;
}

export class SessionSummarizer {
  constructor(private embeddings: EmbeddingService) {}

  /**
   * Scan for sessions that have been idle long enough to summarize.
   * This is called periodically (e.g., alongside consolidation).
   */
  async summarizeIdleSessions(): Promise<SessionSummaryResult> {
    const db = getDb();
    const result: SessionSummaryResult = { summariesCreated: 0, sessionsProcessed: 0 };

    const idleThreshold = new Date(Date.now() - SESSION_IDLE_THRESHOLD_MS);

    // Find sessions with recent messages that don't have a summary covering
    // the latest messages yet
    const sessions = await db.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT cs.id as session_id,
             cs.created_by_user_id as user_id,
             cs.owner_id,
             cs.type
      FROM chat_sessions cs
      JOIN chat_messages cm ON cm.session_id = cs.id
      WHERE cm.created_at < $1
      AND cm.created_at > NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM conversation_summaries csm
        WHERE csm.session_id = cs.id
        AND csm.period_end >= (
          SELECT MAX(cm2.created_at) FROM chat_messages cm2 WHERE cm2.session_id = cs.id
        )
      )
      LIMIT 20
    `, idleThreshold);

    for (const session of sessions) {
      try {
        const created = await this.summarizeSession(
          session.session_id,
          session.user_id,
          session.type === 'team' ? session.owner_id : null,
        );
        if (created) result.summariesCreated++;
        result.sessionsProcessed++;
      } catch (err) {
        console.error(`[session-summarizer] Failed to summarize session ${session.session_id}:`, (err as Error).message);
      }
    }

    return result;
  }

  /**
   * Summarize a specific session. Finds messages since the last summary
   * (or all messages if no summary exists) and generates a narrative.
   */
  async summarizeSession(
    sessionId: string,
    userId: string | null,
    teamId: string | null,
  ): Promise<boolean> {
    const db = getDb();

    // Find the last summary's period_end for this session
    const lastSummary = await db.conversationSummary.findFirst({
      where: { sessionId },
      orderBy: { periodEnd: 'desc' },
    });

    const sinceDate = lastSummary?.periodEnd ?? new Date(0);

    // Fetch messages since last summary
    const messages = await db.chatMessage.findMany({
      where: {
        sessionId,
        createdAt: { gt: sinceDate },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length < MIN_MESSAGES_FOR_SUMMARY) {
      return false;
    }

    // Build the conversation text for summarization
    const conversationText = messages
      .map((m: any) => {
        const role = m.sender_type ?? m.senderType ?? 'unknown';
        return `${role === 'user' ? 'User' : 'AI'}: ${(m.content ?? '').slice(0, 500)}`;
      })
      .join('\n');

    // Extract summary, topics, and decisions using heuristic extraction
    // (no LLM call required — this runs offline and keeps it fast)
    const { summary, topics, decisions } = this.extractSummary(conversationText, messages);

    const periodStart = messages[0].createdAt;
    const periodEnd = messages[messages.length - 1].createdAt;

    // Store the episodic summary
    const entry = await db.conversationSummary.create({
      data: {
        sessionId,
        userId,
        teamId,
        summary,
        topics: JSON.stringify(topics),
        decisions: JSON.stringify(decisions),
        messageCount: messages.length,
        periodStart,
        periodEnd,
      },
    });

    // Store embedding for semantic search over episodes
    try {
      // Embed the summary + topics for richer retrieval
      const embeddingText = `${summary}\nTopics: ${topics.join(', ')}`;
      await this.embeddings.storeEmbedding(entry.id, 'episode', embeddingText);
    } catch (err) {
      console.error(`[session-summarizer] Embedding failed for summary ${entry.id}:`, (err as Error).message);
    }

    console.log(`[session-summarizer] Created summary for session ${sessionId}: ${messages.length} messages, ${topics.length} topics`);
    return true;
  }

  /**
   * Extract a summary, key topics, and decisions from conversation text.
   * Uses heuristic NLP (no LLM dependency) for fast offline processing.
   */
  private extractSummary(
    _conversationText: string,
    messages: any[],
  ): { summary: string; topics: string[]; decisions: string[] } {
    const userMessages = messages
      .filter((m: any) => (m.sender_type ?? m.senderType) === 'user')
      .map((m: any) => (m.content ?? '').trim())
      .filter((c: string) => c.length > 0);

    const aiMessages = messages
      .filter((m: any) => (m.sender_type ?? m.senderType) === 'ai')
      .map((m: any) => (m.content ?? '').trim())
      .filter((c: string) => c.length > 0);

    // Build a concise narrative summary
    const firstUserMsg = userMessages[0] ?? '';
    const topicHint = firstUserMsg.length > 100
      ? firstUserMsg.slice(0, 100) + '...'
      : firstUserMsg;

    const date = messages[0]?.createdAt ?? new Date();
    const dateStr = date instanceof Date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const summary = `On ${dateStr}, a conversation of ${messages.length} messages took place. ` +
      `The user started by discussing: "${topicHint}". ` +
      `${userMessages.length} user messages and ${aiMessages.length} AI responses were exchanged.`;

    // Extract topics: find recurring nouns/phrases from user messages
    const topics = this.extractTopics(userMessages);

    // Extract decisions: look for decision-indicating patterns in AI messages
    const decisions = this.extractDecisions(aiMessages);

    return { summary, topics, decisions };
  }

  /**
   * Extract key topics from user messages using word frequency analysis.
   */
  private extractTopics(userMessages: string[]): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'it', 'its', 'this', 'that',
      'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than',
      'i', 'me', 'my', 'we', 'you', 'your', 'he', 'she', 'they', 'them',
      'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
      'such', 'just', 'also', 'very', 'too', 'only', 'about', 'up',
      'out', 'into', 'over', 'after', 'before', 'between', 'under',
      'again', 'further', 'there', 'here', 'any', 'other', 'like',
      'get', 'got', 'want', 'know', 'think', 'make', 'go', 'see',
      'come', 'take', 'give', 'tell', 'say', 'said', 'much', 'many',
      'well', 'back', 'even', 'still', 'way', 'use', 'her', 'him',
    ]);

    const wordCounts = new Map<string, number>();

    for (const msg of userMessages) {
      const words = msg.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    // Return top N most frequent meaningful words as topics
    return [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);
  }

  /**
   * Extract decisions/recommendations from AI messages.
   */
  private extractDecisions(aiMessages: string[]): string[] {
    const decisionPatterns = [
      /(?:I recommend|I suggest|you should|let's go with|the best approach|I'd recommend|we should)\s+(.{10,80})/gi,
      /(?:decision|conclusion|plan|recommendation):\s*(.{10,80})/gi,
    ];

    const decisions: string[] = [];

    for (const msg of aiMessages) {
      for (const pattern of decisionPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(msg)) !== null) {
          const decision = match[1].trim().replace(/[.!?,;]+$/, '');
          if (decision.length > 10 && decisions.length < 5) {
            decisions.push(decision);
          }
        }
      }
    }

    return decisions;
  }
}
