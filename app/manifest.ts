import type { MetadataRoute } from "next";
import { loadEditableSiteConfig } from "@/lib/site-data";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const config = await loadEditableSiteConfig();

  return {
    id: "/app",
    name: config.pwa.manifestName,
    short_name: config.pwa.manifestShortName,
    description: config.pwa.manifestDescription,
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050508",
    theme_color: "#050508",
    categories: ["entertainment", "music", "lifestyle"],
    icons: [
      {
        src: "/app.jpg",
        sizes: "192x192",
        type: "image/jpeg",
        purpose: "any",
      },
      {
        src: "/app.jpg",
        sizes: "192x192",
        type: "image/jpeg",
        purpose: "maskable",
      },
      {
        src: "/app.jpg",
        sizes: "512x512",
        type: "image/jpeg",
        purpose: "any",
      },
      {
        src: "/app.jpg",
        sizes: "512x512",
        type: "image/jpeg",
        purpose: "maskable",
      },
    ],
  };
}
