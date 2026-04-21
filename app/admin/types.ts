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
  /** 发信箱（主站访客侧）可编辑文案；后台 /mail 页面的文案仍硬编码。 */
  mail?: {
    // —— 左下 SpeedDial 入口按钮
    entryLabel?: string;         // 子按钮标题，默认 "发信箱"
    entryHint?: string;          // 子按钮 tooltip（开启态），默认 "匿名投信给 Uli"
    entryHintDisabled?: string;  // 子按钮 tooltip（关闭态），默认 "发信箱暂时关闭"
    // —— 弹窗顶部禁用横幅（isDisabled 时才显示）
    disabledBanner?: string;     // 默认 "发信箱暂时关闭，稍后再来投递吧 ~"
    // —— WindChimeSender 表单
    senderTitle?: string;        // 默认 "MAIL_BOX"
    senderTagline?: string;      // 默认 "把想对 Uli 说的话，匿名地投进这个信箱"
    statusOpen?: string;         // 右上状态徽章（开启），默认 "ONLINE"
    statusPaused?: string;       // 右上状态徽章（关闭），默认 "OFFLINE"
    pausedMessage?: string;      // 关闭态下表单内的说明，默认 "OFFLINE · 发信箱暂时关闭，稍后再来投递吧 ~"
    placeholderText?: string;    // textarea 占位，默认 "在这里写下你想说的话…"
    placeholderNickname?: string; // 称呼输入占位，默认 "称呼（可选）"
    placeholderLink?: string;    // 链接输入占位，默认 "B站 / X / 外站链接（可选）"
    successMessage?: string;     // 发送成功横幅，默认 "SIGNAL SENT · 信号已送达，Uli 会在直播时读到 ~"
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
  | "mail"
  | "hidden"
  | "gacha"
  | "assets";
