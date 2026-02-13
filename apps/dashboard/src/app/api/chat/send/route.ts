import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { withMemoryPrompt } from '@ai-engine/shared';

export const dynamic = 'force-dynamic';

/** Default system prompt when no agent is selected */
const DEFAULT_SYSTEM_PROMPT = `You are AI Engine, an intelligent and capable AI assistant.
You help users with tasks, answer questions, provide analysis, and assist with workflow management.
Be helpful, accurate, and concise. When providing code, use markdown code blocks with language labels.
When listing items, use bullet points or numbered lists.`;

/**
 * POST /api/chat/send
 *
 * Sends a message in a chat session. Creates the session if it doesn't exist.
 * Supports optional agent selection and memory context integration.
 *
 * Body: { message: string; sessionId?: string; userId?: string; agentId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { message, sessionId, userId, agentId } = body as {
      message: string;
      sessionId?: string;
      userId?: string;
      agentId?: string;
    };

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // ── Resolve or create session ────────────────────────────────────
    let session;
    if (sessionId) {
      session = await db.chatSession.findUnique({ where: { id: sessionId } });
    }

    if (!session) {
      const user = userId
        ? await db.user.findUnique({ where: { id: userId } })
        : await db.user.findFirst({ where: { role: 'admin' } });

      if (!user) {
        return NextResponse.json({ error: 'No user found. Complete setup first.' }, { status: 400 });
      }

      const membership = await db.teamMember.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (!membership) {
        return NextResponse.json(
          { error: 'User is not a member of any team. Create a team first in Settings.' },
          { status: 400 },
        );
      }

      session = await db.chatSession.create({
        data: {
          type: 'personal',
          ownerId: membership.teamId,
          title: message.slice(0, 60) + (message.length > 60 ? '...' : ''),
          createdByUserId: user.id,
        },
      });
    }

    // ── Resolve the user for context ─────────────────────────────────
    const contextUser = userId
      ? await db.user.findUnique({ where: { id: userId } })
      : await db.user.findFirst({ where: { role: 'admin' } });

    const contextMembership = contextUser
      ? await db.teamMember.findFirst({
          where: { userId: contextUser.id },
          orderBy: { joinedAt: 'asc' },
        })
      : null;

    // ── Resolve agent ────────────────────────────────────────────────
    let agent = null;
    let agentName: string | undefined;
    let systemPrompt = DEFAULT_SYSTEM_PROMPT;

    if (agentId) {
      agent = await db.agent.findUnique({ where: { id: agentId } });
      if (agent) {
        systemPrompt = agent.rolePrompt || DEFAULT_SYSTEM_PROMPT;
        agentName = agent.name;
      }
    }

    // Append cognitive capabilities (memory, tool discovery) to ALL prompts.
    // This ensures every agent — default or custom — knows about its memory
    // system and how to use store_memory, search_memory, discover_tools, etc.
    systemPrompt = withMemoryPrompt(systemPrompt);

    // ── Store user message ───────────────────────────────────────────
    const userMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'user',
        senderUserId: userId ?? session.createdByUserId,
        content: message,
        embedsJson: agentId ? { agentId, agentName } : undefined,
      },
    });

    // ── Call the LLM via ChatExecutor (agentic loop with tool discovery) ──
    let aiContent: string;
    try {
      const { LLMPool } = await import('@ai-engine/llm');
      const { ChatExecutor } = await import('@ai-engine/agent-runtime');

      const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
      if (apiKeys.length === 0) {
        throw new Error('No API keys configured');
      }

      const pool = new LLMPool({
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

      // ── Prompt-time skill detection ─────────────────────────────────
      // Search the skill library for skills relevant to this prompt.
      // Detected skills are injected into the system prompt so the agent
      // knows about them upfront and can use them without discovery overhead.
      let detectedSkillsText = '';
      let browserSkillDetected = false;

      try {
        const relevantSkills = await db.skill.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            instructions: true,
            requiredCapabilities: true,
          },
        });

        if (relevantSkills.length > 0) {
          // Score skills by keyword relevance to the user's message
          const msgLower = message.toLowerCase();
          const msgWords = msgLower.split(/\s+/).filter((w: string) => w.length > 2);

          const scored = relevantSkills.map((s: any) => {
            const text = `${s.name} ${s.description} ${s.category}`.toLowerCase();
            let score = 0;
            // Exact substring match in name or description
            if (text.includes(msgLower)) score += 3;
            // Word-level matches
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
            detectedSkillsText = `\n\n## Detected Relevant Skills\nThe following skills from your library may be useful for this task. You can load any of them with \`execute_tool\` using the skill name (e.g., "skill:${scored[0].name}").\n${lines.join('\n')}`;

            // Check if any detected skill involves browser capabilities
            const BROWSER_KEYWORDS = ['browser', 'navigate', 'click', 'screenshot', 'web automation', 'scrape', 'scraping', 'puppeteer', 'playwright'];
            for (const s of scored) {
              const skillText = `${s.name} ${s.description} ${s.category} ${s.instructions}`.toLowerCase();
              const caps = (s.requiredCapabilities as string[]) ?? [];
              const hasBrowserCap = caps.some((c: string) => c.toLowerCase().includes('browser'));
              const hasBrowserKeyword = BROWSER_KEYWORDS.some(kw => skillText.includes(kw));
              if (hasBrowserCap || hasBrowserKeyword) {
                browserSkillDetected = true;
                break;
              }
            }
          }
        }
      } catch {
        // Skill detection failed — continue without skill hints
      }

      // Also detect browser intent directly from the user's message
      if (!browserSkillDetected) {
        const BROWSER_MSG_KEYWORDS = ['browse', 'browser', 'navigate to', 'open website', 'screenshot', 'web automation', 'scrape', 'scraping', 'click on', 'fill form', 'web page interaction'];
        const msgLower2 = message.toLowerCase();
        browserSkillDetected = BROWSER_MSG_KEYWORDS.some(kw => msgLower2.includes(kw));
      }

      // Append skill detection context to system prompt
      if (detectedSkillsText) {
        systemPrompt += detectedSkillsText;
      }

      // If browser skills/intent detected, add Mac routing directive
      if (browserSkillDetected) {
        systemPrompt += `\n\n## Browser Automation Routing\nThis task involves browser automation. All browser-related tool calls (browser_navigate, browser_click, browser_screenshot, etc.) MUST be directed to a Mac worker node. When using browser tools, specify that the execution target should be a macOS worker to ensure compatibility with the display server and rendering environment.`;
      }

      // Agents have access to all tools — no toolConfig filtering
      // (empty config = all tools available per ToolIndex logic)

      // Build memory search function for the search_memory meta-tool.
      // This runs the actual vector search against pgvector embeddings.
      const searchMemoryFn = async (query: string, scope: string, scopeOwnerId: string | null): Promise<string> => {
        try {
          const { MemoryService, EmbeddingService } = await import('@ai-engine/memory');
          const embeddings = new EmbeddingService();
          const memService = new MemoryService(embeddings);

          console.log(`[search_memory] Vector search: query="${query.slice(0, 80)}" scope=${scope} owner=${scopeOwnerId ?? 'none'}`);

          const results = await memService.search(query, scope as any, scopeOwnerId, 5, { strengthenOnRecall: true });

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

      // Create the ChatExecutor with meta-tools (discover, execute, memory, skills, goals, profile)
      // No toolConfig filtering — agents have access to all tools
      // Worker dispatch: the WorkerHub routes tool:execute → worker → tool:result
      const { WorkerHub } = await import('@/lib/worker-hub');
      const workerHub = WorkerHub.getInstance();

      const executor = new ChatExecutor({
        llm: pool,
        tier: 'standard',
        searchMemory: searchMemoryFn,
        userId: contextUser?.id,
        teamId: contextMembership?.teamId,
        sessionId: session.id,
        workerDispatcher: workerHub,
      });

      // Build conversation history from DB
      const history = await db.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      const llmMessages = history.map((m: any) => ({
        role: m.senderType === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      }));

      // The new user message is already in the DB, but make sure it's in the list
      if (!history.some((m: any) => m.id === userMessage.id)) {
        llmMessages.push({ role: 'user' as const, content: message });
      }

      // Run the agentic loop — agent discovers & executes tools as needed
      const result = await executor.execute(llmMessages, systemPrompt);
      aiContent = result.content;
    } catch (llmErr: any) {
      aiContent = `I'm not able to respond yet because no API keys have been configured. Please add API keys in Settings > API Keys.\n\nError: ${llmErr.message}`;
    }

    // ── Store AI response ────────────────────────────────────────────
    const aiMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'ai',
        content: aiContent,
        aiResponded: true,
        embedsJson: agentId ? { agentId, agentName } : undefined,
      },
    });

    // ── Auto-extract memories from conversation (fire-and-forget) ──
    try {
      const { MemoryExtractor, MemoryService: MemSvc, EmbeddingService: EmbSvc } = await import('@ai-engine/memory');
      const embSvc = new EmbSvc();
      const memSvc = new MemSvc(embSvc);
      const extractor = new MemoryExtractor(memSvc);
      // Run async without blocking the response
      extractor.extractAndStore(
        message,
        aiContent,
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

    return NextResponse.json({
      sessionId: session.id,
      userMessage: {
        id: userMessage.id,
        content: userMessage.content,
        senderType: 'user',
        createdAt: userMessage.createdAt.toISOString(),
      },
      aiMessage: {
        id: aiMessage.id,
        content: aiMessage.content,
        senderType: 'ai',
        createdAt: aiMessage.createdAt.toISOString(),
        agentName,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
