import { getDb } from '@ai-engine/db';
import type { PlanningSession, PlanningTaskGraph, TaskGraphNode, TaskGraphStatus } from '@ai-engine/shared';

export class PlannerService {
  async createSession(chatSessionId: string, title: string): Promise<PlanningSession> {
    const db = getDb();
    const session = await db.planningSession.create({
      data: { chatSessionId, title },
    });
    return { id: session.id, chatSessionId: session.chatSessionId, title: session.title, status: session.status as any, createdAt: session.createdAt };
  }

  async getSession(id: string): Promise<PlanningSession | null> {
    const db = getDb();
    const s = await db.planningSession.findUnique({ where: { id } });
    return s ? { id: s.id, chatSessionId: s.chatSessionId, title: s.title, status: s.status as any, createdAt: s.createdAt } : null;
  }

  async saveTaskGraph(sessionId: string, nodes: TaskGraphNode[]): Promise<PlanningTaskGraph> {
    const db = getDb();
    const graph = await db.planningTaskGraph.create({
      data: { sessionId, graphJson: JSON.parse(JSON.stringify(nodes)) },
    });
    return { id: graph.id, sessionId: graph.sessionId, graphJson: graph.graphJson as TaskGraphNode[], status: graph.status as TaskGraphStatus, createdAt: graph.createdAt };
  }

  async confirmGraph(graphId: string): Promise<void> {
    const db = getDb();
    await db.planningTaskGraph.update({ where: { id: graphId }, data: { status: 'confirmed' } });
  }

  async executeGraph(graphId: string): Promise<void> {
    const db = getDb();
    await db.planningTaskGraph.update({ where: { id: graphId }, data: { status: 'executing' } });
  }

  async getGraphsForSession(sessionId: string): Promise<PlanningTaskGraph[]> {
    const db = getDb();
    const graphs = await db.planningTaskGraph.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } });
    return graphs.map((g) => ({ id: g.id, sessionId: g.sessionId, graphJson: g.graphJson as TaskGraphNode[], status: g.status as TaskGraphStatus, createdAt: g.createdAt }));
  }
}
