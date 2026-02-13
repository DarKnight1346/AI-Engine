import type { Tool, ToolResult } from '../types.js';
import type { ToolManifestEntry } from '../tool-index.js';

// ---------------------------------------------------------------------------
// xAI Media Generation Tools (Images + Video)
//
// Provider-specific naming (xai* prefix) so future providers (DALL-E,
// Stability, Runway, etc.) can coexist without collision.
//
// Image tools:
//   - xaiGenerateImage     — $0.02/image, 300 rpm (fast, affordable)
//   - xaiGenerateImagePro  — $0.07/image, 30 rpm  (higher quality)
//
// Video tool:
//   - xaiGenerateVideo     — $0.05/video, 60 rpm (text/image/video → video)
//
// The agent decides:
//   - Image SEARCH (webSearchImages) for finding existing images
//   - Image GENERATION (xaiGenerateImage/Pro) for creating new images
//   - Video GENERATION (xaiGenerateVideo) for creating videos
// ---------------------------------------------------------------------------

// ═══════════════════════════════════════════════════════════════════════════
// Service interfaces — kept loose so the tools don't depend on the full
// web-search package type definitions.
// ═══════════════════════════════════════════════════════════════════════════

export interface ImageServiceLike {
  generate(prompt: string, options?: Record<string, unknown>): Promise<{
    images: Array<{ url?: string; b64Json?: string; revisedPrompt?: string }>;
    model: string;
  }>;
  generateVideo(prompt: string, options?: Record<string, unknown>): Promise<{
    url: string;
    duration: number;
    model: string;
  }>;
  generateVideoBatch(prompt: string, n: number, options?: Record<string, unknown>): Promise<Array<{
    url: string;
    duration: number;
    model: string;
  }>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool creation
// ═══════════════════════════════════════════════════════════════════════════

export function createImageTools(service: ImageServiceLike): Tool[] {
  return [
    // ── xaiGenerateImage ──────────────────────────────────────────────
    {
      name: 'xaiGenerateImage',
      description:
        'Generate images from a text description using xAI Grok Imagine. ' +
        'Fast and affordable ($0.02/image). Use this when the user asks you to CREATE, DRAW, DESIGN, or GENERATE images — ' +
        'NOT when they want to find existing images (use webSearchImages for that). ' +
        'Supports generating up to 100 images in parallel batches. ' +
        'Supports aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, auto. ' +
        'Can also EDIT an existing image by providing imageUrl. ' +
        'IMPORTANT: Include all generated image URLs on their own lines in your response — the UI renders them as a visual gallery.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate. Be specific about style, composition, colors, subjects.',
          },
          aspectRatio: {
            type: 'string',
            description: 'Aspect ratio: "1:1" (square), "16:9" (landscape), "9:16" (portrait/mobile), "4:3", "3:2", "auto" (model decides). Default: "1:1".',
          },
          n: {
            type: 'number',
            description: 'Number of images to generate (1-100, default 1). Large batches are executed in parallel.',
          },
          imageUrl: {
            type: 'string',
            description: 'Optional: URL of an existing image to edit/modify based on the prompt.',
          },
        },
        required: ['prompt'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const prompt = String(input.prompt || '');
          if (!prompt) return { success: false, output: 'Please provide a prompt describing the image to generate.' };

          const options: Record<string, unknown> = {
            model: 'grok-imagine-image',
            responseFormat: 'url',
          };
          if (input.aspectRatio) options.aspectRatio = input.aspectRatio;
          if (input.n) options.n = Math.min(Number(input.n) || 1, 100);
          if (input.imageUrl) options.imageUrl = input.imageUrl;

          const result = await service.generate(prompt, options);

          if (result.images.length === 0) {
            return { success: false, output: 'Image generation produced no results.' };
          }

          // Output each URL on its own line for clean gallery rendering
          const imageUrls = result.images
            .map((img) => img.url)
            .filter((u): u is string => !!u);

          return {
            success: true,
            output: `Generated ${imageUrls.length} image(s):\n\n${imageUrls.join('\n')}\n\n_[Model: ${result.model}]_`,
            data: { images: result.images, imageUrls, model: result.model },
          };
        } catch (err: any) {
          return { success: false, output: `Image generation failed: ${err.message}` };
        }
      },
    },

    // ── xaiGenerateImagePro ───────────────────────────────────────────
    {
      name: 'xaiGenerateImagePro',
      description:
        'Generate HIGH-QUALITY images using xAI Grok Imagine Pro ($0.07/image). ' +
        'Use this only when the user explicitly asks for professional/premium quality, ' +
        'or when the standard xaiGenerateImage results are not sufficient. ' +
        'Supports up to 100 images in parallel. Same parameters as xaiGenerateImage but higher fidelity. ' +
        'IMPORTANT: Include all generated image URLs on their own lines — the UI renders them as a visual gallery.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate.',
          },
          aspectRatio: {
            type: 'string',
            description: 'Aspect ratio: "1:1", "16:9", "9:16", "4:3", "3:2", "auto". Default: "1:1".',
          },
          n: {
            type: 'number',
            description: 'Number of images to generate (1-100, default 1). Large batches run in parallel.',
          },
          imageUrl: {
            type: 'string',
            description: 'Optional: URL of an existing image to edit.',
          },
        },
        required: ['prompt'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const prompt = String(input.prompt || '');
          if (!prompt) return { success: false, output: 'Please provide a prompt describing the image to generate.' };

          const options: Record<string, unknown> = {
            model: 'grok-imagine-image-pro',
            responseFormat: 'url',
          };
          if (input.aspectRatio) options.aspectRatio = input.aspectRatio;
          if (input.n) options.n = Math.min(Number(input.n) || 1, 100);
          if (input.imageUrl) options.imageUrl = input.imageUrl;

          const result = await service.generate(prompt, options);

          if (result.images.length === 0) {
            return { success: false, output: 'Pro image generation produced no results.' };
          }

          const imageUrls = result.images
            .map((img) => img.url)
            .filter((u): u is string => !!u);

          return {
            success: true,
            output: `Generated ${imageUrls.length} pro image(s):\n\n${imageUrls.join('\n')}\n\n_[Model: ${result.model} (Pro)]_`,
            data: { images: result.images, imageUrls, model: result.model },
          };
        } catch (err: any) {
          return { success: false, output: `Pro image generation failed: ${err.message}` };
        }
      },
    },

    // ── xaiGenerateVideo ──────────────────────────────────────────────
    {
      name: 'xaiGenerateVideo',
      description:
        'Generate one or more videos from a text description using xAI Grok Imagine Video ($0.05/video). ' +
        'Use when the user asks you to CREATE, MAKE, or GENERATE a video or animation. ' +
        'Supports text-to-video, image-to-video (animate a still image), and video editing (modify an existing video). ' +
        'Set n > 1 to generate multiple videos in parallel (max 20). ' +
        'Duration: 1-15 seconds. Resolutions: 480p (faster) or 720p (HD). ' +
        'Aspect ratios: 16:9 (default), 9:16 (portrait), 1:1, 4:3, 3:2. ' +
        'NOTE: Video generation is asynchronous and may take 30s-2min per video. ' +
        'IMPORTANT: Include all video URLs on separate lines in your response for proper rendering.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the video to generate. Describe the scene, motion, camera movement, atmosphere.',
          },
          n: {
            type: 'number',
            description: 'Number of videos to generate (1-20). Multiple videos are generated in parallel. Default: 1.',
          },
          duration: {
            type: 'number',
            description: 'Video duration in seconds (1-15). Longer videos cost more and take longer. Default: model decides.',
          },
          aspectRatio: {
            type: 'string',
            description: 'Aspect ratio: "16:9" (landscape, default), "9:16" (portrait/mobile), "1:1" (square), "4:3", "3:2".',
          },
          resolution: {
            type: 'string',
            description: 'Resolution: "480p" (faster, default) or "720p" (HD, slower).',
          },
          imageUrl: {
            type: 'string',
            description: 'Optional: URL of a source image to animate (image-to-video). Can be a URL or base64 data URI.',
          },
          videoUrl: {
            type: 'string',
            description: 'Optional: URL of a source video to edit (max 8.7 seconds). The model modifies the video based on the prompt.',
          },
        },
        required: ['prompt'],
      },
      execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const prompt = String(input.prompt || '');
          if (!prompt) return { success: false, output: 'Please provide a prompt describing the video to generate.' };

          const options: Record<string, unknown> = {};
          if (input.duration != null) options.duration = input.duration;
          if (input.aspectRatio) options.aspectRatio = input.aspectRatio;
          if (input.resolution) options.resolution = input.resolution;
          if (input.imageUrl) options.imageUrl = input.imageUrl;
          if (input.videoUrl) options.videoUrl = input.videoUrl;

          const requestedN = Math.max(1, Math.min(Number(input.n) || 1, 20));

          // Single video
          if (requestedN === 1) {
            const result = await service.generateVideo(prompt, options);
            return {
              success: true,
              output: `Generated video (${result.duration}s):\n${result.url}\n\n_[Model: ${result.model}]_`,
              data: {
                videoUrl: result.url,
                videoUrls: [result.url],
                duration: result.duration,
                model: result.model,
                count: 1,
              },
            };
          }

          // Batch parallel generation
          const results = await service.generateVideoBatch(prompt, requestedN, options);
          const videoUrls = results.map((r) => r.url).filter(Boolean);

          return {
            success: true,
            output: `Generated ${videoUrls.length} video(s):\n\n${videoUrls.join('\n')}\n\n_[Model: ${results[0]?.model ?? 'grok-imagine-video'}]_`,
            data: {
              videoUrls,
              videos: results,
              model: results[0]?.model ?? 'grok-imagine-video',
              count: videoUrls.length,
            },
          };
        } catch (err: any) {
          return { success: false, output: `Video generation failed: ${err.message}` };
        }
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Manifest entries for discovery
// ═══════════════════════════════════════════════════════════════════════════

export function getImageToolManifest(): ToolManifestEntry[] {
  return [
    {
      name: 'xaiGenerateImage',
      description:
        'Generate images from a text description using xAI Grok Imagine ($0.02/image). ' +
        'Supports batch generation of 1-100 images in parallel. Results are displayed as a visual gallery.',
      category: 'media-generation',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          aspectRatio: { type: 'string' },
          n: { type: 'number' },
          imageUrl: { type: 'string' },
        },
        required: ['prompt'],
      },
      executionTarget: 'dashboard',
      source: 'tool',
    },
    {
      name: 'xaiGenerateImagePro',
      description:
        'Generate high-quality professional images using xAI Grok Imagine Pro ($0.07/image). ' +
        'Supports batch generation of 1-100 images in parallel. Higher fidelity. Use when premium quality is requested.',
      category: 'media-generation',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          aspectRatio: { type: 'string' },
          n: { type: 'number' },
          imageUrl: { type: 'string' },
        },
        required: ['prompt'],
      },
      executionTarget: 'dashboard',
      source: 'tool',
    },
    {
      name: 'xaiGenerateVideo',
      description:
        'Generate one or more videos from a text description using xAI Grok Imagine Video ($0.05/video). ' +
        'Supports parallel batch generation of 1-20 videos, text-to-video, image-to-video animation, and video editing. ' +
        'Duration 1-15 seconds, 480p or 720p. Takes 30s-2min per video.',
      category: 'media-generation',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          n: { type: 'number' },
          duration: { type: 'number' },
          aspectRatio: { type: 'string' },
          resolution: { type: 'string' },
          imageUrl: { type: 'string' },
          videoUrl: { type: 'string' },
        },
        required: ['prompt'],
      },
      executionTarget: 'dashboard',
      source: 'tool',
    },
  ];
}
