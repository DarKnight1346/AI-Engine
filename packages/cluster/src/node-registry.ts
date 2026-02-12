import type Redis from 'ioredis';
import type { NodeCapabilities } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';
import os from 'os';

const { heartbeatIntervalMs, heartbeatTtlMs } = DEFAULT_CONFIG.cluster;

export class NodeRegistry {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly nodeKey: string;

  constructor(
    private redis: Redis,
    private nodeId: string,
    private capabilities: NodeCapabilities
  ) {
    this.nodeKey = `ai-engine:node:${nodeId}`;
  }

  async register(): Promise<void> {
    const info = {
      id: this.nodeId,
      hostname: os.hostname(),
      ip: this.getLocalIp(),
      os: this.capabilities.os,
      environment: this.capabilities.environment,
      capabilities: JSON.stringify(this.capabilities),
      registeredAt: new Date().toISOString(),
    };

    await this.redis.hset(this.nodeKey, info);
    await this.redis.expire(this.nodeKey, Math.ceil(heartbeatTtlMs / 1000));
    await this.redis.sadd('ai-engine:nodes', this.nodeId);
  }

  startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.redis.hset(this.nodeKey, 'lastHeartbeat', new Date().toISOString());
        await this.redis.expire(this.nodeKey, Math.ceil(heartbeatTtlMs / 1000));
      } catch (err) {
        console.error('[cluster] Heartbeat failed:', err);
      }
    }, heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async deregister(): Promise<void> {
    await this.redis.del(this.nodeKey);
    await this.redis.srem('ai-engine:nodes', this.nodeId);
  }

  async getActiveNodes(): Promise<string[]> {
    return this.redis.smembers('ai-engine:nodes');
  }

  async getNodeInfo(nodeId: string): Promise<Record<string, string> | null> {
    const info = await this.redis.hgetall(`ai-engine:node:${nodeId}`);
    return Object.keys(info).length > 0 ? info : null;
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }
}
