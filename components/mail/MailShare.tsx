"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  renderWindChimeQr,
  renderWindChimePoster,
  downloadWindChimeCanvas,
  type WindChimePosterOptions,
  type WindChimeQrPosterConfig,
} from "@windchime/embed/media";
import { mailQrTheme as t, mailPosterEditorTheme as e } from "./mail-theme";

type Props = {
  url: string;
  title: string;
  subtitle: string;
  downloadName: string;
  foreground: string;
  background: string;
  value: WindChimeQrPosterConfig;
  onChange: (value: WindChimeQrPosterConfig) => void;
  posterOptions: Omit<WindChimePosterOptions, "url"> & { enabled?: boolean };
};
export function MailShare({
  url,
  title,
  subtitle,
  downloadName,
  foreground,
  background,
  value,
  onChange,
  posterOptions,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderKey = JSON.stringify([url, foreground, background]);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const ready = renderedKey === renderKey;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement("canvas");
    void renderWindChimeQr(canvas, { url, size: 260, foreground, background })
      .then(() => {
        if (cancelled || !ref.current) return;
        ref.current.width = canvas.width;
        ref.current.height = canvas.height;
        ref.current.getContext("2d")?.drawImage(canvas, 0, 0);
        setRenderedKey(renderKey);
        setError(null);
      })
      .catch((error) => {
        if (!cancelled)
          setError(error instanceof Error ? error.message : "二维码生成失败");
      });
    return () => {
      cancelled = true;
    };
  }, [url, foreground, background, renderKey]);
  const download = async (poster: boolean) => {
    if (!ready || !ref.current) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = poster
        ? await renderWindChimePoster(ref.current, { url, ...posterOptions })
        : ref.current;
      await downloadWindChimeCanvas(
        canvas,
        `${downloadName}${poster ? "-poster" : ""}.png`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "下载失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className={t.root}>
        <section className={t.panel}>
          <h2 className={t.title}>{title}</h2>
          <p className={t.subtitle}>{subtitle}</p>
          <div className={`${t.canvasWrap} max-w-full`}>
            <canvas
              ref={ref}
              aria-label={title}
              style={{ width: 260, maxWidth: "100%", height: "auto" }}
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-center text-sm text-rose-400">
              {error}
            </p>
          )}
          <div className={t.toolbar}>
            <button
              type="button"
              disabled={!ready || busy}
              className={t.button}
              onClick={() => void download(false)}
            >
              下载二维码
            </button>
            <button
              type="button"
              disabled={!ready || busy}
              className={t.button}
              onClick={() => void download(true)}
            >
              {busy ? "生成中…" : "下载海报"}
            </button>
          </div>
        </section>
      </div>
      <section className={e.panel}>
        <h2 className={e.title}>海报自定义</h2>
        <div className={e.fieldList}>
          {(["heading", "body", "footer", "avatarSrc"] as const).map(
            (field, i) => (
              <label key={field} className={e.label}>
                {
                  [
                    "主标题",
                    "副标题（说明文字）",
                    "落款（留空则显示网址）",
                    "头像 URL",
                  ][i]
                }
                {field === "body" ? (
                  <textarea
                    maxLength={80}
                    placeholder="扫码后匿名留言，Uli 直播时会念出来 ~"
                    value={value[field]}
                    onChange={(event) =>
                      onChange({ ...value, [field]: event.target.value })
                    }
                    className={e.textarea}
                  />
                ) : (
                  <input
                    maxLength={
                      field === "heading"
                        ? 24
                        : field === "footer"
                          ? 40
                          : undefined
                    }
                    placeholder={
                      field === "heading"
                        ? "给 Uli 匿名投一封信"
                        : field === "footer"
                          ? "—— UliUli"
                          : "https://…"
                    }
                    value={value[field]}
                    onChange={(event) =>
                      onChange({ ...value, [field]: event.target.value })
                    }
                    className={e.input}
                  />
                )}
              </label>
            ),
          )}
          {value.avatarSrc && (
            <div className={e.avatarPreview}>
              <Image
                src={value.avatarSrc}
                alt="头像预览"
                referrerPolicy="no-referrer"
                width={48}
                height={48}
                unoptimized
                className={e.avatarImg}
              />
              <span className={e.avatarCaption}>{value.avatarSrc}</span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
