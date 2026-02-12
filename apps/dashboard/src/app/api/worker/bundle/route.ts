import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { WORKER_BUNDLE } from '@ai-engine/shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/bundle
 *
 * Serves the pre-built worker bundle (tar.gz).
 * Workers download this to install or update themselves.
 * The bundle is created during `pnpm build` via the bundle-worker script.
 */
export async function GET(request: NextRequest) {
  try {
    const fileStat = await stat(WORKER_BUNDLE);
    const fileBuffer = await readFile(WORKER_BUNDLE);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="ai-engine-worker.tar.gz"',
        'Content-Length': String(fileStat.size),
        'X-Bundle-Version': process.env.npm_package_version ?? '0.1.0',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Worker bundle not found. Run: npx tsx scripts/bundle-worker.ts' },
      { status: 404 },
    );
  }
}
