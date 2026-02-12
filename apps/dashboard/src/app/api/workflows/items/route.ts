import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/** GET /api/workflows/items?workflowId=xxx — Get work items for a workflow */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const workflowId = request.nextUrl.searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }

    const items = await db.workItem.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        workflowId: item.workflowId,
        currentStage: item.currentStage,
        dataJson: item.dataJson,
        status: item.status,
        requiredCapabilities: item.requiredCapabilities,
        nodeAffinity: item.nodeAffinity,
        assignedNode: item.assignedNode,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ items: [], error: err.message }, { status: 500 });
  }
}

/** POST /api/workflows/items — Create a new work item */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.workflowId || !body.title) {
      return NextResponse.json({ error: 'workflowId and title are required' }, { status: 400 });
    }

    // Get the workflow to find the first stage
    const workflow = await db.workflow.findUnique({ where: { id: body.workflowId } });
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const stages = workflow.stages as Array<{ name: string }>;
    const firstStage = body.stage || (stages.length > 0 ? stages[0].name : 'Backlog');

    const item = await db.workItem.create({
      data: {
        workflowId: body.workflowId,
        currentStage: firstStage,
        status: 'pending',
        dataJson: {
          title: body.title,
          description: body.description ?? '',
          agentId: body.agentId ?? null,
        },
        requiredCapabilities: body.requiredCapabilities ?? null,
        nodeAffinity: body.nodeAffinity ?? null,
      },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH /api/workflows/items — Move a work item to a different stage */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { itemId, stage, status } = body;

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (stage) updateData.currentStage = stage;
    if (status) updateData.status = status;

    const item = await db.workItem.update({
      where: { id: itemId },
      data: updateData,
    });

    // Log the transition
    if (stage) {
      try {
        await db.workItemTransition.create({
          data: {
            workItemId: itemId,
            fromStage: '', // Previous stage not tracked in simple update
            toStage: stage,
          },
        });
      } catch { /* transition logging is non-critical */ }
    }

    return NextResponse.json({ item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
