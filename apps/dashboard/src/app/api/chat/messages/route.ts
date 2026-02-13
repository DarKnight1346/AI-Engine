import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/** GET /api/chat/messages?sessionId=xxx — Load messages for a session */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const sessionId = request.nextUrl.searchParams.get('sessionId');
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    const messages = await db.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return NextResponse.json({
      messages: messages.map((m) => {
        const embeds = m.embedsJson as any;
        return {
          id: m.id,
          role: m.senderType === 'user' ? 'user' : 'ai',
          content: m.content,
          timestamp: m.createdAt.toISOString(),
          agentName: embeds?.agentName ?? undefined,
          attachments: embeds?.attachments ?? undefined,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ messages: [], error: err.message }, { status: 500 });
  }
}
