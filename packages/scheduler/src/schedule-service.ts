import { getDb } from '@ai-engine/db';
import { CronParser } from './cron-parser.js';
import type { ScheduledTask, ScheduledTaskRun, ScheduleType } from '@ai-engine/shared';

export interface CreateTaskOptions {
  agentId?: string;
  workflowId?: string;
  goalContextId?: string;
  configJson?: Record<string, unknown>;
  sessionId?: string;
  userPrompt?: string;
  intervalMs?: number;
  runAt?: string | Date;
  endAt?: string | Date;
  maxRuns?: number;
}

export class ScheduleService {
  async createTask(
    name: string,
    cronExpr: string,
    scheduleType: ScheduleType,
    options: CreateTaskOptions = {}
  ): Promise<ScheduledTask> {
    const db = getDb();

    // Compute nextRunAt based on schedule type
    let nextRunAt: Date;
    if (scheduleType === 'once' && options.runAt) {
      nextRunAt = new Date(options.runAt);
    } else if (scheduleType === 'interval' && options.intervalMs) {
      nextRunAt = new Date(Date.now() + options.intervalMs);
    } else {
      nextRunAt = CronParser.getNextRun(cronExpr) ?? new Date();
    }

    const task = await db.scheduledTask.create({
      data: {
        name,
        cronExpr,
        scheduleType,
        agentId: options.agentId,
        workflowId: options.workflowId,
        goalContextId: options.goalContextId,
        configJson: (options.configJson ?? {}) as any,
        nextRunAt,
        createdFromSessionId: options.sessionId,
        userPrompt: options.userPrompt ?? null,
        intervalMs: options.intervalMs ? BigInt(options.intervalMs) : null,
        runAt: options.runAt ? new Date(options.runAt) : null,
        endAt: options.endAt ? new Date(options.endAt) : null,
        maxRuns: options.maxRuns ?? null,
      },
    });
    return this.mapTask(task);
  }

  async getTask(id: string): Promise<ScheduledTask | null> {
    const db = getDb();
    const task = await db.scheduledTask.findUnique({ where: { id } });
    return task ? this.mapTask(task) : null;
  }

  async listTasks(activeOnly = true): Promise<ScheduledTask[]> {
    const db = getDb();
    const tasks = await db.scheduledTask.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { nextRunAt: 'asc' },
    });
    return tasks.map(this.mapTask);
  }

  async toggleTask(id: string, isActive: boolean): Promise<ScheduledTask> {
    const db = getDb();
    const task = await db.scheduledTask.update({ where: { id }, data: { isActive } });
    return this.mapTask(task);
  }

  async updateTask(id: string, updates: Partial<{
    name: string;
    cronExpr: string;
    scheduleType: ScheduleType;
    agentId: string | null;
    userPrompt: string | null;
    intervalMs: number | null;
    endAt: Date | null;
    maxRuns: number | null;
    isActive: boolean;
  }>): Promise<ScheduledTask> {
    const db = getDb();
    const data: Record<string, unknown> = {};

    if (updates.name !== undefined) data.name = updates.name;
    if (updates.cronExpr !== undefined) data.cronExpr = updates.cronExpr;
    if (updates.scheduleType !== undefined) data.scheduleType = updates.scheduleType;
    if (updates.agentId !== undefined) data.agentId = updates.agentId;
    if (updates.userPrompt !== undefined) data.userPrompt = updates.userPrompt;
    if (updates.intervalMs !== undefined) data.intervalMs = updates.intervalMs ? BigInt(updates.intervalMs) : null;
    if (updates.endAt !== undefined) data.endAt = updates.endAt;
    if (updates.maxRuns !== undefined) data.maxRuns = updates.maxRuns;
    if (updates.isActive !== undefined) data.isActive = updates.isActive;

    const task = await db.scheduledTask.update({ where: { id }, data });
    return this.mapTask(task);
  }

  async deleteTask(id: string): Promise<void> {
    const db = getDb();
    await db.scheduledTask.delete({ where: { id } });
  }

  async incrementRunCount(id: string): Promise<void> {
    const db = getDb();
    await db.scheduledTask.update({
      where: { id },
      data: { totalRuns: { increment: 1 } },
    });
  }

  async getConversationHistory(id: string): Promise<unknown[]> {
    const db = getDb();
    const task = await db.scheduledTask.findUnique({
      where: { id },
      select: { conversationHistory: true },
    });
    return (task?.conversationHistory as unknown[] | null) ?? [];
  }

  async saveConversationHistory(id: string, history: unknown[]): Promise<void> {
    const db = getDb();
    await db.scheduledTask.update({
      where: { id },
      data: { conversationHistory: history as any },
    });
  }

  async getRunHistory(taskId: string, limit = 50): Promise<ScheduledTaskRun[]> {
    const db = getDb();
    const runs = await db.scheduledTaskRun.findMany({
      where: { taskId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return runs.map(this.mapRun);
  }

  async completeRun(taskId: string, scheduledAt: Date, status: 'completed' | 'failed', resultSummary?: string): Promise<void> {
    const db = getDb();
    await db.scheduledTaskRun.updateMany({
      where: { taskId, scheduledAt },
      data: { status, finishedAt: new Date(), resultSummary },
    });
  }

  private mapTask(t: any): ScheduledTask {
    return {
      id: t.id,
      name: t.name,
      cronExpr: t.cronExpr,
      scheduleType: t.scheduleType as ScheduleType,
      agentId: t.agentId,
      workflowId: t.workflowId,
      goalContextId: t.goalContextId,
      configJson: t.configJson as Record<string, unknown>,
      nextRunAt: t.nextRunAt,
      isActive: t.isActive,
      createdFromSessionId: t.createdFromSessionId,
      createdAt: t.createdAt,
      userPrompt: t.userPrompt ?? null,
      intervalMs: t.intervalMs ? Number(t.intervalMs) : null,
      runAt: t.runAt ?? null,
      endAt: t.endAt ?? null,
      maxRuns: t.maxRuns ?? null,
      totalRuns: t.totalRuns ?? 0,
      conversationHistory: (t.conversationHistory as unknown[] | null) ?? [],
    };
  }

  private mapRun(r: any): ScheduledTaskRun {
    return {
      id: r.id, taskId: r.taskId, scheduledAt: r.scheduledAt, triggeredBy: r.triggeredBy as any,
      executedByNode: r.executedByNode, status: r.status as any,
      startedAt: r.startedAt, finishedAt: r.finishedAt, resultSummary: r.resultSummary,
    };
  }
}
