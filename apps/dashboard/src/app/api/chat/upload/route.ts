import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * Upload a file attachment for chat messages.
 *
 * When object storage is configured, files are uploaded there and a permanent
 * URL is returned. Otherwise, falls back to local filesystem storage.
 *
 * POST /api/chat/upload
 * Content-Type: multipart/form-data
 * Body: file (File), sessionId (string)
 *
 * Returns: { url, key, filename, mimeType, size }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sessionId = formData.get('sessionId') as string;

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mimeType = file.type || 'application/octet-stream';
    const effectiveSessionId = sessionId || 'general';

    // Try object storage first
    const db = getDb();
    try {
      const [osEndpoint, osBucket, osAccessKey, osSecretKey, osRegion] = await Promise.all([
        db.config.findUnique({ where: { key: 'objectStorageEndpoint' } }),
        db.config.findUnique({ where: { key: 'objectStorageBucket' } }),
        db.config.findUnique({ where: { key: 'objectStorageAccessKey' } }),
        db.config.findUnique({ where: { key: 'objectStorageSecretKey' } }),
        db.config.findUnique({ where: { key: 'objectStorageRegion' } }),
      ]);

      const endpoint = (osEndpoint?.valueJson as string)?.trim();
      const bucket = (osBucket?.valueJson as string)?.trim();
      const accessKey = (osAccessKey?.valueJson as string)?.trim();
      const secretKey = (osSecretKey?.valueJson as string)?.trim();
      const region = (osRegion?.valueJson as string)?.trim() || undefined;

      if (endpoint && bucket && accessKey && secretKey) {
        const { ObjectStorageService } = await import('@ai-engine/object-storage');
        const storage = new ObjectStorageService({ endpoint, bucket, accessKey, secretKey, region });
        const key = ObjectStorageService.artifactKey(effectiveSessionId, 'upload', file.name);
        const url = await storage.upload(key, buffer, mimeType);

        return NextResponse.json({
          url,
          key,
          filename: file.name,
          mimeType,
          size: file.size,
        });
      }
    } catch (err: any) {
      console.warn('[chat/upload] Object storage unavailable, falling back to local:', err.message);
    }

    // Fallback: local filesystem storage
    const uploadsDir = join(process.cwd(), 'uploads', 'chat', effectiveSessionId);
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}-${safeName}`;
    const filepath = join(uploadsDir, filename);
    await writeFile(filepath, buffer);

    const url = `/uploads/chat/${effectiveSessionId}/${filename}`;

    return NextResponse.json({
      url,
      key: null,
      filename: file.name,
      mimeType,
      size: file.size,
    });
  } catch (err: any) {
    console.error('[chat/upload] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
