import { getDb } from '@ai-engine/db';
import type { TaskDependency, DependencyType } from '@ai-engine/shared';

export class DependencyResolver {
  async addDependency(taskId: string, dependsOnTaskId: string, type: DependencyType = 'blocks'): Promise<TaskDependency> {
    const db = getDb();
    const dep = await db.taskDependency.create({
      data: { taskId, dependsOnTaskId, dependencyType: type },
    });
    return { id: dep.id, taskId: dep.taskId, dependsOnTaskId: dep.dependsOnTaskId, dependencyType: dep.dependencyType as DependencyType };
  }

  async getBlockingDependencies(taskId: string): Promise<TaskDependency[]> {
    const db = getDb();
    const deps = await db.taskDependency.findMany({
      where: { taskId, dependencyType: 'blocks' },
    });
    return deps.map((d: any) => ({
      id: d.id,
      taskId: d.taskId,
      dependsOnTaskId: d.dependsOnTaskId,
      dependencyType: d.dependencyType as DependencyType,
    }));
  }

  async areBlockingDependenciesMet(taskId: string): Promise<boolean> {
    const db = getDb();
    const deps = await db.taskDependency.findMany({
      where: { taskId, dependencyType: 'blocks' },
      include: { dependsOn: true },
    });
    return deps.every((d: any) => d.dependsOn.status === 'completed');
  }

  async getReadyTasks(workflowId: string): Promise<string[]> {
    const db = getDb();
    const waitingItems = await db.workItem.findMany({
      where: { workflowId, status: 'waiting' },
    });

    const readyIds: string[] = [];
    for (const item of waitingItems) {
      const met = await this.areBlockingDependenciesMet(item.id);
      if (met) readyIds.push(item.id);
    }
    return readyIds;
  }

  async getDependencyGraph(workflowId: string): Promise<{ nodes: string[]; edges: Array<{ from: string; to: string; type: DependencyType }> }> {
    const db = getDb();
    const items = await db.workItem.findMany({ where: { workflowId } });
    const deps = await db.taskDependency.findMany({
      where: { taskId: { in: items.map((i: any) => i.id) } },
    });

    return {
      nodes: items.map((i: any) => i.id),
      edges: deps.map((d: any) => ({
        from: d.dependsOnTaskId,
        to: d.taskId,
        type: d.dependencyType as DependencyType,
      })),
    };
  }
}
