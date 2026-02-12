import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/updates/check
 *
 * Checks the git remote (origin/main) for new commits.
 * Returns whether an update is available and commit info.
 */
export async function GET() {
  const projectDir = process.cwd();

  try {
    // Get current version
    let currentVersion = '0.1.0';
    try {
      const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'));
      currentVersion = pkg.version ?? currentVersion;
    } catch { /* default */ }

    // Get current HEAD
    const localHead = execSync('git rev-parse HEAD', {
      cwd: projectDir, encoding: 'utf8', stdio: 'pipe',
    }).trim();

    const localBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectDir, encoding: 'utf8', stdio: 'pipe',
    }).trim();

    // Fetch from remote (non-blocking, fast)
    try {
      execSync('git fetch origin --quiet', {
        cwd: projectDir, encoding: 'utf8', stdio: 'pipe', timeout: 15000,
      });
    } catch {
      return NextResponse.json({
        updateAvailable: false,
        currentVersion,
        currentCommit: localHead.slice(0, 8),
        branch: localBranch,
        error: 'Could not reach remote. Check your network connection.',
      });
    }

    // Get remote HEAD
    let remoteHead: string;
    try {
      remoteHead = execSync(`git rev-parse origin/${localBranch}`, {
        cwd: projectDir, encoding: 'utf8', stdio: 'pipe',
      }).trim();
    } catch {
      remoteHead = execSync('git rev-parse origin/main', {
        cwd: projectDir, encoding: 'utf8', stdio: 'pipe',
      }).trim();
    }

    const updateAvailable = localHead !== remoteHead;

    // Get commit log of what's new
    let newCommits: Array<{ hash: string; message: string; date: string }> = [];
    if (updateAvailable) {
      try {
        const log = execSync(
          `git log ${localHead}..${remoteHead} --format="%H|||%s|||%ci" --max-count=20`,
          { cwd: projectDir, encoding: 'utf8', stdio: 'pipe' },
        ).trim();

        if (log) {
          newCommits = log.split('\n').map(line => {
            const [hash, message, date] = line.split('|||');
            return { hash: hash.slice(0, 8), message, date };
          });
        }
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({
      updateAvailable,
      currentVersion,
      currentCommit: localHead.slice(0, 8),
      remoteCommit: remoteHead.slice(0, 8),
      branch: localBranch,
      newCommits,
      commitsBehind: newCommits.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { updateAvailable: false, error: `Failed to check for updates: ${err.message}` },
      { status: 500 },
    );
  }
}
