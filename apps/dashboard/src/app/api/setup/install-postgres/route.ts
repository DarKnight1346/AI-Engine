import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — installs can be slow

/**
 * POST /api/setup/install-postgres
 *
 * Automatically installs PostgreSQL 16 + pgvector on the host machine.
 * Returns the connection string on success.
 *
 * Supported: Ubuntu/Debian (apt), macOS (brew).
 * Windows: returns instructions only.
 */
export async function POST(_request: NextRequest) {
  const platform = os.platform();
  const password = crypto.randomBytes(16).toString('hex');
  const dbName = 'ai_engine';
  const dbUser = 'ai_engine';

  try {
    // Check if PostgreSQL is already installed and the ai_engine database exists
    const existing = detectExistingPostgres(dbUser, dbName);
    if (existing) {
      return await reuseExistingPostgres(existing.platform, dbUser, password, dbName);
    }

    if (platform === 'linux') {
      return await installLinux(dbUser, password, dbName);
    } else if (platform === 'darwin') {
      return await installMacOS(dbUser, password, dbName);
    } else {
      return NextResponse.json({
        success: false,
        error: 'Automatic PostgreSQL installation is not supported on Windows. Please install PostgreSQL manually and provide the connection string.',
        instructions: [
          'Download PostgreSQL 16 from https://www.postgresql.org/download/windows/',
          'Run the installer and follow the prompts.',
          'Install pgvector: https://github.com/pgvector/pgvector#windows',
          `Create database: CREATE DATABASE ${dbName};`,
          `Create user: CREATE USER ${dbUser} WITH PASSWORD 'your_password';`,
          `Grant access: GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser};`,
        ],
      }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Installation failed: ${err.message}`, log: err.stdout?.toString() ?? '' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Detect & reuse existing installation
// ---------------------------------------------------------------------------

function detectExistingPostgres(dbUser: string, dbName: string): { platform: string; hasDb: boolean; hasUser: boolean } | null {
  try {
    // Check if psql is available and PostgreSQL is running
    execSync('sudo -u postgres psql -c "SELECT 1;"', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
  } catch {
    return null; // PostgreSQL not installed or not running
  }

  let hasUser = false;
  let hasDb = false;

  try {
    const roles = execSync(`sudo -u postgres psql -t -c "SELECT 1 FROM pg_roles WHERE rolname = '${dbUser}';"`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    hasUser = roles.trim() === '1';
  } catch { /* not fatal */ }

  try {
    const dbs = execSync(`sudo -u postgres psql -t -c "SELECT 1 FROM pg_database WHERE datname = '${dbName}';"`, { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    hasDb = dbs.trim() === '1';
  } catch { /* not fatal */ }

  if (!hasUser && !hasDb) return null; // PostgreSQL exists but has no ai_engine setup

  return { platform: os.platform(), hasDb, hasUser };
}

async function reuseExistingPostgres(platform: string, dbUser: string, password: string, dbName: string) {
  const log: string[] = ['Existing PostgreSQL installation detected.'];

  const run = (cmd: string, desc: string) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
      if (out.trim()) log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      throw new Error(`${desc} failed: ${stderr || err.message}`);
    }
  };

  // Ensure the user exists and reset password
  run(
    `sudo -u postgres psql -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${dbUser}') THEN CREATE ROLE ${dbUser} WITH LOGIN PASSWORD '${password}'; ELSE ALTER ROLE ${dbUser} WITH LOGIN PASSWORD '${password}'; END IF; END \\$\\$;"`,
    'Resetting database user password',
  );

  // Ensure the database exists
  try {
    run(`sudo -u postgres createdb -O ${dbUser} ${dbName}`, 'Creating database');
  } catch {
    log.push('  (database already exists)');
    // Make sure ownership is correct
    try {
      run(`sudo -u postgres psql -c "ALTER DATABASE ${dbName} OWNER TO ${dbUser};"`, 'Ensuring database ownership');
    } catch { /* non-fatal */ }
  }

  // Ensure pgvector extension
  try {
    run(`sudo -u postgres psql -d ${dbName} -c "CREATE EXTENSION IF NOT EXISTS vector;"`, 'Ensuring pgvector extension');
  } catch {
    log.push('  (pgvector extension may need manual installation)');
  }

  // Ensure pg_hba.conf allows password auth
  try {
    const hbaPath = execSync(`sudo -u postgres psql -t -c "SHOW hba_file;"`, { encoding: 'utf8' }).trim();
    const hbaContent = execSync(`sudo cat "${hbaPath}"`, { encoding: 'utf8' });
    if (!hbaContent.includes(`# ai-engine`)) {
      execSync(`echo "# ai-engine\\nlocal   ${dbName}   ${dbUser}   md5\\nhost    ${dbName}   ${dbUser}   127.0.0.1/32   md5" | sudo tee -a "${hbaPath}"`, { encoding: 'utf8' });
      run('sudo systemctl reload postgresql', 'Reloading PostgreSQL config');
    }
  } catch { /* non-fatal */ }

  const connectionUrl = `postgresql://${dbUser}:${password}@localhost:5432/${dbName}`;

  return NextResponse.json({
    success: true,
    connectionUrl,
    message: `Existing PostgreSQL detected. Password reset and database "${dbName}" verified.`,
    log,
    reused: true,
  });
}

// ---------------------------------------------------------------------------

async function installLinux(user: string, password: string, dbName: string) {
  const log: string[] = [];
  const run = (cmd: string, desc: string) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
      log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      // Some commands fail gracefully (e.g., "already installed")
      if (stderr.includes('already the newest version') || stderr.includes('is already installed')) {
        log.push(`  (already installed)`);
      } else {
        throw new Error(`${desc} failed: ${stderr || err.message}`);
      }
    }
  };

  // Detect distro
  const isDebian = (() => {
    try { return execSync('cat /etc/os-release', { encoding: 'utf8' }).includes('debian') || execSync('cat /etc/os-release', { encoding: 'utf8' }).includes('ubuntu'); } catch { return false; }
  })();

  if (!isDebian) {
    return NextResponse.json({
      success: false,
      error: 'Automatic installation is only supported on Ubuntu/Debian Linux. Please install PostgreSQL manually.',
    }, { status: 400 });
  }

  // Install PostgreSQL
  run('sudo apt-get update -y', 'Updating package list');
  run('sudo apt-get install -y postgresql postgresql-contrib', 'Installing PostgreSQL');

  // Detect installed major version for pgvector package name
  let pgVersion = '16';
  try {
    const ver = execSync(`pg_config --version`, { encoding: 'utf8' }).trim();
    const match = ver.match(/PostgreSQL (\d+)/);
    if (match) pgVersion = match[1];
  } catch { /* default to 16 */ }

  // Install pgvector
  try {
    run(`sudo apt-get install -y postgresql-${pgVersion}-pgvector`, 'Installing pgvector');
  } catch {
    // If the package isn't in repos, try building from source
    log.push('pgvector package not found, trying to build from source...');
    run('sudo apt-get install -y build-essential git postgresql-server-dev-all', 'Installing build tools');
    run('cd /tmp && git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git && cd pgvector && make && sudo make install', 'Building pgvector from source');
  }

  // Start PostgreSQL
  run('sudo systemctl enable postgresql', 'Enabling PostgreSQL service');
  run('sudo systemctl start postgresql', 'Starting PostgreSQL service');

  // Create user and database
  const sqlSetup = `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${user}') THEN
        CREATE ROLE ${user} WITH LOGIN PASSWORD '${password}';
      ELSE
        ALTER ROLE ${user} WITH PASSWORD '${password}';
      END IF;
    END $$;
    SELECT 'CREATE DATABASE ${dbName} OWNER ${user}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${dbName}')\\gexec
    GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${user};
    \\c ${dbName}
    CREATE EXTENSION IF NOT EXISTS vector;
  `.replace(/\n/g, ' ');

  run(`sudo -u postgres psql -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${user}') THEN CREATE ROLE ${user} WITH LOGIN PASSWORD '${password}'; ELSE ALTER ROLE ${user} WITH PASSWORD '${password}'; END IF; END \\$\\$;"`, 'Creating database user');
  
  // Create database (ignore if exists)
  try {
    run(`sudo -u postgres createdb -O ${user} ${dbName}`, 'Creating database');
  } catch {
    log.push('  (database may already exist)');
  }

  // Enable pgvector extension
  run(`sudo -u postgres psql -d ${dbName} -c "CREATE EXTENSION IF NOT EXISTS vector;"`, 'Enabling pgvector extension');

  // Allow password auth for the user (check pg_hba.conf)
  try {
    const hbaPath = execSync(`sudo -u postgres psql -t -c "SHOW hba_file;"`, { encoding: 'utf8' }).trim();
    const hbaContent = execSync(`sudo cat "${hbaPath}"`, { encoding: 'utf8' });
    if (!hbaContent.includes(`# ai-engine`)) {
      execSync(`echo "# ai-engine\\nlocal   ${dbName}   ${user}   md5\\nhost    ${dbName}   ${user}   127.0.0.1/32   md5" | sudo tee -a "${hbaPath}"`, { encoding: 'utf8' });
      run('sudo systemctl reload postgresql', 'Reloading PostgreSQL config');
    }
  } catch { /* non-fatal */ }

  const connectionUrl = `postgresql://${user}:${password}@localhost:5432/${dbName}`;

  return NextResponse.json({
    success: true,
    connectionUrl,
    message: `PostgreSQL installed and configured. Database "${dbName}" is ready.`,
    log,
  });
}

// ---------------------------------------------------------------------------

async function installMacOS(user: string, password: string, dbName: string) {
  const log: string[] = [];
  const run = (cmd: string, desc: string) => {
    log.push(`> ${desc}`);
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
      log.push(out.trim());
    } catch (err: any) {
      const stderr = err.stderr?.toString() ?? '';
      if (stderr.includes('already installed')) {
        log.push(`  (already installed)`);
      } else {
        throw new Error(`${desc} failed: ${stderr || err.message}`);
      }
    }
  };

  // Check for Homebrew
  try {
    execSync('which brew', { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Homebrew is required for automatic installation on macOS. Install it from https://brew.sh and try again.',
    }, { status: 400 });
  }

  run('brew install postgresql@16', 'Installing PostgreSQL 16');
  run('brew install pgvector', 'Installing pgvector');
  run('brew services start postgresql@16', 'Starting PostgreSQL service');

  // Wait for PostgreSQL to be ready
  for (let i = 0; i < 10; i++) {
    try {
      execSync('pg_isready', { encoding: 'utf8', stdio: 'pipe' });
      break;
    } catch {
      execSync('sleep 1', { stdio: 'pipe' });
    }
  }

  // Create user and database
  try {
    run(`createuser -s ${user} 2>/dev/null || true`, 'Creating database user');
  } catch { /* may exist */ }

  try {
    run(`psql postgres -c "ALTER USER ${user} WITH PASSWORD '${password}';"`, 'Setting user password');
  } catch { /* non-fatal */ }

  try {
    run(`createdb -O ${user} ${dbName}`, 'Creating database');
  } catch {
    log.push('  (database may already exist)');
  }

  run(`psql -d ${dbName} -c "CREATE EXTENSION IF NOT EXISTS vector;"`, 'Enabling pgvector extension');

  const connectionUrl = `postgresql://${user}:${password}@localhost:5432/${dbName}`;

  return NextResponse.json({
    success: true,
    connectionUrl,
    message: `PostgreSQL installed and configured. Database "${dbName}" is ready.`,
    log,
  });
}
