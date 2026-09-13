# 风铃 0.7.0：网站信箱与桌面连接

本分支固定安装 `vendor/windchime-embed-0.7.0.tgz`，与 Mia 使用同一压缩包及对应 lockfile。共享库维护信件、话题、审核、授权和数据库规则；网站保留原有 `/mail` 界面，Windows 桌面提供完整信箱管理和独立直播展示窗口。

UliUli 的 0.7.0 上线状态以本轮部署记录为准；历史 0.6.1 部署记录不能代替新版验收。

## 网页生成连接密钥

1. 打开 `/mail`，按原方式登录网站管理员账号。
2. 在“桌面连接密钥”填写名称并生成。新密钥拥有**本站全部话题的管理权限**，需要风铃桌面版 **0.7.0 或更高版本**。
3. 复制完整密钥，在桌面粘贴连接。密钥包含网站信息，无须再次填写网址；电脑只保存加密授权，不保存管理员密码。
4. 密钥从生成时起有效 30 天，可多台电脑重复使用，重复连接不会续期。在网页展开“已生成的授权”查看名称、权限范围、到期时间并撤销。

完整密钥仅在本次创建后显示，不写入浏览器持久存储。刷新、切换话题或退出登录会清除明文；隐藏文本不会撤销授权。撤销一个密钥会使所有共用它的电脑和派生展示授权失效，其他密钥不受影响。

**旧密钥和旧设备配对仍只管理原来获准的话题，不会自动升级为全站权限。**需要全站管理时，在 `/mail` 重新生成新密钥。旧配对入口保留在折叠区，按配对码批准当前选中话题。

`/mail/live` 已取消网页直播控制台，只跳转到 `/mail`；旧链接的 `topicId`、`userCode`、`deviceCode` 会保留，其他参数被丢弃。`/api/mail/live/*` 是桌面与展示窗口使用的服务接口，必须保留。

## 信箱和敏感词

网页继续提供话题新建、编辑、投稿启停、时间窗、归档／恢复／永久删除、已读、收藏、删除、批量操作、黑名单、CSV、分享二维码及海报。网页与桌面共用服务，页面可见时每 3 秒同步，重新聚焦或恢复可见时立即刷新；编辑中的话题表单不会被轮询重置。

敏感词模块默认关闭，启用开关只放在桌面设置中。关闭时，两端隐藏词表、敏感标记及对应旧审核界面，原来被标记的来信仍会正常出现在私人收件箱中；保留原词表和历史标记，不删除信件。启用后网页按服务端设置显示词表和折叠审核区，但网页没有开关。

敏感词标记、已读和收藏始终不代表播出批准。主播在桌面审阅原信、编辑独立展示稿，批准后进入待播，再手动上屏；修改内容或图片需要重新审核。删除、屏蔽、归档等操作由共享服务同步撤下相关展示。

## 独立展示窗口

在桌面打开标题为 `WindChime Display` 的窗口，由 OBS 或直播姬按严格窗口标题捕获。不要捕获私人控制台、网页后台或整个桌面。首次打开、重启、断线恢复时保持空白，需要新的手动上屏；紧急时使用“一键隐藏”、托盘入口或已配置的快捷键。

独立 Windows 模式不需要 B 站密钥、接入网关或展示 CORS。通用库的浏览器展示和平台适配代码保留为独立开发者扩展，本版网页不提供直播控制台入口，普通窗口采集不等于官方平台接入或审核上架。

## 配置和升级

- `WINDCHIME_SITE_ORIGIN`：网站公开 Origin，例如 `https://uliuli.cn`，反向代理部署应明确设置。
- `DATABASE_PATH`：继续使用现有数据库路径。
- `WINDCHIME_MEDIA_DIRECTORY`：私有持久图片目录，不能放入 `public/`；Docker 示例为 `/app/data/mail-media`。
- `WINDCHIME_HASH_SALT`：必须保留旧值，包括历史显式空字符串，不要在升级时重新生成。
- `WINDCHIME_BUILD_DIRECTORY`：默认 `.next`；测试隔离目录须为单个 `.windchime-*` 相对目录，构建和启动保持一致。

升级顺序：

1. 保存旧镜像或代码、lockfile、环境配置和未入 Git 的资源；对 SQLite 做一致备份，并备份私有图片目录。运行中的 WAL 数据库不要只复制 `.db` 文件。
2. 将备份复制到独立测试目录，使用 Node 20.19+（本仓库约束 20.x）、npm 10+ 执行 `npm ci`。在副本上运行两次 `npm run db:migrate`，检查完整性、原数据和重复执行结果。
3. 0.7.0 的新增授权范围与设置遵循加法迁移。旧话题密钥维持原权限；旧信件、ID、已读、收藏、话题和盐值保持。敏感词默认关闭不会清除历史记录或授予播出批准。
4. 执行 `npm run build`，在隔离站点检查 `/mail`、密钥导入和原信箱功能。仅更新桌面安装包不会升级线上 API。
5. 副本验证后，在维护窗口停止旧服务、完成最终一致备份和迁移，再启动单个持久 Node 进程。不要让同一 SQLite 数据库由多个服务副本并行提供直播控制。

回退前应先在副本上确认旧代码与已迁移库的兼容性。优先保留升级后的真实写入；若必须恢复数据，只能在停止写入后核对并恢复完整一致备份，不手工删列，不覆盖运行中的数据库。

两站压缩包应逐字节一致。PowerShell 可检查：

```powershell
Get-FileHash .\vendor\windchime-embed-0.7.0.tgz -Algorithm SHA256
npm ci
```

把两个网站得到的 SHA-256 比对一致，并与本轮交付校验记录核对。不要在同一个版本号下混用不同压缩包；依赖、压缩包和 lockfile 应一起更新。

## Windows 隔离联调

在没有生产 `.env` 的测试副本中设置临时数据库、图片目录和测试密码；以下命令不应在生产环境执行：

```powershell
$env:DATABASE_PATH = "$env:TEMP\windchime-uliuli-070-test\codes.db"
$env:WINDCHIME_MEDIA_DIRECTORY = "$env:TEMP\windchime-uliuli-070-test\media"
$env:ADMIN_PASSWORD = "replace-with-local-test-password"
$env:MAIL_AUTH_PASSWORD = "replace-with-local-test-password"
$env:WINDCHIME_HASH_SALT = "local-test-only"
$env:WINDCHIME_SITE_ORIGIN = "http://localhost:3031"
$env:WINDCHIME_BUILD_DIRECTORY = ".windchime-070-test"
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3031
```

打开 `http://localhost:3031/mail` 登录、生成全站密钥并连接桌面。迁移回归使用 `npm run test:mail:migrations`；原信箱 HTTP 回归使用 `MAIL_SMOKE_ALLOW_WRITES=1`、`MAIL_SMOKE_BASE_URL`、`MAIL_SMOKE_PASSWORD` 后运行 `npm run test:mail`，仅用于隔离 localhost 合成数据。

本页为运行说明，实际测试结果、平台限制与生产状态由本轮验收及部署记录分别记录。桌面运行与打包方式见 WindChime 仓库 `apps/desktop/README.md`。
