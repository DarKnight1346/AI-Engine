import Redis from 'ioredis';
import { NodeRegistry } from './node-registry.js';
import { LeaderElection } from './leader-election.js';
import { ConfigSync } from './config-sync.js';
import type { NodeCapabilities } from '@ai-engine/shared';

export interface ClusterManagerOptions {
  redisUrl: string;
  workerId: string;
  capabilities: NodeCapabilities;
}

export class ClusterManager {
  private redis: Redis;
  private subscriber: Redis;
  private registry: NodeRegistry;
  private leader: LeaderElection;
  private configSync: ConfigSync;
  private running = false;

  constructor(private options: ClusterManagerOptions) {
    this.redis = new Redis(options.redisUrl);
    this.subscriber = new Redis(options.redisUrl);
    this.registry = new NodeRegistry(this.redis, options.workerId, options.capabilities);
    this.leader = new LeaderElection(this.redis, options.workerId);
    this.configSync = new ConfigSync(this.redis, this.subscriber);
  }

  async start(): Promise<void> {
    this.running = true;
    await this.registry.register();
    this.registry.startHeartbeat();
    this.leader.start();
    await this.configSync.subscribe();
    console.log(`[cluster] Node ${this.options.workerId} joined cluster`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.registry.stopHeartbeat();
    this.leader.stop();
    await this.configSync.unsubscribe();
    await this.registry.deregister();
    await this.redis.quit();
    await this.subscriber.quit();
    console.log(`[cluster] Node ${this.options.workerId} left cluster`);
  }

  isLeader(): boolean {
    return this.leader.isCurrentLeader();
  }

  getRedis(): Redis {
    return this.redis;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  onConfigUpdate(handler: (scope: string, version: number) => void): void {
    this.configSync.onUpdate(handler);
  }
}
