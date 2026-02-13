import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// POST — Add a new API key / provider configuration
// ---------------------------------------------------------------------------

/**
 * Body:
 *   { label, key, provider?, keyType?, baseUrl? }
 *
 * provider = 'anthropic' | 'openai-compatible'
 *   - 'anthropic' (default) — standard Anthropic API key or OAuth token
 *   - 'openai-compatible'   — e.g. claude-max-api-proxy at localhost:3456
 *
 * keyType = 'api-key' | 'bearer'
 *   - 'api-key' — standard sk-ant-* API key
 *   - 'bearer'  — OAuth token from `claude setup-token`
 *   - If omitted, auto-detected from key prefix
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      label,
      key,
      provider = 'anthropic',
      keyType: explicitKeyType,
      baseUrl,
    } = body as {
      label: string;
      key: string;
      provider?: 'anthropic' | 'openai-compatible';
      keyType?: 'api-key' | 'bearer';
      baseUrl?: string;
    };

    if (!label || !key) {
      return NextResponse.json({ error: 'label and key are required' }, { status: 400 });
    }

    // ── Determine key type ──
    // Setup-tokens from `claude setup-token` start with 'sk-ant-oat01-'
    // Standard API keys start with 'sk-ant-api03-'
    // Both start with 'sk-ant-' — so we must check the more specific prefix.
    const isSetupToken = key.startsWith('sk-ant-oat01-');
    const isStandardKey = key.startsWith('sk-ant-') && !isSetupToken;

    // Prefer the explicit keyType from the frontend; fall back to auto-detect
    let keyType: 'api-key' | 'bearer' = explicitKeyType ?? (isSetupToken ? 'bearer' : (isStandardKey ? 'api-key' : 'bearer'));
    let validationWarning: string | undefined;

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
    } else if (keyType === 'api-key') {
      // ── Standard Anthropic API key (sk-ant-*) — validate with a test call ──
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ apiKey: key });
        await client.messages.create({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });
        keyType = 'api-key';
      } catch (err: any) {
        if (err?.status === 401 || err?.status === 403) {
          return NextResponse.json(
            { error: 'Invalid API key. Authentication failed (401/403).' },
            { status: 400 },
          );
        }
        // Non-auth error (rate limit, model error, network) — key is valid
        keyType = 'api-key';
      }
    } else {
      // ── Setup-token / OAuth bearer token ──
      // Setup-tokens from `claude setup-token` start with 'sk-ant-oat01-' and are
      // at least 80 characters long (per OpenClaw's validation). They are passed to
      // the Anthropic SDK as `authToken` (Bearer auth), not `apiKey` (x-api-key).
      keyType = 'bearer';

      // Sanity check: setup-tokens should start with sk-ant-oat01- and be >= 80 chars
      const trimmedKey = key.trim();
      if (isSetupToken && trimmedKey.length < 80) {
        return NextResponse.json(
          { error: 'Token looks too short. Make sure you copied the full output of "claude setup-token". Expected 80+ characters starting with sk-ant-oat01-.' },
          { status: 400 },
        );
      } else if (!isSetupToken && trimmedKey.length < 20) {
        return NextResponse.json(
          { error: 'Token is too short. If using a setup-token, it should start with sk-ant-oat01-.' },
          { status: 400 },
        );
      }

      // Best-effort validation — try but don't block on failure
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({ authToken: trimmedKey });
        await client.messages.create({
          model: 'claude-3-5-haiku-latest',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });
      } catch (err: any) {
        // Log for debugging but don't block
        console.warn(`[api-keys] Setup-token validation attempt (non-blocking): status=${err?.status} message=${err?.message}`);
        validationWarning = 'Token saved. Could not validate immediately — it will be tested when you send your first message.';
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
      warning: validationWarning,
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
