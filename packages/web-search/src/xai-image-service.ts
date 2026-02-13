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
   */
  async generate(prompt: string, options: XaiImageOptions = {}): Promise<XaiImageResult> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → Web Search → Tier 2.');
    }

    const model = options.model ?? 'grok-imagine-image';
    const responseFormat = options.responseFormat ?? 'url';

    // Check cache (only for URL responses — b64 is too large to cache)
    if (responseFormat === 'url') {
      const cacheKey = `xai:img:${model}:${prompt}:${options.n ?? 1}:${options.aspectRatio ?? '1:1'}:${options.imageUrl ?? ''}`;
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached as XaiImageResult;
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      n: options.n ?? 1,
      response_format: responseFormat,
    };

    if (options.aspectRatio) {
      body.aspect_ratio = options.aspectRatio;
    }

    if (options.imageUrl) {
      body.image_url = options.imageUrl;
    }

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
      model: data.model ?? model,
    };

    // Cache URL results
    if (responseFormat === 'url') {
      const cacheKey = `xai:img:${model}:${prompt}:${options.n ?? 1}:${options.aspectRatio ?? '1:1'}:${options.imageUrl ?? ''}`;
      await this.cache.set(cacheKey, result, CACHE_TTL);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Video Generation (async — submit + poll)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate a video from a text prompt (and optionally a source image/video).
   * This is an async operation: submits a request, then polls until done.
   * Typical generation time: 30s to several minutes.
   */
  async generateVideo(prompt: string, options: XaiVideoOptions = {}): Promise<XaiVideoResult> {
    if (!this.apiKey) {
      throw new Error('xAI API key not configured. Add your API key in Settings → Web Search → Tier 2.');
    }

    // Step 1: Submit generation request
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

    // Step 2: Poll for completion
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > VIDEO_POLL_TIMEOUT) {
        throw new Error(`Video generation timed out after ${VIDEO_POLL_TIMEOUT / 1000}s (request_id: ${requestId})`);
      }

      // Wait before polling
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL));

      const pollResponse = await fetch(`${XAI_BASE_URL}/videos/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
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

      // status === 'pending' — continue polling
      console.log(`[XaiImageService] Video generation pending... elapsed: ${Math.round((Date.now() - startTime) / 1000)}s`);
    }
  }
}
