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

    // List all zones the token can see — no account filter needed.
    const res = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const data = await res.json() as any;

    if (!data.success) {
      const msg = data.errors?.[0]?.message ?? 'Failed to fetch zones';
      return NextResponse.json(
        { error: `Cloudflare API error: ${msg}` },
        { status: 400 },
      );
    }

    const zones = (data.result ?? []).map((z: any) => ({
      id: z.id,
      name: z.name,
      status: z.status,
      accountId: z.account?.id,
      accountName: z.account?.name,
    }));

    return NextResponse.json({ zones });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
