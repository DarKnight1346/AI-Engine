/**
 * Static, canonical filesystem paths for the AI Engine installation.
 *
 * Every module that needs to read/write the .env file, run prisma
 * commands, locate the worker bundle, etc. should import from here
 * instead of computing paths from `process.cwd()`.
 *
 * The production install lives at /opt/ai-engine.
 * For local development set the AI_ENGINE_ROOT env var to your repo root.
 */

import { join } from 'path';

/** Absolute path to the monorepo / project root. */
export const PROJECT_ROOT: string =
  process.env.AI_ENGINE_ROOT ?? '/opt/ai-engine';

/** Absolute path to the .env file (single source of truth). */
export const ENV_FILE: string = join(PROJECT_ROOT, '.env');

/** Directory containing the Prisma schema + migrations. */
export const PRISMA_DIR: string = join(PROJECT_ROOT, 'packages', 'db');

/** Directory containing the built Next.js dashboard. */
export const DASHBOARD_DIR: string = join(PROJECT_ROOT, 'apps', 'dashboard');

/** Path to the pre-built worker bundle tarball. */
export const WORKER_BUNDLE: string = join(PROJECT_ROOT, 'worker-bundle.tar.gz');

/** Path to the root package.json (for version info). */
export const ROOT_PACKAGE_JSON: string = join(PROJECT_ROOT, 'package.json');
