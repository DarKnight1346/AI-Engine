import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@ai-engine/db';

/**
 * POST /api/setup/test-postgres
 *
 * Tests a PostgreSQL connection string. Creates a temporary PrismaClient,
 * attempts to connect, runs a basic query, and disconnects.
 *
 * Body: { "url": "postgresql://..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = body.url as string;

    if (!url || !url.startsWith('postgresql')) {
      return NextResponse.json(
        { success: false, error: 'Invalid PostgreSQL connection string. Must start with "postgresql://".' },
        { status: 400 },
      );
    }

    // Create a throwaway Prisma client with the user-provided URL
    const testClient = new PrismaClient({
      datasources: { db: { url } },
    });

    try {
      await testClient.$connect();

      // Verify pgvector extension
      const extensions = await testClient.$queryRawUnsafe<Array<{ extname: string }>>(
        `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
      );

      const hasPgVector = extensions.some((ext) => ext.extname === 'vector');

      await testClient.$disconnect();

      if (!hasPgVector) {
        return NextResponse.json({
          success: true,
          warning: 'Connected successfully, but the "vector" extension (pgvector) is not installed. Run: CREATE EXTENSION IF NOT EXISTS vector;',
        });
      }

      return NextResponse.json({ success: true, message: 'Connected successfully. pgvector extension detected.' });
    } catch (connErr: any) {
      await testClient.$disconnect().catch(() => {});
      return NextResponse.json(
        { success: false, error: `Connection failed: ${connErr.message}` },
        { status: 400 },
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}
