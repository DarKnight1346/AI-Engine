import type { BrowserTools } from './browser-tools.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<{ success: boolean; output: string }>;
}

export function createBrowserToolDefinitions(bt: BrowserTools): ToolDef[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      execute: async (input) => {
        const url = await bt.navigate(input.url as string);
        return { success: true, output: `Navigated to ${url}` };
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
  ];
}
