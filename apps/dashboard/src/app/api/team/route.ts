import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // Get the first team (primary team for the current user)
    const team = await db.team.findFirst({
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, displayName: true },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ team: null });
    }

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        aiSensitivity: team.aiSensitivity,
        alwaysRespondKeywords: team.alwaysRespondKeywords ?? [],
        quietHours: team.quietHours ?? null,
        members: team.members.map((m) => ({
          id: m.id,
          displayName: m.user.displayName,
          email: m.user.email,
          teamRole: m.teamRole,
        })),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ team: null, error: err.message }, { status: 500 });
  }
}
