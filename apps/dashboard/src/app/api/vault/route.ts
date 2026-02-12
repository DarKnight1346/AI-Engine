import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  // Never return actual secret values
  return NextResponse.json({ credentials: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ id: crypto.randomUUID(), name: body.name, type: body.type }, { status: 201 });
}
