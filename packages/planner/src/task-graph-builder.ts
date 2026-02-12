import type { LLMPool } from '@ai-engine/llm';
import type { WorkflowService } from '@ai-engine/workflow-engine';
import { DependencyResolver } from '@ai-engine/workflow-engine';
import type { TaskGraphNode } from '@ai-engine/shared';

export class TaskGraphBuilder {
  private dependencyResolver: DependencyResolver;

  constructor(
    private llm: LLMPool,
    private workflowService: WorkflowService
  ) {
    this.dependencyResolver = new DependencyResolver();
  }

  async generateFromDescription(description: string, availableWorkflows: Array<{ id: string; name: string; stages: any[] }>): Promise<TaskGraphNode[]> {
    const workflowList = availableWorkflows.map((w) => `- ${w.name} (${w.id}): stages [${w.stages.map((s: any) => s.name).join(', ')}]`).join('\n');

    const response = await this.llm.call([{
      role: 'user',
      content: `Break this project description into discrete tasks with dependencies.

Available workflows:
${workflowList}

Project description:
${description}

Respond with a JSON array of tasks:
[{
  "id": "task-1",
  "title": "Short task title",
  "description": "What needs to be done",
  "workflowId": "workflow UUID or null",
  "stage": "stage name or null",
  "nodeAffinity": "node ID or null",
  "dependencies": ["task-id-1", "task-id-2"]
}]

Only output the JSON array, nothing else.`,
    }], { tier: 'standard', maxTokens: 4096 });

    try {
      return JSON.parse(response.content) as TaskGraphNode[];
    } catch {
      return [{
        id: 'task-1',
        title: description.slice(0, 100),
        description,
        workflowId: null,
        stage: null,
        nodeAffinity: null,
        dependencies: [],
      }];
    }
  }

  async materializeGraph(nodes: TaskGraphNode[]): Promise<string[]> {
    const createdIds: string[] = [];

    for (const node of nodes) {
      if (!node.workflowId) continue;

      const workItem = await this.workflowService.createWorkItem(
        node.workflowId,
        { title: node.title, description: node.description, plannerNodeId: node.id },
        null,
        node.nodeAffinity
      );

      createdIds.push(workItem.id);

      // Create dependencies
      for (const depNodeId of node.dependencies) {
        const depNode = nodes.find((n) => n.id === depNodeId);
        if (!depNode) continue;
        const depWorkItemIdx = nodes.indexOf(depNode);
        if (depWorkItemIdx >= 0 && createdIds[depWorkItemIdx]) {
          await this.dependencyResolver.addDependency(workItem.id, createdIds[depWorkItemIdx], 'blocks');
        }
      }
    }

    return createdIds;
  }
}
