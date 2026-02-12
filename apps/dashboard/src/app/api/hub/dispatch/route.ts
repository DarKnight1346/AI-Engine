/**
 * POST /api/hub/dispatch — dispatch a task to a connected worker.
 *
 * Body: { taskId, agentId, input, agentConfig?, requiredCapabilities? }
 *
 * Used by the scheduler, workflow engine, and one-off chat triggers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const hub = (globalThis as any).__workerHub;
  if (!hub) {
    return NextResponse.json(
      { error: 'Worker hub not initialised' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const { taskId, agentId, input, requiredCapabilities } = body;

    if (!taskId || !agentId || !input) {
      return NextResponse.json(
        { error: 'taskId, agentId, and input are required' },
        { status: 400 },
      );
    }

    // Load agent config from DB
    let agentConfig: Record<string, unknown> = body.agentConfig ?? {};
    if (!body.agentConfig) {
      try {
        const db = getDb();
        const agent = await db.agent.findUnique({ where: { id: agentId } });
        if (agent) {
          agentConfig = {
            name: agent.name,
            rolePrompt: agent.rolePrompt,
            toolConfig: agent.toolConfig,
          };
        }
      } catch { /* ignore */ }
    }

    const result = await hub.dispatchTask({
      taskId,
      agentId,
      input,
      agentConfig,
      requiredCapabilities,
    });

    if (result.dispatched) {
      return NextResponse.json({
        dispatched: true,
        workerId: result.workerId,
      });
    }

    return NextResponse.json(
      { dispatched: false, error: result.error },
      { status: 503 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 },
    );
  }
}
