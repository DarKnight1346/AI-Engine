import type { WebSearchResult, WebSearchOptions } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';
import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

export class WebSearchService {
  private cache: SearchCache;
  private apiKey: string | null = null;
  private baseUrl = 'https://api.search.brave.com/res/v1';

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async webSearch(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    if (!this.apiKey) throw new Error('Brave Search API key not configured');

    const cacheKey = `search:${query}:${JSON.stringify(options)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached as WebSearchResult[];

    const count = options.count ?? DEFAULT_CONFIG.webSearch.defaultResultCount;
    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });
    if (options.freshness) params.set('freshness', options.freshness === 'day' ? 'pd' : options.freshness === 'week' ? 'pw' : 'pm');
    if (options.country) params.set('country', options.country);

    const response = await fetch(`${this.baseUrl}/web/search?${params}`, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': this.apiKey },
    });

    if (!response.ok) throw new Error(`Brave Search API error: ${response.status}`);
    const data = await response.json() as any;

    const results: WebSearchResult[] = (data.web?.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? '',
    }));

    await this.cache.set(cacheKey, results, DEFAULT_CONFIG.webSearch.searchCacheTtlMs);
    return results;
  }

  async webSearchNews(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    if (!this.apiKey) throw new Error('Brave Search API key not configured');

    const cacheKey = `news:${query}:${JSON.stringify(options)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached as WebSearchResult[];

    const count = options.count ?? DEFAULT_CONFIG.webSearch.defaultResultCount;
    const params = new URLSearchParams({ q: query, count: String(count) });

    const response = await fetch(`${this.baseUrl}/news/search?${params}`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': this.apiKey },
    });

    if (!response.ok) throw new Error(`Brave News API error: ${response.status}`);
    const data = await response.json() as any;

    const results: WebSearchResult[] = (data.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? '',
      publishedDate: r.age,
      source: r.meta_url?.hostname,
    }));

    await this.cache.set(cacheKey, results, DEFAULT_CONFIG.webSearch.searchCacheTtlMs);
    return results;
  }
}
