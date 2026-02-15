import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/** POST /api/team/invite — Add a user to the team by email. Creates their account if they don't exist yet. */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { teamId, email, password, displayName, role } = body as {
      teamId: string;
      email: string;
      password?: string;
      displayName?: string;
      role?: string;
    };

    if (!teamId || !email?.trim()) {
      return NextResponse.json({ error: 'teamId and email are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    let user = await db.user.findFirst({ where: { email: normalizedEmail } });

    if (user) {
      // Check if already a member
      const existing = await db.teamMember.findFirst({
        where: { teamId, userId: user.id },
      });
      if (existing) {
        return NextResponse.json({ error: 'User is already a member of this team' }, { status: 400 });
      }

      // Add directly as a member
      await db.teamMember.create({
        data: {
          teamId,
          userId: user.id,
          teamRole: role ?? 'member',
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Existing user added to team',
        member: { displayName: user.displayName, email: user.email, teamRole: role ?? 'member' },
      });
    }

    // User doesn't exist — create their account and add to team
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'A password of at least 8 characters is required for new users' },
        { status: 400 },
      );
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
    const passwordHash = `${salt}:${hash}`;

    user = await db.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: displayName?.trim() || normalizedEmail.split('@')[0],
        role: 'member',
      },
    });

    await db.teamMember.create({
      data: {
        teamId,
        userId: user.id,
        teamRole: role ?? 'member',
      },
    });

    return NextResponse.json({
      success: true,
      message: `Account created for ${user.email} and added to team`,
      member: { displayName: user.displayName, email: user.email, teamRole: role ?? 'member' },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
