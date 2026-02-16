'use client';

/**
 * useDashboardWS — React hook for the browser↔dashboard WebSocket connection.
 *
 * Provides a persistent WebSocket channel with auto-reconnect and ping/pong
 * keepalive. Used by both chat and planning modes as a replacement for SSE
 * and long-polling HTTP, which are unreliable through Cloudflare tunnels.
 */

import { useRef, useEffect, useState, useCallback } from 'react';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export interface ChatSendPayload {
  sessionId?: string;
  message: string;
  agentIds?: string[];
  attachments?: Array<{ name: string; type: string; url: string; size: number }>;
}

export interface PlanSendPayload {
  projectId: string;
  userMessage: string;
  attachments?: string[];
}

export interface DashboardWSCallbacks {
  /** Fired for every chat stream event (token, done, error, tool, etc.) */
  onChatEvent?: (eventType: string, data: any) => void;
  /** Fired when the chat job finishes (all agents done). */
  onChatComplete?: () => void;
  /** Fired with the full planning result. */
  onPlanResult?: (data: any) => void;
  /** Fired with incremental progress (0-100) during planning. */
  onPlanProgress?: (progress: number) => void;
  /** Fired when planning fails. */
  onPlanError?: (message: string) => void;
  /** Connection state changes. */
  onConnected?: () => void;
  onDisconnected?: () => void;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

export function useDashboardWS(callbacks: DashboardWSCallbacks = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // always latest — avoids stale closures

  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    stoppedRef.current = false;

    function connect() {
      if (stoppedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/client`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
        cbRef.current.onConnected?.();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
            case 'auth:ok':
              break;
            case 'chat:event':
              cbRef.current.onChatEvent?.(msg.event, msg.data);
              break;
            case 'chat:complete':
              cbRef.current.onChatComplete?.();
              break;
            case 'plan:result':
              cbRef.current.onPlanResult?.(msg);
              break;
            case 'plan:progress':
              cbRef.current.onPlanProgress?.(msg.progress);
              break;
            case 'plan:error':
              cbRef.current.onPlanError?.(msg.message);
              break;
            case 'error':
              console.error('[ws] Server error:', msg.message);
              break;
          }
        } catch (err) {
          console.error('[ws] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        cbRef.current.onDisconnected?.();
        if (!stoppedRef.current) {
          attemptRef.current++;
          const delay = Math.min(3_000 * Math.pow(1.5, attemptRef.current - 1), 30_000);
          reconnectRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // Error is always followed by close — reconnect logic lives there
      };
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const sendChat = useCallback((payload: ChatSendPayload): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat:send', ...payload }));
      return true;
    }
    return false;
  }, []);

  const sendPlan = useCallback((payload: PlanSendPayload): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'plan:send', ...payload }));
      return true;
    }
    return false;
  }, []);

  return { connected, sendChat, sendPlan };
}
