// bundle-worker.ts
//
// Creates a self-contained worker bundle (tar.gz) that can be served by the
// dashboard. Workers download this bundle to install or update — no git repo
// needed on the worker machine.
//
// The bundle contains:
//   - apps/worker/dist/            (compiled worker code)
//   - packages/<name>/dist/        (compiled workspace packages)
//   - packages/<name>/package.json (for workspace resolution)
//   - packages/db/prisma/          (Prisma schema + migrations)
//   - package.json                 (root — external dependencies)
//   - pnpm-workspace.yaml          (workspace config)
//   - pnpm-lock.yaml               (lockfile for reproducible installs)
//   - start-worker.sh              (entry point)
//
// Run: npx tsx scripts/bundle-worker.ts
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
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
  ];

  for (const pkg of packages) {
    const srcDir = join(ROOT, 'packages', pkg);
    const destDir = join(BUNDLE_DIR, 'packages', pkg);
    mkdirSync(destDir, { recursive: true });

    // Copy dist/
    const distSrc = join(srcDir, 'dist');
    if (existsSync(distSrc)) {
      cpSync(distSrc, join(destDir, 'dist'), { recursive: true });
    }

    // Copy package.json
    const pkgJsonSrc = join(srcDir, 'package.json');
    if (existsSync(pkgJsonSrc)) {
      cpSync(pkgJsonSrc, join(destDir, 'package.json'));
    }

    // Workers don't need Prisma/DB — skip prisma directory
  }

  // --- Copy worker app ---
  const workerSrc = join(ROOT, 'apps', 'worker');
  const workerDest = join(BUNDLE_DIR, 'apps', 'worker');
  mkdirSync(workerDest, { recursive: true });

  const workerDist = join(workerSrc, 'dist');
  if (!existsSync(workerDist)) {
    throw new Error(`Worker dist not found at ${workerDist}. Run "pnpm build" first.`);
  }
  cpSync(workerDist, join(workerDest, 'dist'), { recursive: true });
  cpSync(join(workerSrc, 'package.json'), join(workerDest, 'package.json'));
  if (existsSync(join(workerSrc, 'tsconfig.json'))) {
    cpSync(join(workerSrc, 'tsconfig.json'), join(workerDest, 'tsconfig.json'));
  }

  // --- Copy workspace config ---
  cpSync(join(ROOT, 'pnpm-workspace.yaml'), join(BUNDLE_DIR, 'pnpm-workspace.yaml'));

  if (existsSync(join(ROOT, 'pnpm-lock.yaml'))) {
    cpSync(join(ROOT, 'pnpm-lock.yaml'), join(BUNDLE_DIR, 'pnpm-lock.yaml'));
  }

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
