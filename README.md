# Next_UliUli

UliUli 的个人站点和互动系统。项目基于 Next.js App Router，包含主页展示、后台配置、歌单、抽卡/兑换码、匿名发信箱、B 站数据代理，以及两个站内小游戏系统。

线上地址：https://www.uliuli.cc

这是一个应用仓库，不是可复用 npm 包。生产环境按单个 Next.js 服务部署，SQLite 数据库和上传目录需要持久化。

## 技术栈

- Next.js 16.2.9, React 18, TypeScript
- Tailwind CSS 4
- SQLite (`sqlite3`)
- Three.js, GSAP, Framer Motion
- Docker / Docker Compose
- Node.js 20.x

## 主要功能

- 首页展示、视频、歌单、社交链接、PWA metadata 和 SEO 路由。
- 后台管理站点配置、歌单、上传资源、发信箱设置和活动主题。
- 服务端接管的抽卡系统，包含用户账号、兑换码、本地进度一次性导入和打包资格校验。
- 匿名发信箱，支持 Turnstile、发信人拉黑、敏感词、图片代理、活动主题页和后台审核。
- `/api/bilibili` 站内代理，带短缓存、超时处理和上一次成功数据兜底。
- Name Arena 文字战斗系统，代码位于 `lib/namearena` 和 `components/namearena`。
- DGP 战斗模拟器，代码位于 `lib/dgp` 和 `components/dgp`。
- SQLite migration、数据库备份脚本和 `/api/health` 健康检查。

## 运行要求

- Node.js 20.x
- npm 10+
- 可持久化的文件系统，用于保存 `data/codes.db`
- 生产环境建议使用 Docker，因为 `sqlite3` 是原生依赖

不要直接换到 Node 22，除非已经在目标机器上重新验证过 `sqlite3`。

## 本地开发

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

常用入口：

- 主站：http://localhost:3000
- 后台：http://localhost:3000/admin
- 发信箱后台：http://localhost:3000/mail
- 健康检查：http://localhost:3000/api/health

## 环境变量

复制 `.env.example` 后再修改密钥。生产环境不要直接使用示例值。

核心变量：

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | 后台 API 和后台 session 登录密码。 |
| `DEV_UNLOCK_PASSWORD` | 隐藏内容解锁密码。 |
| `DATABASE_PATH` | SQLite 数据库路径。本地默认 `./data/codes.db`，Docker 中为 `/app/data/codes.db`。 |
| `NEXT_PUBLIC_SITE_URL` | 公开站点地址，用于 metadata、sitemap 和分享卡片。 |
| `WINDCHIME_HASH_SALT` | 匿名发信人指纹 hash 的盐值。生产环境应设置稳定随机值。 |
| `BILIBILI_API_URL` | B 站数据代理的服务器侧上游地址。 |

常用可选变量：

| 变量 | 说明 |
| --- | --- |
| `MAIL_AUTH_PASSWORD` | `/mail` 独立密码；留空时回退到 `ADMIN_PASSWORD`。 |
| `HOST_PORT` | Docker Compose 暴露到宿主机的端口，默认 `3000`。 |
| `DB_BACKUP_DIR` | 备份输出目录。默认是数据库旁边的 `backups` 目录。 |
| `DB_BACKUP_RETENTION` | 保留的 SQLite 备份数量，默认 `20`。 |
| `DB_BACKUP_MAX_AGE_HOURS` | `/api/health` 允许的最大备份年龄，默认 `48`。 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key。 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret。 |
| `MAIL_BLOCKED_TERMS` | 数据库无敏感词记录时使用的初始敏感词，英文逗号分隔。 |
| `BILIBILI_CACHE_TTL_SECONDS` | 代理缓存秒数，默认 `180`。 |
| `BILIBILI_FETCH_TIMEOUT_MS` | 上游请求超时毫秒数，默认 `8000`。 |
| `BILIBILI_REFRESH_ERROR_BACKOFF_SECONDS` | 上游失败后的刷新退避秒数，默认 `60`。 |

不要提交 `.env.local`、生产 `.env`、`data/codes.db` 或生成的备份文件。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器。 |
| `npm run dev:mobile` | 监听 `0.0.0.0`，便于局域网或手机调试。 |
| `npm run build` | 生产构建。 |
| `npm run start` | 启动已构建的 Next.js 服务。 |
| `npm run lint` | 运行 ESLint。 |
| `npm run db:migrate` | 对当前 SQLite 数据库应用 migration。 |
| `npm run db:backup` | 创建 SQLite 备份，并按保留策略清理旧备份。 |
| `npm run gacha:migrate` | 运行 DB migration 并迁移旧抽卡数据。 |
| `npm run test:namearena` | 运行 Name Arena 回归和规则契约测试。 |
| `npm run test:namearena:stress` | 运行特殊角色大型压力测试。 |
| `npm run test:namearena:compare` | 对比两个项目目录的 Name Arena 战斗日志。 |
| `npm run clean` | 删除 `.next`、`out`、`build` 和 `node_modules`。 |

## 数据库

应用使用单个 SQLite 数据库。本地默认路径是 `data/codes.db`。

修改表结构前：

1. 在 `migrations/` 下新增 SQL 文件。
2. migration id 保持可排序，例如 `202606230001_example.sql`。
3. 运行 `npm run db:migrate`。
4. 生产部署或手动操作数据库前，先运行 `npm run db:backup`。

migration runner 会把已应用记录写入 `schema_migrations`。备份脚本使用 SQLite `VACUUM INTO`，生成带 SHA-256 的 JSON manifest，把 `db.last_backup` 写入 `global_config`，并按 `DB_BACKUP_RETENTION` 清理旧备份。

## 生产部署

推荐使用 Docker Compose。

```bash
cp .env.example .env
# 修改 .env
docker compose up -d --build
docker compose exec website npm run db:migrate
```

Compose 会挂载以下持久化目录：

- `./data:/app/data`
- `./public/memes:/app/public/memes`
- `./public/pic:/app/public/pic`

这些目录属于应用状态。部署时不要删除或覆盖，除非已经确认有可用备份。

已有线上容器时，推荐部署流程：

```bash
git pull
docker compose exec website npm run db:backup
docker compose up -d --build
docker compose exec website npm run db:migrate
curl -fsS http://127.0.0.1:${HOST_PORT:-3000}/api/health
```

如果不是 Docker 部署，使用 Node 20，执行 `npm ci`、`npm run build`、`npm run db:migrate`，再用 `npm run start` 启动。

## 目录结构

```text
app/                    Next.js 路由、页面、metadata 和 API handlers
components/             React UI 组件
components/mail/        发信箱和活动主题 UI
components/namearena/   Name Arena UI
components/dgp/         DGP UI
lib/                    服务端工具和领域逻辑
lib/namearena/          Name Arena 战斗引擎、技能和角色 hooks
lib/dgp/                DGP 战斗模拟器
migrations/             SQLite migration 文件
scripts/                数据库、备份、迁移和测试脚本
docs/                   维护文档
public/                 静态资源和上传目录
data/                   本地 SQLite 数据库和备份；git 忽略
vendor/                 npm install 使用的本地 tarball
```

## API 分组

一般使用 UI，不直接调用 API。主要路由分组：

- `app/api/config`：公开站点配置。
- `app/api/admin/*`：后台 session、配置保存、上传和解锁。
- `app/api/auth/*`、`app/api/user/*`：注册、登录和用户进度。
- `app/api/gacha/*`：抽卡状态、抽卡、兑换、打包检查、重置和本地进度一次性导入。
- `app/api/mail/*`：投信、主题、后台审核、黑名单、设置和图片代理。
- `app/api/bilibili`：B 站上游代理。
- `app/api/health`：数据库、配置和备份健康检查。

## Name Arena 维护

Name Arena 的战斗逻辑状态很多，修改前后需要单独跑回归和压力测试。

修改战斗逻辑前至少运行：

```bash
npm run test:namearena
npm run test:namearena:stress
```

如果是行为保持型重构，用 compare runner 对照一个基线目录：

```bash
node scripts/namearena-compare-logs.js <baselineRoot> <currentRoot> <reportPath>
```

更多说明见 `docs/NAMEARENA_MAINTENANCE.md`。

## 相关文档

- `TECHNICAL_ARCHITECTURE.md`：系统架构说明。
- `MIGRATION_GUIDE.md`：旧数据迁移说明。
- `docs/NAMEARENA_MAINTENANCE.md`：Name Arena 维护和测试策略。
- `SEO-CHECKLIST.md`：SEO 检查清单。
- `.env.example`：环境变量默认值和注释。

## 提交前检查

普通代码改动：

```bash
npm run lint
npx tsc --noEmit
npm run build
```

数据库改动额外运行：

```bash
npm run db:migrate
npm run db:backup
```

Name Arena 改动额外运行：

```bash
npm run test:namearena
npm run test:namearena:stress
```
