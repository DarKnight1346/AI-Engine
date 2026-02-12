import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/** GET /api/chat/sessions — List all chat sessions */
export async function GET() {
  try {
    const db = getDb();
    const sessions = await db.chatSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, createdAt: true, senderType: true },
        },
      },
      take: 50,
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        messageCount: s._count.messages,
        lastMessage: s.messages[0]?.content?.slice(0, 100) ?? null,
        lastMessageAt: s.messages[0]?.createdAt?.toISOString() ?? s.createdAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ sessions: [], error: err.message }, { status: 500 });
  }
}

/** DELETE /api/chat/sessions?id=xxx — Delete a chat session and all messages */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Delete messages first, then the session
    await db.chatMessage.deleteMany({ where: { sessionId: id } });
    await db.chatSession.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
