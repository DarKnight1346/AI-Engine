import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const credentials = await db.vaultCredential.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { accessPolicies: true } },
        auditLog: {
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { action: true, timestamp: true },
        },
      },
    });

    return NextResponse.json({
      credentials: credentials.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        urlPattern: c.urlPattern,
        createdBy: c.createdBy,
        approvalStatus: c.approvalStatus,
        policyCount: c._count.accessPolicies,
        lastAccessed: c.auditLog[0]?.timestamp?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ credentials: [], error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    // Encryption is handled by the vault package at runtime.
    // For now we store a placeholder encrypted blob. The actual vault
    // service will be invoked when agents need to read credentials.
    const crypto = await import('crypto');
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(body.data ?? {}), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const credential = await db.vaultCredential.create({
      data: {
        name: body.name,
        type: body.type,
        encryptedData: Uint8Array.from(encrypted),
        iv: Uint8Array.from(iv),
        authTag: Uint8Array.from(authTag),
        urlPattern: body.urlPattern ?? null,
        createdBy: body.createdBy ?? 'admin',
      },
    });

    return NextResponse.json({
      credential: {
        id: credential.id,
        name: credential.name,
        type: credential.type,
        createdAt: credential.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
