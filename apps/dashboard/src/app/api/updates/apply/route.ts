import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { PROJECT_ROOT } from '@ai-engine/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for pull + build

/**
 * POST /api/updates/apply
 *
 * Pulls the latest code from origin, installs deps, rebuilds everything,
 * re-bundles the worker, and restarts the dashboard.
 *
 * After this completes, workers can pull the new bundle from /api/worker/bundle.
 */
export async function POST(_request: NextRequest) {
  const log: string[] = [];

  const run = (cmd: string, desc: string, timeoutMs = 120000) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: timeoutMs,
      });
      if (out.trim()) log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      throw new Error(`${desc} failed: ${stderr || err.message}`);
    }
  };

  try {
    // 1. Pull latest code
    run('git pull origin main --ff-only', 'Pulling latest code');

    // 2. Install any new dependencies
    run('pnpm install --frozen-lockfile', 'Installing dependencies', 180000);

    // 3. Regenerate Prisma client (ensures engine binaries for this platform)
    run('pnpm --filter @ai-engine/db exec prisma generate', 'Generating Prisma client');

    // 4. Build everything
    run('pnpm build', 'Building all packages', 300000);

    // 5. Copy Prisma engine to Next.js server dir
    try {
      run(
        'cp $(find node_modules -name "libquery_engine-debian*" -o -name "libquery_engine-linux*" 2>/dev/null | head -1) apps/dashboard/.next/server/ 2>/dev/null',
        'Copying Prisma engine to Next.js server',
      );
    } catch { /* non-critical — may already be in the right place */ }

    // 6. Re-bundle the worker
    run('npx tsx scripts/bundle-worker.ts', 'Creating worker bundle', 60000);

    // 7. Get new version info
    let newVersion = '0.1.0';
    try {
      const pkg = JSON.parse(
        execSync('cat package.json', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' })
      );
      newVersion = pkg.version ?? newVersion;
    } catch { /* default */ }

    const newHead = execSync('git rev-parse --short HEAD', {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe',
    }).trim();

    // Return success — then schedule restart
    const response = NextResponse.json({
      success: true,
      version: newVersion,
      commit: newHead,
      message: 'Update applied successfully. The server is restarting.',
      log,
    });

    // Restart the process after sending the response.
    // The system service will bring it back up with the new code.
    setTimeout(() => {
      console.log('[updater] Update applied. Restarting to load new code...');
      process.exit(0);
    }, 2000);

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message, log },
      { status: 500 },
    );
  }
}
