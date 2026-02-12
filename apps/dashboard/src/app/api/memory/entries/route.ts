import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const entries = await db.memoryEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        content: e.content,
        importance: e.importance,
        scope: e.scope,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ entries: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    if (!body.content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

    const user = await db.user.findFirst({ where: { role: 'admin' } });
    const entry = await db.memoryEntry.create({
      data: {
        content: body.content.trim(),
        type: body.type ?? 'knowledge',
        importance: body.importance ?? 0.5,
        scope: body.scope ?? 'personal',
        scopeOwnerId: user?.id ?? '',
      },
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await db.memoryEntry.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
