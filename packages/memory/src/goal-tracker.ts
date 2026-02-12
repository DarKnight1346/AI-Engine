import { getDb } from '@ai-engine/db';
import type { UserGoal, GoalUpdate, GoalScope, GoalPriority, GoalStatus } from '@ai-engine/shared';

export class GoalTracker {
  async createGoal(scope: GoalScope, scopeOwnerId: string, description: string, priority: GoalPriority = 'medium', sourceSessionId?: string): Promise<UserGoal> {
    const db = getDb();
    const goal = await db.userGoal.create({
      data: { scope, scopeOwnerId, description, priority, sourceSessionId },
    });
    return this.mapGoal(goal);
  }

  async updateGoal(goalId: string, newDescription: string, sourceSessionId?: string): Promise<UserGoal> {
    const db = getDb();
    const existing = await db.userGoal.findUniqueOrThrow({ where: { id: goalId } });
    await db.goalUpdate.create({
      data: {
        goalId,
        previousDescription: existing.description,
        newDescription,
        sourceSessionId,
      },
    });
    const updated = await db.userGoal.update({
      where: { id: goalId },
      data: { description: newDescription },
    });
    return this.mapGoal(updated);
  }

  async setStatus(goalId: string, status: GoalStatus): Promise<UserGoal> {
    const db = getDb();
    const goal = await db.userGoal.update({ where: { id: goalId }, data: { status } });
    return this.mapGoal(goal);
  }

  async setPriority(goalId: string, priority: GoalPriority): Promise<UserGoal> {
    const db = getDb();
    const goal = await db.userGoal.update({ where: { id: goalId }, data: { priority } });
    return this.mapGoal(goal);
  }

  async getActiveGoals(scope: GoalScope, scopeOwnerId: string): Promise<UserGoal[]> {
    const db = getDb();
    const goals = await db.userGoal.findMany({
      where: { scope, scopeOwnerId, status: 'active' },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });
    return goals.map(this.mapGoal);
  }

  async getAllGoals(scope: GoalScope, scopeOwnerId: string): Promise<UserGoal[]> {
    const db = getDb();
    const goals = await db.userGoal.findMany({
      where: { scope, scopeOwnerId },
      orderBy: { updatedAt: 'desc' },
    });
    return goals.map(this.mapGoal);
  }

  async getGoalHistory(goalId: string): Promise<GoalUpdate[]> {
    const db = getDb();
    const updates = await db.goalUpdate.findMany({
      where: { goalId },
      orderBy: { updatedAt: 'desc' },
    });
    return updates.map((u) => ({
      id: u.id,
      goalId: u.goalId,
      previousDescription: u.previousDescription,
      newDescription: u.newDescription,
      sourceSessionId: u.sourceSessionId,
      updatedAt: u.updatedAt,
    }));
  }

  private mapGoal(g: any): UserGoal {
    return {
      id: g.id,
      scope: g.scope as GoalScope,
      scopeOwnerId: g.scopeOwnerId,
      description: g.description,
      priority: g.priority as GoalPriority,
      status: g.status as GoalStatus,
      sourceSessionId: g.sourceSessionId,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}
