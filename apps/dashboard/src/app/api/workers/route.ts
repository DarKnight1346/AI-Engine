import { NextResponse } from 'next/server';

export async function GET() {
  // TODO: Integrate with NodeRegistry
  return NextResponse.json({ workers: [] });
}
