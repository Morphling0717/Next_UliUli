// 主站首页 = Server Component。
//
// 与之前 client-only 实现的区别：
// - 这里在 server 端先从 SQLite 读出 siteConfig / songs / hiddenSongs，作为
//   initial prop 喂给 <HomeClient />；首屏 SSR HTML 直接带完整的 hero / model /
//   credits / 歌单等关键词文案，不需要等 hydration 后 fetch /api/config 才出文。
//   这是国内不跑 JS 的搜索引擎（百度 / 360 / 搜狗 / 神马）抓得到「丝瓜 / 丝瓜Uli」
//   等关键词的关键。
// - 同时把"歌单 / 名片"做成 MusicPlaylist + ItemList 的 JSON-LD，让 Google 富
//   结果有更多上下文。
// - 客户端逻辑（轮询 /api/config、扭蛋彩蛋、avatar 解锁、Three.js 背景、自定义
//   光标、各种 modal）全保留在 components/HomeClient.tsx 里。

import type { Metadata } from 'next';

import HomeClient from '@/components/HomeClient';
import { loadInitialSiteData, type SongRecord } from '@/lib/site-data';
import type { SongItem as SongSystemSongItem } from '@/components/SongSystem';

// 主站默认 metadata 已经在 app/layout.tsx 里给出，这里仅显式声明 indexable，
// 防止任何上层覆盖意外把首页变成 noindex（其余页面如 /m/* /admin /app 都各自 noindex）。
export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
  },
};

// 首页要每次访问都渲染最新数据；与 /api/config 行为一致。
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://uliuli.cn';
const metadataBaseUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
const siteOrigin = new URL(metadataBaseUrl).origin;

function toSongSystemItem(s: SongRecord): SongSystemSongItem {
  return { name: s.name, artist: s.artist, category: s.category };
}

// 把数据库里的常规歌单导出成 schema.org MusicPlaylist
function buildMusicPlaylistSchema(songs: SongRecord[]) {
  if (!songs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicPlaylist',
    name: '丝瓜Uli 点歌单',
    description: '丝瓜Uli（UliUli）的点歌歌单，包含古风、流行、英文、日文等多类目曲目。',
    url: new URL('/#song-system', siteOrigin).toString(),
    numTracks: songs.length,
    inLanguage: 'zh-CN',
    track: songs.slice(0, 50).map((song, i) => ({
      '@type': 'MusicRecording',
      position: i + 1,
      name: song.name,
      byArtist: song.artist
        ? { '@type': 'MusicGroup', name: song.artist }
        : undefined,
      genre: song.category,
    })),
  };
}

export default async function HomePage() {
  const initial = await loadInitialSiteData();

  const playlistSchema = buildMusicPlaylistSchema(initial.songs);

  return (
    <>
      {playlistSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(playlistSchema) }}
        />
      ) : null}

      <HomeClient
        initialSiteConfig={initial.siteConfig}
        initialConfigVersion={initial.configVersion}
        initialSongs={initial.songs.map(toSongSystemItem)}
        initialHiddenSongs={initial.hiddenSongs.map((s) => ({
          name: s.name,
          artist: '',
          category: 'hidden',
        }))}
      />
    </>
  );
}
