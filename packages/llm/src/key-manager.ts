import type { LoadBalanceStrategy } from '@ai-engine/shared';
import type { KeyState } from './pool.js';

interface InternalKeyState {
  id: string;
  requestCount: number;
  tokensUsed: number;
  errorCount: number;
  activeRequests: number;
  isHealthy: boolean;
  lastUsedAt: Date | null;
  rateLimitedUntil: Date | null;
}

export class KeyManager {
  private keys: Map<string, InternalKeyState> = new Map();
  private roundRobinIndex = 0;
  private strategy: LoadBalanceStrategy;

  constructor(keyIds: string[], strategy: LoadBalanceStrategy) {
    this.strategy = strategy;
    for (const id of keyIds) {
      this.keys.set(id, this.createState(id));
    }
  }

  getNextKey(): string | null {
    const available = this.getAvailableKeys();
    if (available.length === 0) return null;

    switch (this.strategy) {
      case 'round-robin': {
        this.roundRobinIndex = this.roundRobinIndex % available.length;
        const key = available[this.roundRobinIndex];
        this.roundRobinIndex++;
        return key.id;
      }
      case 'least-active': {
        available.sort((a, b) => a.activeRequests - b.activeRequests);
        return available[0].id;
      }
      case 'random': {
        const idx = Math.floor(Math.random() * available.length);
        return available[idx].id;
      }
      default:
        return available[0].id;
    }
  }

  recordSuccess(keyId: string, tokensUsed: number): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.requestCount++;
    state.tokensUsed += tokensUsed;
    state.lastUsedAt = new Date();
    state.activeRequests = Math.max(0, state.activeRequests - 1);
  }

  recordError(keyId: string): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.errorCount++;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    if (state.errorCount >= 5) {
      state.isHealthy = false;
      globalThis.setTimeout(() => {
        state.isHealthy = true;
        state.errorCount = 0;
      }, 60000);
    }
  }

  recordRateLimit(keyId: string, retryAfterMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.rateLimitedUntil = new Date(Date.now() + retryAfterMs);
    state.activeRequests = Math.max(0, state.activeRequests - 1);
  }

  addKey(id: string): void {
    this.keys.set(id, this.createState(id));
  }

  removeKey(id: string): void {
    this.keys.delete(id);
  }

  getStates(): KeyState[] {
    return Array.from(this.keys.values()).map((s) => ({
      id: s.id,
      requestCount: s.requestCount,
      tokensUsed: s.tokensUsed,
      errorCount: s.errorCount,
      isHealthy: s.isHealthy,
      lastUsedAt: s.lastUsedAt,
      rateLimitedUntil: s.rateLimitedUntil,
    }));
  }

  private getAvailableKeys(): InternalKeyState[] {
    const now = Date.now();
    return Array.from(this.keys.values()).filter(
      (k) => k.isHealthy && (!k.rateLimitedUntil || k.rateLimitedUntil.getTime() <= now)
    );
  }

  private createState(id: string): InternalKeyState {
    return {
      id,
      requestCount: 0,
      tokensUsed: 0,
      errorCount: 0,
      activeRequests: 0,
      isHealthy: true,
      lastUsedAt: null,
      rateLimitedUntil: null,
    };
  }
}
