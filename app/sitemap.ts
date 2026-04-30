import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.uliuli.cc";
const metadataBaseUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
const siteOrigin = new URL(metadataBaseUrl).origin;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL("/", siteOrigin).toString(),
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
