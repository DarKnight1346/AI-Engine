import type Redis from 'ioredis';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

const { leaderLockKey, leaderLockTtlMs } = DEFAULT_CONFIG.cluster;

export class LeaderElection {
  private interval: ReturnType<typeof setInterval> | null = null;
  private _isLeader = false;

  constructor(
    private redis: Redis,
    private nodeId: string
  ) {}

  start(): void {
    this.tryAcquire();
    this.interval = setInterval(() => this.tryAcquire(), Math.floor(leaderLockTtlMs / 3));
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this._isLeader) {
      this.release().catch(() => {});
    }
  }

  isCurrentLeader(): boolean {
    return this._isLeader;
  }

  private async tryAcquire(): Promise<void> {
    try {
      if (this._isLeader) {
        // Refresh the lock
        const result = await this.redis.set(
          leaderLockKey,
          this.nodeId,
          'PX',
          leaderLockTtlMs,
          'XX'
        );
        if (result !== 'OK') {
          this._isLeader = false;
          console.log('[cluster] Lost leader status');
        }
      } else {
        // Try to acquire
        const result = await this.redis.set(
          leaderLockKey,
          this.nodeId,
          'PX',
          leaderLockTtlMs,
          'NX'
        );
        if (result === 'OK') {
          this._isLeader = true;
          console.log('[cluster] Became leader');
        }
      }
    } catch (err) {
      console.error('[cluster] Leader election error:', err);
    }
  }

  private async release(): Promise<void> {
    const current = await this.redis.get(leaderLockKey);
    if (current === this.nodeId) {
      await this.redis.del(leaderLockKey);
      this._isLeader = false;
    }
  }
}
