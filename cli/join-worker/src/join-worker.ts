import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import os from 'os';
import { registerWorkerService } from './service-installer.js';

export async function joinWorker(): Promise<void> {
  console.log('\n🔗 AI Engine Worker Join\n');

  const args = process.argv.slice(2);
  let serverUrl = '';
  let token = '';
  let projectDir = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) serverUrl = args[i + 1];
    if (args[i] === '--token' && args[i + 1]) token = args[i + 1];
    if (args[i] === '--project-dir' && args[i + 1]) projectDir = args[i + 1];
  }

  if (!serverUrl || !token) {
    console.error('Usage: npx @ai-engine/join-worker --server <url> --token <jwt> [--project-dir <path>]');
    console.error('');
    console.error('Options:');
    console.error('  --server      URL of the AI Engine dashboard (required)');
    console.error('  --token       JWT join token from the dashboard (required)');
    console.error('  --project-dir Path to the ai-engine project root (defaults to cwd)');
    process.exit(1);
  }

  // Resolve project directory
  projectDir = resolve(projectDir || process.cwd());

  console.log(`Server:      ${serverUrl}`);
  console.log(`Project dir: ${projectDir}`);
  console.log('Registering worker with the dashboard...');

  // Register this worker with the dashboard hub
  // The dashboard returns a worker ID and a JWT that the worker will use
  // to authenticate its WebSocket connection. No DB/Redis URLs needed.
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/hub/register-worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      hostname: os.hostname(),
      os: os.platform(),
      capabilities: {
        os: os.platform(),
        hasDisplay: os.platform() === 'darwin',
        browserCapable: os.platform() === 'darwin',
        environment: process.env.ENVIRONMENT ?? 'local',
        customTags: [],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Registration failed: ${error}`);
  }

  const result = await response.json() as {
    workerId: string;
    token: string;
  };

  // Detect environment
  const platform = os.platform();
  const environment = process.env.ENVIRONMENT ?? 'local';

  const workerConfig = {
    workerId: result.workerId,
    workerSecret: result.token,
    serverUrl,
    environment,
    customTags: [],
  };

  // Save config
  const configDir = join(os.homedir(), '.ai-engine');
  await mkdir(configDir, { recursive: true });
  const configPath = join(configDir, 'worker.json');
  await writeFile(configPath, JSON.stringify(workerConfig, null, 2), { mode: 0o600 });

  console.log(`\n✅ Worker registered successfully!`);
  console.log(`   Worker ID: ${result.workerId}`);
  console.log(`   Config saved to: ${configPath}`);
  console.log(`   OS: ${platform}`);
  console.log(`   Browser capable: ${platform === 'darwin'}`);

  // Register as a system service (auto-start on boot)
  await registerWorkerService({
    projectDir,
    workerId: result.workerId,
    envVars: {
      SERVER_URL: serverUrl,
      WORKER_TOKEN: result.token,
      WORKER_ID: result.workerId,
      NODE_ENV: 'production',
    },
  });

  console.log(`
✅ Worker setup complete!

The worker connects to the dashboard via WebSocket at:
  ${serverUrl}/ws/worker

No direct database or Redis access is required.

The worker has been registered as a system service and will:
  • Start automatically on boot
  • Restart automatically if it crashes
  • Reconnect automatically if the dashboard restarts
  • Begin accepting tasks immediately

To check status:
  • Linux:  sudo systemctl status ai-engine-worker
  • macOS:  sudo launchctl list | grep ai-engine
`);
}
