import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';

export async function joinWorker(): Promise<void> {
  console.log('\n🔗 AI Engine Worker Join\n');

  const args = process.argv.slice(2);
  let serverUrl = '';
  let token = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) serverUrl = args[i + 1];
    if (args[i] === '--token' && args[i + 1]) token = args[i + 1];
  }

  if (!serverUrl || !token) {
    console.error('Usage: npx @ai-engine/join-worker --server <url> --token <jwt>');
    process.exit(1);
  }

  console.log(`Server: ${serverUrl}`);
  console.log('Exchanging join token...');

  // Exchange token for credentials
  const response = await fetch(`${serverUrl}/api/cluster/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Join failed: ${error}`);
  }

  const config = await response.json() as {
    workerId: string;
    workerSecret: string;
    serverUrl: string;
    postgresUrl: string;
    redisUrl: string;
  };

  // Detect environment
  const platform = os.platform();
  const environment = process.env.ENVIRONMENT ?? 'local';

  const workerConfig = {
    ...config,
    environment,
    customTags: [],
  };

  // Save config
  const configDir = join(os.homedir(), '.ai-engine');
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, 'worker.json');
  await writeFile(configPath, JSON.stringify(workerConfig, null, 2), { mode: 0o600 });

  console.log(`\n✅ Worker joined successfully!`);
  console.log(`   Worker ID: ${config.workerId}`);
  console.log(`   Config saved to: ${configPath}`);
  console.log(`   OS: ${platform}`);
  console.log(`   Browser capable: ${platform === 'darwin'}`);
  console.log(`\nStart the worker with:`);
  console.log(`   cd <ai-engine-dir> && pnpm --filter @ai-engine/worker start`);
}
