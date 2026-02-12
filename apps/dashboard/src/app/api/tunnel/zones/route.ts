import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/tunnel/zones
 *
 * Lists the user's Cloudflare zones (domains) given an API token and account ID.
 * The frontend calls this to populate a zone selector.
 *
 * Body: { apiToken, accountId }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiToken, accountId } = body;

    if (!apiToken) {
      return NextResponse.json({ error: 'apiToken is required' }, { status: 400 });
    }

    // Build URL — scope to account if provided
    const url = accountId
      ? `https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&per_page=50&status=active`
      : `https://api.cloudflare.com/client/v4/zones?per_page=50&status=active`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const data = await res.json() as any;

    if (!data.success) {
      return NextResponse.json(
        { error: data.errors?.[0]?.message ?? 'Failed to fetch zones' },
        { status: 400 },
      );
    }

    const zones = (data.result ?? []).map((z: any) => ({
      id: z.id,
      name: z.name,
      status: z.status,
    }));

    return NextResponse.json({ zones });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
