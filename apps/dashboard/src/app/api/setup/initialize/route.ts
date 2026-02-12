import { NextRequest, NextResponse } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';

/**
 * POST /api/setup/initialize
 *
 * Called by the setup wizard after the user has tested and confirmed their
 * PostgreSQL and Redis connections. This route:
 *
 * 1. Writes the real DATABASE_URL and REDIS_URL into the .env file
 * 2. Runs Prisma migrations to create the database schema
 * 3. Signals the process to restart so the new config takes effect
 *
 * Body: { "databaseUrl": "postgresql://...", "redisUrl": "redis://..." }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { databaseUrl, redisUrl } = body as { databaseUrl: string; redisUrl: string };

    if (!databaseUrl || !redisUrl) {
      return NextResponse.json(
        { success: false, error: 'Both databaseUrl and redisUrl are required.' },
        { status: 400 },
      );
    }

    // --- 1. Update the .env file ---
    const projectDir = process.cwd();
    const envPath = join(projectDir, '.env');

    let envContent: string;
    try {
      envContent = await readFile(envPath, 'utf8');
    } catch {
      envContent = '';
    }

    // Replace or append DATABASE_URL and REDIS_URL
    envContent = upsertEnvVar(envContent, 'DATABASE_URL', databaseUrl);
    envContent = upsertEnvVar(envContent, 'REDIS_URL', redisUrl);

    await writeFile(envPath, envContent);

    // --- 2. Run Prisma migrations ---
    const prismaDir = join(projectDir, 'packages', 'db');

    try {
      // Generate the Prisma client with the new URL
      execSync('npx prisma generate', {
        cwd: prismaDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 30000,
      });

      // Run migrations
      execSync('npx prisma migrate dev --name init --skip-generate', {
        cwd: prismaDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (migrationErr: any) {
      const stderr = migrationErr.stderr?.toString() ?? '';
      // If migrations already exist, try deploy instead
      if (stderr.includes('already exists') || stderr.includes('already applied')) {
        try {
          execSync('npx prisma migrate deploy', {
            cwd: prismaDir,
            env: { ...process.env, DATABASE_URL: databaseUrl },
            stdio: 'pipe',
            timeout: 60000,
          });
        } catch (deployErr: any) {
          return NextResponse.json(
            { success: false, error: `Migration failed: ${deployErr.stderr?.toString() ?? deployErr.message}` },
            { status: 500 },
          );
        }
      } else {
        return NextResponse.json(
          { success: false, error: `Migration failed: ${stderr || migrationErr.message}` },
          { status: 500 },
        );
      }
    }

    // --- 3. Schedule a process restart ---
    // Respond first, then exit. The system service (systemd/launchd) will
    // restart the process, which will read the updated .env via the wrapper
    // script.
    const response = NextResponse.json({
      success: true,
      message: 'Database initialized. The server is restarting to apply the new configuration.',
      restart: true,
    });

    setTimeout(() => {
      console.log('[setup] Configuration saved. Restarting to apply changes...');
      process.exit(0);
    }, 1500);

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Insert or replace an environment variable in a .env file string.
 */
function upsertEnvVar(content: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escapedKey}=.*$`, 'm');

  const newLine = `${key}="${value}"`;

  if (regex.test(content)) {
    return content.replace(regex, newLine);
  }

  // Append if not found
  return content.trimEnd() + '\n' + newLine + '\n';
}
