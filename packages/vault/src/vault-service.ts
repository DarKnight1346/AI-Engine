import { getDb } from '@ai-engine/db';
import { VaultCrypto } from './vault-crypto.js';
import type { VaultCredential, CredentialType, ApprovalMode, DecryptedCredential, VaultAction } from '@ai-engine/shared';

export class VaultService {
  constructor(private crypto: VaultCrypto) {}

  async createCredential(
    name: string, type: CredentialType, data: Record<string, unknown>,
    options: { createdBy?: string; urlPattern?: string; approvalMode?: ApprovalMode } = {}
  ): Promise<VaultCredential> {
    const { encrypted, iv, authTag } = this.crypto.encrypt(JSON.stringify(data));
    const approvalStatus = options.approvalMode === 'approve' ? 'pending' : 'approved';
    const db = getDb();
    const cred = await db.vaultCredential.create({
      data: {
        name, type, encryptedData: Uint8Array.from(encrypted), iv: Uint8Array.from(iv), authTag: Uint8Array.from(authTag),
        urlPattern: options.urlPattern, createdBy: options.createdBy ?? 'user',
        approvalStatus,
      },
    });
    await this.auditLog(cred.id, options.createdBy?.startsWith('agent:') ? options.createdBy : null, 'create');
    return this.mapCredential(cred);
  }

  async getCredential(name: string, agentId?: string): Promise<DecryptedCredential | null> {
    const db = getDb();
    const cred = await db.vaultCredential.findUnique({ where: { name } });
    if (!cred || cred.approvalStatus !== 'approved') {
      if (agentId) await this.auditLog(cred?.id ?? '', agentId, 'denied');
      return null;
    }
    if (agentId) {
      const hasAccess = await this.checkAccess(cred.id, agentId);
      if (!hasAccess) {
        await this.auditLog(cred.id, agentId, 'denied');
        return null;
      }
    }
    await this.auditLog(cred.id, agentId ?? null, 'read');
    const decrypted = this.crypto.decrypt(Buffer.from(cred.encryptedData), Buffer.from(cred.iv), Buffer.from(cred.authTag));
    return JSON.parse(decrypted);
  }

  async updateCredential(name: string, data: Record<string, unknown>, agentId?: string): Promise<VaultCredential> {
    const { encrypted, iv, authTag } = this.crypto.encrypt(JSON.stringify(data));
    const db = getDb();
    const cred = await db.vaultCredential.update({
      where: { name },
      data: { encryptedData: Uint8Array.from(encrypted), iv: Uint8Array.from(iv), authTag: Uint8Array.from(authTag) },
    });
    await this.auditLog(cred.id, agentId ?? null, 'update');
    return this.mapCredential(cred);
  }

  async listCredentials(agentId?: string): Promise<Array<{ name: string; type: string; createdBy: string }>> {
    const db = getDb();
    const creds = await db.vaultCredential.findMany({
      select: { name: true, type: true, createdBy: true },
    });
    return creds;
  }

  async approveCredential(id: string): Promise<void> {
    const db = getDb();
    await db.vaultCredential.update({ where: { id }, data: { approvalStatus: 'approved' } });
  }

  async rejectCredential(id: string): Promise<void> {
    const db = getDb();
    await db.vaultCredential.update({ where: { id }, data: { approvalStatus: 'rejected' } });
  }

  async grantAccess(credentialId: string, agentId: string, permissions = 'read'): Promise<void> {
    const db = getDb();
    await db.vaultAccessPolicy.create({ data: { credentialId, agentId, permissions } });
  }

  private async checkAccess(credentialId: string, agentId: string): Promise<boolean> {
    const db = getDb();
    const policy = await db.vaultAccessPolicy.findFirst({
      where: { credentialId, agentId },
    });
    return !!policy;
  }

  private async auditLog(credentialId: string, agentId: string | null, action: VaultAction): Promise<void> {
    const db = getDb();
    await db.vaultAuditLog.create({ data: { credentialId, agentId, action } }).catch(() => {});
  }

  private mapCredential(c: any): VaultCredential {
    return {
      id: c.id, name: c.name, type: c.type as CredentialType,
      encryptedData: c.encryptedData, iv: c.iv, authTag: c.authTag,
      urlPattern: c.urlPattern, createdBy: c.createdBy,
      approvalStatus: c.approvalStatus as any, createdAt: c.createdAt,
    };
  }
}
