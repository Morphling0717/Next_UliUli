import type { Metadata, Viewport } from "next";
import { OfflineRetryButton } from "@/components/offline-retry-button";
import { loadEditableSiteConfig } from "@/lib/site-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadEditableSiteConfig();
  return {
    title: config.offline.metadataTitle,
    description: config.offline.metadataDescription,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050508",
};

export default async function OfflinePage() {
  const config = await loadEditableSiteConfig();
  const lines = config.offline.body.split(/\r?\n/);

  return (
    <main
      className="relative min-h-[100dvh] bg-black text-white flex items-center justify-center px-6"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
      }}
    >
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] right-[10%] w-[60%] h-[40%] bg-fuchsia-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 text-2xl">
          ◌
        </div>
        <h1 className="text-base font-semibold tracking-wide text-white">
          {config.offline.title}
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          {lines.map((line, index) => (
            <span key={`${line}-${index}`}>
              {line}
              {index < lines.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
        <OfflineRetryButton text={config.offline.retryButton} />
        <p className="mt-4 text-[10px] font-mono tracking-[0.3em] text-gray-600">
          {config.offline.statusText}
        </p>
      </div>
    </main>
  );
}
