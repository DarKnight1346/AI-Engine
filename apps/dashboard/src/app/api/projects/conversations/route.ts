import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/**
 * Save conversation message
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.projectId || !body.role || !body.content) {
      return NextResponse.json({ error: 'projectId, role, and content are required' }, { status: 400 });
    }

    const conversation = await db.projectConversation.create({
      data: {
        projectId: body.projectId,
        role: body.role,
        content: body.content,
        metadata: body.metadata ?? null,
      },
    });

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        projectId: conversation.projectId,
        role: conversation.role,
        content: conversation.content,
        metadata: conversation.metadata,
        createdAt: conversation.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Get conversation history for a project
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const projectId = request.nextUrl.searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const conversations = await db.projectConversation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        projectId: c.projectId,
        role: c.role,
        content: c.content,
        metadata: c.metadata,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ conversations: [], error: err.message }, { status: 500 });
  }
}
