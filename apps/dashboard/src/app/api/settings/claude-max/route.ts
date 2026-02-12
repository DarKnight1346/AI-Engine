import { NextRequest, NextResponse } from 'next/server';
import { ProxyManager } from '../../../../lib/proxy-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/claude-max
 *
 * Returns the status of all Claude Max proxy instances.
 */
export async function GET() {
  const manager = ProxyManager.getInstance();
  return NextResponse.json({
    accounts: manager.getAllStatuses(),
    endpoints: manager.getHealthyEndpoints(),
  });
}

/**
 * POST /api/settings/claude-max
 *
 * Add a new Claude Max account.
 *
 * Body: { label: string, authJson: string }
 *   - label:    Human-readable name (e.g. "Account 1", "team-shared-2")
 *   - authJson: Raw contents of ~/.config/claude-code/auth.json
 *               from a machine where `claude auth login` was completed
 *               with this Max subscription.
 *
 * The manager will:
 *   1. Store the auth.json in an isolated config directory
 *   2. Start a proxy instance on the next available port
 *   3. Register it as an API key in the database (auto round-robin)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { label, authJson } = body as { label: string; authJson: string };

    if (!label || !authJson) {
      return NextResponse.json(
        { error: 'label and authJson are required' },
        { status: 400 },
      );
    }

    // Basic validation of authJson
    try {
      const parsed = JSON.parse(authJson);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('not an object');
      }
    } catch {
      return NextResponse.json(
        { error: 'authJson must be valid JSON (the contents of auth.json)' },
        { status: 400 },
      );
    }

    const manager = ProxyManager.getInstance();
    const status = await manager.addAccount(label, authJson);

    return NextResponse.json({ success: true, account: status }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/settings/claude-max?id=xxx
 *
 * Remove a Claude Max account and stop its proxy.
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const manager = ProxyManager.getInstance();
    await manager.removeAccount(id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/claude-max
 *
 * Restart a specific proxy instance.
 * Body: { id: string, action: 'restart' }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action } = body as { id: string; action: string };

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const manager = ProxyManager.getInstance();

    if (action === 'restart') {
      await manager.restartProxy(id);
    }

    const status = manager.getStatus(id);
    return NextResponse.json({ success: true, account: status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
