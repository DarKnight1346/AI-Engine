import { SearchCache } from './search-cache.js';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// xAI Media Generation Service (Images + Video)
//
// Uses the xAI API to generate images and videos via Grok Imagine models.
//
// Image models:
//   - grok-imagine-image      — $0.02/image, 300 rpm (fast, cheaper)
//   - grok-imagine-image-pro  — $0.07/image, 30 rpm  (higher quality)
//
// Video model:
//   - grok-imagine-video      — $0.05/video, 60 rpm
//     Text-to-video, image-to-video, video editing
//     Up to 15s duration, 480p or 720p
//     Async generation (submit → poll)
// ---------------------------------------------------------------------------

const XAI_BASE_URL = 'https://api.x.ai/v1';

/** Cache TTL: 1 hour for generated media */
const CACHE_TTL = 60 * 60 * 1000;

/** Default polling interval for video generation (ms) */
const VIDEO_POLL_INTERVAL = 5000;

/** Maximum time to wait for video generation (ms) — 5 minutes */
const VIDEO_POLL_TIMEOUT = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Image Types
// ---------------------------------------------------------------------------

export type XaiImageModel = 'grok-imagine-image' | 'grok-imagine-image-pro';

export type XaiAspectRatio =
  | '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
  | '3:2' | '2:3' | '2:1' | '1:2'
  | '19.5:9' | '9:19.5' | '20:9' | '9:20'
  | 'auto';

export interface XaiImageOptions {
  /** Model to use (default: grok-imagine-image) */
  model?: XaiImageModel;
  /** Number of images to generate (1-10, default 1) */
  n?: number;
  /** Aspect ratio (default: 1:1, or 'auto' for model to decide) */
  aspectRatio?: XaiAspectRatio;
  /** Response format: 'url' for temporary URLs, 'b64_json' for base64 data */
  responseFormat?: 'url' | 'b64_json';
  /** Optional: URL or base64 data-URI of an input image for editing */
  imageUrl?: string;
}

export interface XaiGeneratedImage {
  /** Temporary URL to the generated image (when responseFormat is 'url') */
  url?: string;
  /** Base64-encoded image data (when responseFormat is 'b64_json') */
  b64Json?: string;
  /** The model's revised version of the prompt */
  revisedPrompt?: string;
}

export interface XaiImageResult {
  /** Array of generated images */
  images: XaiGeneratedImage[];
  /** Model used */
  model: string;
}

// ---------------------------------------------------------------------------
// Video Types
// ---------------------------------------------------------------------------

export type XaiVideoAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
export type XaiVideoResolution = '480p' | '720p';

export interface XaiVideoOptions {
  /** Duration in seconds (1-15, default varies by prompt) */
  duration?: number;
  /** Aspect ratio (default: 16:9) */
  aspectRatio?: XaiVideoAspectRatio;
  /** Resolution (default: 480p) */
  resolution?: XaiVideoResolution;
  /** Optional: URL or base64 data-URI of a source image (image-to-video) */
  imageUrl?: string;
  /** Optional: URL of a source video for editing (max 8.7s input) */
  videoUrl?: string;
}

export interface XaiVideoResult {
  /** Temporary URL to the generated video (.mp4) */
  url: string;
  /** Actual duration of the generated video in seconds */
  duration: number;
  /** Model used */
  model: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class XaiImageService {
  private cache: SearchCache;
  private apiKey: string | null = null;

  constructor(redis?: Redis) {
    this.cache = new SearchCache(redis);
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Image Generation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate images from a text prompt using xAI Grok Imagine.
   *
   * For n > 10: splits into parallel batches (xAI API supports max 10/request)
   * and executes them concurrently. Supports up to 100+ images.
   */
  async generate(prompt: string, options: XaiImageOptions = {}): Promise<XaiImageResult> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → Web Search → Tier 2.');
    }

    const model = options.model ?? 'grok-imagine-image';
    const totalN = options.n ?? 1;
    const responseFormat = options.responseFormat ?? 'url';

    // Check cache (only for small requests)
    if (responseFormat === 'url' && totalN <= 10) {
      const cacheKey = `xai:img:${model}:${prompt}:${totalN}:${options.aspectRatio ?? '1:1'}:${options.imageUrl ?? ''}`;
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached as XaiImageResult;
    }

    // ── Parallel batch generation for large n ──────────────────────
    // xAI API supports max 10 images per request. For larger batches,
    // split into parallel requests of up to 10 each.
    const MAX_PER_REQUEST = 10;

    if (totalN > MAX_PER_REQUEST) {
      const batches: number[] = [];
      let remaining = totalN;
      while (remaining > 0) {
        const batchSize = Math.min(remaining, MAX_PER_REQUEST);
        batches.push(batchSize);
        remaining -= batchSize;
      }

      console.log(`[XaiImageService] Generating ${totalN} images in ${batches.length} parallel batches: [${batches.join(', ')}]`);

      const batchPromises = batches.map((batchN) =>
        this.generateSingleBatch(prompt, { ...options, n: batchN, responseFormat, model })
      );

      const batchResults = await Promise.allSettled(batchPromises);

      const allImages: XaiGeneratedImage[] = [];
      let usedModel = model;

      for (const br of batchResults) {
        if (br.status === 'fulfilled') {
          allImages.push(...br.value.images);
          usedModel = br.value.model;
        } else {
          console.error(`[XaiImageService] Batch failed:`, br.reason?.message ?? br.reason);
        }
      }

      if (allImages.length === 0) {
        throw new Error(`All ${batches.length} image generation batches failed`);
      }

      console.log(`[XaiImageService] Generated ${allImages.length}/${totalN} images successfully`);

      return { images: allImages, model: usedModel };
    }

    // ── Single request (n ≤ 10) ───────────────────────────────────
    return this.generateSingleBatch(prompt, { ...options, n: totalN, responseFormat, model });
  }

  /**
   * Execute a single image generation API call (n ≤ 10).
   */
  private async generateSingleBatch(
    prompt: string,
    options: XaiImageOptions & { responseFormat: string; model: string },
  ): Promise<XaiImageResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      prompt,
      n: options.n ?? 1,
      response_format: options.responseFormat,
    };

    if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
    if (options.imageUrl) body.image_url = options.imageUrl;

    const response = await fetch(`${XAI_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let detail = errorText || response.statusText;
      try {
        const errJson = JSON.parse(errorText);
        detail = errJson.error?.message || errJson.detail || errJson.message || detail;
      } catch { /* use raw text */ }
      throw new Error(`xAI Image API error (${response.status}): ${detail}`);
    }

    const data = await response.json() as any;

    const images: XaiGeneratedImage[] = (data.data ?? []).map((img: any) => ({
      url: img.url,
      b64Json: img.b64_json,
      revisedPrompt: img.revised_prompt,
    }));

    const result: XaiImageResult = {
      images,
      model: data.model ?? options.model,
    };

    // Cache small requests
    if (options.responseFormat === 'url' && (options.n ?? 1) <= 10) {
      const cacheKey = `xai:img:${options.model}:${prompt}:${options.n ?? 1}:${options.aspectRatio ?? '1:1'}:${options.imageUrl ?? ''}`;
      await this.cache.set(cacheKey, result, CACHE_TTL);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Video Generation (async — submit + poll)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a single video from a text prompt.
   * Delegates to the private submit+poll method.
   */
  async generateVideo(prompt: string, options: XaiVideoOptions = {}): Promise<XaiVideoResult> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → Web Search → Tier 2.');
    }
    return this.generateSingleVideo(prompt, options);
  }

  /**
   * Generate multiple videos in parallel from the same prompt + options.
   * Each video is independently submitted and polled concurrently.
   * Capped at 20 concurrent videos to respect rate limits (60 rpm).
   */
  async generateVideoBatch(
    prompt: string,
    n: number,
    options: XaiVideoOptions = {},
  ): Promise<XaiVideoResult[]> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → Web Search → Tier 2.');
    }

    const count = Math.max(1, Math.min(n, 20));
    console.log(`[XaiImageService] Generating ${count} videos in parallel...`);

    const promises = Array.from({ length: count }, (_, i) =>
      this.generateSingleVideo(prompt, options)
        .then((result) => {
          console.log(`[XaiImageService] Video ${i + 1}/${count} completed (${result.duration}s)`);
          return result;
        })
        .catch((err: any) => {
          console.error(`[XaiImageService] Video ${i + 1}/${count} failed:`, err.message);
          return null;
        })
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r): r is XaiVideoResult => r !== null);

    if (successful.length === 0) {
      throw new Error(`All ${count} video generation requests failed`);
    }

    console.log(`[XaiImageService] ${successful.length}/${count} videos generated successfully`);
    return successful;
  }

  /**
   * Internal: submit a single video generation request and poll until done.
   */
  private async generateSingleVideo(
    prompt: string,
    options: XaiVideoOptions = {},
  ): Promise<XaiVideoResult> {
    const body: Record<string, unknown> = {
      model: 'grok-imagine-video',
      prompt,
    };

    if (options.duration != null) body.duration = options.duration;
    if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
    if (options.resolution) body.resolution = options.resolution;
    if (options.imageUrl) body.image_url = options.imageUrl;
    if (options.videoUrl) body.video_url = options.videoUrl;

    const submitResponse = await fetch(`${XAI_BASE_URL}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text().catch(() => '');
      let detail = errorText || submitResponse.statusText;
      try {
        const errJson = JSON.parse(errorText);
        detail = errJson.error?.message || errJson.detail || errJson.message || detail;
      } catch { /* use raw text */ }
      throw new Error(`xAI Video API submit error (${submitResponse.status}): ${detail}`);
    }

    const submitData = await submitResponse.json() as any;
    const requestId = submitData.request_id;

    if (!requestId) {
      throw new Error('xAI Video API did not return a request_id');
    }

    // Poll for completion
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > VIDEO_POLL_TIMEOUT) {
        throw new Error(`Video generation timed out after ${VIDEO_POLL_TIMEOUT / 1000}s (request_id: ${requestId})`);
      }

      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL));

      const pollResponse = await fetch(`${XAI_BASE_URL}/videos/${requestId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text().catch(() => '');
        let detail = errorText || pollResponse.statusText;
        try {
          const errJson = JSON.parse(errorText);
          detail = errJson.error?.message || errJson.detail || errJson.message || detail;
        } catch { /* use raw text */ }
        throw new Error(`xAI Video API poll error (${pollResponse.status}): ${detail}`);
      }

      const pollData = await pollResponse.json() as any;

      if (pollData.status === 'done') {
        const video = pollData.video ?? {};
        return {
          url: video.url,
          duration: video.duration ?? options.duration ?? 0,
          model: pollData.model ?? 'grok-imagine-video',
        };
      }

      if (pollData.status === 'expired') {
        throw new Error(`Video generation request expired (request_id: ${requestId})`);
      }

      console.log(`[XaiImageService] Video pending (${requestId.slice(0, 8)})... elapsed: ${Math.round((Date.now() - startTime) / 1000)}s`);
    }
  }
}
