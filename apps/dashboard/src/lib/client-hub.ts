/**
 * ClientHub — manages WebSocket connections from browser clients.
 *
 * Provides a persistent WebSocket channel for chat streaming and planning
 * requests, replacing SSE and long-polling HTTP which are unreliable through
 * Cloudflare tunnels.
 *
 * Message protocol:
 *
 * Client → Server:
 *   { type: 'chat:send',  sessionId?, message, agentIds?, attachments? }
 *   { type: 'plan:send',  projectId, userMessage, attachments? }
 *   { type: 'pong' }
 *
 * Server → Client:
 *   { type: 'ping' }
 *   { type: 'auth:ok' }
 *   { type: 'chat:event', event: '<eventType>', data: {...} }
 *   { type: 'chat:complete' }
 *   { type: 'plan:progress', progress: number }
 *   { type: 'plan:result', response, prd, tasks, wireframes, questions, context }
 *   { type: 'plan:error', message }
 *   { type: 'error', message }
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  email: string;
  connectedAt: Date;
}

export class ClientHub {
  private static instance: ClientHub;
  private clients = new Set<ConnectedClient>();
  private _port = 3000;

  static getInstance(): ClientHub {
    if (!ClientHub.instance) {
      ClientHub.instance = new ClientHub();
    }
    return ClientHub.instance;
  }

  setPort(port: number): void {
    this._port = port;
  }

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const cookies = this.parseCookies(req.headers.cookie ?? '');
    const token = cookies['ai-engine-token'];

    if (!token) {
      this.send(ws, { type: 'error', message: 'Not authenticated' });
      ws.close(4001, 'not_authenticated');
      return;
    }

    let userId: string;
    let email: string;
    try {
      const jwt = require('jsonwebtoken');
      const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';
      const payload = jwt.verify(token, secret) as { userId: string; email: string };
      userId = payload.userId;
      email = payload.email ?? '';
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid token' });
      ws.close(4001, 'invalid_token');
      return;
    }

    const client: ConnectedClient = { ws, userId, email, connectedAt: new Date() };
    this.clients.add(client);
    console.log(`[client-ws] Connected (userId: ${userId}, total: ${this.clients.size})`);

    this.send(ws, { type: 'auth:ok' });

    // Ping every 10s — keeps Cloudflare tunnel alive.
    // Only use application-level JSON pings; WebSocket protocol-level ping
    // frames (ws.ping()) can be corrupted by Cloudflare tunnels, causing
    // "Invalid frame header" errors on the browser side.
    const pingTimer = setInterval(() => {
      if (ws.readyState === 1) {
        this.send(ws, { type: 'ping' });
      }
    }, 10_000);

    ws.on('message', async (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8'));
        await this.handleMessage(client, msg, token);
      } catch (err: any) {
        console.error('[client-ws] Message error:', err.message);
      }
    });

    ws.on('close', () => {
      clearInterval(pingTimer);
      this.clients.delete(client);
      console.log(`[client-ws] Disconnected (userId: ${userId}, total: ${this.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[client-ws] Error (userId: ${userId}):`, err.message);
    });
  }

  // -----------------------------------------------------------------------
  // Message routing
  // -----------------------------------------------------------------------

  private async handleMessage(client: ConnectedClient, msg: any, authToken: string): Promise<void> {
    switch (msg.type) {
      case 'pong':
        break;

      case 'chat:send':
        await this.handleChatSend(client, msg);
        break;

      case 'plan:send':
        await this.handlePlanSend(client, msg, authToken);
        break;

      default:
        this.send(client.ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  }

  // -----------------------------------------------------------------------
  // Chat — integrates directly with ChatQueue
  // -----------------------------------------------------------------------

  private async handleChatSend(client: ConnectedClient, msg: any): Promise<void> {
    try {
      const { ChatQueue } = await import('./chat-queue');
      const { getDb } = await import('@ai-engine/db');
      const db = getDb();

      // Resolve or create session (mirrors /api/chat/stream logic)
      let session: any;
      if (msg.sessionId) {
        session = await db.chatSession.findUnique({ where: { id: msg.sessionId } });
      }

      if (!session) {
        const user = client.userId
          ? await db.user.findUnique({ where: { id: client.userId } })
          : await db.user.findFirst({ where: { role: 'admin' } });

        if (!user) {
          this.send(client.ws, { type: 'chat:event', event: 'error', data: { message: 'No user found. Complete setup first.' } });
          return;
        }

        const membership = await db.teamMember.findFirst({
          where: { userId: user.id },
          orderBy: { joinedAt: 'asc' },
        });

        if (!membership) {
          this.send(client.ws, { type: 'chat:event', event: 'error', data: { message: 'User is not a member of any team.' } });
          return;
        }

        session = await db.chatSession.create({
          data: {
            type: 'personal',
            ownerId: membership.teamId,
            title: (msg.message || 'New chat').slice(0, 60) + ((msg.message || '').length > 60 ? '...' : ''),
            createdByUserId: user.id,
          },
        });
      }

      // Store user message
      const embedsData: Record<string, any> = {};
      if (msg.agentIds?.length) embedsData.agentIds = msg.agentIds;
      if (msg.attachments?.length) embedsData.attachments = msg.attachments;
      const hasEmbeds = Object.keys(embedsData).length > 0;

      const userMessage = await db.chatMessage.create({
        data: {
          sessionId: session.id,
          senderType: 'user',
          senderUserId: client.userId ?? session.createdByUserId,
          content: msg.message || '',
          embedsJson: hasEmbeds ? (embedsData as any) : undefined,
        },
      });

      // Send session info immediately
      this.send(client.ws, {
        type: 'chat:event',
        event: 'session',
        data: { sessionId: session.id, userMessageId: userMessage.id },
      });

      // Enqueue to ChatQueue with WS-based callbacks
      const queue = ChatQueue.getInstance();
      const jobId = globalThis.crypto.randomUUID();

      queue.enqueue({
        jobId,
        sessionId: session.id,
        message: msg.message || '',
        userId: client.userId,
        agentIds: msg.agentIds,
        attachments: msg.attachments,
        onEvent: (event: any) => {
          try {
            this.forwardChatEvent(client.ws, event, session.id);
          } catch { /* WS closed */ }
        },
        onComplete: (error?: Error) => {
          if (error) {
            this.send(client.ws, { type: 'chat:event', event: 'error', data: { message: error.message, sessionId: session.id } });
          }
          this.send(client.ws, { type: 'chat:complete', data: { sessionId: session.id } });
        },
      });
    } catch (err: any) {
      console.error('[client-ws] Chat send error:', err.message);
      this.send(client.ws, { type: 'chat:event', event: 'error', data: { message: err.message } });
      this.send(client.ws, { type: 'chat:complete' });
    }
  }

  /**
   * Map ChatStreamEvent types to the same event names the SSE stream used,
   * so the frontend event handling logic stays identical.
   */
  private forwardChatEvent(ws: WebSocket, event: any, sessionId?: string): void {
    const slot = event.slot as string | undefined;
    let eventType: string;
    let data: any;

    switch (event.type) {
      case 'agent_start':
        eventType = 'agent_start';
        data = { slot: slot ?? '__default__', agentName: event.agentName ?? 'AI Engine' };
        break;
      case 'token':
        eventType = 'token';
        data = { slot, text: event.text };
        break;
      case 'status':
        eventType = 'status';
        data = { slot, message: event.message };
        break;
      case 'tool_call_start':
        eventType = 'tool';
        data = { slot, phase: 'start', name: event.name, id: event.id };
        break;
      case 'tool_call_end':
        eventType = 'tool';
        data = { slot, phase: 'end', name: event.name, id: event.id, success: event.success, output: event.output?.slice(0, 10_000) };
        break;
      case 'screenshot':
        eventType = 'screenshot';
        data = { slot, base64: event.base64, toolCallId: event.toolCallId };
        break;
      case 'artifact':
        eventType = 'artifact';
        data = {
          slot,
          url: (event as any).url,
          artifactType: (event as any).artifactType,
          toolCallId: (event as any).toolCallId,
          filename: (event as any).filename,
          mimeType: (event as any).mimeType,
          size: (event as any).size,
        };
        break;
      case 'background_task_start':
        eventType = 'background_task';
        data = { slot, taskId: event.taskId, toolName: event.toolName };
        break;
      case 'iteration':
        eventType = 'status';
        data = { slot, message: `Iteration ${event.iteration + 1}/${event.maxIterations}` };
        break;
      case 'done':
        eventType = 'done';
        data = {
          slot, content: event.result?.content,
          toolCallsCount: event.result?.toolCallsCount,
          usage: event.result?.usage,
          iterations: event.result?.iterations,
          agentName: event.agentName,
        };
        break;
      case 'error':
        eventType = 'error';
        data = { slot, message: event.message };
        break;
      case 'clarification_request':
        eventType = 'clarification_request';
        data = { slot, questions: event.questions };
        break;
      case 'report_outline':
        eventType = 'report_outline';
        data = { slot, title: event.title, sections: event.sections };
        break;
      case 'report_section_update':
        eventType = 'report_section_update';
        data = { slot, sectionId: event.sectionId, status: event.status, content: event.content, tier: event.tier };
        break;
      case 'report_section_stream':
        eventType = 'report_section_stream';
        data = { slot, sectionId: event.sectionId, text: event.text };
        break;
      case 'report_section_added':
        eventType = 'report_section_added';
        data = { slot, section: event.section };
        break;
      case 'subtask_complete':
        eventType = 'subtask_complete';
        data = { slot, taskId: event.taskId, success: event.success, completed: event.completed, total: event.total, tier: event.tier };
        break;
      default:
        return;
    }

    if (sessionId) data.sessionId = sessionId;
    this.send(ws, { type: 'chat:event', event: eventType, data });
  }

  // -----------------------------------------------------------------------
  // Planning — proxies to the existing HTTP route (avoids code duplication)
  // -----------------------------------------------------------------------

  private async handlePlanSend(client: ConnectedClient, msg: any, authToken: string): Promise<void> {
    this.send(client.ws, { type: 'plan:progress', progress: 10 });

    // Increment progress while waiting so the UI feels responsive
    let currentProgress = 10;
    const progressTimer = setInterval(() => {
      currentProgress = Math.min(currentProgress + 3, 90);
      this.send(client.ws, { type: 'plan:progress', progress: currentProgress });
    }, 4_000);

    try {
      const port = this._port;
      const response = await fetch(`http://localhost:${port}/api/projects/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `ai-engine-token=${authToken}`,
        },
        body: JSON.stringify({
          projectId: msg.projectId,
          userMessage: msg.userMessage,
          attachments: msg.attachments,
        }),
      });

      clearInterval(progressTimer);

      // Guard against non-JSON responses (e.g. HTML error pages from timeouts or proxy errors)
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.includes('application/json')) {
        const statusText = response.statusText || `HTTP ${response.status}`;
        const bodyPreview = await response.text().catch(() => '');
        const isHtml = bodyPreview.trimStart().startsWith('<');
        const detail = isHtml
          ? `Server returned an HTML error page (${statusText}). The planning request likely timed out — try a simpler message or break it into smaller steps.`
          : (bodyPreview.slice(0, 200) || statusText);
        this.send(client.ws, { type: 'plan:error', message: detail });
        return;
      }

      const data = await response.json();
      if (data.error) {
        this.send(client.ws, { type: 'plan:error', message: data.error });
        return;
      }

      this.send(client.ws, { type: 'plan:progress', progress: 100 });
      this.send(client.ws, { type: 'plan:result', ...data });
    } catch (err: any) {
      clearInterval(progressTimer);
      console.error('[client-ws] Plan send error:', err.message);
      this.send(client.ws, { type: 'plan:error', message: err.message });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private send(ws: WebSocket, msg: any): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split(';')) {
      const [key, ...vals] = pair.trim().split('=');
      if (key) cookies[key.trim()] = vals.join('=').trim();
    }
    return cookies;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
