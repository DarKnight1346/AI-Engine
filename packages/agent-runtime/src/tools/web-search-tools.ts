import type { Tool, ToolContext, ToolResult } from '../types.js';

// ---------------------------------------------------------------------------
// Web Search Tools — Serper.dev powered
//
// Creates executable Tool implementations for all Serper.dev search types.
// These tools are registered with the ToolExecutor for dashboard-side
// execution (HTTP-based, no persistent state needed).
// ---------------------------------------------------------------------------

/**
 * Factory: injected at construction time so we don't import @ai-engine/web-search
 * directly (avoiding circular / optional-dependency issues).
 */
export interface SerperServiceLike {
  search(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  images(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  videos(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  places(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  maps(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  reviews(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  news(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  shopping(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  lens(imageUrl: string, options?: Record<string, unknown>): Promise<unknown[]>;
  scholar(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  patents(query: string, options?: Record<string, unknown>): Promise<unknown[]>;
  autocomplete(query: string, options?: Record<string, unknown>): Promise<string[]>;
  webpage(url: string): Promise<{ title: string; text: string; markdown: string; url: string }>;
}

// ── Shared option properties used across most tools ─────────────────────

const COMMON_OPTION_PROPS = {
  num: { type: 'number', description: 'Number of results to return (default 10, max 100)' },
  gl: { type: 'string', description: 'Country code, e.g. "us", "gb", "de"' },
  hl: { type: 'string', description: 'Language code, e.g. "en", "fr", "de"' },
  location: { type: 'string', description: 'Location string, e.g. "New York, NY"' },
  tbs: { type: 'string', description: 'Time filter: "qdr:h" (hour), "qdr:d" (day), "qdr:w" (week), "qdr:m" (month), "qdr:y" (year)' },
} as const;

// ── Helper to extract common options from input ─────────────────────────

function extractOptions(input: Record<string, unknown>): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  for (const key of ['num', 'gl', 'hl', 'location', 'tbs', 'page', 'autocorrect']) {
    if (input[key] !== undefined) opts[key] = input[key];
  }
  return opts;
}

// ── Result formatter ────────────────────────────────────────────────────

function formatResults(results: unknown[], label: string): ToolResult {
  if (!results || results.length === 0) {
    return { success: true, output: `No ${label} results found.` };
  }
  const formatted = JSON.stringify(results, null, 2);
  return {
    success: true,
    output: `Found ${results.length} ${label} result(s):\n${formatted}`,
    data: { results, count: results.length },
  };
}

// ---------------------------------------------------------------------------
// Build all web search tools
// ---------------------------------------------------------------------------

export function createWebSearchTools(service: SerperServiceLike): Tool[] {
  return [
    // ── webSearch — Google Web Search ────────────────────────────────────
    {
      name: 'webSearch',
      description: 'Search the web using Google via Serper. Returns organic search results with titles, links, and snippets. Use for general information retrieval, research, fact-checking, and finding current data.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.search(input.query as string, extractOptions(input));
          return formatResults(results, 'web search');
        } catch (err: any) {
          return { success: false, output: `Web search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchImages — Google Image Search ───────────────────────────
    {
      name: 'webSearchImages',
      description: 'Search for images on Google. Returns image URLs, dimensions, sources, and thumbnails. Use when the user needs to find images, visual references, or inspect image results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The image search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.images(input.query as string, extractOptions(input));
          return formatResults(results, 'image');
        } catch (err: any) {
          return { success: false, output: `Image search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchVideos — Google Video Search ───────────────────────────
    {
      name: 'webSearchVideos',
      description: 'Search for videos on Google. Returns video links, titles, durations, channels, and thumbnails. Use when looking for video content, tutorials, or media.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The video search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.videos(input.query as string, extractOptions(input));
          return formatResults(results, 'video');
        } catch (err: any) {
          return { success: false, output: `Video search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchPlaces — Google Places Search ──────────────────────────
    {
      name: 'webSearchPlaces',
      description: 'Search for local businesses and places on Google. Returns names, addresses, ratings, phone numbers, and websites. Use for finding restaurants, shops, services, or any physical location.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The places search query, e.g. "coffee shops near downtown Seattle"' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.places(input.query as string, extractOptions(input));
          return formatResults(results, 'places');
        } catch (err: any) {
          return { success: false, output: `Places search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchMaps — Google Maps Search ──────────────────────────────
    {
      name: 'webSearchMaps',
      description: 'Search Google Maps for locations, businesses, and points of interest. Returns detailed location data including coordinates, ratings, categories, and contact info.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The maps search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.maps(input.query as string, extractOptions(input));
          return formatResults(results, 'maps');
        } catch (err: any) {
          return { success: false, output: `Maps search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchReviews — Google Reviews Search ────────────────────────
    {
      name: 'webSearchReviews',
      description: 'Search for reviews on Google. Returns review titles, sources, ratings, and snippets. Use when looking for product reviews, business reviews, or user feedback.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The review search query, e.g. "iPhone 16 Pro reviews"' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.reviews(input.query as string, extractOptions(input));
          return formatResults(results, 'review');
        } catch (err: any) {
          return { success: false, output: `Reviews search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchNews — Google News Search ──────────────────────────────
    {
      name: 'webSearchNews',
      description: 'Search Google News for current events and recent articles. Returns news titles, links, snippets, dates, and sources. Use for current events, breaking news, and recent developments.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The news search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.news(input.query as string, extractOptions(input));
          return formatResults(results, 'news');
        } catch (err: any) {
          return { success: false, output: `News search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchShopping — Google Shopping Search ──────────────────────
    {
      name: 'webSearchShopping',
      description: 'Search Google Shopping for products and prices. Returns product names, prices, sources, ratings, and delivery info. Use for price comparisons and product research.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The shopping search query, e.g. "wireless noise cancelling headphones"' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.shopping(input.query as string, extractOptions(input));
          return formatResults(results, 'shopping');
        } catch (err: any) {
          return { success: false, output: `Shopping search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchLens — Google Lens (Reverse Image Search) ──────────────
    {
      name: 'webSearchLens',
      description: 'Reverse image search using Google Lens. Provide an image URL to find visually similar images, identify objects, or find the source of an image.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the image to search for' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['url'],
      },
      execute: async (input) => {
        try {
          const results = await service.lens(input.url as string, extractOptions(input));
          return formatResults(results, 'lens');
        } catch (err: any) {
          return { success: false, output: `Lens search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchScholar — Google Scholar Search ────────────────────────
    {
      name: 'webSearchScholar',
      description: 'Search Google Scholar for academic papers, citations, and research. Returns titles, links, snippets, publication info, and citation counts. Use for academic research and finding scholarly sources.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The academic search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.scholar(input.query as string, extractOptions(input));
          return formatResults(results, 'scholar');
        } catch (err: any) {
          return { success: false, output: `Scholar search failed: ${err.message}` };
        }
      },
    },

    // ── webSearchPatents — Google Patents Search ────────────────────────
    {
      name: 'webSearchPatents',
      description: 'Search Google Patents for patents and patent applications. Returns titles, links, publication numbers, inventors, assignees, and dates. Use for patent research and intellectual property analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The patent search query' },
          ...COMMON_OPTION_PROPS,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const results = await service.patents(input.query as string, extractOptions(input));
          return formatResults(results, 'patent');
        } catch (err: any) {
          return { success: false, output: `Patents search failed: ${err.message}` };
        }
      },
    },

    // ── webAutocomplete — Google Autocomplete ───────────────────────────
    {
      name: 'webAutocomplete',
      description: 'Get Google autocomplete suggestions for a query. Returns a list of suggested search completions. Use for discovering related queries, understanding search intent, or helping users refine their searches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The partial query to get completions for' },
          gl: COMMON_OPTION_PROPS.gl,
          hl: COMMON_OPTION_PROPS.hl,
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const suggestions = await service.autocomplete(input.query as string, extractOptions(input));
          if (!suggestions || suggestions.length === 0) {
            return { success: true, output: 'No autocomplete suggestions found.' };
          }
          return {
            success: true,
            output: `Autocomplete suggestions:\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
            data: { suggestions },
          };
        } catch (err: any) {
          return { success: false, output: `Autocomplete failed: ${err.message}` };
        }
      },
    },

    // ── webGetPage — Fetch and extract webpage content ──────────────────
    {
      name: 'webGetPage',
      description: 'Fetch and extract the content of a web page by URL. Returns the page title and full text/markdown content. Use to read articles, documentation, blog posts, or any web page.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL of the web page to fetch' },
        },
        required: ['url'],
      },
      execute: async (input) => {
        try {
          const page = await service.webpage(input.url as string);
          const content = page.markdown || page.text;
          // Truncate very long pages to avoid blowing up context
          const maxLen = 15000;
          const truncated = content.length > maxLen
            ? content.slice(0, maxLen) + '\n\n... [content truncated, page was ' + content.length + ' chars] ...'
            : content;
          return {
            success: true,
            output: `# ${page.title}\n\nSource: ${page.url}\n\n${truncated}`,
            data: { title: page.title, url: page.url, length: content.length },
          };
        } catch (err: any) {
          return { success: false, output: `Failed to fetch page: ${err.message}` };
        }
      },
    },
  ];
}
