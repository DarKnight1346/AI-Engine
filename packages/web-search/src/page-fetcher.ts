import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { DEFAULT_CONFIG } from '@ai-engine/shared';
import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

export class PageFetcher {
  private cache: SearchCache;

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  async getPage(url: string): Promise<{ title: string; content: string; url: string }> {
    const cacheKey = `page:${url}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached as any;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Engine/1.0)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    const html = await response.text();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const result = {
      title: article?.title ?? dom.window.document.title ?? url,
      content: article?.textContent ?? dom.window.document.body?.textContent ?? '',
      url,
    };

    await this.cache.set(cacheKey, result, DEFAULT_CONFIG.webSearch.pageCacheTtlMs);
    return result;
  }
}
