import { writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardServiceOptions {
  projectDir: string;
  envFilePath: string;
  port: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers the AI Engine Dashboard as a system service that starts on boot
 * and restarts on failure.
 *
 * Both Linux (systemd) and macOS (launchd) services use a wrapper shell script
 * that sources the `.env` file before starting Node. This means the setup
 * wizard can update `.env` at any time and a simple service restart will pick
 * up the new values — no need to re-register the service.
 */
export async function registerDashboardService(opts: DashboardServiceOptions): Promise<void> {
  const platform = os.platform();

  console.log('\n⚙️  Registering dashboard as a system service...\n');

  try {
    if (platform === 'linux') {
      await registerSystemd(opts);
    } else if (platform === 'darwin') {
      await registerLaunchDaemon(opts);
    } else if (platform === 'win32') {
      printWindowsInstructions(opts);
    } else {
      console.warn(`⚠️  Unsupported platform "${platform}". Skipping service registration.`);
      console.warn('   You will need to manually ensure the dashboard starts on boot.');
    }
  } catch (err: any) {
    console.error(`\n⚠️  Service registration failed: ${err.message}`);
    console.error('   The dashboard was configured successfully, but you will need to');
    console.error('   manually register it as a system service. See README.md for details.');
  }
}

// ---------------------------------------------------------------------------
// Wrapper script — shared by both platforms
// ---------------------------------------------------------------------------

function buildWrapperScript(opts: DashboardServiceOptions, nodePath: string): string {
  // Derive the directory containing node/npm/npx so child processes can find them
  const nodeBinDir = nodePath.substring(0, nodePath.lastIndexOf('/'));

  return `#!/usr/bin/env bash
# AI Engine Dashboard startup wrapper
# Sources .env so that config changes take effect on restart.

set -e

cd "${opts.projectDir}"

# Ensure Node.js tools (node, npm, npx) and project binaries are on PATH.
# systemd services start with a minimal PATH that may not include these.
export PATH="${nodeBinDir}:${opts.projectDir}/node_modules/.bin:\$PATH"

# Load environment variables from .env
if [ -f "${opts.envFilePath}" ]; then
  set -a
  source "${opts.envFilePath}"
  set +a
fi

exec "${nodePath}" apps/dashboard/server.js
`;
}

// ---------------------------------------------------------------------------
// Linux — systemd
// ---------------------------------------------------------------------------

async function registerSystemd(opts: DashboardServiceOptions): Promise<void> {
  const user = os.userInfo().username;
  const serviceName = 'ai-engine-dashboard';
  const unitPath = `/etc/systemd/system/${serviceName}.service`;
  const wrapperPath = join(opts.projectDir, 'start-dashboard.sh');

  // Build the new wrapper script content
  const nodePath = detectNodePath();
  const newWrapperContent = buildWrapperScript(opts, nodePath);

  // Build the new unit file content
  const newUnitContent = `[Unit]
Description=AI Engine Dashboard
After=network-online.target postgresql.service redis-server.service
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
SyslogIdentifier=ai-engine-dashboard

[Install]
WantedBy=multi-user.target
`;

  // Detect whether anything changed
  const existingUnit = readFileSafe(unitPath);
  const existingWrapper = readFileSafe(wrapperPath);
  const unitChanged = existingUnit !== newUnitContent;
  const wrapperChanged = existingWrapper !== newWrapperContent;
  const serviceExists = existingUnit !== null;
  const changed = unitChanged || wrapperChanged;

  if (!changed && serviceExists) {
    // Nothing changed — just make sure the service is running
    console.log('   No service configuration changes detected.');
    tryExec(`sudo systemctl restart ${serviceName}`);
    console.log(`✅ systemd service "${serviceName}" restarted (no config changes)`);
    console.log(`   Status:    sudo systemctl status ${serviceName}`);
    console.log(`   Logs:      journalctl -u ${serviceName} -f`);
    return;
  }

  // Something changed or fresh install — tear down the old service first
  if (serviceExists) {
    console.log('   Service configuration changed. Removing old service...');
    tryExecSafe(`sudo systemctl stop ${serviceName}`);
    tryExecSafe(`sudo systemctl disable ${serviceName}`);
    tryExecSafe(`sudo rm -f "${unitPath}"`);
    tryExec('sudo systemctl daemon-reload');
    // Reset any failure counters from the old service
    tryExecSafe(`sudo systemctl reset-failed ${serviceName}`);
  }

  // Write new wrapper script
  await writeFile(wrapperPath, newWrapperContent, { mode: 0o755 });

  // Write new unit file
  const tmpPath = join(os.tmpdir(), `${serviceName}.service`);
  await writeFile(tmpPath, newUnitContent);
  tryExec(`sudo cp "${tmpPath}" "${unitPath}"`);

  // Enable and start
  tryExec('sudo systemctl daemon-reload');
  tryExec(`sudo systemctl enable ${serviceName}`);
  tryExec(`sudo systemctl start ${serviceName}`);

  console.log(`✅ systemd service "${serviceName}" ${serviceExists ? 'recreated' : 'created'} and enabled`);
  console.log(`   Unit file: ${unitPath}`);
  console.log(`   Wrapper:   ${wrapperPath}`);
  console.log(`   Status:    sudo systemctl status ${serviceName}`);
  console.log(`   Logs:      journalctl -u ${serviceName} -f`);
}

// ---------------------------------------------------------------------------
// macOS — launchd (LaunchDaemon)
// ---------------------------------------------------------------------------

async function registerLaunchDaemon(opts: DashboardServiceOptions): Promise<void> {
  const user = os.userInfo().username;
  const label = 'com.ai-engine.dashboard';
  const logDir = '/usr/local/var/log/ai-engine';
  const plistPath = `/Library/LaunchDaemons/${label}.plist`;
  const wrapperPath = join(opts.projectDir, 'start-dashboard.sh');

  // Ensure log directory exists
  tryExec(`sudo mkdir -p "${logDir}"`);
  tryExec(`sudo chown ${user} "${logDir}"`);

  // Build the new wrapper script content
  const nodePath = detectNodePath();
  const newWrapperContent = buildWrapperScript(opts, nodePath);

  // The plist runs the wrapper script, which sources .env at startup.
  // This means updating .env + restarting the daemon picks up new values
  // without needing to re-register the plist.
  const newPlistContent = `<?xml version="1.0" encoding="UTF-8"?>
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
    <string>${logDir}/dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/dashboard.err</string>
</dict>
</plist>
`;

  // Detect whether anything changed
  const existingPlist = readFileSafe(plistPath);
  const existingWrapper = readFileSafe(wrapperPath);
  const plistChanged = existingPlist !== newPlistContent;
  const wrapperChanged = existingWrapper !== newWrapperContent;
  const serviceExists = existingPlist !== null;
  const changed = plistChanged || wrapperChanged;

  if (!changed && serviceExists) {
    // Nothing changed — just restart the daemon
    console.log('   No service configuration changes detected.');
    tryExecSafe(`sudo launchctl unload "${plistPath}"`);
    tryExec(`sudo launchctl load "${plistPath}"`);
    console.log(`✅ LaunchDaemon "${label}" restarted (no config changes)`);
    console.log(`   Logs:    ${logDir}/dashboard.log`);
    console.log(`   Errors:  ${logDir}/dashboard.err`);
    return;
  }

  // Something changed or fresh install — tear down the old service first
  if (serviceExists) {
    console.log('   Service configuration changed. Removing old daemon...');
    tryExecSafe(`sudo launchctl unload "${plistPath}"`);
    tryExecSafe(`sudo rm -f "${plistPath}"`);
  }

  // Write new wrapper script
  await writeFile(wrapperPath, newWrapperContent, { mode: 0o755 });

  // Write new plist
  const tmpPath = join(os.tmpdir(), `${label}.plist`);
  await writeFile(tmpPath, newPlistContent);
  tryExec(`sudo cp "${tmpPath}" "${plistPath}"`);
  tryExec(`sudo chown root:wheel "${plistPath}"`);
  tryExec(`sudo chmod 644 "${plistPath}"`);
  tryExec(`sudo launchctl load "${plistPath}"`);

  console.log(`✅ LaunchDaemon "${label}" ${serviceExists ? 'recreated' : 'created'} and loaded`);
  console.log(`   Plist:   ${plistPath}`);
  console.log(`   Wrapper: ${wrapperPath}`);
  console.log(`   Logs:    ${logDir}/dashboard.log`);
  console.log(`   Errors:  ${logDir}/dashboard.err`);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function printWindowsInstructions(opts: DashboardServiceOptions): void {
  const nodePath = detectNodePath();

  console.log('ℹ️  Windows detected. Auto-registration is not supported.');
  console.log('');
  console.log('   To run the dashboard as a Windows service, use NSSM:');
  console.log('   1. Download NSSM from https://nssm.cc/download');
  console.log('   2. Run (as Administrator):');
  console.log(`      nssm install ai-engine-dashboard "${nodePath}" apps\\dashboard\\server.js`);
  console.log(`      nssm set ai-engine-dashboard AppDirectory "${opts.projectDir}"`);
  console.log('      nssm start ai-engine-dashboard');
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

/** Like tryExec but ignores failures (for best-effort cleanup). */
function tryExecSafe(cmd: string): void {
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch {
    // Intentionally ignored — used for cleanup of possibly-missing resources
  }
}

/** Read a file as UTF-8, returning null if it doesn't exist. */
function readFileSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
