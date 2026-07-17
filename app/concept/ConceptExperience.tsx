"use client";

/* eslint-disable @next/next/no-img-element -- Bilibili archive thumbnails are remote prototype content. */

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  Clock3,
  Dice5,
  Gamepad2,
  Mail,
  Menu,
  Music2,
  Play,
  Radio,
  Search,
  Shuffle,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./concept.module.css";

type Song = {
  name: string;
  artist: string;
  category: string;
  isHidden?: boolean;
};

type SongCategoryOption = {
  id: string;
  label: string;
};

type ContentLink = {
  title: string;
  url: string;
  icon: string;
  color: string;
};

type ModelDetail = {
  id: string;
  img: string;
};

type CreditGroup = {
  label: string;
  val: Array<{
    name: string;
    link: string;
  }>;
};

type LiveSchedule = {
  morning?: string;
  evening?: string;
  off?: string;
};

type ConceptExperienceProps = {
  initialSongs: Song[];
  initialHiddenSongs: Song[];
  initialCategories: SongCategoryOption[];
  contentLinks: ContentLink[];
  liveSchedule: LiveSchedule;
  requestRules: string[];
  modelDetails: ModelDetail[];
  credits: CreditGroup[];
};

type LiveState = {
  checked: boolean;
  isLive: boolean;
  fans: number | null;
  liveUrl: string;
};

type BilibiliVideo = {
  title: string;
  pic: string;
  url: string;
  length: string;
  play: string | number;
  date: string;
};

type BilibiliPayload = {
  success?: boolean;
  user?: {
    fans?: number;
    is_live?: boolean;
    live_url?: string;
  };
  videos?: BilibiliVideo[];
};

const LIVE_FALLBACK_URL = "https://live.bilibili.com/1900561793";
const EMPTY_SONG: Song = {
  name: "歌单正在载入",
  artist: "SONG_DATABASE",
  category: "all",
};

const contentCardMeta: Record<string, { copy: string; className: string; icon: typeof Music2 }> = {
  丝瓜歌锅里: {
    copy: "Uli 已经唱过并发布的直播歌切与翻唱合集。",
    className: styles.programSong,
    icon: Music2,
  },
  丝瓜切片煮: {
    copy: "从直播里留下来的切片与高浓度现场。",
    className: styles.programTea,
    icon: AudioLines,
  },
  蝶梦聆境: {
    copy: "听书入眠计划与晚间电台内容合集。",
    className: styles.programGame,
    icon: Radio,
  },
};

const siteModules = [
  {
    id: "mail",
    eyebrow: "互动工具 01 / 发信箱",
    title: "匿名投信给 Uli。",
    copy: "常规信箱与活动主题都由主站管理，开放状态以站内信号为准。",
    action: "去 App Hub",
    icon: Mail,
    className: styles.playMail,
  },
  {
    id: "gacha",
    eyebrow: "互动工具 02 / 扭蛋机",
    title: "领硬币、抽表情、收藏与打包。",
    copy: "每日登录领取硬币；抽取结果、库存、赠送码和兑换都由服务器保存。",
    action: "去 App Hub",
    icon: Dice5,
    className: styles.playGacha,
  },
  {
    id: "arena",
    eyebrow: "小游戏 01 / 名字大乱斗",
    title: "输入名字，生成属性，决出最强王者。",
    copy: "这是一套独立的站内文字战斗系统，不是直播内容分类。",
    action: "去 App Hub",
    icon: Gamepad2,
    className: styles.playArena,
  },
  {
    id: "dgp",
    eyebrow: "小游戏 02 / DGP 模拟器",
    title: "核心硬币与欲望的生存游戏模拟器。",
    copy: "自动演算一场欲望大奖赛，并保留可复现的战局结果。",
    action: "去 App Hub",
    icon: Ticket,
    className: styles.playDgp,
  },
];

const modelMessages = [
  "可以戳，但后果自负。",
  "嗯？",
  "你是在戳我吗？",
  "还戳？",
  "这位听众，请自重。",
  "再来几下，梦会翻面。",
  "还有 4 下。",
  "还有 3 下。",
  "还有 2 下。",
  "最后一下。真的。",
  "梦境翻面成功。",
];

const scheduleValue = (raw: string | undefined, label: string, fallback: string) =>
  (raw || fallback).replace(new RegExp(`^${label}\\s*[:：]\\s*`), "");

export default function ConceptExperience({
  initialSongs,
  initialHiddenSongs,
  initialCategories,
  contentLinks,
  liveSchedule,
  requestRules,
  modelDetails,
  credits,
}: ConceptExperienceProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelTaps, setModelTaps] = useState(0);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [pickedSong, setPickedSong] = useState<Song>(() => initialSongs[0] || EMPTY_SONG);
  const [latestVideos, setLatestVideos] = useState<BilibiliVideo[]>([]);
  const [toast, setToast] = useState("");
  const [live, setLive] = useState<LiveState>({
    checked: false,
    isLive: false,
    fans: null,
    liveUrl: LIVE_FALLBACK_URL,
  });

  const dreamFlipped = modelTaps >= 10;
  const songs = useMemo(
    () => (dreamFlipped ? [...initialSongs, ...initialHiddenSongs] : initialSongs),
    [dreamFlipped, initialHiddenSongs, initialSongs],
  );

  const categories = useMemo<SongCategoryOption[]>(
    () => {
      const configured = initialCategories.length > 0
        ? initialCategories.filter((item) => item.id !== "hidden")
        : [{ id: "all", label: "ALL" }];
      return dreamFlipped
        ? [...configured, { id: "hidden", label: "CLASSIFIED" }]
        : configured;
    },
    [dreamFlipped, initialCategories],
  );

  const categoryLabels = useMemo(
    () => new Map(categories.map((item) => [item.id, item.label])),
    [categories],
  );

  const contentCards = useMemo(
    () => contentLinks.map((link, index) => {
      const meta = contentCardMeta[link.title] || {
        copy: "Uli 的 B 站内容合集。",
        className: [styles.programSong, styles.programTea, styles.programGame][index % 3],
        icon: link.icon === "Sparkles" ? Radio : link.icon === "Video" ? AudioLines : Music2,
      };
      return { ...link, ...meta, index: String(index + 1).padStart(2, "0") };
    }),
    [contentLinks],
  );

  const scheduleRows = [
    { label: "早场", value: scheduleValue(liveSchedule.morning, "早场", "早场: 10:00 - 13:00") },
    { label: "晚场", value: scheduleValue(liveSchedule.evening, "晚场", "晚场: 17:00 - 20:00") },
    { label: "休息", value: liveSchedule.off || "周一休" },
  ];

  const filteredSongs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return songs.filter((song) => {
      const categoryMatches = category === "all" || song.category === category;
      const queryMatches =
        !normalizedQuery ||
        song.name.toLowerCase().includes(normalizedQuery) ||
        song.artist.toLowerCase().includes(normalizedQuery);
      return categoryMatches && queryMatches;
    });
  }, [category, query, songs]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/bilibili", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Bilibili status unavailable");
        return response.json() as Promise<BilibiliPayload>;
      })
      .then((payload) => {
        if (!payload.success) return;
        if (payload.user) {
          setLive({
            checked: true,
            isLive: Boolean(payload.user.is_live),
            fans: typeof payload.user.fans === "number" ? payload.user.fans : null,
            liveUrl: payload.user.live_url || LIVE_FALLBACK_URL,
          });
        }
        if (Array.isArray(payload.videos)) setLatestVideos(payload.videos);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLive((current) => ({ ...current, checked: true }));
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleModelTap = () => {
    if (dreamFlipped) {
      setToast("后果已经发生了。CLASSIFIED 歌单仍处于解锁状态。");
      return;
    }
    const nextTap = modelTaps + 1;
    setModelTaps(nextTap);
    if (nextTap === 10) {
      setToast("隐藏协议已解锁 · 真实 CLASSIFIED 歌单已载入");
      setCategory("hidden");
    }
  };

  const copySongCommand = async (song: Song) => {
    const command = `点歌 ${song.name}${song.artist ? ` ${song.artist}` : ""}`;
    try {
      await navigator.clipboard.writeText(command);
      setToast(`已复制：${command}`);
    } catch {
      setToast(`点歌口令：${command}`);
    }
  };

  const handleRandomSong = async () => {
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    if (pool.length === 0) return;
    const nextSong = pool[Math.floor(Math.random() * pool.length)];
    setPickedSong(nextSong);
    await copySongCommand(nextSong);
  };

  const handleSongRequest = async (song: Song) => {
    setPickedSong(song);
    await copySongCommand(song);
  };

  const handlePlaygroundAction = (item: (typeof siteModules)[number]) => {
    window.open("/app", "_blank", "noopener,noreferrer");
    setToast(`${item.eyebrow} · 已打开现有 App Hub`);
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={styles.conceptPage}>
      <a className={styles.skipLink} href="#concept-main">
        跳到主要内容
      </a>

      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.ambientOrbOne} />
        <span className={styles.ambientOrbTwo} />
        <span className={styles.ambientDust} />
      </div>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#top" aria-label="返回概念页顶部">
            <span className={styles.brandMark} aria-hidden="true">
              U
            </span>
            <span>
              <strong>ULIULI</strong>
              <small>PROJECT BLUE MORPHO</small>
            </span>
          </a>

          <nav
            id="concept-navigation"
            className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}
            aria-label="概念页导航"
          >
            <a href="#live-and-content" onClick={closeMenu}>直播与合集</a>
            <a href="#song-machine" onClick={closeMenu}>点歌机</a>
            <a href="#latest-videos" onClick={closeMenu}>最新视频</a>
            <a href="#site-systems" onClick={closeMenu}>互动与游戏</a>
          </nav>

          <div className={styles.headerActions}>
            <span className={styles.conceptBadge}>CONCEPT 01</span>
            <button
              className={styles.menuButton}
              type="button"
              aria-label={menuOpen ? "关闭导航" : "打开导航"}
              aria-controls="concept-navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <main id="concept-main" tabIndex={-1}>
        <section className={styles.hero} id="top" aria-labelledby="concept-title">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>PROJECT CODE: SIGUAULI</p>
              <p className={styles.handNote}>蝴蝶梦中歌唱，彼方沉眠</p>
              <h1 id="concept-title">
                大家好。
                <span>初次入梦，幸会。</span>
              </h1>
              <p className={styles.heroLead}>
                丝瓜 Uli 的直播、作品与互动系统。
                <br />蝶梦是视觉母题，不是给内容强加的剧本。
              </p>

              <div className={styles.heroActions}>
                <a
                  className={styles.primaryButton}
                  href={live.liveUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Play aria-hidden="true" />
                  去直播间
                  <ArrowUpRight aria-hidden="true" />
                </a>
                <a className={styles.secondaryButton} href="#song-machine">
                  <Shuffle aria-hidden="true" />
                  打开点歌机
                </a>
              </div>

              <div className={styles.listenerNote}>
                <span className={styles.avatarStack} aria-hidden="true">
                  <i>梦</i>
                  <i>蝶</i>
                  <i>瓜</i>
                </span>
                <p>
                  {live.checked && live.fans !== null ? (
                    <>B 站关注者 <strong>{live.fans.toLocaleString("zh-CN")}</strong></>
                  ) : (
                    <>B 站数据连接中</>
                  )}
                  <br />实时状态来自公开主页数据
                </p>
              </div>
            </div>

            <div className={styles.heroVisual}>
              <div className={styles.visualHalo} aria-hidden="true" />
              <span className={`${styles.wing} ${styles.wingLeft}`} aria-hidden="true" />
              <span className={`${styles.wing} ${styles.wingRight}`} aria-hidden="true" />
              <span className={styles.visualOrbit} aria-hidden="true" />

              <button
                className={styles.modelButton}
                type="button"
                onClick={handleModelTap}
                aria-label={dreamFlipped ? "Uli 彩蛋已经解锁" : `点击 Uli 立绘，当前 ${modelTaps} 次`}
                aria-pressed={dreamFlipped}
              >
                <Image
                  className={styles.modelImage}
                  src={dreamFlipped ? "/Model2.webp" : "/Model.webp"}
                  alt={dreamFlipped ? "露出恶作剧表情的丝瓜 Uli" : "丝瓜 Uli 角色立绘"}
                  fill
                  priority
                  sizes="(max-width: 760px) 84vw, (max-width: 1200px) 50vw, 620px"
                />
              </button>

              <div className={styles.modelHint} aria-live="polite">
                <Sparkles aria-hidden="true" />
                <span>{modelMessages[Math.min(modelTaps, 10)]}</span>
                {!dreamFlipped ? <strong>{String(modelTaps).padStart(2, "0")} / 10</strong> : null}
              </div>

              <div className={styles.liveSticker} data-live={live.isLive ? "true" : "false"}>
                <span className={styles.liveDot} aria-hidden="true" />
                <div>
                  <small>{live.checked ? (live.isLive ? "ON AIR · 正在直播" : "OFF AIR · 当前未开播") : "CONNECTING · 同步状态"}</small>
                  <strong>{live.checked ? (live.isLive ? "直播间已开启" : "等待下一次开播") : "正在连接 B 站"}</strong>
                </div>
              </div>

              <span className={styles.mondaySticker}>周一休息<br />别白跑</span>
            </div>
          </div>

          <div className={styles.signalStrip} aria-hidden="true">
            <span>PROJECT BLUE MORPHO</span>
            <i>✦</i>
            <span>LIVE · SONG DATABASE · VIDEO</span>
            <i>✦</i>
            <span>MAIL · GACHA · MINI GAMES</span>
            <i>✦</i>
            <span>PROJECT BLUE MORPHO</span>
          </div>

          <a className={styles.scrollCue} href="#live-and-content">
            查看直播与内容入口
            <ArrowDown aria-hidden="true" />
          </a>
        </section>

        <section className={`${styles.section} ${styles.tonightSection}`} id="live-and-content" aria-labelledby="live-content-title">
          <div className={styles.sectionShell}>
            <div className={styles.projectDataPanel}>
              <div className={styles.projectDataCopy}>
                <p className={styles.sectionEyebrow}>PROJECT_DATA / 角色档案</p>
                <h2>立绘不只是首屏装饰。</h2>
                <p>角色细节与制作人员仍是主站身份信息的一部分；点击立绘十次会启动真实彩蛋。</p>
              </div>

              <div className={styles.modelDetailGrid} aria-label="角色细节">
                {modelDetails.map((detail) => (
                  <article key={detail.id}>
                    <Image
                      src={detail.img.startsWith("/") ? detail.img : `/${detail.img}`}
                      alt={`${detail.id} 角色细节`}
                      fill
                      sizes="(max-width: 760px) 29vw, 180px"
                    />
                    <span>{detail.id}_DETAIL</span>
                  </article>
                ))}
              </div>

              <div className={styles.creditList} aria-label="角色制作人员">
                {credits.map((group) => (
                  <div key={group.label}>
                    <span>{group.label}</span>
                    <p>
                      {group.val.map((person) => (
                        <a href={person.link} target="_blank" rel="noreferrer noopener" key={person.link}>
                          {person.name}
                        </a>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.sectionIntro}>
              <p className={styles.sectionEyebrow}>LIVE &amp; CONTENT / 清楚分层</p>
              <h2 id="live-content-title">直播状态与内容合集</h2>
              <p>实时直播是一层，已经发布的三个 B 站内容合集是另一层。</p>
            </div>

            <div className={styles.programGrid}>
              <article className={styles.liveCard}>
                <div className={styles.cardIndex}>LIVE SIGNAL</div>
                <Radio aria-hidden="true" className={styles.liveCardIcon} />
                <div className={styles.liveCardCopy}>
                  <p>{live.checked ? "BILIBILI LIVE STATUS" : "正在同步直播状态"}</p>
                  <h3>{live.checked ? (live.isLive ? "正在直播" : "当前未开播") : "CONNECTING"}</h3>
                  <span>直播标题只描述当次内容，不参与主站品牌定义。</span>
                </div>
                <a href={live.liveUrl} target="_blank" rel="noreferrer noopener">
                  {live.isLive ? "现在进去" : "去直播间看看"}
                  <ArrowUpRight aria-hidden="true" />
                </a>
                <div className={styles.waveform} aria-hidden="true">
                  {Array.from({ length: 18 }).map((_, index) => (
                    <i key={index} style={{ "--bar": `${18 + ((index * 17) % 54)}%` } as React.CSSProperties} />
                  ))}
                </div>
              </article>

              <aside className={styles.scheduleCard} aria-label="通常直播时间">
                <span className={styles.tape}>通常出没</span>
                <Clock3 aria-hidden="true" />
                <dl>
                  {scheduleRows.map((row) => (
                    <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                  ))}
                </dl>
                <ul className={styles.requestRules} aria-label="点歌规则">
                  {(requestRules.length > 0 ? requestRules : ["优先点歌单内的歌曲"]).map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
                <small>具体时间与临时变动以 B 站动态为准</small>
              </aside>

              {contentCards.map((card) => {
                const CardIcon = card.icon;
                return (
                  <article className={`${styles.programCard} ${card.className}`} key={card.url}>
                    <div className={styles.programCardTop}>
                      <span>{card.index}</span>
                      <CardIcon aria-hidden="true" />
                    </div>
                    <h3>{card.title}</h3>
                    <p>{card.copy}</p>
                    <a href={card.url} target="_blank" rel="noreferrer noopener">
                      打开 B 站合集
                      <ChevronRight aria-hidden="true" />
                    </a>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.songSection}`} id="song-machine" aria-labelledby="song-title">
          <div className={styles.paperTexture} aria-hidden="true" />
          <div className={styles.sectionShell}>
            <div className={`${styles.sectionIntro} ${styles.darkIntro}`}>
              <p className={styles.sectionEyebrow}>SONG_DATABASE · {songs.length} 首可见曲目</p>
              <h2 id="song-title">点歌机</h2>
              <p>搜索或随机一首；点击只会复制点歌口令，不会在这里直接提交请求。</p>
            </div>

            <div className={styles.songLayout}>
              <aside className={styles.pickedSong}>
                <div className={styles.pickedTopline}>
                  <span>COMMAND PREVIEW</span>
                  <Music2 aria-hidden="true" />
                </div>
                <div className={styles.vinyl} aria-hidden="true">
                  <span>ULI</span>
                </div>
                <div className={styles.pickedCopy} aria-live="polite">
                  <small>{pickedSong.isHidden ? "CLASSIFIED" : (categoryLabels.get(pickedSong.category) || pickedSong.category)}</small>
                  <h3>{pickedSong.name}</h3>
                  <p>{pickedSong.artist || "隐藏曲目不附歌手字段"}</p>
                </div>
                <button type="button" onClick={handleRandomSong}>
                  <Shuffle aria-hidden="true" />
                  随机一首并复制
                </button>
                <div className={styles.ruleNote}>
                  <strong>点歌规则</strong>
                  <span>{(requestRules.length > 0 ? requestRules : ["优先点歌单内的歌曲"]).join(" · ")}</span>
                </div>
              </aside>

              <div className={styles.songBrowser}>
                <label className={styles.searchField}>
                  <Search aria-hidden="true" />
                  <span className={styles.srOnly}>搜索歌名或歌手</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜歌名或歌手"
                  />
                  <kbd>{filteredSongs.length}</kbd>
                </label>

                <div className={styles.categoryList} aria-label="歌曲分类">
                  {categories.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={category === item.id}
                      onClick={() => setCategory(item.id)}
                    >
                      {item.label}
                      <span>{item.id === "all" ? songs.length : songs.filter((song) => song.category === item.id).length}</span>
                    </button>
                  ))}
                </div>

                <div className={styles.songList}>
                  {filteredSongs.length > 0 ? (
                    filteredSongs.map((song, index) => (
                      <button className={styles.songRow} type="button" key={`${song.name}-${song.artist}`} onClick={() => handleSongRequest(song)}>
                        <span className={styles.songNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.songName}>
                          <strong>{song.name}</strong>
                          <small>{song.artist}</small>
                        </span>
                        <span className={styles.songMood}>{song.isHidden ? "SECRET" : (categoryLabels.get(song.category) || song.category)}</span>
                        <span className={styles.songAction}>
                          复制口令
                          <ArrowUpRight aria-hidden="true" />
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className={styles.emptySongs}>
                      <span>没有找到匹配的歌曲。</span>
                      <button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>
                        换个关键词
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.archiveSection}`} id="latest-videos" aria-labelledby="archive-title">
          <div className={styles.sectionShell}>
            <div className={styles.archiveHeader}>
              <div className={styles.sectionIntro}>
                <p className={styles.sectionEyebrow}>BILIBILI FEED / 实时投稿</p>
                <h2 id="archive-title">最新视频</h2>
                <p>这里读取真实投稿动态；它与上面的三个固定内容合集互不替代。</p>
              </div>
              <a href="https://space.bilibili.com/3546779356235807" target="_blank" rel="noreferrer noopener">
                去 B 站看全部投稿
                <ArrowUpRight aria-hidden="true" />
              </a>
            </div>

            <div className={styles.archiveGrid}>
              {latestVideos.slice(0, 3).map((video, index) => (
                <a
                  className={`${styles.archiveCard} ${index === 0 ? styles.archiveFeature : ""}`}
                  href={video.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  key={video.url}
                >
                  <img
                    src={video.pic.replace(/^http:/, "https:")}
                    alt={`${video.title} 视频封面`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = "/og-image.jpg";
                    }}
                  />
                  <span className={styles.archiveShade} aria-hidden="true" />
                  <div className={styles.archiveTopline}>
                    <span>{video.date}</span>
                    <span>0{index + 1}</span>
                  </div>
                  <div className={styles.archiveCopy}>
                    <small>{video.title.includes("蝶梦聆境") ? "蝶梦聆境" : video.title.includes("时光白驹") ? "时光白驹 tea time" : "最新投稿"}</small>
                    <h3>{video.title}</h3>
                    <p>{video.length} · {Number(video.play).toLocaleString("zh-CN")} 播放</p>
                  </div>
                  <span className={styles.archiveArrow}><ArrowUpRight aria-hidden="true" /></span>
                </a>
              ))}

              {latestVideos.length === 0 ? (
                <div className={styles.archiveLoading}>
                  <Radio aria-hidden="true" />
                  <span>正在读取最新投稿…</span>
                </div>
              ) : null}

              <div className={styles.archiveInterlude}>
                <Image
                  src="/Background.webp"
                  alt="丝瓜 Uli 蝶翼主题横幅插画"
                  fill
                  sizes="(max-width: 760px) 94vw, 52vw"
                />
                <span aria-hidden="true">PROJECT BLUE MORPHO</span>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.playgroundSection}`} id="site-systems" aria-labelledby="playground-title">
          <div className={styles.playgroundButterfly} aria-hidden="true" />
          <div className={styles.sectionShell}>
            <div className={`${styles.sectionIntro} ${styles.darkIntro}`}>
              <p className={styles.sectionEyebrow}>SITE SYSTEMS / 互动生态</p>
              <h2 id="playground-title">互动工具与小游戏</h2>
              <p>这些是主站里已经存在的独立系统，不是 Uli 的直播内容分类。</p>
            </div>

            <div className={styles.playGrid}>
              {siteModules.map((item, index) => {
                const ItemIcon = item.icon;
                return (
                  <article className={`${styles.playCard} ${item.className}`} key={item.id}>
                    <span className={styles.playNumber}>MODULE 0{index + 1}</span>
                    <ItemIcon aria-hidden="true" />
                    <p>{item.eyebrow}</p>
                    <h3>{item.title}</h3>
                    <span>{item.copy}</span>
                    <button type="button" onClick={() => handlePlaygroundAction(item)}>
                      {item.action}
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <span className={styles.footerMark}>U</span>
          <p>
            <strong>蝶梦是气质，内容与功能各有自己的名字。</strong>
            <small>这是一张独立概念提案，没有覆盖现有主站。</small>
          </p>
        </div>
        <div className={styles.footerMeta}>
          <span>© 2026 PROJECT BLUE MORPHO</span>
          <Link href="/">返回当前主站 <ArrowUpRight aria-hidden="true" /></Link>
        </div>
      </footer>

      <div className={`${styles.toast} ${toast ? styles.toastVisible : ""}`} role="status" aria-live="polite" aria-atomic="true">
        <Sparkles aria-hidden="true" />
        <span>{toast}</span>
      </div>
    </div>
  );
}
