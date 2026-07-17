import type { Metadata } from "next";

import type { SiteConfig } from "@/app/admin/types";
import { loadInitialSiteData } from "@/lib/site-data";

import ConceptExperience from "./ConceptExperience";

export const metadata: Metadata = {
  title: "PROJECT BLUE MORPHO · UliUli UI 概念提案",
  description: "基于 UliUli 现有内容栏目与站内系统制作的独立首页视觉概念稿。",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  alternates: {
    canonical: "/concept",
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConceptPage() {
  const initial = await loadInitialSiteData();
  const config = initial.siteConfig as SiteConfig;

  const contentLinks = config.live?.links?.length
    ? config.live.links
    : [
        {
          title: "丝瓜歌锅里",
          url: "https://space.bilibili.com/3546779356235807/lists/5897743?type=season",
          icon: "Music",
          color: "pink",
        },
        {
          title: "丝瓜切片煮",
          url: "https://space.bilibili.com/3546779356235807/lists/5897583?type=season",
          icon: "Video",
          color: "cyan",
        },
        {
          title: "蝶梦聆境",
          url: "https://space.bilibili.com/3546779356235807/lists/5897534?type=season",
          icon: "Sparkles",
          color: "purple",
        },
      ];

  return (
    <ConceptExperience
      initialSongs={initial.songs}
      initialHiddenSongs={initial.hiddenSongs.map((song) => ({
        name: song.name,
        artist: "",
        category: "hidden",
        isHidden: true,
      }))}
      initialCategories={config.song_ui?.categories || [{ id: "all", label: "ALL" }]}
      contentLinks={contentLinks}
      liveSchedule={config.live?.schedule || {}}
      requestRules={config.live?.rules || []}
      modelDetails={config.model?.details || []}
      credits={config.model?.credits || []}
    />
  );
}
