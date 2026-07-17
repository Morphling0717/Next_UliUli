import { getStageFighterImage, getStageFinisherImage } from "./battleStageModel";
import { SUMMON_CARD_ART_SLOTS } from "./summonCardArt";
import { TOKUSATSU_ASSET_PATHS } from "./tokusatsuArt";
import type { Fighter } from "./types";

const preloadRequests = new Map<string, Promise<boolean>>();

export type StageAssetManifest = {
  immediate: string[];
  deferred: string[];
};

export function collectStageAssetManifest(fighters: readonly Fighter[]): StageAssetManifest {
  const immediate = new Set<string>();
  fighters.forEach((fighter) => {
    const fighterImage = getStageFighterImage(fighter);
    const finisherImage = getStageFinisherImage(fighter);
    if (fighterImage) immediate.add(fighterImage);
    if (finisherImage) immediate.add(finisherImage);
  });

  const deferred = new Set<string>();
  if (fighters.some((fighter) => fighter.isGacha || fighter.isAdvancedSummon)) {
    SUMMON_CARD_ART_SLOTS.forEach((art) => {
      [art.imagePath, art.cutinPath, art.avatarPath].forEach((source) => {
        if (source && !immediate.has(source)) deferred.add(source);
      });
    });
  }
  if (fighters.some((fighter) => fighter.isTokusatsu)) {
    TOKUSATSU_ASSET_PATHS.forEach((source) => {
      if (!immediate.has(source)) deferred.add(source);
    });
  }

  return { immediate: [...immediate], deferred: [...deferred] };
}

function preloadImage(source: string): Promise<boolean> {
  const existing = preloadRequests.get(source);
  if (existing) return existing;
  if (typeof window === "undefined") return Promise.resolve(false);

  const request = new Promise<boolean>((resolve) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => {
      void image.decode?.().catch(() => undefined).finally(() => resolve(true));
    };
    image.onerror = () => resolve(false);
    image.src = source;
  });
  preloadRequests.set(source, request);
  return request;
}

export function preloadStageAssetManifest(manifest: StageAssetManifest): () => void {
  if (typeof window === "undefined") return () => {};
  const idleApi = window as unknown as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  manifest.immediate.forEach((source) => void preloadImage(source));

  let cancelled = false;
  let timeoutHandle: number | null = null;
  let idleHandle: number | null = null;
  let cursor = 0;
  const loadBatch = () => {
    if (cancelled) return;
    manifest.deferred.slice(cursor, cursor + 3).forEach((source) => void preloadImage(source));
    cursor += 3;
    if (cursor < manifest.deferred.length) scheduleBatch();
  };
  const scheduleBatch = () => {
    if (cancelled) return;
    if (typeof idleApi.requestIdleCallback === "function") {
      idleHandle = idleApi.requestIdleCallback(loadBatch, { timeout: 900 });
    } else {
      timeoutHandle = window.setTimeout(loadBatch, 80);
    }
  };
  scheduleBatch();

  return () => {
    cancelled = true;
    if (idleHandle !== null) idleApi.cancelIdleCallback?.(idleHandle);
    if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
  };
}

export function preloadStageAssets(fighters: readonly Fighter[]): () => void {
  return preloadStageAssetManifest(collectStageAssetManifest(fighters));
}

export function getStageAssetPreloadCacheSize(): number {
  return preloadRequests.size;
}
