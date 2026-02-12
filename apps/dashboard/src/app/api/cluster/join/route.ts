import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';

    // ── Generate a join token ──
    if (body.generateToken) {
      const serverUrl = process.env.PUBLIC_URL
        || process.env.TUNNEL_URL
        || `http://localhost:${process.env.DASHBOARD_PORT || 3000}`;

      const token = jwt.sign(
        { type: 'worker-join', serverUrl, iat: Math.floor(Date.now() / 1000) },
        secret,
        { expiresIn: '7d' },
      );

      return NextResponse.json({ token });
    }

    // ── Validate an existing join token ──
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
