import { NextRequest, NextResponse } from 'next/server';
import { SshKeyService } from '@ai-engine/agent-runtime';

export const dynamic = 'force-dynamic';

/**
 * GET /api/keys — Retrieve the SSH public key info.
 * Returns the public key, fingerprint, and whether keys exist.
 * The private key is NEVER returned via the API.
 */
export async function GET() {
  try {
    const sshKeyService = SshKeyService.getInstance();
    const info = await sshKeyService.getPublicKeyInfo();
    return NextResponse.json(info);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/keys — Generate a new SSH key pair.
 * If keys already exist, this will overwrite them (requires confirmation).
 */
export async function POST(request: NextRequest) {
  try {
    const sshKeyService = SshKeyService.getInstance();
    const body = await request.json().catch(() => ({}));

    const keyExists = await sshKeyService.exists();
    if (keyExists && !body.overwrite) {
      return NextResponse.json(
        {
          error: 'SSH key pair already exists. Set overwrite: true to regenerate.',
          exists: true,
        },
        { status: 409 },
      );
    }

    const keyPair = await sshKeyService.generateKeyPair();

    // Notify workers to pick up the new key via Redis → WorkerHub
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      await redis.publish('keys:resync', JSON.stringify({ fingerprint: keyPair.fingerprint }));
      await redis.quit();
    } catch (redisError) {
      console.error('[keys] Failed to publish keys:resync event:', redisError);
    }

    return NextResponse.json({
      success: true,
      publicKey: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
      algorithm: keyPair.algorithm,
      createdAt: keyPair.createdAt.toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/keys — Ensure keys exist (generate if missing, return existing).
 * Called during setup / first boot. Safe to call multiple times.
 */
export async function PUT() {
  try {
    const sshKeyService = SshKeyService.getInstance();
    const keyPair = await sshKeyService.ensureKeyPair();

    return NextResponse.json({
      success: true,
      publicKey: keyPair.publicKey,
      fingerprint: keyPair.fingerprint,
      algorithm: keyPair.algorithm,
      createdAt: keyPair.createdAt.toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
