import type { Metadata, Viewport } from "next";
import Script from "next/script";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.uliuli.cc";
const metadataBaseUrl = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
const siteOrigin = new URL(metadataBaseUrl).origin;
const canonicalUrl = new URL("/", siteOrigin).toString();
const ogImageLandscape = new URL("/og-image.jpg", siteOrigin).toString();
// 方形分享图（微信 / 微博 / QQ 国内分享卡片更多用方形缩略图）。
// public/app.jpg 是 402x402 方形 JPEG，正好可以同时充当 PWA 图标和方形 OG。
const ogImageSquare = new URL("/app.jpg", siteOrigin).toString();
const siteTitle = "丝瓜Uli | UliUli 主站";
const siteDescription = "丝瓜Uli（丝瓜 / 丝瓜ULI / UliUli）官方主站，集中展示直播、歌回、视频、点歌与互动内容。";
const siteKeywords = [
  "丝瓜",
  "丝瓜Uli",
  "丝瓜ULI",
  "UliUli",
  "ULI",
  "VTuber",
  "虚拟主播",
  "歌回",
  "直播",
  "点歌",
  "主站",
];
const sameAsLinks = [
  process.env.NEXT_PUBLIC_BILIBILI_LIVE_URL,
  process.env.NEXT_PUBLIC_BILIBILI_SPACE_URL,
  process.env.NEXT_PUBLIC_WEIBO_URL,
  process.env.NEXT_PUBLIC_DOUYIN_URL,
  process.env.NEXT_PUBLIC_XIAOHONGSHU_URL,
  process.env.NEXT_PUBLIC_X_URL,
].filter((value): value is string => Boolean(value));
const googleSiteVerification =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "-XdV8ranOz9CFlWKYkc3NZ8VDv-5PGwCBXyaD57fOh4";
const bingSiteVerification =
  process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || "F855BDDAE6A00B5C07F387EE9710F8A7";
const verificationMetas = [
  { name: "baidu-site-verification", content: process.env.NEXT_PUBLIC_BAIDU_SITE_VERIFICATION },
  { name: "sogou_site_verification", content: process.env.NEXT_PUBLIC_SOGOU_SITE_VERIFICATION },
  { name: "so-site-verification", content: process.env.NEXT_PUBLIC_360_SITE_VERIFICATION },
  { name: "msvalidate.01", content: bingSiteVerification },
  { name: "google-site-verification", content: googleSiteVerification },
].filter((item): item is { name: string; content: string } => Boolean(item.content));
const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteTitle,
    alternateName: ["丝瓜", "丝瓜Uli", "丝瓜ULI", "UliUli", "ULI"],
    url: canonicalUrl,
    description: siteDescription,
    inLanguage: "zh-CN",
    keywords: siteKeywords.join(", "),
  },
  {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: "丝瓜Uli 官方主页",
    url: canonicalUrl,
    inLanguage: "zh-CN",
    mainEntity: {
      "@type": "Person",
      name: "丝瓜Uli",
      alternateName: ["丝瓜", "丝瓜ULI", "UliUli", "ULI"],
      description: siteDescription,
      url: canonicalUrl,
      image: new URL("/og-image.jpg", siteOrigin).toString(),
      jobTitle: "VTuber",
      ...(sameAsLinks.length > 0 ? { sameAs: sameAsLinks } : {}),
    },
  },
];

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: siteTitle,
  description: siteDescription,
  keywords: siteKeywords,
  authors: [{ name: "丝瓜Uli", url: canonicalUrl }],
  creator: "丝瓜Uli",
  publisher: "UliUli",
  category: "entertainment",
  classification: "VTuber, Music, Live Streaming",
  alternates: {
    canonical: canonicalUrl,
    // 单语站点显式声明 zh-CN，避免 Google 把空缺的 hreflang 误判成需要其他语言版本。
    languages: {
      "zh-CN": canonicalUrl,
      "x-default": canonicalUrl,
    },
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  applicationName: "UliUli",
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: canonicalUrl,
    siteName: "丝瓜Uli | UliUli",
    images: [
      // 横版优先（Twitter / Facebook / Telegram / 飞书）
      {
        url: ogImageLandscape,
        width: 1200,
        height: 630,
        alt: "丝瓜Uli | UliUli 主站",
        type: "image/jpeg",
      },
      // 方形备选（微信 / 微博 / QQ / 钉钉）
      {
        url: ogImageSquare,
        width: 402,
        height: 402,
        alt: "丝瓜Uli | UliUli",
        type: "image/jpeg",
      },
    ],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [ogImageLandscape],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "丝瓜Uli",
    startupImage: startupImages,
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any" },
      { url: "/app.jpg", type: "image/jpeg", sizes: "402x402" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [
      // iOS 添加到主屏幕标准入口；402x402 jpg 在 iOS 12+ 上能正确呈现。
      { url: "/app.jpg", sizes: "180x180", type: "image/jpeg" },
      { url: "/app.jpg", sizes: "402x402", type: "image/jpeg" },
    ],
  },
  other: {
    "applicable-device": "pc,mobile",
    "msapplication-TileColor": "#050508",
    // 国内分享卡片解析常用的额外字段（image_src 兼容老版本微博/QQ）。
    "image_src": ogImageSquare,
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
        {/* 注意：之前这里有 <meta http-equiv="Cache-Control" no-store> 三件套，
         * 会主动告诉爬虫 / CDN 不要缓存 HTML，等于压低了搜索引擎抓取频率，
         * 也吃掉了 Cloudflare 边缘缓存收益。已改由 /api/config 端点自身保持
         * no-store，HTML 本身允许 CDN 协商缓存，对 SEO 与 TTFB 都更友好。 */}

        {/* LCP 关键资源预加载：首屏看到的第一张大图就是默认 Model.webp，
         * 提示浏览器尽早开始下载，能稳定降低 LCP。
         * fetchPriority 驼峰是 React 18.3+ 标准 DOM prop。 */}
        <link
          rel="preload"
          as="image"
          href="/Model.webp"
          fetchPriority="high"
        />

        {/* 引入字体：preconnect + 异步 stylesheet (display=swap)。
         *
         * 字体异步化策略：SSR 阶段先把 stylesheet 标成 media="print"（不阻塞渲染），
         * 紧跟一段内联脚本把所有 print stylesheet 改回 media="all"。脚本在 head 里
         * 执行非常早，字体几乎没延迟。
         *
         * 注意：之前曾尝试在 <link> 上写 onLoad="this.media='all'"，但 React 不接
         * 受字符串形式的事件处理器，会每次渲染都报 "Expected onLoad listener to be
         * a function" 把 console / hydration 拖死。已改用独立 <script> 注入。
         */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Syncopate:wght@400;700&family=Noto+Sans+SC:wght@100;400;700&family=Ma+Shan+Zheng&display=swap"
          media="print"
          data-async-font="true"
        />
        <Script id="async-google-fonts" strategy="afterInteractive">
          {"document.querySelectorAll('link[data-async-font]').forEach(function(l){l.media='all';});"}
        </Script>
        <noscript>
          {/* JS 关闭时（含部分爬虫）回退到普通同步加载，保证字体可用。 */}
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Syncopate:wght@400;700&family=Noto+Sans+SC:wght@100;400;700&family=Ma+Shan+Zheng&display=swap"
          />
        </noscript>

        {verificationMetas.map(({ name, content }) => (
          <meta key={name} name={name} content={content} />
        ))}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
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