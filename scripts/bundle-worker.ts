// bundle-worker.ts
//
// Creates a self-contained worker bundle (tar.gz) that can be served by the
// dashboard. Workers download this bundle to install or update — no git repo
// needed on the worker machine.
//
// The bundle contains:
//   - apps/worker/dist/            (compiled worker code)
//   - packages/<name>/dist/        (compiled workspace packages)
//   - packages/<name>/package.json (for workspace resolution, trimmed of non-bundled deps)
//   - packages/db/                 (stub — satisfies imports without needing Prisma)
//   - package.json                 (root — external dependencies only)
//   - pnpm-workspace.yaml          (generated — lists only bundled packages)
//   - node_modules/                (pre-installed production dependencies)
//   - start-worker.sh              (entry point)
//   - VERSION                      (version + build timestamp)
//
// Run: npx tsx scripts/bundle-worker.ts
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_DIR = join(ROOT, '.worker-bundle');
const OUTPUT = join(ROOT, 'worker-bundle.tar.gz');

function main() {
  console.log('📦 Creating worker bundle...\n');

  // Clean previous bundle
  if (existsSync(BUNDLE_DIR)) rmSync(BUNDLE_DIR, { recursive: true });
  mkdirSync(BUNDLE_DIR, { recursive: true });

  // Read root package.json for version
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const version = rootPkg.version ?? '0.1.0';

  // --- Copy workspace packages (dist + package.json only) ---
  // Workers connect via WebSocket and do NOT need database, Redis, or
  // cluster packages. Only include packages the worker actually imports.
  const packages = [
    'shared',         // types, config, WS protocol
    'llm',            // Claude API pool
    'memory',         // context builder, embeddings
    'agent-runtime',  // agent execution loop, tool registry
    'browser',        // Puppeteer pool (optional, macOS only)
    'web-search',     // search services (imported by agent-runtime/chat-executor)
  ];

  // Build a set of workspace package names included in the bundle so we can
  // strip references to packages that are NOT shipped (e.g. @ai-engine/cluster).
  const bundledPkgNames = new Set<string>();
  for (const pkg of packages) {
    const pjPath = join(ROOT, 'packages', pkg, 'package.json');
    if (existsSync(pjPath)) {
      const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
      bundledPkgNames.add(pj.name as string);
    }
  }
  // Also include the worker app itself
  const workerPjPath = join(ROOT, 'apps', 'worker', 'package.json');
  if (existsSync(workerPjPath)) {
    const wpj = JSON.parse(readFileSync(workerPjPath, 'utf8'));
    bundledPkgNames.add(wpj.name as string);
  }

  // Pre-register @ai-engine/db so its workspace:* references are preserved in
  // the bundled package.json files. A lightweight stub is generated later (see below).
  bundledPkgNames.add('@ai-engine/db');

  for (const pkg of packages) {
    const srcDir = join(ROOT, 'packages', pkg);
    const destDir = join(BUNDLE_DIR, 'packages', pkg);
    mkdirSync(destDir, { recursive: true });

    // Copy dist/
    const distSrc = join(srcDir, 'dist');
    if (existsSync(distSrc)) {
      cpSync(distSrc, join(destDir, 'dist'), { recursive: true });
    }

    // Copy package.json — strip workspace dependencies that aren't in the bundle.
    // For example, agent-runtime depends on @ai-engine/workflow-engine which isn't
    // shipped to workers. Leaving it in causes ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
    const pkgJsonSrc = join(srcDir, 'package.json');
    if (existsSync(pkgJsonSrc)) {
      const pj = JSON.parse(readFileSync(pkgJsonSrc, 'utf8'));
      if (pj.dependencies) {
        for (const [dep, ver] of Object.entries(pj.dependencies)) {
          if (typeof ver === 'string' && ver.startsWith('workspace:') && !bundledPkgNames.has(dep)) {
            console.log(`  Stripping missing workspace dep "${dep}" from ${pkg}/package.json`);
            delete pj.dependencies[dep];
          }
        }
      }
      writeFileSync(join(destDir, 'package.json'), JSON.stringify(pj, null, 2));
    }

    // Workers don't need Prisma/DB — skip prisma directory
  }

  // --- Generate stub @ai-engine/db package ---
  // Many bundled packages (memory, agent-runtime) import from @ai-engine/db at
  // the top level via barrel exports. Workers never call getDb(), but Node.js
  // ESM evaluates all re-exported modules at load time, so the import must
  // resolve. Including the real db package would pull in @prisma/client and
  // require `prisma generate` — too heavyweight for workers.
  //
  // Instead, generate a lightweight stub that satisfies the import but throws
  // if any DB function is actually called.
  const dbStubDir = join(BUNDLE_DIR, 'packages', 'db');
  mkdirSync(join(dbStubDir, 'dist'), { recursive: true });

  const dbStubJs = `// Stub @ai-engine/db for worker bundles — workers don't access the database.
// This exists only so barrel-export imports resolve without crashing.
export function getDb() {
  throw new Error('@ai-engine/db is not available on workers. Database access is only available on the dashboard server.');
}
export async function disconnectDb() {}
export class PrismaClient {
  constructor() {
    throw new Error('@ai-engine/db is not available on workers.');
  }
}
`;
  writeFileSync(join(dbStubDir, 'dist', 'index.js'), dbStubJs);

  const dbStubPkg = {
    name: '@ai-engine/db',
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'dist/index.js',
  };
  writeFileSync(join(dbStubDir, 'package.json'), JSON.stringify(dbStubPkg, null, 2));

  console.log('  Generated stub @ai-engine/db (workers don\'t need database access)');

  // --- Copy worker app ---
  const workerSrc = join(ROOT, 'apps', 'worker');
  const workerDest = join(BUNDLE_DIR, 'apps', 'worker');
  mkdirSync(workerDest, { recursive: true });

  const workerDist = join(workerSrc, 'dist');
  if (!existsSync(workerDist)) {
    throw new Error(`Worker dist not found at ${workerDist}. Run "pnpm build" first.`);
  }
  cpSync(workerDist, join(workerDest, 'dist'), { recursive: true });

  // Copy worker package.json — strip workspace deps not in the bundle (same as packages above)
  const workerPj = JSON.parse(readFileSync(join(workerSrc, 'package.json'), 'utf8'));
  if (workerPj.dependencies) {
    for (const [dep, ver] of Object.entries(workerPj.dependencies)) {
      if (typeof ver === 'string' && ver.startsWith('workspace:') && !bundledPkgNames.has(dep)) {
        console.log(`  Stripping missing workspace dep "${dep}" from worker/package.json`);
        delete workerPj.dependencies[dep];
      }
    }
  }
  // Also strip devDependencies — the bundle only ships dist/ and doesn't need build tools
  delete workerPj.devDependencies;
  writeFileSync(join(workerDest, 'package.json'), JSON.stringify(workerPj, null, 2));

  if (existsSync(join(workerSrc, 'tsconfig.json'))) {
    cpSync(join(workerSrc, 'tsconfig.json'), join(workerDest, 'tsconfig.json'));
  }

  // --- Generate workspace config (only include packages in the bundle) ---
  // The monorepo pnpm-workspace.yaml lists all packages (apps/*, packages/*, cli/*)
  // but the bundle only contains a subset. Generate a targeted one so pnpm doesn't
  // complain about missing workspace packages.
  const bundleWorkspaceYaml = [
    'packages:',
    '  - "apps/worker"',
    ...packages.map(p => `  - "packages/${p}"`),
    '  - "packages/db"',  // stub — satisfies workspace:* resolution
    '',
  ].join('\n');
  writeFileSync(join(BUNDLE_DIR, 'pnpm-workspace.yaml'), bundleWorkspaceYaml);

  // NOTE: We intentionally do NOT copy the monorepo's pnpm-lock.yaml.
  // The bundle has a different root package.json (only worker external deps)
  // and a different workspace structure, so the monorepo lockfile will never
  // match and causes ERR_PNPM_OUTDATED_LOCKFILE on the worker.

  // --- Generate root package.json (only external deps needed by worker) ---
  // Collect all external dependencies from worker + packages
  const allExtDeps: Record<string, string> = {};
  const allPkgDirs = [workerSrc, ...packages.map(p => join(ROOT, 'packages', p))];

  for (const dir of allPkgDirs) {
    const pjPath = join(dir, 'package.json');
    if (!existsSync(pjPath)) continue;
    const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
    for (const [dep, ver] of Object.entries(pj.dependencies ?? {})) {
      if (typeof ver === 'string' && !ver.startsWith('workspace:')) {
        allExtDeps[dep] = ver as string;
      }
    }
  }

  const bundlePkg = {
    name: 'ai-engine-worker',
    version,
    private: true,
    packageManager: rootPkg.packageManager,
    scripts: {
      start: 'node apps/worker/dist/index.js',
    },
    dependencies: allExtDeps,
  };

  writeFileSync(
    join(BUNDLE_DIR, 'package.json'),
    JSON.stringify(bundlePkg, null, 2),
  );

  // --- Generate .npmrc (match monorepo settings) ---
  writeFileSync(join(BUNDLE_DIR, '.npmrc'), 'shamefully-hoist=true\n');

  // --- Pre-install dependencies into the bundle ---
  // This makes the bundle fully self-contained — workers don't need pnpm or
  // network access to install npm dependencies. The node_modules/ folder is
  // included in the tar.gz.
  console.log('Installing production dependencies into bundle...');
  try {
    execSync('pnpm install --prod --no-frozen-lockfile', {
      cwd: BUNDLE_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        // Don't download Chromium — workers that need it will have it installed separately
        PUPPETEER_SKIP_DOWNLOAD: '1',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
      },
    });
    console.log('  Dependencies installed successfully');
  } catch (err: any) {
    console.error('  WARNING: pnpm install failed, trying npm fallback...');
    try {
      execSync('npm install --production --no-package-lock', {
        cwd: BUNDLE_DIR,
        stdio: 'inherit',
        env: {
          ...process.env,
          PUPPETEER_SKIP_DOWNLOAD: '1',
          PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
        },
      });
      console.log('  Dependencies installed via npm fallback');
    } catch {
      console.error('  ERROR: Could not install dependencies. Bundle will require pnpm install on the worker.');
    }
  }

  // --- Create start-worker.sh entry point ---
  // Workers load config from ~/.ai-engine/worker.json (serverUrl, workerSecret)
  // and connect to the dashboard via WebSocket. No DB/Redis env vars needed.
  const startScript = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Load worker config and export as env vars
CONFIG_FILE="\${HOME}/.ai-engine/worker.json"
if [ -f "\$CONFIG_FILE" ]; then
  export SERVER_URL=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).serverUrl)")
  export WORKER_SECRET=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).workerSecret)")
  export WORKER_ID=\$(node -e "console.log(JSON.parse(require('fs').readFileSync('\$CONFIG_FILE','utf8')).workerId)")
fi

export NODE_ENV=production
exec node apps/worker/dist/index.js
`;

  writeFileSync(join(BUNDLE_DIR, 'start-worker.sh'), startScript, { mode: 0o755 });

  // --- Write version file ---
  writeFileSync(
    join(BUNDLE_DIR, 'VERSION'),
    `${version}\n${new Date().toISOString()}\n`,
  );

  // --- Create tar.gz ---
  console.log('Compressing bundle...');
  execSync(`tar -czf "${OUTPUT}" -C "${BUNDLE_DIR}" .`, { stdio: 'pipe' });

  // Clean up temp dir
  rmSync(BUNDLE_DIR, { recursive: true });

  const sizeBytes = readFileSync(OUTPUT).length;
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);

  console.log(`\n✅ Worker bundle created: worker-bundle.tar.gz (${sizeMB} MB)`);
  console.log(`   Version: ${version}`);
  console.log(`   Packages: ${packages.length}`);
  console.log(`   External deps: ${Object.keys(allExtDeps).length}`);
}

main();
