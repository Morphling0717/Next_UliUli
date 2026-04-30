import type { MetadataRoute } from "next";
import { getSiteConfigStamp } from "@/lib/site-data";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.uliuli.cc";
const metadataBaseUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
const siteOrigin = new URL(metadataBaseUrl).origin;

// 站点目前只有主站 / 一条 indexable URL（其余 /m/*、/admin、/app、/mail 都
// 各自 noindex，按用户要求"只主站收录"）。
//
// lastModified 之前每次请求都返回 new Date()，对搜索引擎来说"始终在变"，反而会
// 触发不必要的重抓取。这里换成 site_config.updated_at（后台改文案 / 推新版本
// 才真正变），让爬虫只在内容真正更新时来抓。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stamp = await getSiteConfigStamp();
  const lastModified = stamp.updatedAt
    ? new Date(stamp.updatedAt)
    : new Date();

  return [
    {
      url: new URL("/", siteOrigin).toString(),
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
