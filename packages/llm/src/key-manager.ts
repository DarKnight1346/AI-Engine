import type { LoadBalanceStrategy } from '@ai-engine/shared';
import type { KeyState } from './pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the timestamp (ms) for the next top-of-the-hour boundary.
 * e.g. if it's 14:23, returns the timestamp for 15:00.
 */
function nextTopOfHour(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

// ---------------------------------------------------------------------------
// Key health status
// ---------------------------------------------------------------------------

export type KeyHealthStatus =
  | 'healthy'          // Normal — can be used
  | 'rate_limited'     // Short-term rate limit (429 with retry-after)
  | 'exhausted'        // Quota/token limit hit — wait until top of hour to probe
  | 'errored';         // Persistent errors — wait until top of hour to probe

interface InternalKeyState {
  id: string;
  requestCount: number;
  tokensUsed: number;
  errorCount: number;
  consecutiveErrors: number;
  activeRequests: number;
  status: KeyHealthStatus;
  lastUsedAt: Date | null;
  /** For rate_limited: the exact time to retry */
  rateLimitedUntil: Date | null;
  /** For exhausted/errored: the top-of-hour boundary to probe again */
  cooldownUntil: Date | null;
  /** Last error message — useful for debugging */
  lastError: string | null;
  /** Timestamp of when the key was marked exhausted/errored */
  markedUnhealthyAt: Date | null;
}

// ---------------------------------------------------------------------------
// KeyManager
// ---------------------------------------------------------------------------

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

  /**
   * Pick the next available key. Keys whose cooldown/rate-limit has elapsed
   * are automatically re-promoted to 'healthy' (they'll be probed on the
   * next actual API call).
   */
  getNextKey(): string | null {
    this.promoteRecoveredKeys();
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

  // ── Success / failure recording ─────────────────────────────────────

  recordSuccess(keyId: string, tokensUsed: number): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.requestCount++;
    state.tokensUsed += tokensUsed;
    state.lastUsedAt = new Date();
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    // A successful call means the key is working — reset error counters
    state.consecutiveErrors = 0;
    state.status = 'healthy';
    state.cooldownUntil = null;
    state.lastError = null;
    state.markedUnhealthyAt = null;
  }

  /**
   * Record a rate-limit (HTTP 429). Uses the `retry-after` header value
   * if available; otherwise falls back to 60 seconds.
   */
  recordRateLimit(keyId: string, retryAfterMs: number): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.rateLimitedUntil = new Date(Date.now() + retryAfterMs);
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.status = 'rate_limited';
    state.lastError = `Rate limited until ${state.rateLimitedUntil.toISOString()}`;
  }

  /**
   * Record a quota/token exhaustion (HTTP 402, 403 with quota messaging,
   * or explicit overloaded/billing errors). The key is shelved until
   * the next top-of-the-hour boundary, at which point it will be probed.
   */
  recordExhausted(keyId: string, reason: string): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.status = 'exhausted';
    state.cooldownUntil = nextTopOfHour();
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.lastError = reason;
    state.markedUnhealthyAt = new Date();
    console.log(
      `[KeyManager] Key ${keyId} marked EXHAUSTED: "${reason}". ` +
      `Will probe again at ${state.cooldownUntil.toISOString()}`
    );
  }

  /**
   * Record a generic/transient error. After 3 consecutive errors the key
   * is shelved until the next top-of-the-hour boundary.
   */
  recordError(keyId: string, errorMessage?: string): void {
    const state = this.keys.get(keyId);
    if (!state) return;
    state.errorCount++;
    state.consecutiveErrors++;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.lastError = errorMessage ?? 'Unknown error';

    // After 3 consecutive errors, assume persistent issue — cool down
    if (state.consecutiveErrors >= 3) {
      state.status = 'errored';
      state.cooldownUntil = nextTopOfHour();
      state.markedUnhealthyAt = new Date();
      console.log(
        `[KeyManager] Key ${keyId} marked ERRORED after ${state.consecutiveErrors} consecutive failures. ` +
        `Will probe again at ${state.cooldownUntil.toISOString()}`
      );
    }
  }

  // ── Key management ──────────────────────────────────────────────────

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
      isHealthy: s.status === 'healthy',
      status: s.status,
      lastUsedAt: s.lastUsedAt,
      rateLimitedUntil: s.rateLimitedUntil,
      cooldownUntil: s.cooldownUntil,
      lastError: s.lastError,
      markedUnhealthyAt: s.markedUnhealthyAt,
    }));
  }

  // ── Internals ───────────────────────────────────────────────────────

  /**
   * Check all non-healthy keys and promote them back to 'healthy' if
   * their cooldown/rate-limit window has elapsed. This gives them a
   * chance to be picked and probed on the next API call.
   */
  private promoteRecoveredKeys(): void {
    const now = Date.now();
    for (const state of this.keys.values()) {
      if (state.status === 'rate_limited' && state.rateLimitedUntil) {
        if (now >= state.rateLimitedUntil.getTime()) {
          state.status = 'healthy';
          state.rateLimitedUntil = null;
          state.consecutiveErrors = 0;
          console.log(`[KeyManager] Key ${state.id} rate-limit expired — promoted back to HEALTHY`);
        }
      } else if (
        (state.status === 'exhausted' || state.status === 'errored') &&
        state.cooldownUntil
      ) {
        if (now >= state.cooldownUntil.getTime()) {
          const oldStatus = state.status;
          state.status = 'healthy';
          state.cooldownUntil = null;
          state.consecutiveErrors = 0;
          console.log(
            `[KeyManager] Key ${state.id} cooldown expired (was ${oldStatus}) — ` +
            `promoted back to HEALTHY for probing`
          );
        }
      }
    }
  }

  private getAvailableKeys(): InternalKeyState[] {
    return Array.from(this.keys.values()).filter((k) => k.status === 'healthy');
  }

  private createState(id: string): InternalKeyState {
    return {
      id,
      requestCount: 0,
      tokensUsed: 0,
      errorCount: 0,
      consecutiveErrors: 0,
      activeRequests: 0,
      status: 'healthy',
      lastUsedAt: null,
      rateLimitedUntil: null,
      cooldownUntil: null,
      lastError: null,
      markedUnhealthyAt: null,
    };
  }
}
