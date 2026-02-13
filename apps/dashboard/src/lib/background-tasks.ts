/**
 * BackgroundTaskRegistry — in-memory singleton for tracking long-running
 * tasks (video generation, heavy research, etc.) that execute after the
 * main chat stream closes.
 *
 * Lifecycle:
 *   1. ChatExecutor detects a long-running tool → calls backgroundTaskCallback
 *   2. ChatQueue registers the task here and starts execution in background
 *   3. Frontend polls GET /api/chat/tasks?sessionId=... to track progress
 *   4. On completion, result is stored here AND as a new ChatMessage in DB
 *   5. Frontend picks up the completed task, injects the message, acknowledges
 */

export interface BackgroundTask {
  id: string;
  sessionId: string;
  toolName: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  result?: { success: boolean; output: string; data?: Record<string, unknown> };
  /** The ChatMessage ID created when the task completes (for dedup) */
  messageId?: string;
  agentName?: string;
  startedAt: Date;
  completedAt?: Date;
}

const REGISTRY_KEY = Symbol.for('ai-engine.background-tasks');

export class BackgroundTaskRegistry {
  private tasks = new Map<string, BackgroundTask>();

  static getInstance(): BackgroundTaskRegistry {
    const g = globalThis as Record<symbol, BackgroundTaskRegistry | undefined>;
    if (!g[REGISTRY_KEY]) {
      g[REGISTRY_KEY] = new BackgroundTaskRegistry();
    }
    return g[REGISTRY_KEY]!;
  }

  /** Register a new running background task */
  create(task: {
    id: string;
    sessionId: string;
    toolName: string;
    description: string;
    agentName?: string;
  }): BackgroundTask {
    const entry: BackgroundTask = {
      ...task,
      status: 'running',
      startedAt: new Date(),
    };
    this.tasks.set(task.id, entry);
    console.log(`[BackgroundTask] Created: ${task.id} (${task.toolName}) for session ${task.sessionId}`);
    return entry;
  }

  /** Mark a task as completed with its result */
  complete(
    taskId: string,
    result: { success: boolean; output: string; data?: Record<string, unknown> },
    messageId?: string,
  ): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    task.status = result.success ? 'completed' : 'failed';
    task.result = result;
    task.messageId = messageId;
    task.completedAt = new Date();
    const elapsed = ((task.completedAt.getTime() - task.startedAt.getTime()) / 1000).toFixed(1);
    console.log(`[BackgroundTask] ${result.success ? 'Completed' : 'Failed'}: ${taskId} (${task.toolName}) in ${elapsed}s`);
    return task;
  }

  /** Get all tasks for a session */
  getBySession(sessionId: string): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.sessionId === sessionId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  /** Get only running tasks for a session */
  getRunningBySession(sessionId: string): BackgroundTask[] {
    return this.getBySession(sessionId).filter((t) => t.status === 'running');
  }

  /** Remove a task after the frontend has acknowledged it */
  acknowledge(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  /** Clean up old completed tasks (> 1 hour) to prevent memory leaks */
  cleanup(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, task] of this.tasks) {
      if (task.completedAt && task.completedAt.getTime() < cutoff) {
        this.tasks.delete(id);
      }
    }
  }
}
