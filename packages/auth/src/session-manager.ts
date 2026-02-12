import { getDb } from '@ai-engine/db';
import type { ChatSession, ChatMessage } from '@ai-engine/shared';

export class SessionManager {
  async createSession(type: 'personal' | 'team', ownerId: string, createdByUserId: string, title?: string): Promise<ChatSession> {
    const db = getDb();
    const session = await db.chatSession.create({
      data: { type, ownerId, createdByUserId, title },
    });
    return this.mapSession(session);
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const db = getDb();
    const session = await db.chatSession.findUnique({ where: { id: sessionId } });
    return session ? this.mapSession(session) : null;
  }

  async getUserSessions(userId: string): Promise<ChatSession[]> {
    const db = getDb();
    const sessions = await db.chatSession.findMany({
      where: { type: 'personal', ownerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map(this.mapSession);
  }

  async getTeamSessions(teamId: string): Promise<ChatSession[]> {
    const db = getDb();
    const sessions = await db.chatSession.findMany({
      where: { type: 'team', ownerId: teamId },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map(this.mapSession);
  }

  async addMessage(sessionId: string, senderType: 'user' | 'ai', content: string, senderUserId?: string, meta?: { aiResponded?: boolean; classifierConfidence?: number; embedsJson?: Record<string, unknown> }): Promise<ChatMessage> {
    const db = getDb();
    const message = await db.chatMessage.create({
      data: {
        sessionId,
        senderType,
        senderUserId,
        content,
        aiResponded: meta?.aiResponded ?? false,
        classifierConfidence: meta?.classifierConfidence,
        embedsJson: meta?.embedsJson ? JSON.parse(JSON.stringify(meta.embedsJson)) : undefined,
      },
    });
    return this.mapMessage(message);
  }

  async getMessages(sessionId: string, limit = 50, before?: Date): Promise<ChatMessage[]> {
    const db = getDb();
    const messages = await db.chatMessage.findMany({
      where: {
        sessionId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return messages.reverse().map(this.mapMessage);
  }

  private mapSession(s: any): ChatSession {
    return {
      id: s.id,
      type: s.type as ChatSession['type'],
      ownerId: s.ownerId,
      title: s.title,
      createdByUserId: s.createdByUserId,
      createdAt: s.createdAt,
    };
  }

  private mapMessage(m: any): ChatMessage {
    return {
      id: m.id,
      sessionId: m.sessionId,
      senderType: m.senderType as ChatMessage['senderType'],
      senderUserId: m.senderUserId,
      content: m.content,
      embedsJson: m.embedsJson as Record<string, unknown> | null,
      aiResponded: m.aiResponded,
      classifierConfidence: m.classifierConfidence,
      createdAt: m.createdAt,
    };
  }
}
