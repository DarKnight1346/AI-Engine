/**
 * Next.js Instrumentation Hook
 *
 * Runs once when the Node.js server starts.
 *
 * Responsibilities:
 *   1. Initialise WebSocket hubs (worker + client) on globalThis
 *   2. Start the Cloudflare tunnel (fallback if server.js doesn't)
 *   3. Start Claude Max proxy instances
 *   4. Start the task scheduler with Redis integration
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // ── Worker Hub (WebSocket hub for worker connections) ──────────
    // Must initialise early so it's available on globalThis before
    // server.js starts accepting WebSocket connections.
    if (!(globalThis as any).__workerHub) {
      try {
        const { WorkerHub } = await import('./lib/worker-hub');
        (globalThis as any).__workerHub = WorkerHub.getInstance();
        console.log('[ws] Worker hub initialised');
      } catch (err: any) {
        console.warn('[ws] Worker hub init failed:', err.message);
      }
    }

    // ── Client Hub (WebSocket hub for browser connections) ─────────
    if (!(globalThis as any).__clientHub) {
      try {
        const { ClientHub } = await import('./lib/client-hub');
        const hub = ClientHub.getInstance();
        hub.setPort(parseInt(process.env.DASHBOARD_PORT || process.env.PORT || '3000', 10));
        (globalThis as any).__clientHub = hub;
        console.log('[ws] Client hub initialised');
      } catch (err: any) {
        console.warn('[ws] Client hub init failed:', err.message);
      }
    }

    // ── Cloudflare Tunnel ──────────────────────────────────────────
    if (!(globalThis as any).__tunnelStarted) {
      try {
        const { TunnelManager } = await import('./lib/tunnel-manager');
        const manager = TunnelManager.getInstance();
        manager.start().catch((err: Error) => {
          console.error('[tunnel] Auto-start failed:', err.message);
        });
        (globalThis as any).__tunnelStarted = true;
      } catch {
        // server.js will handle this
      }
    }

    // ── Claude Max Proxies ─────────────────────────────────────────
    if (!(globalThis as any).__proxiesStarted) {
      (globalThis as any).__proxiesStarted = true;
      setTimeout(async () => {
        try {
          const { ProxyManager } = await import('./lib/proxy-manager');
          const pm = ProxyManager.getInstance();
          await pm.startAll();
        } catch (err: any) {
          console.warn('[proxy-manager] Auto-start skipped:', err.message);
        }
      }, 5000);
    }

    // ── Scheduler ──────────────────────────────────────────────────
    if (!(globalThis as any).__schedulerStarted) {
      (globalThis as any).__schedulerStarted = true;

      // Start after a delay to give database and Redis time to connect
      setTimeout(async () => {
        await startScheduler();
      }, 8000);
    }

    // ── Memory Consolidation (periodic "sleep" cycle) ────────────
    if (!(globalThis as any).__consolidationStarted) {
      (globalThis as any).__consolidationStarted = true;

      // Run first consolidation after 60s, then every 6 hours
      setTimeout(() => {
        startConsolidationLoop();
      }, 60000);
    }

    // ── Client WebSocket Hub ───────────────────────────────────────
    // Initialize the browser client WebSocket hub so it's available to
    // server.js via globalThis. This import also ensures the module is
    // included in the Next.js compilation (server.js can't load .ts directly).
    if (!(globalThis as any).__clientHub) {
      try {
        const { ClientHub } = await import('./lib/client-hub');
        const hub = ClientHub.getInstance();
        const port = parseInt(process.env.DASHBOARD_PORT || process.env.PORT || '3000', 10);
        hub.setPort(port);
        (globalThis as any).__clientHub = hub;
        console.log('[ws] Client hub initialised via instrumentation');
      } catch (err: any) {
        console.warn('[ws] Client hub init skipped:', err.message);
      }
    }
  }
}

/**
 * Start the scheduler tick loop and subscribe to scheduler:task-fired events.
 * When a task fires, either dispatch to a connected worker or execute directly.
 */
async function startScheduler() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('[scheduler] REDIS_URL not set — scheduler disabled');
    return;
  }

  try {
    const Redis = (await import('ioredis')).default;
    const { Scheduler } = await import('@ai-engine/scheduler');
    const { getDb } = await import('@ai-engine/db');

    const nodeId = `dashboard-${process.env.HOSTNAME || 'main'}`;

    // Create Redis instances — one for the scheduler, one for subscribing
    const schedulerRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    const subscriberRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    await schedulerRedis.connect();
    await subscriberRedis.connect();

    // Start the scheduler tick loop
    const scheduler = new Scheduler(nodeId, schedulerRedis);
    scheduler.start();
    console.log('[scheduler] Started');

    // Subscribe to task-fired events and handle dispatch
    await subscriberRedis.subscribe('scheduler:task-fired');
    subscriberRedis.on('message', async (channel: string, message: string) => {
      if (channel !== 'scheduler:task-fired') return;

      try {
        const event = JSON.parse(message);
        console.log(`[scheduler] Task fired: ${event.taskId}`);
        await handleScheduledTask(event);
      } catch (err: any) {
        console.error('[scheduler] Failed to handle fired task:', err.message);
      }
    });

    console.log('[scheduler] Subscribed to task-fired events');
  } catch (err: any) {
    console.error('[scheduler] Failed to start:', err.message);
  }
}

/**
 * Handle a fired scheduled task:
 * 1. Try to dispatch to a connected worker via WorkerHub
 * 2. If no workers, execute directly using the LLM pool
 */
async function handleScheduledTask(event: {
  taskId: string;
  agentId?: string;
  workflowId?: string;
  goalContextId?: string;
  configJson?: any;
  userPrompt?: string;
  scheduledAt: string;
  recovered?: boolean;
}) {
  const { getDb } = await import('@ai-engine/db');
  const db = getDb();

  // Load the scheduled task for context (cast to any — new columns may not
  // be in the generated Prisma client until `prisma generate` runs)
  const task = await db.scheduledTask.findUnique({ where: { id: event.taskId } }) as any;
  if (!task) {
    console.warn(`[scheduler] Task ${event.taskId} not found in DB`);
    return;
  }

  // Find the scheduled task run to update
  const run = await db.scheduledTaskRun.findFirst({
    where: { taskId: event.taskId, status: 'running' },
    orderBy: { startedAt: 'desc' },
  });

  // Load agent if assigned
  let agent = null;
  if (event.agentId) {
    agent = await db.agent.findUnique({ where: { id: event.agentId } });
  }

  // Try dispatching to a worker first
  let dispatched = false;
  try {
    const hub = (globalThis as any).__workerHub;
    if (hub && agent) {
      const result = await hub.dispatchTask({
        taskId: event.taskId,
        agentId: agent.id,
        input: task.userPrompt ?? `Execute scheduled task: ${task.name}`,
        agentConfig: {
          name: agent.name,
          rolePrompt: agent.rolePrompt,
          toolConfig: agent.toolConfig,
        },
      });
      dispatched = result.dispatched;
      if (dispatched) {
        console.log(`[scheduler] Task ${task.name} dispatched to worker ${result.workerId}`);
      }
    }
  } catch {
    // Worker dispatch failed — will execute directly
  }

  // If no workers available, execute directly via LLM
  if (!dispatched) {
    try {
      await executeTaskDirectly(task, agent, event, run?.id);
    } catch (err: any) {
      console.error(`[scheduler] Direct execution failed for ${task.name}:`, err.message);
      if (run) {
        await db.scheduledTaskRun.update({
          where: { id: run.id },
          data: { status: 'failed', finishedAt: new Date(), resultSummary: err.message },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Token estimation & conversation summarisation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(messages: Array<{ role: string; content: unknown }>): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          chars += String((part as any).text).length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Maximum estimated tokens for conversation history before summarisation.
 * Conservative to leave room for system prompt + new prompt + agent response.
 */
const MAX_HISTORY_TOKENS = 80_000;

/**
 * Summarise the top 50% of conversation history into a single message.
 * Returns: [summary_message, ...bottom_50_percent]
 */
async function summariseConversation(
  messages: Array<{ role: string; content: unknown }>,
  llmPool: any,
): Promise<Array<{ role: string; content: unknown }>> {
  if (messages.length <= 2) return messages;

  const midpoint = Math.ceil(messages.length / 2);
  const topHalf = messages.slice(0, midpoint);
  const bottomHalf = messages.slice(midpoint);

  const topHalfText = topHalf.map((m) => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content);
    return `${role}: ${content}`;
  }).join('\n\n');

  try {
    const summaryResponse = await llmPool.call(
      [{
        role: 'user',
        content:
          'Summarise the following conversation history concisely. Preserve all key facts, ' +
          'decisions, data points, and action items. This summary will be used as context ' +
          'for future runs of a recurring scheduled task.\n\n---\n' +
          topHalfText + '\n---\n\nProvide a clear, structured summary:',
      }],
      {
        tier: 'fast',
        systemPrompt:
          'You are a precise summarisation assistant. Produce concise but complete ' +
          'summaries that preserve all important information.',
      },
    );

    const summaryMsg = {
      role: 'user' as const,
      content: `[Summary of previous ${topHalf.length} messages from earlier runs]\n\n${summaryResponse.content}`,
    };

    return [summaryMsg, ...bottomHalf];
  } catch (err: any) {
    console.warn(`[scheduler] Conversation summarisation failed: ${err.message}. Keeping full history.`);
    return messages;
  }
}

/**
 * Execute a scheduled task directly in the dashboard process using the LLM pool.
 *
 * Persistent conversation loop:
 *   1. Load conversation history from previous runs (stored on the ScheduledTask)
 *   2. Build the user prompt for this specific run
 *   3. Pass full conversation (history + new prompt) to ChatExecutor
 *   4. Save updated conversation (history + new prompt + agent response)
 *   5. If conversation exceeds token limit, summarise top 50%, keep bottom 50%
 */
async function executeTaskDirectly(
  task: any,
  agent: any,
  event: any,
  runId?: string,
) {
  const { getDb } = await import('@ai-engine/db');
  const { LLMPool } = await import('@ai-engine/llm');
  const { ChatExecutor } = await import('@ai-engine/agent-runtime');
  const { ScheduleService } = await import('@ai-engine/scheduler');
  const { MemoryService, EmbeddingService } = await import('@ai-engine/memory');
  const { withMemoryPrompt } = await import('@ai-engine/shared');
  const db = getDb();
  const scheduleService = new ScheduleService();
  const startTime = Date.now();

  // ── Build the user prompt for this run ──
  const config = (task.configJson as any) ?? {};
  const baseTaskPrompt = task.userPrompt ?? config.prompt ?? config.input ?? `Execute scheduled task: ${task.name}`;
  const runTimestamp = new Date(event.scheduledAt).toISOString();
  const runNumber = (task.totalRuns ?? 0) + 1;
  const taskPrompt = `[Scheduled Run #${runNumber} — ${runTimestamp}]\n\n${baseTaskPrompt}`;

  // ── Build the system prompt ──
  const basePrompt = agent?.rolePrompt ?? 'You are a helpful AI assistant executing a scheduled task.';
  const scheduleContext =
    `\n\n## Scheduled Task Context\n` +
    `You are executing a scheduled task: "${task.name}"\n` +
    `Schedule type: ${task.scheduleType}\n` +
    `Run #${runNumber}${task.maxRuns ? ` of ${task.maxRuns}` : ''}\n` +
    `Scheduled at: ${runTimestamp}\n` +
    (task.endAt ? `Schedule ends: ${new Date(task.endAt).toISOString()}\n` : '') +
    `\nYou have access to the full conversation history from previous runs. ` +
    `Build on your previous work and findings. If you notice patterns or ` +
    `changes from previous runs, highlight them.`;
  const systemPrompt = withMemoryPrompt(basePrompt + scheduleContext);

  // ── Load conversation history from previous runs ──
  let conversationHistory: Array<{ role: string; content: any }> =
    ((task.conversationHistory as any[]) ?? []).map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }));

  // ── Load API keys ──
  const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
  if (apiKeys.length === 0) {
    throw new Error('No API keys configured');
  }

  let nvidiaFallback: { provider: 'nvidia'; apiKey: string } | undefined;
  try {
    const nvidiaConfig = await db.config.findUnique({ where: { key: 'nvidiaApiKey' } });
    if (nvidiaConfig?.valueJson && typeof nvidiaConfig.valueJson === 'string' && nvidiaConfig.valueJson.trim()) {
      nvidiaFallback = { provider: 'nvidia', apiKey: nvidiaConfig.valueJson.trim() };
    }
  } catch { /* Config not found */ }

  const pool = new LLMPool({
    keys: apiKeys.map((k) => {
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
    fallback: nvidiaFallback,
  });

  // ── Summarise if conversation history is too long ──
  if (estimateTokens(conversationHistory) > MAX_HISTORY_TOKENS) {
    console.log(`[scheduler] Task "${task.name}" conversation exceeds token limit — summarising top 50%`);
    conversationHistory = await summariseConversation(conversationHistory, pool);
  }

  // ── Append the new user prompt to the conversation ──
  conversationHistory.push({ role: 'user', content: taskPrompt });

  // ── Build memory search function ──
  const searchMemoryFn = async (query: string, scope: string, scopeOwnerId: string | null): Promise<string> => {
    try {
      const embeddings = new EmbeddingService();
      const memService = new MemoryService(embeddings);
      const results = await memService.search(query, scope as any, scopeOwnerId, 5, { strengthenOnRecall: true });
      if (results.length === 0) return 'No matching memories found.';
      return results.map((m: any) => {
        const confidence = m.finalScore >= 0.7 ? 'high' : m.finalScore >= 0.4 ? 'medium' : 'low';
        return `- [${m.scope}/${confidence}] ${m.content}`;
      }).join('\n');
    } catch {
      return 'Memory search unavailable.';
    }
  };

  // NOTE: No scheduleDeps here — scheduled task agents must NOT create new
  // schedules. Only the Chat Agent (chat-queue, chat/send) can schedule.

  // ── Execute the agent with full conversation context ──
  const { WorkerHub } = await import('./lib/worker-hub');
  const workerHub = WorkerHub.getInstance();

  const executor = new ChatExecutor({
    llm: pool,
    tier: 'standard',
    searchMemory: searchMemoryFn,
    nodeId: 'scheduler',
    agentId: agent?.id ?? 'scheduled-task',
    workerDispatcher: workerHub,
  });

  let result;
  try {
    result = await executor.execute(
      conversationHistory as any,
      systemPrompt,
    );
  } finally {
    executor.cleanup({ releaseBrowser: true });
  }

  const durationMs = Date.now() - startTime;

  // ── Save the agent's response to the conversation history ──
  conversationHistory.push({ role: 'assistant', content: result.content });
  await scheduleService.saveConversationHistory(task.id, conversationHistory);

  // ── Save execution log ──
  if (agent) {
    await db.executionLog.create({
      data: {
        agentId: agent.id,
        scheduledRunId: runId,
        input: taskPrompt,
        output: result.content,
        tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
        durationMs,
      },
    });
  }

  // ── Update the run status ──
  if (runId) {
    await db.scheduledTaskRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        resultSummary: result.content.slice(0, 500),
      },
    });
  }

  console.log(
    `[scheduler] Task "${task.name}" run #${runNumber} executed ` +
    `(${durationMs}ms, ${result.usage.inputTokens + result.usage.outputTokens} tokens, ` +
    `${conversationHistory.length} messages in history)`
  );
}

// ---------------------------------------------------------------------------
// Memory Consolidation Loop
//
// Runs every 6 hours (like human sleep) to:
//   1. Persist decay — write current effective strength to DB
//   2. Prune forgotten memories (strength < 0.05)
//   3. Deduplicate near-identical memories
//   4. Clean stale associations
// ---------------------------------------------------------------------------

const CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function startConsolidationLoop() {
  // Run immediately on first call, then repeat every 6 hours
  runConsolidation();
  setInterval(() => runConsolidation(), CONSOLIDATION_INTERVAL_MS);
  console.log('[consolidation] Memory consolidation loop started (every 6h)');
}

async function runConsolidation() {
  try {
    const { ConsolidationService, EmbeddingService, SessionSummarizer } = await import('@ai-engine/memory');
    const embeddings = new EmbeddingService();

    // 1. Memory consolidation (decay, prune, dedup, clean associations)
    const consolidation = new ConsolidationService(embeddings);
    const result = await consolidation.consolidate();
    console.log(`[consolidation] Cycle complete: decayed=${result.memoriesDecayed}, pruned=${result.memoriesPruned}, merged=${result.memoriesMerged}, assocs=${result.associationsCleaned}`);

    // 2. Episodic memory — summarize idle conversation sessions
    const summarizer = new SessionSummarizer(embeddings);
    const summaryResult = await summarizer.summarizeIdleSessions();
    if (summaryResult.summariesCreated > 0) {
      console.log(`[consolidation] Episodic summaries: created=${summaryResult.summariesCreated}, sessions=${summaryResult.sessionsProcessed}`);
    }
  } catch (err: any) {
    console.error('[consolidation] Failed:', err.message);
  }
}
