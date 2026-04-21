import { NextRequest, NextResponse } from 'next/server';
import { get, all } from '@/lib/db';
import { getDefaultTopic, listTopics } from '@/lib/mail-topics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    // 从数据库获取 site_config
    const configRow = await get(
      'SELECT value, updated_at FROM site_config WHERE key = ?',
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

    // -------------------------------------------------------------
    // Mail 派生字段（方案 §6.3）
    //
    // 把"当前有效活动主题列表"和"default 主题开关"注入 siteConfig，
    // 横幅组件和 MailSpeedDial 从这里读，不再各自独立轮询 /api/mail/*。
    // 派生逻辑不写进 site_config 表，每次 GET 都是实时查；失败时静默
    // 兜底（空数组 + true），绝不阻塞整个 /api/config 响应。
    // -------------------------------------------------------------
    try {
      const activeTopics = await listTopics({ onlyPublicActive: true });
      siteConfig.activeTopics = activeTopics.map((t) => ({
        slug: t.slug,
        title: t.title,
        description: t.description,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
      }));
      const defaultTopic = await getDefaultTopic();
      siteConfig.mailEnabled = defaultTopic ? defaultTopic.isEnabled : true;
    } catch (e) {
      console.warn('[api/config] activeTopics/mailEnabled 派生失败:', e);
      siteConfig.activeTopics = [];
      siteConfig.mailEnabled = true;
    }

    // 从数据库获取所有歌曲
    const songs = await all('SELECT category, name, artist FROM songs ORDER BY id ASC');

    // 从数据库获取所有隐藏歌曲
    const hiddenSongs = await all('SELECT name FROM hidden_songs ORDER BY id ASC');

    const configVersion = configRow?.updated_at
      ? new Date(configRow.updated_at).getTime()
      : 0;

    return NextResponse.json(
      {
        success: true,
        config_version: configVersion,
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

  } catch (error: any) {
    console.error("Config API Error:", error);
    return NextResponse.json({
      success: false,
      message: '服务器错误: ' + error.message
    }, { status: 500 });
  }
}
