# UliUli · 虚拟主播站点 (new-website)

> 虚拟主播 **UliUli** 的单页展示与互动站点 —— **Next.js 16** (App Router) + **React 18** + **TypeScript** + **SQLite**。集成 Three.js 赛博朋克背景、可视化 Admin 后台、抽卡系统（保底/软保底）、兑换码、歌单管理、本地视频解锁、匿名发信箱 / Mail Topics，以及 **Name Arena + DGP** 双游戏模块。线上：<https://www.uliuli.cc>

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
- 🕹 **双游戏大厅**：`GameModal` 内置 **Name Arena** 与 **欲望大奖赛（DGP）** 两个入口，游戏大厅文案可在 Admin 的 `games` 配置中调整。
- ⚔️ **Name Arena**：`lib/namearena/` 下的文字战斗引擎（battleEngine / skills / jobs / data，独立子系统）。维护入口见 [`docs/NAMEARENA_MAINTENANCE.md`](docs/NAMEARENA_MAINTENANCE.md)。
- 🏁 **DGP（欲望大奖赛）**：`components/dgp/` + `lib/dgp/` 下的生存战斗模拟器，支持可选 `SIMULATION_SEED`；相同 seed + 相同初始阵容可复现同一场对局日志 / 回放。
- 👥 **用户系统**：注册 / 登录（PBKDF2 + salt）、token 保存抽卡进度到 SQLite。
- 📬 **匿名发信箱 MAIL_BOX**：基于 `@windchime/embed` 包集成的匿名留言系统。访客从主页左下 SpeedDial 投信，经 **Cloudflare Turnstile** 人机校验 + 前后端双层限流（fingerprint / IP）+ 敏感词过滤，进入后台 `/mail` 管理。所有访客可见文案可在 Admin `/admin · 发信箱` tab 自由编辑。
- 🎂 **主题收件箱（Mail Topics）**：主播为生日 / 周年 / 节日等活动开独立投信主题（公开路径 `/m/{slug}`），内置 5 种状态派生（常驻 / 进行中 / 未开始 / 已结束 / 已归档）、管理台主题 Tab 栏 + `📁 往期活动` 归档抽屉、全站顶部 `GlobalMailBanner` 活动横幅。详见 [主题收件箱](#-主题收件箱mail-topics-子系统) 章节。
- 🐳 **一键 Docker**：内置 `Dockerfile` + `docker-compose.yml`，含原生模块 `sqlite3` 的 `npm rebuild --build-from-source`。

---

## 🧱 技术栈

| 层面      | 技术                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| 框架      | **Next.js 16.2.3** (App Router + Turbopack) · **React 18** · **TypeScript 5** |
| 样式      | **Tailwind CSS 4** (`@tailwindcss/postcss`) · 自定义 CSS 变量霓虹色板         |
| 动画 / 3D | **Framer Motion 11** · **GSAP 3** · **Three.js 0.183**                        |
| 图标 / UI | **lucide-react** · **sweetalert2**（弹窗）                                    |
| 邮箱组件  | **@windchime/embed 0.3.1**（本地 tgz）· **Cloudflare Turnstile**（可选）      |
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

| 命令                 | 说明                                                    |
| -------------------- | ------------------------------------------------------- |
| `npm run dev`        | 启动开发服务器（Turbopack）                             |
| `npm run dev:mobile` | 启动开发服务器并监听 `0.0.0.0`（便于手机 / 局域网调试） |
| `npm run build`      | 生产构建                                                |
| `npm run start`      | 启动生产服务（需先 `npm run build`）                    |
| `npm run lint`       | ESLint 9 代码检查                                       |
| `npm run test:namearena` | Name Arena 快速回归 + 规则契约校验                  |
| `npm run test:namearena:stress` | Name Arena 大型特殊角色组合压力测试          |
| `npm run test:namearena:compare` | Name Arena 重构前后 A/B 日志对比工具         |
| `npm run clean`      | 清理 `.next` / `out` / `build` / `node_modules`         |

---

## 🔐 环境变量

`.env.local`(本地)、`.env`(Docker Compose)或 1Panel 应用环境变量:

```bash
# 必填：后台管理员密码（用于 /api/admin/save、/api/admin/upload）
ADMIN_PASSWORD=change_me_to_a_strong_password

# 可选：发信箱后台 /mail 独立密码；不填则回退到 ADMIN_PASSWORD
MAIL_AUTH_PASSWORD=

# 必填：隐藏内容解锁密码（用于 /api/admin/unlock，解锁隐藏视频/歌单）
DEV_UNLOCK_PASSWORD=change_me_to_a_dev_unlock_password

# 必填：SQLite 文件路径
#   本地：  ./data/codes.db
#   Docker：/app/data/codes.db
DATABASE_PATH=./data/codes.db

# Docker Compose 宿主机端口；默认只绑定 127.0.0.1，避免绕过反代直连 Node
HOST_PORT=3000

# 必填：公开站点地址（用于 Open Graph 分享卡片）
NEXT_PUBLIC_SITE_URL=https://www.uliuli.cc

# ============== 发信箱 MAIL_BOX 相关 ==============
# 必填：发送者指纹 hash 的盐值。改了之后老留言的 senderLabel/senderHash 会变，
# 但不影响功能运行。换服务器或首次部署时请改成一段随机字符串。
WINDCHIME_HASH_SALT=change_me_to_a_long_random_string

# 可选：Cloudflare Turnstile（人机校验）——留空则跳过校验，发布到公网强烈建议启用
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
```

> ⚠️ 生产环境务必修改 `ADMIN_PASSWORD` / `DEV_UNLOCK_PASSWORD`；若希望 `/mail` 独立口令，再额外设置 `MAIL_AUTH_PASSWORD`。请勿把 `.env.local` 或生产 `.env` 提交到仓库。

---

## 🗄 数据库结构（`lib/db.ts` 自动建表）

| 表                     | 作用                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `users`                | 用户注册 / 登录 / token / 抽卡进度 JSON（PBKDF2 + salt）                                                                 |
| `gift_codes`           | 兑换码（`code` 主键 / `item_id` / `status`）                                                                             |
| `global_config`        | 全局 KV（目前存 `pityCount` 抽卡保底计数）                                                                               |
| `site_config`          | 网站配置 JSON（首页 / 档案 / 直播 / 抽卡参数等，含 `version` / `updated_by` 审计字段）                                   |
| `site_config_history`  | 每次保存前自动写入的旧版本快照（用于协作防误覆盖后的恢复）                                                               |
| `songs`                | 普通歌单（分类 / 歌名 / 歌手）                                                                                           |
| `hidden_songs`         | 隐藏歌单（解锁后可见）                                                                                                   |
| `mail_messages`        | 匿名来信（text / nickname / linkUrl / senderFingerprint / isRead / isFavorited / **topic_id**）                          |
| `mail_topics`          | 活动主题（slug / title / description / note / is_default / is_enabled / starts_at / ends_at / archived_at / sort_order） |
| `mail_blocked_senders` | 拉黑的 senderFingerprint / IP 黑名单（后台可维护）                                                                       |
| `mail_blocked_terms`   | 敏感词列表（命中后来信 API 直接 422，不写库）                                                                            |
| `mail_settings`        | 发信箱开关状态 KV（后台 `/mail` 页面的 `ONLINE/OFFLINE` 切换）                                                           |

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

### 邮箱接口（`app/api/mail/*`）

公开（访客可用）：

| 方法   | 路径                          | 说明                                                                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/mail/settings`          | 读取开关状态（`enabled: boolean`）；前端关闭态按灰 SpeedDial                                           |
| `POST` | `/api/mail/messages`          | 投信（text + 可选 nickname / linkUrl / **topicSlug**），Turnstile + 限流 + 敏感词 + 主题状态校验后入库 |
| `GET`  | `/api/mail/topics`            | 当前可投信的活动主题列表（仅 `is_enabled=1` AND 非归档 AND 在时间窗内 AND `is_default=0`）             |
| `GET`  | `/api/mail/topics/[idOrSlug]` | 单个主题的公开字段（`/m/{slug}` SSR 预取用；不返回 `note` 等内部字段）                                 |

后台（请求头 `X-Mail-Password` = `MAIL_AUTH_PASSWORD`；未配置时回退到 `ADMIN_PASSWORD`）：

| 方法     | 路径                                      | 说明                                                                                                       |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/mail/messages`                      | 列序列表（分页 · 支持 `?topicId=` 按主题过滤）                                                             |
| `PATCH`  | `/api/mail/messages/[id]`                 | 标已读 / 收藏                                                                                              |
| `DELETE` | `/api/mail/messages/[id]`                 | 删除                                                                                                       |
| `POST`   | `/api/mail/messages/batch`                | 批量删除 / 批量已读                                                                                        |
| `GET`    | `/api/mail/blocklist`                     | 黑名单列表                                                                                                 |
| `DELETE` | `/api/mail/blocklist/[senderFingerprint]` | 移除黑名单条目                                                                                             |
| `GET`    | `/api/mail/blocked-terms`                 | 敏感词列表                                                                                                 |
| `PUT`    | `/api/mail/blocked-terms`                 | 全量替换敏感词库                                                                                           |
| `PATCH`  | `/api/mail/settings`                      | 切换 ONLINE/OFFLINE                                                                                        |
| `GET`    | `/api/mail/topics`                        | 列全部主题（管理端附带 `unreadCount` / `flaggedCount` / 派生 `state`）；`?include=archived` 控制是否含归档 |
| `POST`   | `/api/mail/topics`                        | 新建主题（slug 校验 `[a-z0-9-]` 唯一 + 时间窗合理性）                                                      |
| `GET`    | `/api/mail/topics/[idOrSlug]`             | 主题详情（管理端返回含 `note` 等全字段）                                                                   |
| `PATCH`  | `/api/mail/topics/[idOrSlug]`             | 更新主题字段 / 开关 / 时间窗；`archivedAt: null` 用于恢复归档                                              |
| `DELETE` | `/api/mail/topics/[idOrSlug]`             | 归档主题（写入 `archived_at`；默认主题不可归档）                                                           |

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
│  ├─ GameModal.tsx               # 游戏大厅 Modal（Name Arena + DGP）
│  ├─ SongSystem.tsx              # 歌单搜索 / 展示
│  ├─ UI.tsx                      # Toast / GoldenLuckModal 等
│  ├─ dgp/                        # DGP setup / battle / replay UI
│  └─ namearena/                  # Name Arena 战斗 UI
├─ lib/
│  ├─ db.ts                       # sqlite3 初始化 + Promise 封装 + 哈希工具
│  ├─ dgp/                        # DGP 引擎 / 数据 / RNG / 类型
│  │  ├─ engine.ts
│  │  ├─ data.ts
│  │  ├─ logic.ts
│  │  ├─ core.ts
│  │  ├─ constants.ts
│  │  ├─ rng.ts
│  │  └─ types.ts
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
├─ data/codes.db                  # 开发期的 SQLite 文件（已 gitignore）
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

### 📬 发信箱子系统追加路径

```
├─ components/mail/                  # 访客 / 管理台 / 主题子系统共享组件
│  ├─ MailSpeedDial.tsx              # 主页左下浮动入口
│  ├─ MailSendModal.tsx              # 常规信箱投信弹窗（包裹 WindChimeSender）
│  ├─ MailAuthGate.tsx               # /mail 后台密码门
│  ├─ BlockedTermsPanel.tsx          # 敏感词管理面板
│  ├─ FlaggedMailPanel.tsx           # 被标记可疑来信
│  ├─ mail-theme.ts                  # WindChime 组件赛博朋克主题映射
│  ├─ GlobalMailBanner.tsx           # 全站顶部活动公告条（有活动时自动挂载）
│  ├─ MailTopicTabs.tsx              # /mail 管理台主题 Tab 栏（按状态染色 + badge）
│  ├─ NewTopicModal.tsx              # 新建主题表单（slug / title / 时间窗）
│  ├─ ArchivedTopicsDrawer.tsx       # 📁 往期活动抽屉（搜索 / 年份分组 / 恢复）
│  ├─ ArchiveConfirmModal.tsx        # 归档二次确认弹窗
│  ├─ TopicMailForm.tsx              # /m/{slug} active 状态投信页 UI
│  ├─ TopicStatePage.tsx             # /m/{slug} ended / disabled / scheduled 状态页
│  ├─ mail-time.ts                   # 北京时间格式化（跨客户端/SSR 一致）
│  └─ mail-topic-types.ts            # Topic / state 前后端共享 TS 类型
├─ app/mail/page.tsx                 # 后台管理页（主播登录后用）
├─ app/m/                            # 公开访客侧活动主题路由（force-dynamic）
│  ├─ page.tsx                       # 活动聚合列表页（/m）
│  └─ [slug]/page.tsx                # 单活动投信页 / 状态分发（/m/{slug}）
├─ app/api/mail/                     # 邮箱 REST 接口（见上方表）
│  ├─ messages/                      # 投信 / 列表 / 批量 / 标记
│  ├─ topics/                        # 主题 CRUD（route.ts + [id]/route.ts）
│  ├─ blocklist/                     # 黑名单
│  ├─ blocked-terms/                 # 敏感词
│  └─ settings/                      # 发信箱总开关
├─ lib/mail-auth.ts                  # mail 后台密码校验 + IP 锁定
├─ lib/mail-rate-limit.ts            # IP + fingerprint 双重限流
├─ lib/mail-turnstile.ts             # Cloudflare Turnstile 服务端校验
├─ lib/mail-sfx.ts                   # Web Audio 合成的 SIGNAL SENT 音效
├─ lib/mail-topics.ts                # 主题 CRUD + 状态派生 + 时间窗校验（Mail Topics 核心服务层）
├─ vendor/windchime-embed-0.3.1.tgz  # 本地 tarball，不发布到 npm
├─ bin/upgrade.sh                    # VPS 升级脚本（备份 DB + 生成 salt）
└─ proxy.ts                          # SEO noindex 头控制
```

## 🏗 部署

### 方式 A：Docker Compose（推荐）

```bash
cp .env.example .env
# 编辑 .env，至少设置 ADMIN_PASSWORD / DEV_UNLOCK_PASSWORD / WINDCHIME_HASH_SALT
docker compose up -d --build
```

`docker-compose.yml` 默认挂载:

- `./data` → `/app/data`(SQLite)
- `./public/memes` → `/app/public/memes`(上传表情)
- `./public/pic` → `/app/public/pic`(上传图片)

`docker-compose.yml` 默认只把容器端口绑定到 `127.0.0.1:${HOST_PORT:-3000}`，生产建议让 1Panel/OpenResty/Nginx 反代到这个本地端口，不要把 Node 的 3000 端口直接暴露到公网。

### 方式 B：1Panel 中构建 Dockerfile

仓库内 `Dockerfile`(node:20-bookworm-slim)已经处理好:

- 监听 `0.0.0.0:3000`
- 默认 `DATABASE_PATH=/app/data/codes.db`
- 声明 `VOLUME`:`/app/data` · `/app/public/memes` · `/app/public/pic`
- 构建阶段 `npm rebuild sqlite3 --build-from-source` 保证原生模块兼容

在 1Panel 中:

1. **环境变量**:至少设置 `ADMIN_PASSWORD`、`DEV_UNLOCK_PASSWORD`、`NEXT_PUBLIC_SITE_URL`；如需单独保护 `/mail`，再设置 `MAIL_AUTH_PASSWORD`
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

**体验 DGP 可复现对局:**

打开主站游戏大厅 → 进入 **DGP** → 添加至少 2 名骑士 → 选填 `SIMULATION_SEED` → Start。相同 seed + 相同初始阵容会生成一致的战斗流程，适合调试、分享与回放验证。

**调整抽卡概率:**

Admin 后台 → 抽卡配置 → 修改 `baseRate` / `maxRate` / `softPityStart` / `pityThreshold`。

**重置抽卡保底:**

```sql
-- 进入 SQLite
UPDATE global_config SET value = '0' WHERE key = 'pityCount';
```

**备份数据库:**

```bash
npm run db:backup
```

**切换发信箱开关 / 读信:**

访问 `/mail`（密码 = `MAIL_AUTH_PASSWORD`；未配置时回退到 `ADMIN_PASSWORD`）。页面顶部开关控制 `ONLINE/OFFLINE`，卡片格列表展示来信、收藏、拉黑、删除、敏感词维护。内嵌分享海报编辑器（WindChime QR Poster）生成二维码卡片。

**新建活动主题 / 归档往期活动:**

进 `/mail` → 主题 Tab 栏右侧 `+ 新建主题` → 填 slug（`[a-z0-9-]`）/ 标题 / 简介 / 时间窗 → 保存。需要结束活动时：该主题 Tab 右上角 `待归档` 图标一键归档；查看过往活动走右侧 `📁 往期活动` 抽屉（支持搜索 + 按年份分组 + 恢复）。

---

## 🏁 DGP（欲望大奖赛）子系统

> 当前版本已接入 **deterministic seeded RNG**，DGP 不只是能玩，也更适合复盘、调试与后续测试。

### 入口与 UI

- **入口位置**：主页 `GameModal` 的 `DGP` 卡片。
- **主要文件**：`components/dgp/DgpGame.tsx`
- **玩法流程**：添加骑士 → 可选填写 `SIMULATION_SEED` → Start → 观看逐条播放的战斗日志与 HUD 回放。

### 引擎结构

- **核心引擎**：`lib/dgp/engine.ts`
- **数据与规则**：`lib/dgp/data.ts`、`lib/dgp/logic.ts`、`lib/dgp/constants.ts`
- **工具与类型**：`lib/dgp/core.ts`、`lib/dgp/rng.ts`、`lib/dgp/types.ts`
- **详细文档**：[`lib/dgp/README.md`](./lib/dgp/README.md)（包含玩法、回合流程、装备体系、事件、场地、ID Core、带扣与实现细节）

### 当前版本的关键升级

- **可选 seed 开局**：`DgpGame` 允许输入 `SIMULATION_SEED`，并在启动日志中显示 `REPLAY_SEED`。
- **引擎级确定性**：`DgpEngine(initialPlayers, seed?)` 将战斗中的随机流程统一接到 `SeededRNG`。
- **回放一致性提升**：引擎内原先依赖 `Math.random()` / `Date.now()` 的关键随机点与实体 ID 已改为实例 RNG 驱动，减少“同配置但不同结果”的漂移。
- **适合调试与分享**：同一 seed + 同一初始阵容可以稳定复现同一场战斗过程，便于排查平衡性、复盘精彩对局、以及验证改动是否影响结果。

### DGP 对开发者的价值

- **调试更稳**：复现 battle log / stage event / buckle 掉落相关问题时，不再依赖“运气刚好再现一次”。
- **测试更友好**：后续给纯逻辑函数补测试时，可以基于固定 seed 做 snapshot / regression 验证。
- **文档更清晰**：`constants.ts` 与 `rng.ts` 把数值常量和随机策略从超大引擎文件里显式抽离出来，后续继续拆模块更容易。

---

## 📬 匿名发信箱（Mail 子系统）

### 架构

```
 访客浏览器                                     主播
─────────                                    ────
  app/page.tsx                                  /admin · Mail tab
    └─ <MailSpeedDial                                 │
         texts={siteConfig?.mail} />                   │ (编辑 13 个文案)
            └─ <MailSendModal                             ▼
                 texts={...}                   POST /api/admin/save
                 onSubmit→POST /api/mail/messages            │
                 (Turnstile + 限流 + 敏感词)                 ▼
                   └─ 写库 mail_messages              site_config.mail (SQLite)
                                                              │
 主播打开 /mail (MAIL_AUTH_PASSWORD 或 ADMIN_PASSWORD)         │
   └─ <WindChimeAdminPanel />                           GET /api/config
        └─ GET /api/mail/messages                              ▲
             PATCH 标已读/收藏                         前端 15s 轮询
             DELETE / POST batch
```

### 关键组件

- **`MailSpeedDial`**（`components/mail/MailSpeedDial.tsx`）：主站左下收纳式 Speed Dial。轮询 `/api/mail/settings` 得知开关状态，关闭时子按钮置灰。
- **`MailSendModal`**（`components/mail/MailSendModal.tsx`）：包裹 `WindChimeSender`。投信后调 `/api/mail/messages`、播放 Web Audio 合成音效、`AUTO_CLOSE_MS=1800` 后自动关窗。
- **`WindChimeAdminPanel`**（来自 `@windchime/embed` 包）：后台卡片列表。包内部写死的 `🎐 风铃来信` 等字样在 `app/globals.css` 中被 **宿主侧 CSS `mask-image` + lucide SVG data URI** 重绘成 `TRANSMISSION · 来信` + lucide Inbox/Heart/Mail——详见 `──去风铃化` 那一大块注释。
- **Admin Mail Tab**（`/admin`）：在 `SiteConfig.mail` 下维护 13 个访客可见文案（按钮标题 / tooltip / 卡片标题 / placeholder / success / paused 等）。后台 `/mail` 页面的字样（INBOX、BLOCKLIST、SECURITY 等）**未**接入可编辑配置（只有主播自己看、无必要）。

### —— 去风铃化

`@windchime/embed` 包内硬编码了 `🎐`、`风铃`、`WindChime`、`★/☆`、`挂上风铃` 等字样和 emoji，props/theme 都盖不到。UliUli 在 `app/globals.css` 末尾书写一大块规则：

- 作用域限定 `[data-widget="windchime-sender"]` / `[data-widget="windchime-admin"]`，海报 canvas 不受影响
- 用 CSS 变量存放 inline 的 lucide SVG（`--lucide-mail` / `--lucide-heart-fill` / `--lucide-send` 等 10 个）
- 用 `mask-image` + `background-color: currentColor` 打包成可着色的单色图标
- 用 `font-size: 0` + `::before { content: "..." }` 抖掉文字再覆盖
- 满網 lucide：Mail / Inbox / Heart（空/实心）/ Send / Link / CheckCheck / Ban / Trash

### 主播后台 `/mail` 开关和操作

- 打开 `/mail` 页面，密码 = `MAIL_AUTH_PASSWORD`（未配置时回退到 `ADMIN_PASSWORD`）
- 顶部开关控制访客端是否能看见 SpeedDial 发信入口
- 卡片列表：收藏·拉黑·标已读·删除 4 种操作，底部按钮已換成赛博朋克风格 + lucide 图标
- 侧边面板：黑名单·敏感词·被标记的可疑来信
- 底部分享区：`WindChimeQrCard` + `WindChimeQrPosterEditor` 自行生成海报（海报按用户需求保留 WindChime 风铃装饰）

### 扩展程序

- 想换 `@windchime/embed` 版本：更新 `vendor/windchime-embed-0.x.y.tgz`，同步改 `package.json` 的 `file:./vendor/...` 指向
- 想扩展邮箱表或 API：函数入口都在 `app/api/mail/*`，数据库模型在 `lib/db.ts` 的 `initDb()` 部分（内嵌 `CREATE TABLE IF NOT EXISTS mail_*`）

---

## 🎂 主题收件箱（Mail Topics 子系统）

> 2026-04 版本加入，为活动式投信场景（生日 / 周年 / 节日）提供独立于常规信箱的完整子系统。常规信箱不受影响、老数据零迁移代价。

### 三级 URL 层级

```
/               ← 主站（常规信箱走左下 SpeedDial，不走 /m）
/m              ← 活动聚合页（列出所有当前可投信的活动卡片）
/m/{slug}       ← 单活动页（投信 / 状态 / 归档均走此路径）
```

- **全站顶部横幅** `GlobalMailBanner`：有活动时自动挂到所有页面顶部，1 个活动直链 `/m/{slug}`，≥ 2 个活动跳 `/m` 聚合页
- 横幅支持 × 关闭，localStorage 记录当前活动集合的 signature；新开活动导致 signature 变化时重新显示，避免永久屏蔽
- 返回按钮层级：`/m/{slug}` →「返回活动列表」→ `/m` →「返回主站」→ `/`（不会从活动页一步跳回主站）

### 主题的 5 种状态

状态由现有字段在读取时**派生**，不占额外 DB 列：

| 状态       | 条件                                                                      | 主 Tab 栏             | 📁 往期活动抽屉 |
| ---------- | ------------------------------------------------------------------------- | --------------------- | --------------- |
| **常驻**   | `is_default=1`                                                            | ✅ 永远最左，不可归档 | —               |
| **进行中** | `is_enabled=1` AND `now ∈ [starts_at, ends_at]` AND `archived_at IS NULL` | ✅ 高亮               | —               |
| **未开始** | `is_enabled=1` AND `now < starts_at` AND `archived_at IS NULL`            | ✅ 冷色虚线           | —               |
| **已结束** | `now > ends_at` AND `archived_at IS NULL`                                 | ✅ 灰底 + 待归档提示  | —               |
| **已归档** | `archived_at IS NOT NULL`                                                 | ❌                    | ✅              |

API 端：`GET /api/mail/topics` 返回时，列表中每个主题都会附加 `state` 字段供前端直接染色 / 分组 / 排序，避免前端自己算时间窗。

### 管理台 UX（`/mail`）

- **主题 Tab 栏**（`MailTopicTabs`）：参考 `AdminTabsNav.tsx` 的 `flex-wrap` 风格平铺，每个 tab 带标题 + 未读 badge + 状态着色
- **`+ 新建主题`**（`NewTopicModal`）：slug 自动校验唯一 + `[a-z0-9-]`，时间窗合理性校验
- **`📁 往期活动 (N)`**（`ArchivedTopicsDrawer`）：抽屉式归档列表，按年份分组，支持搜索 / 查看信件 / 恢复（清空 `archived_at`）
- **已结束 tab 上 `待归档` 小图标**：`ArchiveConfirmModal` 二次确认后直接归档，不用进入主题内部
- 多个已结束时顶部出现 `一键归档全部 →` 提示，防止 tab 栏堆积

### 访客 UX（`/m/{slug}`）

服务端按主题状态动态分发渲染组件（`app/m/[slug]/page.tsx:resolveVariant`）：

- `active` → `<TopicMailForm>` 投信表单（带活动 banner + 截止时间；indexable）
- `ended` / `disabled` / `scheduled` → `<TopicStatePage>` 友好提示页（HTTP 200 + noindex）
- `isDefault=1` → `redirect('/')`（常规信箱走首页 SpeedDial，不给第二入口）
- `slug` 不存在 → `notFound()` 走 Next 默认 404

`<TopicStatePage>` 的 `scheduled` 状态自带倒计时组件；`ended` 时显示 `活动已于 XXX 结束` 文案。

### 安全原则

- **主题绑定 URL**：`topicSlug` 只从 URL 路径参数 → `WindChimeSender` props → API body 传递，**从不在表单里提供选择控件**，杜绝访客误发或篡改
- **服务端二次校验**：`POST /api/mail/messages` 收到非 default 的 `topicSlug` 时，服务端再次查 DB 校验 `is_enabled` + 时间窗 + 未归档状态，避免前端缓存污染
- **写入保护**：`POST /api/mail/topics` 剥离客户端传入的 `id` / `is_default` / `created_at`，服务端自己生成

### Force Dynamic 防坑 ⚠

`app/m/page.tsx` 和 `app/m/[slug]/page.tsx` 必须声明 `export const dynamic = 'force-dynamic'`。

原因：这两页都是 **Server Component + 直接查 SQLite**，Next.js 默认会在 `next build` 时把静态路由预渲染一次。线上 Docker 镜像构建阶段 DB 为空，导致 `/m` 在生产环境永远返回「当前没有进行中的活动」。`GlobalMailBanner` 是 Client Component + runtime fetch，不受影响。

改动新文件时请保留这一行，或同时设置 `revalidate = 0`。

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS mail_topics (
  id           TEXT PRIMARY KEY,           -- UUID
  slug         TEXT UNIQUE NOT NULL,       -- URL 片段，[a-z0-9-]，default 主题 slug='default'
  title        TEXT NOT NULL,
  description  TEXT,                       -- 访客可见
  note         TEXT,                       -- 内部备注，仅管理端返回
  is_default   INTEGER NOT NULL DEFAULT 0, -- 只有 1 行 is_default=1（启动时自举）
  is_enabled   INTEGER NOT NULL DEFAULT 1,
  starts_at    TEXT,                       -- ISO 8601，NULL = 立即生效
  ends_at      TEXT,                       -- ISO 8601，NULL = 永久
  archived_at  TEXT,                       -- NULL = 未归档
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

ALTER TABLE mail_messages ADD COLUMN topic_id TEXT REFERENCES mail_topics(id);
```

启动时 `lib/db.ts` 自动建表并写入一条 `is_default=1` 的 `default` 行，历史 `mail_messages` 的 `topic_id` 以迁移脚本回填为 default 主题的 id，保证旧数据可在新管理台「常规信箱」tab 里继续看到。

### 设计文档

完整设计 / 决策过程 / 8 个产品 Q&A 拍板记录见仓库根目录的 [`MAIL_TOPICS_PROPOSAL.md`](./MAIL_TOPICS_PROPOSAL.md)。新增 / 调整功能前建议先读该文档的 §6（UX）和 §9（已拍板问题）。

---

## 📄 License

Private / 未公开(项目 `package.json` 中 `private: true`)。

---

## 🙏 鸣谢

- [Next.js](https://nextjs.org/) · [Tailwind CSS 4](https://tailwindcss.com/) · [Three.js](https://threejs.org/) · [Framer Motion](https://www.framer.com/motion/) · [GSAP](https://gsap.com/)
- [sqlite3](https://github.com/TryGhost/node-sqlite3) · [sweetalert2](https://sweetalert2.github.io/) · [lucide-react](https://lucide.dev/)
