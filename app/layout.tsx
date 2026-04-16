import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.uliuli.cc';
// metadataBase 需要有效 URL（支持 http 和 https）
const metadataBaseUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;

export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),
  title: "项目：丝瓜ULI",
  description: "蝴蝶梦中歌唱，彼方沉眠",
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
  icons: {
    icon: [
      { url: "/favicon.ico?v=2" },
      { url: "/ct3b.png?v=2", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/ct3b.png?v=2",
  },
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
      </body>
    </html>
  );
}