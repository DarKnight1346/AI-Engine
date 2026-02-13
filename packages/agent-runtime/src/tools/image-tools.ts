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
        'Generate an image from a text description using xAI Grok Imagine. ' +
        'Fast and affordable ($0.02/image). Use this when the user asks you to CREATE, DRAW, DESIGN, or GENERATE an image — ' +
        'NOT when they want to find existing images (use webSearchImages for that). ' +
        'Supports aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, auto. ' +
        'Can also EDIT an existing image by providing imageUrl.',
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
            description: 'Number of image variations to generate (1-10, default 1).',
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
          if (input.n) options.n = input.n;
          if (input.imageUrl) options.imageUrl = input.imageUrl;

          const result = await service.generate(prompt, options);

          if (result.images.length === 0) {
            return { success: false, output: 'Image generation produced no results.' };
          }

          const imageEntries = result.images.map((img, i) => {
            const prefix = result.images.length > 1 ? `Image ${i + 1}: ` : '';
            const url = img.url ?? '[base64 data]';
            const revised = img.revisedPrompt ? `\n  Revised prompt: "${img.revisedPrompt}"` : '';
            return `${prefix}${url}${revised}`;
          });

          return {
            success: true,
            output: `Generated ${result.images.length} image(s):\n${imageEntries.join('\n')}\n\n_[Model: ${result.model}]_`,
            data: { images: result.images, model: result.model },
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
        'Generate a HIGH-QUALITY image using xAI Grok Imagine Pro ($0.07/image). ' +
        'Use this only when the user explicitly asks for professional/premium quality, ' +
        'or when the standard xaiGenerateImage results are not sufficient. ' +
        'Same parameters as xaiGenerateImage but produces higher fidelity output.',
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
            description: 'Number of image variations (1-10, default 1).',
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
          if (input.n) options.n = input.n;
          if (input.imageUrl) options.imageUrl = input.imageUrl;

          const result = await service.generate(prompt, options);

          if (result.images.length === 0) {
            return { success: false, output: 'Pro image generation produced no results.' };
          }

          const imageEntries = result.images.map((img, i) => {
            const prefix = result.images.length > 1 ? `Image ${i + 1}: ` : '';
            const url = img.url ?? '[base64 data]';
            const revised = img.revisedPrompt ? `\n  Revised prompt: "${img.revisedPrompt}"` : '';
            return `${prefix}${url}${revised}`;
          });

          return {
            success: true,
            output: `Generated ${result.images.length} pro image(s):\n${imageEntries.join('\n')}\n\n_[Model: ${result.model} (Pro)]_`,
            data: { images: result.images, model: result.model },
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
        'Generate a video from a text description using xAI Grok Imagine Video ($0.05/video). ' +
        'Use when the user asks you to CREATE, MAKE, or GENERATE a video or animation. ' +
        'Supports text-to-video, image-to-video (animate a still image), and video editing (modify an existing video). ' +
        'Duration: 1-15 seconds. Resolutions: 480p (faster) or 720p (HD). ' +
        'Aspect ratios: 16:9 (default), 9:16 (portrait), 1:1, 4:3, 3:2. ' +
        'NOTE: Video generation is asynchronous and may take 30s-2min to complete.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the video to generate. Describe the scene, motion, camera movement, atmosphere.',
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

          const result = await service.generateVideo(prompt, options);

          return {
            success: true,
            output: `Generated video (${result.duration}s):\n${result.url}\n\n_[Model: ${result.model}]_`,
            data: {
              videoUrl: result.url,
              duration: result.duration,
              model: result.model,
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
        'Generate an image from a text description using xAI Grok Imagine. ' +
        'Fast and affordable ($0.02/image). Use for creating, drawing, designing new images — not for finding existing ones.',
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
        'Generate a high-quality professional image using xAI Grok Imagine Pro ($0.07/image). ' +
        'More expensive but higher fidelity. Use only when premium quality is explicitly requested.',
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
        'Generate a video from a text description using xAI Grok Imagine Video ($0.05/video). ' +
        'Supports text-to-video, image-to-video animation, and video editing. ' +
        'Duration 1-15 seconds, 480p or 720p. Takes 30s-2min to complete.',
      category: 'media-generation',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
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
