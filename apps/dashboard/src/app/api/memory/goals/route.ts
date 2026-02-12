import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const goals = await db.userGoal.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] });
    return NextResponse.json({
      goals: goals.map((g) => ({
        id: g.id,
        description: g.description,
        priority: g.priority,
        status: g.status,
        scope: g.scope,
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ goals: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    if (!body.description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

    const user = await db.user.findFirst({ where: { role: 'admin' } });
    const goal = await db.userGoal.create({
      data: {
        description: body.description.trim(),
        priority: body.priority ?? 'medium',
        status: body.status ?? 'active',
        scope: body.scope ?? 'personal',
        scopeOwnerId: user?.id ?? '',
      },
    });
    return NextResponse.json({ goal }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const updateData: Record<string, unknown> = {};
    if (body.description !== undefined) updateData.description = body.description;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.status !== undefined) updateData.status = body.status;

    await db.userGoal.update({ where: { id: body.id }, data: updateData });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await db.userGoal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
