import type Redis from 'ioredis';

export class SearchCache {
  constructor(private redis?: Redis) {}

  async get(key: string): Promise<unknown | null> {
    if (!this.redis) return null;
    const data = await this.redis.get(`ai-engine:cache:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(`ai-engine:cache:${key}`, JSON.stringify(value), 'PX', ttlMs);
  }

  async delete(key: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(`ai-engine:cache:${key}`);
  }
}
