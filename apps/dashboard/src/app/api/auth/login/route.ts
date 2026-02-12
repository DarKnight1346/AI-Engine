import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Verify password
    const [salt, storedHash] = user.passwordHash.split(':');
    const inputHash = crypto.createHash('sha256').update(salt + password).digest('hex');

    if (inputHash !== storedHash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Generate JWT
    const jwt = await import('jsonwebtoken');
    const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';
    const token = jwt.default.sign(
      { userId: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: '7d' },
    );

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      token,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
