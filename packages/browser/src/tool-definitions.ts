import type { BrowserTools } from './browser-tools.js';
import type { BrowserPool } from './browser-pool.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>;
}

/**
 * @deprecated Use `createPerTaskBrowserTools` instead. This binds all tools
 * to a single `BrowserTools` instance which causes conflicts when multiple
 * tasks run on the same node.
 */
export function createBrowserToolDefinitions(bt: BrowserTools): ToolDef[] {
  return buildToolDefs(bt);
}

/**
 * Creates a per-task set of browser tool definitions.
 *
 * Returns:
 * - `tools`: the tool definitions to register on the agent
 * - `acquire()`: call before the agent's first tool invocation to claim a
 *   browser session from the pool
 * - `release()`: call after the task finishes (success or failure) to return
 *   the session and free the slot for other tasks
 *
 * Usage in the worker:
 * ```ts
 * const { tools, acquire, release } = await createPerTaskBrowserTools(pool, taskId);
 * agentRunner.getToolRegistry().registerAll(tools);
 * try {
 *   await acquire();
 *   await agentRunner.run(/* ... *\/);
 * } finally {
 *   await release();
 * }
 * ```
 */
export async function createPerTaskBrowserTools(
  pool: BrowserPool,
  taskId: string,
  options?: { persistentName?: string; timeoutMs?: number },
): Promise<{
  tools: ToolDef[];
  acquire: () => Promise<void>;
  release: () => Promise<void>;
  browserTools: BrowserTools;
}> {
  // Lazy-import to avoid circular deps at module level (BrowserTools is in the
  // same package, so this is fine)
  const { BrowserTools } = await import('./browser-tools.js');
  const bt = new BrowserTools(pool) as InstanceType<typeof BrowserTools>;

  // Wrap every tool so it auto-acquires on first use (lazy checkout)
  let acquired = false;
  const ensureAcquired = async (headless?: boolean) => {
    if (!acquired) {
      await bt.acquire(taskId, { ...options, headless });
      acquired = true;
    }
  };

  const rawDefs = buildToolDefs(bt);

  // Wrap each tool's execute to ensure session exists and to detect expired
  // sessions (e.g. reclaimed by the pool's idle reaper after inactivity).
  // On expiry the wrapper tears down the dead session and resets `acquired`
  // so the *next* browser tool call (typically browser_navigate) transparently
  // checks out a fresh session from the pool.
  const tools: ToolDef[] = rawDefs.map((def) => ({
    ...def,
    execute: async (input: Record<string, unknown>) => {
      // browser_navigate may request a specific headless mode.
      // If the session is already acquired with a different mode, release and
      // re-acquire with the requested mode.
      if (def.name === 'browser_navigate') {
        const requestedHeadless = input.headless as boolean | undefined;
        if (acquired && requestedHeadless !== undefined && bt.currentHeadless !== requestedHeadless) {
          await bt.release().catch(() => {});
          acquired = false;
        }
        await ensureAcquired(requestedHeadless);
      } else {
        await ensureAcquired();
      }

      try {
        return await def.execute(input);
      } catch (err: any) {
        if (isSessionExpiredError(err)) {
          // Tear down the dead session so the next call can re-acquire
          await bt.release().catch(() => {});
          acquired = false;
          return { success: false, output: err.message };
        }
        throw err;
      }
    },
  }));

  return {
    tools,
    acquire: ensureAcquired,
    release: async () => {
      if (acquired) {
        await bt.release();
        acquired = false;
      }
    },
    browserTools: bt,
  };
}

// ---------------------------------------------------------------------------
// Shared tool definition builder
// ---------------------------------------------------------------------------

function buildToolDefs(bt: BrowserTools): ToolDef[] {
  return [
    {
      name: 'browser_navigate',
      description:
        'Navigate to a URL in the browser. Browser tabs persist across messages but are ' +
        'automatically closed after 5 minutes of inactivity. If you receive a "session expired" ' +
        'error, call this tool again to open a fresh tab at the desired URL.\n\n' +
        'By default the browser runs in headless mode (no visible window). Set `headless` to ' +
        '`false` to open a visible browser window — useful when you need to interact with pages ' +
        'that detect headless mode or when the user wants to watch the automation live. Changing ' +
        'the headless mode mid-session will close the current tab and open a new one.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          headless: {
            type: 'boolean',
            description:
              'Whether to run the browser in headless mode (no visible window). ' +
              'Defaults to true. Set to false for a visible browser window.',
          },
        },
        required: ['url'],
      },
      execute: async (input) => {
        const url = await bt.navigate(input.url as string);
        const mode = bt.currentHeadless ? 'headless' : 'headed';
        return { success: true, output: `Navigated to ${url} (${mode})` };
      },
    },
    {
      name: 'browser_getPageContent',
      description: 'Get the full readable content of the current page via accessibility tree.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const content = await bt.getPageContent();
        return { success: true, output: content };
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Returns base64 image.',
      inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
      execute: async (input) => {
        const base64 = await bt.screenshot(input.fullPage as boolean);
        return { success: true, output: base64 };
      },
    },
    {
      name: 'browser_setViewport',
      description: 'Set the browser viewport size. Use for testing responsive layouts. Common sizes: mobile (375x812), tablet (768x1024), desktop (1920x1080). Default is 1920x1080.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'Viewport width in pixels' },
          height: { type: 'number', description: 'Viewport height in pixels' },
        },
        required: ['width', 'height'],
      },
      execute: async (input) => {
        const width = input.width as number;
        const height = input.height as number;
        await bt.setViewport(width, height);
        return { success: true, output: `Viewport set to ${width}x${height}` };
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element on the page.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
      execute: async (input) => {
        await bt.click(input.selector as string);
        return { success: true, output: `Clicked ${input.selector}` };
      },
    },
    {
      name: 'browser_type',
      description: 'Type text into an input element.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] },
      execute: async (input) => {
        await bt.type(input.selector as string, input.text as string);
        return { success: true, output: `Typed into ${input.selector}` };
      },
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page in a direction.',
      inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' } }, required: ['direction'] },
      execute: async (input) => {
        await bt.scroll(input.direction as any, input.amount as number);
        return { success: true, output: `Scrolled ${input.direction}` };
      },
    },
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript in the browser and return the result.',
      inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] },
      execute: async (input) => {
        const result = await bt.evaluate(input.script as string);
        return { success: true, output: JSON.stringify(result) };
      },
    },
    {
      name: 'browser_getConsoleLogs',
      description: 'Get browser console logs (log, warn, error, info).',
      inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Filter by level: log|warn|error|info' } } },
      execute: async (input) => {
        const logs = bt.getConsoleLogs(input.filter as string | undefined);
        return { success: true, output: JSON.stringify(logs) };
      },
    },
    {
      name: 'browser_getNetworkRequests',
      description: 'Get a log of network requests made by the page.',
      inputSchema: { type: 'object', properties: { urlPattern: { type: 'string' }, method: { type: 'string' }, status: { type: 'number' } } },
      execute: async (input) => {
        const logs = bt.getNetworkRequests(input as any);
        return { success: true, output: JSON.stringify(logs) };
      },
    },
    {
      name: 'browser_selectOption',
      description: 'Select an option from a dropdown.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' } }, required: ['selector', 'value'] },
      execute: async (input) => {
        await bt.selectOption(input.selector as string, input.value as string);
        return { success: true, output: `Selected ${input.value} in ${input.selector}` };
      },
    },
    {
      name: 'browser_waitForSelector',
      description: 'Wait for an element to appear on the page.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' }, timeout: { type: 'number' } }, required: ['selector'] },
      execute: async (input) => {
        await bt.waitForSelector(input.selector as string, input.timeout as number);
        return { success: true, output: `Element ${input.selector} appeared` };
      },
    },
    {
      name: 'browser_getAccessibilityTree',
      description: 'Get the full accessibility tree of the page (structured, LLM-friendly).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const tree = await bt.getAccessibilityTree();
        return { success: true, output: JSON.stringify(tree) };
      },
    },
    {
      name: 'browser_pressKey',
      description: 'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.).',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      execute: async (input) => {
        await bt.pressKey(input.key as string);
        return { success: true, output: `Pressed ${input.key}` };
      },
    },
    {
      name: 'browser_getCookies',
      description: 'Get all cookies for the current page domain.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const cookies = await bt.getCookies();
        return { success: true, output: JSON.stringify(cookies) };
      },
    },
    {
      name: 'browser_getUrl',
      description: 'Get the current page URL.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const url = await bt.getUrl();
        return { success: true, output: url };
      },
    },
    {
      name: 'browser_goBack',
      description: 'Navigate back in browser history.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await bt.goBack();
        return { success: true, output: 'Navigated back' };
      },
    },
    {
      name: 'browser_fill',
      description: 'Fill an input element with text (replaces existing value).',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector', 'text'] },
      execute: async (input) => {
        await bt.fill(input.selector as string, input.text as string);
        return { success: true, output: `Filled ${input.selector}` };
      },
    },
    {
      name: 'browser_hover',
      description: 'Hover over an element on the page.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
      execute: async (input) => {
        await bt.hover(input.selector as string);
        return { success: true, output: `Hovered over ${input.selector}` };
      },
    },
    {
      name: 'browser_getOpenTabs',
      description: 'Get a list of all open browser tabs in this session.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const tabs = await bt.getOpenTabs();
        return { success: true, output: JSON.stringify(tabs) };
      },
    },
    {
      name: 'browser_newTab',
      description: 'Open a new browser tab, optionally navigating to a URL.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      execute: async (input) => {
        await bt.newTab(input.url as string | undefined);
        return { success: true, output: `Opened new tab${input.url ? ` at ${input.url}` : ''}` };
      },
    },
    {
      name: 'browser_uploadFile',
      description: 'Upload a file using a file input element.',
      inputSchema: { type: 'object', properties: { selector: { type: 'string' }, filePath: { type: 'string' } }, required: ['selector', 'filePath'] },
      execute: async (input) => {
        await bt.uploadFile(input.selector as string, input.filePath as string);
        return { success: true, output: `Uploaded file to ${input.selector}` };
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser session and release the slot for other tasks.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await bt.release();
        return { success: true, output: 'Browser session closed' };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect errors that indicate the underlying browser page/context was closed. */
function isSessionExpiredError(err: Error): boolean {
  const msg = err.message ?? '';
  return (
    msg.includes('Browser session expired') ||
    msg.includes('Target closed') ||
    msg.includes('Session closed') ||
    msg.includes('page has been closed') ||
    msg.includes('Execution context was destroyed')
  );
}
