import { NextResponse } from 'next/server';
import { getDb } from '@ai-engine/db';
import { TunnelManager } from '../../../../lib/tunnel-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/setup/status
 *
 * Returns detailed completion status for every setup step so the setup
 * wizard can auto-advance past already-completed steps after a redeploy
 * or server restart.
 */
export async function GET() {
  // Start with safe defaults (nothing completed)
  const result: Record<string, any> = {
    setupComplete: false,
    // Per-step completion flags
    hasTunnel: false,
    tunnelUrl: null as string | null,
    tunnelMode: null as string | null,
    hasDatabase: false,
    hasRedis: false,
    isInitialized: false,
    hasAdmin: false,
    hasTeam: false,
    hasApiKey: false,
    hasPassphrase: false,
  };

  // ── Tunnel ──
  try {
    const tunnel = TunnelManager.getInstance();
    const state = tunnel.getState();
    if (state.mode === 'named' && state.url) {
      result.hasTunnel = true;
      result.tunnelUrl = state.url;
      result.tunnelMode = 'named';
    } else if (state.url) {
      result.tunnelUrl = state.url;
      result.tunnelMode = state.mode ?? 'temporary';
    }
  } catch { /* tunnel not available */ }

  // ── Database & Redis env vars ──
  result.hasDatabase = !!process.env.DATABASE_URL;
  result.hasRedis = !!process.env.REDIS_URL;

  // ── Database queries (only if DATABASE_URL is set) ──
  if (result.hasDatabase) {
    try {
      const db = getDb();

      // Quick parallel queries
      const [userCount, teamCount, apiKeyCount, passphraseConfig] = await Promise.all([
        db.user.count().catch(() => 0),
        db.team.count().catch(() => 0),
        db.apiKey.count().catch(() => 0),
        db.config.findUnique({ where: { key: 'vaultPassphraseHash' } }).catch(() => null),
      ]);

      result.isInitialized = true; // If queries succeed, DB is migrated
      result.hasAdmin = userCount > 0;
      result.hasTeam = teamCount > 0;
      result.hasApiKey = apiKeyCount > 0;
      result.hasPassphrase = !!passphraseConfig;
      result.setupComplete = result.hasAdmin; // Minimum for "setup complete"
    } catch {
      // DB not reachable or not migrated — isInitialized stays false
    }
  }

  return NextResponse.json(result);
}
