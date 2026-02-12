import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  // TODO: Integrate with ScheduleService
  return NextResponse.json({ schedules: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ id: crypto.randomUUID(), ...body }, { status: 201 });
}
