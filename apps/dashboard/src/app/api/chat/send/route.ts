import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/send
 *
 * Sends a message in a chat session. Creates the session if it doesn't exist.
 * Stores the user message, calls the LLM, and stores the AI response.
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { message, sessionId, userId } = body as {
      message: string;
      sessionId?: string;
      userId?: string;
    };

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Resolve or create session
    let session;
    if (sessionId) {
      session = await db.chatSession.findUnique({ where: { id: sessionId } });
    }

    if (!session) {
      // Find or create a default user if none provided
      const user = userId
        ? await db.user.findUnique({ where: { id: userId } })
        : await db.user.findFirst({ where: { role: 'admin' } });

      if (!user) {
        return NextResponse.json({ error: 'No user found. Complete setup first.' }, { status: 400 });
      }

      // ownerId is a FK to the Team table, so we need the user's team — not user.id
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

    // Store user message
    const userMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'user',
        senderUserId: userId ?? session.createdByUserId,
        content: message,
      },
    });

    // Call the LLM
    let aiContent: string;
    try {
      const { LLMPool } = await import('@ai-engine/llm');

      // Load API keys from the database
      const apiKeys = await db.apiKey.findMany({ where: { isActive: true } });
      if (apiKeys.length === 0) {
        throw new Error('No API keys configured');
      }

      // Decrypt keys — for now, key_encrypted stores the raw key
      // (actual decryption via vault in production)
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
      });

      // Build conversation history from DB
      const history = await db.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      const llmMessages = history.map((m) => ({
        role: m.senderType === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));

      // Add the new message (already saved to DB above)
      llmMessages.push({ role: 'user' as const, content: message });

      const result = await pool.call(llmMessages, { tier: 'standard' });
      aiContent = result.content;
    } catch (llmErr: any) {
      aiContent = `I'm not able to respond yet because no Claude API keys have been configured. Please add API keys in Settings > API Keys.\n\nError: ${llmErr.message}`;
    }

    // Store AI response
    const aiMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'ai',
        content: aiContent,
        aiResponded: true,
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
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
