import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/messages/metadata
 *
 * Saves report metadata to the last AI message in a session.
 * This allows report data to persist across page loads and session switches.
 *
 * Body: { sessionId: string; reportData: object }
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, reportData } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const db = getDb();

    // Find the last AI message in this session
    const lastAiMessage = await db.chatMessage.findFirst({
      where: { sessionId, senderType: 'ai' },
      orderBy: { createdAt: 'desc' },
    });

    if (!lastAiMessage) {
      return NextResponse.json({ error: 'No AI message found' }, { status: 404 });
    }

    // Merge report data into the existing embedsJson
    const existingEmbeds = (lastAiMessage.embedsJson as Record<string, any>) ?? {};
    await db.chatMessage.update({
      where: { id: lastAiMessage.id },
      data: {
        embedsJson: {
          ...existingEmbeds,
          reportData: reportData ?? undefined,
        } as any,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
