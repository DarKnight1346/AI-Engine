import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST — Add a new API key / provider configuration
// ---------------------------------------------------------------------------

/**
 * Body:
 *   { label, key, provider?, baseUrl? }
 *
 * provider = 'anthropic' | 'openai-compatible'
 *   - 'anthropic' (default) — standard Anthropic API key or OAuth token
 *   - 'openai-compatible'   — e.g. claude-max-api-proxy at localhost:3456
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      label,
      key,
      provider = 'anthropic',
      baseUrl,
    } = body as {
      label: string;
      key: string;
      provider?: 'anthropic' | 'openai-compatible';
      baseUrl?: string;
    };

    if (!label || !key) {
      return NextResponse.json({ error: 'label and key are required' }, { status: 400 });
    }

    // ── Detect key type for Anthropic provider ──
    const isStandardKey = key.startsWith('sk-ant-');
    let keyType: 'api-key' | 'bearer' = isStandardKey ? 'api-key' : 'bearer';

    // ── Validate the key / connection ──
    if (provider === 'openai-compatible') {
      // For OpenAI-compatible endpoints (e.g. claude-max-api-proxy),
      // just verify the server is reachable.
      const proxyBase = (baseUrl ?? 'http://localhost:3456/v1').replace(/\/+$/, '');
      try {
        const healthUrl = proxyBase.replace(/\/v1$/, '') + '/health';
        const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        if (!healthRes.ok) {
          // Try the models endpoint as fallback
          const modelsRes = await fetch(`${proxyBase}/models`, { signal: AbortSignal.timeout(5000) });
          if (!modelsRes.ok) {
            return NextResponse.json(
              { error: `Cannot reach proxy at ${proxyBase}. Is claude-max-api-proxy running?` },
              { status: 400 },
            );
          }
        }
      } catch (err: any) {
        return NextResponse.json(
          { error: `Cannot connect to ${proxyBase}: ${err.message}. Make sure claude-max-api-proxy is running.` },
          { status: 400 },
        );
      }
      keyType = 'api-key'; // not relevant for proxy
    } else {
      // Anthropic: validate key with a test call
      let validated = false;

      // Attempt 1: standard x-api-key auth
      if (isStandardKey) {
        try {
          const Anthropic = (await import('@anthropic-ai/sdk')).default;
          const client = new Anthropic({ apiKey: key });
          await client.messages.create({
            model: 'claude-3-5-haiku-latest',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hi' }],
          });
          validated = true;
          keyType = 'api-key';
        } catch (err: any) {
          if (err?.status === 401 || err?.status === 403) {
            // Fall through to try Bearer
          } else {
            // Non-auth error (rate limit, model error, network) — key is valid
            validated = true;
            keyType = 'api-key';
          }
        }
      }

      // Attempt 2: Bearer token auth (OAuth tokens)
      if (!validated) {
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-3-5-haiku-latest',
              max_tokens: 10,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          });

          if (res.status === 401 || res.status === 403) {
            return NextResponse.json(
              { error: 'Invalid API key or token. Authentication failed.' },
              { status: 400 },
            );
          }
          validated = true;
          keyType = 'bearer';
        } catch {
          // Network error — can't validate, don't block the user
          validated = true;
          keyType = isStandardKey ? 'api-key' : 'bearer';
        }
      }
    }

    // ── Determine tier mapping based on provider ──
    const tierMapping = provider === 'openai-compatible'
      ? { fast: 'claude-haiku-4', standard: 'claude-sonnet-4', heavy: 'claude-opus-4' }
      : { fast: 'claude-3-5-haiku-latest', standard: 'claude-sonnet-4-20250514', heavy: 'claude-opus-4-20250514' };

    const apiKey = await db.apiKey.create({
      data: {
        keyEncrypted: key,
        label,
        isActive: true,
        tierMapping,
        usageStats: {
          tokensUsed: 0,
          requestCount: 0,
          keyType,
          provider,
          baseUrl: baseUrl ?? (provider === 'openai-compatible' ? 'http://localhost:3456/v1' : undefined),
        },
      },
    });

    return NextResponse.json({
      apiKey: {
        id: apiKey.id,
        label: apiKey.label,
        isActive: apiKey.isActive,
        keyType,
        provider,
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — List all API keys (without revealing the actual key)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const db = getDb();
    const keys = await db.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        label: k.label,
        isActive: k.isActive,
        provider: (k.usageStats as any)?.provider ?? 'anthropic',
        baseUrl: (k.usageStats as any)?.baseUrl,
        keyType: (k.usageStats as any)?.keyType ?? 'api-key',
        createdAt: k.createdAt,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Toggle active status
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id, isActive } = body as { id: string; isActive: boolean };

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await db.apiKey.update({
      where: { id },
      data: { isActive },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove an API key
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await db.apiKey.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
