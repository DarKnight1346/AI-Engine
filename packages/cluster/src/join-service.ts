import jwt from 'jsonwebtoken';
import { generateId } from '@ai-engine/shared';
import type { WorkerConfig } from '@ai-engine/shared';

export interface JoinTokenPayload {
  serverUrl: string;
  type: 'worker-join';
  iat: number;
  exp: number;
}

export class JoinService {
  constructor(private instanceSecret: string) {}

  generateJoinToken(serverUrl: string, expiresInSeconds = 3600): string {
    return jwt.sign(
      { serverUrl, type: 'worker-join' } satisfies Omit<JoinTokenPayload, 'iat' | 'exp'>,
      this.instanceSecret,
      { expiresIn: expiresInSeconds }
    );
  }

  validateJoinToken(token: string): JoinTokenPayload | null {
    try {
      const payload = jwt.verify(token, this.instanceSecret) as JoinTokenPayload;
      if (payload.type !== 'worker-join') return null;
      return payload;
    } catch {
      return null;
    }
  }

  provisionWorker(serverUrl: string, postgresUrl: string, redisUrl: string): WorkerConfig {
    return {
      workerId: generateId(),
      workerSecret: generateId() + generateId(),
      serverUrl,
      postgresUrl,
      redisUrl,
      environment: 'local',
      customTags: [],
    };
  }
}
