/* UliUli PWA Service Worker
 * Strategy:
 *  - Navigations & Next.js code (_next/*, JS/CSS/JSON): network-first with cache fallback.
 *    保证主站更新后，PWA 用户上线即可拿到新版本。
 *  - True static assets (images, fonts, og images): cache-first（这些资源带 hash 或不变）
 *  - /api/*: 永不缓存，永远走网络。配置 / songs / mail 都是动态数据。
 *  - 离线导航回退到 /offline。
 *  - postMessage("SKIP_WAITING") 由前端的更新提示触发，立即激活新版本。
 */

const VERSION = "v4";
const SHELL_CACHE = `uliuli-shell-${VERSION}`;
const RUNTIME_CACHE = `uliuli-runtime-${VERSION}`;
const STATIC_CACHE = `uliuli-static-${VERSION}`;

const APP_SHELL = [
  "/",
  "/app",
  "/offline",
  "/manifest.webmanifest",
  "/app.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 用 Promise.allSettled 防止单个 URL 失败导致整个 SW install 失败
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const allowed = new Set([SHELL_CACHE, RUNTIME_CACHE, STATIC_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !allowed.has(key)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isStaticAsset(url) {
  // 仅把 _next/static 下的内容（含 hash）和真静态文件视为可长期缓存
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".ttf")
  ) {
    return true;
  }
  return false;
}

function isCodeAsset(url) {
  // _next 里非 static 的 RSC payload / chunks / data，必须 network-first
  if (url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) return true;
  return false;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}

async function navigationStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const appShell = await cache.match("/app");
    if (appShell) return appShell;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response("offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // /api/* 永不缓存，让后端始终是真相源
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
    return;
  }

  if (isCodeAsset(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});
