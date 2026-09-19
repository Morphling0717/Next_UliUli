# 风铃接入与升级

本分支固定接入 `@windchime/embed@0.8.0`。投稿、查询、已读、收藏、审核、屏蔽、词库、话题和归档由风铃维护，网站保留原有页面、HTML、图标、样式、动画和登录。

当前 `/mail` 提供全站桌面连接密钥；旧话题密钥权限不变，`/mail/live` 仅重定向到 `/mail`。敏感词默认关闭，开关只在桌面端。完整使用和安全升级步骤见 [风铃 0.8.0 网站与桌面连接](WINDCHIME-LIVE.md)。六种展示排版、图片固定、长信文字滚动、磁贴和热键需搭配新版桌面；本轮验证见 [0.8.0 升级记录](WINDCHIME-080-UPGRADE.md)。仓库依赖更新不代表生产环境已经部署。

历史共享服务和桌面的 [0.7.0 总验收报告](https://github.com/Morphling0717/WindChime/blob/codex/live-broadcast/docs/V070-VALIDATION.md) 保留原日期和范围，不代替本轮验收。

## 接入位置

- `lib/windchime-storage.ts`：连接本站 `DATABASE_PATH`（默认 `data/codes.db`），完成风铃表结构迁移。使用同一数据库文件中的独立连接，不替换网站数据库。
- `lib/db.ts`：等待风铃 schema ready，再初始化原网站表和历史迁移。宿主登录表继续由网站维护。
- `lib/windchime.ts`：创建共享服务与 Next.js 处理器；传入原盐、敏感词环境默认值、Turnstile 密钥、管理员权限回调，并等待宿主数据库初始化。
- `app/api/mail/**/route.ts`：保留原 URL，业务处理转交风铃。原登录使用 `/api/mail/session` 与数据库中的管理员会话；B 站头像代理保留本站实现。
- `lib/windchime-client.ts`：一个同源客户端实例，使用 HttpOnly 会话；401 通知本网站切回登录界面。原 `x-mail-password` 兼容接口仍有效。
- `components/mail`：网站独立 JSX 调用 `/react` Hooks、`/core` 校验和 `/media` 工具，连接密钥区复用 `/broadcast` 的私密管理组件；保留网站原有视觉样式。
- `lib/windchime-live.ts` 与 `app/api/mail/live/[...path]/route.ts`：桌面控制、站点授权和独立只读展示使用共享服务；网页重定向不影响这些 API。
- 首页、`/m` 和 `/m/[slug]` 的服务端数据只调用 `listPublicTopics` / `getPublicTopic`，内部备注不会作为页面属性发送给访客。

`/mail`、`/m`、`/m/[slug]` 的访问方式保持不变。可编辑站点文案仍来自现有网站后台的 `siteConfig.mail`。浏览器指纹键继续使用 `windchime:fp`；投稿限流、海报和横幅的 `uliuli:mail:*` 本地设置键保持原值。

## 更新到本次版本

当前依赖使用仓库中固定的 `vendor/windchime-embed-0.8.0.tgz`，应与 Mia 的压缩包逐字节一致并提交对应 lockfile。在备份和副本验证完成后运行：

```bash
npm ci
npm run db:migrate
npm run build
```

升级现有数据库前先运行本站 `npm run db:backup`，并保留完整备份及原环境配置。升级后无需复制或重建信件：迁移保留原表、信件 ID、话题关联、时间、已读、收藏、审核、删除标记和屏蔽身份；无话题字段的旧信件归入 `default`，默认信箱继承旧营业开关。`npm run db:migrate` 可以重复运行。风铃使用独立迁移记录，不重写宿主历史记录。

请保持 `DATABASE_PATH`、`WINDCHIME_HASH_SALT` 和登录密钥原值。完全未定义盐变量的既有安装继续使用本站历史 fallback `uliuli-mail-default-salt`。旧 `.env` 中的 `WINDCHIME_HASH_SALT=` 表示空字符串，原代码使用 `??`，因此一直使用空盐；本次保持该行为。升级时必须保留该空字符串，不能替换成 fallback 或随机盐，否则原屏蔽身份无法匹配。新安装才应生成稳定随机盐并备份。`MAIL_BLOCKED_TERMS` 仅在数据库尚未保存词库时用作默认值。Turnstile 继续使用 `TURNSTILE_SECRET` 与 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`；修改公开 site key 后重新构建前端。

未来风铃正式发布 npm 后，可以改用固定版本安装：

```bash
npm install --save-exact @windchime/embed@0.8.0
npm run db:migrate
npm run build
```

上述 npm 安装命令仅用于版本将来已公开发布的情形，目前应使用仓库内固定压缩包。下一次升级更新包、压缩包与 lockfile 并运行迁移和验证；两站不再分别修改同一业务修复。0.7.0 的站点授权采用加法迁移，旧话题授权不会自动扩权，现有信件和播出批准保持原义。回退前在副本上确认兼容性；不要覆盖运行中的数据库或丢弃升级后真实写入，详细步骤见 [升级说明](WINDCHIME-LIVE.md#配置和升级)。

## 本地联调

三个仓库放在同级目录，各自先运行 `npm ci`。在 **WindChime** 仓库运行：

```bash
npm run dev:consumers -- --uliuli ../Next_UliUli --mia ../Next_Mia
```

该命令监听风铃源码，成功构建后只同步发布产物，并启动/重载它管理的两站开发服务（UliUli 3011，Mia 3012）。本站为 `http://localhost:3011`。它不修改本站 manifest/lock，不复制风铃 React 或 node_modules；新增依赖需先显式安装。使用独立的本地测试数据库，勿把联调服务连接到生产文件。

若网站开发服务已由自己管理，只同步产物：

```bash
npm run dev:sync -- --targets ../Next_UliUli ../Next_Mia
```

停止联调后在本站运行 `npm ci` 恢复 lock 中固定版本。最终分发仍可以使用 `.tgz`，日常联调不必反复生成和复制压缩包。

## 验证

无需启动网站的数据库迁移回归（自动创建并删除临时测试库）：

```bash
npm run test:mail:migrations
```

覆盖新库、缺少话题/审核字段的旧库、当前结构；每个样本重复执行两次本站 CLI 迁移，并检查旧信件、屏蔽身份、默认开关及宿主数据保留。旧话题授权、既有站点授权的哈希、范围、期限和撤销关联也逐项核对；旧话题授权不得自动扩权。

启动一个使用一次性测试库的本地网站后执行 HTTP 接入回归：

```bash
MAIL_SMOKE_BASE_URL=http://localhost:3011 MAIL_SMOKE_PASSWORD=你的本地测试密码 MAIL_SMOKE_ALLOW_WRITES=1 npm run test:mail
```

测试实际调用本站原登录、风铃业务 API 与话题 SSR，创建专用测试话题，验证投稿、已读、收藏、审核、批量、归档、恢复、屏蔽和公开数据边界。0.7.0 脚本会用管理员会话创建临时站点授权并启用关键词以测试旧分类，最后恢复原开关和词库、撤销临时授权并清理测试话题。只有 localhost 可运行；启用 Turnstile 的服务器需要有效挑战令牌，因此此自动化测试应使用未配置挑战密钥的隔离环境。

风铃通用 API、从零接入示例、打包和版本升级说明见 [WindChime 仓库文档](https://github.com/Morphling0717/WindChime)。新站开发者应以风铃独立示例开始，无需复制本站业务文件。

## Docker 构建配置

公开 Turnstile site key 已通过 Compose build args 传入 Next.js 构建；secret 只在容器运行时配置。使用实际环境文件进行 Compose 插值：

```bash
docker compose --env-file .env build website
```

改变 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 后必须重新构建；只更改容器环境不会改变已编译客户端。独立构建命令：`docker build --platform linux/amd64 -t windchime-test/uliuli:0.8.0 .`。Docker 构建内含首页动态路由保护检查；镜像构建成功后仍需在隔离数据副本验证，不能直接把历史 Docker 测试当作本次结果。

## 历史固定包复核：0.5.0（2026-09-09）

以下记录保留原日期、版本和结果，仅描述当时 0.5.0 的验证，不是当前 0.8.0 验收或部署证明。当时曾在外接 SSD 构建并运行 `linux/amd64` 镜像。

最终 `vendor/windchime-embed-0.5.0.tgz` SHA-256：

```text
c21f59ae1ef149938c1e8bd5b070eee54bfa3f4b87d1c2f7c198b188ba817909
```

与另一网站安装的文件逐字节一致；`package-lock.json` 的 SHA-512 integrity 也已验证一致。冻结后实际运行 `npm ci` 和生产构建，均通过（Node 20.20.2）。随后使用该生产构建在隔离 SQLite 文件上启动，`test:mail` 完整 HTTP 流程及三类样本各两次 `test:mail:migrations` 均通过；生产登录页面在 Chromium 中加载，无页面异常。

此前已检查桌面、手机自定义界面、原登录、投稿、已读、收藏，以及二维码、海报与 CSV 实际下载。后续 Docker 补测也已通过上述信箱流程：容器内全部 138 个安装包文件与固定压缩包一致；新库、旧结构 CLI 迁移、应用首启接管、重复初始化、失败回滚及重启后会话和数据保留通过。桌面与手机页面、话题快速切换、二维码、海报、CSV 实际下载通过。

补测发现本站导出 CSV 时重复添加 BOM，已改用风铃现有 `downloadWindChimeCsv` 公开接口，保留本站文件名和选中规则；最终镜像下载核对通过，没有重新打包风铃。运行样本不是生产数据；npm 发布、线上部署和生产迁移未执行。详细环境、证据、修复及边界见 WindChime 的 `docs/DOCKER-VALIDATION.md`。

本轮 Docker 验证容器、浏览器会话和外接盘 Colima 虚拟机均已停止，数据卷与测试材料保留；不会继续占用测试端口。

随后另行修复了首页歌单的手机水合警告和卡片透明度残留，详见 [歌单首屏修复](song-system-hydration.md)。此修改只涉及本站组件，不需要更换风铃包；较早的 Docker 验证镜像不含此后续补丁。
