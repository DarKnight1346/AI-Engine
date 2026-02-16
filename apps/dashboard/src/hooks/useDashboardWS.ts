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
  onChatComplete?: (data?: any) => void;
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
/** Monotonically increasing ID so stale onclose handlers can detect they belong to an old socket. */
let _wsGeneration = 0;

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
  const url = `${protocol}//${window.location.host}/ws/client`;
  console.log(`[ws] Connecting to ${url} ...`);

  const gen = ++_wsGeneration;
  const ws = new WebSocket(url);
  _ws = ws;

  ws.onopen = () => {
    console.log('[ws] Socket opened, waiting for auth:ok ...');
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
        _attempt = 0;
        console.log('[ws] Authenticated — WebSocket ready');
        _notifyState(true);
        return;
      }

      if (msg.type === 'error') {
        console.warn('[ws] Server error:', msg.message);
        if (msg.message?.includes('starting up')) {
          _attempt = Math.max(_attempt, 3);
        }
        return;
      }

      _notifyMessage(msg);
    } catch (err) {
      console.error('[ws] Parse error:', err);
    }
  };

  ws.onclose = (ev) => {
    // Guard: if a newer socket has already replaced us, do nothing.
    // This prevents the React Strict Mode double-mount race where an old
    // socket's async onclose fires after _connect() already created a new one.
    if (gen !== _wsGeneration) return;

    const wasAuthenticated = _authenticated;
    _authenticated = false;
    _ws = null;

    if (wasAuthenticated) {
      _notifyState(false);
    }

    if (!_stopped) {
      _attempt++;
      const delay = Math.min(3_000 * Math.pow(1.5, _attempt - 1), 30_000);
      console.log(`[ws] Closed (code ${ev.code}). Reconnecting in ${Math.round(delay / 1000)}s (attempt ${_attempt})`);
      _reconnectTimer = setTimeout(_connect, delay);
    } else {
      console.log(`[ws] Closed (code ${ev.code}). Stopped — not reconnecting.`);
    }
  };

  ws.onerror = () => {
    console.warn('[ws] Connection error (close event will follow)');
  };
}

function _start() {
  if (!_stopped) return;
  _stopped = false;
  _attempt = 0;
  console.log('[ws] Starting WebSocket connection manager');
  _connect();
}

function _stop() {
  _stopped = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    // Bump generation so the pending onclose from this socket is ignored
    _wsGeneration++;
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
          cbRef.current.onChatComplete?.(msg.data);
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
