import { getDb } from '@ai-engine/db';
import type { Workflow, WorkItem, WorkflowStage, WorkItemStatus } from '@ai-engine/shared';

export class WorkflowService {
  async createWorkflow(name: string, stages: WorkflowStage[], teamId?: string): Promise<Workflow> {
    const db = getDb();
    const wf = await db.workflow.create({
      data: { name, teamId, stages: JSON.parse(JSON.stringify(stages)) },
    });
    return this.mapWorkflow(wf);
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    const db = getDb();
    const wf = await db.workflow.findUnique({ where: { id } });
    return wf ? this.mapWorkflow(wf) : null;
  }

  async listWorkflows(teamId?: string): Promise<Workflow[]> {
    const db = getDb();
    const wfs = await db.workflow.findMany({
      where: teamId ? { teamId } : {},
      orderBy: { createdAt: 'desc' },
    });
    return wfs.map(this.mapWorkflow);
  }

  async createWorkItem(workflowId: string, data: Record<string, unknown>, capabilities?: Record<string, unknown> | null, nodeAffinity?: string | null): Promise<WorkItem> {
    const db = getDb();
    const wf = await db.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    const stages = wf.stages as unknown as WorkflowStage[];
    const firstStage = stages[0]?.name ?? 'unknown';

    const item = await db.workItem.create({
      data: {
        workflowId,
        currentStage: firstStage,
        dataJson: data as any,
        status: 'waiting',
        requiredCapabilities: capabilities ? JSON.parse(JSON.stringify(capabilities)) : undefined,
        nodeAffinity,
      },
    });
    return this.mapWorkItem(item);
  }

  async getWorkItem(id: string): Promise<WorkItem | null> {
    const db = getDb();
    const item = await db.workItem.findUnique({ where: { id } });
    return item ? this.mapWorkItem(item) : null;
  }

  async getWorkItems(workflowId: string, status?: WorkItemStatus): Promise<WorkItem[]> {
    const db = getDb();
    const items = await db.workItem.findMany({
      where: { workflowId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return items.map(this.mapWorkItem);
  }

  async updateWorkItemStatus(id: string, status: WorkItemStatus, assignedNode?: string): Promise<WorkItem> {
    const db = getDb();
    const item = await db.workItem.update({
      where: { id },
      data: { status, ...(assignedNode ? { assignedNode } : {}) },
    });
    return this.mapWorkItem(item);
  }

  private mapWorkflow(wf: any): Workflow {
    return {
      id: wf.id,
      name: wf.name,
      teamId: wf.teamId,
      stages: wf.stages as WorkflowStage[],
      createdAt: wf.createdAt,
    };
  }

  private mapWorkItem(item: any): WorkItem {
    return {
      id: item.id,
      workflowId: item.workflowId,
      currentStage: item.currentStage,
      dataJson: item.dataJson as Record<string, unknown>,
      status: item.status as WorkItemStatus,
      requiredCapabilities: item.requiredCapabilities as any,
      nodeAffinity: item.nodeAffinity,
      assignedNode: item.assignedNode,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
