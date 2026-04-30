import type { Metadata, Viewport } from "next";
import AppFeatureHub from "@/components/app-feature-hub";

export const metadata: Metadata = {
  title: "UliUli App Hub",
  description: "只保留扭蛋机、DGP、名字大乱斗、点歌机和风铃的移动入口页。",
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "UliUli App Hub",
    description: "只保留扭蛋机、DGP、名字大乱斗、点歌机和风铃的移动入口页。",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#050508",
};

export default function AppPage() {
  return <AppFeatureHub />;
}
