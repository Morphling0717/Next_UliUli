"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon, RefreshCw, X as CloseIcon } from "lucide-react";
import type { WindChimeMessageAsset } from "@windchime/embed/core";
import { mailLiveClient } from "@/lib/windchime-client";

type Props = {
  topicId: string;
  assets?: WindChimeMessageAsset[];
};

type LoadedAsset = {
  id: string;
  url: string | null;
  error: boolean;
};

/**
 * 后台私密附图缩略图 + 点击放大灯箱。
 * 通过同源管理员 Cookie 请求 `/api/mail/live/control/assets/:id?topicId=...` 获取
 * Blob 并转 ObjectURL，组件卸载或资产列表变更时自动 revoke，避免内存泄漏。
 */
export function MailMessageImages({ topicId, assets }: Props) {
  const assetsKey = assets?.map((a) => a.id).join(",") ?? "";
  const [retryCount, setRetryCount] = useState(0);
  const fetchKey = assetsKey ? `${topicId}:${assetsKey}:${retryCount}` : "";
  const [state, setState] = useState<{ key: string; items: LoadedAsset[] }>({
    key: "",
    items: [],
  });
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchKey || !assetsKey) return;
    const ids = assetsKey.split(",");
    const controller = new AbortController();
    const createdUrls: string[] = [];

    void Promise.allSettled(
      ids.map(async (id) => {
        const blob = await mailLiveClient.asset(topicId, id, controller.signal);
        if (controller.signal.aborted) return null;
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        return { id, url };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next: LoadedAsset[] = results.map((result, idx) => {
        const id = ids[idx]!;
        if (result.status === "fulfilled" && result.value) {
          return { id, url: result.value.url, error: false };
        }
        return { id, url: null, error: true };
      });
      setState({ key: fetchKey, items: next });
    });

    return () => {
      controller.abort();
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [fetchKey, topicId, assetsKey]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setLightboxUrl(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [lightboxUrl]);

  if (!assets || assets.length === 0) return null;

  const loading = state.key !== fetchKey;
  const items = loading ? [] : state.items;
  const hasError = items.some((item) => item.error);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-cyan-300/80">
        <span className="inline-flex items-center gap-1">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
          附图 ({assets.length})
        </span>
        {hasError && (
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="inline-flex items-center gap-1 rounded border border-rose-400/50 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200 transition hover:bg-rose-500/20"
          >
            <RefreshCw className="h-3 w-3" />
            重试加载
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {assets.map((asset, index) => {
          const loaded = items.find((i) => i.id === asset.id);
          if (loading) {
            return (
              <div
                key={asset.id}
                className="flex h-28 items-center justify-center rounded-lg border border-cyan-500/20 bg-black/50 font-mono text-[11px] text-gray-500"
              >
                加载中…
              </div>
            );
          }
          if (!loaded || loaded.error || !loaded.url) {
            return (
              <div
                key={asset.id}
                className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2 text-center font-mono text-[11px] text-rose-300/80"
              >
                <span>图片 {index + 1} 加载失败</span>
              </div>
            );
          }
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => setLightboxUrl(loaded.url)}
              className="group relative overflow-hidden rounded-lg border border-cyan-500/30 bg-black/60 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              title="点击查看大图"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={loaded.url}
                alt={`来信附图 ${index + 1}`}
                className="h-28 w-full object-cover transition duration-200 group-hover:scale-105"
              />
            </button>
          );
        })}
      </div>

      {lightboxUrl &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="附图大图预览"
            className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              aria-label="关闭预览"
              className="fixed right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/60 bg-black/80 text-cyan-200 transition hover:bg-cyan-400 hover:text-black"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="附图放大预览"
              className="max-h-[90vh] max-w-[92vw] rounded-xl border border-cyan-400/40 object-contain shadow-[0_0_40px_rgba(45,226,230,0.2)]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
