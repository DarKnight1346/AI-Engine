import type Redis from 'ioredis';

type ConfigUpdateHandler = (scope: string, version: number) => void;

export class ConfigSync {
  private handlers: ConfigUpdateHandler[] = [];
  private subscribed = false;

  constructor(
    private redis: Redis,
    private subscriber: Redis
  ) {}

  async subscribe(): Promise<void> {
    if (this.subscribed) return;
    await this.subscriber.psubscribe('config:updated:*');
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const scope = channel.replace('config:updated:', '');
      try {
        const data = JSON.parse(message);
        for (const handler of this.handlers) {
          handler(scope, data.version);
        }
      } catch (err) {
        console.error('[config-sync] Failed to parse config update:', err);
      }
    });
    this.subscribed = true;
  }

  async unsubscribe(): Promise<void> {
    if (!this.subscribed) return;
    await this.subscriber.punsubscribe('config:updated:*');
    this.subscribed = false;
  }

  onUpdate(handler: ConfigUpdateHandler): void {
    this.handlers.push(handler);
  }

  async publishUpdate(scope: string, version: number): Promise<void> {
    await this.redis.publish(
      `config:updated:${scope}`,
      JSON.stringify({ version, timestamp: new Date().toISOString() })
    );
  }
}
