import { NextRequest } from 'next/server';
import Redis from 'ioredis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events
 *
 * Server-Sent Events stream. Subscribes to Redis pub/sub for real-time events
 * and forwards them to the browser.
 *
 * Event channels:
 *   ai-engine:events:task     - task status changes
 *   ai-engine:events:worker   - worker connect/disconnect
 *   ai-engine:events:schedule - scheduler fires
 *   ai-engine:events:chat     - new chat messages
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const redisUrl = process.env.REDIS_URL;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`),
      );

      let subscriber: Redis | null = null;

      // Keep-alive ping every 25 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(keepAlive);
        }
      }, 25000);

      // Subscribe to Redis pub/sub if configured
      if (redisUrl) {
        try {
          subscriber = new Redis(redisUrl, {
            maxRetriesPerRequest: 0,
            lazyConnect: true,
          });

          subscriber.connect().then(() => {
            const channels = [
              'ai-engine:events:task',
              'ai-engine:events:worker',
              'ai-engine:events:schedule',
              'ai-engine:events:chat',
            ];

            subscriber!.subscribe(...channels).catch(() => {});

            subscriber!.on('message', (channel: string, message: string) => {
              try {
                const eventType = channel.split(':').pop() ?? 'unknown';
                controller.enqueue(
                  encoder.encode(`event: ${eventType}\ndata: ${message}\n\n`),
                );
              } catch {
                // Stream closed
              }
            });
          }).catch(() => {
            // Redis not available — SSE still works for keep-alive
          });
        } catch {
          // Redis connection failed — non-fatal
        }
      }

      req.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        if (subscriber) {
          subscriber.disconnect();
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
