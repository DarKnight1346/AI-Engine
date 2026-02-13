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
  webpack: (config, { isServer }) => {
    if (isServer) {
      // The instrumentation hook dynamically imports ioredis,
      // @ai-engine/scheduler, @ai-engine/llm, etc. which pull in Node
      // built-ins (stream, crypto, dns, net, path, os).  Mark these as
      // externals so webpack emits proper require() calls instead of
      // trying to resolve/bundle Node built-ins.
      //
      // We use a function-based external so scoped package names (with @)
      // are emitted as `require("@ai-engine/scheduler")` rather than the
      // broken `module.exports = @ai-engine/scheduler`.
      //
      // NOTE: @prisma/client is handled via serverComponentsExternalPackages.
      const serverOnlyPackages = new Set([
        'ioredis',
        '@ai-engine/scheduler',
        '@ai-engine/cluster',
        '@ai-engine/llm',
        '@ai-engine/shared',
      ]);
      config.externals = config.externals || [];
      config.externals.push(({ request }, callback) => {
        if (serverOnlyPackages.has(request)) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      });
    }
    return config;
  },
};

export default nextConfig;
