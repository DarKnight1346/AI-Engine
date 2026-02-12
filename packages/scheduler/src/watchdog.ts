import type Redis from 'ioredis';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

const { watchdogThresholdMs, watchdogMaxMissedTicks } = DEFAULT_CONFIG.scheduler;

export class Watchdog {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: Date | null = null;
  private missedTicks = 0;

  constructor(
    private redis: Redis,
    private nodeId: string
  ) {}

  start(): void {
    this.interval = setInterval(() => this.check(), watchdogThresholdMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  recordTick(): void {
    this.lastTickAt = new Date();
    this.missedTicks = 0;
  }

  private async check(): Promise<void> {
    if (!this.lastTickAt) return;

    const elapsed = Date.now() - this.lastTickAt.getTime();
    if (elapsed > watchdogThresholdMs) {
      this.missedTicks++;
      console.warn(`[watchdog] Scheduler tick missed (${this.missedTicks}/${watchdogMaxMissedTicks})`);

      if (this.missedTicks >= watchdogMaxMissedTicks) {
        console.error('[watchdog] Scheduler stalled! Publishing stall event.');
        await this.redis.publish('scheduler:stalled', JSON.stringify({
          nodeId: this.nodeId,
          lastTickAt: this.lastTickAt.toISOString(),
          timestamp: new Date().toISOString(),
        }));
        this.missedTicks = 0;
      }
    }
  }
}
