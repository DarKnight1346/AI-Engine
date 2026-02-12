import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { WORKER_BUNDLE, ROOT_PACKAGE_JSON } from '@ai-engine/shared';

export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/version
 *
 * Returns the current version of the worker bundle.
 * Workers poll this endpoint to know when to update.
 */
export async function GET() {
  try {
    const { stat } = await import('fs/promises');
    const fileStat = await stat(WORKER_BUNDLE);

    // Also try to read VERSION from the project root
    let version = '0.1.0';
    let buildDate = fileStat.mtime.toISOString();

    try {
      const rootPkg = JSON.parse(await readFile(ROOT_PACKAGE_JSON, 'utf8'));
      version = rootPkg.version ?? version;
    } catch { /* use default */ }

    return NextResponse.json({
      version,
      buildDate,
      bundleSize: fileStat.size,
    });
  } catch {
    return NextResponse.json(
      { version: '0.1.0', buildDate: null, bundleSize: 0, bundleAvailable: false },
    );
  }
}
