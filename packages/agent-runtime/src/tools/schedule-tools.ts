/**
 * Schedule Tools — agent-accessible tools for creating and managing scheduled tasks.
 *
 * These tools allow the agent to:
 *   - Create one-off, recurring (cron), and interval-based schedules
 *   - List existing schedules
 *   - Update schedule parameters (prompt, timing, active status)
 *   - Delete schedules
 *
 * When a scheduled task fires, it kicks off the agent in a chat loop with the
 * persistent conversation context from previous runs.
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';

export interface ScheduleToolsDeps {
  /** Create a scheduled task in the database. */
  createTask: (params: {
    name: string;
    scheduleType: 'cron' | 'once' | 'interval';
    cronExpr?: string;
    userPrompt: string;
    agentId?: string;
    intervalMs?: number;
    runAt?: string;
    endAt?: string;
    maxRuns?: number;
    sessionId?: string;
  }) => Promise<{ id: string; name: string; nextRunAt: Date; scheduleType: string }>;

  /** List scheduled tasks. */
  listTasks: (activeOnly: boolean) => Promise<Array<{
    id: string;
    name: string;
    scheduleType: string;
    cronExpr: string;
    userPrompt: string | null;
    intervalMs: number | null;
    nextRunAt: Date;
    endAt: Date | null;
    maxRuns: number | null;
    totalRuns: number;
    isActive: boolean;
    agentId: string | null;
  }>>;

  /** Update a scheduled task. */
  updateTask: (id: string, updates: Record<string, unknown>) => Promise<{ id: string; name: string }>;

  /** Delete a scheduled task. */
  deleteTask: (id: string) => Promise<void>;
}

export function createScheduleTools(deps: ScheduleToolsDeps): Tool[] {
  // ── create_schedule ────────────────────────────────────────────────
  const createSchedule: Tool = {
    name: 'create_schedule',
    description:
      'Create a scheduled task that will run the agent automatically. Supports three schedule types:\n' +
      '• "once" — Run once at a specific date/time (provide runAt as ISO 8601)\n' +
      '• "cron" — Recurring on a cron schedule (provide cronExpr, e.g. "0 9 * * *" for daily at 9am)\n' +
      '• "interval" — Recurring at fixed intervals (provide intervalMs, e.g. 3600000 for every hour)\n\n' +
      'For recurring schedules, optionally set endAt (ISO 8601) to stop after a date, ' +
      'or maxRuns to limit the total number of executions.\n\n' +
      'The userPrompt is what the agent will receive as its task each time the schedule fires. ' +
      'The agent retains conversation context across runs, building on previous results.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the schedule (e.g. "Daily SEO report", "Weekly competitor check")',
        },
        scheduleType: {
          type: 'string',
          enum: ['once', 'cron', 'interval'],
          description: 'Type of schedule: "once" for one-off, "cron" for cron-based, "interval" for fixed intervals',
        },
        userPrompt: {
          type: 'string',
          description: 'The prompt/instruction the agent receives each time this schedule fires. Be specific about what the agent should do.',
        },
        cronExpr: {
          type: 'string',
          description: 'Cron expression (required for "cron" type). Examples: "0 9 * * *" (daily 9am), "0 */6 * * *" (every 6h), "0 9 * * 1" (Mondays 9am)',
        },
        intervalMs: {
          type: 'number',
          description: 'Interval in milliseconds (required for "interval" type). Examples: 3600000 (1 hour), 86400000 (24 hours)',
        },
        runAt: {
          type: 'string',
          description: 'ISO 8601 datetime for one-off schedules (required for "once" type). Example: "2026-03-01T14:00:00Z"',
        },
        endAt: {
          type: 'string',
          description: 'Optional ISO 8601 datetime — recurring schedule stops after this date',
        },
        maxRuns: {
          type: 'number',
          description: 'Optional maximum number of runs before the schedule deactivates',
        },
        agentId: {
          type: 'string',
          description: 'Optional agent ID to use for execution. If omitted, uses the default agent.',
        },
      },
      required: ['name', 'scheduleType', 'userPrompt'],
    },

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      try {
        const name = String(input.name ?? '').trim();
        const scheduleType = String(input.scheduleType ?? '') as 'once' | 'cron' | 'interval';
        const userPrompt = String(input.userPrompt ?? '').trim();
        const cronExpr = input.cronExpr ? String(input.cronExpr) : undefined;
        const intervalMs = input.intervalMs ? Number(input.intervalMs) : undefined;
        const runAt = input.runAt ? String(input.runAt) : undefined;
        const endAt = input.endAt ? String(input.endAt) : undefined;
        const maxRuns = input.maxRuns ? Number(input.maxRuns) : undefined;
        const agentId = input.agentId ? String(input.agentId) : undefined;

        // Validation
        if (!name) return { success: false, output: 'Schedule name is required.' };
        if (!userPrompt) return { success: false, output: 'userPrompt is required — this is what the agent will do each run.' };
        if (!['once', 'cron', 'interval'].includes(scheduleType)) {
          return { success: false, output: 'scheduleType must be "once", "cron", or "interval".' };
        }
        if (scheduleType === 'cron' && !cronExpr) {
          return { success: false, output: 'cronExpr is required for "cron" schedule type. Example: "0 9 * * *" (daily at 9am).' };
        }
        if (scheduleType === 'interval' && !intervalMs) {
          return { success: false, output: 'intervalMs is required for "interval" schedule type. Example: 3600000 (every hour).' };
        }
        if (scheduleType === 'once' && !runAt) {
          return { success: false, output: 'runAt (ISO 8601 datetime) is required for "once" schedule type.' };
        }
        if (runAt && isNaN(Date.parse(runAt))) {
          return { success: false, output: `Invalid runAt date: "${runAt}". Must be ISO 8601 format.` };
        }
        if (endAt && isNaN(Date.parse(endAt))) {
          return { success: false, output: `Invalid endAt date: "${endAt}". Must be ISO 8601 format.` };
        }
        if (intervalMs && intervalMs < 60000) {
          return { success: false, output: 'intervalMs must be at least 60000 (1 minute).' };
        }

        const result = await deps.createTask({
          name,
          scheduleType,
          cronExpr: cronExpr ?? (scheduleType === 'interval' ? '* * * * *' : ''),
          userPrompt,
          agentId,
          intervalMs,
          runAt,
          endAt,
          maxRuns,
        });

        let description = `Schedule "${result.name}" created (ID: ${result.id}).`;
        description += `\nType: ${result.scheduleType}`;
        description += `\nNext run: ${result.nextRunAt.toISOString()}`;
        if (endAt) description += `\nEnds: ${endAt}`;
        if (maxRuns) description += `\nMax runs: ${maxRuns}`;
        description += `\n\nThe agent will receive the following prompt each time:\n"${userPrompt}"`;
        description += `\n\nConversation context will persist across runs, so the agent can build on previous results.`;

        return { success: true, output: description };
      } catch (err: any) {
        return { success: false, output: `Failed to create schedule: ${err.message}` };
      }
    },
  };

  // ── list_schedules ─────────────────────────────────────────────────
  const listSchedules: Tool = {
    name: 'list_schedules',
    description: 'List all scheduled tasks with their status, next run time, and configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        activeOnly: {
          type: 'boolean',
          description: 'If true (default), only show active schedules. Set to false to include inactive ones.',
        },
      },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const activeOnly = input.activeOnly !== false;
        const tasks = await deps.listTasks(activeOnly);

        if (tasks.length === 0) {
          return { success: true, output: activeOnly ? 'No active schedules found.' : 'No schedules found.' };
        }

        const lines = tasks.map((t) => {
          let line = `• ${t.name} (${t.id})\n`;
          line += `  Type: ${t.scheduleType} | Active: ${t.isActive}`;
          if (t.cronExpr && t.scheduleType === 'cron') line += ` | Cron: ${t.cronExpr}`;
          if (t.intervalMs) line += ` | Interval: ${(t.intervalMs / 1000 / 60).toFixed(0)}min`;
          line += `\n  Next run: ${t.nextRunAt.toISOString()}`;
          line += ` | Runs completed: ${t.totalRuns}`;
          if (t.maxRuns) line += `/${t.maxRuns}`;
          if (t.endAt) line += ` | Ends: ${t.endAt.toISOString()}`;
          if (t.userPrompt) line += `\n  Prompt: "${t.userPrompt.slice(0, 100)}${t.userPrompt.length > 100 ? '...' : ''}"`;
          return line;
        });

        return { success: true, output: `Found ${tasks.length} schedule(s):\n\n${lines.join('\n\n')}` };
      } catch (err: any) {
        return { success: false, output: `Failed to list schedules: ${err.message}` };
      }
    },
  };

  // ── update_schedule ────────────────────────────────────────────────
  const updateSchedule: Tool = {
    name: 'update_schedule',
    description:
      'Update an existing scheduled task. You can change the prompt, timing, active status, end date, or max runs. ' +
      'Use list_schedules first to find the schedule ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID to update (UUID)' },
        name: { type: 'string', description: 'New name for the schedule' },
        userPrompt: { type: 'string', description: 'New prompt for the agent' },
        cronExpr: { type: 'string', description: 'New cron expression' },
        intervalMs: { type: 'number', description: 'New interval in milliseconds' },
        endAt: { type: 'string', description: 'New end date (ISO 8601), or "none" to remove' },
        maxRuns: { type: 'number', description: 'New max runs, or 0 to remove limit' },
        isActive: { type: 'boolean', description: 'Enable/disable the schedule' },
      },
      required: ['id'],
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const id = String(input.id ?? '').trim();
        if (!id) return { success: false, output: 'Schedule ID is required.' };

        const updates: Record<string, unknown> = {};
        if (input.name !== undefined) updates.name = String(input.name);
        if (input.userPrompt !== undefined) updates.userPrompt = String(input.userPrompt);
        if (input.cronExpr !== undefined) updates.cronExpr = String(input.cronExpr);
        if (input.intervalMs !== undefined) updates.intervalMs = Number(input.intervalMs) || null;
        if (input.endAt !== undefined) {
          updates.endAt = input.endAt === 'none' ? null : new Date(String(input.endAt));
        }
        if (input.maxRuns !== undefined) {
          updates.maxRuns = Number(input.maxRuns) === 0 ? null : Number(input.maxRuns);
        }
        if (input.isActive !== undefined) updates.isActive = Boolean(input.isActive);

        const result = await deps.updateTask(id, updates);
        return { success: true, output: `Schedule "${result.name}" (${result.id}) updated successfully.` };
      } catch (err: any) {
        return { success: false, output: `Failed to update schedule: ${err.message}` };
      }
    },
  };

  // ── delete_schedule ────────────────────────────────────────────────
  const deleteSchedule: Tool = {
    name: 'delete_schedule',
    description: 'Delete a scheduled task permanently. Use list_schedules first to find the schedule ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID to delete (UUID)' },
      },
      required: ['id'],
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      try {
        const id = String(input.id ?? '').trim();
        if (!id) return { success: false, output: 'Schedule ID is required.' };

        await deps.deleteTask(id);
        return { success: true, output: `Schedule ${id} deleted successfully.` };
      } catch (err: any) {
        return { success: false, output: `Failed to delete schedule: ${err.message}` };
      }
    },
  };

  return [createSchedule, listSchedules, updateSchedule, deleteSchedule];
}

/**
 * Get ToolManifestEntry[] for scheduling tools (for ToolIndex discovery).
 */
export function getScheduleToolManifest() {
  return [
    {
      name: 'create_schedule',
      description:
        'Create a scheduled task — one-off, recurring (cron), or interval-based. ' +
        'The agent receives a prompt each time it fires and retains conversation context across runs.',
      category: 'scheduling',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          scheduleType: { type: 'string', enum: ['once', 'cron', 'interval'] },
          userPrompt: { type: 'string' },
          cronExpr: { type: 'string' },
          intervalMs: { type: 'number' },
          runAt: { type: 'string' },
          endAt: { type: 'string' },
          maxRuns: { type: 'number' },
          agentId: { type: 'string' },
        },
        required: ['name', 'scheduleType', 'userPrompt'],
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
    {
      name: 'list_schedules',
      description: 'List all scheduled tasks with their status, next run time, and configuration.',
      category: 'scheduling',
      inputSchema: {
        type: 'object',
        properties: {
          activeOnly: { type: 'boolean' },
        },
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
    {
      name: 'update_schedule',
      description: 'Update an existing scheduled task — change prompt, timing, active status, end date, or max runs.',
      category: 'scheduling',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          userPrompt: { type: 'string' },
          cronExpr: { type: 'string' },
          intervalMs: { type: 'number' },
          endAt: { type: 'string' },
          maxRuns: { type: 'number' },
          isActive: { type: 'boolean' },
        },
        required: ['id'],
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
    {
      name: 'delete_schedule',
      description: 'Delete a scheduled task permanently by its ID.',
      category: 'scheduling',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
  ];
}
