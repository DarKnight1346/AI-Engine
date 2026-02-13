import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Serper.dev Search Service
//
// Wraps the Serper.dev Google Search API with support for all search types:
//   Search, Images, Videos, Places, Maps, Reviews, News, Shopping,
//   Lens (reverse image search), Scholar, Patents, Autocomplete, Webpage
// ---------------------------------------------------------------------------

const SERPER_BASE_URL = 'https://google.serper.dev';

/** Cache TTL: 10 minutes for search results, 30 minutes for pages */
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const PAGE_CACHE_TTL = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Result types for different search endpoints
// ---------------------------------------------------------------------------

export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
  date?: string;
  sitelinks?: Array<{ title: string; link: string }>;
}

export interface SerperImageResult {
  title: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  thumbnailUrl: string;
  source: string;
  domain: string;
  link: string;
  googleUrl: string;
}

export interface SerperVideoResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  imageUrl?: string;
  duration?: string;
  channel?: string;
}

export interface SerperPlaceResult {
  title: string;
  address: string;
  cid?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
  category?: string;
  phoneNumber?: string;
  website?: string;
}

export interface SerperMapResult {
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  cid?: string;
  rating?: number;
  ratingCount?: number;
  category?: string;
  phoneNumber?: string;
  website?: string;
  thumbnailUrl?: string;
}

export interface SerperReviewResult {
  title: string;
  link: string;
  source: string;
  rating?: number;
  ratingCount?: number;
  snippet?: string;
  date?: string;
}

export interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date: string;
  source: string;
  imageUrl?: string;
}

export interface SerperShoppingResult {
  title: string;
  source: string;
  link: string;
  price: string;
  imageUrl?: string;
  rating?: number;
  ratingCount?: number;
  delivery?: string;
}

export interface SerperLensResult {
  title: string;
  link: string;
  source: string;
  thumbnailUrl?: string;
}

export interface SerperScholarResult {
  title: string;
  link: string;
  snippet: string;
  publicationInfo?: string;
  year?: string;
  citedBy?: number;
}

export interface SerperPatentResult {
  title: string;
  link: string;
  snippet: string;
  publicationNumber?: string;
  inventor?: string;
  assignee?: string;
  filingDate?: string;
  publicationDate?: string;
}

export interface SerperAutocompleteResult {
  suggestions: string[];
}

export interface SerperWebpageResult {
  title: string;
  text: string;
  markdown: string;
  url: string;
  statusCode: number;
  credits: number;
}

// ---------------------------------------------------------------------------
// Common options
// ---------------------------------------------------------------------------

export interface SerperSearchOptions {
  /** Number of results to return (default 10) */
  num?: number;
  /** Page number for pagination (default 1) */
  page?: number;
  /** Country code (e.g., 'us', 'gb', 'de') */
  gl?: string;
  /** Language code (e.g., 'en', 'fr', 'de') */
  hl?: string;
  /** Time period filter: 'qdr:h' (hour), 'qdr:d' (day), 'qdr:w' (week), 'qdr:m' (month), 'qdr:y' (year) */
  tbs?: string;
  /** Location string, e.g. "New York, NY" */
  location?: string;
  /** Auto-correct the query (default true) */
  autocorrect?: boolean;
}

export type SerperEndpoint =
  | 'search'
  | 'images'
  | 'videos'
  | 'places'
  | 'maps'
  | 'reviews'
  | 'news'
  | 'shopping'
  | 'lens'
  | 'scholar'
  | 'patents'
  | 'autocomplete'
  | 'webpage';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WebSearchService {
  private cache: SearchCache;
  private apiKey: string | null = null;

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  // ── Core request method ──────────────────────────────────────────────

  private async serperRequest(
    endpoint: SerperEndpoint,
    body: Record<string, unknown>,
    cacheTtl: number = SEARCH_CACHE_TTL,
  ): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error('Serper API key not configured. Add your API key in Settings → API Keys.');
    }

    const cacheKey = `serper:${endpoint}:${JSON.stringify(body)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const url = endpoint === 'webpage'
      ? `${SERPER_BASE_URL}/${endpoint}`
      : `${SERPER_BASE_URL}/${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Serper API error (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();
    await this.cache.set(cacheKey, data, cacheTtl);
    return data;
  }

  // ── Search (Google Web Search) ───────────────────────────────────────

  async search(query: string, options: SerperSearchOptions = {}): Promise<SerperSearchResult[]> {
    const data = await this.serperRequest('search', { q: query, ...options }) as any;
    return (data.organic ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      position: r.position,
      date: r.date,
      sitelinks: r.sitelinks,
    }));
  }

  // ── Images ───────────────────────────────────────────────────────────

  async images(query: string, options: SerperSearchOptions = {}): Promise<SerperImageResult[]> {
    const data = await this.serperRequest('images', { q: query, ...options }) as any;
    return (data.images ?? []).map((r: any) => ({
      title: r.title ?? '',
      imageUrl: r.imageUrl ?? '',
      imageWidth: r.imageWidth ?? 0,
      imageHeight: r.imageHeight ?? 0,
      thumbnailUrl: r.thumbnailUrl ?? '',
      source: r.source ?? '',
      domain: r.domain ?? '',
      link: r.link ?? '',
      googleUrl: r.googleUrl ?? '',
    }));
  }

  // ── Videos ───────────────────────────────────────────────────────────

  async videos(query: string, options: SerperSearchOptions = {}): Promise<SerperVideoResult[]> {
    const data = await this.serperRequest('videos', { q: query, ...options }) as any;
    return (data.videos ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      date: r.date,
      imageUrl: r.imageUrl,
      duration: r.duration,
      channel: r.channel,
    }));
  }

  // ── Places ───────────────────────────────────────────────────────────

  async places(query: string, options: SerperSearchOptions = {}): Promise<SerperPlaceResult[]> {
    const data = await this.serperRequest('places', { q: query, ...options }) as any;
    return (data.places ?? []).map((r: any) => ({
      title: r.title ?? '',
      address: r.address ?? '',
      cid: r.cid,
      latitude: r.latitude,
      longitude: r.longitude,
      rating: r.rating,
      ratingCount: r.ratingCount,
      category: r.category,
      phoneNumber: r.phoneNumber,
      website: r.website,
    }));
  }

  // ── Maps ─────────────────────────────────────────────────────────────

  async maps(query: string, options: SerperSearchOptions = {}): Promise<SerperMapResult[]> {
    const data = await this.serperRequest('maps', { q: query, ...options }) as any;
    return (data.places ?? []).map((r: any) => ({
      title: r.title ?? '',
      address: r.address ?? '',
      latitude: r.latitude ?? 0,
      longitude: r.longitude ?? 0,
      cid: r.cid,
      rating: r.rating,
      ratingCount: r.ratingCount,
      category: r.category,
      phoneNumber: r.phoneNumber,
      website: r.website,
      thumbnailUrl: r.thumbnailUrl,
    }));
  }

  // ── Reviews ──────────────────────────────────────────────────────────

  async reviews(query: string, options: SerperSearchOptions = {}): Promise<SerperReviewResult[]> {
    const data = await this.serperRequest('reviews', { q: query, ...options }) as any;
    return (data.reviews ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      source: r.source ?? '',
      rating: r.rating,
      ratingCount: r.ratingCount,
      snippet: r.snippet,
      date: r.date,
    }));
  }

  // ── News ─────────────────────────────────────────────────────────────

  async news(query: string, options: SerperSearchOptions = {}): Promise<SerperNewsResult[]> {
    const data = await this.serperRequest('news', { q: query, ...options }) as any;
    return (data.news ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      date: r.date ?? '',
      source: r.source ?? '',
      imageUrl: r.imageUrl,
    }));
  }

  // ── Shopping ─────────────────────────────────────────────────────────

  async shopping(query: string, options: SerperSearchOptions = {}): Promise<SerperShoppingResult[]> {
    const data = await this.serperRequest('shopping', { q: query, ...options }) as any;
    return (data.shopping ?? []).map((r: any) => ({
      title: r.title ?? '',
      source: r.source ?? '',
      link: r.link ?? '',
      price: r.price ?? '',
      imageUrl: r.imageUrl,
      rating: r.rating,
      ratingCount: r.ratingCount,
      delivery: r.delivery,
    }));
  }

  // ── Lens (Reverse Image Search) ──────────────────────────────────────

  async lens(imageUrl: string, options: SerperSearchOptions = {}): Promise<SerperLensResult[]> {
    const data = await this.serperRequest('lens', { url: imageUrl, ...options }) as any;
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      source: r.source ?? '',
      thumbnailUrl: r.thumbnailUrl,
    }));
  }

  // ── Scholar ──────────────────────────────────────────────────────────

  async scholar(query: string, options: SerperSearchOptions = {}): Promise<SerperScholarResult[]> {
    const data = await this.serperRequest('scholar', { q: query, ...options }) as any;
    return (data.organic ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      publicationInfo: r.publicationInfo?.summary,
      year: r.year,
      citedBy: r.citedBy,
    }));
  }

  // ── Patents ──────────────────────────────────────────────────────────

  async patents(query: string, options: SerperSearchOptions = {}): Promise<SerperPatentResult[]> {
    const data = await this.serperRequest('patents', { q: query, ...options }) as any;
    return (data.organic ?? []).map((r: any) => ({
      title: r.title ?? '',
      link: r.link ?? '',
      snippet: r.snippet ?? '',
      publicationNumber: r.publicationNumber,
      inventor: r.inventor,
      assignee: r.assignee,
      filingDate: r.filingDate,
      publicationDate: r.publicationDate,
    }));
  }

  // ── Autocomplete ─────────────────────────────────────────────────────

  async autocomplete(query: string, options: Pick<SerperSearchOptions, 'gl' | 'hl'> = {}): Promise<string[]> {
    const data = await this.serperRequest('autocomplete', { q: query, ...options }) as any;
    return (data.suggestions ?? []).map((s: any) => (typeof s === 'string' ? s : s.value ?? ''));
  }

  // ── Webpage (Scrape) ─────────────────────────────────────────────────

  async webpage(url: string): Promise<SerperWebpageResult> {
    const data = await this.serperRequest('webpage', { url }, PAGE_CACHE_TTL) as any;
    return {
      title: data.title ?? '',
      text: data.text ?? '',
      markdown: data.markdown ?? '',
      url: data.url ?? url,
      statusCode: data.statusCode ?? 200,
      credits: data.credits ?? 0,
    };
  }
}
