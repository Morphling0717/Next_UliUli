# Next_UliUli 技术架构深度分析文档

> **项目概述**: 虚拟主播 UliUli 的综合互动站点，集成展示、游戏、社交、管理等多功能模块
> **技术栈**: Next.js 16 + React 18 + TypeScript 5 + SQLite + Three.js + Tailwind CSS 4
> **部署方式**: Docker 容器化部署，支持 1Panel 面板管理
> **线上地址**: https://www.uliuli.cc

---

## 目录

1. [技术栈总览](#技术栈总览)
2. [项目架构设计](#项目架构设计)
3. [核心功能模块详解](#核心功能模块详解)
4. [数据库设计](#数据库设计)
5. [API 路由架构](#api-路由架构)
6. [前端组件架构](#前端组件架构)
7. [游戏引擎架构](#游戏引擎架构)
8. [部署与运维](#部署与运维)
9. [性能优化策略](#性能优化策略)
10. [安全机制](#安全机制)
11. [潜在改进建议](#潜在改进建议)

---

## 技术栈总览

### 核心框架层

| 技术 | 版本 | 用途 | 关键特性 |
|------|------|------|----------|
| **Next.js** | 16.2.3 | 全栈框架 | App Router, Turbopack, SSR/SSG, API Routes |
| **React** | 18.3.1 | UI 框架 | Server Components, Client Components, Suspense |
| **TypeScript** | 5.x | 类型系统 | 严格模式，完整类型覆盖 |
| **Node.js** | 20.x | 运行时 | 原生模块兼容性（sqlite3） |

### 样式与动画层

| 技术 | 版本 | 用途 | 关键特性 |
|------|------|------|----------|
| **Tailwind CSS** | 4.x | 样式框架 | PostCSS 集成，自定义霓虹色板 |
| **Framer Motion** | 11.13.1 | 动画库 | 复杂动画，手势支持，性能优化 |
| **GSAP** | 3.15.0 | 高级动画 | ScrollTrigger，时间轴控制 |
| **Three.js** | 0.183.2 | 3D 渲染 | 赛博朋克动态背景 |

### 数据与状态层

| 技术 | 版本 | 用途 | 关键特性 |
|------|------|------|----------|
| **sqlite3** | 5.1.7 | 数据库 | 原生模块，文件型存储，Promise 封装 |
| **React Hooks** | 内置 | 状态管理 | useState, useEffect, useContext |

### 第三方集成

| 技术 | 版本 | 用途 | 关键特性 |
|------|------|------|----------|
| **@windchime/embed** | 0.3.1 (本地) | 邮箱组件 | 匿名留言，Turnstile 集成 |
| **Cloudflare Turnstile** | 可选 | 人机校验 | 隐私友好的 CAPTCHA 替代方案 |
| **lucide-react** | 0.542.0 | 图标库 | 现代化 SVG 图标 |
| **sweetalert2** | 11.26.24 | 弹窗组件 | 美观的提示框 |
| **qrcode** | 1.5.4 | 二维码生成 | 分享海报生成 |

---

## 项目架构设计

### 整体架构模式

```
┌─────────────────────────────────────────────────────────────┐
│                         客户端层                              │
├─────────────────────────────────────────────────────────────┤
│  Server Components (SSR)  │  Client Components (交互)       │
│  - layout.tsx              │  - Dashboard.tsx                │
│  - page.tsx (首页)         │  - Gacha.tsx (抽卡系统)         │
│  - m/[slug]/page.tsx       │  - GameModal.tsx (游戏大厅)     │
│  - admin/page.tsx          │  - Effects.tsx (Three.js 背景)  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Next.js App Router                       │
├─────────────────────────────────────────────────────────────┤
│  - 路由系统 (文件系统路由)                                     │
│  - Proxy (proxy.ts - SEO 控制)                                │
│  - API Routes (app/api/*)                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       业务逻辑层                               │
├─────────────────────────────────────────────────────────────┤
│  - lib/db.ts (数据库封装)                                      │
│  - lib/mail-*.ts (邮件系统逻辑)                                │
│  - lib/dgp/* (DGP 游戏引擎)                                    │
│  - lib/namearena/* (Name Arena 引擎)                          │
│  - lib/site-data.ts (站点数据加载)                             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       数据持久层                               │
├─────────────────────────────────────────────────────────────┤
│  - SQLite (codes.db)                                          │
│  - 文件系统 (public/* 静态资源)                                │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构详解

```
Next_UliUli/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页 (Server Component)
│   ├── layout.tsx                # 根布局 (SEO, Meta, 全局样式)
│   ├── globals.css               # 全局样式 + 霓虹色板
│   ├── admin/                    # 管理后台
│   ├── api/                      # API 路由
│   ├── m/                        # 主题收件箱公开路由
│   └── mail/                     # 邮件管理后台
├── components/                   # React 组件
│   ├── Dashboard.tsx             # 主播档案 + 视频画廊
│   ├── Gacha.tsx                 # 抽卡系统
│   ├── GameModal.tsx             # 游戏大厅
│   ├── SongSystem.tsx            # 歌单系统
│   ├── Effects.tsx               # Three.js 背景 + 自定义光标
│   ├── UI.tsx                    # 通用 UI 组件
│   ├── mail/                     # 邮件系统组件
│   ├── dgp/                      # DGP 游戏组件
│   └── namearena/                # Name Arena 游戏组件
├── lib/                          # 业务逻辑库
│   ├── db.ts                     # SQLite 封装
│   ├── mail-auth.ts              # 邮件认证
│   ├── mail-rate-limit.ts        # 邮件限流
│   ├── mail-topics.ts            # 主题收件箱逻辑
│   ├── dgp/                      # DGP 引擎
│   └── namearena/                # Name Arena 引擎
├── public/                       # 静态资源
│   ├── video/                    # 视频文件
│   ├── memes/                    # 表情包 (抽卡)
│   └── pic/                      # 图片资源
├── Dockerfile                    # Docker 镜像构建
├── docker-compose.yml            # Docker Compose 配置
├── next.config.ts                # Next.js 配置
├── tsconfig.json                 # TypeScript 配置
└── package.json                  # 项目依赖
```

---

## 核心功能模块详解

### 1. 抽卡系统 (Gacha)

#### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     Gacha.tsx (客户端)                        │
├─────────────────────────────────────────────────────────────┤
│  - 状态管理: collection, coins, history, user                 │
│  - 模式切换: MACHINE, GALLERY, HISTORY, ACCOUNT              │
│  - 本地存储: localStorage (STORAGE_KEY)                        │
│  - 云端同步: /api/user/sync (登录后)                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    API 接口层                                  │
├─────────────────────────────────────────────────────────────┤
│  POST /api/generate     - 生成兑换码                          │
│  POST /api/redeem       - 核销兑换码                          │
│  POST /api/check_status - 批量查询状态                        │
│  POST /api/increment    - 抽卡保底计数                        │
│  GET  /api/getCount     - 获取保底计数                        │
│  POST /api/auth/login   - 用户登录                            │
│  POST /api/auth/register- 用户注册                            │
│  POST /api/user/sync    - 云端数据同步                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    数据持久层                                  │
├─────────────────────────────────────────────────────────────┤
│  users 表: username, password_hash, salt, token, gacha_data  │
│  gift_codes 表: code, item_id, status, created_at             │
│  global_config 表: key='pityCount', value                    │
└─────────────────────────────────────────────────────────────┘
```

#### 关键特性

- **保底机制**: 服务端维护全局 `pityCount`，支持软保底和硬保底
- **用户系统**: PBKDF2 密码哈希，token 认证，云端数据同步
- **兑换码系统**: 生成、核销、状态查询，支持礼物分享
- **每日奖励**: 登录自动领取 3 枚硬币
- **开发者模式**: 隐藏彩蛋（输入 "morphling0717" 激活无限硬币）

### 2. 邮件系统 (Mail)

#### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                   访客侧 (公开)                                │
├─────────────────────────────────────────────────────────────┤
│  MailSpeedDial (左下浮动按钮)                                 │
│    ↓                                                          │
│  MailSendModal (投信弹窗)                                     │
│    ↓                                                          │
│  WindChimeSender (@windchime/embed)                           │
│    ↓                                                          │
│  POST /api/mail/messages (Turnstile + 限流 + 敏感词)          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   管理侧 (后台)                                │
├─────────────────────────────────────────────────────────────┤
│  /mail (密码保护: MAIL_AUTH_PASSWORD)                          │
│    ↓                                                          │
│  WindChimeAdminPanel (@windchime/embed)                        │
│    ↓                                                          │
│  GET /api/mail/messages (列表)                                │
│  PATCH /api/mail/messages/[id] (标记)                          │
│  DELETE /api/mail/messages/[id] (删除)                        │
│  GET /api/mail/blocklist (黑名单)                              │
│  PUT /api/mail/blocked-terms (敏感词)                          │
└─────────────────────────────────────────────────────────────┘
```

#### 安全机制

- **双重限流**: IP 限流 + 指纹限流 (lib/mail-rate-limit.ts)
- **人机校验**: Cloudflare Turnstile (可选)
- **敏感词过滤**: 命中敏感词直接拒绝 (lib/db.ts: matchBlockedTerm)
- **黑名单机制**: 支持按 senderFingerprint 和 IP 拉黑
- **密码保护**: HttpOnly Cookie session + 请求头兼容验证 (lib/admin-session.ts, lib/mail-auth.ts)

#### 主题收件箱 (Mail Topics)

```
┌─────────────────────────────────────────────────────────────┐
│                   主题状态派生                                  │
├─────────────────────────────────────────────────────────────┤
│  常驻 (default): is_default=1                                  │
│  进行中 (active): is_enabled=1 AND 时间窗内 AND 未归档          │
│  未开始 (scheduled): is_enabled=1 AND now < starts_at          │
│  已结束 (ended): is_enabled=0 OR now > ends_at                │
│  已归档 (archived): archived_at IS NOT NULL                    │
└─────────────────────────────────────────────────────────────┘
```

### 3. 游戏系统

#### 游戏大厅 (GameModal)

```
┌─────────────────────────────────────────────────────────────┐
│                   GameModal.tsx                               │
├─────────────────────────────────────────────────────────────┤
│  - 动态导入: dynamic import (SSR: false)                       │
│  - 游戏选择: Name Arena / DGP                                 │
│  - 全屏模式: 移动端适配                                        │
└─────────────────────────────────────────────────────────────┘
```

#### DGP 引擎架构

```
lib/dgp/
├── engine.ts          # 战斗引擎核心 (3355 行)
├── data.ts            # 游戏数据
├── logic.ts           # 战斗逻辑
├── constants.ts       # 数值常量
├── rng.ts             # 随机数生成器
└── types.ts           # 类型定义
```

#### 确定性 RNG 实现

```typescript
// lib/dgp/rng.ts
class SeededRNG {
  private seed: number;

  constructor(seed?: number | string) {
    this.seed = this.hashSeed(seed);
  }

  next(): number {
    // Mulberry32 算法
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
```

**优势**: 相同 seed + 相同初始阵容 = 完全一致的战斗流程，便于调试和回放

---

## 数据库设计

### 表结构总览

| 表名 | 用途 | 关键字段 | 索引 |
|------|------|----------|------|
| `users` | 用户系统 | username, password_hash, token, gacha_data | username (UNIQUE) |
| `gift_codes` | 兑换码 | code, item_id, status | code (PRIMARY KEY) |
| `global_config` | 全局配置 | key, value | key (PRIMARY KEY) |
| `site_config` | 站点配置 | key, value, version, updated_by | key (PRIMARY KEY) |
| `site_config_history` | 配置历史 | snapshot_version, site_config_value | backed_up_at (DESC) |
| `songs` | 歌单 | category, name, artist | - |
| `hidden_songs` | 隐藏歌单 | name | - |
| `mail_messages` | 邮件消息 | text, sender_hash, topic_id, is_read | created_at, topic_id |
| `mail_topics` | 邮件主题 | slug, title, is_enabled, starts_at, ends_at | slug (UNIQUE) |
| `mail_blocklist` | 黑名单 | hash, label | hash (PRIMARY KEY) |
| `mail_settings` | 邮件设置 | key, value | key (PRIMARY KEY) |

### 数据库连接管理

```typescript
// lib/db.ts
const globalForDb = global as unknown as { __db?: sqlite3.Database };
export const db = globalForDb.__db ?? new sqlite3.Database(dbPath);

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__db = db; // 开发环境复用连接
}

// Promise 封装
export const get = <T>(query: string, params: unknown[]): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
};
```

---

## API 路由架构

### 路由组织结构

```
app/api/
├── [action]/route.ts          # 动态路由
├── auth/[action]/route.ts     # 认证接口
├── user/[action]/route.ts     # 用户数据接口
├── admin/                     # 管理接口
├── config/route.ts            # 配置读取
└── mail/                      # 邮件系统接口
```

### 认证机制

```typescript
// Admin 认证
const adminPassword = req.headers.get('x-admin-password');
if (adminPassword !== process.env.ADMIN_PASSWORD) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// Mail 认证
const mailPassword = req.headers.get('x-mail-password');
const expected = process.env.MAIL_AUTH_PASSWORD || process.env.ADMIN_PASSWORD;
return mailPassword === expected;
```

---

## 前端组件架构

### 组件层次结构

```
app/layout.tsx (根布局)
├── Effects.tsx (全局特效)
├── PwaUpdateBanner (PWA 更新提示)
├── PwaInstallGate (PWA 安装引导)
└── {children}
    ├── app/page.tsx (首页)
    │   └── HomeClient.tsx
    │       ├── Dashboard.tsx
    │       ├── SongSystem.tsx
    │       ├── Gacha.tsx
    │       ├── GameModal.tsx
    │       └── MailSpeedDial.tsx
    ├── app/admin/page.tsx (管理后台)
    └── app/m/[slug]/page.tsx (主题收件箱)
```

### Server Components vs Client Components

#### Server Components (SSR)
- app/page.tsx: 首页，从 SQLite 读取初始数据
- app/layout.tsx: 根布局，SEO 元数据
- app/m/[slug]/page.tsx: 主题页，服务端状态分发

#### Client Components (交互)
- Dashboard.tsx: 复杂动画，GSAP ScrollTrigger
- Gacha.tsx: 抽卡交互，状态管理
- GameModal.tsx: 游戏逻辑，动态导入
- Effects.tsx: Three.js 渲染，WebGL

---

## 游戏引擎架构

### DGP 引擎深度分析

#### 核心类设计

```typescript
export class DgpEngine {
  currentPlayers: Player[];
  round: number;
  activeStage: StageDef | null;
  groundBuckles: string[];
  rng: SeededRNG;

  constructor(initialPlayers: Player[], seed?: number | string) {
    this.rng = new SeededRNG(seed);
    this.currentPlayers = deepClone(initialPlayers);
    this.round = 1;
  }

  runBattle(): DgpLogEntry[] {
    while (this.alivePlayers.length > 1) {
      this.runRound();
    }
    return this.logs;
  }
}
```

#### 战斗流程

```
开始战斗 → 初始化玩家 → 回合循环 → 阶段事件 → 行动顺序 → 执行行动 → 回合结算 → 胜利检查
```

---

## 部署与运维

### Docker 部署架构

#### Dockerfile 分析

```dockerfile
# 多阶段构建
FROM node:20-bookworm-slim AS base
FROM base AS deps
FROM base AS builder
FROM node:20-bookworm-slim AS runner
```

**设计要点**:
- 多阶段构建减小镜像体积
- 原生编译 sqlite3 (build-from-source)
- 数据持久化卷挂载
- 监听 0.0.0.0 适配容器网络

### 环境变量配置

#### 必填变量

```bash
ADMIN_PASSWORD=strong_password_here
DEV_UNLOCK_PASSWORD=unlock_password_here
DATABASE_PATH=/app/data/codes.db
NEXT_PUBLIC_SITE_URL=https://www.uliuli.cc
WINDCHIME_HASH_SALT=random_string_here
```

#### 可选变量

```bash
MAIL_AUTH_PASSWORD=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
MAIL_BLOCKED_TERMS=政治,色情,赌博
```

---

## 性能优化策略

### 前端优化

#### 1. 代码分割
```typescript
const GameModal = dynamic(() => import('@/components/GameModal'), {
  loading: () => <div>Loading...</div>,
});
```

#### 2. 图片优化
```typescript
<link rel="preload" as="image" href="/Model.webp" fetchPriority="high" />
<img src={`${CONFIG.PATH_PREFIX}${id}.webp`} loading="lazy" />
```

#### 3. 字体优化
```typescript
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="..." media="print" data-async-font="true" />
```

### 后端优化

#### 1. 数据库索引
```sql
CREATE INDEX idx_mail_messages_topic_created
  ON mail_messages (topic_id, deleted_at, created_at);
```

#### 2. 查询优化
```typescript
// 批量查询代替 N+1
const topics = await all<TopicRow>('SELECT * FROM mail_topics');
const counts = await all<{ topic_id: string; unread: number }>(`
  SELECT topic_id, COUNT(*) as unread
  FROM mail_messages
  WHERE is_read = 0 AND deleted_at IS NULL
  GROUP BY topic_id
`);
```

---

## 安全机制

### 认证与授权

#### 1. 密码哈希
```typescript
export const hashPassword = (password: string, salt: string) => {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
};
```

#### 2. Token 认证
```typescript
const token = crypto.randomBytes(32).toString('hex');
await run('UPDATE users SET token = ? WHERE username = ?', [token, username]);
```

### 输入验证

#### 1. SQL 注入防护
```typescript
await get('SELECT * FROM users WHERE username = ?', [username]);
```

#### 2. XSS 防护
```typescript
const e = escapeHtml;
const log = `${e(player.name)} 使用了技能`;
```

### 限流与防护

#### 1. IP 限流
```typescript
const RATE_LIMIT_MAP = new Map<string, { count: number; resetTime: number }>();
export function checkRateLimit(ip: string, limit: number = 10, window: number = 60000): boolean {
  // 实现逻辑...
}
```

#### 2. 敏感词过滤
```typescript
export function matchBlockedTerm(terms: string[], ...fields: Array<string | null | undefined>): string | null {
  // 实现逻辑...
}
```

---

## 潜在改进建议

### 架构层面

#### 1. 数据库迁移到 PostgreSQL/MySQL

**现状**: 使用 SQLite 文件型数据库

**问题**:
- 并发写入性能有限
- 不适合多实例部署
- 缺乏高级特性 (JSON 索引、全文搜索)

**建议**: 使用 Prisma ORM 迁移到 PostgreSQL

**优势**:
- 更好的并发性能
- 支持读写分离
- 丰富的数据类型
- 成熟的备份工具

#### 2. 引入 Redis 缓存层

**现状**: 无缓存层，每次请求都查数据库

**建议**: 使用 ioredis 实现缓存

**优势**:
- 减少数据库压力
- 提升响应速度
- 支持分布式锁

#### 3. 消息队列 (Bull/BullMQ)

**现状**: 同步处理邮件发送等任务

**建议**: 使用 Bull 处理异步任务

**优势**:
- 异步处理耗时任务
- 任务重试机制
- 优先级队列

### 代码质量

#### 1. 单元测试

**现状**: 无测试覆盖

**建议**: 使用 Jest + React Testing Library

```typescript
import { render, screen } from '@testing-library/react';
import Gacha from '@/components/Gacha';

describe('Gacha', () => {
  it('should render spin button', () => {
    render(<Gacha />);
    expect(screen.getByText('START SPIN')).toBeInTheDocument();
  });
});
```

#### 2. E2E 测试

**建议**: 使用 Playwright

```typescript
import { test, expect } from '@playwright/test';

test('user can spin gacha', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('[data-testid="gacha-button"]');
  await expect(page.locator('[data-testid="gacha-result"]')).toBeVisible();
});
```

#### 3. 类型安全增强

**现状**: 部分使用 any 类型

**建议**: 定义严格的 API 类型

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}
```

### 性能优化

#### 1. CDN 集成

**现状**: 静态资源从同域加载

**建议**: 使用 Cloudflare R2 或 AWS S3 + CloudFront

#### 2. 图片优化

**建议**: 使用 Next.js Image 组件 + sharp

```typescript
import Image from 'next/image';

<Image
  src="/Model.webp"
  alt="Model"
  width={500}
  height={500}
  placeholder="blur"
/>
```

#### 3. 代码分割优化

**建议**: 路由级和组件级分割

### 安全增强

#### 1. HTTPS 强制

**建议**: 在 proxy.ts 中强制 HTTPS

```typescript
export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
```

#### 2. CSP 头

**建议**: 在 next.config.ts 中添加 CSP

```typescript
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
          },
        ],
      },
    ];
  },
};
```

#### 3. 速率限制增强

**建议**: 使用 upstash/ratelimit

```typescript
import { Ratelimit } from '@upstash/ratelimit';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});
```

### 可维护性

#### 1. 日志系统

**建议**: 使用 pino 或 winston

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

logger.info({ userId, action }, 'User performed action');
```

#### 2. 监控告警

**建议**: 使用 Sentry

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

#### 3. 配置管理

**建议**: 使用 zod 验证环境变量

```typescript
import { z } from 'zod';

const envSchema = z.object({
  ADMIN_PASSWORD: z.string().min(8),
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

const env = envSchema.parse(process.env);
```

---

## 总结

### 项目优势

1. **技术栈现代化**: Next.js 16 + React 18 + TypeScript 5，使用最新特性
2. **功能完整性**: 涵盖展示、游戏、社交、管理等多功能模块
3. **游戏引擎深度**: DGP 和 Name Arena 两个完整的游戏引擎，确定性 RNG
4. **邮件系统完善**: 主题收件箱、限流、敏感词过滤、黑名单机制
5. **部署便捷**: Docker 容器化，支持 1Panel 一键部署
6. **SEO 友好**: Server Components，结构化数据，meta 标签完整

### 技术债务

1. **数据库限制**: SQLite 不适合高并发场景
2. **无测试覆盖**: 缺少单元测试和 E2E 测试
3. **类型安全**: 部分使用 any 类型
4. **缓存缺失**: 无 Redis 缓存层
5. **监控不足**: 缺少日志系统和告警机制
6. **安全增强**: 可添加 CSP、HTTPS 强制等

### 改进优先级

#### 高优先级
1. **迁移到 PostgreSQL**: 解决并发写入问题
2. **添加单元测试**: 提升代码质量
3. **引入 Redis 缓存**: 提升性能
4. **增强安全机制**: CSP、HTTPS、速率限制

#### 中优先级
5. **添加监控告警**: Sentry + 日志系统
6. **图片优化**: Next.js Image + CDN
7. **代码分割优化**: 减少初始加载体积

#### 低优先级
8. **国际化支持**: i18n
9. **主题切换**: next-themes
10. **PWA 增强**: next-pwa

---

**文档版本**: 1.0
**最后更新**: 2026-05-25
**维护者**: UliUli 技术团队
