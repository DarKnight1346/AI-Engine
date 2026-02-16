'use client';

/**
 * useDashboardWS — React hook for the browser↔dashboard WebSocket connection.
 *
 * Uses a module-level singleton so that only ONE WebSocket exists regardless
 * of how many components call this hook. Provides auto-reconnect with
 * exponential backoff and ping/pong keepalive.
 *
 * The connection is created when the first subscriber mounts and torn down
 * when the last subscriber unmounts.
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
// Singleton connection manager
// -----------------------------------------------------------------------

type Listener = (msg: any) => void;

let _ws: WebSocket | null = null;
let _connected = false;
let _attempt = 0;
let _stopped = true;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _authenticated = false;

/** Set of all active listeners (one per hook instance). */
const _listeners = new Set<Listener>();
/** Separate set for connection state change listeners. */
const _stateListeners = new Set<(connected: boolean) => void>();

function _notifyState(conn: boolean) {
  _connected = conn;
  for (const fn of _stateListeners) fn(conn);
}

function _notifyMessage(msg: any) {
  for (const fn of _listeners) fn(msg);
}

function _connect() {
  if (_stopped) return;
  if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/client`);
  _ws = ws;

  ws.onopen = () => {
    // Don't reset attempt counter yet — wait for auth:ok to confirm it's a real connection
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (msg.type === 'auth:ok') {
        _authenticated = true;
        _attempt = 0; // Only reset backoff after successful authentication
        _notifyState(true);
        return;
      }

      if (msg.type === 'error') {
        console.warn('[ws] Server error:', msg.message);
        // If server says "starting up", don't spam reconnects — bump attempt counter
        if (msg.message?.includes('starting up')) {
          _attempt = Math.max(_attempt, 3); // Start at a higher backoff level
        }
        return;
      }

      // Forward everything else to listeners
      _notifyMessage(msg);
    } catch (err) {
      console.error('[ws] Parse error:', err);
    }
  };

  ws.onclose = () => {
    const wasAuthenticated = _authenticated;
    _authenticated = false;
    _ws = null;

    if (wasAuthenticated) {
      _notifyState(false);
    }

    if (!_stopped) {
      _attempt++;
      // Base delay 3s, max 30s. If server said "starting up", _attempt is already >= 4
      const delay = Math.min(3_000 * Math.pow(1.5, _attempt - 1), 30_000);
      console.log(`[ws] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${_attempt})`);
      _reconnectTimer = setTimeout(_connect, delay);
    }
  };

  ws.onerror = () => {
    // Error is always followed by close — reconnect logic lives there
  };
}

function _start() {
  if (!_stopped) return;
  _stopped = false;
  _attempt = 0;
  _connect();
}

function _stop() {
  _stopped = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  _authenticated = false;
  _notifyState(false);
}

function _send(data: any): boolean {
  if (_ws?.readyState === WebSocket.OPEN && _authenticated) {
    _ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

export function useDashboardWS(callbacks: DashboardWSCallbacks = {}) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks; // always latest — avoids stale closures

  const [connected, setConnected] = useState(_connected);

  useEffect(() => {
    // Message listener for this hook instance
    const messageListener: Listener = (msg) => {
      switch (msg.type) {
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
      }
    };

    // State listener for this hook instance
    const stateListener = (conn: boolean) => {
      setConnected(conn);
      if (conn) cbRef.current.onConnected?.();
      else cbRef.current.onDisconnected?.();
    };

    _listeners.add(messageListener);
    _stateListeners.add(stateListener);

    // Start the singleton connection if this is the first subscriber
    if (_listeners.size === 1) {
      _start();
    }
    // Sync initial state
    setConnected(_connected);

    return () => {
      _listeners.delete(messageListener);
      _stateListeners.delete(stateListener);

      // Tear down the connection when the last subscriber unmounts
      if (_listeners.size === 0) {
        _stop();
      }
    };
  }, []);

  const sendChat = useCallback((payload: ChatSendPayload): boolean => {
    return _send({ type: 'chat:send', ...payload });
  }, []);

  const sendPlan = useCallback((payload: PlanSendPayload): boolean => {
    return _send({ type: 'plan:send', ...payload });
  }, []);

  return { connected, sendChat, sendPlan };
}
