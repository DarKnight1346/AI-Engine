/**
 * Worker Management Tools
 *
 * Dashboard-safe tools that give the agent full visibility and control
 * over connected worker nodes. These run inline on the dashboard and
 * query the WorkerHub singleton — they are NOT dispatched to workers.
 *
 * Tools:
 *   - listWorkers       — List all connected workers with status/capabilities
 *   - getWorkerStatus   — Detailed status for a single worker by ID or hostname
 *   - disconnectWorker  — Disconnect a worker node by ID
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import type { WorkerToolDispatcher, WorkerInfo } from '../tool-executor.js';

// ---------------------------------------------------------------------------
// Factory — creates executable tool instances bound to a WorkerToolDispatcher
// ---------------------------------------------------------------------------

export function createWorkerManagementTools(
  dispatcher: WorkerToolDispatcher,
): Tool[] {
  return [
    createListWorkersTool(dispatcher),
    createGetWorkerStatusTool(dispatcher),
    createDisconnectWorkerTool(dispatcher),
  ];
}

// ---------------------------------------------------------------------------
// listWorkers
// ---------------------------------------------------------------------------

function createListWorkersTool(dispatcher: WorkerToolDispatcher): Tool {
  return {
    name: 'listWorkers',
    description:
      'List all connected worker nodes with their status, capabilities, load, active tasks, and uptime. ' +
      'Use this to see which workers are available before targeting a specific one.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description:
            'Optional filter: "all" (default), "idle" (no active tasks), "busy" (has active tasks), ' +
            '"docker" (Docker-capable), "browser" (browser-capable).',
        },
      },
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const workers = dispatcher.getConnectedWorkers();

      if (workers.length === 0) {
        return {
          success: true,
          output: 'No worker nodes are currently connected. Connect a worker using the install script at /api/worker/install-script.',
        };
      }

      const filter = (input.filter as string) ?? 'all';
      let filtered = workers;

      switch (filter) {
        case 'idle':
          filtered = workers.filter((w) => w.activeTasks === 0);
          break;
        case 'busy':
          filtered = workers.filter((w) => w.activeTasks > 0);
          break;
        case 'docker':
          filtered = workers.filter((w) => w.dockerAvailable);
          break;
        case 'browser':
          filtered = workers.filter((w) => w.capabilities?.browserCapable);
          break;
      }

      const lines = filtered.map((w) => formatWorkerSummary(w));
      const header = `Connected Workers: ${filtered.length}/${workers.length}` +
        (filter !== 'all' ? ` (filter: ${filter})` : '');

      return {
        success: true,
        output: `${header}\n${'─'.repeat(60)}\n${lines.join('\n\n')}`,
        data: { workers: filtered, total: workers.length, filtered: filtered.length },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// getWorkerStatus
// ---------------------------------------------------------------------------

function createGetWorkerStatusTool(dispatcher: WorkerToolDispatcher): Tool {
  return {
    name: 'getWorkerStatus',
    description:
      'Get detailed status information for a specific worker node. ' +
      'Provide the workerId (UUID) or hostname to identify the worker. ' +
      'Returns capabilities, load, memory, active tasks, Docker status, and connection details.',
    inputSchema: {
      type: 'object',
      properties: {
        workerId: {
          type: 'string',
          description: 'The worker UUID to look up.',
        },
        hostname: {
          type: 'string',
          description: 'The worker hostname to look up (used if workerId is not provided).',
        },
      },
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const { workerId, hostname } = input as { workerId?: string; hostname?: string };

      if (!workerId && !hostname) {
        return {
          success: false,
          output: 'Provide either "workerId" (UUID) or "hostname" to identify the worker. Use listWorkers to see available workers.',
        };
      }

      // Try direct lookup by ID first
      if (workerId) {
        const worker = dispatcher.getWorkerDetails(workerId);
        if (!worker) {
          return {
            success: false,
            output: `Worker "${workerId}" is not connected. Use listWorkers to see available workers.`,
          };
        }
        return {
          success: true,
          output: formatWorkerDetailed(worker),
          data: { worker },
        };
      }

      // Fallback: search by hostname
      const all = dispatcher.getConnectedWorkers();
      const match = all.find(
        (w) => w.hostname.toLowerCase() === hostname!.toLowerCase(),
      );
      if (!match) {
        return {
          success: false,
          output: `No connected worker with hostname "${hostname}". Use listWorkers to see available workers.`,
        };
      }
      return {
        success: true,
        output: formatWorkerDetailed(match),
        data: { worker: match },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// disconnectWorker
// ---------------------------------------------------------------------------

function createDisconnectWorkerTool(dispatcher: WorkerToolDispatcher): Tool {
  return {
    name: 'disconnectWorker',
    description:
      'Disconnect a worker node by its ID, closing its WebSocket connection. ' +
      'The worker will attempt to reconnect automatically. ' +
      'Use this to remove misbehaving or stuck workers.',
    inputSchema: {
      type: 'object',
      properties: {
        workerId: {
          type: 'string',
          description: 'The worker UUID to disconnect.',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for disconnecting (logged for auditing).',
        },
      },
      required: ['workerId'],
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const { workerId, reason } = input as { workerId: string; reason?: string };

      if (!workerId) {
        return {
          success: false,
          output: 'workerId is required. Use listWorkers to find available worker IDs.',
        };
      }

      const disconnected = dispatcher.disconnectWorkerNode(workerId);
      if (!disconnected) {
        return {
          success: false,
          output: `Worker "${workerId}" is not connected or was already disconnected.`,
        };
      }

      const msg = reason
        ? `Worker "${workerId}" has been disconnected. Reason: ${reason}`
        : `Worker "${workerId}" has been disconnected. It will attempt to reconnect automatically.`;

      return { success: true, output: msg };
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatWorkerSummary(w: WorkerInfo): string {
  const caps = w.capabilities;
  const os = caps?.os ?? 'unknown';
  const env = caps?.environment ?? 'unknown';
  const tags = caps?.customTags?.length ? ` [${caps.customTags.join(', ')}]` : '';
  const docker = w.dockerAvailable ? '✓' : '✗';
  const browser = caps?.browserCapable ? '✓' : '✗';
  const uptime = getUptime(w.connectedAt);
  const heartbeatAgo = getTimeAgo(w.lastHeartbeat);

  return [
    `  Worker: ${w.hostname} (${w.workerId})`,
    `  OS: ${os} | Env: ${env}${tags}`,
    `  Load: ${w.load.toFixed(2)} | Active Tasks: ${w.activeTasks}`,
    `  Docker: ${docker} | Browser: ${browser}`,
    `  Uptime: ${uptime} | Last Heartbeat: ${heartbeatAgo}`,
  ].join('\n');
}

function formatWorkerDetailed(w: WorkerInfo): string {
  const caps = w.capabilities;
  const os = caps?.os ?? 'unknown';
  const env = caps?.environment ?? 'unknown';
  const tags = caps?.customTags?.length ? caps.customTags.join(', ') : 'none';
  const uptime = getUptime(w.connectedAt);
  const heartbeatAgo = getTimeAgo(w.lastHeartbeat);

  return [
    `Worker Node Details`,
    `${'═'.repeat(50)}`,
    `  ID:             ${w.workerId}`,
    `  Hostname:       ${w.hostname}`,
    `  OS:             ${os}`,
    `  Environment:    ${env}`,
    `  Custom Tags:    ${tags}`,
    ``,
    `  Capabilities:`,
    `    Browser:      ${caps?.browserCapable ? 'Yes' : 'No'}`,
    `    Display:      ${caps?.hasDisplay ? 'Yes' : 'No'}`,
    `    Docker:       ${w.dockerAvailable ? 'Yes' : 'No'}`,
    `    SSH Keys:     ${w.keysReceived ? 'Received' : 'Not received'}`,
    ``,
    `  Load & Tasks:`,
    `    CPU Load:     ${w.load.toFixed(2)}`,
    `    Active Tasks: ${w.activeTasks}`,
    ``,
    `  Connection:`,
    `    Connected At: ${w.connectedAt}`,
    `    Uptime:       ${uptime}`,
    `    Last Beat:    ${heartbeatAgo}`,
    ``,
    `  Usage Hint:`,
    `    To run a command on this worker, pass workerId: "${w.workerId}"`,
    `    to any worker tool (execShell, readFile, writeFile, listFiles).`,
  ].join('\n');
}

function getUptime(connectedAtIso: string): string {
  const ms = Date.now() - new Date(connectedAtIso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function getTimeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}
