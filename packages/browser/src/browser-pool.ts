import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

export interface BrowserPoolOptions {
  /** Max concurrent browser sessions (each task gets its own). Queues beyond this. */
  maxConcurrent?: number;
  headless?: boolean;
  defaultTimeoutMs?: number;
  /** If a session is idle (no tool call) longer than this, forcefully reclaim it. */
  sessionIdleTimeoutMs?: number;
}

export interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  persistent: boolean;
  name: string | null;
  /** Which task currently owns this session. Null if in the persistent pool unclaimed. */
  ownedByTaskId: string | null;
  lastActivityAt: Date;
  createdAt: Date;
  /** Whether this session was created from a headless browser instance. */
  headless: boolean;
}

type WaitingResolver = {
  resolve: (session: BrowserSession) => void;
  reject: (err: Error) => void;
  taskId: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

/**
 * Manages a pool of isolated browser sessions with concurrency control.
 *
 * Key guarantees:
 * - Each task gets its own BrowserContext (fully isolated cookies, storage, cache)
 * - At most `maxConcurrent` sessions run simultaneously; excess tasks wait in a FIFO queue
 * - `checkin()` closes the context and frees the slot for the next waiting task
 * - Persistent (named) sessions survive checkin and can be reused across tasks
 * - An idle-timeout reaper forcefully reclaims sessions that were never checked in
 */
export class BrowserPool {
  /**
   * Two browser instances: one per headless mode.
   * The default (matching `options.headless`) is launched eagerly in `initialize()`.
   * The alternate mode is launched lazily on the first checkout that requests it.
   */
  private browsers: Map<boolean, Browser> = new Map();
  private activeSessions: Map<string, BrowserSession> = new Map();
  private persistentSessions: Map<string, BrowserSession> = new Map();
  private waitQueue: WaitingResolver[] = [];
  private reaperInterval: ReturnType<typeof setInterval> | null = null;
  private options: Required<BrowserPoolOptions>;
  private _activeCount = 0;

  constructor(options: BrowserPoolOptions = {}) {
    this.options = {
      maxConcurrent: options.maxConcurrent ?? DEFAULT_CONFIG.browser.poolSize,
      headless: options.headless ?? false,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_CONFIG.browser.defaultTimeoutMs,
      sessionIdleTimeoutMs: options.sessionIdleTimeoutMs ?? DEFAULT_CONFIG.browser.sessionIdleTimeoutMs,
    };
  }

  /** The default headless mode this pool was constructed with. */
  get defaultHeadless(): boolean {
    return this.options.headless;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.browsers.has(this.options.headless)) return;
    await this.ensureBrowser(this.options.headless);

    // Start idle-session reaper
    if (!this.reaperInterval) {
      this.reaperInterval = setInterval(() => this.reapIdleSessions(), 30_000);
    }

    console.log(`[browser-pool] Initialized (max ${this.options.maxConcurrent} concurrent sessions)`);
  }

  /**
   * Launch a Puppeteer browser for the given headless mode if one doesn't
   * already exist.  Called eagerly for the default mode in `initialize()` and
   * lazily for the alternate mode on first checkout that requests it.
   */
  private async ensureBrowser(headless: boolean): Promise<Browser> {
    const existing = this.browsers.get(headless);
    if (existing) return existing;

    const browser = await puppeteer.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    this.browsers.set(headless, browser);
    console.log(`[browser-pool] Launched browser (headless: ${headless})`);
    return browser;
  }

  async shutdown(): Promise<void> {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }

    // Reject anyone still waiting
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeoutHandle);
      waiter.reject(new Error('Browser pool shutting down'));
    }
    this.waitQueue = [];

    // Close all active sessions
    for (const session of this.activeSessions.values()) {
      await session.context.close().catch(() => {});
    }
    this.activeSessions.clear();

    // Close persistent sessions
    for (const session of this.persistentSessions.values()) {
      await session.context.close().catch(() => {});
    }
    this.persistentSessions.clear();

    this._activeCount = 0;

    // Close all browser instances (default + alternate)
    for (const [mode, browser] of this.browsers) {
      await browser.close().catch(() => {});
      console.log(`[browser-pool] Closed browser (headless: ${mode})`);
    }
    this.browsers.clear();
    console.log('[browser-pool] Shut down');
  }

  // ---------------------------------------------------------------------------
  // Checkout / Checkin
  // ---------------------------------------------------------------------------

  /**
   * Acquire an isolated browser session for a task.
   *
   * - If a named persistent session exists, it is returned directly (does NOT
   *   count against `maxConcurrent` while idle, but DOES once checked out).
   * - If the concurrency limit is reached, the call blocks until a slot opens
   *   or the timeout fires.
   *
   * The caller MUST call `checkin(sessionId)` when done.
   */
  async checkout(
    taskId: string,
    options?: { persistentName?: string; timeoutMs?: number; headless?: boolean },
  ): Promise<BrowserSession> {
    if (this.browsers.size === 0) await this.initialize();

    const headless = options?.headless ?? this.options.headless;

    // Check for an existing persistent session by name
    if (options?.persistentName) {
      const existing = this.persistentSessions.get(options.persistentName);
      if (existing) {
        // Re-claim it for this task
        existing.ownedByTaskId = taskId;
        existing.lastActivityAt = new Date();
        this.activeSessions.set(existing.id, existing);
        this._activeCount++;
        console.log(`[browser-pool] Task ${taskId} reclaimed persistent session "${options.persistentName}" (active: ${this._activeCount}/${this.options.maxConcurrent})`);
        return existing;
      }
    }

    // If under the limit, create immediately
    if (this._activeCount < this.options.maxConcurrent) {
      return this.createSession(taskId, options?.persistentName ?? null, headless);
    }

    // Otherwise, queue and wait
    const timeoutMs = options?.timeoutMs ?? this.options.defaultTimeoutMs;
    console.log(`[browser-pool] Task ${taskId} waiting for a browser slot (queue depth: ${this.waitQueue.length + 1})`);

    return new Promise<BrowserSession>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from queue
        const idx = this.waitQueue.findIndex((w) => w.taskId === taskId);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`Browser checkout timed out after ${timeoutMs}ms for task ${taskId}`));
      }, timeoutMs);

      this.waitQueue.push({ resolve, reject, taskId, timeoutHandle });
    });
  }

  /**
   * Return a session after task completion. Closes the context and frees the
   * slot unless the session is persistent.
   */
  async checkin(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const taskId = session.ownedByTaskId;
    this.activeSessions.delete(sessionId);
    this._activeCount = Math.max(0, this._activeCount - 1);

    if (session.persistent && session.name) {
      // Keep the context alive but mark as unowned
      session.ownedByTaskId = null;
      this.persistentSessions.set(session.name, session);
      console.log(`[browser-pool] Task ${taskId} returned persistent session "${session.name}" (active: ${this._activeCount}/${this.options.maxConcurrent})`);
    } else {
      // Non-persistent: close the context entirely
      await session.context.close().catch(() => {});
      console.log(`[browser-pool] Task ${taskId} closed session ${sessionId} (active: ${this._activeCount}/${this.options.maxConcurrent})`);
    }

    // Wake the next waiter
    this.drainQueue();
  }

  /**
   * Forcefully destroy a session (even persistent ones). Used for error
   * recovery and the idle reaper.
   */
  async forceDestroy(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId) ??
      Array.from(this.persistentSessions.values()).find((s) => s.id === sessionId);

    if (!session) return;

    this.activeSessions.delete(sessionId);
    if (session.name) this.persistentSessions.delete(session.name);
    if (session.ownedByTaskId) this._activeCount = Math.max(0, this._activeCount - 1);

    await session.context.close().catch(() => {});
    console.log(`[browser-pool] Force-destroyed session ${sessionId}`);

    this.drainQueue();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get activeCount(): number {
    return this._activeCount;
  }

  get queueDepth(): number {
    return this.waitQueue.length;
  }

  get maxConcurrent(): number {
    return this.options.maxConcurrent;
  }

  getSessionForTask(taskId: string): BrowserSession | undefined {
    return Array.from(this.activeSessions.values()).find((s) => s.ownedByTaskId === taskId);
  }

  /** Update the last-activity timestamp. Called by BrowserTools on every tool invocation. */
  touchSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) session.lastActivityAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async createSession(taskId: string, persistentName: string | null, headless?: boolean): Promise<BrowserSession> {
    const mode = headless ?? this.options.headless;
    const browser = await this.ensureBrowser(mode);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.defaultTimeoutMs);
    await page.setViewport({ width: 1920, height: 1080 });

    const session: BrowserSession = {
      id: crypto.randomUUID(),
      context,
      page,
      persistent: !!persistentName,
      name: persistentName,
      ownedByTaskId: taskId,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      headless: mode,
    };

    this.activeSessions.set(session.id, session);
    this._activeCount++;

    console.log(`[browser-pool] Task ${taskId} created session ${session.id} (headless: ${mode}${persistentName ? `, persistent: "${persistentName}"` : ''}) (active: ${this._activeCount}/${this.options.maxConcurrent})`);
    return session;
  }

  /** Try to satisfy the oldest waiter from the queue. */
  private async drainQueue(): Promise<void> {
    while (this.waitQueue.length > 0 && this._activeCount < this.options.maxConcurrent) {
      const waiter = this.waitQueue.shift();
      if (!waiter) break;

      clearTimeout(waiter.timeoutHandle);
      try {
        const session = await this.createSession(waiter.taskId, null);
        waiter.resolve(session);
      } catch (err: any) {
        waiter.reject(err);
      }
    }
  }

  /** Kill sessions that have been idle beyond the timeout (task probably crashed). */
  private async reapIdleSessions(): Promise<void> {
    const now = Date.now();
    const threshold = this.options.sessionIdleTimeoutMs;

    for (const session of this.activeSessions.values()) {
      const idleMs = now - session.lastActivityAt.getTime();
      if (idleMs > threshold) {
        console.warn(`[browser-pool] Reaping idle session ${session.id} (task: ${session.ownedByTaskId}, idle: ${Math.round(idleMs / 1000)}s)`);
        await this.forceDestroy(session.id);
      }
    }
  }
}
