# SEO 配置检查清单（已验证）

本文档记录 uliuli.cc 部署后经过实际验证的 SEO / Open Graph 配置状态。

---

## ✅ Open Graph 元数据（app/layout.tsx）

已在 `app/layout.tsx` 中配置完整的 Open Graph 元数据：

```ts
export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),  // https://www.uliuli.cc
  title: "项目：丝瓜ULI",
  description: "蝴蝶梦中歌唱，彼方沉眠",
  openGraph: {
    title: "项目：丝瓜ULI",
    description: "蝴蝶梦中歌唱，彼方沉眠",
    url: "https://www.uliuli.cc",
    siteName: "项目：丝瓜ULI",
    images: [{ url: '/og-image.jpg', width: 1200, height: 630 }],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', ... },
};
```

**验证方式：**
```bash
curl -s http://localhost:3000 | grep 'og:'
# 可以看到所有 og:title / og:description / og:image / og:url 等标签
```

---

## ✅ OG 预览图（public/og-image.jpg）

- 路径：`/opt/1panel/www/uliuli/app/public/og-image.jpg`
- 尺寸：**1200 × 630 px**（标准比例 1.91:1）
- 格式：JPEG，渐进式
- 文件大小：约 251 KB
- 外部可访问：`https://www.uliuli.cc/og-image.jpg` → HTTP 200

**验证方式：**
```bash
file /opt/1panel/www/uliuli/app/public/og-image.jpg
# 应输出: JPEG image data, 1200x630

curl -sI https://www.uliuli.cc/og-image.jpg
# 应看到 HTTP/2 200 和 content-type: image/jpeg
```

---

## ✅ 环境变量（docker-compose.yml）

`NEXT_PUBLIC_SITE_URL` 已正确写入 docker-compose.yml：

```yaml
environment:
  - NEXT_PUBLIC_SITE_URL=https://www.uliuli.cc
```

**作用：** 让 `metadataBase` 生成正确的绝对 URL，使 `og:image` 和 `og:url` 指向正式域名。

---

## ✅ 网站可访问性

- HTTPS 证书：有效（Cloudflare 托管）
- HTTP/2：已启用
- 主页响应：HTTP 200

**验证方式：**
```bash
curl -sI https://www.uliuli.cc
# 应看到 HTTP/2 200 和 server: cloudflare
```

---

## ✅ 域名安全检测

- 腾讯 URL 安全检测：**暂未发现风险**
- 检测地址：https://urlsec.qq.com/check.html?url=https://www.uliuli.cc

---

## ✅ Cloudflare 安全设置

- Bot Fight Mode：**关闭**
- Hotlink Protection：**关闭**
- 缓存已清除（Purge Everything 执行过一次）

---

## QQ 分享卡片预览效果

本地 cpolar 测试时，QQ 发送链接后卡片显示内容：

| 字段 | 内容 |
|------|------|
| 标题 | 项目：丝瓜ULI |
| 描述 | 蝴蝶梦中歌唱，彼方沉眠 |
| 缩略图 | og-image.jpg（右侧小图） |

> **注：** QQ 对新域名有冷启动延迟，部署后 24 小时内可能不显示卡片，属正常现象。

---

## 更新 OG 图片流程（以后换图用）

1. 将新图片命名为 `og-image.jpg`（1200×630，JPEG，< 300KB）
2. 上传到服务器 `/opt/1panel/www/uliuli/app/public/og-image.jpg`
3. 在 Cloudflare Dashboard → Caching → **Purge Everything**（清除 CDN 缓存）
4. 无需重新构建 Docker 镜像（静态文件直接生效）

---

## 重新部署流程（改了源码后）

```bash
cd /opt/1panel/www/uliuli/app
docker compose build --no-cache && docker compose up -d --remove-orphans
```

> 首次或改动了 `package.json` 时用 `--no-cache`，平时更新代码用 `docker compose up --build -d` 即可。
