/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles all deps for deployment. Disabled on Windows
  // where symlink creation requires elevated privileges.
  ...(process.platform !== 'win32' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
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
};

export default nextConfig;
