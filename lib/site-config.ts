import type { ActiveTopicSummary } from "@/components/mail/mail-topic-types";

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

export interface LiveSchedule {
  morning: string;
  evening: string;
  off: string;
}

export interface LiveLink {
  title: string;
  url: string;
  icon: string;
  color: string;
}

export interface EditableSiteConfig {
  seo: {
    title: string;
    description: string;
    keywords: string[];
    siteName: string;
    playlistName: string;
    playlistDescription: string;
  };
  pwa: {
    manifestName: string;
    manifestShortName: string;
    manifestDescription: string;
    installTitle: string;
    installDescription: string;
    installIosDescription: string;
    installButton: string;
    iosStepOne: string;
    iosStepTwo: string;
    updateTitle: string;
    updateDescription: string;
    updateButton: string;
  };
  offline: {
    metadataTitle: string;
    metadataDescription: string;
    title: string;
    body: string;
    statusText: string;
    retryButton: string;
  };
  system: {
    configUpdatedToast: string;
  };
  hero: {
    code: string;
    title: string;
    subtitle: string;
    projectName: string;
    startBtn: string;
    scrollText: string;
    statusText: string;
    followersText: string;
    statsLoadingText: string;
    statsErrorText: string;
    statsOfflineText: string;
  };
  model: {
    titlePrefix: string;
    titleSuffix: string;
    syncRate: string;
    details: DetailItem[];
    credits: CreditInfo[];
  };
  live: {
    title: string;
    roomId: string;
    roomPrefix: string;
    liveNowText: string;
    offlineText: string;
    scheduleTitle: string;
    rulesTitle: string;
    gamePortalText: string;
    schedule: LiveSchedule;
    rules: string[];
    links: LiveLink[];
  };
  gallery: {
    titlePrefix: string;
    titleSuffix: string;
    scrollText: string;
    datePrefix: string;
  };
  song_ui: {
    titlePrefix: string;
    titleSuffix: string;
    serverText: string;
    serverOnline: string;
    serverOffline: string;
    pityText: string;
    searchPlaceholder: string;
    randomizeBtn: string;
    syncingBtn: string;
    copiedPrefix: string;
    copyCommandPrefix: string;
    emptyText: string;
    secretTag: string;
    copiedTag: string;
    categories: SongCategory[];
  };
  games: {
    lobbyTitlePrefix: string;
    lobbyTitleSuffix: string;
    lobbySubtitle: string;
    arenaTitle: string;
    arenaDesc: string;
    arenaStatus: string;
    dgpTitle: string;
    dgpDesc: string;
    dgpStatus: string;
    returnText: string;
  };
  videos: {
    hiddenTitle: string;
    unlockedTitle: string;
  };
  footer: {
    text: string;
  };
  notifications: {
    modelClicked: string;
    clickWarning: string;
    unlocked: string;
    alreadyUnlocked: string;
    goldenAlertTitle: string;
    goldenAlertSubtitle: string;
    goldenCongratsTitle: string;
    goldenBody: string;
    timestampPrefix: string;
    acknowledgeText: string;
  };
  errors: {
    title: string;
    message: string;
    retryText: string;
  };
  gacha: {
    pityThreshold: number;
    softPityStart: number;
    baseRate: number;
    maxRate: number;
  };
  /** 发信箱（主站访客侧）可编辑文案；后台 /mail 页面的文案仍硬编码。 */
  mail: {
    entryLabel: string;
    entryHint: string;
    entryHintDisabled: string;
    disabledBanner: string;
    senderTitle: string;
    senderTagline: string;
    statusOpen: string;
    statusPaused: string;
    pausedMessage: string;
    placeholderText: string;
    placeholderNickname: string;
    placeholderLink: string;
    successMessage: string;
  };
}

export type RuntimeSiteConfig = EditableSiteConfig & {
  api: {
    bilibili: string;
  };
  activeTopics: ActiveTopicSummary[];
  mailEnabled: boolean;
};

export const DEFAULT_SITE_CONFIG: EditableSiteConfig = {
  seo: {
    title: "丝瓜Uli | UliUli 主站",
    description:
      "丝瓜Uli（丝瓜 / 丝瓜ULI / UliUli）官方主站，集中展示直播、歌回、视频、点歌与互动内容。",
    keywords: [
      "丝瓜",
      "丝瓜Uli",
      "丝瓜ULI",
      "UliUli",
      "ULI",
      "VTuber",
      "虚拟主播",
      "歌回",
      "直播",
      "点歌",
      "主站",
    ],
    siteName: "丝瓜Uli | UliUli",
    playlistName: "丝瓜Uli 点歌单",
    playlistDescription:
      "丝瓜Uli（UliUli）的点歌歌单，包含古风、流行、英文、日文等多类目曲目。",
  },
  pwa: {
    manifestName: "项目：丝瓜ULI",
    manifestShortName: "UliUli",
    manifestDescription: "丝瓜ULI 的可安装网页应用，启动后直接进入专用 App 模式。",
    installTitle: "获取 UliUli App",
    installDescription: "丝滑沉浸体验，直接添加至桌面",
    installIosDescription: "在 Safari 点击分享并添加到主屏幕",
    installButton: "立即安装",
    iosStepOne: "1. 底部点击",
    iosStepTwo: "2. 选择",
    updateTitle: "发现新版本",
    updateDescription: "点击立即应用，无需重装",
    updateButton: "更新",
  },
  offline: {
    metadataTitle: "离线模式 · UliUli",
    metadataDescription: "暂时连不上网络，已在离线模式下显示。",
    title: "网络信号丢失",
    body: "App 暂时连不上 Uli 的服务器。\n稍后会自动恢复，或者你也可以手动重试。",
    statusText: "OFFLINE · CACHED SHELL",
    retryButton: "重新连接",
  },
  system: {
    configUpdatedToast: "站点数据已更新，内容已自动刷新",
  },
  hero: {
    code: "PROJECT CODE: SIGUAULI",
    title: "“大家好。初次入梦，幸会”",
    subtitle: "蝴蝶梦中歌唱，彼方沉眠",
    projectName: "“项目名称: 丝瓜ULI”",
    startBtn: "START_STAGE",
    scrollText: "SCROLL",
    statusText: "项目状态: 存活",
    followersText: "现有追随者:",
    statsLoadingText: "SYNCING...",
    statsErrorText: "ERROR",
    statsOfflineText: "OFFLINE",
  },
  model: {
    titlePrefix: "PROJECT",
    titleSuffix: "_DATA",
    syncRate: "SYNC_RATE: 100%",
    details: [
      { id: "MIC", img: "pic/mic_detail.jpg" },
      { id: "THIGH", img: "pic/optic_detail.jpg" },
      { id: "CHEST", img: "pic/armor_detail.jpg" },
    ],
    credits: [
      {
        label: "ILLUSTRATOR",
        val: [
          { name: "一沙今天不在家", link: "https://space.bilibili.com/34173126" },
          { name: "克蕾儿丝菲尔", link: "https://space.bilibili.com/3896410" },
        ],
      },
      {
        label: "MODELER",
        val: [
          { name: "一绪临", link: "https://space.bilibili.com/34327258" },
        ],
      },
      {
        label: "OWNER",
        val: [
          { name: "丝瓜ULI", link: "https://space.bilibili.com/3546779356235807" },
        ],
      },
    ],
  },
  live: {
    title: "直播状态",
    roomId: "1900561793",
    roomPrefix: "Room:",
    liveNowText: "LIVE NOW",
    offlineText: "OFFLINE",
    scheduleTitle: "直播时间",
    rulesTitle: "点歌规则",
    gamePortalText: "小游戏传送门",
    schedule: {
      morning: "早场: 10:00 - 13:00",
      evening: "晚场: 17:00 - 20:00",
      off: "周一休",
    },
    rules: ["优先点歌单内的歌曲"],
    links: [
      {
        title: "丝瓜歌锅里",
        url: "https://space.bilibili.com/3546779356235807/lists/5897743?type=season",
        icon: "Music",
        color: "pink",
      },
      {
        title: "丝瓜切片煮",
        url: "https://space.bilibili.com/3546779356235807/lists/5897583?type=season",
        icon: "Video",
        color: "cyan",
      },
      {
        title: "蝶梦聆境",
        url: "https://space.bilibili.com/3546779356235807/lists/5897534?type=season",
        icon: "Sparkles",
        color: "purple",
      },
    ],
  },
  gallery: {
    titlePrefix: "VISUAL",
    titleSuffix: "_ARCHIVE",
    scrollText: "SCROLL TO EXPLORE >>>",
    datePrefix: "DATE //",
  },
  song_ui: {
    titlePrefix: "SONG",
    titleSuffix: "_DATABASE",
    serverText: "SERVER:",
    serverOnline: "ONLINE",
    serverOffline: "OFFLINE",
    pityText: "PITY:",
    searchPlaceholder: "SEARCH...",
    randomizeBtn: "RANDOMIZE",
    syncingBtn: "SYNC...",
    copiedPrefix: "COPIED:",
    copyCommandPrefix: "点歌",
    emptyText: "/// DATA NOT FOUND ///",
    secretTag: "SECRET",
    copiedTag: "COPIED",
    categories: [
      { id: "all", label: "ALL" },
      { id: "gufeng", label: "ANCIENT" },
      { id: "liuxing", label: "POP" },
      { id: "yingyu", label: "ENGLISH" },
      { id: "riyu", label: "JAPANESE" },
    ],
  },
  games: {
    lobbyTitlePrefix: "SELECT",
    lobbyTitleSuffix: "MODULE",
    lobbySubtitle: "/// PLEASE SELECT A GAME TO INITIALIZE ///",
    arenaTitle: "名字大乱斗 V4",
    arenaDesc: "输入名字，生成属性，决出最强王者。",
    arenaStatus: "STATUS: ONLINE",
    dgpTitle: "欲望大奖赛 (DGP)",
    dgpDesc: "基于核心硬币与欲望的生存游戏模拟器。",
    dgpStatus: "STATUS: ONLINE",
    returnText: "RETURN TO LOBBY",
  },
  videos: {
    hiddenTitle: "🔓 HIDDEN_ARCHIVE_UNLOCKED",
    unlockedTitle: "📺 SYSTEM_VIDEO_FEED",
  },
  footer: {
    text: "© 2025 PROJECT BLUE MORPHO | 丝瓜Uli & 水人Morphling",
  },
  notifications: {
    modelClicked: "MODEL CLICKED",
    clickWarning: "WARNING: {count} CLICKS TO OVERRIDE",
    unlocked: "SYSTEM OVERRIDE: HIDDEN PROTOCOL ACTIVATED",
    alreadyUnlocked: "MODEL ARCHIVE ALREADY UNLOCKED",
    goldenAlertTitle: "SYSTEM ALERT",
    goldenAlertSubtitle: "HIDDEN EVENT TRIGGERED",
    goldenCongratsTitle: "✨ 恭喜出金！✨",
    goldenBody:
      "如果你是舰长，截图发到群里便可以免费领取一首隐藏歌单。如果不是，两个心动盲盒就能领取！",
    timestampPrefix: "TIMESTAMP:",
    acknowledgeText: "ACKNOWLEDGE",
  },
  errors: {
    title: "⚠ 页面遇到了一点小故障 (Page Crashed)",
    message: "请不用担心，这是一个程序错误，不是你的问题。",
    retryText: "刷新页面重试",
  },
  gacha: {
    pityThreshold: 8000,
    softPityStart: 5000,
    baseRate: 0.0001,
    maxRate: 0.6,
  },
  mail: {
    entryLabel: "发信箱",
    entryHint: "匿名投信给 Uli",
    entryHintDisabled: "发信箱暂时关闭",
    disabledBanner: "发信箱暂时关闭，稍后再来投递吧 ~",
    senderTitle: "MAIL_BOX",
    senderTagline: "把想对 Uli 说的话，匿名地投进这个信箱",
    statusOpen: "ONLINE",
    statusPaused: "OFFLINE",
    pausedMessage: "OFFLINE · 发信箱暂时关闭，稍后再来投递吧 ~",
    placeholderText: "在这里写下你想说的话…",
    placeholderNickname: "称呼（可选）",
    placeholderLink: "B站 / X / 外站链接（可选）",
    successMessage: "SIGNAL SENT · 信号已送达，Uli 会在直播时读到 ~",
  },
};

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isRecord(base)) return clone(base);
  if (!isRecord(override)) return clone(base);

  const result: AnyRecord = clone(base) as AnyRecord;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = result[key];
    if (Array.isArray(value)) {
      result[key] = clone(value);
    } else if (isRecord(baseValue) && isRecord(value)) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * 读取非空展示文案。历史数据库里可能存了缺失键或意外保存的空字符串 ""，
 * 此时统一回落到前端实际生效的默认文案，保证后台与前台所见一致。
 */
function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

/** 读取允许显式留空的字符串（例如制作人员外链）。 */
function normalizeOptionalString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeFiniteNumber(
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const parsed = Number(value);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (options.integer) next = Math.round(next);
  if (options.min !== undefined) next = Math.max(options.min, next);
  if (options.max !== undefined) next = Math.min(options.max, next);
  return next;
}

function normalizeKeywordArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...fallback];
}

function normalizeRulesArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeDetailsArray(value: unknown, fallback: DetailItem[]): DetailItem[] {
  if (!Array.isArray(value)) return clone(fallback);
  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      id: normalizeOptionalString(record.id, fallback[index]?.id ?? ""),
      img: normalizeOptionalString(record.img, fallback[index]?.img ?? ""),
    };
  });
}

function normalizeCreditsArray(value: unknown, fallback: CreditInfo[]): CreditInfo[] {
  if (!Array.isArray(value)) return clone(fallback);
  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallbackGroup = fallback[index];
    const rawPeople = Array.isArray(record.val) ? record.val : fallbackGroup?.val ?? [];
    const val: CreditPerson[] = rawPeople.map((person, pIndex) => {
      const pRec = isRecord(person) ? person : {};
      return {
        name: normalizeOptionalString(pRec.name, fallbackGroup?.val[pIndex]?.name ?? ""),
        link: normalizeOptionalString(pRec.link, fallbackGroup?.val[pIndex]?.link ?? ""),
      };
    });
    return {
      label: normalizeOptionalString(record.label, fallbackGroup?.label ?? ""),
      val,
    };
  });
}

function normalizeLiveLinks(value: unknown, fallback: LiveLink[]): LiveLink[] {
  if (!Array.isArray(value)) return clone(fallback);
  return value.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return {
      title: normalizeOptionalString(record.title, fallback[index]?.title ?? ""),
      url: normalizeOptionalString(record.url, fallback[index]?.url ?? ""),
      icon: normalizeNonEmptyString(record.icon, fallback[index]?.icon ?? "Music"),
      color: normalizeNonEmptyString(record.color, fallback[index]?.color ?? "cyan"),
    };
  });
}

function normalizeCategories(value: unknown, fallback: SongCategory[]): SongCategory[] {
  if (!Array.isArray(value)) return clone(fallback);
  const normalized = value
    .map((item, index) => {
      const record = isRecord(item) ? item : {};
      const id = normalizeOptionalString(record.id, fallback[index]?.id ?? "").trim();
      const label = normalizeOptionalString(record.label, fallback[index]?.label ?? "").trim();
      return id && label ? { id, label } : null;
    })
    .filter((item): item is SongCategory => Boolean(item));
  return normalized.length > 0 ? normalized : clone(fallback);
}

export function mergeSiteConfig(raw: unknown): EditableSiteConfig {
  return deepMerge(DEFAULT_SITE_CONFIG, raw);
}

/**
 * 归一化并清洗可编辑配置：
 * - 用 DEFAULT_SITE_CONFIG 填补缺失或历史空串字段；
 * - 剥离运行时派生字段（activeTopics、mailEnabled、api.bilibili）及已废弃死字段。
 */
export function sanitizeEditableSiteConfig(raw: unknown): EditableSiteConfig {
  const merged = mergeSiteConfig(raw);
  const d = DEFAULT_SITE_CONFIG;

  const baseRate = normalizeFiniteNumber(merged.gacha.baseRate, d.gacha.baseRate, {
    min: 0,
    max: 1,
  });

  return {
    seo: {
      title: normalizeNonEmptyString(merged.seo.title, d.seo.title),
      description: normalizeNonEmptyString(merged.seo.description, d.seo.description),
      keywords: normalizeKeywordArray(merged.seo.keywords, d.seo.keywords),
      siteName: normalizeNonEmptyString(merged.seo.siteName, d.seo.siteName),
      playlistName: normalizeNonEmptyString(merged.seo.playlistName, d.seo.playlistName),
      playlistDescription: normalizeNonEmptyString(
        merged.seo.playlistDescription,
        d.seo.playlistDescription,
      ),
    },
    pwa: {
      manifestName: normalizeNonEmptyString(merged.pwa.manifestName, d.pwa.manifestName),
      manifestShortName: normalizeNonEmptyString(
        merged.pwa.manifestShortName,
        d.pwa.manifestShortName,
      ),
      manifestDescription: normalizeNonEmptyString(
        merged.pwa.manifestDescription,
        d.pwa.manifestDescription,
      ),
      installTitle: normalizeNonEmptyString(merged.pwa.installTitle, d.pwa.installTitle),
      installDescription: normalizeNonEmptyString(
        merged.pwa.installDescription,
        d.pwa.installDescription,
      ),
      installIosDescription: normalizeNonEmptyString(
        merged.pwa.installIosDescription,
        d.pwa.installIosDescription,
      ),
      installButton: normalizeNonEmptyString(merged.pwa.installButton, d.pwa.installButton),
      iosStepOne: normalizeNonEmptyString(merged.pwa.iosStepOne, d.pwa.iosStepOne),
      iosStepTwo: normalizeNonEmptyString(merged.pwa.iosStepTwo, d.pwa.iosStepTwo),
      updateTitle: normalizeNonEmptyString(merged.pwa.updateTitle, d.pwa.updateTitle),
      updateDescription: normalizeNonEmptyString(
        merged.pwa.updateDescription,
        d.pwa.updateDescription,
      ),
      updateButton: normalizeNonEmptyString(merged.pwa.updateButton, d.pwa.updateButton),
    },
    offline: {
      metadataTitle: normalizeNonEmptyString(
        merged.offline.metadataTitle,
        d.offline.metadataTitle,
      ),
      metadataDescription: normalizeNonEmptyString(
        merged.offline.metadataDescription,
        d.offline.metadataDescription,
      ),
      title: normalizeNonEmptyString(merged.offline.title, d.offline.title),
      body: normalizeNonEmptyString(merged.offline.body, d.offline.body),
      statusText: normalizeNonEmptyString(merged.offline.statusText, d.offline.statusText),
      retryButton: normalizeNonEmptyString(merged.offline.retryButton, d.offline.retryButton),
    },
    system: {
      configUpdatedToast: normalizeNonEmptyString(
        merged.system.configUpdatedToast,
        d.system.configUpdatedToast,
      ),
    },
    hero: {
      code: normalizeNonEmptyString(merged.hero.code, d.hero.code),
      title: normalizeNonEmptyString(merged.hero.title, d.hero.title),
      subtitle: normalizeNonEmptyString(merged.hero.subtitle, d.hero.subtitle),
      projectName: normalizeNonEmptyString(merged.hero.projectName, d.hero.projectName),
      startBtn: normalizeNonEmptyString(merged.hero.startBtn, d.hero.startBtn),
      scrollText: normalizeNonEmptyString(merged.hero.scrollText, d.hero.scrollText),
      statusText: normalizeNonEmptyString(merged.hero.statusText, d.hero.statusText),
      followersText: normalizeNonEmptyString(merged.hero.followersText, d.hero.followersText),
      statsLoadingText: normalizeNonEmptyString(
        merged.hero.statsLoadingText,
        d.hero.statsLoadingText,
      ),
      statsErrorText: normalizeNonEmptyString(merged.hero.statsErrorText, d.hero.statsErrorText),
      statsOfflineText: normalizeNonEmptyString(
        merged.hero.statsOfflineText,
        d.hero.statsOfflineText,
      ),
    },
    model: {
      titlePrefix: normalizeNonEmptyString(merged.model.titlePrefix, d.model.titlePrefix),
      titleSuffix: normalizeNonEmptyString(merged.model.titleSuffix, d.model.titleSuffix),
      syncRate: normalizeNonEmptyString(merged.model.syncRate, d.model.syncRate),
      details: normalizeDetailsArray(merged.model.details, d.model.details),
      credits: normalizeCreditsArray(merged.model.credits, d.model.credits),
    },
    live: {
      title: normalizeNonEmptyString(merged.live.title, d.live.title),
      roomId: normalizeNonEmptyString(merged.live.roomId, d.live.roomId),
      roomPrefix: normalizeNonEmptyString(merged.live.roomPrefix, d.live.roomPrefix),
      liveNowText: normalizeNonEmptyString(merged.live.liveNowText, d.live.liveNowText),
      offlineText: normalizeNonEmptyString(merged.live.offlineText, d.live.offlineText),
      scheduleTitle: normalizeNonEmptyString(merged.live.scheduleTitle, d.live.scheduleTitle),
      rulesTitle: normalizeNonEmptyString(merged.live.rulesTitle, d.live.rulesTitle),
      gamePortalText: normalizeNonEmptyString(merged.live.gamePortalText, d.live.gamePortalText),
      schedule: {
        morning: normalizeNonEmptyString(merged.live.schedule.morning, d.live.schedule.morning),
        evening: normalizeNonEmptyString(merged.live.schedule.evening, d.live.schedule.evening),
        off: normalizeNonEmptyString(merged.live.schedule.off, d.live.schedule.off),
      },
      rules: normalizeRulesArray(merged.live.rules, d.live.rules),
      links: normalizeLiveLinks(merged.live.links, d.live.links),
    },
    gallery: {
      titlePrefix: normalizeNonEmptyString(merged.gallery.titlePrefix, d.gallery.titlePrefix),
      titleSuffix: normalizeNonEmptyString(merged.gallery.titleSuffix, d.gallery.titleSuffix),
      scrollText: normalizeNonEmptyString(merged.gallery.scrollText, d.gallery.scrollText),
      datePrefix: normalizeNonEmptyString(merged.gallery.datePrefix, d.gallery.datePrefix),
    },
    song_ui: {
      titlePrefix: normalizeNonEmptyString(merged.song_ui.titlePrefix, d.song_ui.titlePrefix),
      titleSuffix: normalizeNonEmptyString(merged.song_ui.titleSuffix, d.song_ui.titleSuffix),
      serverText: normalizeNonEmptyString(merged.song_ui.serverText, d.song_ui.serverText),
      serverOnline: normalizeNonEmptyString(merged.song_ui.serverOnline, d.song_ui.serverOnline),
      serverOffline: normalizeNonEmptyString(
        merged.song_ui.serverOffline,
        d.song_ui.serverOffline,
      ),
      pityText: normalizeNonEmptyString(merged.song_ui.pityText, d.song_ui.pityText),
      searchPlaceholder: normalizeNonEmptyString(
        merged.song_ui.searchPlaceholder,
        d.song_ui.searchPlaceholder,
      ),
      randomizeBtn: normalizeNonEmptyString(merged.song_ui.randomizeBtn, d.song_ui.randomizeBtn),
      syncingBtn: normalizeNonEmptyString(merged.song_ui.syncingBtn, d.song_ui.syncingBtn),
      copiedPrefix: normalizeNonEmptyString(merged.song_ui.copiedPrefix, d.song_ui.copiedPrefix),
      copyCommandPrefix: normalizeNonEmptyString(
        merged.song_ui.copyCommandPrefix,
        d.song_ui.copyCommandPrefix,
      ),
      emptyText: normalizeNonEmptyString(merged.song_ui.emptyText, d.song_ui.emptyText),
      secretTag: normalizeNonEmptyString(merged.song_ui.secretTag, d.song_ui.secretTag),
      copiedTag: normalizeNonEmptyString(merged.song_ui.copiedTag, d.song_ui.copiedTag),
      categories: normalizeCategories(merged.song_ui.categories, d.song_ui.categories),
    },
    games: {
      lobbyTitlePrefix: normalizeNonEmptyString(
        merged.games.lobbyTitlePrefix,
        d.games.lobbyTitlePrefix,
      ),
      lobbyTitleSuffix: normalizeNonEmptyString(
        merged.games.lobbyTitleSuffix,
        d.games.lobbyTitleSuffix,
      ),
      lobbySubtitle: normalizeNonEmptyString(merged.games.lobbySubtitle, d.games.lobbySubtitle),
      arenaTitle: normalizeNonEmptyString(merged.games.arenaTitle, d.games.arenaTitle),
      arenaDesc: normalizeNonEmptyString(merged.games.arenaDesc, d.games.arenaDesc),
      arenaStatus: normalizeNonEmptyString(merged.games.arenaStatus, d.games.arenaStatus),
      dgpTitle: normalizeNonEmptyString(merged.games.dgpTitle, d.games.dgpTitle),
      dgpDesc: normalizeNonEmptyString(merged.games.dgpDesc, d.games.dgpDesc),
      dgpStatus: normalizeNonEmptyString(merged.games.dgpStatus, d.games.dgpStatus),
      returnText: normalizeNonEmptyString(merged.games.returnText, d.games.returnText),
    },
    videos: {
      hiddenTitle: normalizeNonEmptyString(merged.videos.hiddenTitle, d.videos.hiddenTitle),
      unlockedTitle: normalizeNonEmptyString(merged.videos.unlockedTitle, d.videos.unlockedTitle),
    },
    footer: {
      text: normalizeNonEmptyString(merged.footer.text, d.footer.text),
    },
    notifications: {
      modelClicked: normalizeNonEmptyString(
        merged.notifications.modelClicked,
        d.notifications.modelClicked,
      ),
      clickWarning: normalizeNonEmptyString(
        merged.notifications.clickWarning,
        d.notifications.clickWarning,
      ),
      unlocked: normalizeNonEmptyString(merged.notifications.unlocked, d.notifications.unlocked),
      alreadyUnlocked: normalizeNonEmptyString(
        merged.notifications.alreadyUnlocked,
        d.notifications.alreadyUnlocked,
      ),
      goldenAlertTitle: normalizeNonEmptyString(
        merged.notifications.goldenAlertTitle,
        d.notifications.goldenAlertTitle,
      ),
      goldenAlertSubtitle: normalizeNonEmptyString(
        merged.notifications.goldenAlertSubtitle,
        d.notifications.goldenAlertSubtitle,
      ),
      goldenCongratsTitle: normalizeNonEmptyString(
        merged.notifications.goldenCongratsTitle,
        d.notifications.goldenCongratsTitle,
      ),
      goldenBody: normalizeNonEmptyString(
        merged.notifications.goldenBody,
        d.notifications.goldenBody,
      ),
      timestampPrefix: normalizeNonEmptyString(
        merged.notifications.timestampPrefix,
        d.notifications.timestampPrefix,
      ),
      acknowledgeText: normalizeNonEmptyString(
        merged.notifications.acknowledgeText,
        d.notifications.acknowledgeText,
      ),
    },
    errors: {
      title: normalizeNonEmptyString(merged.errors.title, d.errors.title),
      message: normalizeNonEmptyString(merged.errors.message, d.errors.message),
      retryText: normalizeNonEmptyString(merged.errors.retryText, d.errors.retryText),
    },
    gacha: {
      pityThreshold: normalizeFiniteNumber(merged.gacha.pityThreshold, d.gacha.pityThreshold, {
        min: 1,
        integer: true,
      }),
      softPityStart: normalizeFiniteNumber(merged.gacha.softPityStart, d.gacha.softPityStart, {
        min: 0,
        integer: true,
      }),
      baseRate,
      maxRate: normalizeFiniteNumber(merged.gacha.maxRate, d.gacha.maxRate, {
        min: baseRate,
        max: 1,
      }),
    },
    mail: {
      entryLabel: normalizeNonEmptyString(merged.mail.entryLabel, d.mail.entryLabel),
      entryHint: normalizeNonEmptyString(merged.mail.entryHint, d.mail.entryHint),
      entryHintDisabled: normalizeNonEmptyString(
        merged.mail.entryHintDisabled,
        d.mail.entryHintDisabled,
      ),
      disabledBanner: normalizeNonEmptyString(merged.mail.disabledBanner, d.mail.disabledBanner),
      senderTitle: normalizeNonEmptyString(merged.mail.senderTitle, d.mail.senderTitle),
      senderTagline: normalizeNonEmptyString(merged.mail.senderTagline, d.mail.senderTagline),
      statusOpen: normalizeNonEmptyString(merged.mail.statusOpen, d.mail.statusOpen),
      statusPaused: normalizeNonEmptyString(merged.mail.statusPaused, d.mail.statusPaused),
      pausedMessage: normalizeNonEmptyString(merged.mail.pausedMessage, d.mail.pausedMessage),
      placeholderText: normalizeNonEmptyString(
        merged.mail.placeholderText,
        d.mail.placeholderText,
      ),
      placeholderNickname: normalizeNonEmptyString(
        merged.mail.placeholderNickname,
        d.mail.placeholderNickname,
      ),
      placeholderLink: normalizeNonEmptyString(
        merged.mail.placeholderLink,
        d.mail.placeholderLink,
      ),
      successMessage: normalizeNonEmptyString(merged.mail.successMessage, d.mail.successMessage),
    },
  };
}

export function withRuntimeSiteConfig(
  editableConfig: EditableSiteConfig,
  runtime: { activeTopics?: ActiveTopicSummary[]; mailEnabled?: boolean } = {},
): RuntimeSiteConfig {
  return {
    ...editableConfig,
    api: { bilibili: "/api/bilibili" },
    activeTopics: runtime.activeTopics ?? [],
    mailEnabled: runtime.mailEnabled ?? true,
  };
}
