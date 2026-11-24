import type { RuntimeSiteConfig } from "@/lib/site-config";

export type {
  CreditInfo,
  CreditPerson,
  DetailItem,
  EditableSiteConfig,
  LiveLink,
  LiveSchedule,
  RuntimeSiteConfig,
  SongCategory,
} from "@/lib/site-config";

export interface SongItem {
  category: string;
  name: string;
  artist: string;
}

export interface HiddenSongItem {
  name: string;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type SiteConfig = DeepPartial<RuntimeSiteConfig>;

export interface AssetFile {
  name: string;
  path: string;
  time: number;
}

export type AdminTabId =
  | "hero"
  | "model"
  | "live"
  | "video"
  | "games"
  | "footer"
  | "notifications"
  | "system"
  | "videos"
  | "songs"
  | "mail"
  | "hidden"
  | "gacha"
  | "assets";
