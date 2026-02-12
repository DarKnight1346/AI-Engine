import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ skills: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ id: crypto.randomUUID(), ...body }, { status: 201 });
}
