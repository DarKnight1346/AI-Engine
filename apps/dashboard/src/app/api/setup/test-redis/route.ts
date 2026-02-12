import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

/**
 * POST /api/setup/test-redis
 *
 * Tests a Redis connection string. Creates a temporary ioredis client,
 * pings, and disconnects.
 *
 * Body: { "url": "redis://..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = body.url as string;

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'Redis connection string is required.' },
        { status: 400 },
      );
    }

    const redis = new Redis(url, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });

    try {
      await redis.connect();
      const pong = await redis.ping();
      redis.disconnect();

      if (pong !== 'PONG') {
        return NextResponse.json(
          { success: false, error: `Unexpected ping response: ${pong}` },
          { status: 400 },
        );
      }

      return NextResponse.json({ success: true, message: 'Connected successfully. Redis responded with PONG.' });
    } catch (connErr: any) {
      try { redis.disconnect(); } catch { /* ignore */ }
      return NextResponse.json(
        { success: false, error: `Connection failed: ${connErr.message}` },
        { status: 400 },
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}
