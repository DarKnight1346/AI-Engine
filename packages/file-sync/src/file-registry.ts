import { getDb } from '@ai-engine/db';
import { createHash } from 'crypto';
import { readFile, stat, readdir } from 'fs/promises';
import { join } from 'path';
import type { NodeFile } from '@ai-engine/shared';

export class FileRegistry {
  constructor(private nodeId: string) {}

  async registerDirectory(dirPath: string): Promise<number> {
    const files = await this.walkDir(dirPath);
    const db = getDb();
    let count = 0;

    for (const filePath of files) {
      try {
        const fileStat = await stat(filePath);
        const content = await readFile(filePath);
        const hash = createHash('sha256').update(content).digest('hex');

        await db.nodeFile.upsert({
          where: { nodeId_filePath: { nodeId: this.nodeId, filePath } },
          create: { nodeId: this.nodeId, filePath, fileHash: hash, sizeBytes: fileStat.size, lastModified: fileStat.mtime },
          update: { fileHash: hash, sizeBytes: fileStat.size, lastModified: fileStat.mtime },
        });
        count++;
      } catch {
        // Skip files we can't read
      }
    }
    return count;
  }

  async getNodeFiles(nodeId?: string): Promise<NodeFile[]> {
    const db = getDb();
    const files = await db.nodeFile.findMany({ where: { nodeId: nodeId ?? this.nodeId } });
    return files.map((f) => ({
      id: f.id, nodeId: f.nodeId, filePath: f.filePath,
      fileHash: f.fileHash, sizeBytes: Number(f.sizeBytes), lastModified: f.lastModified,
    }));
  }

  async findFileNode(filePath: string): Promise<string | null> {
    const db = getDb();
    const file = await db.nodeFile.findFirst({ where: { filePath } });
    return file?.nodeId ?? null;
  }

  async getAffinityScore(nodeId: string, filePaths: string[]): Promise<number> {
    const db = getDb();
    const count = await db.nodeFile.count({
      where: { nodeId, filePath: { in: filePaths } },
    });
    return filePaths.length > 0 ? count / filePaths.length : 0;
  }

  private async walkDir(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        files.push(...await this.walkDir(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
}
