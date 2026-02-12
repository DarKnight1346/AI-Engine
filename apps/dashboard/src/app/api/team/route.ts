import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const team = await db.team.findFirst({
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, displayName: true } },
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
          userId: m.userId,
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

/** POST /api/team — Create a new team */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, description } = body as { name: string; description?: string };

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    }

    // Get admin user to add as team owner
    const user = await db.user.findFirst({ where: { role: 'admin' } });
    if (!user) {
      return NextResponse.json({ error: 'No admin user found. Complete setup first.' }, { status: 400 });
    }

    const team = await db.team.create({
      data: {
        name: name.trim(),
        description: description?.trim() ?? null,
        members: {
          create: { userId: user.id, teamRole: 'owner' },
        },
      },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, displayName: true } } },
        },
      },
    });

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
          userId: m.userId,
          displayName: m.user.displayName,
          email: m.user.email,
          teamRole: m.teamRole,
        })),
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH /api/team — Update team settings */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { teamId, name, description, aiSensitivity, alwaysRespondKeywords, quietHours } = body;

    if (!teamId) {
      return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (aiSensitivity !== undefined) updateData.aiSensitivity = aiSensitivity;
    if (alwaysRespondKeywords !== undefined) updateData.alwaysRespondKeywords = alwaysRespondKeywords;
    if (quietHours !== undefined) updateData.quietHours = quietHours;

    await db.team.update({
      where: { id: teamId },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
