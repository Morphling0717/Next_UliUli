import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 锁定项目根目录，避免 Turbopack 在带非 ASCII 字符的路径（例如 "网页开发"）下
// 错误地把父目录当作 workspace 根，从而导致 `tailwindcss` 等依赖解析失败。
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Public files do not receive content hashes from Next.js. Give every build a
// fresh asset version so changed images cannot be hidden by a browser or PWA cache.
const assetVersion = process.env.NEXT_PUBLIC_ASSET_VERSION?.trim() || Date.now().toString(36);
process.env.NEXT_PUBLIC_ASSET_VERSION = assetVersion;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ASSET_VERSION: assetVersion,
  },
  experimental: {
    turbopackPluginRuntimeStrategy: "workerThreads",
  },
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
