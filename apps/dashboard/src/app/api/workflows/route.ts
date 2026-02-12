import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  // TODO: Integrate with WorkflowService
  return NextResponse.json({
    workflows: [
      {
        id: 'demo-1',
        name: 'Software Development',
        stages: ['Backlog', 'In Development', 'Ready for QA', 'QA Pass', 'Done'],
        createdAt: new Date().toISOString(),
      },
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  // TODO: Integrate with WorkflowService
  return NextResponse.json({ id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString() }, { status: 201 });
}
