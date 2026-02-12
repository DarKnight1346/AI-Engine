import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { email, password, displayName } = body;

    if (!email || !password || !displayName) {
      return NextResponse.json(
        { error: 'email, password, and displayName are required' },
        { status: 400 },
      );
    }

    // Check if user already exists
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }

    // Hash password (SHA-256 + salt; in production use argon2 via AuthService)
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
    const passwordHash = `${salt}:${hash}`;

    // Determine role — first user is always admin
    const userCount = await db.user.count();
    const role = userCount === 0 ? 'admin' : 'member';

    const user = await db.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        role,
      },
    });

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
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
