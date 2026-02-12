import { getDb } from '@ai-engine/db';
import { CronParser } from './cron-parser.js';
import type { ScheduledTask, ScheduledTaskRun, ScheduleType } from '@ai-engine/shared';

export class ScheduleService {
  async createTask(
    name: string,
    cronExpr: string,
    scheduleType: ScheduleType,
    options: { agentId?: string; workflowId?: string; goalContextId?: string; configJson?: Record<string, unknown>; sessionId?: string } = {}
  ): Promise<ScheduledTask> {
    const nextRunAt = CronParser.getNextRun(cronExpr) ?? new Date();
    const db = getDb();
    const task = await db.scheduledTask.create({
      data: {
        name,
        cronExpr,
        scheduleType,
        agentId: options.agentId,
        workflowId: options.workflowId,
        goalContextId: options.goalContextId,
        configJson: options.configJson ?? {},
        nextRunAt,
        createdFromSessionId: options.sessionId,
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
      id: t.id, name: t.name, cronExpr: t.cronExpr, scheduleType: t.scheduleType as ScheduleType,
      agentId: t.agentId, workflowId: t.workflowId, goalContextId: t.goalContextId,
      configJson: t.configJson as Record<string, unknown>, nextRunAt: t.nextRunAt,
      isActive: t.isActive, createdFromSessionId: t.createdFromSessionId, createdAt: t.createdAt,
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
