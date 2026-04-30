import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.uliuli.cc';
const metadataBaseUrl = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
const siteOrigin = new URL(metadataBaseUrl).origin;
const siteHost = new URL(metadataBaseUrl).host;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/app',
          '/app/',
          '/m',
          '/m/',
          '/mail',
          '/mail/',
          '/offline',
          '/offline/',
          '/pwa-splash',
          '/pwa-splash/',
          '/api',
          '/api/',
          '/sw.js',
        ],
      },
    ],
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteHost,
  };
}
