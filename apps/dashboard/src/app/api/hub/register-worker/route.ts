/**
 * POST /api/hub/register-worker — register a new worker and return a JWT token.
 *
 * Called by the join-worker CLI. Creates a Node record in the DB and returns
 * a signed JWT that the worker will use to authenticate via WebSocket.
 *
 * Body: { hostname, os, capabilities }
 * Response: { workerId, token }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { hostname, os: nodeOs, capabilities } = body;

    if (!hostname) {
      return NextResponse.json(
        { error: 'hostname is required' },
        { status: 400 },
      );
    }

    const db = getDb();
    const workerId = crypto.randomUUID();
    const secret = process.env.INSTANCE_SECRET ?? 'dev-secret';

    // Create the node record
    const resolvedOs = nodeOs ?? 'linux';
    const resolvedEnv = capabilities?.environment ?? 'local';
    await db.node.create({
      data: {
        id: workerId,
        hostname,
        ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '0.0.0.0',
        os: resolvedOs,
        environment: resolvedEnv,
        capabilities: (capabilities ?? {
          os: resolvedOs,
          hasDisplay: false,
          browserCapable: false,
          environment: resolvedEnv,
          customTags: [],
        }) as any,
        lastHeartbeat: new Date(),
      },
    });

    // Sign a long-lived JWT for the worker
    const token = jwt.sign(
      { workerId, hostname, type: 'worker' },
      secret,
      { expiresIn: '365d' },
    );

    return NextResponse.json({ workerId, token });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
