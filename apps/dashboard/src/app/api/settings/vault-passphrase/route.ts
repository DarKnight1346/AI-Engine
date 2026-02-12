import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/** POST /api/settings/vault-passphrase — Change the vault master passphrase */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { currentPassphrase, newPassphrase, isInitialSetup } = body as {
      currentPassphrase: string; newPassphrase: string; isInitialSetup?: boolean;
    };

    if (!newPassphrase) {
      return NextResponse.json({ error: 'newPassphrase is required' }, { status: 400 });
    }

    // During initial setup, currentPassphrase is not required
    if (!isInitialSetup && !currentPassphrase) {
      return NextResponse.json({ error: 'currentPassphrase is required' }, { status: 400 });
    }

    if (newPassphrase.length < 8) {
      return NextResponse.json({ error: 'Passphrase must be at least 8 characters' }, { status: 400 });
    }

    // Verify current passphrase against stored hash in config (skip during initial setup)
    const config = await db.config.findUnique({ where: { key: 'vaultPassphraseHash' } });
    if (config && !isInitialSetup) {
      const crypto = await import('crypto');
      const storedHash = config.valueJson as string;
      const currentHash = crypto.createHash('sha256').update(currentPassphrase).digest('hex');
      if (currentHash !== storedHash) {
        return NextResponse.json({ error: 'Current passphrase is incorrect' }, { status: 400 });
      }
    }

    // Store new passphrase hash
    const crypto = await import('crypto');
    const newHash = crypto.createHash('sha256').update(newPassphrase).digest('hex');

    await db.config.upsert({
      where: { key: 'vaultPassphraseHash' },
      update: { valueJson: newHash, version: { increment: 1 } },
      create: { key: 'vaultPassphraseHash', valueJson: newHash },
    });

    // In a production implementation, this would re-encrypt all vault credentials
    // with the new derived key. For now, we update the passphrase hash.

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
