import { NextRequest } from 'next/server';
import { ChatQueue } from '@/lib/chat-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/clarify
 *
 * Receives user answers to clarification questions posed by the agent's
 * `ask_user` tool. The answers are forwarded to the pending clarification
 * callback in ChatQueue, which unblocks the agent's execution.
 *
 * Body: {
 *   sessionId: string;
 *   answers: Record<string, string>;  // questionId -> answer text
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, answers } = body as {
      sessionId: string;
      answers: Record<string, string>;
    };

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (!answers || typeof answers !== 'object') {
      return new Response(
        JSON.stringify({ error: 'answers object is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const queue = ChatQueue.getInstance();
    const resolved = queue.resolveClarification(sessionId, answers);

    if (!resolved) {
      return new Response(
        JSON.stringify({ error: 'No pending clarification found for this session' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
