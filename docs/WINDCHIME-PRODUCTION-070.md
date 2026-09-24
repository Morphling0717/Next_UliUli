# WindChime 0.7.0 生产更新记录

日期：2026-09-13。目标为 `https://uliuli.cn`，项目 `/opt/1panel/www/uliuli/app`，仅更新 `uliuli-website`。Mia 本轮不部署。

## 源码、镜像与原数据

- 开发分支保持 `codex/windchime-desktop-v0.6.0`，运行代码目标 `fc16de50011227cd69fba064b541a38f85cf76d9`；未合并或修改 `main`。
- 共享包为 `vendor/windchime-embed-0.7.0.tgz`，与 Mia 字节相同，SHA256 `7d374c53f0f991b538b340553a5ee758aaf8f7be8026ba8368ff123ad5ddf4b7`。保留 lockfile 的 Linux libc 选择信息；184 个发布执行文件与两站本地生产构建使用的版本完全一致。
- 新镜像 `windchime-uliuli:070-fc16de500112`，镜像 ID `sha256:038d370fcb95f75b6493a429bfdae89a575719f0e18d1a173140410c27a3df65`。
- 回退镜像 `windchime-uliuli:rollback-070-20260913t051557z`，原镜像 ID `sha256:fe02422358afaacaedc7a59eec168b77a864f3a9e76b83ed82a4e0b7fdadde64`。
- 私有备份目录 `/root/windchime-deploy-backups/uliuli-070-20260913T051557Z` 保存原 `.env`、Compose、完整容器环境、Git bundle、完整 data 目录、一致 SQLite 快照和 200 个 public 资源的备份/摘要。秘密仅在服务器备份，不放入仓库。

保留三个原绑定：`app/data → /app/data`、`app/public/memes → /app/public/memes`、`app/public/pic → /app/public/pic`。哈希盐、网站会话、数据库路径与全部运行环境保持原值；不清理数据库或 Git 外资源，不动 OpenResty 容器。

## 构建和隔离验收

构建取精确 Git 提交到独立目录，合并原有全部 public 文件，排除环境文件、数据库、node_modules 及旧构建。保留 Docker builder 的 `/build` 工作目录修复，检查 `/` 动态渲染且与 `/app` 编译入口分开。构建约 481 秒，200 个原资源均无字节变化。

构建导出期间磁盘短暂降到约 460 MB，Docker 自行回收构建缓存后恢复约 2 GB。原计划只清理已核对的两个旧 cache ID，但执行前检查发现它们已经不存在，因此检查停止，未执行手动 prune、镜像删除、卷删除或备份删除。

在 `127.0.0.1:33011` 建立新镜像的隔离容器，数据来自一致备份副本、登录为合成密码；未使用生产数据库挂载。所有原表原列在迁移前后比较，连续迁移两次结果一致；旧 control 授权全部保持 topic，ID、哈希、期限及撤销关系保留，词库不触发默认开启。旧 Node 20 镜像也成功初始化迁移后的另一份副本。

HTTP 检查包括主页、App Hub、`/mail`、旧 live 跳转、capabilities、未授权控制/展示请求及 200 个资源逐字节核对。管理检查使用本次自建的合成话题、信件及授权，不输出原信或令牌。相关门禁报告位于私有备份目录。

隔离新镜像最终管理验收 **254 项断言、188 次 HTTP 请求通过**。第一轮所有功能断言通过，但原数据比对误将保存默认信箱开关造成的 `default.updated_at` 变化当作失败；只读逐列检查确认仅此预期字段变化。保留失败报告与失败副本，重置的仅是该隔离测试数据库，在精确限定默认话题时间戳的检查规则下完整重跑通过，未修改或迁就生产数据。

## 切换和公网结果

最终切换和公网验证均通过，镜像、源码、原环境与三个持久目录符合预期。停写后生成 `codes.final.sqlite` 与 `data-final`，迁移核对全部原表原列后启动新镜像。从停止旧容器到本机全部核对完成为 **6.34 秒**；未调用回退，未合并 main。

公网 `/`、`/app`、`/mail`、health 和 capabilities 返回 200；主站与 App Hub 标题正确且独立，主站保持 no-store。旧 `/mail/live` 307 跳转 `/mail`，全部未授权管理入口和展示 frame 返回 401，200 个资源文件再次按摘要逐字节核对通过。没有向生产信箱写入合成信、创建测试授权或更改管理员会话。隔离验收容器已停止，数据库副本和报告保留。

可公开结果见 [uliuli-production.json](https://github.com/Morphling0717/WindChime/blob/codex/live-broadcast/docs/evidence/0.7.0/uliuli-production.json)。原始环境、容器配置和数据库备份仅保留在服务器的私有备份目录。

生产浏览器实际查看首页和 App Hub，均正常且无 console/pageerror。保留用户已有管理员 Cookie，未打开生产私人信箱；`/mail` 登录界面只做无凭据 HTTP 检查，匿名可视复验因浏览器不能建立临时无 Cookie context 未进行。完整 `/mail` 前端流程已在同一代码的本地生产构建上验证。见 [浏览器证据](https://github.com/Morphling0717/WindChime/blob/codex/live-broadcast/docs/evidence/0.7.0/uliuli-production-browser.json)。

## 更新与回退方法

本次在服务器私有备份中保存了精确审查后的 `v070-deploy.py`、`v070-clone-http.py`、`v070-clone-management.py`。顺序为 `build --target-head <精确提交> --execute`、副本迁移及 HTTP 门禁、`cutover --execute`、`public --origin https://uliuli.cn`。切换前再次核对分支、镜像、环境、挂载与 public 摘要，并在停止唯一写入容器后重新备份完整 data 和一致数据库，再迁移、快进开发分支、启动已验证镜像。

切换失败会使用保留的旧镜像和原 Compose/环境恢复服务，**不覆盖当前数据库**；旧镜像兼容性先在副本验证。完整备份用于人工灾难恢复，不能为回退代码而覆盖切换后收到的新信。脚本每个阶段的报告绑定精确源码提交和镜像 ID，存在旧报告或环境变化时停止检查，不绕过门禁。

用户升级桌面至 0.7.0 后，在网页 `/mail` 的“桌面连接”重新生成一次站点密钥，即可发现所有现有及未来话题。旧密钥仅保留原话题权限。词开关默认关闭，只能由站点密钥在桌面设置页切换；网站只同步结果。

桌面包与本地验证见 [WindChime 0.7.0 验收记录](https://github.com/Morphling0717/WindChime/blob/codex/live-broadcast/docs/V070-VALIDATION.md)。安装/卸载仍与构建、便携启动分开记录。
