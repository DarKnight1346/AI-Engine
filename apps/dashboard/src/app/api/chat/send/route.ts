import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, content } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Content required' }, { status: 400 });
    }

    // TODO: Integrate with SessionManager + AgentRunner
    return NextResponse.json({
      message: {
        id: crypto.randomUUID(),
        sessionId: sessionId ?? 'default',
        senderType: 'ai',
        content: 'This is a placeholder response. Connect the backend services for real AI responses.',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
