import puppeteer, { Browser, BrowserContext, Page } from 'puppeteer';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

export interface BrowserPoolOptions {
  poolSize?: number;
  headless?: boolean;
  defaultTimeoutMs?: number;
}

export interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  persistent: boolean;
  name: string | null;
  createdAt: Date;
}

export class BrowserPool {
  private browser: Browser | null = null;
  private sessions: Map<string, BrowserSession> = new Map();
  private options: Required<BrowserPoolOptions>;

  constructor(options: BrowserPoolOptions = {}) {
    this.options = {
      poolSize: options.poolSize ?? DEFAULT_CONFIG.browser.poolSize,
      headless: options.headless ?? false,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_CONFIG.browser.defaultTimeoutMs,
    };
  }

  async initialize(): Promise<void> {
    if (this.browser) return;
    this.browser = await puppeteer.launch({
      headless: this.options.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    console.log('[browser] Pool initialized');
  }

  async createSession(name?: string): Promise<BrowserSession> {
    if (!this.browser) await this.initialize();

    // Check for existing persistent session
    if (name) {
      const existing = Array.from(this.sessions.values()).find((s) => s.name === name);
      if (existing) return existing;
    }

    const context = await this.browser!.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.defaultTimeoutMs);

    const session: BrowserSession = {
      id: crypto.randomUUID(),
      context,
      page,
      persistent: !!name,
      name: name ?? null,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.persistent) return; // Don't destroy persistent sessions
    await session.context.close();
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.context.close().catch(() => {});
    }
    this.sessions.clear();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('[browser] Pool shut down');
  }
}
