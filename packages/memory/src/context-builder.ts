import type { MemoryService } from './memory-service.js';
import type { GoalTracker } from './goal-tracker.js';
import { withMemoryPrompt } from '@ai-engine/shared';
import type { UserGoal, ScoredMemoryEntry } from '@ai-engine/shared';

export interface AgentContext {
  systemPrompt: string;
  goals: UserGoal[];
  memories: ScoredMemoryEntry[];
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

    // Retrieve relevant memories using hybrid search across all scopes
    let memories: ScoredMemoryEntry[] = [];
    if (query) {
      memories = await this.memoryService.searchAllScopes(
        query,
        userId ?? null,
        teamId ?? null,
        10,
        { strengthenOnRecall: true },
      );
    }

    // Build system prompt
    const goalSection = goals.length > 0
      ? `\n\n## Active Goals\n${goals.map((g) => `- [${g.priority.toUpperCase()}] ${g.description}`).join('\n')}`
      : '';

    // Format memories with strength/relevance indicators for the agent
    const memorySection = memories.length > 0
      ? `\n\n## Relevant Context from Memory\n${memories.map((m) => {
          const confidence = m.finalScore >= 0.7 ? 'high' : m.finalScore >= 0.4 ? 'medium' : 'low';
          return `- [${confidence} relevance] ${m.content}`;
        }).join('\n')}`
      : '';

    const systemPrompt = withMemoryPrompt(`${agentRolePrompt}${goalSection}${memorySection}`);

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
