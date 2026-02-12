import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const skills = await db.skill.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        instructions: s.instructions,
        version: s.version,
        isActive: s.isActive,
        usageCount: s.usageCount,
        createdBy: s.createdBy,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ skills: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const skill = await db.skill.create({
      data: {
        name: body.name,
        description: body.description ?? '',
        category: body.category ?? 'General',
        instructions: body.instructions ?? '',
        toolSequenceJson: body.toolSequence ?? null,
        codeSnippet: body.codeSnippet ?? null,
        requiredCapabilities: body.requiredCapabilities ?? [],
        createdBy: body.createdBy ?? 'user',
      },
    });

    return NextResponse.json({ skill }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
