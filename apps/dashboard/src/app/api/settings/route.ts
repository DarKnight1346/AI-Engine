import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // Get API keys (never expose the encrypted key itself)
    const apiKeys = await db.apiKey.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Get the current user (admin)
    const user = await db.user.findFirst({ where: { role: 'admin' } });

    // Get config values
    const configs = await db.config.findMany();
    const configMap: Record<string, unknown> = {};
    configs.forEach((c) => {
      configMap[c.key] = c.valueJson;
    });

    // Get worker count
    const HEARTBEAT_TIMEOUT_MS = 30_000;
    const now = new Date();
    const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
    const onlineWorkers = await db.node.count({
      where: { lastHeartbeat: { gte: cutoff } },
    });
    const totalWorkers = await db.node.count();

    // Get scheduler heartbeat
    const lastHeartbeat = await db.schedulerHeartbeat.findFirst({
      orderBy: { tickedAt: 'desc' },
    });

    // Get version from package.json (runtime read)
    let version = '0.1.0';
    try {
      const pkg = await import('../../../../package.json');
      version = (pkg as any).version ?? version;
    } catch { /* fallback */ }

    return NextResponse.json({
      apiKeys: apiKeys.map((k) => ({
        id: k.id,
        label: k.label,
        isActive: k.isActive,
        tierMapping: k.tierMapping,
        usageStats: k.usageStats,
        createdAt: k.createdAt.toISOString(),
      })),
      user: user ? {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      } : null,
      config: configMap,
      system: {
        version,
        onlineWorkers,
        totalWorkers,
        lastSchedulerTick: lastHeartbeat?.tickedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Update config values
    if (body.config) {
      for (const [key, value] of Object.entries(body.config)) {
        await db.config.upsert({
          where: { key },
          update: { valueJson: value as any, version: { increment: 1 } },
          create: { key, valueJson: value as any },
        });
      }
    }

    // Update user profile
    if (body.displayName) {
      const user = await db.user.findFirst({ where: { role: 'admin' } });
      if (user) {
        await db.user.update({
          where: { id: user.id },
          data: { displayName: body.displayName },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
