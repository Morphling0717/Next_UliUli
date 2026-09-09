// 服务端共享：从 SQLite 读取首页 SSR 需要的初始数据。
// 既给 app/page.tsx 用作 SSR 初始 prop，也给 app/sitemap.ts 用作稳定 lastModified。
// 客户端轮询 /api/config 仍然存在，server-rendered 数据只是首屏 SEO 兜底。
//
// 注意：本文件依赖 sqlite3，只能在 server runtime 跑；不要在 "use client" 组件里
// 直接 import。

import { all, get } from '@/lib/db';
import { windChime } from '@/lib/windchime';
import type { ActiveTopicSummary } from '@/components/mail/mail-topic-types';

export type SongRecord = {
  category: string;
  name: string;
  artist: string;
};

export type HiddenSongRecord = {
  name: string;
};

export type SiteConfigDocument = {
  hero?: Record<string, unknown>;
  model?: Record<string, unknown>;
  live?: Record<string, unknown>;
  gallery?: Record<string, unknown>;
  api?: Record<string, unknown>;
  song_ui?: Record<string, unknown>;
  footer?: Record<string, unknown>;
  gacha?: Record<string, unknown>;
  mail?: Record<string, unknown>;
  notifications?: Record<string, unknown>;
  videos?: Record<string, unknown>;
  activeTopics?: ActiveTopicSummary[];
  mailEnabled?: boolean;
  [key: string]: unknown;
};

export type InitialSiteData = {
  siteConfig: SiteConfigDocument;
  configVersion: number;
  configUpdatedAt: string | null;
  songs: SongRecord[];
  hiddenSongs: HiddenSongRecord[];
};

const DEFAULT_SITE_CONFIG: SiteConfigDocument = {
  hero: {},
  model: {},
  live: {},
  gallery: {},
  api: {},
  song_ui: {
    categories: [
      { id: 'all', label: 'ALL' },
      { id: 'gufeng', label: 'ANCIENT' },
      { id: 'liuxing', label: 'POP' },
      { id: 'yingyu', label: 'ENGLISH' },
      { id: 'riyu', label: 'JAPANESE' },
    ],
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

type SiteConfigRow = {
  value: string;
  updated_at: string | null;
  version: number | null;
};

/**
 * 读取整套首页 SSR 初始数据。任何子项失败都不应阻塞整体渲染——
 * 失败时回退到 DEFAULT_SITE_CONFIG / 空数组，让 client 端的 /api/config 轮询继续兜底。
 */
export async function loadInitialSiteData(): Promise<InitialSiteData> {
  let siteConfig: SiteConfigDocument = { ...DEFAULT_SITE_CONFIG };
  let configVersion = 0;
  let configUpdatedAt: string | null = null;
  let songs: SongRecord[] = [];
  let hiddenSongs: HiddenSongRecord[] = [];

  try {
    const row = await get<SiteConfigRow>(
      'SELECT value, updated_at, version FROM site_config WHERE key = ?',
      ['site_config'],
    );
    if (row) {
      try {
        const parsed = JSON.parse(row.value) as SiteConfigDocument;
        siteConfig = { ...DEFAULT_SITE_CONFIG, ...parsed };
      } catch (parseErr) {
        console.warn('[site-data] site_config JSON parse failed:', parseErr);
      }
      configVersion = Number(row.version ?? 1);
      configUpdatedAt = row.updated_at ?? null;
    }
  } catch (err) {
    console.warn('[site-data] read site_config failed:', err);
  }

  // mail 派生字段（与 /api/config 行为一致）
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
  } catch (err) {
    console.warn('[site-data] derive mail fields failed:', err);
    siteConfig.activeTopics = [];
    siteConfig.mailEnabled = true;
  }

  try {
    songs = await all<SongRecord>(
      'SELECT category, name, artist FROM songs ORDER BY id ASC',
    );
  } catch (err) {
    console.warn('[site-data] read songs failed:', err);
  }

  try {
    hiddenSongs = await all<HiddenSongRecord>(
      'SELECT name FROM hidden_songs ORDER BY id ASC',
    );
  } catch (err) {
    console.warn('[site-data] read hidden_songs failed:', err);
  }

  return {
    siteConfig,
    configVersion,
    configUpdatedAt,
    songs,
    hiddenSongs,
  };
}

/**
 * 仅读取 site_config 的 updated_at / version。
 * 给 sitemap 使用，不需要其它派生字段。
 */
export async function getSiteConfigStamp(): Promise<{
  updatedAt: string | null;
  version: number;
}> {
  try {
    const row = await get<SiteConfigRow>(
      'SELECT value, updated_at, version FROM site_config WHERE key = ?',
      ['site_config'],
    );
    return {
      updatedAt: row?.updated_at ?? null,
      version: Number(row?.version ?? 0),
    };
  } catch (err) {
    console.warn('[site-data] read site_config stamp failed:', err);
    return { updatedAt: null, version: 0 };
  }
}
