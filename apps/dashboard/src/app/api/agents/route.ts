import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  // TODO: Integrate with DB
  return NextResponse.json({
    agents: [
      { id: '1', name: 'Orchestrator', rolePrompt: 'Master coordinator', status: 'idle' },
      { id: '2', name: 'Developer', rolePrompt: 'Writes and reviews code', status: 'idle' },
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ id: crypto.randomUUID(), ...body }, { status: 201 });
}
