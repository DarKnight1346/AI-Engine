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
    // Tell Next.js server-side bundler to leave Prisma alone — it relies on
    // native binary engine files (.so.node / .dylib.node) that cannot be
    // inlined into a JS bundle.
    serverComponentsExternalPackages: ['@prisma/client', '.prisma/client'],
    // Point Next.js at the monorepo root so standalone output tracing can
    // find engine binaries in hoisted node_modules.
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
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Prevent webpack from trying to bundle the Prisma query engine binaries
      config.externals = config.externals || [];
      config.externals.push('@prisma/client');
      config.externals.push('.prisma/client');
    }
    return config;
  },
};

export default nextConfig;
