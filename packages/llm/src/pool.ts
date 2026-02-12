import Anthropic from '@anthropic-ai/sdk';
import { KeyManager } from './key-manager.js';
import type { LLMTier, LLMCallOptions, LLMResponse, LLMMessage, LoadBalanceStrategy } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

function toAnthropicMessage(m: LLMMessage): { role: 'user' | 'assistant'; content: string | Anthropic.ContentBlockParam[] } {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  const blocks = m.content.map((c) => {
    if (c.type === 'text') return { type: 'text' as const, text: c.text };
    if (c.type === 'image' && c.source.type === 'base64') {
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: c.source.mediaType, data: c.source.data } };
    }
    if (c.type === 'tool_use') return { type: 'tool_use' as const, id: c.id, name: c.name, input: c.input };
    if (c.type === 'tool_result') return { type: 'tool_result' as const, tool_use_id: c.toolUseId, content: c.content };
    return { type: 'text' as const, text: '' };
  });
  return { role: m.role, content: blocks as Anthropic.ContentBlockParam[] };
}

export interface LLMPoolOptions {
  keys: Array<{ id: string; apiKey: string; tierMapping?: Record<LLMTier, string> }>;
  strategy?: LoadBalanceStrategy;
  defaultTierMapping?: Record<LLMTier, string>;
}

export interface KeyState {
  id: string;
  requestCount: number;
  tokensUsed: number;
  errorCount: number;
  isHealthy: boolean;
  lastUsedAt: Date | null;
  rateLimitedUntil: Date | null;
}

export class LLMPool {
  private keyManager: KeyManager;
  private clients: Map<string, Anthropic> = new Map();
  private defaultTierMapping: Record<LLMTier, string>;

  constructor(private options: LLMPoolOptions) {
    this.defaultTierMapping = options.defaultTierMapping ?? DEFAULT_CONFIG.llm.defaultTierMapping;
    this.keyManager = new KeyManager(
      options.keys.map((k) => k.id),
      options.strategy ?? 'round-robin'
    );

    for (const key of options.keys) {
      this.clients.set(key.id, new Anthropic({ apiKey: key.apiKey }));
    }
  }

  async call(messages: LLMMessage[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const tier = options.tier ?? DEFAULT_CONFIG.llm.defaultTier;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyId = this.keyManager.getNextKey();
      if (!keyId) {
        throw new Error('No healthy API keys available');
      }

      const client = this.clients.get(keyId);
      if (!client) continue;

      const keyConfig = this.options.keys.find((k) => k.id === keyId);
      const tierMapping = keyConfig?.tierMapping ?? this.defaultTierMapping;
      const model = tierMapping[tier];

      try {
        const response = await client.messages.create({
          model,
          max_tokens: options.maxTokens ?? DEFAULT_CONFIG.llm.defaultMaxTokens,
          temperature: options.temperature ?? DEFAULT_CONFIG.llm.defaultTemperature,
          system: options.systemPrompt,
          messages: messages.map(toAnthropicMessage),
        });

        this.keyManager.recordSuccess(keyId, response.usage.input_tokens + response.usage.output_tokens);

        const textContent = response.content
          .filter((c): c is Anthropic.TextBlock => c.type === 'text')
          .map((c) => c.text)
          .join('');

        const toolCalls = response.content
          .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
          .map((c) => ({ id: c.id, name: c.name, input: c.input as Record<string, unknown> }));

        return {
          content: textContent,
          toolCalls,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          model,
          stopReason: response.stop_reason ?? 'end_turn',
        };
      } catch (err: any) {
        lastError = err;
        const statusCode = err?.status ?? err?.statusCode;

        if (statusCode === 429) {
          const retryAfter = parseInt(err?.headers?.['retry-after'] ?? '60', 10);
          this.keyManager.recordRateLimit(keyId, retryAfter * 1000);
        } else {
          this.keyManager.recordError(keyId);
        }
      }
    }

    throw lastError ?? new Error('LLM call failed after retries');
  }

  getKeyStates(): KeyState[] {
    return this.keyManager.getStates();
  }

  addKey(id: string, apiKey: string, tierMapping?: Record<LLMTier, string>): void {
    this.options.keys.push({ id, apiKey, tierMapping });
    this.clients.set(id, new Anthropic({ apiKey }));
    this.keyManager.addKey(id);
  }

  removeKey(id: string): void {
    this.options.keys = this.options.keys.filter((k) => k.id !== id);
    this.clients.delete(id);
    this.keyManager.removeKey(id);
  }
}
