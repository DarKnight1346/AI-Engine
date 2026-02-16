import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ObjectStorageConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  /** If true, uploaded objects get public-read ACL. Defaults to true. */
  publicRead?: boolean;
}

export class ObjectStorageService {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;
  private publicRead: boolean;

  constructor(private config: ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.publicRead = config.publicRead ?? true;

    this.client = new S3Client({
      endpoint: this.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    });
  }

  /**
   * Upload a buffer or readable stream to object storage.
   * Returns the public URL of the uploaded object.
   */
  async upload(key: string, data: Buffer | Uint8Array, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ...(this.publicRead ? { ACL: 'public-read' } : {}),
      }),
    );
    return this.getPublicUrl(key);
  }

  /**
   * Fetch a remote URL and re-upload its contents to object storage.
   * Returns the public URL of the uploaded object.
   */
  async uploadFromUrl(sourceUrl: string, key: string, contentType?: string): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mime = contentType || response.headers.get('content-type') || 'application/octet-stream';
    return this.upload(key, buffer, mime);
  }

  /**
   * Decode a base64 string and upload to object storage.
   * Returns the public URL of the uploaded object.
   */
  async uploadFromBase64(base64: string, key: string, contentType: string): Promise<string> {
    const buffer = Buffer.from(base64, 'base64');
    return this.upload(key, buffer, contentType);
  }

  /**
   * Generate a pre-signed GET URL for temporary access.
   * Defaults to 1 hour expiry.
   */
  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Delete an object from storage.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * Check if an object exists.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the public URL for a given key.
   */
  getPublicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${key}`;
  }

  /**
   * Extract the storage key from a public URL produced by this service.
   * Returns null if the URL doesn't match.
   */
  extractKey(url: string): string | null {
    const prefix = `${this.endpoint}/${this.bucket}/`;
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
    return null;
  }

  /**
   * Generate a unique storage key for an artifact.
   */
  static artifactKey(
    sessionId: string,
    type: 'screenshot' | 'image' | 'video' | 'upload' | 'attachment',
    filename: string,
  ): string {
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `artifacts/${sessionId}/${timestamp}-${type}-${uuid}-${safeName}`;
  }

  /**
   * Generate a unique storage key for a project attachment.
   */
  static projectAttachmentKey(projectId: string, filename: string): string {
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `projects/${projectId}/attachments/${timestamp}-${uuid}-${safeName}`;
  }
}
