/**
 * DashboardClient — worker-side WebSocket connection to the dashboard.
 *
 * Handles authentication, heartbeats, reconnection, and message routing.
 * All worker↔dashboard communication goes through this client.
 */

import WebSocket from 'ws';
import type { WorkerWsMessage, DashboardWsMessage, NodeCapabilities } from '@ai-engine/shared';

type MessageHandler = (msg: DashboardWsMessage) => void;

export interface DashboardClientOptions {
  serverUrl: string;
  token: string;
  capabilities: NodeCapabilities;
  onTaskAssigned: (msg: Extract<DashboardWsMessage, { type: 'task:assign' }>) => void;
  onToolExecute: (msg: Extract<DashboardWsMessage, { type: 'tool:execute' }>) => void;
  onAgentCall: (msg: Extract<DashboardWsMessage, { type: 'agent:call' }>) => void;
  onAgentResponse: (msg: Extract<DashboardWsMessage, { type: 'agent:response' }>) => void;
  onConfigUpdate: (msg: Extract<DashboardWsMessage, { type: 'config:update' }>) => void;
  onUpdateAvailable: (msg: Extract<DashboardWsMessage, { type: 'update:available' }>) => void;
}

export class DashboardClient {
  private ws: WebSocket | null = null;
  private opts: DashboardClientOptions;
  private workerId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private activeTasks = 0;
  private connected = false;

  constructor(opts: DashboardClientOptions) {
    this.opts = opts;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<string> {
    this.stopped = false;

    return new Promise((resolve, reject) => {
      const wsUrl = this.opts.serverUrl
        .replace(/^http/, 'ws')
        .replace(/\/$/, '') + '/ws/worker';

      console.log(`[client] Connecting to ${wsUrl}...`);
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, 15_000);

      this.ws.on('open', () => {
        console.log('[client] Connected, authenticating...');
        this.sendRaw({ type: 'auth', token: this.opts.token });
      });

      this.ws.on('message', (raw: Buffer | string) => {
        try {
          const msg: DashboardWsMessage = JSON.parse(
            typeof raw === 'string' ? raw : raw.toString('utf-8'),
          );
          this.handleMessage(msg, resolve, reject, timeout);
        } catch (err: any) {
          console.error('[client] Parse error:', err.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.connected = false;
        this.stopHeartbeat();
        console.log(`[client] Disconnected (code ${code}: ${reason?.toString() ?? 'unknown'})`);
        if (!this.stopped) this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[client] WebSocket error:', err.message);
        if (!this.connected) reject(err);
      });
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnect();
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getWorkerId(): string | null {
    return this.workerId;
  }

  // -----------------------------------------------------------------------
  // Send messages to dashboard
  // -----------------------------------------------------------------------

  sendTaskComplete(taskId: string, output: string, tokensUsed: number, durationMs: number): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.sendRaw({ type: 'task:complete', taskId, output, tokensUsed, durationMs });
  }

  sendTaskFailed(taskId: string, error: string): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.sendRaw({ type: 'task:failed', taskId, error });
  }

  sendToolResult(callId: string, success: boolean, output: string): void {
    this.sendRaw({ type: 'tool:result', callId, success, output });
  }

  sendAgentCall(callId: string, fromAgentId: string, targetAgentId: string, input: string): void {
    this.sendRaw({ type: 'agent:call', callId, fromAgentId, targetAgentId, input });
  }

  sendAgentResponse(callId: string, output: string, error?: string): void {
    this.sendRaw({ type: 'agent:response', callId, output, error });
  }

  sendLog(level: 'info' | 'warn' | 'error', message: string, taskId?: string): void {
    this.sendRaw({ type: 'log', level, message, taskId });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private handleMessage(
    msg: DashboardWsMessage,
    resolveConnect?: (workerId: string) => void,
    rejectConnect?: (err: Error) => void,
    connectTimeout?: ReturnType<typeof setTimeout>,
  ): void {
    switch (msg.type) {
      case 'auth:ok':
        this.workerId = msg.workerId;
        this.connected = true;
        console.log(`[client] Authenticated as ${msg.workerId}`);
        this.startHeartbeat();
        if (connectTimeout) clearTimeout(connectTimeout);
        resolveConnect?.(msg.workerId);
        break;

      case 'auth:error':
        console.error('[client] Auth failed:', msg.message);
        if (connectTimeout) clearTimeout(connectTimeout);
        rejectConnect?.(new Error(msg.message));
        break;

      case 'task:assign':
        this.activeTasks += 1;
        this.opts.onTaskAssigned(msg);
        break;

      case 'task:cancel':
        // TODO: implement task cancellation
        break;

      case 'tool:execute':
        this.opts.onToolExecute(msg);
        break;

      case 'agent:call':
        this.opts.onAgentCall(msg);
        break;

      case 'agent:response':
        this.opts.onAgentResponse(msg);
        break;

      case 'config:update':
        this.opts.onConfigUpdate(msg);
        break;

      case 'update:available':
        this.opts.onUpdateAvailable(msg);
        break;
    }
  }

  private sendRaw(msg: WorkerWsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const loadAvg = (typeof globalThis.performance !== 'undefined')
        ? 0
        : 0; // os.loadavg()[0] will be set in the worker
      this.sendRaw({
        type: 'heartbeat',
        load: loadAvg,
        activeTasks: this.activeTasks,
        capabilities: this.opts.capabilities,
      });
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay = 5_000;
    console.log(`[client] Reconnecting in ${delay / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error('[client] Reconnect failed:', err.message);
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
