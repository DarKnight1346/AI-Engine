import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    const secret = process.env.INSTANCE_SECRET;

    if (!secret) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    // Validate join token
    let payload: any;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    if (payload.type !== 'worker-join') {
      return NextResponse.json({ error: 'Invalid token type' }, { status: 401 });
    }

    // Provision worker credentials
    const workerId = randomUUID();
    const workerSecret = randomUUID() + randomUUID();

    // Return connection info
    return NextResponse.json({
      workerId,
      workerSecret,
      serverUrl: payload.serverUrl,
      postgresUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
