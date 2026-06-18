import { NextResponse } from 'next/server';
import { all, databasePath, dbReady, EXPECTED_MIGRATION_IDS, get } from '@/lib/db';
import { getRateLimitHealth } from '@/lib/mail-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CountRow = { count: number };
type MigrationRow = { id: string; applied_at: string };
type SiteConfigRow = { version: number | null; updated_at: string | null };
type ConfigRow = { value: string | null };

type BackupManifest = {
  source?: string;
  backup?: string;
  createdAt?: string;
  bytes?: number;
  sha256?: string;
};

function parseBackupManifest(row?: ConfigRow): BackupManifest | null {
  if (!row?.value) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as BackupManifest;
  } catch {
    return null;
  }
}

function backupHealth(manifest: BackupManifest | null) {
  if (!manifest?.createdAt) {
    return { ok: false, latest: null, reason: 'no successful backup recorded' };
  }

  const createdMs = Date.parse(manifest.createdAt);
  if (!Number.isFinite(createdMs)) {
    return { ok: false, latest: manifest, reason: 'last backup timestamp is invalid' };
  }

  const maxAgeMs = Math.max(
    1,
    Number(process.env.DB_BACKUP_MAX_AGE_HOURS || 48),
  ) * 60 * 60_000;
  const ageMs = Date.now() - createdMs;
  return {
    ok: ageMs <= maxAgeMs,
    latest: {
      ...manifest,
      ageHours: Number((ageMs / 60 / 60_000).toFixed(2)),
    },
    reason: ageMs <= maxAgeMs ? null : 'latest backup is stale',
  };
}

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, unknown> = {};
  const criticalFailures: string[] = [];
  const warnings: string[] = [];

  try {
    await dbReady;
    checks.database = { ok: true, path: databasePath };
  } catch (error) {
    criticalFailures.push('database');
    checks.database = {
      ok: false,
      error: error instanceof Error ? error.message : 'database failed',
    };
  }

  if (criticalFailures.length === 0) {
    try {
      const [
        siteConfig,
        songCount,
        hiddenCount,
        migrations,
        rateLimit,
        lastBackup,
        userCount,
        gachaProfileCount,
        gachaInventoryCount,
        unmigratedGachaUsers,
      ] =
        await Promise.all([
          get<SiteConfigRow>(
            'SELECT version, updated_at FROM site_config WHERE key = ?',
            ['site_config'],
          ),
          get<CountRow>('SELECT COUNT(*) AS count FROM songs'),
          get<CountRow>('SELECT COUNT(*) AS count FROM hidden_songs'),
          all<MigrationRow>(
            'SELECT id, applied_at FROM schema_migrations ORDER BY id ASC',
          ),
          getRateLimitHealth(),
          get<ConfigRow>(
            'SELECT value FROM global_config WHERE key = ?',
            ['db.last_backup'],
          ),
          get<CountRow>('SELECT COUNT(*) AS count FROM users'),
          get<CountRow>('SELECT COUNT(*) AS count FROM gacha_profiles'),
          get<CountRow>('SELECT COALESCE(SUM(quantity), 0) AS count FROM gacha_inventory'),
          get<CountRow>(
            `SELECT COUNT(*) AS count
               FROM users u
               LEFT JOIN gacha_profiles gp ON gp.user_id = u.id
              WHERE gp.user_id IS NULL OR gp.migrated_from_legacy_at IS NULL`,
          ),
        ]);

      if (!siteConfig) criticalFailures.push('site_config');
      checks.siteConfig = {
        ok: !!siteConfig,
        version: Number(siteConfig?.version ?? 0),
        updatedAt: siteConfig?.updated_at ?? null,
      };

      const songs = Number(songCount?.count ?? 0);
      if (songs <= 0) criticalFailures.push('songs');
      checks.songs = {
        ok: songs > 0,
        count: songs,
        hiddenCount: Number(hiddenCount?.count ?? 0),
      };

      const expectedMigrations = EXPECTED_MIGRATION_IDS;
      const applied = migrations.map((row) => row.id);
      const missing = expectedMigrations.filter((id) => !applied.includes(id));
      if (missing.length > 0) criticalFailures.push('migrations');
      checks.migrations = {
        ok: missing.length === 0,
        applied,
        missing,
      };

      checks.rateLimits = { ok: true, ...rateLimit };
      const unmigrated = Number(unmigratedGachaUsers?.count ?? 0);
      if (unmigrated > 0) warnings.push(`gacha: ${unmigrated} users not migrated`);
      checks.gacha = {
        ok: unmigrated === 0,
        users: Number(userCount?.count ?? 0),
        profiles: Number(gachaProfileCount?.count ?? 0),
        inventoryItems: Number(gachaInventoryCount?.count ?? 0),
        unmigratedUsers: unmigrated,
      };
      const backup = backupHealth(parseBackupManifest(lastBackup));
      if (!backup.ok) warnings.push(`backup: ${backup.reason}`);
      checks.backup = backup;
    } catch (error) {
      criticalFailures.push('database_checks');
      checks.databaseChecks = {
        ok: false,
        error: error instanceof Error ? error.message : 'checks failed',
      };
    }
  }

  const status =
    criticalFailures.length > 0 ? 'fail' :
    warnings.length > 0 ? 'degraded' :
    'ok';

  return NextResponse.json(
    {
      status,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
      criticalFailures,
      warnings,
    },
    {
      status: criticalFailures.length > 0 ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
