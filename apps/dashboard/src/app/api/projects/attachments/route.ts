import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * Helper to get an ObjectStorageService instance from DB config.
 * Returns null if object storage is not configured.
 */
async function getObjectStorage() {
  try {
    const db = getDb();
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
      return new ObjectStorageService({ endpoint, bucket, accessKey, secretKey, region });
    }
  } catch { /* Object storage not configured */ }
  return null;
}

/**
 * Upload attachments for planning mode
 * Supports images, PDFs, and documents
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const formData = await request.formData();
    const projectId = formData.get('projectId') as string;
    const file = formData.get('file') as File;

    if (!projectId || !file) {
      return NextResponse.json({ error: 'projectId and file are required' }, { status: 400 });
    }

    // Validate project exists
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Determine attachment type
    const mimeType = file.type;
    let attachmentType = 'other';
    if (mimeType.startsWith('image/')) {
      attachmentType = 'image';
    } else if (mimeType === 'application/pdf') {
      attachmentType = 'pdf';
    } else if (
      mimeType.includes('document') ||
      mimeType.includes('text') ||
      mimeType.includes('markdown')
    ) {
      attachmentType = 'document';
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Try object storage first, fall back to local filesystem
    let storageUrl: string;
    const storage = await getObjectStorage();

    if (storage) {
      const { ObjectStorageService } = await import('@ai-engine/object-storage');
      const key = ObjectStorageService.projectAttachmentKey(projectId, file.name);
      storageUrl = await storage.upload(key, buffer, mimeType);
    } else {
      // Fallback: local filesystem
      const uploadsDir = join(process.cwd(), 'uploads', 'projects', projectId);
      if (!existsSync(uploadsDir)) {
        await mkdir(uploadsDir, { recursive: true });
      }
      const filename = `${Date.now()}-${file.name}`;
      const filepath = join(uploadsDir, filename);
      storageUrl = `/uploads/projects/${projectId}/${filename}`;
      await writeFile(filepath, buffer);
    }

    // Analyze if it's an image or PDF
    let analysis: Record<string, unknown> | null = null;
    if (attachmentType === 'image' && !storage) {
      // Only store base64 in analysis when using local storage (no object storage)
      const base64 = buffer.toString('base64');
      analysis = {
        base64Data: base64,
        width: null,
        height: null,
        analyzed: false,
      };
    } else if (attachmentType === 'pdf') {
      analysis = {
        textExtracted: false,
        pageCount: null,
      };
    }

    // Save to database
    const attachment = await db.projectAttachment.create({
      data: {
        projectId,
        filename: file.name,
        mimeType,
        fileSize: BigInt(file.size),
        storageUrl,
        attachmentType,
        ...(analysis != null ? { analysis } : {}),
      },
    });

    return NextResponse.json({
      attachment: {
        id: attachment.id,
        projectId: attachment.projectId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        fileSize: Number(attachment.fileSize),
        storageUrl: attachment.storageUrl,
        attachmentType: attachment.attachmentType,
        analysis: attachment.analysis,
        uploadedAt: attachment.uploadedAt.toISOString(),
      },
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Get attachments for a project
 */
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const projectId = request.nextUrl.searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const attachments = await db.projectAttachment.findMany({
      where: { projectId },
      orderBy: { uploadedAt: 'desc' },
    });

    return NextResponse.json({
      attachments: attachments.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        filename: a.filename,
        mimeType: a.mimeType,
        fileSize: Number(a.fileSize),
        storageUrl: a.storageUrl,
        attachmentType: a.attachmentType,
        analysis: a.analysis,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ attachments: [], error: err.message }, { status: 500 });
  }
}
