import { NextResponse } from 'next/server';
import { get, all } from '@/lib/db';
import { windChime } from '@/lib/windchime';

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

type CountRow = {
  count: number;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // 从数据库获取 site_config
    const configRow = await get<SiteConfigRow>(
      'SELECT value, updated_at, updated_by, version FROM site_config WHERE key = ?',
      ['site_config']
    );

    const siteConfig = configRow 
      ? JSON.parse(configRow.value) 
      : {
          hero: {},
          model: {},
          live: {},
          gallery: {},
          api: {},
          song_ui: {
            categories: [
              { id: "all", label: "ALL" },
              { id: "gufeng", label: "ANCIENT" },
              { id: "liuxing", label: "POP" },
              { id: "yingyu", label: "ENGLISH" },
              { id: "riyu", label: "JAPANESE" },
            ]
          },
          footer: {},
          gacha: {
            pityThreshold: 8000,
            softPityStart: 5000,
            baseRate: 1 / 10000,
            maxRate: 0.6,
          },
          mail: {},
        };

    // The client uses the same-origin route; upstream configuration belongs to the server.
    siteConfig.api = { ...siteConfig.api, bilibili: '/api/bilibili' };

    // -------------------------------------------------------------
    // Mail 派生字段（方案 §6.3）
    //
    // 把"当前有效活动主题列表"和"default 主题开关"注入 siteConfig，
    // 横幅组件和 MailSpeedDial 从这里读，不再各自独立轮询 /api/mail/*。
    // 派生逻辑不写进 site_config 表，每次 GET 都是实时查；失败时静默
    // 兜底（空数组 + true），绝不阻塞整个 /api/config 响应。
    // -------------------------------------------------------------
    try {
      const activeTopics = await windChime.listPublicTopics();
      siteConfig.activeTopics = activeTopics.map((t) => ({
        slug: t.slug,
        title: t.title,
        description: t.description,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
      }));
      const defaultTopic = await windChime.getPublicTopic("default");
      siteConfig.mailEnabled = defaultTopic ? defaultTopic.isEnabled : true;
    } catch (e) {
      console.warn('[api/config] activeTopics/mailEnabled 派生失败:', e);
      siteConfig.activeTopics = [];
      siteConfig.mailEnabled = true;
    }

    // 从数据库获取所有歌曲
    const songs = await all<SongRow>('SELECT category, name, artist FROM songs ORDER BY id ASC');

    // 从数据库获取所有隐藏歌曲
    const hiddenSongs = await all<HiddenSongRow>('SELECT name FROM hidden_songs ORDER BY id ASC');

    const configVersion = configRow
      ? Number(configRow.version ?? 1)
      : 0;
    const historyCountRow = await get<CountRow>(
      'SELECT COUNT(*) AS count FROM site_config_history'
    );

    return NextResponse.json(
      {
        success: true,
        config_version: configVersion,
        config_updated_at: configRow?.updated_at ?? null,
        config_updated_by: configRow?.updated_by ?? null,
        config_history_count: Number(historyCountRow?.count ?? 0),
        site_config: siteConfig,
        songs: songs.map(s => ({
          category: s.category,
          name: s.name,
          artist: s.artist
        })),
        hidden_songs: hiddenSongs.map(h => ({ name: h.name }))
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );

  } catch (error: unknown) {
    console.error("Config API Error:", error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({
      success: false,
      message: '服务器错误: ' + message
    }, { status: 500 });
  }
}
