import type { MemoryService } from './memory-service.js';
import type { GoalTracker } from './goal-tracker.js';
import type { UserGoal, MemoryEntry } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

export interface AgentContext {
  systemPrompt: string;
  goals: UserGoal[];
  memories: MemoryEntry[];
  taskDetails: string | null;
  estimatedTokens: number;
}

export class ContextBuilder {
  constructor(
    private memoryService: MemoryService,
    private goalTracker: GoalTracker
  ) {}

  async buildContext(options: {
    agentRolePrompt: string;
    userId?: string;
    teamId?: string;
    taskDetails?: string;
    query?: string;
  }): Promise<AgentContext> {
    const { agentRolePrompt, userId, teamId, taskDetails, query } = options;

    // Always include active goals (never summarized away)
    const goals: UserGoal[] = [];
    if (userId) {
      const personalGoals = await this.goalTracker.getActiveGoals('personal', userId);
      goals.push(...personalGoals);
    }
    if (teamId) {
      const teamGoals = await this.goalTracker.getActiveGoals('team', teamId);
      goals.push(...teamGoals);
    }

    // Retrieve relevant memories
    const memories: MemoryEntry[] = [];
    if (query) {
      if (userId) {
        const personalMem = await this.memoryService.search(query, 'personal', userId, 5);
        memories.push(...personalMem);
      }
      if (teamId) {
        const teamMem = await this.memoryService.search(query, 'team', teamId, 5);
        memories.push(...teamMem);
      }
      const globalMem = await this.memoryService.search(query, 'global', null, 3);
      memories.push(...globalMem);
    }

    // Build system prompt
    const goalSection = goals.length > 0
      ? `\n\n## Active Goals\n${goals.map((g) => `- [${g.priority.toUpperCase()}] ${g.description}`).join('\n')}`
      : '';

    const memorySection = memories.length > 0
      ? `\n\n## Relevant Context\n${memories.map((m) => `- ${m.content}`).join('\n')}`
      : '';

    const systemPrompt = `${agentRolePrompt}${goalSection}${memorySection}`;

    // Rough token estimation (1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(
      (systemPrompt.length + (taskDetails?.length ?? 0)) / 4
    );

    return {
      systemPrompt,
      goals,
      memories,
      taskDetails: taskDetails ?? null,
      estimatedTokens,
    };
  }
}
