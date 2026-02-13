import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles all deps for deployment. Disabled on Windows
  // where symlink creation requires elevated privileges.
  ...(process.platform !== 'win32' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    // Tell Next.js to keep Prisma external (not bundled by webpack).
    // Next.js resolves the real module path via its require-hook, so it
    // works correctly with pnpm's strict linking — unlike raw webpack
    // externals which emit bare `require()` calls.
    //
    // IMPORTANT: @prisma/client must also be a direct dependency of the
    // dashboard package.json so pnpm links it where Next.js can find it.
    serverComponentsExternalPackages: [
      '@prisma/client',
      '.prisma/client',
      'ioredis',
    ],
    // Point Next.js at the monorepo root so standalone output tracing can
    // find packages in the hoisted node_modules.
    outputFileTracingRoot: resolve(__dirname, '../../'),
  },
  transpilePackages: [
    '@ai-engine/shared',
    '@ai-engine/db',
    '@ai-engine/auth',
    '@ai-engine/cluster',
    '@ai-engine/llm',
    '@ai-engine/memory',
    '@ai-engine/workflow-engine',
    '@ai-engine/scheduler',
    '@ai-engine/skills',
    '@ai-engine/vault',
    '@ai-engine/planner',
  ],
  // NOTE: Do NOT add manual webpack externals for @prisma/client — that
  // emits bare require() calls that fail under pnpm's strict node_modules.
  // serverComponentsExternalPackages above handles it correctly.
};

export default nextConfig;
