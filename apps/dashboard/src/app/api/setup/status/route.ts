import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/setup/status
 *
 * Returns whether initial setup has been completed
 * (i.e., at least one admin user exists in the database).
 */
export async function GET() {
  try {
    const db = getDb();
    const userCount = await db.user.count();
    return NextResponse.json({
      setupComplete: userCount > 0,
      userCount,
    });
  } catch {
    // If the database isn't even reachable, setup is definitely not complete
    return NextResponse.json({
      setupComplete: false,
      userCount: 0,
      error: 'Database not configured',
    });
  }
}
