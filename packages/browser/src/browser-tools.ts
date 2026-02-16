import type { Page, ElementHandle } from 'puppeteer';
import type { BrowserPool, BrowserSession } from './browser-pool.js';
import type { AccessibilityNode, ConsoleLogEntry, NetworkRequestLog } from '@ai-engine/shared';

/**
 * Per-task browser automation tools.
 *
 * Each task that needs a browser gets its own `BrowserTools` instance backed by
 * its own isolated `BrowserSession`. Console and network logs are scoped to
 * this instance so tasks don't leak state to one another.
 *
 * Lifecycle:
 *   1. `await tools.acquire(taskId)`  — checks out a session from the pool
 *   2. Use any tool methods (navigate, click, type, …)
 *   3. `await tools.release()`        — checks the session back in (closes context)
 *
 * If `release()` is never called (e.g. the task crashes), the pool's idle
 * reaper will eventually reclaim the session.
 */
export class BrowserTools {
  private session: BrowserSession | null = null;
  private taskId: string | null = null;
  private consoleLogs: ConsoleLogEntry[] = [];
  private networkLogs: NetworkRequestLog[] = [];
  private requestCounter = 0;
  private released = false;

  constructor(private pool: BrowserPool) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Acquire a browser session from the pool for the given task.
   * Blocks if the pool is at capacity until a slot opens.
   */
  async acquire(taskId: string, options?: { persistentName?: string; timeoutMs?: number }): Promise<void> {
    if (this.session) throw new Error(`BrowserTools already acquired for task ${this.taskId}`);
    this.taskId = taskId;
    this.released = false;
    this.session = await this.pool.checkout(taskId, options);
    this.attachListeners(this.session.page);
  }

  /** Whether this instance currently holds a session. */
  get isAcquired(): boolean {
    return this.session !== null && !this.released;
  }

  /**
   * Release the browser session back to the pool.
   * For non-persistent sessions this closes the context entirely.
   * Safe to call multiple times (idempotent).
   */
  async release(): Promise<void> {
    if (this.released || !this.session) return;
    this.released = true;

    const sessionId = this.session.id;
    this.session = null;
    this.taskId = null;
    this.consoleLogs = [];
    this.networkLogs = [];
    this.requestCounter = 0;

    await this.pool.checkin(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private get page(): Page {
    if (!this.session || this.released) {
      throw new Error(
        'Browser session expired — no active session. Use browser_navigate to start a new session.',
      );
    }
    const p = this.session.page;
    if (p.isClosed()) {
      throw new Error(
        'Browser session expired — the tab was automatically closed after 5 minutes of inactivity. '
        + 'All page state (URL, cookies, viewport settings) has been lost. '
        + 'Use browser_navigate to open a new page.',
      );
    }
    // Touch the pool to prevent idle reaping
    this.pool.touchSession(this.session.id);
    return p;
  }

  private attachListeners(page: Page): void {
    page.on('console', (msg) => {
      this.consoleLogs.push({
        level: msg.type() as ConsoleLogEntry['level'],
        text: msg.text(),
        timestamp: new Date(),
      });
    });

    page.on('response', (response) => {
      const request = response.request();
      this.networkLogs.push({
        id: String(++this.requestCounter),
        url: request.url(),
        method: request.method(),
        status: response.status(),
        responseSize: 0,
        durationMs: 0,
        timestamp: new Date(),
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async navigate(url: string): Promise<string> {
    await this.page.goto(url, { waitUntil: 'networkidle2' });
    return this.page.url();
  }

  async goBack(): Promise<void> { await this.page.goBack(); }
  async goForward(): Promise<void> { await this.page.goForward(); }
  async reload(): Promise<void> { await this.page.reload(); }
  async getUrl(): Promise<string> { return this.page.url(); }
  async getTitle(): Promise<string> { return this.page.title(); }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async getAccessibilityTree(): Promise<AccessibilityNode> {
    const snapshot = await this.page.accessibility.snapshot();
    return (snapshot as AccessibilityNode) ?? { role: 'document', name: 'empty' };
  }

  async getPageContent(): Promise<string> {
    const tree = await this.getAccessibilityTree();
    return this.flattenAccessibilityTree(tree);
  }

  async getElementText(selector: string): Promise<string> {
    return this.page.$eval(selector, (el) => el.textContent ?? '');
  }

  async getElementAttribute(selector: string, attr: string): Promise<string | null> {
    return this.page.$eval(selector, (el, a) => el.getAttribute(a), attr);
  }

  async getPageHTML(selector?: string): Promise<string> {
    if (selector) {
      return this.page.$eval(selector, (el) => el.outerHTML);
    }
    return this.page.content();
  }

  // ---------------------------------------------------------------------------
  // Visual
  // ---------------------------------------------------------------------------

  async screenshot(fullPage = false): Promise<string> {
    const buffer = await this.page.screenshot({ fullPage, encoding: 'base64' });
    return typeof buffer === 'string' ? buffer : Buffer.from(buffer as ArrayBuffer).toString('base64');
  }

  async screenshotElement(selector: string): Promise<string> {
    const element = await this.page.$(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);
    const buffer = await element.screenshot({ encoding: 'base64' });
    return typeof buffer === 'string' ? buffer : Buffer.from(buffer as ArrayBuffer).toString('base64');
  }

  async getBoundingBox(selector: string) {
    const el = await this.page.$(selector);
    return el ? el.boundingBox() : null;
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.page.setViewport({ width, height });
  }

  async getViewport(): Promise<{ width: number; height: number }> {
    const vp = this.page.viewport();
    return vp ? { width: vp.width, height: vp.height } : { width: 1920, height: 1080 };
  }

  // ---------------------------------------------------------------------------
  // Clicking
  // ---------------------------------------------------------------------------

  async click(selector: string): Promise<void> { await this.page.click(selector); }
  async doubleClick(selector: string): Promise<void> { await this.page.click(selector, { count: 2 }); }
  async rightClick(selector: string): Promise<void> { await this.page.click(selector, { button: 'right' }); }
  async clickAtPosition(x: number, y: number): Promise<void> { await this.page.mouse.click(x, y); }
  async hover(selector: string): Promise<void> { await this.page.hover(selector); }

  // ---------------------------------------------------------------------------
  // Typing
  // ---------------------------------------------------------------------------

  async type(selector: string, text: string): Promise<void> {
    await this.page.click(selector);
    await this.page.type(selector, text);
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.page.$eval(selector, (el: any, val: string) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  }

  async clearAndType(selector: string, text: string): Promise<void> {
    await this.page.click(selector, { count: 3 });
    await this.page.keyboard.press('Backspace');
    await this.page.type(selector, text);
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key as any);
  }

  async keyboardShortcut(keys: string): Promise<void> {
    const parts = keys.split('+');
    for (const key of parts.slice(0, -1)) await this.page.keyboard.down(key as any);
    await this.page.keyboard.press(parts[parts.length - 1] as any);
    for (const key of parts.slice(0, -1).reverse()) await this.page.keyboard.up(key as any);
  }

  // ---------------------------------------------------------------------------
  // Scrolling
  // ---------------------------------------------------------------------------

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount = 500): Promise<void> {
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    await this.page.mouse.wheel({ deltaX: dx, deltaY: dy });
  }

  async scrollToElement(selector: string): Promise<void> {
    await this.page.$eval(selector, (el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async scrollToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------

  async selectOption(selector: string, value: string): Promise<void> {
    await this.page.select(selector, value);
  }

  async checkCheckbox(selector: string): Promise<void> {
    const checked = await this.page.$eval(selector, (el: any) => el.checked);
    if (!checked) await this.page.click(selector);
  }

  async uncheckCheckbox(selector: string): Promise<void> {
    const checked = await this.page.$eval(selector, (el: any) => el.checked);
    if (checked) await this.page.click(selector);
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    const input = await this.page.$(selector);
    if (!input) throw new Error(`File input not found: ${selector}`);
    await (input as ElementHandle<HTMLInputElement>).uploadFile(filePath);
  }

  // ---------------------------------------------------------------------------
  // JavaScript
  // ---------------------------------------------------------------------------

  async evaluate(script: string): Promise<unknown> {
    return this.page.evaluate(script);
  }

  // ---------------------------------------------------------------------------
  // Console & Network
  // ---------------------------------------------------------------------------

  getConsoleLogs(filter?: string): ConsoleLogEntry[] {
    if (!filter) return [...this.consoleLogs];
    return this.consoleLogs.filter((l) => l.level === filter);
  }

  getConsoleErrors(): ConsoleLogEntry[] {
    return this.consoleLogs.filter((l) => l.level === 'error');
  }

  getNetworkRequests(filter?: { urlPattern?: string; method?: string; status?: number }): NetworkRequestLog[] {
    let logs = [...this.networkLogs];
    if (filter?.urlPattern) logs = logs.filter((l) => l.url.includes(filter.urlPattern!));
    if (filter?.method) logs = logs.filter((l) => l.method === filter.method);
    if (filter?.status) logs = logs.filter((l) => l.status === filter.status);
    return logs;
  }

  async getCookies(): Promise<any[]> {
    return this.page.cookies();
  }

  async setCookie(cookie: { name: string; value: string; domain?: string }): Promise<void> {
    await this.page.setCookie(cookie as any);
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  async getLocalStorage(): Promise<Record<string, string>> {
    return this.page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) items[key] = localStorage.getItem(key) ?? '';
      }
      return items;
    });
  }

  async setLocalStorage(key: string, value: string): Promise<void> {
    await this.page.evaluate((k, v) => localStorage.setItem(k, v), key, value);
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  async getOpenTabs(): Promise<Array<{ id: string; url: string; title: string }>> {
    const pages = this.session ? await this.session.context.pages() : [];
    return Promise.all(pages.map(async (p: Page, i: number) => ({
      id: String(i),
      url: p.url(),
      title: await p.title(),
    })));
  }

  async newTab(url?: string): Promise<void> {
    const page = await this.session!.context.newPage();
    if (url) await page.goto(url);
  }

  // ---------------------------------------------------------------------------
  // Waiting
  // ---------------------------------------------------------------------------

  async waitForSelector(selector: string, timeout?: number): Promise<void> {
    await this.page.waitForSelector(selector, { timeout });
  }

  async waitForNavigation(): Promise<void> {
    await this.page.waitForNavigation();
  }

  async waitForNetworkIdle(): Promise<void> {
    await this.page.waitForNetworkIdle();
  }

  // ---------------------------------------------------------------------------
  // Cleanup (alias for release)
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    await this.release();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private flattenAccessibilityTree(node: AccessibilityNode, depth = 0): string {
    const indent = '  '.repeat(depth);
    let text = '';
    if (node.name) {
      text += `${indent}[${node.role}] ${node.name}`;
      if (node.value) text += ` = "${node.value}"`;
      text += '\n';
    }
    if (node.children) {
      for (const child of node.children) {
        text += this.flattenAccessibilityTree(child, depth + 1);
      }
    }
    return text;
  }
}
