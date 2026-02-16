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

    // ── Pre-fire checks: end date and max runs ──
    if (task.endAt && new Date(task.endAt) <= scheduledAt) {
      console.log(`[scheduler] Task "${task.name}" has passed its end date — deactivating`);
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { isActive: false },
      });
      return;
    }

    if (task.maxRuns !== null && task.totalRuns >= task.maxRuns) {
      console.log(`[scheduler] Task "${task.name}" has reached max runs (${task.maxRuns}) — deactivating`);
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { isActive: false },
      });
      return;
    }

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

    // Update next_run_at based on schedule type
    await this.computeAndSetNextRun(task, scheduledAt);

    // Publish task fired event for workers to pick up
    await this.redis.publish('scheduler:task-fired', JSON.stringify({
      taskId: task.id,
      agentId: task.agentId,
      workflowId: task.workflowId,
      goalContextId: task.goalContextId,
      configJson: task.configJson,
      userPrompt: task.userPrompt,
      scheduledAt: scheduledAt.toISOString(),
    }));

    console.log(`[scheduler] Fired task: ${task.name} (${task.id})`);
  }

  /**
   * Compute the next run time based on schedule type and update the DB.
   * Deactivates one-off tasks and tasks that have reached their end date.
   */
  private async computeAndSetNextRun(task: any, after: Date): Promise<void> {
    const db = getDb();

    if (task.scheduleType === 'once') {
      // One-off — deactivate after firing
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { isActive: false },
      });
      return;
    }

    let nextRun: Date | null = null;

    if (task.scheduleType === 'interval' && task.intervalMs) {
      // Interval-based: next run = now + intervalMs
      nextRun = new Date(Date.now() + Number(task.intervalMs));
    } else {
      // Cron-based
      nextRun = CronParser.getNextRun(task.cronExpr, after);
    }

    if (nextRun) {
      // Check if next run would exceed the end date
      if (task.endAt && nextRun > new Date(task.endAt)) {
        console.log(`[scheduler] Task "${task.name}" next run exceeds end date — deactivating`);
        await db.scheduledTask.update({
          where: { id: task.id },
          data: { isActive: false },
        });
        return;
      }

      // Check if next run would exceed max runs
      const newTotal = (task.totalRuns ?? 0) + 1;
      if (task.maxRuns !== null && newTotal >= task.maxRuns) {
        console.log(`[scheduler] Task "${task.name}" will reach max runs after this execution — deactivating`);
        await db.scheduledTask.update({
          where: { id: task.id },
          data: { isActive: false, totalRuns: { increment: 1 } },
        });
        return;
      }

      await db.scheduledTask.update({
        where: { id: task.id },
        data: { nextRunAt: nextRun, totalRuns: { increment: 1 } },
      });
    } else {
      // No valid next run — deactivate
      await db.scheduledTask.update({
        where: { id: task.id },
        data: { isActive: false },
      });
    }
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

        // Compute next run after recovery
        await this.computeAndSetNextRun(task, now);

        await this.redis.publish('scheduler:task-fired', JSON.stringify({
          taskId: task.id,
          agentId: task.agentId,
          workflowId: task.workflowId,
          goalContextId: task.goalContextId,
          configJson: task.configJson,
          userPrompt: task.userPrompt,
          scheduledAt: task.nextRunAt.toISOString(),
          recovered: true,
        }));
      } catch (err) {
        console.error(`[scheduler] Failed to recover task ${task.name}:`, err);
      }
    }
  }
}
