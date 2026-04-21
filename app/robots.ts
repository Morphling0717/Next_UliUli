import type { MetadataRoute } from 'next';

/**
 * robots.txt：屏蔽发信箱后台和 API，避免搜索引擎收录。
 * 其他路径（首页、扭蛋等）保持默认允许。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/mail', '/mail/', '/api/mail/'],
      },
    ],
  };
}
