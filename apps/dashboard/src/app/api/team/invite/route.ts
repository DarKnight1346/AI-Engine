import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/** POST /api/team/invite — Invite a user to the team by email */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { teamId, email, role } = body as { teamId: string; email: string; role?: string };

    if (!teamId || !email?.trim()) {
      return NextResponse.json({ error: 'teamId and email are required' }, { status: 400 });
    }

    // Check if user already exists
    let user = await db.user.findFirst({ where: { email: email.trim().toLowerCase() } });

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
        message: 'User added to team',
        member: { displayName: user.displayName, email: user.email, teamRole: role ?? 'member' },
      });
    }

    // User doesn't exist — create an invite
    const token = crypto.randomBytes(32).toString('hex');

    // Find the admin user for invitedBy
    const admin = await db.user.findFirst({ where: { role: 'admin' } });

    await db.teamInvite.create({
      data: {
        teamId,
        email: email.trim().toLowerCase(),
        token,
        invitedByUserId: admin?.id ?? '',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Invitation created. Share the invite link with the user.',
      inviteToken: token,
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
