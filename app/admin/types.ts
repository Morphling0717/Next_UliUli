export interface DetailItem {
  id: string;
  img: string;
}

export interface CreditPerson {
  name: string;
  link: string;
}

export interface CreditInfo {
  label: string;
  val: CreditPerson[];
}

export interface SongCategory {
  id: string;
  label: string;
}

export interface SongItem {
  category: string;
  name: string;
  artist: string;
}

export interface HiddenSongItem {
  name: string;
}

export interface LiveSchedule {
  morning?: string;
  evening?: string;
  off?: string;
}

export interface LiveLink {
  title: string;
  url: string;
  icon: string;
  color: string;
}

export interface SiteConfig {
  hero?: {
    code?: string;
    title?: string;
    subtitle?: string;
    projectName?: string;
    startBtn?: string;
    scrollText?: string;
    statusText?: string;
    followersText?: string;
  };
  model?: {
    titlePrefix?: string;
    titleSuffix?: string;
    syncRate?: string;
    details?: DetailItem[];
    credits?: CreditInfo[];
  };
  live?: {
    title?: string;
    roomId?: string;
    roomPrefix?: string;
    liveNowText?: string;
    offlineText?: string;
    scheduleTitle?: string;
    rulesTitle?: string;
    gamePortalText?: string;
    schedule?: LiveSchedule;
    rules?: string[];
    links?: LiveLink[];
  };
  gallery?: {
    titlePrefix?: string;
    titleSuffix?: string;
    scrollText?: string;
    datePrefix?: string;
  };
  api?: {
    bilibili?: string;
  };
  song_ui?: {
    titlePrefix?: string;
    titleSuffix?: string;
    serverText?: string;
    serverOnline?: string;
    serverOffline?: string;
    pityText?: string;
    searchPlaceholder?: string;
    randomizeBtn?: string;
    syncingBtn?: string;
    copiedPrefix?: string;
    emptyText?: string;
    secretTag?: string;
    copiedTag?: string;
    categories?: SongCategory[];
  };
  footer?: {
    text?: string;
  };
  notifications?: {
    modelClicked?: string;
    clickWarning?: string;
    unlocked?: string;
    alreadyUnlocked?: string;
    systemInitializing?: string;
    goldenAlertTitle?: string;
    goldenAlertSubtitle?: string;
    goldenCongratsTitle?: string;
    goldenBody?: string;
    timestampPrefix?: string;
    acknowledgeText?: string;
  };
  errors?: {
    title?: string;
    message?: string;
    retryText?: string;
  };
  games?: {
    lobbyTitlePrefix?: string;
    lobbyTitleSuffix?: string;
    lobbySubtitle?: string;
    arenaTitle?: string;
    arenaDesc?: string;
    arenaStatus?: string;
    dgpTitle?: string;
    dgpDesc?: string;
    dgpStatus?: string;
    returnText?: string;
    migratingTitle?: string;
    migratingDesc?: string;
  };
  videos?: {
    hiddenTitle?: string;
    unlockedTitle?: string;
  };
  gacha?: {
    pityThreshold?: number;
    softPityStart?: number;
    baseRate?: number;
    maxRate?: number;
  };
}

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
  | "videos"
  | "songs"
  | "hidden"
  | "gacha"
  | "assets";
