import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkerServiceOptions {
  projectDir: string;
  workerId: string;
  envVars: {
    SERVER_URL: string;
    WORKER_TOKEN: string;
    WORKER_ID: string;
    NODE_ENV: string;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers the AI Engine Worker as a system service that starts on boot
 * and restarts on failure.
 *
 * Uses a wrapper script that reads `~/.ai-engine/worker.json` so configuration
 * changes are picked up on restart.
 */
export async function registerWorkerService(opts: WorkerServiceOptions): Promise<void> {
  const platform = os.platform();

  console.log('\n⚙️  Registering worker as a system service...\n');

  try {
    if (platform === 'linux') {
      await registerSystemd(opts);
    } else if (platform === 'darwin') {
      await registerLaunchDaemon(opts);
    } else if (platform === 'win32') {
      printWindowsInstructions(opts);
    } else {
      console.warn(`⚠️  Unsupported platform "${platform}". Skipping service registration.`);
    }
  } catch (err: any) {
    console.error(`\n⚠️  Service registration failed: ${err.message}`);
    console.error('   The worker joined successfully, but you will need to manually');
    console.error('   register it as a system service. See README.md for details.');
  }
}

// ---------------------------------------------------------------------------
// Wrapper script
// ---------------------------------------------------------------------------

async function createWrapperScript(opts: WorkerServiceOptions): Promise<string> {
  const nodePath = detectNodePath();
  const configDir = join(os.homedir(), '.ai-engine');
  await mkdir(configDir, { recursive: true });
  const scriptPath = join(configDir, 'start-worker.sh');

  const script = `#!/usr/bin/env bash
# AI Engine Worker startup wrapper
# Workers connect to the dashboard via WebSocket — no direct DB/Redis needed.

set -e

cd "${opts.projectDir}"

# Export env vars for the worker
export NODE_ENV="production"
export WORKER_ID="${opts.workerId}"
export SERVER_URL="${opts.envVars.SERVER_URL}"
export WORKER_SECRET="${opts.envVars.WORKER_TOKEN}"

exec "${nodePath}" apps/worker/dist/index.js
`;

  await writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

async function registerSystemd(opts: WorkerServiceOptions): Promise<void> {
  const user = os.userInfo().username;
  const serviceName = 'ai-engine-worker';
  const wrapperPath = await createWrapperScript(opts);

  const unitContent = `[Unit]
Description=AI Engine Worker (${opts.workerId})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${opts.projectDir}
ExecStart=/usr/bin/env bash "${wrapperPath}"
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-engine-worker

[Install]
WantedBy=multi-user.target
`;

  const unitPath = `/etc/systemd/system/${serviceName}.service`;
  const tmpPath = join(os.tmpdir(), `${serviceName}.service`);

  await writeFile(tmpPath, unitContent);

  tryExec(`sudo cp "${tmpPath}" "${unitPath}"`);
  tryExec('sudo systemctl daemon-reload');
  tryExec(`sudo systemctl enable ${serviceName}`);
  tryExec(`sudo systemctl start ${serviceName}`);

  console.log(`✅ systemd service "${serviceName}" created and enabled`);
  console.log(`   Unit file: ${unitPath}`);
  console.log(`   Wrapper:   ${wrapperPath}`);
  console.log(`   Status:    sudo systemctl status ${serviceName}`);
  console.log(`   Logs:      journalctl -u ${serviceName} -f`);
}

// ---------------------------------------------------------------------------
// macOS — launchd (LaunchDaemon)
// ---------------------------------------------------------------------------

async function registerLaunchDaemon(opts: WorkerServiceOptions): Promise<void> {
  const user = os.userInfo().username;
  const label = 'com.ai-engine.worker';
  const logDir = '/usr/local/var/log/ai-engine';
  const wrapperPath = await createWrapperScript(opts);

  tryExec(`sudo mkdir -p "${logDir}"`);
  tryExec(`sudo chown ${user} "${logDir}"`);

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${wrapperPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${opts.projectDir}</string>
    <key>UserName</key>
    <string>${user}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>${logDir}/worker.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/worker.err</string>
</dict>
</plist>
`;

  const plistPath = `/Library/LaunchDaemons/${label}.plist`;
  const tmpPath = join(os.tmpdir(), `${label}.plist`);

  await writeFile(tmpPath, plistContent);

  tryExec(`sudo launchctl unload "${plistPath}" 2>/dev/null`);
  tryExec(`sudo cp "${tmpPath}" "${plistPath}"`);
  tryExec(`sudo chown root:wheel "${plistPath}"`);
  tryExec(`sudo chmod 644 "${plistPath}"`);
  tryExec(`sudo launchctl load "${plistPath}"`);

  console.log(`✅ LaunchDaemon "${label}" created and loaded`);
  console.log(`   Plist:   ${plistPath}`);
  console.log(`   Wrapper: ${wrapperPath}`);
  console.log(`   Logs:    ${logDir}/worker.log`);
  console.log(`   Errors:  ${logDir}/worker.err`);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function printWindowsInstructions(opts: WorkerServiceOptions): void {
  const nodePath = detectNodePath();
  console.log('ℹ️  Windows detected. Auto-registration is not supported.');
  console.log('   Use NSSM (https://nssm.cc/) to register the worker as a service.');
  console.log(`   nssm install ai-engine-worker "${nodePath}" apps\\worker\\dist\\index.js`);
  console.log(`   nssm set ai-engine-worker AppDirectory "${opts.projectDir}"`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function detectNodePath(): string {
  try {
    const cmd = os.platform() === 'win32' ? 'where node' : 'which node';
    return execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    if (os.platform() === 'darwin') return '/usr/local/bin/node';
    if (os.platform() === 'win32') return 'C:\\Program Files\\nodejs\\node.exe';
    return '/usr/bin/node';
  }
}

function tryExec(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err: any) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr?.toString() ?? err.message}`);
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
