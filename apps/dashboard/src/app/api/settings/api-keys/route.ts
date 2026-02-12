import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

/** POST /api/settings/api-keys — Add a new API key */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { label, key } = body as { label: string; key: string };

    if (!label || !key) {
      return NextResponse.json({ error: 'label and key are required' }, { status: 400 });
    }

    // Validate the key with a lightweight test call
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (validateErr: any) {
      // If it's an auth error, reject the key
      if (validateErr?.status === 401 || validateErr?.message?.includes('invalid')) {
        return NextResponse.json({ error: 'Invalid API key. Authentication failed.' }, { status: 400 });
      }
      // Other errors (rate limit, network) — key might still be valid, allow it
    }

    const apiKey = await db.apiKey.create({
      data: {
        keyEncrypted: key,
        label,
        isActive: true,
        tierMapping: { fast: 'claude-3-5-haiku-20241022', standard: 'claude-sonnet-4-20250514', heavy: 'claude-opus-4-20250514' },
        usageStats: { tokensUsed: 0, requestCount: 0 },
      },
    });

    return NextResponse.json({
      apiKey: { id: apiKey.id, label: apiKey.label, isActive: apiKey.isActive },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** PATCH /api/settings/api-keys — Toggle active status */
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

/** DELETE /api/settings/api-keys?id=xxx — Remove an API key */
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
