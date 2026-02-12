import type Redis from 'ioredis';
import type { WorkItem, NodeCapabilities } from '@ai-engine/shared';

export interface TaskMessage {
  workItemId: string;
  workflowId: string;
  stage: string;
  requiredCapabilities: Partial<NodeCapabilities> | null;
  nodeAffinity: string | null;
  data: Record<string, unknown>;
}

export class TaskRouter {
  constructor(private redis: Redis) {}

  async enqueue(task: TaskMessage): Promise<void> {
    const queueKey = this.getQueueKey(task);
    await this.redis.rpush(queueKey, JSON.stringify(task));
    // Also publish for real-time notification
    await this.redis.publish('task:enqueued', JSON.stringify({ workItemId: task.workItemId, queue: queueKey }));
  }

  async dequeue(capabilities: NodeCapabilities, nodeId: string): Promise<TaskMessage | null> {
    // Try the node-affinity queue first
    const affinityKey = `ai-engine:tasks:node:${nodeId}`;
    const affinityTask = await this.redis.lpop(affinityKey);
    if (affinityTask) return JSON.parse(affinityTask);

    // Then try the general queue
    const generalKey = 'ai-engine:tasks:general';
    const task = await this.redis.lpop(generalKey);
    if (!task) return null;

    const parsed = JSON.parse(task) as TaskMessage;
    // Check if this node can handle it
    if (this.canHandle(capabilities, parsed.requiredCapabilities)) {
      return parsed;
    }

    // Can't handle - put it back
    await this.redis.lpush(generalKey, task);
    return null;
  }

  async getQueueLength(queueKey = 'ai-engine:tasks:general'): Promise<number> {
    return this.redis.llen(queueKey);
  }

  private getQueueKey(task: TaskMessage): string {
    if (task.nodeAffinity) {
      return `ai-engine:tasks:node:${task.nodeAffinity}`;
    }
    return 'ai-engine:tasks:general';
  }

  private canHandle(capabilities: NodeCapabilities, required: Partial<NodeCapabilities> | null): boolean {
    if (!required) return true;
    if (required.browserCapable && !capabilities.browserCapable) return false;
    if (required.hasDisplay && !capabilities.hasDisplay) return false;
    if (required.os && required.os !== capabilities.os) return false;
    return true;
  }
}
