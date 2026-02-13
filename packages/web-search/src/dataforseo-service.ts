import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// DataForSEO API Service
//
// Generic HTTP client for the DataForSEO REST API v3.
// Handles Basic authentication, request wrapping, response unwrapping,
// error handling, and optional Redis caching.
//
// Tier: HEAVY — most expensive, most comprehensive data.
// ---------------------------------------------------------------------------

const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com';

/** Cache TTL: 30 minutes for DataForSEO results (expensive calls) */
const CACHE_TTL = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export interface DataForSeoResult {
  /** Raw result data from the API */
  data: unknown;
  /** Cost of this API call in USD */
  cost: number;
  /** Execution time */
  time: string;
  /** Number of result items */
  resultCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DataForSeoService {
  private cache: SearchCache;
  private login: string | null = null;
  private password: string | null = null;

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  setCredentials(login: string, password: string): void {
    this.login = login;
    this.password = password;
  }

  /**
   * Call any DataForSEO API endpoint.
   *
   * @param endpoint - API path, e.g. '/v3/serp/google/organic/live/advanced'
   * @param params - Task parameters (will be wrapped in an array automatically)
   * @returns Unwrapped result from tasks[0].result
   */
  async call(endpoint: string, params: Record<string, unknown>): Promise<DataForSeoResult> {
    if (!this.login || !this.password) {
      throw new Error('DataForSEO credentials not configured. Add your login and password in Settings → API Keys.');
    }

    // Check cache
    const cacheKey = `dfs:${endpoint}:${JSON.stringify(params)}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached as DataForSeoResult;

    // Build auth header
    const authToken = Buffer.from(`${this.login}:${this.password}`).toString('base64');

    // DataForSEO expects an array of task objects
    const body = JSON.stringify([params]);

    const response = await fetch(`${DATAFORSEO_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`DataForSEO API error (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json() as any;

    // Check top-level status
    if (data.status_code && data.status_code !== 20000) {
      throw new Error(`DataForSEO error ${data.status_code}: ${data.status_message || 'Unknown error'}`);
    }

    // Check task-level status
    const task = data.tasks?.[0];
    if (!task) {
      throw new Error('DataForSEO returned no tasks in response.');
    }

    if (task.status_code && task.status_code !== 20000) {
      throw new Error(`DataForSEO task error ${task.status_code}: ${task.status_message || 'Unknown error'}`);
    }

    const result: DataForSeoResult = {
      data: task.result ?? [],
      cost: task.cost ?? data.cost ?? 0,
      time: task.time ?? data.time ?? '',
      resultCount: task.result_count ?? 0,
    };

    // Cache the result
    await this.cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }
}
