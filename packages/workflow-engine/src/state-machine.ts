import { getDb } from '@ai-engine/db';
import type { Workflow, WorkItem, WorkflowStage } from '@ai-engine/shared';

export class StateMachine {
  async advanceWorkItem(workItemId: string, agentId?: string): Promise<WorkItem | null> {
    const db = getDb();
    const item = await db.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    const workflow = await db.workflow.findUniqueOrThrow({ where: { id: item.workflowId } });
    const stages = workflow.stages as unknown as WorkflowStage[];
    const currentIndex = stages.findIndex((s) => s.name === item.currentStage);

    if (currentIndex === -1 || currentIndex >= stages.length - 1) {
      // Already at last stage -> mark completed
      const updated = await db.workItem.update({
        where: { id: workItemId },
        data: { status: 'completed' },
      });
      return this.mapWorkItem(updated);
    }

    const nextStage = stages[currentIndex + 1];
    await db.workItemTransition.create({
      data: {
        workItemId,
        fromStage: item.currentStage,
        toStage: nextStage.name,
        agentId,
      },
    });

    const updated = await db.workItem.update({
      where: { id: workItemId },
      data: { currentStage: nextStage.name, status: 'waiting', assignedNode: null },
    });
    return this.mapWorkItem(updated);
  }

  async getTransitionHistory(workItemId: string) {
    const db = getDb();
    return db.workItemTransition.findMany({
      where: { workItemId },
      orderBy: { timestamp: 'asc' },
    });
  }

  private mapWorkItem(item: any): WorkItem {
    return {
      id: item.id,
      workflowId: item.workflowId,
      currentStage: item.currentStage,
      dataJson: item.dataJson as Record<string, unknown>,
      status: item.status as any,
      requiredCapabilities: item.requiredCapabilities as any,
      nodeAffinity: item.nodeAffinity,
      assignedNode: item.assignedNode,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
