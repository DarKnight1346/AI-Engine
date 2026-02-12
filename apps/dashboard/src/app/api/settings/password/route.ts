import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/** POST /api/settings/password — Change the admin password */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'currentPassword and newPassword are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const user = await db.user.findFirst({ where: { role: 'admin' } });
    if (!user) {
      return NextResponse.json({ error: 'No admin user found' }, { status: 404 });
    }

    // Verify current password (SHA-256 with salt, matching register route)
    const parts = user.passwordHash.split(':');
    const salt = parts[0];
    const existingHash = parts[1];
    const currentHash = crypto.createHash('sha256').update(salt + currentPassword).digest('hex');

    if (currentHash !== existingHash) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash new password
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = crypto.createHash('sha256').update(newSalt + newPassword).digest('hex');

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: `${newSalt}:${newHash}` },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
