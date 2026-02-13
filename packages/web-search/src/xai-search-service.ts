import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// xAI Web Search Service
//
// Uses the xAI Responses API with the built-in `web_search` tool to perform
// AI-powered web research via Grok. Unlike Serper (which returns raw Google
// results), xAI searches the web AND synthesizes a comprehensive answer with
// citations — making it ideal for complex or multi-faceted queries.
//
// Tier: MEDIUM weight — more expensive than Serper, cheaper than deep research.
// ---------------------------------------------------------------------------

const XAI_BASE_URL = 'https://api.x.ai/v1';

/** Default model for xAI web search.
 * grok-3-mini is the stable alias for the latest Grok 3 Mini.
 * The Responses API with web_search tool requires a model that supports
 * server-side agentic tools — grok-3-mini and grok-4* models do. */
const DEFAULT_MODEL = 'grok-3-mini';

/** Cache TTL: 15 minutes for AI-synthesized results */
const CACHE_TTL = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface XaiSearchOptions {
  /** Model to use (default: grok-3-mini-fast) */
  model?: string;
  /** Only search within these domains (max 5) */
  allowedDomains?: string[];
  /** Exclude these domains from search (max 5) */
  excludedDomains?: string[];
  /** Enable analysis of images found during browsing */
  enableImageUnderstanding?: boolean;
  /** Additional system instructions to guide the search */
  systemPrompt?: string;
}

export interface XaiSearchResult {
  /** The AI-synthesized answer */
  answer: string;
  /** Citations / sources used */
  citations: Array<{
    title?: string;
    url: string;
    snippet?: string;
  }>;
  /** The model that was used */
  model: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class XaiSearchService {
  private cache: SearchCache;
  private apiKey: string | null = null;

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Perform an AI-powered web search using xAI's Grok model.
   *
   * The model searches the web, reads pages, and synthesizes a comprehensive
   * answer with citations. Best for complex queries that need analysis.
   */
  async search(query: string, options: XaiSearchOptions = {}): Promise<XaiSearchResult> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → API Keys.');
    }

    // Check cache
    const cacheKey = `xai:search:${query}:${JSON.stringify(options)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached as XaiSearchResult;

    const model = options.model ?? DEFAULT_MODEL;

    // Build the web_search tool config.
    // Per xAI docs, allowed_domains / excluded_domains / enable_image_understanding
    // are direct properties on the tool object (not nested under "filters").
    const webSearchTool: Record<string, unknown> = {
      type: 'web_search',
    };

    // Domain filtering (max 5 each, mutually exclusive)
    if (options.allowedDomains && options.allowedDomains.length > 0) {
      webSearchTool.allowed_domains = options.allowedDomains.slice(0, 5);
    } else if (options.excludedDomains && options.excludedDomains.length > 0) {
      webSearchTool.excluded_domains = options.excludedDomains.slice(0, 5);
    }

    // Image understanding
    if (options.enableImageUnderstanding) {
      webSearchTool.enable_image_understanding = true;
    }

    // Build the request
    const requestBody: Record<string, unknown> = {
      model,
      input: [
        ...(options.systemPrompt
          ? [{ role: 'system', content: options.systemPrompt }]
          : []),
        {
          role: 'user',
          content: query,
        },
      ],
      tools: [webSearchTool],
    };

    const response = await fetch(`${XAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      // Parse structured error if available
      let detail = errorText || response.statusText;
      try {
        const errJson = JSON.parse(errorText);
        detail = errJson.error?.message || errJson.detail || errJson.message || detail;
      } catch { /* use raw text */ }
      throw new Error(`xAI API error (${response.status}): ${detail}`);
    }

    const data = await response.json() as any;

    // Extract the answer text from the response output
    let answer = '';
    if (data.output_text) {
      answer = data.output_text;
    } else if (data.output && Array.isArray(data.output)) {
      // The responses API returns output as an array of items
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const part of item.content) {
            if (part.type === 'output_text' || part.type === 'text') {
              answer += part.text ?? '';
            }
          }
        }
      }
    }

    // Extract citations
    const citations: XaiSearchResult['citations'] = [];
    if (data.citations && Array.isArray(data.citations)) {
      for (const cite of data.citations) {
        citations.push({
          title: cite.title,
          url: cite.url ?? cite.link ?? '',
          snippet: cite.snippet ?? cite.text,
        });
      }
    }

    // Extract usage
    let usage: XaiSearchResult['usage'];
    if (data.usage) {
      usage = {
        inputTokens: data.usage.input_tokens ?? data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      };
    }

    const result: XaiSearchResult = {
      answer: answer || 'No answer generated.',
      citations,
      model,
      usage,
    };

    await this.cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }
}
