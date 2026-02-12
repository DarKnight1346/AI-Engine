import type Redis from 'ioredis';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getDb } from '@ai-engine/db';

export class FileTransfer {
  constructor(
    private redis: Redis,
    private nodeId: string,
    private cacheDir: string
  ) {}

  async requestFile(filePath: string, fromNodeId: string): Promise<string> {
    const requestId = crypto.randomUUID();

    await this.redis.publish('file:request', JSON.stringify({
      requestId, filePath, sourceNodeId: fromNodeId, targetNodeId: this.nodeId,
      timestamp: new Date().toISOString(),
    }));

    // Wait for response
    const responseKey = `ai-engine:file-response:${requestId}`;
    const maxWaitMs = 30000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const data = await this.redis.get(responseKey);
      if (data) {
        const localPath = `${this.cacheDir}/${filePath.replace(/[/\\]/g, '_')}`;
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, Buffer.from(data, 'base64'));
        await this.redis.del(responseKey);
        return localPath;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`File transfer timed out: ${filePath} from ${fromNodeId}`);
  }

  async handleFileRequest(filePath: string, requestId: string): Promise<void> {
    try {
      const content = await readFile(filePath);
      const responseKey = `ai-engine:file-response:${requestId}`;
      await this.redis.set(responseKey, content.toString('base64'), 'EX', 120);

      const db = getDb();
      await db.fileTransferLog.create({
        data: { sourceNode: this.nodeId, targetNode: 'requester', filePath, sizeBytes: content.length, durationMs: 0 },
      });
    } catch (err: any) {
      console.error(`[file-sync] Failed to handle file request: ${err.message}`);
    }
  }

  listenForRequests(): void {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe('file:request');
    subscriber.on('message', async (_channel, message) => {
      try {
        const request = JSON.parse(message);
        if (request.sourceNodeId === this.nodeId) {
          await this.handleFileRequest(request.filePath, request.requestId);
        }
      } catch (err: any) {
        console.error('[file-sync] Error processing file request:', err.message);
      }
    });
  }
}
