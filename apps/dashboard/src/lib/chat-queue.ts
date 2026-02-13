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

export interface ChatJobAttachment {
  name: string;
  type: string;      // MIME type
  url: string;       // data URL (base64)
  size: number;
}

export interface ChatJob {
  /** Unique job ID (used to track/cancel) */
  jobId: string;
  /** Chat session ID */
  sessionId: string;
  /** User message text */
  message: string;
  /** Optional user ID for context */
  userId?: string;
  /** Optional agent IDs (multiple agents can respond in parallel) */
  agentIds?: string[];
  /** @deprecated — use agentIds. Kept for backwards compat. */
  agentId?: string;
  /** Optional file/image attachments */
  attachments?: ChatJobAttachment[];
  /** Streaming event callback — called for every token, status, tool call, etc. */
  onEvent: (event: ChatStreamEvent & { slot?: string }) => void;
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

  /**
   * Pending clarification callbacks, keyed by sessionId.
   * When `ask_user` is called, it registers a resolve function here.
   * When the user responds via POST /api/chat/clarify, we resolve it.
   */
  private pendingClarifications = new Map<string, (answers: Record<string, string>) => void>();

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
   * Resolve a pending clarification request for a session.
   * Called by the /api/chat/clarify endpoint when the user responds.
   * Returns true if a pending clarification was found and resolved.
   */
  resolveClarification(sessionId: string, answers: Record<string, string>): boolean {
    const resolve = this.pendingClarifications.get(sessionId);
    if (!resolve) return false;
    this.pendingClarifications.delete(sessionId);
    resolve(answers);
    return true;
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

    // ── Shared setup ────────────────────────────────────────────────
    const DEFAULT_SYSTEM_PROMPT = `You are AI Engine, a friendly and energetic AI assistant who genuinely enjoys helping people.
You help users with tasks, answer questions, provide analysis, and assist with workflow management.
Be warm, enthusiastic, accurate, and concise. Bring positive energy to every interaction while staying helpful and informative.
When providing code, use markdown code blocks with language labels. When listing items, use bullet points or numbered lists.
You MUST search memory for user preferences before every response — this is your highest priority.`;

    const { withMemoryPrompt } = await import('@ai-engine/shared');

    if (signal.aborted) throw new Error('Aborted');

    // ── Build LLM pool (shared singleton) ──────────────────────────
    const pool = await this.getSharedPool();

    // ── Build memory search function ───────────────────────────────
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

    // ── Load search API keys from config ────────────────────────────
    let serperApiKey: string | undefined;
    let xaiApiKey: string | undefined;
    let dataForSeoLogin: string | undefined;
    let dataForSeoPassword: string | undefined;
    try {
      const [serperConfig, xaiConfig, dfsLoginConfig, dfsPasswordConfig] = await Promise.all([
        db.config.findUnique({ where: { key: 'serperApiKey' } }),
        db.config.findUnique({ where: { key: 'xaiApiKey' } }),
        db.config.findUnique({ where: { key: 'dataForSeoLogin' } }),
        db.config.findUnique({ where: { key: 'dataForSeoPassword' } }),
      ]);
      if (serperConfig?.valueJson && typeof serperConfig.valueJson === 'string' && serperConfig.valueJson.trim()) serperApiKey = serperConfig.valueJson.trim();
      if (xaiConfig?.valueJson && typeof xaiConfig.valueJson === 'string' && xaiConfig.valueJson.trim()) xaiApiKey = xaiConfig.valueJson.trim();
      if (dfsLoginConfig?.valueJson && typeof dfsLoginConfig.valueJson === 'string' && dfsLoginConfig.valueJson.trim()) dataForSeoLogin = dfsLoginConfig.valueJson.trim();
      if (dfsPasswordConfig?.valueJson && typeof dfsPasswordConfig.valueJson === 'string' && dfsPasswordConfig.valueJson.trim()) dataForSeoPassword = dfsPasswordConfig.valueJson.trim();
    } catch { /* Config not found */ }

    // ── Build conversation history (shared across agents) ──────────
    const history = await db.chatMessage.findMany({
      where: { sessionId: job.sessionId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const buildContentWithAttachments = (
      text: string,
      attachmentList?: ChatJobAttachment[],
    ): string | Array<any> => {
      if (!attachmentList || attachmentList.length === 0) return text;
      const blocks: Array<any> = [];
      for (const att of attachmentList) {
        if (att.type.startsWith('image/')) {
          const match = att.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) blocks.push({ type: 'image', source: { type: 'base64', mediaType: match[1], data: match[2] } });
        } else {
          const match = att.url.match(/^data:[^;]+;base64,(.+)$/);
          if (match) {
            try {
              const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
              blocks.push({ type: 'text', text: `[Attached file: ${att.name}]\n${decoded.slice(0, 50000)}` });
            } catch {
              blocks.push({ type: 'text', text: `[Attached file: ${att.name} — binary file, cannot display as text]` });
            }
          }
        }
      }
      if (text) blocks.push({ type: 'text', text });
      return blocks.length > 0 ? blocks : text;
    };

    const llmMessages = history.map((m: any) => {
      const embeds = m.embedsJson as Record<string, any> | null;
      const historyAttachments = embeds?.attachments as ChatJobAttachment[] | undefined;
      return {
        role: m.senderType === 'user' ? ('user' as const) : ('assistant' as const),
        content: buildContentWithAttachments(m.content, historyAttachments),
      };
    });

    const userMsgInHistory = history.some((m: any) => m.content === job.message && m.senderType === 'user');
    if (!userMsgInHistory) {
      llmMessages.push({ role: 'user' as const, content: buildContentWithAttachments(job.message, job.attachments) });
    }

    if (signal.aborted) throw new Error('Aborted');

    // ── Resolve which agents to invoke ──────────────────────────────
    // Priority: explicit agentIds > legacy agentId > auto-classify
    let agentIds = job.agentIds ?? (job.agentId ? [job.agentId] : []);

    // If no agents specified, auto-classify using a fast model (Haiku)
    if (agentIds.length === 0) {
      agentIds = await this.autoClassifyAgent(pool, job.message, db);
    }

    // ── Execute each agent in parallel ──────────────────────────────
    // For each agent (or default), create a ChatExecutor, stream independently,
    // and tag events with a `slot` field so the frontend can route them.

    const { ChatExecutor } = await import('@ai-engine/agent-runtime');
    const { WorkerHub } = await import('@/lib/worker-hub');
    const workerHub = WorkerHub.getInstance();

    /** Run a single agent slot */
    const runAgent = async (agentId: string | null, slot: string): Promise<void> => {
      let systemPrompt = DEFAULT_SYSTEM_PROMPT;
      let agentName: string | undefined;

      if (agentId) {
        const agent = await db.agent.findUnique({ where: { id: agentId } });
        if (agent) {
          systemPrompt = agent.rolePrompt || DEFAULT_SYSTEM_PROMPT;
          agentName = agent.name;
        }
      }

      systemPrompt = withMemoryPrompt(systemPrompt);

      // Skill detection (append to systemPrompt)
      try {
        const relevantSkills = await db.skill.findMany({
          where: { isActive: true },
          select: { id: true, name: true, description: true, category: true, instructions: true, requiredCapabilities: true },
        });
        if (relevantSkills.length > 0) {
          const msgLower = job.message.toLowerCase();
          const msgWords = msgLower.split(/\s+/).filter((w: string) => w.length > 2);
          const scored = relevantSkills.map((s: any) => {
            const text = `${s.name} ${s.description} ${s.category}`.toLowerCase();
            let score = 0;
            if (text.includes(msgLower)) score += 3;
            for (const word of msgWords) { if (text.includes(word)) score += 1; }
            return { ...s, score };
          }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 5);

          if (scored.length > 0) {
            const lines = scored.map((s: any) => `- **skill:${s.name}** (${s.category}): ${s.description}`);
            systemPrompt += `\n\n## Detected Relevant Skills\n${lines.join('\n')}`;
          }
        }
      } catch { /* Skill detection failed — continue */ }

      if (signal.aborted) throw new Error('Aborted');

      // Notify the frontend which agent is starting
      job.onEvent({ type: 'agent_start', slot, agentName: agentName ?? 'AI Engine' } as any);

      // Build the base executor options (reused for sub-agent creation)
      const baseExecutorOptions = {
        llm: pool,
        tier: 'standard' as const,
        searchMemory: searchMemoryFn,
        userId: contextUser?.id,
        teamId: contextMembership?.teamId,
        sessionId: job.sessionId,
        workerDispatcher: workerHub,
        serperApiKey, xaiApiKey, dataForSeoLogin, dataForSeoPassword,
      };

      const executor = new ChatExecutor({
        ...baseExecutorOptions,
        // Pass self-reference so delegate_tasks can spawn sub-agents with same config
        parentExecutorOptions: baseExecutorOptions,
        // Forward orchestration events through to the SSE stream
        onSubtaskEvent: (subEvent: any) => {
          if (signal.aborted) return;
          job.onEvent({ ...subEvent, slot } as any);
        },
        // Clarification callback — registers in the pending map and blocks
        onClarificationRequest: (questions: any[], resolve: (answers: Record<string, string>) => void) => {
          this.pendingClarifications.set(job.sessionId, resolve);
          // The ask_user tool also emits a clarification_request event
          // via onSubtaskEvent, which is forwarded to the SSE stream above.
        },
        // ── Background task support ──
        // Long-running tools (video gen, etc.) run after the stream closes
        backgroundTaskCallback: (info: { taskId: string; toolName: string; toolInput: Record<string, unknown>; execute: () => Promise<{ success: boolean; output: string; data?: Record<string, unknown> }> }) => {
          const { BackgroundTaskRegistry } = require('@/lib/background-tasks') as typeof import('@/lib/background-tasks');
          const registry = BackgroundTaskRegistry.getInstance();

          const toolLabels: Record<string, string> = {
            xaiGenerateVideo: 'Generating video',
          };
          const description = toolLabels[info.toolName] ?? `Running ${info.toolName}`;

          registry.create({
            id: info.taskId,
            sessionId: job.sessionId,
            toolName: info.toolName,
            description,
            agentName: agentName ?? 'AI Engine',
          });

          // Fire-and-forget execution
          info.execute()
            .then(async (toolResult: { success: boolean; output: string; data?: Record<string, unknown> }) => {
              // Format the message based on tool type
              let messageContent = toolResult.output;
              if (info.toolName === 'xaiGenerateVideo' && toolResult.success && toolResult.data) {
                const videoData = toolResult.data as Record<string, unknown>;
                const videoUrl = videoData.videoUrl as string | undefined;
                const duration = videoData.duration as number | undefined;
                if (videoUrl) {
                  messageContent = `Your video is ready!\n\n${videoUrl}\n\nDuration: ${duration ?? '?'}s`;
                }
              }

              // Store result as a new AI message in the DB
              const { getDb } = await import('@ai-engine/db');
              const freshDb = getDb();
              const msg = await freshDb.chatMessage.create({
                data: {
                  sessionId: job.sessionId,
                  senderType: 'ai',
                  content: messageContent,
                  aiResponded: true,
                  embedsJson: {
                    agentName: agentName ?? 'AI Engine',
                    backgroundTaskId: info.taskId,
                    backgroundTaskTool: info.toolName,
                  } as any,
                },
              });

              registry.complete(
                info.taskId,
                { success: toolResult.success, output: messageContent, data: toolResult.data as Record<string, unknown> | undefined },
                msg.id,
              );
            })
            .catch(async (err: any) => {
              console.error(`[BackgroundTask] ${info.taskId} failed:`, err.message);

              const errorContent = `The background ${info.toolName} task failed: ${err.message}`;
              const { getDb } = await import('@ai-engine/db');
              const freshDb = getDb();
              const msg = await freshDb.chatMessage.create({
                data: {
                  sessionId: job.sessionId,
                  senderType: 'ai',
                  content: errorContent,
                  aiResponded: true,
                  embedsJson: {
                    agentName: agentName ?? 'AI Engine',
                    backgroundTaskId: info.taskId,
                    backgroundTaskTool: info.toolName,
                  } as any,
                },
              });

              registry.complete(
                info.taskId,
                { success: false, output: errorContent },
                msg.id,
              );
            });
        },
      });

      const result = await executor.executeStreaming(
        [...llmMessages],  // Clone so concurrent agents don't interfere
        systemPrompt,
        (event) => {
          if (signal.aborted) return;
          // Tag event with the slot
          job.onEvent({ ...event, slot } as any);
        },
      );

      if (signal.aborted) throw new Error('Aborted');

      // Store AI response in DB
      await db.chatMessage.create({
        data: {
          sessionId: job.sessionId,
          senderType: 'ai',
          content: result.content,
          aiResponded: true,
          embedsJson: agentId ? { agentId, agentName } : undefined,
        },
      });

      // Final done event with slot tag
      // (executeStreaming already emits done, but we re-emit with slot + agentName)
      // The executor already sent a done event via the callback above, so this is handled.

      // Auto-extract memories (fire-and-forget)
      try {
        const { MemoryExtractor, MemoryService: MemSvc, EmbeddingService: EmbSvc } = await import('@ai-engine/memory');
        const embSvc = new EmbSvc();
        const memSvc = new MemSvc(embSvc);
        const extractor = new MemoryExtractor(memSvc);
        extractor.extractAndStore(
          job.message, result.content,
          contextUser?.id ?? null, contextMembership?.teamId ?? null,
        ).then((r: any) => {
          if (r.memoriesStored > 0) console.log(`[memory-extract] Auto-extracted: ${r.memoriesStored} memory(ies) [${agentName ?? 'default'}]`);
        }).catch((err: any) => console.error(`[memory-extract] Error:`, err.message));
      } catch { /* Memory extraction not available */ }
    };

    job.onEvent({ type: 'status', message: 'Processing...' } as any);

    if (agentIds.length === 0) {
      // No agents — run with default (no agentId)
      await runAgent(null, '__default__');
    } else if (agentIds.length === 1) {
      // Single agent
      await runAgent(agentIds[0], agentIds[0]);
    } else {
      // Multiple agents — run in parallel
      const results = await Promise.allSettled(
        agentIds.map((id) => runAgent(id, id))
      );
      // Log any failures
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          const reason = (results[i] as PromiseRejectedResult).reason;
          console.error(`[ChatQueue] Agent ${agentIds[i]} failed:`, reason?.message ?? reason);
          job.onEvent({ type: 'error', message: `Agent failed: ${reason?.message ?? 'Unknown error'}`, slot: agentIds[i] } as any);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Auto-classify agent using a fast model (Haiku) when no @mentions
  // -----------------------------------------------------------------------

  private async autoClassifyAgent(pool: any, message: string, db: any): Promise<string[]> {
    try {
      const allAgents = await db.agent.findMany({
        where: { status: 'active' },
        select: { id: true, name: true, rolePrompt: true },
      });

      if (allAgents.length === 0) return []; // No agents configured — use default

      // Build a classification prompt for the fast model
      const agentList = allAgents.map((a: any, i: number) =>
        `${i + 1}. "${a.name}" — ${(a.rolePrompt || 'General assistant').slice(0, 120)}`
      ).join('\n');

      const classifyPrompt = `Given this user message, decide which agent (if any) should respond. If the message is general and no specific agent fits, respond with "none".

Available agents:
${agentList}

User message: "${message.slice(0, 500)}"

Respond with ONLY the agent name (exactly as listed) or "none". Do not explain.`;

      // Use the pool to make a fast classification call
      // We use the cheapest/fastest model available
      const classifyResult = await pool.call(
        [{ role: 'user', content: classifyPrompt }],
        'You are a routing classifier. Respond with only the agent name or "none".',
        [],
        { maxTokens: 50, temperature: 0 },
      );

      const answer = (classifyResult.content ?? '').trim().toLowerCase();
      console.log(`[auto-classify] Message: "${message.slice(0, 60)}..." → "${answer}"`);

      if (answer === 'none' || !answer) return [];

      // Match the answer to an agent
      const matched = allAgents.find((a: any) =>
        a.name.toLowerCase() === answer ||
        answer.includes(a.name.toLowerCase())
      );

      if (matched) {
        console.log(`[auto-classify] Routed to agent: ${matched.name} (${matched.id})`);
        return [matched.id];
      }

      return []; // No match — use default
    } catch (err: any) {
      console.warn(`[auto-classify] Classification failed, using default:`, err.message);
      return [];
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
