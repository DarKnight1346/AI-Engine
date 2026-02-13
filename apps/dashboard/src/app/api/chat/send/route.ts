import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

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

    // ── Enrich system prompt with memory & goals ─────────────────────
    try {
      // Load active goals
      const goals = await db.userGoal.findMany({
        where: { status: 'active' },
        orderBy: { priority: 'asc' },
        take: 10,
      });

      // Load recent important memories (personal + team + global)
      const memoryFilters: any[] = [{ scope: 'global' }];
      if (contextUser) {
        memoryFilters.push({ scope: 'personal', scopeOwnerId: contextUser.id });
      }
      if (contextMembership) {
        memoryFilters.push({ scope: 'team', scopeOwnerId: contextMembership.teamId });
      }

      const memories = await db.memoryEntry.findMany({
        where: { OR: memoryFilters },
        orderBy: { importance: 'desc' },
        take: 10,
      });

      if (goals.length > 0) {
        const goalsText = goals
          .map((g: any) => `- [${g.priority.toUpperCase()}] ${g.description}`)
          .join('\n');
        systemPrompt += `\n\n## Active Goals\n${goalsText}`;
      }

      if (memories.length > 0) {
        const memText = memories.map((m: any) => `- ${m.content}`).join('\n');
        systemPrompt += `\n\n## Relevant Context from Memory\n${memText}`;
      }
    } catch {
      // Memory/goals not available — continue with base prompt
    }

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

      // Resolve agent's toolConfig for tool filtering
      const agentToolConfig = agent?.toolConfig
        ? (typeof agent.toolConfig === 'object' ? agent.toolConfig as Record<string, boolean> : {})
        : undefined;

      // Build memory search function for the search_memory meta-tool
      const searchMemoryFn = async (query: string, scope: string, scopeOwnerId: string | null): Promise<string> => {
        try {
          const { MemoryService, EmbeddingService } = await import('@ai-engine/memory');
          const embeddings = new EmbeddingService();
          const memService = new MemoryService(embeddings);
          const results = await memService.search(query, scope as any, scopeOwnerId, 5);
          if (results.length === 0) return 'No matching memories found.';
          return results.map((m: any) => `- [${m.scope}] ${m.content}`).join('\n');
        } catch {
          return 'Memory search unavailable.';
        }
      };

      // Create the ChatExecutor with meta-tools (discover, execute, memory)
      const executor = new ChatExecutor({
        llm: pool,
        toolConfig: agentToolConfig,
        tier: 'standard',
        searchMemory: searchMemoryFn,
        userId: contextUser?.id,
        teamId: contextMembership?.teamId,
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
