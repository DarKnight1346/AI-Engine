import { NextRequest } from 'next/server';
import { getDb } from '@ai-engine/db';
import { ChatQueue } from '@/lib/chat-queue';
import { getAuthFromRequest } from '@/lib/auth';
import type { ChatStreamEvent } from '@ai-engine/agent-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/stream
 *
 * Streaming chat endpoint with multi-agent support.
 *
 * Body: {
 *   message: string;
 *   sessionId?: string;
 *   userId?: string;
 *   agentIds?: string[];          // Multiple agents can be invoked simultaneously
 *   attachments?: Attachment[];
 * }
 *
 * SSE Events (all carry an optional `slot` field for multi-agent):
 *   - `session`      — { sessionId, userMessageId }
 *   - `agent_start`  — { slot, agentName } — a new agent begins responding
 *   - `token`        — { slot, text }
 *   - `status`       — { slot, message }
 *   - `tool`         — { slot, name, id, phase, ... }
 *   - `done`         — { slot, content, usage, agentName }
 *   - `error`        — { slot, message }
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body = await request.json();
    const {
      message,
      sessionId: incomingSessionId,
      agentIds,
      attachments: rawAttachments,
    } = body as {
      message: string;
      sessionId?: string;
      agentIds?: string[];
      attachments?: Array<{ name: string; type: string; url: string; size: number }>;
    };

    // Extract authenticated userId from JWT cookie (not from request body)
    // This ensures each user's memories are properly scoped to their account
    const auth = await getAuthFromRequest(request);
    const userId = auth?.userId ?? (body as any).userId;

    // Support legacy single agentId field for backwards compatibility
    const legacyAgentId = (body as any).agentId as string | undefined;
    const resolvedAgentIds = agentIds ?? (legacyAgentId ? [legacyAgentId] : undefined);

    if (!message && (!rawAttachments || rawAttachments.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'message or attachments required' }),
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
          title: (message || 'New chat').slice(0, 60) + ((message || '').length > 60 ? '...' : ''),
          createdByUserId: user.id,
        },
      });
    }

    // ── Store user message ─────────────────────────────────────────
    const embedsData: Record<string, any> = {};
    if (resolvedAgentIds?.length) { embedsData.agentIds = resolvedAgentIds; }
    if (rawAttachments?.length) { embedsData.attachments = rawAttachments; }

    const hasEmbeds = Object.keys(embedsData).length > 0;
    const userMessage = await db.chatMessage.create({
      data: {
        sessionId: session.id,
        senderType: 'user',
        senderUserId: userId ?? session.createdByUserId,
        content: message || '',
        embedsJson: hasEmbeds ? (embedsData as any) : undefined,
      },
    });

    // ── Create SSE stream ──────────────────────────────────────────
    const jobId = crypto.randomUUID();

    const stream = new ReadableStream({
      start(controller) {
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

        // Keep-alive ping every 5 seconds — prevents Cloudflare tunnel,
        // reverse proxy, and HTTP/2 idle timeouts from killing the stream.
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            clearInterval(keepAlive);
          }
        }, 5000);

        // Enqueue the chat job
        const queue = ChatQueue.getInstance();

        // ── Incremental persistence ──
        // Accumulate streamed content per slot and periodically save to DB
        // so the response survives page crashes / disconnects. The ChatQueue
        // still writes the final message; this is a safety net for partial content.
        const slotBuffers = new Map<string, string>();
        let partialSaveTimer: ReturnType<typeof setInterval> | null = null;
        const sessionIdForSave = session!.id;

        const savePartialContent = async () => {
          for (const [slot, content] of slotBuffers) {
            if (!content || content.length < 20) continue; // skip trivially short content
            try {
              // Upsert a partial AI message so recovery can find it
              await db.chatMessage.upsert({
                where: { id: `partial_${sessionIdForSave}_${slot}` },
                create: {
                  id: `partial_${sessionIdForSave}_${slot}`,
                  sessionId: sessionIdForSave,
                  senderType: 'ai',
                  content,
                  aiResponded: false, // marks this as partial/in-progress
                  embedsJson: { partial: true, slot } as any,
                },
                update: {
                  content,
                },
              });
            } catch {
              // Best-effort — DB might not support the upsert on a generated ID
            }
          }
        };

        // Save partial content every 10 seconds during streaming
        partialSaveTimer = setInterval(() => {
          savePartialContent().catch(() => {});
        }, 10_000);

        queue.enqueue({
          jobId,
          sessionId: session!.id,
          message: message || '',
          userId,
          agentIds: resolvedAgentIds,
          attachments: rawAttachments,
          signal: request.signal,
          onEvent: (event: ChatStreamEvent & { slot?: string }) => {
            try {
              const slot = (event as any).slot as string | undefined;
              switch (event.type) {
                case 'agent_start':
                  send('agent_start', {
                    slot: slot ?? '__default__',
                    agentName: (event as any).agentName ?? 'AI Engine',
                  });
                  break;
                case 'token':
                  // Accumulate for incremental persistence
                  if (slot) {
                    slotBuffers.set(slot, (slotBuffers.get(slot) ?? '') + event.text);
                  }
                  send('token', { slot, text: event.text });
                  break;
                case 'status':
                  send('status', { slot, message: event.message });
                  break;
                case 'tool_call_start':
                  send('tool', { slot, phase: 'start', name: event.name, id: event.id });
                  break;
                case 'tool_call_end':
                  send('tool', {
                    slot, phase: 'end', name: event.name, id: event.id,
                    success: event.success, output: event.output.slice(0, 10_000),
                  });
                  break;
                case 'screenshot':
                  send('screenshot', {
                    slot,
                    base64: (event as any).base64,
                    toolCallId: (event as any).toolCallId,
                  });
                  break;
                case 'artifact':
                  send('artifact', {
                    slot,
                    url: (event as any).url,
                    artifactType: (event as any).artifactType,
                    toolCallId: (event as any).toolCallId,
                    filename: (event as any).filename,
                    mimeType: (event as any).mimeType,
                    size: (event as any).size,
                  });
                  break;
                case 'background_task_start':
                  send('background_task', {
                    slot,
                    taskId: (event as any).taskId,
                    toolName: (event as any).toolName,
                  });
                  break;
                case 'iteration':
                  send('status', {
                    slot,
                    message: `Iteration ${event.iteration + 1}/${event.maxIterations}`,
                  });
                  break;
                case 'done':
                  send('done', {
                    slot,
                    content: event.result.content,
                    toolCallsCount: event.result.toolCallsCount,
                    usage: event.result.usage,
                    iterations: event.result.iterations,
                    agentName: (event as any).agentName,
                  });
                  break;
                case 'error':
                  send('error', { slot, message: event.message });
                  break;
                // ── Orchestration / sub-agent events ──
                case 'clarification_request':
                  send('clarification_request', {
                    slot,
                    questions: (event as any).questions,
                  });
                  break;
                case 'report_outline':
                  send('report_outline', {
                    slot,
                    title: (event as any).title,
                    sections: (event as any).sections,
                  });
                  break;
                case 'report_section_update':
                  send('report_section_update', {
                    slot,
                    sectionId: (event as any).sectionId,
                    status: (event as any).status,
                    content: (event as any).content,
                    tier: (event as any).tier,
                  });
                  break;
                case 'report_section_stream':
                  send('report_section_stream', {
                    slot,
                    sectionId: (event as any).sectionId,
                    text: (event as any).text,
                  });
                  break;
                case 'report_section_added':
                  send('report_section_added', {
                    slot,
                    section: (event as any).section,
                  });
                  break;
                case 'subtask_complete':
                  send('subtask_complete', {
                    slot,
                    taskId: (event as any).taskId,
                    success: (event as any).success,
                    completed: (event as any).completed,
                    total: (event as any).total,
                    tier: (event as any).tier,
                  });
                  break;
              }
            } catch {
              // Stream closed
            }
          },
          onComplete: (error?: Error) => {
            clearInterval(keepAlive);
            if (partialSaveTimer) { clearInterval(partialSaveTimer); partialSaveTimer = null; }
            // Clean up partial messages (the final complete message is saved by ChatQueue)
            for (const slot of slotBuffers.keys()) {
              db.chatMessage.delete({ where: { id: `partial_${sessionIdForSave}_${slot}` } }).catch(() => {});
            }
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

        // Handle client disconnect — save partial content but let the job
        // continue running in the background so it can persist its final
        // result to the database.  We intentionally do NOT call
        // queue.cancel(jobId) here; the execution must complete and write
        // to the DB regardless of client connectivity.
        request.signal.addEventListener('abort', () => {
          clearInterval(keepAlive);
          if (partialSaveTimer) { clearInterval(partialSaveTimer); partialSaveTimer = null; }
          // Best-effort save of content accumulated so far (safety net —
          // the ChatQueue will save the final result when it finishes).
          savePartialContent().catch(() => {});
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
