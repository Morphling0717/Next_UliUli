# UliUli · 虚拟主播站点 (new-website)

> 虚拟主播 **UliUli** 的单页展示与互动站点 —— **Next.js 16** (App Router) + **React 18** + **TypeScript** + **SQLite**。集成 Three.js 赛博朋克背景、可视化 Admin 后台、抽卡系统（保底/软保底）、兑换码、歌单管理、本地视频解锁、以及 Name Arena 对战小游戏。线上：<https://www.uliuli.cc>

> ⚠️ 为避免"本地能跑、1Panel 上翻车"，生产环境**强烈建议**统一用 Docker 部署并持久化挂载数据库与上传目录。

---

## ✨ 功能亮点

- 🌌 **赛博朋克 UI**：Three.js 动态背景 + 霓虹色板 (`--neon-blue`) + 自定义光标。
- 📊 **信息仪表盘**：Dashboard + 横向视频画廊，展示主播档案 / 直播 / 社交链接。
- 🎵 **歌单系统**：分类（流行 / 日系 / …）+ 隐藏歌单，存储于 SQLite `songs` / `hidden_songs` 表，后台可增删改。
- 🎰 **抽卡 Gacha**：
  - 可配置基础概率 / 软保底起点 / 硬保底次数 / 最大概率
  - 服务端递增保底计数（`pityCount` 全局），前端只拿结果
  - API：`POST /api/increment`、`GET /api/getCount`
- 🎁 **兑换码系统**：`POST /api/generate` 生成、`POST /api/redeem` 核销、`POST /api/check_status` 批量查询。
- 🔓 **隐藏内容解锁**：`DEV_UNLOCK_PASSWORD` 解锁后切换到隐藏视频 (`/video/2.mp4`) 和隐藏歌单。
- 🛠 **Admin 后台**：`/admin` 登录后可编辑 SITE_CONFIG、歌单、上传图片到 `/public/memes`、`/public/pic`。
- ⚔️ **Name Arena**：`lib/namearena/` 下的文字战斗引擎（battleEngine / skills / jobs / data，独立子系统）。
- 👥 **用户系统**：注册 / 登录（PBKDF2 + salt）、token 保存抽卡进度到 SQLite。
- 🐳 **一键 Docker**：内置 `Dockerfile` + `docker-compose.yml`，含原生模块 `sqlite3` 的 `npm rebuild --build-from-source`。

---

## 🧱 技术栈

| 层面      | 技术                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| 框架      | **Next.js 16.2.3** (App Router + Turbopack) · **React 18** · **TypeScript 5** |
| 样式      | **Tailwind CSS 4** (`@tailwindcss/postcss`) · 自定义 CSS 变量霓虹色板         |
| 动画 / 3D | **Framer Motion 11** · **GSAP 3** · **Three.js 0.183**                        |
| 图标 / UI | **lucide-react** · **sweetalert2**（弹窗）                                    |
| 数据库    | **sqlite3**（原生模块，文件型）                                               |
| 部署      | **Docker**（node:20-bookworm-slim 多阶段构建）+ **1Panel** 友好               |

Node 版本:见 `.nvmrc` → **Node 20.x**(`package.json.engines` 亦约束)。

> ❗ **不要用 Node 22** 跑本项目 —— `sqlite3` 原生模块在 22 上编译较脆弱,容易 `node-gyp` 失败。

---

## 🚀 本地开发

```bash
# 1. 安装依赖（CI 模式，严格按 lockfile）
npm ci

# 2. 复制环境变量示例
cp .env.example .env.local   # Windows 手动复制

# 3. 启动开发服务器（Turbopack）
npm run dev
```

浏览器打开 <http://localhost:3000> · 管理后台 <http://localhost:3000/admin>

---

## 📜 npm scripts

| 命令            | 说明                                            |
| --------------- | ----------------------------------------------- |
| `npm run dev`   | 启动开发服务器（Turbopack）                     |
| `npm run build` | 生产构建                                        |
| `npm run start` | 启动生产服务（需先 `npm run build`）            |
| `npm run lint`  | ESLint 9 代码检查                               |
| `npm run clean` | 清理 `.next` / `out` / `build` / `node_modules` |

---

## 🔐 环境变量

`.env.local`(本地)或 1Panel 应用环境变量:

```bash
# 必填：后台管理员密码（用于 /api/admin/save、/api/admin/upload）
ADMIN_PASSWORD=change_me_to_a_strong_password

# 必填：隐藏内容解锁密码（用于 /api/admin/unlock，解锁隐藏视频/歌单）
DEV_UNLOCK_PASSWORD=change_me_to_a_dev_unlock_password

# 必填：SQLite 文件路径
#   本地：  ./codes.db
#   Docker：/app/data/codes.db
DATABASE_PATH=./codes.db

# 必填：公开站点地址（用于 Open Graph 分享卡片）
NEXT_PUBLIC_SITE_URL=https://www.uliuli.cc
```

> ⚠️ 生产环境务必修改两个密码;请勿把 `.env.local` 提交到仓库。

---

## 🗄 数据库结构（`lib/db.ts` 自动建表）

| 表              | 作用                                                     |
| --------------- | -------------------------------------------------------- |
| `users`         | 用户注册 / 登录 / token / 抽卡进度 JSON（PBKDF2 + salt） |
| `gift_codes`    | 兑换码（`code` 主键 / `item_id` / `status`）             |
| `global_config` | 全局 KV（目前存 `pityCount` 抽卡保底计数）               |
| `site_config`   | 网站配置 JSON（首页 / 档案 / 直播 / 抽卡参数等）         |
| `songs`         | 普通歌单（分类 / 歌名 / 歌手）                           |
| `hidden_songs`  | 隐藏歌单（解锁后可见）                                   |

首次启动时若表不存在会自动创建。**旧版 `public/data.js` 的数据已迁移至 SQLite**,详见 [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)。

---

## 🌐 API 一览

### 公开接口

| 方法   | 路径                | 说明                                          |
| ------ | ------------------- | --------------------------------------------- |
| `GET`  | `/api/config`       | 读取 `site_config` / `songs` / `hidden_songs` |
| `POST` | `/api/generate`     | 生成兑换码（需 `itemId`）                     |
| `POST` | `/api/redeem`       | 核销兑换码（需 `code`）                       |
| `POST` | `/api/check_status` | 批量查询兑换码状态（`codes[]`）               |
| `POST` | `/api/increment`    | 抽卡一次，返回是否触发金光 + 新保底数         |
| `GET`  | `/api/getCount`     | 获取当前保底计数                              |

### 用户接口（`app/api/user/[action]` / `app/api/auth/[action]`）

| 路径                      | 功能                |
| ------------------------- | ------------------- |
| `POST /api/auth/register` | 注册（PBKDF2 哈希） |
| `POST /api/auth/login`    | 登录，返回 token    |
| `POST /api/user/save`     | 保存用户抽卡进度    |
| `POST /api/user/load`     | 加载用户抽卡进度    |

### Admin 接口（需 `ADMIN_PASSWORD` / `DEV_UNLOCK_PASSWORD`）

| 路径                     | 功能                                            |
| ------------------------ | ----------------------------------------------- |
| `POST /api/admin/save`   | 保存 site_config / songs / hidden_songs（事务） |
| `POST /api/admin/upload` | 上传图片到 `/public/memes` 或 `/public/pic`     |
| `POST /api/admin/unlock` | 隐藏内容解锁密码校验                            |

---

## 📁 目录结构

```
Next_UliUli/
├─ app/                           # Next.js App Router
│  ├─ page.tsx                    # 首页（Dashboard + 歌单 + 抽卡 + 视频）
│  ├─ layout.tsx                  # 根布局 + OG meta + 全局 CSS
│  ├─ globals.css                 # 霓虹色板 / 全局样式
│  ├─ admin/                      # 管理后台
│  │  ├─ page.tsx
│  │  ├─ types.ts
│  │  └─ components/              # 后台子表单
│  └─ api/
│     ├─ [action]/route.ts        # 公开接口：generate / redeem / increment 等
│     ├─ auth/[action]/           # 注册 / 登录
│     ├─ user/[action]/           # 用户数据保存 / 加载
│     ├─ admin/save/              # 后台保存配置
│     ├─ admin/upload/            # 图片上传
│     ├─ admin/unlock/            # 隐藏内容解锁
│     └─ config/                  # 读取 site_config + 歌单
├─ components/
│  ├─ Dashboard.tsx               # 主播档案 + 视频画廊
│  ├─ Effects.tsx                 # ThreeBackground + CustomCursor
│  ├─ ErrorBoundary.tsx
│  ├─ Gacha.tsx                   # 抽卡系统 UI
│  ├─ GameModal.tsx
│  ├─ SongSystem.tsx              # 歌单搜索 / 展示
│  ├─ UI.tsx                      # Toast / GoldenLuckModal 等
│  └─ namearena/                  # Name Arena 战斗 UI
├─ lib/
│  ├─ db.ts                       # sqlite3 初始化 + Promise 封装 + 哈希工具
│  └─ namearena/                  # 战斗引擎 / 技能 / 职业 / 数据
│     ├─ battleEngine.ts
│     ├─ skills.ts
│     ├─ jobs.ts
│     ├─ data.ts
│     ├─ core.ts
│     └─ types.ts
├─ public/                        # 静态资源（视频 / 图片 / 表情包）
│  ├─ video/                      # 1.mp4（公开）/ 2.mp4（隐藏）
│  ├─ memes/                      # 后台上传表情
│  └─ pic/                        # 后台上传图片
├─ legacy-unused/datajs-era/      # 旧 data.js 归档（已迁移到 SQLite）
├─ scripts/
├─ codes.db                       # 开发期的 SQLite 文件（已 gitignore）
├─ Dockerfile                     # 多阶段构建 + sqlite3 原生编译
├─ docker-compose.yml
├─ .env.example
├─ .nvmrc                         # Node 20
├─ MIGRATION_GUIDE.md             # data.js → SQLite 迁移说明
├─ SEO-CHECKLIST.md               # SEO / OG 配置清单
├─ next.config.ts
├─ postcss.config.mjs
├─ eslint.config.mjs
└─ tsconfig.json
```

---

## 🏗 部署

### 方式 A：Docker Compose（推荐）

```bash
docker compose up -d --build
```

`docker-compose.yml` 默认挂载:

- `./data` → `/app/data`(SQLite)
- `./public/memes` → `/app/public/memes`(上传表情)
- `./public/pic` → `/app/public/pic`(上传图片)

**生产前**请修改 `docker-compose.yml` 里的 `ADMIN_PASSWORD` / `DEV_UNLOCK_PASSWORD`(或改用 `.env` 文件)。

### 方式 B：1Panel 中构建 Dockerfile

仓库内 `Dockerfile`(node:20-bookworm-slim)已经处理好:

- 监听 `0.0.0.0:3000`
- 默认 `DATABASE_PATH=/app/data/codes.db`
- 声明 `VOLUME`:`/app/data` · `/app/public/memes` · `/app/public/pic`
- 构建阶段 `npm rebuild sqlite3 --build-from-source` 保证原生模块兼容

在 1Panel 中:

1. **环境变量**:至少设置 `ADMIN_PASSWORD`、`DEV_UNLOCK_PASSWORD`、`NEXT_PUBLIC_SITE_URL`
2. **端口映射**:容器 `3000` → 宿主机任意端口
3. **持久化卷挂载**(强烈建议,避免重建容器丢数据):
   - 宿主机目录 → `/app/data`
   - 宿主机目录 → `/app/public/memes`
   - 宿主机目录 → `/app/public/pic`

### 方式 C：裸机 Node

```bash
npm ci
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

Node 必须是 20.x。需要挂载 / 备份 `codes.db` 与 `public/memes`、`public/pic`。

### ⛔ 不推荐 Vercel / Netlify

`sqlite3` 依赖本地文件系统写入,Serverless 平台默认只读文件系统。上 Vercel 需把数据库换成 Turso / Neon 等托管 SQL。

---

## 🔄 常见开发任务

**修改主站文案 / 歌单:**

访问 `/admin` → 输入 `ADMIN_PASSWORD` → 表单编辑 → 保存(写入 SQLite)。

**上传图片 / 表情:**

在 Admin 内上传,文件落到 `public/memes/` 或 `public/pic/`,线上需挂载对应卷。

**调整抽卡概率:**

Admin 后台 → 抽卡配置 → 修改 `baseRate` / `maxRate` / `softPityStart` / `pityThreshold`。

**重置抽卡保底:**

```sql
-- 进入 SQLite
UPDATE global_config SET value = '0' WHERE key = 'pityCount';
```

**备份数据库:**

```bash
cp codes.db codes.db.$(date +%F).bak
```

---

## 📄 License

Private / 未公开(项目 `package.json` 中 `private: true`)。

---

## 🙏 鸣谢

- [Next.js](https://nextjs.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Three.js](https://threejs.org/) · [Framer Motion](https://www.framer.com/motion/) · [GSAP](https://gsap.com/)
- [sqlite3](https://github.com/TryGhost/node-sqlite3) · [sweetalert2](https://sweetalert2.github.io/) · [lucide-react](https://lucide.dev/)
