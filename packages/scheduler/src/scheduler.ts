import { getDb } from '@ai-engine/db';
import { CronParser } from './cron-parser.js';
import { Watchdog } from './watchdog.js';
import { DEFAULT_CONFIG } from '@ai-engine/shared';
import type Redis from 'ioredis';

export class Scheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private watchdog: Watchdog;
  private running = false;

  constructor(
    private nodeId: string,
    private redis: Redis
  ) {
    this.watchdog = new Watchdog(redis, nodeId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Recover missed runs on startup
    this.recoverMissedRuns().catch((err) => console.error('[scheduler] Recovery failed:', err));

    // Start the tick loop - 1 second interval for reliability
    this.interval = setInterval(() => this.tick(), DEFAULT_CONFIG.scheduler.tickIntervalMs);
    this.watchdog.start();
    console.log('[scheduler] Started with 1s tick loop');
  }

  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.watchdog.stop();
    console.log('[scheduler] Stopped');
  }

  private async tick(): Promise<void> {
    try {
      const db = getDb();
      const now = new Date();

      // Write heartbeat
      await db.schedulerHeartbeat.create({
        data: { nodeId: this.nodeId, tickedAt: now },
      });

      // Find tasks ready to fire
      const dueTasks = await db.scheduledTask.findMany({
        where: { isActive: true, nextRunAt: { lte: now } },
      });

      for (const task of dueTasks) {
        await this.fireTask(task, now);
      }

      this.watchdog.recordTick();
    } catch (err) {
      console.error('[scheduler] Tick error:', err);
    }
  }

  private async fireTask(task: any, scheduledAt: Date): Promise<void> {
    const db = getDb();

    // Exactly-once: INSERT ON CONFLICT DO NOTHING
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO scheduled_task_runs (id, task_id, scheduled_at, triggered_by, executed_by_node, status, started_at)
         VALUES (gen_random_uuid(), $1, $2, 'tick', $3, 'running', NOW())
         ON CONFLICT (task_id, scheduled_at) DO NOTHING`,
        task.id,
        scheduledAt,
        this.nodeId
      );
    } catch {
      // Conflict means another node already claimed it
      return;
    }

    // Update next_run_at
    const nextRun = CronParser.getNextRun(task.cronExpr, scheduledAt);
    if (nextRun) {
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { nextRunAt: nextRun },
      });
    } else if (task.scheduleType === 'once') {
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { isActive: false },
      });
    }

    // Publish task fired event for workers to pick up
    await this.redis.publish('scheduler:task-fired', JSON.stringify({
      taskId: task.id,
      agentId: task.agentId,
      workflowId: task.workflowId,
      goalContextId: task.goalContextId,
      configJson: task.configJson,
      scheduledAt: scheduledAt.toISOString(),
    }));

    console.log(`[scheduler] Fired task: ${task.name} (${task.id})`);
  }

  private async recoverMissedRuns(): Promise<void> {
    const db = getDb();
    const now = new Date();

    const missedTasks = await db.scheduledTask.findMany({
      where: {
        isActive: true,
        nextRunAt: { lt: now },
      },
    });

    for (const task of missedTasks) {
      console.log(`[scheduler] Recovering missed run: ${task.name}`);
      try {
        await db.$executeRawUnsafe(
          `INSERT INTO scheduled_task_runs (id, task_id, scheduled_at, triggered_by, executed_by_node, status, started_at)
           VALUES (gen_random_uuid(), $1, $2, 'recovery', $3, 'running', NOW())
           ON CONFLICT (task_id, scheduled_at) DO NOTHING`,
          task.id,
          task.nextRunAt,
          this.nodeId
        );

        const nextRun = CronParser.getNextRun(task.cronExpr, now);
        if (nextRun) {
          await db.scheduledTask.update({
            where: { id: task.id },
            data: { nextRunAt: nextRun },
          });
        }

        await this.redis.publish('scheduler:task-fired', JSON.stringify({
          taskId: task.id,
          agentId: task.agentId,
          workflowId: task.workflowId,
          goalContextId: task.goalContextId,
          configJson: task.configJson,
          scheduledAt: task.nextRunAt.toISOString(),
          recovered: true,
        }));
      } catch (err) {
        console.error(`[scheduler] Failed to recover task ${task.name}:`, err);
      }
    }
  }
}
