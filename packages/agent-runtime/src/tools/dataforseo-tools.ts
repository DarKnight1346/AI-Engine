import type { Tool, ToolResult } from '../types.js';
import type { ToolManifestEntry } from '../tool-index.js';

// ---------------------------------------------------------------------------
// DataForSEO Tools — Tier 3 Deep Research (Config-Driven Factory)
//
// Every DataForSEO API endpoint is defined as a compact config object.
// The factory function `createDataForSeoTools()` converts them into
// executable `Tool` objects, and `getDataForSeoManifest()` produces
// the `ToolManifestEntry[]` for discovery via `discover_tools`.
//
// The agent MUST use Tier 1 (Serper) or Tier 2 (xAI) first.
// Tier 3 is only for deep SEO research, keyword data, backlink
// analysis, competitor research, and other heavy-duty tasks.
// ---------------------------------------------------------------------------

// ═══════════════════════════════════════════════════════════════════════════
// Service interface
// ═══════════════════════════════════════════════════════════════════════════

export interface DataForSeoServiceLike {
  call(endpoint: string, params: Record<string, unknown>): Promise<{
    data: unknown;
    cost: number;
    time: string;
    resultCount: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool definition schema
// ═══════════════════════════════════════════════════════════════════════════

interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description: string;
  items?: { type: string };
}

interface DataForSeoToolDef {
  name: string;
  description: string;
  endpoint: string;
  category: string;
  params: ParamDef[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared parameter templates
// ═══════════════════════════════════════════════════════════════════════════

const P_KEYWORD: ParamDef = { name: 'keyword', type: 'string', required: true, description: 'Search keyword or phrase' };
const P_KEYWORDS: ParamDef = { name: 'keywords', type: 'array', required: true, description: 'Array of keywords', items: { type: 'string' } };
const P_LOCATION: ParamDef = { name: 'location_name', type: 'string', description: 'Location name, e.g. "United States", "London,England,United Kingdom"' };
const P_LOCATION_CODE: ParamDef = { name: 'location_code', type: 'number', description: 'Location code, e.g. 2840 for US' };
const P_LANGUAGE: ParamDef = { name: 'language_code', type: 'string', description: 'Language code, e.g. "en"' };
const P_DEPTH: ParamDef = { name: 'depth', type: 'number', description: 'Number of results to return (default 10, max varies)' };
const P_DEVICE: ParamDef = { name: 'device', type: 'string', description: '"desktop" or "mobile" (default desktop)' };
const P_TARGET: ParamDef = { name: 'target', type: 'string', required: true, description: 'Target domain, e.g. "example.com"' };
const P_TARGET_OPT: ParamDef = { name: 'target', type: 'string', description: 'Target domain, e.g. "example.com"' };
const P_URL: ParamDef = { name: 'url', type: 'string', required: true, description: 'Full URL to analyze' };
const P_TAG: ParamDef = { name: 'tag', type: 'string', description: 'Custom tag to identify this request' };
const P_LIMIT: ParamDef = { name: 'limit', type: 'number', description: 'Max number of results to return' };
const P_OFFSET: ParamDef = { name: 'offset', type: 'number', description: 'Offset for pagination' };
const P_FILTERS: ParamDef = { name: 'filters', type: 'array', description: 'Array of filter conditions' };
const P_ORDER_BY: ParamDef = { name: 'order_by', type: 'array', description: 'Array of ordering rules, e.g. ["search_volume,desc"]' };

const SERP_COMMON: ParamDef[] = [P_KEYWORD, P_LOCATION, P_LOCATION_CODE, P_LANGUAGE, P_DEPTH, P_DEVICE];
const KW_COMMON: ParamDef[] = [P_LOCATION, P_LOCATION_CODE, P_LANGUAGE];

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — All ~122 endpoints
// ═══════════════════════════════════════════════════════════════════════════

const TOOL_DEFS: DataForSeoToolDef[] = [

  // ─── SERP API: Google ──────────────────────────────────────────────────

  { name: 'seoGoogleSearch', description: '[Tier 3 — heavy/expensive] Google organic SERP results with full rich data — featured snippets, knowledge graph, people also ask, sitelinks, ratings, etc. Use for deep SERP analysis only when Tier 1/2 are insufficient.', endpoint: '/v3/serp/google/organic/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TARGET_OPT, P_TAG] },
  { name: 'seoGoogleAiMode', description: '[Tier 3] Google AI Mode search results. Returns AI-generated overviews and source citations from Google AI search.', endpoint: '/v3/serp/google/ai_mode/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleMaps', description: '[Tier 3] Google Maps SERP results with ratings, reviews, addresses, phone numbers, and coordinates for local businesses.', endpoint: '/v3/serp/google/maps/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleLocalFinder', description: '[Tier 3] Google Local Finder results — expanded local pack with detailed business listings, hours, and reviews.', endpoint: '/v3/serp/google/local_finder/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleNews', description: '[Tier 3] Google News SERP results with full article metadata, sources, dates, and thumbnails.', endpoint: '/v3/serp/google/news/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleEvents', description: '[Tier 3] Google Events SERP results — event listings with dates, venues, prices, and links.', endpoint: '/v3/serp/google/events/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleImages', description: '[Tier 3] Google Images SERP results with image URLs, dimensions, sources, and related metadata.', endpoint: '/v3/serp/google/images/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleAutocomplete', description: '[Tier 3] Google Autocomplete suggestions with rich data including types and categories.', endpoint: '/v3/serp/google/autocomplete/live/advanced', category: 'seo-serp', params: [P_KEYWORD, P_LOCATION, P_LOCATION_CODE, P_LANGUAGE, P_TAG] },
  { name: 'seoGoogleDatasetSearch', description: '[Tier 3] Google Dataset Search results — find public datasets with descriptions, providers, and download links.', endpoint: '/v3/serp/google/dataset_search/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleDatasetInfo', description: '[Tier 3] Google Dataset Info — detailed metadata about a specific dataset found via dataset search.', endpoint: '/v3/serp/google/dataset_info/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleAdsSearch', description: '[Tier 3] Google Ads search results — paid ad listings with headlines, descriptions, display URLs, and sitelinks.', endpoint: '/v3/serp/google/ads_search/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleAdsAdvertisers', description: '[Tier 3] Google Ads Advertisers — find advertisers for a keyword with ad history and transparency data.', endpoint: '/v3/serp/google/ads_advertisers/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleFinanceExplore', description: '[Tier 3] Google Finance Explore — market trends, stock indices, and financial overviews.', endpoint: '/v3/serp/google/finance_explore/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleFinanceMarkets', description: '[Tier 3] Google Finance Markets — market indices, gainers, losers, and sector performance.', endpoint: '/v3/serp/google/finance_markets/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleFinanceQuote', description: '[Tier 3] Google Finance Quote — stock/ticker quote with price, change, volume, and chart data.', endpoint: '/v3/serp/google/finance_quote/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoGoogleFinanceTicker', description: '[Tier 3] Google Finance Ticker Search — search for stocks, ETFs, indices by name or ticker symbol.', endpoint: '/v3/serp/google/finance_ticker_search/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },

  // ─── SERP API: Bing, YouTube, Yahoo ────────────────────────────────────

  { name: 'seoBingSearch', description: '[Tier 3] Bing organic SERP results with full rich data — similar to Google but from Bing search engine.', endpoint: '/v3/serp/bing/organic/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoYoutubeSearch', description: '[Tier 3] YouTube search results with video metadata — titles, channels, views, durations, and thumbnails.', endpoint: '/v3/serp/youtube/organic/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },
  { name: 'seoYoutubeVideoInfo', description: '[Tier 3] YouTube Video Info — detailed video metadata including description, statistics, channel info, and tags.', endpoint: '/v3/serp/youtube/video_info/live/advanced', category: 'seo-serp', params: [{ name: 'video_id', type: 'string', required: true, description: 'YouTube video ID' }, P_TAG] },
  { name: 'seoYoutubeVideoComments', description: '[Tier 3] YouTube Video Comments — comments on a video with authors, likes, dates, and reply counts.', endpoint: '/v3/serp/youtube/video_comments/live/advanced', category: 'seo-serp', params: [{ name: 'video_id', type: 'string', required: true, description: 'YouTube video ID' }, P_TAG] },
  { name: 'seoYoutubeVideoSubtitles', description: '[Tier 3] YouTube Video Subtitles — extract subtitles/transcripts from a YouTube video.', endpoint: '/v3/serp/youtube/video_subtitles/live/advanced', category: 'seo-serp', params: [{ name: 'video_id', type: 'string', required: true, description: 'YouTube video ID' }, P_TAG] },
  { name: 'seoYahooSearch', description: '[Tier 3] Yahoo organic SERP results with full data.', endpoint: '/v3/serp/yahoo/organic/live/advanced', category: 'seo-serp', params: [...SERP_COMMON, P_TAG] },

  // ─── Keywords Data API: Google Ads ─────────────────────────────────────

  { name: 'seoKeywordVolume', description: '[Tier 3] Google Ads keyword search volume, CPC, and competition data. Provide an array of keywords to get monthly search volume, cost-per-click, and competition level.', endpoint: '/v3/keywords_data/google_ads/search_volume/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoKeywordsForSite', description: '[Tier 3] Google Ads keywords for a domain — discover which keywords a site ranks for in paid search with volume and CPC data.', endpoint: '/v3/keywords_data/google_ads/keywords_for_site/live', category: 'seo-keywords', params: [P_TARGET, ...KW_COMMON] },
  { name: 'seoKeywordsForKeywords', description: '[Tier 3] Google Ads keyword suggestions — get related keyword ideas with volume, CPC, and competition based on seed keywords.', endpoint: '/v3/keywords_data/google_ads/keywords_for_keywords/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoAdTrafficByKeywords', description: '[Tier 3] Estimate ad traffic for keywords — projected clicks, impressions, CPC, and cost at various bid levels.', endpoint: '/v3/keywords_data/google_ads/ad_traffic_by_keywords/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON, { name: 'bid', type: 'number', description: 'Max CPC bid in USD' }] },

  // ─── Keywords Data API: Bing ───────────────────────────────────────────

  { name: 'seoBingKeywordVolume', description: '[Tier 3] Bing keyword search volume data for an array of keywords.', endpoint: '/v3/keywords_data/bing/search_volume/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoBingKeywordsForSite', description: '[Tier 3] Bing keywords for a domain with volume data.', endpoint: '/v3/keywords_data/bing/keywords_for_site/live', category: 'seo-keywords', params: [P_TARGET, ...KW_COMMON] },
  { name: 'seoBingKeywordsForKeywords', description: '[Tier 3] Bing keyword suggestions based on seed keywords.', endpoint: '/v3/keywords_data/bing/keywords_for_keywords/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoBingKeywordPerformance', description: '[Tier 3] Bing keyword performance metrics — impressions, clicks, CTR, and average position.', endpoint: '/v3/keywords_data/bing/keyword_performance/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoBingKeywordSuggestionsUrl', description: '[Tier 3] Bing keyword suggestions for a URL — discover keywords relevant to a specific page.', endpoint: '/v3/keywords_data/bing/keyword_suggestions_for_url/live', category: 'seo-keywords', params: [P_URL, ...KW_COMMON] },
  { name: 'seoBingAudienceEstimation', description: '[Tier 3] Bing audience estimation — estimate audience size and demographics for keywords.', endpoint: '/v3/keywords_data/bing/audience_estimation/live', category: 'seo-keywords', params: [P_KEYWORDS, ...KW_COMMON] },

  // ─── Keywords Data API: Google Trends ──────────────────────────────────

  { name: 'seoGoogleTrends', description: '[Tier 3] Google Trends data — interest over time, by region, and related queries for up to 5 keywords.', endpoint: '/v3/keywords_data/google_trends/explore/live', category: 'seo-keywords', params: [P_KEYWORDS, P_LOCATION, P_LANGUAGE, { name: 'type', type: 'string', description: '"web_search", "news_search", "google_shopping", "youtube_search"' }, { name: 'time_range', type: 'string', description: 'e.g. "past_hour", "past_4_hours", "past_day", "past_7_days", "past_30_days", "past_90_days", "past_12_months", "past_5_years"' }] },

  // ─── DataForSEO Labs API: Keyword Research ─────────────────────────────

  { name: 'seoLabsKeywordsForSite', description: '[Tier 3] SEO keywords a domain ranks for — organic positions, traffic, CPC, and difficulty for all ranking keywords.', endpoint: '/v3/dataforseo_labs/google/keywords_for_site/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY] },
  { name: 'seoLabsRelatedKeywords', description: '[Tier 3] Related keywords — semantically related keywords with search volume, difficulty, and SERP features.', endpoint: '/v3/dataforseo_labs/google/related_keywords/live', category: 'seo-labs', params: [P_KEYWORD, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsKeywordSuggestions', description: '[Tier 3] Keyword suggestions — seed-based keyword ideas with volume, difficulty, and competition.', endpoint: '/v3/dataforseo_labs/google/keyword_suggestions/live', category: 'seo-labs', params: [P_KEYWORD, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsKeywordIdeas', description: '[Tier 3] Keyword ideas — broad keyword discovery combining related keywords, suggestions, and questions.', endpoint: '/v3/dataforseo_labs/google/keyword_ideas/live', category: 'seo-labs', params: [P_KEYWORD, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsBulkKeywordDifficulty', description: '[Tier 3] Bulk keyword difficulty scores — SEO difficulty (0-100) for multiple keywords at once.', endpoint: '/v3/dataforseo_labs/google/bulk_keyword_difficulty/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoLabsSearchIntent', description: '[Tier 3] Classify search intent for keywords — commercial, informational, navigational, or transactional.', endpoint: '/v3/dataforseo_labs/google/search_intent/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoLabsKeywordOverview', description: '[Tier 3] Keyword overview — comprehensive data for keywords including volume, CPC, difficulty, SERP features, and trend.', endpoint: '/v3/dataforseo_labs/google/keyword_overview/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoLabsHistoricalKeywordData', description: '[Tier 3] Historical keyword data — monthly search volume and other metrics over time.', endpoint: '/v3/dataforseo_labs/google/historical_keyword_data/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },

  // ─── DataForSEO Labs API: Market Analysis ──────────────────────────────

  { name: 'seoLabsTopSearches', description: '[Tier 3] Top searches — trending and popular searches by category and location.', endpoint: '/v3/dataforseo_labs/google/top_searches/live', category: 'seo-labs', params: [...KW_COMMON, { name: 'category_code', type: 'number', description: 'Category code to filter results' }] },
  { name: 'seoLabsCategoriesForDomain', description: '[Tier 3] Categories for a domain — discover which content categories a domain ranks in.', endpoint: '/v3/dataforseo_labs/google/categories_for_domain/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON] },
  { name: 'seoLabsCategoriesForKeywords', description: '[Tier 3] Categories for keywords — find which categories a set of keywords belongs to.', endpoint: '/v3/dataforseo_labs/google/categories_for_keywords/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoLabsKeywordsForCategories', description: '[Tier 3] Keywords for categories — get keywords associated with specific content categories.', endpoint: '/v3/dataforseo_labs/google/keywords_for_categories/live', category: 'seo-labs', params: [...KW_COMMON, { name: 'category_codes', type: 'array', required: true, description: 'Array of category codes', items: { type: 'number' } }, P_LIMIT] },
  { name: 'seoLabsDomainMetricsByCategories', description: '[Tier 3] Domain metrics by categories — traffic and ranking metrics broken down by content category.', endpoint: '/v3/dataforseo_labs/google/domain_metrics_by_categories/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON] },

  // ─── DataForSEO Labs API: Competitor Research ──────────────────────────

  { name: 'seoLabsSerpCompetitors', description: '[Tier 3] SERP competitors — find domains competing for the same keywords in organic search.', endpoint: '/v3/dataforseo_labs/google/serp_competitors/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsRankedKeywords', description: '[Tier 3] Ranked keywords — all keywords a domain ranks for with positions, URLs, search volume, and traffic.', endpoint: '/v3/dataforseo_labs/google/ranked_keywords/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY] },
  { name: 'seoLabsCompetitorsDomain', description: '[Tier 3] Competitor domains — find direct SEO competitors based on keyword overlap.', endpoint: '/v3/dataforseo_labs/google/competitors_domain/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsDomainIntersection', description: '[Tier 3] Domain intersection — find keywords shared between two or more domains.', endpoint: '/v3/dataforseo_labs/google/domain_intersection/live', category: 'seo-labs', params: [{ name: 'targets', type: 'object', required: true, description: 'Object mapping domain indices to domains, e.g. {"1":"domain1.com","2":"domain2.com"}' }, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsSubdomains', description: '[Tier 3] Subdomains — discover all subdomains of a domain with their SEO metrics.', endpoint: '/v3/dataforseo_labs/google/subdomains/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsRelevantPages', description: '[Tier 3] Relevant pages — find the most important pages of a domain by organic traffic and keywords.', endpoint: '/v3/dataforseo_labs/google/relevant_pages/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsDomainRankOverview', description: '[Tier 3] Domain rank overview — domain authority, organic traffic, keywords count, and top-level SEO metrics.', endpoint: '/v3/dataforseo_labs/google/domain_rank_overview/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON] },
  { name: 'seoLabsHistoricalSERPs', description: '[Tier 3] Historical SERPs — see how search results for a keyword changed over time.', endpoint: '/v3/dataforseo_labs/google/historical_serps/live', category: 'seo-labs', params: [P_KEYWORD, ...KW_COMMON] },
  { name: 'seoLabsHistoricalRankOverview', description: '[Tier 3] Historical rank overview — track a domain\'s SEO metrics over time.', endpoint: '/v3/dataforseo_labs/google/historical_rank_overview/live', category: 'seo-labs', params: [P_TARGET, ...KW_COMMON] },
  { name: 'seoLabsPageIntersection', description: '[Tier 3] Page intersection — find keywords shared between specific pages (not just domains).', endpoint: '/v3/dataforseo_labs/google/page_intersection/live', category: 'seo-labs', params: [{ name: 'pages', type: 'object', required: true, description: 'Object mapping indices to page URLs' }, ...KW_COMMON, P_LIMIT, P_FILTERS] },
  { name: 'seoLabsBulkTrafficEstimation', description: '[Tier 3] Bulk traffic estimation — estimate organic traffic for multiple domains at once.', endpoint: '/v3/dataforseo_labs/google/bulk_traffic_estimation/live', category: 'seo-labs', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of domains to estimate traffic for', items: { type: 'string' } }, ...KW_COMMON] },

  // ─── DataForSEO Labs API: Amazon ───────────────────────────────────────

  { name: 'seoLabsAmazonBulkVolume', description: '[Tier 3] Amazon bulk search volume — search volume data for Amazon keywords.', endpoint: '/v3/dataforseo_labs/amazon/bulk_search_volume/live', category: 'seo-labs', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoLabsAmazonRelatedKeywords', description: '[Tier 3] Amazon related keywords — find related Amazon search terms.', endpoint: '/v3/dataforseo_labs/amazon/related_keywords/live', category: 'seo-labs', params: [P_KEYWORD, ...KW_COMMON, P_LIMIT] },
  { name: 'seoLabsAmazonRankedKeywords', description: '[Tier 3] Amazon ranked keywords — keywords a product ranks for on Amazon.', endpoint: '/v3/dataforseo_labs/amazon/ranked_keywords/live', category: 'seo-labs', params: [{ name: 'asin', type: 'string', required: true, description: 'Amazon Standard Identification Number' }, ...KW_COMMON, P_LIMIT] },

  // ─── Backlinks API ─────────────────────────────────────────────────────

  { name: 'seoBacklinksSummary', description: '[Tier 3] Backlinks summary — total backlinks, referring domains, domain rank, and trust metrics for a domain.', endpoint: '/v3/backlinks/summary/live', category: 'seo-backlinks', params: [P_TARGET, P_TAG] },
  { name: 'seoBacklinksHistory', description: '[Tier 3] Backlinks history — historical backlink and referring domain counts over time.', endpoint: '/v3/backlinks/history/live', category: 'seo-backlinks', params: [P_TARGET, { name: 'date_from', type: 'string', description: 'Start date YYYY-MM-DD' }, { name: 'date_to', type: 'string', description: 'End date YYYY-MM-DD' }, P_TAG] },
  { name: 'seoBacklinks', description: '[Tier 3] Get backlinks — individual backlinks pointing to a domain/page with anchor text, source, type, and metrics.', endpoint: '/v3/backlinks/backlinks/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY, P_TAG] },
  { name: 'seoBacklinksAnchors', description: '[Tier 3] Backlink anchors — anchor text distribution for backlinks pointing to a domain.', endpoint: '/v3/backlinks/anchors/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY, P_TAG] },
  { name: 'seoBacklinksDomainPages', description: '[Tier 3] Domain pages — pages of a domain with their backlink metrics.', endpoint: '/v3/backlinks/domain_pages/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY, P_TAG] },
  { name: 'seoBacklinksDomainPagesSummary', description: '[Tier 3] Domain pages summary — aggregated backlink metrics for pages of a domain.', endpoint: '/v3/backlinks/domain_pages_summary/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_TAG] },
  { name: 'seoBacklinksReferringDomains', description: '[Tier 3] Referring domains — list of domains linking to the target with metrics and link counts.', endpoint: '/v3/backlinks/referring_domains/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY, P_TAG] },
  { name: 'seoBacklinksReferringNetworks', description: '[Tier 3] Referring networks — IP networks and subnets linking to the target.', endpoint: '/v3/backlinks/referring_networks/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_TAG] },
  { name: 'seoBacklinksCompetitors', description: '[Tier 3] Backlink competitors — find domains competing for the same backlinks.', endpoint: '/v3/backlinks/competitors/live', category: 'seo-backlinks', params: [P_TARGET, P_LIMIT, P_OFFSET, P_FILTERS, P_TAG] },
  { name: 'seoBacklinksDomainIntersection', description: '[Tier 3] Backlink domain intersection — find domains linking to one target but not another.', endpoint: '/v3/backlinks/domain_intersection/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'object', required: true, description: 'Map of targets, e.g. {"1":"domain1.com","2":"domain2.com"}' }, P_LIMIT, P_OFFSET, P_FILTERS, P_TAG] },
  { name: 'seoBacklinksPageIntersection', description: '[Tier 3] Backlink page intersection — find domains linking to one page but not another.', endpoint: '/v3/backlinks/page_intersection/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'object', required: true, description: 'Map of page URLs' }, P_LIMIT, P_OFFSET, P_FILTERS, P_TAG] },
  { name: 'seoBacklinksBulkRanks', description: '[Tier 3] Bulk domain ranks — get rank scores for multiple domains at once.', endpoint: '/v3/backlinks/bulk_ranks/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of domains', items: { type: 'string' } }, P_TAG] },
  { name: 'seoBacklinksBulkBacklinks', description: '[Tier 3] Bulk backlinks count — get backlink counts for multiple domains at once.', endpoint: '/v3/backlinks/bulk_backlinks/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of domains', items: { type: 'string' } }, P_TAG] },
  { name: 'seoBacklinksBulkSpamScore', description: '[Tier 3] Bulk spam scores — get spam/trust scores for multiple domains at once.', endpoint: '/v3/backlinks/bulk_spam_score/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of domains', items: { type: 'string' } }, P_TAG] },
  { name: 'seoBacklinksBulkReferringDomains', description: '[Tier 3] Bulk referring domains — count referring domains for multiple targets at once.', endpoint: '/v3/backlinks/bulk_referring_domains/live', category: 'seo-backlinks', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of domains', items: { type: 'string' } }, P_TAG] },

  // ─── OnPage API ────────────────────────────────────────────────────────

  { name: 'seoOnPageInstantPages', description: '[Tier 3] Instant page analysis — crawl and analyze a single page for SEO issues, meta tags, headings, links, images, and performance.', endpoint: '/v3/on_page/instant_pages', category: 'seo-onpage', params: [P_URL, { name: 'enable_javascript', type: 'boolean', description: 'Render JavaScript (default false)' }] },
  { name: 'seoOnPageContentParsing', description: '[Tier 3] Content parsing — extract structured content from a page including text, headings, lists, tables, and links.', endpoint: '/v3/on_page/content_parsing/live', category: 'seo-onpage', params: [P_URL, { name: 'enable_javascript', type: 'boolean', description: 'Render JavaScript (default false)' }] },
  { name: 'seoOnPageLighthouse', description: '[Tier 3] Google Lighthouse audit — full performance, accessibility, best practices, and SEO scores with detailed audits.', endpoint: '/v3/on_page/lighthouse/live/json', category: 'seo-onpage', params: [P_URL, { name: 'categories', type: 'array', description: 'Audit categories: "performance","accessibility","best-practices","seo"', items: { type: 'string' } }, { name: 'for_mobile', type: 'boolean', description: 'Run mobile audit (default false)' }] },

  // ─── Content Analysis API ──────────────────────────────────────────────

  { name: 'seoContentSearch', description: '[Tier 3] Content search — find web content by keyword with sentiment, ratings, and engagement data.', endpoint: '/v3/content_analysis/search/live', category: 'seo-content', params: [P_KEYWORD, { name: 'search_mode', type: 'string', description: '"as_is", "entry", or "relevance"' }, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY] },
  { name: 'seoContentSummary', description: '[Tier 3] Content summary — aggregated content metrics for a keyword or domain.', endpoint: '/v3/content_analysis/summary/live', category: 'seo-content', params: [P_KEYWORD, P_FILTERS] },
  { name: 'seoContentSentiment', description: '[Tier 3] Sentiment analysis — analyze sentiment distribution across web content for a keyword.', endpoint: '/v3/content_analysis/sentiment_analysis/live', category: 'seo-content', params: [P_KEYWORD, P_FILTERS] },
  { name: 'seoContentRatingDistribution', description: '[Tier 3] Rating distribution — analyze rating distributions across web content for a keyword.', endpoint: '/v3/content_analysis/rating_distribution/live', category: 'seo-content', params: [P_KEYWORD, P_FILTERS] },
  { name: 'seoContentPhraseTrends', description: '[Tier 3] Phrase trends — trending phrases and topics in web content.', endpoint: '/v3/content_analysis/phrase_trends/live', category: 'seo-content', params: [P_KEYWORD, P_FILTERS] },
  { name: 'seoContentCategoryTrends', description: '[Tier 3] Category trends — trending content categories for a keyword.', endpoint: '/v3/content_analysis/category_trends/live', category: 'seo-content', params: [P_KEYWORD, P_FILTERS] },

  // ─── Merchant API: Google Shopping ─────────────────────────────────────

  { name: 'seoGoogleShoppingProducts', description: '[Tier 3] Google Shopping product search — products with prices, sellers, ratings, and delivery info.', endpoint: '/v3/merchant/google/products/task_post', category: 'seo-merchant', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoGoogleShoppingSellers', description: '[Tier 3] Google Shopping sellers for a product — compare prices and sellers.', endpoint: '/v3/merchant/google/sellers/task_post', category: 'seo-merchant', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoGoogleShoppingProductInfo', description: '[Tier 3] Google Shopping product details — comprehensive product information, specs, and reviews.', endpoint: '/v3/merchant/google/product_info/task_post', category: 'seo-merchant', params: [{ name: 'product_id', type: 'string', required: true, description: 'Google Shopping product ID' }, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoGoogleShoppingReviews', description: '[Tier 3] Google Shopping product reviews — user reviews with ratings, dates, and text.', endpoint: '/v3/merchant/google/reviews/task_post', category: 'seo-merchant', params: [{ name: 'product_id', type: 'string', required: true, description: 'Google Shopping product ID' }, P_LOCATION, P_LANGUAGE, P_TAG] },

  // ─── Merchant API: Amazon ──────────────────────────────────────────────

  { name: 'seoAmazonProducts', description: '[Tier 3] Amazon product search — products with prices, ratings, reviews, and Prime status.', endpoint: '/v3/merchant/amazon/products/task_post', category: 'seo-merchant', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoAmazonASIN', description: '[Tier 3] Amazon ASIN lookup — detailed product info by ASIN including features, specs, and pricing.', endpoint: '/v3/merchant/amazon/asin/task_post', category: 'seo-merchant', params: [{ name: 'asin', type: 'string', required: true, description: 'Amazon ASIN' }, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoAmazonSellers', description: '[Tier 3] Amazon sellers for a product — compare sellers, prices, and conditions.', endpoint: '/v3/merchant/amazon/sellers/task_post', category: 'seo-merchant', params: [{ name: 'asin', type: 'string', required: true, description: 'Amazon ASIN' }, P_LOCATION, P_LANGUAGE, P_TAG] },

  // ─── Business Data API ─────────────────────────────────────────────────

  { name: 'seoBusinessListingsSearch', description: '[Tier 3] Business listings search — search local business listings with contact info, hours, and reviews.', endpoint: '/v3/business_data/business_listings/search/live', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LIMIT, P_OFFSET, P_FILTERS] },
  { name: 'seoBusinessListingsCategories', description: '[Tier 3] Business listings category aggregation — aggregate business categories for a location.', endpoint: '/v3/business_data/business_listings/categories_aggregation/live', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LIMIT, P_FILTERS] },
  { name: 'seoGoogleMyBusiness', description: '[Tier 3] Google My Business info — detailed GMB profile with hours, attributes, photos, and reviews.', endpoint: '/v3/business_data/google/my_business_info/live', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoGoogleHotelSearch', description: '[Tier 3] Google Hotels search — hotel listings with prices, ratings, and availability.', endpoint: '/v3/business_data/google/hotel_searches/live', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, { name: 'check_in', type: 'string', description: 'Check-in date YYYY-MM-DD' }, { name: 'check_out', type: 'string', description: 'Check-out date YYYY-MM-DD' }, P_TAG] },
  { name: 'seoGoogleHotelInfo', description: '[Tier 3] Google Hotel info — detailed hotel information with rooms, prices, reviews, and amenities.', endpoint: '/v3/business_data/google/hotel_info/live/advanced', category: 'seo-business', params: [{ name: 'hotel_identifier', type: 'string', required: true, description: 'Hotel identifier from hotel search results' }, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoGoogleReviews', description: '[Tier 3] Google Reviews — reviews for a business with ratings, dates, authors, and response.', endpoint: '/v3/business_data/google/reviews/task_post', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoGoogleQA', description: '[Tier 3] Google Questions & Answers — Q&A from Google Business profiles.', endpoint: '/v3/business_data/google/questions_and_answers/live', category: 'seo-business', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoTrustpilotSearch', description: '[Tier 3] Trustpilot business search — find businesses on Trustpilot with ratings and review counts.', endpoint: '/v3/business_data/trustpilot/search/task_post', category: 'seo-business', params: [P_KEYWORD, P_TAG] },
  { name: 'seoTrustpilotReviews', description: '[Tier 3] Trustpilot reviews — reviews for a business on Trustpilot with ratings and dates.', endpoint: '/v3/business_data/trustpilot/reviews/task_post', category: 'seo-business', params: [P_KEYWORD, P_TAG] },
  { name: 'seoSocialPinterest', description: '[Tier 3] Pinterest social data — pins, repins, and engagement metrics for a URL.', endpoint: '/v3/business_data/social_media/pinterest/live', category: 'seo-business', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of URLs to check', items: { type: 'string' } }] },
  { name: 'seoSocialFacebook', description: '[Tier 3] Facebook social data — shares, likes, and engagement metrics for a URL.', endpoint: '/v3/business_data/social_media/facebook/live', category: 'seo-business', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of URLs to check', items: { type: 'string' } }] },
  { name: 'seoSocialReddit', description: '[Tier 3] Reddit social data — posts, comments, and engagement metrics for a URL.', endpoint: '/v3/business_data/social_media/reddit/live', category: 'seo-business', params: [{ name: 'targets', type: 'array', required: true, description: 'Array of URLs to check', items: { type: 'string' } }] },

  // ─── App Data API: Google Play ─────────────────────────────────────────

  { name: 'seoGooglePlayAppSearch', description: '[Tier 3] Google Play Store app search — find apps with ratings, installs, and metadata.', endpoint: '/v3/app_data/google/app_searches/task_post', category: 'seo-apps', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoGooglePlayAppList', description: '[Tier 3] Google Play Store app lists — top apps by category (free, paid, grossing).', endpoint: '/v3/app_data/google/app_list/task_post', category: 'seo-apps', params: [{ name: 'app_collection', type: 'string', required: true, description: '"top_free", "top_paid", "top_grossing", "new_free", "new_paid"' }, { name: 'app_category', type: 'string', description: 'App category, e.g. "GAME_ACTION"' }, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoGooglePlayAppInfo', description: '[Tier 3] Google Play Store app info — detailed app profile with description, screenshots, reviews, and permissions.', endpoint: '/v3/app_data/google/app_info/task_post', category: 'seo-apps', params: [{ name: 'app_id', type: 'string', required: true, description: 'Google Play app ID, e.g. "com.example.app"' }, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoGooglePlayAppReviews', description: '[Tier 3] Google Play Store app reviews — user reviews with ratings, dates, and versions.', endpoint: '/v3/app_data/google/app_reviews/task_post', category: 'seo-apps', params: [{ name: 'app_id', type: 'string', required: true, description: 'Google Play app ID' }, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },

  // ─── App Data API: Apple ───────────────────────────────────────────────

  { name: 'seoAppleAppSearch', description: '[Tier 3] Apple App Store search — find iOS apps with ratings and metadata.', endpoint: '/v3/app_data/apple/app_searches/task_post', category: 'seo-apps', params: [P_KEYWORD, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoAppleAppList', description: '[Tier 3] Apple App Store lists — top apps by category.', endpoint: '/v3/app_data/apple/app_list/task_post', category: 'seo-apps', params: [{ name: 'app_collection', type: 'string', required: true, description: '"top_free_iphone", "top_paid_iphone", "top_grossing_iphone"' }, { name: 'app_category', type: 'number', description: 'App Store category ID' }, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },
  { name: 'seoAppleAppInfo', description: '[Tier 3] Apple App Store app info — detailed app profile with description, screenshots, and ratings.', endpoint: '/v3/app_data/apple/app_info/task_post', category: 'seo-apps', params: [{ name: 'app_id', type: 'string', required: true, description: 'Apple App Store ID' }, P_LOCATION, P_LANGUAGE, P_TAG] },
  { name: 'seoAppleAppReviews', description: '[Tier 3] Apple App Store reviews — user reviews with ratings and dates.', endpoint: '/v3/app_data/apple/app_reviews/task_post', category: 'seo-apps', params: [{ name: 'app_id', type: 'string', required: true, description: 'Apple App Store ID' }, P_LOCATION, P_LANGUAGE, P_DEPTH, P_TAG] },

  // ─── Domain Analytics API ──────────────────────────────────────────────

  { name: 'seoDomainTechnologies', description: '[Tier 3] Domain technologies — detect all technologies used by a website (CMS, analytics, frameworks, hosting).', endpoint: '/v3/domain_analytics/technologies/domain_technologies/live', category: 'seo-domain', params: [P_TARGET, P_TAG] },
  { name: 'seoTechnologyStats', description: '[Tier 3] Technology stats — market share and usage statistics for a specific technology.', endpoint: '/v3/domain_analytics/technologies/technology_stats/live', category: 'seo-domain', params: [{ name: 'technology', type: 'string', required: true, description: 'Technology name, e.g. "WordPress"' }, P_TAG] },
  { name: 'seoDomainsByTechnology', description: '[Tier 3] Domains by technology — find all domains using a specific technology.', endpoint: '/v3/domain_analytics/technologies/domains_by_technology/live', category: 'seo-domain', params: [{ name: 'technology', type: 'string', required: true, description: 'Technology name' }, P_LIMIT, P_OFFSET, P_FILTERS, P_ORDER_BY, P_TAG] },
  { name: 'seoDomainsByHtmlTerms', description: '[Tier 3] Domains by HTML terms — find domains containing specific HTML patterns.', endpoint: '/v3/domain_analytics/technologies/domains_by_html_terms/live', category: 'seo-domain', params: [{ name: 'search_terms', type: 'array', required: true, description: 'Array of HTML terms to search for', items: { type: 'string' } }, P_LIMIT, P_OFFSET, P_TAG] },
  { name: 'seoDomainWhois', description: '[Tier 3] WHOIS lookup — domain registration details including registrar, dates, nameservers, and status.', endpoint: '/v3/domain_analytics/whois/overview/live', category: 'seo-domain', params: [P_TARGET, P_TAG] },

  // ─── AI Optimization API ───────────────────────────────────────────────

  { name: 'seoAiLlmMentionsSearch', description: '[Tier 3] LLM Mentions search — find how often a brand/domain is mentioned by AI models (ChatGPT, Claude, Gemini).', endpoint: '/v3/ai_optimization/llm_mentions/search/live', category: 'seo-ai', params: [P_KEYWORD, P_LIMIT, P_OFFSET, P_FILTERS] },
  { name: 'seoAiLlmMentionsTopPages', description: '[Tier 3] LLM Mentions top pages — top pages cited by AI models for a keyword.', endpoint: '/v3/ai_optimization/llm_mentions/top_pages/live', category: 'seo-ai', params: [P_KEYWORD, P_LIMIT, P_OFFSET, P_FILTERS] },
  { name: 'seoAiLlmMentionsTopDomains', description: '[Tier 3] LLM Mentions top domains — top domains cited by AI models for a keyword.', endpoint: '/v3/ai_optimization/llm_mentions/top_domains/live', category: 'seo-ai', params: [P_KEYWORD, P_LIMIT, P_OFFSET, P_FILTERS] },
  { name: 'seoAiKeywordsVolume', description: '[Tier 3] AI keyword search volume — search volume data optimized for AI/LLM contexts.', endpoint: '/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live', category: 'seo-ai', params: [P_KEYWORDS, ...KW_COMMON] },
  { name: 'seoAiChatGptResponse', description: '[Tier 3] ChatGPT response — get a live ChatGPT response for a prompt and analyze citations.', endpoint: '/v3/ai_optimization/chat_gpt/llm_responses/live', category: 'seo-ai', params: [{ name: 'prompt', type: 'string', required: true, description: 'Prompt to send to ChatGPT' }, { name: 'model', type: 'string', description: 'Model name, e.g. "gpt-4o"' }] },
  { name: 'seoAiClaudeResponse', description: '[Tier 3] Claude response — get a live Claude response for a prompt and analyze citations.', endpoint: '/v3/ai_optimization/claude/llm_responses/live', category: 'seo-ai', params: [{ name: 'prompt', type: 'string', required: true, description: 'Prompt to send to Claude' }, { name: 'model', type: 'string', description: 'Model name, e.g. "claude-sonnet-4-20250514"' }] },
  { name: 'seoAiGeminiResponse', description: '[Tier 3] Gemini response — get a live Gemini response for a prompt and analyze citations.', endpoint: '/v3/ai_optimization/gemini/llm_responses/live', category: 'seo-ai', params: [{ name: 'prompt', type: 'string', required: true, description: 'Prompt to send to Gemini' }, { name: 'model', type: 'string', description: 'Model name' }] },
  { name: 'seoAiPerplexityResponse', description: '[Tier 3] Perplexity response — get a live Perplexity response with web citations.', endpoint: '/v3/ai_optimization/perplexity/llm_responses/live', category: 'seo-ai', params: [{ name: 'prompt', type: 'string', required: true, description: 'Prompt to send to Perplexity' }, { name: 'model', type: 'string', description: 'Model name' }] },
];

// ═══════════════════════════════════════════════════════════════════════════
// Schema builder & result formatter
// ═══════════════════════════════════════════════════════════════════════════

function buildSchema(params: ParamDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.items) prop.items = p.items;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }

  return { type: 'object', properties, required };
}

/** Truncate large results to avoid blowing up LLM context */
const MAX_OUTPUT_CHARS = 20000;

function formatResult(result: { data: unknown; cost: number; time: string; resultCount: number }, toolName: string): ToolResult {
  const json = JSON.stringify(result.data, null, 2);
  const truncated = json.length > MAX_OUTPUT_CHARS
    ? json.slice(0, MAX_OUTPUT_CHARS) + `\n\n... [truncated, full response was ${json.length} chars] ...`
    : json;

  return {
    success: true,
    output: `[${toolName}] ${result.resultCount} result(s) | cost: $${result.cost.toFixed(4)} | time: ${result.time}\n\n${truncated}`,
    data: { cost: result.cost, resultCount: result.resultCount },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory: create executable Tool objects
// ═══════════════════════════════════════════════════════════════════════════

export function createDataForSeoTools(service: DataForSeoServiceLike): Tool[] {
  return TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: buildSchema(def.params),
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const result = await service.call(def.endpoint, input);
        return formatResult(result, def.name);
      } catch (err: any) {
        return { success: false, output: `${def.name} failed: ${err.message}` };
      }
    },
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Manifest: generate ToolManifestEntry[] for discovery via discover_tools
// ═══════════════════════════════════════════════════════════════════════════

export function getDataForSeoManifest(): ToolManifestEntry[] {
  return TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    category: def.category,
    inputSchema: buildSchema(def.params),
    executionTarget: 'dashboard' as const,
    source: 'tool' as const,
  }));
}

/** Get the count of DataForSEO tools (useful for logging) */
export function getDataForSeoToolCount(): number {
  return TOOL_DEFS.length;
}
