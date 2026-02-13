import type { Tool, ToolContext, ToolResult } from '../types.js';

// ---------------------------------------------------------------------------
// Web Search Tools — Tiered Architecture
//
// Three tiers of web search, from cheapest/fastest to most expensive/thorough:
//
//   TIER 1 — LIGHTWEIGHT (Serper.dev)
//     Fast, cheap Google API results. Returns raw structured data (links,
//     snippets, metadata). Best for quick lookups, specific queries, and
//     structured data retrieval. Use these FIRST for any search task.
//     Tools: webSearch, webSearchImages, webSearchVideos, webSearchPlaces,
//            webSearchMaps, webSearchReviews, webSearchNews, webSearchShopping,
//            webSearchLens, webSearchScholar, webSearchPatents, webAutocomplete,
//            webGetPage
//
//   TIER 2 — COMPREHENSIVE (xAI / Grok)
//     AI-powered search that reads multiple web pages and synthesizes a
//     comprehensive answer with citations. More expensive but much more
//     thorough. Use when Tier 1 results are insufficient, the topic is
//     complex, or you need analysis/synthesis across multiple sources.
//     Tools: webDeepSearch
//
//   TIER 3 — DEEP RESEARCH (future)
//     Reserved for heavy-duty research tasks with specialized APIs.
//     Not yet implemented.
//
// ---------------------------------------------------------------------------

// ═══════════════════════════════════════════════════════════════════════════
// Tier 1 — Serper.dev (Lightweight)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interface for the Serper.dev search service.
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

// ═══════════════════════════════════════════════════════════════════════════
// Tier 2 — xAI / Grok (Comprehensive)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interface for the xAI search service.
 */
export interface XaiServiceLike {
  search(query: string, options?: Record<string, unknown>): Promise<{
    answer: string;
    citations: Array<{ title?: string; url: string; snippet?: string }>;
    model: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}

// ── Shared option properties for Serper tools ───────────────────────────

const COMMON_OPTION_PROPS = {
  num: { type: 'number', description: 'Number of results to return (default 10, max 100)' },
  gl: { type: 'string', description: 'Country code, e.g. "us", "gb", "de"' },
  hl: { type: 'string', description: 'Language code, e.g. "en", "fr", "de"' },
  location: { type: 'string', description: 'Location string, e.g. "New York, NY"' },
  tbs: { type: 'string', description: 'Time filter: "qdr:h" (hour), "qdr:d" (day), "qdr:w" (week), "qdr:m" (month), "qdr:y" (year)' },
} as const;

function extractOptions(input: Record<string, unknown>): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  for (const key of ['num', 'gl', 'hl', 'location', 'tbs', 'page', 'autocorrect']) {
    if (input[key] !== undefined) opts[key] = input[key];
  }
  return opts;
}

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
// TIER 1: Build Serper.dev search tools (lightweight, fast, cheap)
// ---------------------------------------------------------------------------

export function createWebSearchTools(service: SerperServiceLike): Tool[] {
  return [
    {
      name: 'webSearch',
      description: '[Tier 1 — fast/cheap] Quick Google web search via Serper. Returns raw organic results with titles, links, and snippets. Use this FIRST for any search need — simple factual queries, quick lookups, link finding. Only escalate to webDeepSearch if these results are insufficient or the topic requires synthesis across multiple sources.',
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

    {
      name: 'webSearchImages',
      description:
        '[Tier 1 — fast/cheap] Quick Google image search. Returns image URLs that will be rendered as a visual gallery for the user. ' +
        'IMPORTANT: In your response, include every image URL on its own line so the UI renders them as a visual collage. ' +
        'The user will see the actual images, not just links. Do NOT wrap URLs in markdown links — just include the raw URL.',
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
          if (!results || results.length === 0) {
            return { success: true, output: 'No image results found.' };
          }

          // Extract image URLs in a clean format for gallery rendering
          const imageUrls: string[] = [];
          const imageEntries: string[] = [];
          for (const r of results as any[]) {
            const imgUrl = r.imageUrl || r.thumbnailUrl || r.link;
            if (imgUrl) {
              imageUrls.push(imgUrl);
              const title = r.title || '';
              const source = r.source || r.domain || '';
              imageEntries.push(`${imgUrl}${title ? ` — ${title}` : ''}${source ? ` (${source})` : ''}`);
            }
          }

          return {
            success: true,
            output: `Found ${imageUrls.length} images:\n\n${imageEntries.join('\n')}`,
            data: { imageUrls, results, count: imageUrls.length },
          };
        } catch (err: any) {
          return { success: false, output: `Image search failed: ${err.message}` };
        }
      },
    },

    {
      name: 'webSearchVideos',
      description:
        '[Tier 1 — fast/cheap] Quick Google video search. Returns video links with thumbnails, titles, durations, and channels. ' +
        'Results are rendered as a visual video gallery for the user. ' +
        'IMPORTANT: In your response, include the video data block exactly as returned so the UI renders the video collage. ' +
        'Do NOT reformat the <!--VIDEO_RESULTS--> block.',
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
          if (!results || results.length === 0) {
            return { success: true, output: 'No video results found.' };
          }

          // Build structured video card data for the UI
          const videoCards: Array<{
            title: string;
            link: string;
            imageUrl: string;
            duration: string;
            channel: string;
          }> = [];

          for (const r of results as any[]) {
            const link = r.link || '';
            if (link) {
              videoCards.push({
                title: r.title || '',
                link,
                imageUrl: r.imageUrl || '',
                duration: r.duration || '',
                channel: r.channel || '',
              });
            }
          }

          // Embed structured data in a marker block the UI can parse
          const jsonBlock = `<!--VIDEO_RESULTS-->${JSON.stringify(videoCards)}<!--/VIDEO_RESULTS-->`;
          const humanReadable = videoCards
            .map((v, i) => `${i + 1}. ${v.title}${v.duration ? ` (${v.duration})` : ''}${v.channel ? ` — ${v.channel}` : ''}\n   ${v.link}`)
            .join('\n');

          return {
            success: true,
            output: `Found ${videoCards.length} videos:\n\n${jsonBlock}\n\n${humanReadable}`,
            data: { videoCards, results, count: videoCards.length },
          };
        } catch (err: any) {
          return { success: false, output: `Video search failed: ${err.message}` };
        }
      },
    },

    {
      name: 'webSearchPlaces',
      description: '[Tier 1 — fast/cheap] Quick Google Places search. Returns business names, addresses, ratings, phone numbers, and websites. Use for finding restaurants, shops, services, or physical locations.',
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

    {
      name: 'webSearchMaps',
      description: '[Tier 1 — fast/cheap] Quick Google Maps search. Returns location data with coordinates, ratings, categories, and contact info.',
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

    {
      name: 'webSearchReviews',
      description: '[Tier 1 — fast/cheap] Quick Google Reviews search. Returns review titles, sources, ratings, and snippets. Use for product reviews, business reviews, or user feedback.',
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

    {
      name: 'webSearchNews',
      description: '[Tier 1 — fast/cheap] Quick Google News search. Returns news titles, links, snippets, dates, and sources. Use for current events, breaking news, and recent developments.',
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

    {
      name: 'webSearchShopping',
      description: '[Tier 1 — fast/cheap] Quick Google Shopping search. Returns product names, prices, sources, ratings, and delivery info. Use for price comparisons and product research.',
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

    {
      name: 'webSearchLens',
      description: '[Tier 1 — fast/cheap] Reverse image search using Google Lens. Provide an image URL to find visually similar images, identify objects, or find the source of an image.',
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

    {
      name: 'webSearchScholar',
      description: '[Tier 1 — fast/cheap] Quick Google Scholar search. Returns academic paper titles, links, snippets, publication info, and citation counts. Use for finding scholarly sources and references.',
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

    {
      name: 'webSearchPatents',
      description: '[Tier 1 — fast/cheap] Quick Google Patents search. Returns patent titles, links, publication numbers, inventors, assignees, and dates. Use for patent research and IP analysis.',
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

    {
      name: 'webAutocomplete',
      description: '[Tier 1 — fast/cheap] Get Google autocomplete suggestions. Returns suggested search completions for discovering related queries and refining searches.',
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

    {
      name: 'webGetPage',
      description: '[Tier 1 — fast/cheap] Fetch and extract content from a web page by URL. Returns the page title and full text/markdown. Use to read articles, documentation, blog posts, or any web page after finding it via webSearch.',
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

// ---------------------------------------------------------------------------
// TIER 2: Build xAI / Grok search tools (comprehensive, AI-powered)
// ---------------------------------------------------------------------------

export function createXaiSearchTools(service: XaiServiceLike): Tool[] {
  return [
    {
      name: 'webDeepSearch',
      description: '[Tier 2 — comprehensive/expensive] AI-powered deep web search using xAI Grok. The AI model searches the web, reads multiple pages, and synthesizes a comprehensive answer with citations. Use this when Tier 1 (webSearch) results are insufficient — e.g., complex multi-faceted questions, topics needing cross-source analysis, nuanced comparisons, or when you need a well-reasoned synthesis rather than raw links. Do NOT use for simple factual lookups — use webSearch (Tier 1) first.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query or research question. Be specific and detailed for best results.' },
          allowedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: only search within these domains (max 5), e.g. ["arxiv.org", "nature.com"]',
          },
          excludedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: exclude these domains from search (max 5)',
          },
          enableImageUnderstanding: {
            type: 'boolean',
            description: 'Optional: enable analysis of images found during browsing (default false)',
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional: additional instructions to guide the search, e.g. "Focus on peer-reviewed sources" or "Compare pros and cons"',
          },
        },
        required: ['query'],
      },
      execute: async (input) => {
        try {
          const options: Record<string, unknown> = {};
          if (input.allowedDomains) options.allowedDomains = input.allowedDomains;
          if (input.excludedDomains) options.excludedDomains = input.excludedDomains;
          if (input.enableImageUnderstanding) options.enableImageUnderstanding = input.enableImageUnderstanding;
          if (input.systemPrompt) options.systemPrompt = input.systemPrompt;

          const result = await service.search(input.query as string, options);

          // Format citations
          let citationsBlock = '';
          if (result.citations && result.citations.length > 0) {
            citationsBlock = '\n\n## Sources\n' + result.citations.map((c, i) =>
              `${i + 1}. [${c.title || c.url}](${c.url})${c.snippet ? ` — ${c.snippet}` : ''}`
            ).join('\n');
          }

          // Format usage info
          let usageNote = '';
          if (result.usage) {
            usageNote = `\n\n_[xAI ${result.model} | ${result.usage.inputTokens + result.usage.outputTokens} tokens used]_`;
          }

          return {
            success: true,
            output: `${result.answer}${citationsBlock}${usageNote}`,
            data: {
              answer: result.answer,
              citations: result.citations,
              model: result.model,
              usage: result.usage,
            },
          };
        } catch (err: any) {
          return { success: false, output: `Deep web search failed: ${err.message}` };
        }
      },
    },

    {
      name: 'webDeepSearchWithContext',
      description: '[Tier 2 — comprehensive/expensive] AI-powered deep web search focused on a specific domain or context. Same as webDeepSearch but pre-configured with a system prompt for structured analysis. Use when you need the AI to approach the search with a specific lens — e.g., technical analysis, competitive research, medical information, legal review. Only use when Tier 1 tools are insufficient.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query or research question' },
          context: {
            type: 'string',
            enum: ['technical', 'academic', 'business', 'medical', 'legal', 'news_analysis', 'comparison', 'tutorial'],
            description: 'The research context that guides how the AI approaches the search',
          },
          allowedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: only search within these domains (max 5)',
          },
          excludedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: exclude these domains from search (max 5)',
          },
        },
        required: ['query', 'context'],
      },
      execute: async (input) => {
        const contextPrompts: Record<string, string> = {
          technical: 'You are a technical researcher. Focus on official documentation, GitHub repositories, Stack Overflow, and technical blogs. Provide code examples where relevant. Prioritize accuracy and recency of information.',
          academic: 'You are an academic researcher. Focus on peer-reviewed papers, university publications, and authoritative scientific sources. Cite specific studies and note methodology where relevant.',
          business: 'You are a business analyst. Focus on market data, company financials, industry reports, and credible business news. Provide quantitative data where available.',
          medical: 'You are a medical information researcher. Focus on peer-reviewed medical journals, NIH, WHO, and established medical institutions. Always note that this is for informational purposes and not medical advice.',
          legal: 'You are a legal researcher. Focus on statutes, case law, legal analyses, and authoritative legal sources. Note jurisdiction-specific information where relevant.',
          news_analysis: 'You are a news analyst. Search across multiple reputable news sources and provide a balanced analysis covering different perspectives. Note publication dates and source credibility.',
          comparison: 'You are a comparison analyst. Search for information about all items being compared and provide a structured comparison with pros, cons, and key differentiators.',
          tutorial: 'You are a tutorial researcher. Find the best tutorials, guides, and how-to resources. Prioritize step-by-step instructions with clear examples.',
        };

        try {
          const context = input.context as string;
          const systemPrompt = contextPrompts[context] ?? `You are researching with a focus on: ${context}. Provide thorough, well-sourced answers.`;

          const options: Record<string, unknown> = { systemPrompt };
          if (input.allowedDomains) options.allowedDomains = input.allowedDomains;
          if (input.excludedDomains) options.excludedDomains = input.excludedDomains;

          const result = await service.search(input.query as string, options);

          let citationsBlock = '';
          if (result.citations && result.citations.length > 0) {
            citationsBlock = '\n\n## Sources\n' + result.citations.map((c, i) =>
              `${i + 1}. [${c.title || c.url}](${c.url})${c.snippet ? ` — ${c.snippet}` : ''}`
            ).join('\n');
          }

          let usageNote = '';
          if (result.usage) {
            usageNote = `\n\n_[xAI ${result.model} | ${context} mode | ${result.usage.inputTokens + result.usage.outputTokens} tokens]_`;
          }

          return {
            success: true,
            output: `${result.answer}${citationsBlock}${usageNote}`,
            data: {
              answer: result.answer,
              citations: result.citations,
              context,
              model: result.model,
              usage: result.usage,
            },
          };
        } catch (err: any) {
          return { success: false, output: `Deep contextual search failed: ${err.message}` };
        }
      },
    },
  ];
}
