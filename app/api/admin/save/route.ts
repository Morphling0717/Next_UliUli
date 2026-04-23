import { NextRequest, NextResponse } from 'next/server';
import { all, get, run } from '@/lib/db';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();

type SiteConfigRow = {
  value: string;
  updated_at: string | null;
  updated_by: string | null;
  version: number | null;
};

type SongRow = {
  category: string;
  name: string;
  artist: string;
};

type HiddenSongRow = {
  name: string;
};

type SaveBody = {
  password?: string;
  editor_name?: string;
  base_config_version?: number;
  site_info?: Record<string, unknown>;
  song_data?: SongRow[];
  hidden_songs?: HiddenSongRow[];
};

export async function POST(request: NextRequest) {
  try {
    if (!ADMIN_PASSWORD) {
      return NextResponse.json(
        {
          success: false,
          message: '服务器未配置 ADMIN_PASSWORD 环境变量',
        },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => null)) as SaveBody | null;

    if (!body) {
      return NextResponse.json({ success: false, message: 'No data received' });
    }

    if (body.password !== ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, message: '密码错误，拒绝访问' });
    }

    const editorName =
      typeof body.editor_name === 'string' ? body.editor_name.trim() : '';
    if (!editorName) {
      return NextResponse.json({
        success: false,
        message: '请先填写本次修改人',
      });
    }

    const baseConfigVersion = Number(body.base_config_version);
    if (!Number.isInteger(baseConfigVersion) || baseConfigVersion < 0) {
      return NextResponse.json({
        success: false,
        message: '缺少有效的配置版本号，请刷新后台后重试',
      });
    }

    const { site_info, song_data, hidden_songs } = body;

    if (!site_info || !song_data) {
      return NextResponse.json({ success: false, message: '数据格式不完整' });
    }

    if (
      typeof site_info !== 'object' ||
      site_info === null ||
      Array.isArray(site_info) ||
      Object.keys(site_info).length === 0
    ) {
      return NextResponse.json({
        success: false,
        message: '配置为空，已拒绝保存',
      });
    }

    if (!Array.isArray(song_data) || song_data.length === 0) {
      return NextResponse.json({
        success: false,
        message: '歌曲列表为空，已拒绝保存',
      });
    }

    const safeHiddenSongs = Array.isArray(hidden_songs) ? hidden_songs : [];

    await run('BEGIN IMMEDIATE TRANSACTION');

    try {
      const currentConfigRow = await get<SiteConfigRow>(
        'SELECT value, updated_at, updated_by, version FROM site_config WHERE key = ?',
        ['site_config'],
      );
      const currentVersion = currentConfigRow
        ? Number(currentConfigRow.version ?? 1)
        : 0;

      if (baseConfigVersion !== currentVersion) {
        await run('ROLLBACK').catch(() => {});
        return NextResponse.json(
          {
            success: false,
            code: 'CONFIG_VERSION_CONFLICT',
            message: '站点配置已被其他人更新，请先刷新最新内容再保存',
            current_version: currentVersion,
            config_updated_at: currentConfigRow?.updated_at ?? null,
            config_updated_by: currentConfigRow?.updated_by ?? null,
          },
          { status: 409 },
        );
      }

      if (currentConfigRow) {
        const currentSongs = await all<SongRow>(
          'SELECT category, name, artist FROM songs ORDER BY id ASC',
        );
        const currentHiddenSongs = await all<HiddenSongRow>(
          'SELECT name FROM hidden_songs ORDER BY id ASC',
        );
        await run(
          `INSERT OR IGNORE INTO site_config_history
             (snapshot_version, snapshot_updated_at, snapshot_updated_by,
              backed_up_at, site_config_value, songs_value, hidden_songs_value)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            currentVersion,
            currentConfigRow.updated_at,
            currentConfigRow.updated_by,
            new Date().toISOString(),
            currentConfigRow.value,
            JSON.stringify(currentSongs),
            JSON.stringify(currentHiddenSongs),
          ],
        );
      }

      const nextVersion = currentVersion + 1;
      const updatedAt = new Date().toISOString();
      const siteConfigJson = JSON.stringify(site_info);

      await run(
        `INSERT INTO site_config (key, value, updated_at, version, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           version = excluded.version,
           updated_by = excluded.updated_by`,
        ['site_config', siteConfigJson, updatedAt, nextVersion, editorName],
      );

      await run('DELETE FROM songs');
      for (const song of song_data) {
        await run(
          `INSERT INTO songs (category, name, artist) VALUES (?, ?, ?)`,
          [song.category, song.name, song.artist],
        );
      }

      await run('DELETE FROM hidden_songs');
      for (const hidden of safeHiddenSongs) {
        await run(`INSERT INTO hidden_songs (name) VALUES (?)`, [hidden.name]);
      }

      await run('COMMIT');

      return NextResponse.json({
        success: true,
        message: '数据已保存到数据库',
        config_version: nextVersion,
        config_updated_at: updatedAt,
        config_updated_by: editorName,
      });
    } catch (txError) {
      await run('ROLLBACK').catch(() => {});
      throw txError;
    }
  } catch (error: unknown) {
    console.error('Save API Error:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      {
        success: false,
        message: `服务器错误: ${message}`,
      },
      { status: 500 },
    );
  }
}