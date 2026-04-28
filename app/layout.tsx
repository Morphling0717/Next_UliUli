import type { Metadata, Viewport } from "next";
import { PwaInstallGate } from "@/components/pwa-install-gate";
import { PwaUpdateBanner } from "@/components/pwa-update-banner";
import "./globals.css";

type IphoneSplash = { w: number; h: number; deviceWidth: number; deviceHeight: number; ratio: number };
const IPHONE_SPLASHES: IphoneSplash[] = [
  // iPhone 14/15 Pro Max & 14 Plus
  { w: 1290, h: 2796, deviceWidth: 430, deviceHeight: 932, ratio: 3 },
  // iPhone 14/15 Pro
  { w: 1179, h: 2556, deviceWidth: 393, deviceHeight: 852, ratio: 3 },
  // iPhone 12/13/14 / 12 Pro / 13 Pro
  { w: 1170, h: 2532, deviceWidth: 390, deviceHeight: 844, ratio: 3 },
  // iPhone 12 Mini / 13 Mini
  { w: 1080, h: 2340, deviceWidth: 360, deviceHeight: 780, ratio: 3 },
  // iPhone 11 Pro Max / XS Max
  { w: 1242, h: 2688, deviceWidth: 414, deviceHeight: 896, ratio: 3 },
  // iPhone 11 / XR
  { w: 828, h: 1792, deviceWidth: 414, deviceHeight: 896, ratio: 2 },
  // iPhone 11 Pro / XS / X
  { w: 1125, h: 2436, deviceWidth: 375, deviceHeight: 812, ratio: 3 },
  // iPhone 8 Plus / 7 Plus / 6s Plus
  { w: 1242, h: 2208, deviceWidth: 414, deviceHeight: 736, ratio: 3 },
  // iPhone 8 / 7 / 6s / SE2 / SE3
  { w: 750, h: 1334, deviceWidth: 375, deviceHeight: 667, ratio: 2 },
];

const startupImages = IPHONE_SPLASHES.map(({ w, h, deviceWidth, deviceHeight, ratio }) => ({
  url: `/pwa-splash?w=${w}&h=${h}`,
  media: `(device-width: ${deviceWidth}px) and (device-height: ${deviceHeight}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
}));

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.uliuli.cc';
// metadataBase 需要有效 URL（支持 http 和 https）
const metadataBaseUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;

export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),
  title: "项目：丝瓜ULI",
  description: "蝴蝶梦中歌唱，彼方沉眠",
  applicationName: "UliUli",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "项目：丝瓜ULI",
    description: "蝴蝶梦中歌唱，彼方沉眠",
    url: siteUrl,
    siteName: "项目：丝瓜ULI",
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: '项目：丝瓜ULI — 蝴蝶梦中歌唱，彼方沉眠',
      },
    ],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "项目：丝瓜ULI",
    description: "蝴蝶梦中歌唱，彼方沉眠",
    images: ['/og-image.jpg'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "UliUli",
    startupImage: startupImages,
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=2" },
      { url: "/app.jpg", type: "image/jpeg" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/app.jpg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050508",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 强制浏览器不缓存 HTML (在 Next.js 里其实可以通过路由缓存策略控制，但保留你的标签以策安全) */}
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        
        {/* 引入字体 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Syncopate:wght@400;700&family=Noto+Sans+SC:wght@100;400;700&family=Ma+Shan+Zheng&display=swap"
          rel="stylesheet"
        />
        
      </head>
      <body>
        {/* 极其关键：特效挂载点 */}
        <div id="cursor"></div>
        <canvas
          id="canvas-bg"
          className="fixed top-0 left-0 w-full h-full z-0 pointer-events-none"
        ></canvas>

        {/* 页面主要内容 */}
        {children}
        <PwaUpdateBanner />
        <PwaInstallGate />
      </body>
    </html>
  );
}