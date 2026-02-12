/**
 * cloudflared binary management.
 *
 * Finds `cloudflared` in PATH, or downloads the latest release from GitHub
 * to ~/.ai-engine/bin/ for the current platform.
 */

import { existsSync, mkdirSync, chmodSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import os from 'os';

const BIN_DIR = join(os.homedir(), '.ai-engine', 'bin');

function getBinaryName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function getDownloadInfo(): { url: string; isTgz: boolean } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';

  switch (process.platform) {
    case 'linux':
      return {
        url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`,
        isTgz: false,
      };
    case 'darwin':
      return {
        url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`,
        isTgz: true,
      };
    case 'win32':
      return {
        url: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe`,
        isTgz: false,
      };
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/**
 * Returns the path to the cloudflared binary, downloading it if necessary.
 */
export async function ensureCloudflared(): Promise<string> {
  // 1. Check if cloudflared is already in PATH
  try {
    const cmd = process.platform === 'win32'
      ? 'where cloudflared 2>nul'
      : 'which cloudflared 2>/dev/null';
    const result = execSync(cmd, { encoding: 'utf-8' }).trim();
    if (result) {
      const firstLine = result.split('\n')[0].trim();
      console.log('[tunnel] Found cloudflared in PATH:', firstLine);
      return firstLine;
    }
  } catch {
    // Not in PATH — continue to local check / download
  }

  // 2. Check our local bin directory
  const localPath = join(BIN_DIR, getBinaryName());
  if (existsSync(localPath)) {
    console.log('[tunnel] Using local cloudflared:', localPath);
    return localPath;
  }

  // 3. Download from GitHub releases
  console.log('[tunnel] cloudflared not found. Downloading latest release...');
  mkdirSync(BIN_DIR, { recursive: true });

  const { url, isTgz } = getDownloadInfo();

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download cloudflared: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (isTgz) {
    // macOS: download is a .tgz containing the binary
    const tempPath = join(BIN_DIR, 'cloudflared.tgz');
    await writeFile(tempPath, buffer);
    execSync(`tar -xzf "${tempPath}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
    await unlink(tempPath).catch(() => {});
  } else {
    // Linux / Windows: direct binary
    await writeFile(localPath, buffer);
  }

  // Make executable on Unix
  if (process.platform !== 'win32') {
    chmodSync(localPath, 0o755);
  }

  console.log('[tunnel] Downloaded cloudflared to', localPath);
  return localPath;
}
