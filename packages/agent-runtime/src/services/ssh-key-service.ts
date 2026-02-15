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

import { generateKeyPairSync, createHash } from 'crypto';
import { readFile, writeFile, mkdir, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { SshKeyPair, SshKeyInfo } from '@ai-engine/shared';

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
   * Ensure a key pair exists. Generates one if it doesn't.
   * This should be called during dashboard startup / setup.
   */
  async ensureKeyPair(): Promise<SshKeyPair> {
    if (this.cachedKeyPair) return this.cachedKeyPair;

    if (await this.exists()) {
      return this.loadKeyPair();
    }

    return this.generateKeyPair();
  }

  /**
   * Generate a new Ed25519 SSH key pair.
   * Overwrites any existing key pair.
   */
  async generateKeyPair(): Promise<SshKeyPair> {
    await mkdir(KEYS_DIR, { recursive: true });

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Convert PEM to OpenSSH format for the public key
    const sshPublicKey = this.pemToOpenSsh(publicKey);
    const fingerprint = this.computeFingerprint(publicKey);

    // Write private key (PEM format, used by Git/SSH)
    const sshPrivateKey = privateKey;
    await writeFile(PRIVATE_KEY_PATH, sshPrivateKey, { mode: 0o600 });

    // Write public key (OpenSSH format for adding to GitHub/GitLab)
    await writeFile(PUBLIC_KEY_PATH, sshPublicKey + '\n', { mode: 0o644 });

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
    const keyExists = await this.exists();
    if (!keyExists) {
      return {
        publicKey: '',
        fingerprint: '',
        algorithm: '',
        createdAt: '',
        exists: false,
      };
    }

    const keyPair = await this.loadKeyPair();
    return {
      publicKey: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
      algorithm: keyPair.algorithm,
      createdAt: keyPair.createdAt.toISOString(),
      exists: true,
    };
  }

  /**
   * Get the full key pair (including private key) for distribution to workers.
   * Only call this server-side, never expose the private key in API responses.
   */
  async getKeyPairForWorker(): Promise<{ publicKey: string; privateKey: string; fingerprint: string } | null> {
    if (!(await this.exists())) return null;
    const keyPair = await this.loadKeyPair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      fingerprint: keyPair.fingerprint,
    };
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
   * Convert PEM public key to OpenSSH format.
   * Format: ssh-ed25519 <base64-encoded-key> ai-engine@<hostname>
   */
  private pemToOpenSsh(pemPublicKey: string): string {
    // Extract the raw key bytes from the PEM-encoded SPKI structure
    const base64 = pemPublicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const derBuffer = Buffer.from(base64, 'base64');

    // For Ed25519 SPKI, the raw 32-byte public key starts at offset 12
    // (after the ASN.1 header: 30 2a 30 05 06 03 2b 65 70 03 21 00)
    const rawKey = derBuffer.subarray(12);

    // Build the OpenSSH key blob: string "ssh-ed25519" + string <raw-key>
    const keyType = 'ssh-ed25519';
    const keyTypeLen = Buffer.alloc(4);
    keyTypeLen.writeUInt32BE(keyType.length);

    const rawKeyLen = Buffer.alloc(4);
    rawKeyLen.writeUInt32BE(rawKey.length);

    const blob = Buffer.concat([keyTypeLen, Buffer.from(keyType), rawKeyLen, rawKey]);
    const hostname = require('os').hostname();
    return `ssh-ed25519 ${blob.toString('base64')} ai-engine@${hostname}`;
  }

  /**
   * Compute SHA-256 fingerprint from PEM public key.
   */
  private computeFingerprint(pemPublicKey: string): string {
    const base64 = pemPublicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const der = Buffer.from(base64, 'base64');
    const hash = createHash('sha256').update(der).digest('base64');
    return `SHA256:${hash.replace(/=+$/, '')}`;
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
