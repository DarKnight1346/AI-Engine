/**
 * ChatQueue — concurrency-managed async chat execution engine.
 *
 * Handles thousands of concurrent chat requests by:
 *   1. Maintaining a shared LLMPool singleton (reuses API key clients)
 *   2. Limiting concurrent LLM executions (default 50) to avoid overloading
 *      API keys and the Node.js event loop
 *   3. Queuing excess requests with FIFO ordering
 *   4. Emitting per-chat streaming events via callbacks
 *
 * Usage:
 *   const queue = ChatQueue.getInstance();
 *   queue.enqueue({
 *     sessionId, message, userId, agentId,
 *     onEvent: (event) => { /* stream to client *\/ },
 *   });
 */

import { EventEmitter } from 'events';
import type { ChatStreamEvent } from '@ai-engine/agent-runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatJob {
  /** Unique job ID (used to track/cancel) */
  jobId: string;
  /** Chat session ID */
  sessionId: string;
  /** User message text */
  message: string;
  /** Optional user ID for context */
  userId?: string;
  /** Optional agent ID */
  agentId?: string;
  /** Streaming event callback — called for every token, status, tool call, etc. */
  onEvent: (event: ChatStreamEvent) => void;
  /** Called when the job finishes (success or error) */
  onComplete?: (error?: Error) => void;
  /** AbortSignal to cancel the job */
  signal?: AbortSignal;
}

interface QueueStats {
  /** Jobs currently being processed */
  active: number;
  /** Jobs waiting in the queue */
  queued: number;
  /** Total jobs processed since startup */
  totalProcessed: number;
  /** Max concurrent jobs allowed */
  maxConcurrency: number;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const QUEUE_KEY = Symbol.for('ai-engine.chat-queue');

export class ChatQueue {
  private queue: ChatJob[] = [];
  private activeJobs = new Map<string, { job: ChatJob; abortController: AbortController }>();
  private maxConcurrency: number;
  private totalProcessed = 0;
  private _poolInstance: any = null;

  /** Event emitter for queue-level events (optional monitoring) */
  readonly events = new EventEmitter();

  static getInstance(): ChatQueue {
    const g = globalThis as Record<symbol, ChatQueue | undefined>;
    if (!g[QUEUE_KEY]) {
      g[QUEUE_KEY] = new ChatQueue();
    }
    return g[QUEUE_KEY]!;
  }

  constructor(maxConcurrency = 50) {
    this.maxConcurrency = maxConcurrency;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Enqueue a chat job for async execution.
   * Returns the jobId for tracking/cancellation.
   */
  enqueue(job: ChatJob): string {
    // If already cancelled before queueing, skip
    if (job.signal?.aborted) {
      job.onEvent({ type: 'error', message: 'Request was cancelled before processing.' });
      job.onComplete?.(new Error('Aborted'));
      return job.jobId;
    }

    this.queue.push(job);
    this.events.emit('enqueued', { jobId: job.jobId, queueLength: this.queue.length });
    this.processNext();
    return job.jobId;
  }

  /**
   * Cancel a queued or active job.
   */
  cancel(jobId: string): boolean {
    // Check queue first
    const queueIdx = this.queue.findIndex((j) => j.jobId === jobId);
    if (queueIdx >= 0) {
      const [removed] = this.queue.splice(queueIdx, 1);
      removed.onEvent({ type: 'error', message: 'Job cancelled while queued.' });
      removed.onComplete?.(new Error('Cancelled'));
      return true;
    }

    // Check active jobs
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.abortController.abort();
      return true;
    }

    return false;
  }

  /**
   * Get current queue statistics.
   */
  getStats(): QueueStats {
    return {
      active: this.activeJobs.size,
      queued: this.queue.length,
      totalProcessed: this.totalProcessed,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Update the max concurrency limit.
   */
  setMaxConcurrency(n: number): void {
    this.maxConcurrency = Math.max(1, n);
    // Try to start more jobs if we increased capacity
    this.processNext();
  }

  // -----------------------------------------------------------------------
  // Internal — job processing
  // -----------------------------------------------------------------------

  private processNext(): void {
    while (this.activeJobs.size < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;

      // Skip cancelled jobs
      if (job.signal?.aborted) {
        job.onEvent({ type: 'error', message: 'Request was cancelled.' });
        job.onComplete?.(new Error('Aborted'));
        continue;
      }

      const abortController = new AbortController();
      this.activeJobs.set(job.jobId, { job, abortController });

      // If the caller's signal aborts, propagate to our controller
      if (job.signal) {
        job.signal.addEventListener('abort', () => abortController.abort(), { once: true });
      }

      this.executeJob(job, abortController.signal)
        .catch((err) => {
          job.onEvent({ type: 'error', message: err.message ?? 'Unknown error' });
        })
        .finally(() => {
          this.activeJobs.delete(job.jobId);
          this.totalProcessed++;
          this.events.emit('completed', { jobId: job.jobId });
          job.onComplete?.();
          // Process next job in queue
          this.processNext();
        });
    }
  }

  private async executeJob(job: ChatJob, signal: AbortSignal): Promise<void> {
    const { getDb } = await import('@ai-engine/db');
    const db = getDb();

    // Check abort before heavy work
    if (signal.aborted) throw new Error('Aborted');

    // ── Resolve user context ────────────────────────────────────────
    const contextUser = job.userId
      ? await db.user.findUnique({ where: { id: job.userId } })
      : await db.user.findFirst({ where: { role: 'admin' } });

    const contextMembership = contextUser
      ? await db.teamMember.findFirst({
          where: { userId: contextUser.id },
          orderBy: { joinedAt: 'asc' },
        })
      : null;

    // ── Resolve agent ──────────────────────────────────────────────
    const DEFAULT_SYSTEM_PROMPT = `You are AI Engine, an intelligent and capable AI assistant.
You help users with tasks, answer questions, provide analysis, and assist with workflow management.
Be helpful, accurate, and concise. When providing code, use markdown code blocks with language labels.
When listing items, use bullet points or numbered lists.`;

    let agent = null;
    let agentName: string | undefined;
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;

    if (job.agentId) {
      agent = await db.agent.findUnique({ where: { id: job.agentId } });
      if (agent) {
        systemPrompt = agent.rolePrompt || DEFAULT_SYSTEM_PROMPT;
        agentName = agent.name;
      }
    }

    // Append cognitive capabilities prompt
    const { withMemoryPrompt } = await import('@ai-engine/shared');
    systemPrompt = withMemoryPrompt(systemPrompt);

    if (signal.aborted) throw new Error('Aborted');

    // ── Skill detection ────────────────────────────────────────────
    try {
      const relevantSkills = await db.skill.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true, description: true, category: true,
          instructions: true, requiredCapabilities: true,
        },
      });

      if (relevantSkills.length > 0) {
        const msgLower = job.message.toLowerCase();
        const msgWords = msgLower.split(/\s+/).filter((w: string) => w.length > 2);

        const scored = relevantSkills.map((s: any) => {
          const text = `${s.name} ${s.description} ${s.category}`.toLowerCase();
          let score = 0;
          if (text.includes(msgLower)) score += 3;
          for (const word of msgWords) {
            if (text.includes(word)) score += 1;
          }
          return { ...s, score };
        }).filter((s: { score: number }) => s.score > 0)
          .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
          .slice(0, 5);

        if (scored.length > 0) {
          const lines = scored.map((s: any) =>
            `- **skill:${s.name}** (${s.category}): ${s.description}`
          );
          systemPrompt += `\n\n## Detected Relevant Skills\nThe following skills from your library may be useful for this task. You can load any of them with \`execute_tool\` using the skill name (e.g., "skill:${scored[0].name}").\n${lines.join('\n')}`;

          // Browser skill detection
          const BROWSER_KEYWORDS = ['browser', 'navigate', 'click', 'screenshot', 'web automation', 'scrape', 'scraping', 'puppeteer', 'playwright'];
          let browserSkillDetected = false;
          for (const s of scored) {
            const skillText = `${s.name} ${s.description} ${s.category} ${s.instructions}`.toLowerCase();
            const caps = (s.requiredCapabilities as string[]) ?? [];
            const hasBrowserCap = caps.some((c: string) => c.toLowerCase().includes('browser'));
            const hasBrowserKeyword = BROWSER_KEYWORDS.some(kw => skillText.includes(kw));
            if (hasBrowserCap || hasBrowserKeyword) { browserSkillDetected = true; break; }
          }

          if (!browserSkillDetected) {
            const BROWSER_MSG_KEYWORDS = ['browse', 'browser', 'navigate to', 'open website', 'screenshot', 'web automation', 'scrape', 'scraping', 'click on', 'fill form', 'web page interaction'];
            browserSkillDetected = BROWSER_MSG_KEYWORDS.some(kw => msgLower.includes(kw));
          }

          if (browserSkillDetected) {
            systemPrompt += `\n\n## Browser Automation Routing\nThis task involves browser automation. All browser-related tool calls MUST be directed to a Mac worker node.`;
          }
        }
      }
    } catch {
      // Skill detection failed — continue
    }

    if (signal.aborted) throw new Error('Aborted');

    // ── Build LLM pool (shared singleton) ──────────────────────────
    const pool = await this.getSharedPool();

    // ── Build memory search function ───────────────────────────────
    // This runs the actual vector search against pgvector embeddings.
    const searchMemoryFn = async (query: string, scope: string, scopeOwnerId: string | null): Promise<string> => {
      try {
        const { MemoryService, EmbeddingService } = await import('@ai-engine/memory');
        const embeddings = new EmbeddingService();
        const memSvc = new MemoryService(embeddings);

        console.log(`[search_memory] Vector search: query="${query.slice(0, 80)}" scope=${scope} owner=${scopeOwnerId ?? 'none'}`);

        const results = await memSvc.search(query, scope as any, scopeOwnerId, 5, { strengthenOnRecall: true });

        console.log(`[search_memory] Found ${results.length} result(s), top score: ${results[0]?.finalScore?.toFixed(3) ?? 'n/a'}`);

        if (results.length === 0) return 'No matching memories found.';
        return results.map((m: any) => {
          const confidence = m.finalScore >= 0.7 ? 'high' : m.finalScore >= 0.4 ? 'medium' : 'low';
          return `- [${m.scope}/${confidence}] ${m.content}`;
        }).join('\n');
      } catch (err: any) {
        console.error(`[search_memory] Error:`, err.message);
        return 'Memory search unavailable.';
      }
    };

    // ── Create ChatExecutor with worker dispatcher ─────────────────
    const { ChatExecutor } = await import('@ai-engine/agent-runtime');
    const { WorkerHub } = await import('@/lib/worker-hub');
    const workerHub = WorkerHub.getInstance();

    const executor = new ChatExecutor({
      llm: pool,
      tier: 'standard',
      searchMemory: searchMemoryFn,
      userId: contextUser?.id,
      teamId: contextMembership?.teamId,
      sessionId: job.sessionId,
      workerDispatcher: workerHub,
    });

    // ── Load conversation history ──────────────────────────────────
    const history = await db.chatMessage.findMany({
      where: { sessionId: job.sessionId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const llmMessages = history.map((m: any) => ({
      role: m.senderType === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    // Ensure the new user message is in the list
    const userMsgInHistory = history.some((m: any) => m.content === job.message && m.senderType === 'user');
    if (!userMsgInHistory) {
      llmMessages.push({ role: 'user' as const, content: job.message });
    }

    if (signal.aborted) throw new Error('Aborted');

    // ── Execute with streaming ─────────────────────────────────────
    job.onEvent({ type: 'status', message: 'Processing...' });

    const result = await executor.executeStreaming(
      llmMessages,
      systemPrompt,
      (event) => {
        if (signal.aborted) return;
        job.onEvent(event);
      },
    );

    if (signal.aborted) throw new Error('Aborted');

    // ── Store AI response in DB ────────────────────────────────────
    await db.chatMessage.create({
      data: {
        sessionId: job.sessionId,
        senderType: 'ai',
        content: result.content,
        aiResponded: true,
        embedsJson: job.agentId ? { agentId: job.agentId, agentName } : undefined,
      },
    });

    // ── Auto-extract memories from conversation (fire-and-forget) ──
    try {
      const { MemoryExtractor, MemoryService: MemSvc, EmbeddingService: EmbSvc } = await import('@ai-engine/memory');
      const embSvc = new EmbSvc();
      const memSvc = new MemSvc(embSvc);
      const extractor = new MemoryExtractor(memSvc);
      extractor.extractAndStore(
        job.message,
        result.content,
        contextUser?.id ?? null,
        contextMembership?.teamId ?? null,
      ).then((r) => {
        if (r.memoriesStored > 0) {
          console.log(`[memory-extract] Auto-extracted: ${r.memoriesStored} memory(ies)`);
        }
      }).catch((err) => {
        console.error(`[memory-extract] Error:`, err.message);
      });
    } catch {
      // Memory extraction not available — continue
    }
  }

  // -----------------------------------------------------------------------
  // Shared LLMPool singleton — reused across all chat jobs
  // -----------------------------------------------------------------------

  private async getSharedPool(): Promise<any> {
    // Refresh pool every 5 minutes or if not yet created
    if (this._poolInstance) return this._poolInstance;

    const { LLMPool } = await import('@ai-engine/llm');
    const { getDb } = await import('@ai-engine/db');
    const db = getDb();

    const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
    if (apiKeys.length === 0) {
      throw new Error('No API keys configured. Please add API keys in Settings > API Keys.');
    }

    this._poolInstance = new LLMPool({
      keys: apiKeys.map((k: any) => {
        const stats = k.usageStats as any;
        return {
          id: k.id,
          apiKey: k.keyEncrypted,
          keyType: (stats?.keyType as 'api-key' | 'bearer' | undefined) ?? 'api-key',
          provider: (stats?.provider as 'anthropic' | 'openai-compatible' | undefined) ?? 'anthropic',
          baseUrl: stats?.baseUrl as string | undefined,
        };
      }),
      strategy: 'round-robin',
    });

    // Refresh the pool periodically (every 5 minutes)
    setTimeout(() => { this._poolInstance = null; }, 5 * 60 * 1000);

    return this._poolInstance;
  }
}
