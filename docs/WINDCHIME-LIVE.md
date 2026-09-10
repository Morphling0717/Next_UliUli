# 风铃 0.6 直播功能

本分支固定安装 `vendor/windchime-embed-0.6.0.tgz`，与 Mia 使用同一压缩包。共享库源码在 WindChime 仓库；本网站提供登录、页面和数据库连接，不维护另一套播出审核规则。

默认使用独立 Windows 桌面控制端，直接配对本站，并由直播软件采集桌面的独立展示窗口。这个流程不需要展示网关、B 站密钥或跨域展示配置。浏览器展示页与平台接入保留为开发者可选扩展。

## 升级与回滚

1. 停止旧服务，完整备份原数据库及 WAL/SHM（或使用 SQLite 一致备份），保留原环境配置、旧代码和 lockfile。首次从 0.5 升级尚无图片目录；之后必须连同私有图片目录一起备份。
2. 保留 `DATABASE_PATH` 和 `WINDCHIME_HASH_SALT` 的原值，包括历史显式空字符串。不要因升级生成新盐。
3. Node 20.19+（本仓库约束 20.x）、npm 10+：执行 `npm ci`，在数据库副本上执行两次 `npm run db:migrate` 后核对数据。迁移新增直播表和撤下触发器，历史信默认未获播出批准。
4. 按下文配置本站地址和私有图片目录，保留原登录配置，执行 `npm run build`。独立桌面模式将展示 URL、展示 CORS 和平台网关字段留空。
5. 副本验证通过后停止服务、对正式库执行迁移，再启动一个持久 Node 进程。暂不支持同一数据库跨多实例部署。

回滚恢复旧代码、旧锁文件和完整数据库/图片备份，不手工删列。此分支未操作生产数据库、未部署。

## 配置

- `WINDCHIME_SITE_ORIGIN`：本站公开 Origin，如 `https://uliuli.cn`。反向代理环境必须正确填写。
- `WINDCHIME_MEDIA_DIRECTORY`：私有持久目录。Docker 为 `/app/data/mail-media`，不能放到 `public/`。
- `WINDCHIME_BUILD_DIRECTORY`：可选的构建隔离目录，默认 `.next`；其他值必须是单个 `.windchime-*` 相对目录，例如 `.windchime-desktop-final`。构建和启动时使用相同值。

只有使用独立浏览器展示页时，才配置 `NEXT_PUBLIC_WINDCHIME_DISPLAY_URL` 为该页面的完整地址，并将其 Origin 加入逗号分隔的 `WINDCHIME_LIVE_ORIGINS`。前者是构建变量，变更后必须重新构建；未配置时，默认私人界面不显示生成浏览器展示链接的按钮。桌面主进程直接访问本站 API，不需要这些跨域配置。

B 站接入属于单独启用的扩展：`WINDCHIME_GATEWAY_ORIGIN`、`WINDCHIME_GATEWAY_KEY_ID`、`WINDCHIME_GATEWAY_PUBLIC_KEY`，以及界面的 `enablePlatformIntegration` 显式开关。本站只保存网关公钥，平台密钥和网关私钥只配置在独立接入服务中，不放入桌面程序。普通展示页可运行不代表已完成官方接入或平台审核。

公钥 ID 必须使用网关 `/.well-known/windchime-gateway.json` 实际返回值，不能假设永远为 `default`。同时信任多个轮换公钥时可扩展 `lib/windchime-live.ts` 的公钥映射。

## 使用

在 `/mail` 按原方式登录，再进入 `/mail/live`。选择话题，审阅原信及图片，编辑展示稿，批准进入待播，再手动上屏。已读、收藏和敏感词审核保持原义。

桌面应用输入本站地址后发起配对；在自动打开的本站私人页面中核对设备码，选择话题并批准设备连接。管理员密码只用于网页登录，桌面保存的是该话题的设备授权。连接另一个话题需单独配对；切换连接会先隐藏原话题。

在桌面点击“打开展示窗口”，直播软件只采集标题为 `WindChime Display` 的窗口，并使用严格标题匹配，避免关闭展示窗后改捕私人控制台。私人后台、本站全局布局和 PWA 均不作为展示源。首次启动、重启或恢复连接后先空白，需要重新手动上屏；紧急情况使用“一键隐藏”或 `Ctrl+Shift+H`。

可选浏览器模式配置完成后，才在“展示授权与设备连接”生成只读链接并交给浏览器源；同样只采集独立展示页。

## Windows 本地验证

在不含生产 `.env` 配置的独立测试副本中运行，展示 URL、展示 CORS 和平台网关字段保持为空。只使用临时数据库；PowerShell 示例中的密码请自行替换：

```powershell
$env:DATABASE_PATH = "$env:TEMP\windchime-uliuli-test\codes.db"
$env:WINDCHIME_MEDIA_DIRECTORY = "$env:TEMP\windchime-uliuli-test\media"
$env:ADMIN_PASSWORD = "replace-with-local-test-password"
$env:DEV_UNLOCK_PASSWORD = "replace-with-local-test-password"
$env:WINDCHIME_HASH_SALT = "local-test-only"
$env:WINDCHIME_SITE_ORIGIN = "http://localhost:3011"
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3011
```

第二个终端运行 `npm run test:mail:migrations`。原有信箱 HTTP 回归使用 `MAIL_SMOKE_ALLOW_WRITES=1`、`MAIL_SMOKE_BASE_URL`、`MAIL_SMOKE_PASSWORD` 环境变量后执行 `npm run test:mail`。直播 HTTP 回归在 WindChime 仓库运行 `scripts/test-live-http.mjs`，使用对应 `WINDCHIME_SMOKE_*` 变量。所有写测试拒绝非 localhost 地址。

启动 WindChime 的桌面应用，填写 `http://localhost:3011` 完成浏览器配对即可，不需要另外启动网关。桌面运行及打包方式见共享仓库的 `apps/desktop/README.md`。

本轮两站、桌面与实际窗口采集结果，以及仍未验证的项目，见 WindChime 的 [docs/DESKTOP-LOCAL-VALIDATION.md](https://github.com/Morphling0717/WindChime/blob/main/docs/DESKTOP-LOCAL-VALIDATION.md)。平台启动、H5 和上架不属于本轮独立桌面版验收。
