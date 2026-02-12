import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // Get profile for the first admin user (or all profile entries)
    const admin = await db.user.findFirst({ where: { role: 'admin' } });
    if (!admin) {
      return NextResponse.json({ profile: [] });
    }

    const profile = await db.userProfile.findMany({
      where: { userId: admin.id },
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
