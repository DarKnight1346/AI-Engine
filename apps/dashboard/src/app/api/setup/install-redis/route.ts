import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import os from 'os';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/setup/install-redis
 *
 * Automatically installs Redis 7 on the host machine.
 * Returns the connection string on success.
 *
 * Supported: Ubuntu/Debian (apt), macOS (brew).
 * Windows: returns instructions only.
 */
export async function POST(_request: NextRequest) {
  const platform = os.platform();

  try {
    if (platform === 'linux') {
      return await installLinux();
    } else if (platform === 'darwin') {
      return await installMacOS();
    } else {
      return NextResponse.json({
        success: false,
        error: 'Automatic Redis installation is not supported on Windows. Please install Redis manually.',
        instructions: [
          'Option 1: Use WSL2 and install via apt',
          'Option 2: Use Docker — docker run -d -p 6379:6379 redis:7',
          'Option 3: Download from https://github.com/microsoftarchive/redis/releases',
        ],
      }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Installation failed: ${err.message}` },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------

async function installLinux() {
  const log: string[] = [];
  const run = (cmd: string, desc: string) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
      log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      if (stderr.includes('already the newest version') || stderr.includes('is already installed')) {
        log.push('  (already installed)');
      } else {
        throw new Error(`${desc} failed: ${stderr || err.message}`);
      }
    }
  };

  const isDebian = (() => {
    try { return execSync('cat /etc/os-release', { encoding: 'utf8' }).toLowerCase().includes('debian') || execSync('cat /etc/os-release', { encoding: 'utf8' }).toLowerCase().includes('ubuntu'); } catch { return false; }
  })();

  if (!isDebian) {
    return NextResponse.json({
      success: false,
      error: 'Automatic installation is only supported on Ubuntu/Debian Linux. Please install Redis manually.',
    }, { status: 400 });
  }

  run('sudo apt-get update -y', 'Updating package list');
  run('sudo apt-get install -y redis-server', 'Installing Redis');
  run('sudo systemctl enable redis-server', 'Enabling Redis service');
  run('sudo systemctl start redis-server', 'Starting Redis service');

  // Verify
  try {
    const pong = execSync('redis-cli ping', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).trim();
    if (pong !== 'PONG') {
      return NextResponse.json(
        { success: false, error: `Redis installed but not responding. Got: ${pong}`, log },
        { status: 500 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Redis installed but not responding to ping.', log },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    connectionUrl: 'redis://localhost:6379',
    message: 'Redis installed and running.',
    log,
  });
}

// ---------------------------------------------------------------------------

async function installMacOS() {
  const log: string[] = [];
  const run = (cmd: string, desc: string) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
      log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      if (stderr.includes('already installed')) {
        log.push('  (already installed)');
      } else {
        throw new Error(`${desc} failed: ${stderr || err.message}`);
      }
    }
  };

  try {
    execSync('which brew', { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Homebrew is required for automatic installation on macOS. Install it from https://brew.sh and try again.',
    }, { status: 400 });
  }

  run('brew install redis', 'Installing Redis');
  run('brew services start redis', 'Starting Redis service');

  // Wait briefly and verify
  execSync('sleep 2', { stdio: 'pipe' });

  try {
    const pong = execSync('redis-cli ping', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).trim();
    if (pong !== 'PONG') {
      return NextResponse.json(
        { success: false, error: `Redis installed but not responding. Got: ${pong}`, log },
        { status: 500 },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Redis installed but not responding to ping.', log },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    connectionUrl: 'redis://localhost:6379',
    message: 'Redis installed and running.',
    log,
  });
}
