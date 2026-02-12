import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const user = await db.user.findFirst({ where: { role: 'admin' } });
    if (!user) return NextResponse.json({ profile: [] });

    const profile = await db.userProfile.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({
      profile: profile.map((p) => ({
        id: p.id,
        key: p.key,
        value: p.value,
        confidence: p.confidence,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ profile: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    if (!body.key?.trim() || !body.value?.trim()) return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });

    const user = await db.user.findFirst({ where: { role: 'admin' } });
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

    // Upsert - update if key exists, create if not
    const existing = await db.userProfile.findFirst({ where: { userId: user.id, key: body.key.trim() } });
    let item;
    if (existing) {
      item = await db.userProfile.update({
        where: { id: existing.id },
        data: { value: body.value.trim(), confidence: body.confidence ?? 1.0 },
      });
    } else {
      item = await db.userProfile.create({
        data: {
          userId: user.id,
          key: body.key.trim(),
          value: body.value.trim(),
          confidence: body.confidence ?? 1.0,
        },
      });
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await db.userProfile.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
