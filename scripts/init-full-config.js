/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * 初始化完整配置脚本
 * 在第一次运行时，将所有可编辑的文本配置写入数据库
 * 
 * 使用方法：
 * node scripts/init-full-config.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/codes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err);
    process.exit(1);
  }
  console.log('✅ 已连接到数据库');
});

// Promise 版本
const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// 完整的默认配置
const defaultConfig = {
  hero: {
    code: "PROJECT: GOBLIN_SILK_MELON / STATUS: 梦中歌唱",
    title: "大家好。初次入梦，幸会",
    subtitle: "蝴蝶梦中歌唱，彼方沉眠",
    projectName: "项目名称: 丝瓜ULI",
    startBtn: "START_STAGE",
    scrollText: "SCROLL",
    statusText: "项目状态: 存活",
    followersText: "现有追随者:",
  },
  model: {
    titlePrefix: "PROJECT",
    titleSuffix: "_DATA",
    syncRate: "SYNC_RATE: 100%",
    details: [
      { id: "armor", img: "pic/armor_detail.jpg" },
      { id: "mic", img: "pic/mic_detail.jpg" },
      { id: "optic", img: "pic/optic_detail.jpg" },
    ],
    credits: [
      {
        label: "ILLUSTRATOR",
        val: [
          { name: "项目名称", link: "#" },
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
    rules: [
      "优先点歌单内的歌曲",
    ],
    links: [
      {
        title: "抽卡",
        url: "#",
        icon: "Music",
        color: "pink",
      },
      {
        title: "投稿",
        url: "#",
        icon: "Video",
        color: "cyan",
      },
      {
        title: "应援",
        url: "#",
        icon: "Sparkles",
        color: "purple",
      },
    ],
  },
  gallery: {
    title: "视频库",
    datePrefix: "DATE //",
  },
  api: {
    bilibili: "https://1377297588-5v9c60xnw1.ap-guangzhou.tencentscf.com/?mid=3546779356235807",
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
  footer: {
    text: "© 2024 BLUE MORPHO TERMINAL. ALL RIGHTS RESERVED.",
  },
  notifications: {
    modelClicked: "MODEL CLICKED",
    clickWarning: "WARNING: {count} CLICKS TO OVERRIDE",
    unlocked: "SYSTEM OVERRIDE: HIDDEN PROTOCOL ACTIVATED",
    alreadyUnlocked: "MODEL ARCHIVE ALREADY UNLOCKED",
    systemInitializing: "SYSTEM INITIALIZING...",
    goldenAlertTitle: "SYSTEM ALERT",
    goldenAlertSubtitle: "HIDDEN EVENT TRIGGERED",
    goldenCongratsTitle: "✨ 恭喜出金！✨",
    goldenBody: "如果你是舰长，截图发到群里便可以免费领取一首隐藏歌单。如果不是，两个心动盲盒就能领取！",
    timestampPrefix: "TIMESTAMP:",
    acknowledgeText: "ACKNOWLEDGE",
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
    dgpStatus: "STATUS: MIGRATING...",
    returnText: "RETURN TO LOBBY",
    migratingTitle: "MODULE MIGRATING",
    migratingDesc: "DGP 模块正在向 Vite 架构迁移中...",
  },
  errors: {
    title: "⚠ 页面遇到了一点小故障 (Page Crashed)",
    message: "请不用担心，这是一个程序错误，不是你的问题。",
    retryText: "刷新页面重试",
  },
  videos: {
    hiddenTitle: "🔓 HIDDEN_ARCHIVE_UNLOCKED",
    unlockedTitle: "📺 SYSTEM_VIDEO_FEED",
  },
  gacha: {
    pityThreshold: 8000,
    softPityStart: 5000,
    baseRate: 1 / 10000,
    maxRate: 0.6,
  },
};

async function initConfig() {
  try {
    console.log('\n📝 初始化完整配置...\n');

    // 检查是否已存在配置
    const existing = await dbGet(
      'SELECT value FROM site_config WHERE key = ?',
      ['site_config']
    );

    if (existing) {
      console.log('✅ 配置已存在，跳过初始化');
      console.log('   (如需重置，请手动删除数据库或执行 DELETE FROM site_config;)');
      db.close();
      return;
    }

    // 插入默认配置
    await dbRun(
      `INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      ['site_config', JSON.stringify(defaultConfig)]
    );

    console.log('✅ 默认配置已初始化！\n');
    console.log('📋 已配置的字段:');
    console.log('   ✓ hero (首页文案)');
    console.log('   ✓ model (档案部分)');
    console.log('   ✓ live (直播部分)');
    console.log('   ✓ gallery (视频库)');
    console.log('   ✓ api (API 配置)');
    console.log('   ✓ song_ui (歌单UI)');
    console.log('   ✓ footer (页脚)');
    console.log('   ✓ notifications (通知文本)');
    console.log('   ✓ videos (视频标题)');
    console.log('\n💡 所有配置均可在 /admin 后台修改');

    db.close();
  } catch (error) {
    console.error('❌ 配置初始化失败:', error);
    db.close();
    process.exit(1);
  }
}

initConfig();
