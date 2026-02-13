import { NextRequest } from 'next/server';
import { BackgroundTaskRegistry } from '@/lib/background-tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/tasks?sessionId=...
 *
 * Returns all background tasks for a session (running + completed).
 * The frontend polls this to detect when long-running tasks finish.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId query parameter is required' }, { status: 400 });
  }

  const registry = BackgroundTaskRegistry.getInstance();
  // Periodic cleanup of stale tasks
  registry.cleanup();

  const tasks = registry.getBySession(sessionId);

  return Response.json({ tasks });
}

/**
 * POST /api/chat/tasks
 *
 * Acknowledge a completed task (removes it from the registry).
 * Body: { taskId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId } = (await request.json()) as { taskId: string };
    if (!taskId) {
      return Response.json({ error: 'taskId is required' }, { status: 400 });
    }

    const registry = BackgroundTaskRegistry.getInstance();
    const acknowledged = registry.acknowledge(taskId);

    return Response.json({ acknowledged });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
