/**
 * SshKeyService — manages SSH key pair generation, storage, and retrieval.
 *
 * The key pair is used for Git authentication across the dashboard and all
 * worker nodes. Keys are generated once (on first access or explicit init)
 * and stored at ~/.ai-engine/keys/. The public key is exposed in the
 * Settings UI so users can add it to GitHub/GitLab as a deploy key.
 *
 * Workers receive the key pair over WebSocket when they authenticate,
 * ensuring consistent Git access without per-node SSH setup.
 */

import { createHash } from 'crypto';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, access, constants, rm } from 'fs/promises';
import { join } from 'path';
import { homedir, hostname, tmpdir } from 'os';
import type { SshKeyPair, SshKeyInfo } from '@ai-engine/shared';

const execFile = promisify(execFileCb);

const KEYS_DIR = join(homedir(), '.ai-engine', 'keys');
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'id_ed25519');
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'id_ed25519.pub');
const META_PATH = join(KEYS_DIR, 'key-meta.json');

export class SshKeyService {
  private static instance: SshKeyService;
  private cachedKeyPair: SshKeyPair | null = null;

  static getInstance(): SshKeyService {
    if (!SshKeyService.instance) {
      SshKeyService.instance = new SshKeyService();
    }
    return SshKeyService.instance;
  }

  /**
   * Check if a key pair already exists on disk.
   */
  async exists(): Promise<boolean> {
    try {
      await access(PRIVATE_KEY_PATH, constants.R_OK);
      await access(PUBLIC_KEY_PATH, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a key pair exists and is in valid OpenSSH format.
   * Generates a new one if missing or in an incompatible format (e.g. PKCS8 PEM).
   * All code paths that need a key pair should go through this method.
   */
  async ensureKeyPair(): Promise<SshKeyPair> {
    // Validate cached key is in OpenSSH format (not stale PKCS8)
    if (this.cachedKeyPair) {
      if (this.cachedKeyPair.privateKey.includes('OPENSSH PRIVATE KEY')) {
        return this.cachedKeyPair;
      }
      // Cached key is in wrong format — clear and regenerate
      console.warn('[ssh-keys] Cached private key is not in OpenSSH format — regenerating');
      this.cachedKeyPair = null;
      return this.generateKeyPair();
    }

    if (await this.exists()) {
      // Validate the private key on disk is in OpenSSH format (not PKCS8 PEM)
      const privateKeyContent = await readFile(PRIVATE_KEY_PATH, 'utf-8');
      if (!privateKeyContent.includes('OPENSSH PRIVATE KEY')) {
        console.warn('[ssh-keys] Existing private key is not in OpenSSH format — regenerating');
        return this.generateKeyPair();
      }
      return this.loadKeyPair();
    }

    return this.generateKeyPair();
  }

  /**
   * Generate a new Ed25519 SSH key pair using ssh-keygen.
   * This produces keys in native OpenSSH format, which is the only format
   * that OpenSSH supports for Ed25519 keys. Overwrites any existing key pair.
   */
  async generateKeyPair(): Promise<SshKeyPair> {
    await mkdir(KEYS_DIR, { recursive: true });

    // Generate using ssh-keygen for guaranteed OpenSSH-compatible format.
    // Use a temp path to avoid partial writes to the real key files.
    const tempKeyPath = join(tmpdir(), `ai-engine-keygen-${Date.now()}`);
    const comment = `ai-engine@${hostname()}`;

    try {
      await execFile('ssh-keygen', [
        '-t', 'ed25519',
        '-f', tempKeyPath,
        '-N', '',        // no passphrase
        '-C', comment,   // comment
        '-q',            // quiet
      ], { timeout: 15_000 });

      const sshPrivateKey = await readFile(tempKeyPath, 'utf-8');
      const sshPublicKey = (await readFile(`${tempKeyPath}.pub`, 'utf-8')).trim();

      // Write to final locations
      await writeFile(PRIVATE_KEY_PATH, sshPrivateKey, { mode: 0o600 });
      await writeFile(PUBLIC_KEY_PATH, sshPublicKey + '\n', { mode: 0o644 });

      const fingerprint = this.computeFingerprintFromSshPubKey(sshPublicKey);

      // Write metadata
      const meta = {
        algorithm: 'ed25519',
        fingerprint,
        createdAt: new Date().toISOString(),
      };
      await writeFile(META_PATH, JSON.stringify(meta, null, 2), { mode: 0o644 });

      const keyPair: SshKeyPair = {
        publicKey: sshPublicKey,
        privateKey: sshPrivateKey,
        fingerprint,
        algorithm: 'ed25519',
        createdAt: new Date(),
      };

      this.cachedKeyPair = keyPair;
      console.log(`[ssh-keys] Generated new Ed25519 key pair (fingerprint: ${fingerprint})`);
      return keyPair;
    } finally {
      // Clean up temp files
      await rm(tempKeyPath, { force: true }).catch(() => {});
      await rm(`${tempKeyPath}.pub`, { force: true }).catch(() => {});
    }
  }

  /**
   * Load existing key pair from disk.
   */
  async loadKeyPair(): Promise<SshKeyPair> {
    if (this.cachedKeyPair) return this.cachedKeyPair;

    const privateKey = await readFile(PRIVATE_KEY_PATH, 'utf-8');
    const publicKey = (await readFile(PUBLIC_KEY_PATH, 'utf-8')).trim();

    let meta: { algorithm: string; fingerprint: string; createdAt: string };
    try {
      meta = JSON.parse(await readFile(META_PATH, 'utf-8'));
    } catch {
      // Reconstruct metadata if missing
      const fingerprint = this.computeFingerprintFromSshPubKey(publicKey);
      meta = {
        algorithm: 'ed25519',
        fingerprint,
        createdAt: new Date().toISOString(),
      };
    }

    const keyPair: SshKeyPair = {
      publicKey,
      privateKey,
      fingerprint: meta.fingerprint,
      algorithm: meta.algorithm as 'ed25519' | 'rsa',
      createdAt: new Date(meta.createdAt),
    };

    this.cachedKeyPair = keyPair;
    return keyPair;
  }

  /**
   * Get public key info (safe for API responses, no private key).
   */
  async getPublicKeyInfo(): Promise<SshKeyInfo> {
    try {
      const keyPair = await this.ensureKeyPair();
      return {
        publicKey: keyPair.publicKey,
        fingerprint: keyPair.fingerprint,
        algorithm: keyPair.algorithm,
        createdAt: keyPair.createdAt.toISOString(),
        exists: true,
      };
    } catch {
      return {
        publicKey: '',
        fingerprint: '',
        algorithm: '',
        createdAt: '',
        exists: false,
      };
    }
  }

  /**
   * Get the full key pair (including private key) for distribution to workers.
   * Ensures the key is in valid OpenSSH format before returning.
   * Only call this server-side, never expose the private key in API responses.
   */
  async getKeyPairForWorker(): Promise<{ publicKey: string; privateKey: string; fingerprint: string } | null> {
    try {
      const keyPair = await this.ensureKeyPair();
      return {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        fingerprint: keyPair.fingerprint,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the path to the private key file (for use with git commands).
   */
  getPrivateKeyPath(): string {
    return PRIVATE_KEY_PATH;
  }

  /**
   * Get the keys directory path.
   */
  getKeysDir(): string {
    return KEYS_DIR;
  }

  /**
   * Compute fingerprint from an OpenSSH-format public key string.
   */
  private computeFingerprintFromSshPubKey(sshPubKey: string): string {
    const parts = sshPubKey.split(' ');
    if (parts.length < 2) return 'unknown';
    const keyData = Buffer.from(parts[1], 'base64');
    const hash = createHash('sha256').update(keyData).digest('base64');
    return `SHA256:${hash.replace(/=+$/, '')}`;
  }
}
