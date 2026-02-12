import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import argon2 from 'argon2';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class VaultCrypto {
  private masterKey: Buffer | null = null;

  async deriveKey(passphrase: string, salt?: Buffer): Promise<{ key: Buffer; salt: Buffer }> {
    const useSalt = salt ?? randomBytes(32);
    const hash = await argon2.hash(passphrase, {
      salt: useSalt,
      memoryCost: DEFAULT_CONFIG.vault.argon2MemoryCost,
      timeCost: DEFAULT_CONFIG.vault.argon2TimeCost,
      parallelism: DEFAULT_CONFIG.vault.argon2Parallelism,
      type: argon2.argon2id,
      hashLength: 32,
      raw: true,
    });
    return { key: Buffer.from(hash), salt: useSalt };
  }

  setMasterKey(key: Buffer): void {
    this.masterKey = key;
  }

  encrypt(plaintext: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
    if (!this.masterKey) throw new Error('Master key not set. Call deriveKey first.');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  decrypt(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
    if (!this.masterKey) throw new Error('Master key not set.');
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }
}
