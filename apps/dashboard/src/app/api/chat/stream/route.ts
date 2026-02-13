import { NextRequest } from 'next/server';
import { getDb } from '@ai-engine/db';
import { ChatQueue } from '@/lib/chat-queue';
import type { ChatStreamEvent } from '@ai-engine/agent-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/stream
 *
 * Streaming chat endpoint. Accepts a message, enqueues it in the ChatQueue
 * for async processing, and returns an SSE stream that emits events as the
 * AI generates its response.
 *
 * This replaces the synchronous /api/chat/send for the dashboard UI,
 * enabling real-time token streaming and handling thousands of concurrent
 * chats without blocking the server.
 *
 * SSE Events:
 *   - `session`   — { sessionId, userMessageId } — sent immediately
 *   - `token`     — { text } — streamed tokens from the LLM
 *   - `status`    — { message } — status updates (tool calls, iterations)
 *   - `tool`      — { name, id, phase, ... } — tool call lifecycle
 *   - `done`      — { content, usage, iterations } — final response
 *   - `error`     — { message } — error occurred
 *
 * Body: { message: string; sessionId?: string; userId?: string; agentId?: string }
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body = await request.json();
    const { message, sessionId: incomingSessionId, userId, agentId } = body as {
      message: string;
      sessionId?: string;
      userId?: string;
      agentId?: string;
    };

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = getDb();

    // ── Resolve or create session ──────────────────────────────────
    let session;
    if (incomingSessionId) {
      session = await db.chatSession.findUnique({ where: { id: incomingSessionId } });
    }

    if (!session) {
      const user = userId
        ? await db.user.findUnique({ where: { id: userId } })
        : await db.user.findFirst({ where: { role: 'admin' } });

      if (!user) {
        return new Response(
          JSON.stringify({ error: 'No user found. Complete setup first.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const membership = await db.teamMember.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      });

      if (!membership) {
        return new Response(
          JSON.stringify({ error: 'User is not a member of any team.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
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

    // ── Store user message ─────────────────────────────────────────
    let agentName: string | undefined;
    if (agentId) {
      const agent = await db.agent.findUnique({ where: { id: agentId }, select: { name: true } });
      if (agent) agentName = agent.name;
    }

    const userMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'user',
        senderUserId: userId ?? session.createdByUserId,
        content: message,
        embedsJson: agentId ? { agentId, agentName } : undefined,
      },
    });

    // ── Create SSE stream ──────────────────────────────────────────
    const jobId = crypto.randomUUID();

    const stream = new ReadableStream({
      start(controller) {
        // Helper to send an SSE event
        function send(event: string, data: Record<string, unknown>) {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            // Stream closed by client
          }
        }

        // Send session info immediately
        send('session', {
          sessionId: session!.id,
          userMessageId: userMessage.id,
        });

        // Keep-alive ping every 15 seconds
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            clearInterval(keepAlive);
          }
        }, 15000);

        // Enqueue the chat job
        const queue = ChatQueue.getInstance();

        queue.enqueue({
          jobId,
          sessionId: session!.id,
          message,
          userId,
          agentId: agentId ?? undefined,
          signal: request.signal,
          onEvent: (event: ChatStreamEvent) => {
            try {
              switch (event.type) {
                case 'token':
                  send('token', { text: event.text });
                  break;
                case 'status':
                  send('status', { message: event.message });
                  break;
                case 'tool_call_start':
                  send('tool', { phase: 'start', name: event.name, id: event.id });
                  break;
                case 'tool_call_end':
                  send('tool', {
                    phase: 'end', name: event.name, id: event.id,
                    success: event.success, output: event.output.slice(0, 500),
                  });
                  break;
                case 'iteration':
                  send('status', {
                    message: `Iteration ${event.iteration + 1}/${event.maxIterations}`,
                  });
                  break;
                case 'done':
                  send('done', {
                    content: event.result.content,
                    toolCallsCount: event.result.toolCallsCount,
                    usage: event.result.usage,
                    iterations: event.result.iterations,
                    agentName,
                  });
                  break;
                case 'error':
                  send('error', { message: event.message });
                  break;
              }
            } catch {
              // Stream closed
            }
          },
          onComplete: (error?: Error) => {
            clearInterval(keepAlive);
            if (error) {
              send('error', { message: error.message });
            }
            try {
              controller.close();
            } catch {
              // Already closed
            }
          },
        });

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          clearInterval(keepAlive);
          queue.cancel(jobId);
          try { controller.close(); } catch { /* ignore */ }
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Chat-Session-Id': session.id,
        'X-Chat-Job-Id': jobId,
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
