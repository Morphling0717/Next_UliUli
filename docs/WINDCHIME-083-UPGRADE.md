# 风铃共享库 0.8.3 升级

本站固定使用 vendor/windchime-embed-0.8.3.tgz 和对应 lockfile，与另一站使用相同压缩包；SHA256 为 c1207a59e8a3d5f9fe9e4e9a6c1895250569f2985add9b08c9737d8170a8f865。旧 vendor/windchime-embed-0.8.2.tgz 保留。共享包 MIT 许可证、精确安装、8 个无界面入口、全新 SQLite 和 TypeScript 消费者检查另见 WindChime/docs/evidence/0.8.3-copy/shared-package-verification.json。

网页保留 /mail 信箱管理与桌面连接密钥，桌面沿用同一服务的审核和播出规则。此次依赖升级不改网站登录、数据库路径、哈希盐或信件结构；既有迁移 ID 保持原义，旧话题授权不扩权。

新包的隔离生产构建、三种数据库各两次迁移和真实 HTTP 回归全部通过；两站越权与密钥派生撤销也通过。完整记录和警告见 [本轮新包验收](evidence/shared-0.8.3-qc/README.md)，历史 desktop-0.8.3-qc 属于共享 0.8.2，不能作为本包验收。

本轮只更新开发分支和草稿 PR，没有部署或合并 main。生产升级前需备份数据库、私有图片、环境配置及未入 Git 的资源，在备份副本验证迁移，再按独立部署流程切换；原路径和盐值（包括显式空字符串）必须保持。回退使用旧代码、旧 lockfile 和一致备份，不手工删列或覆盖未知资源。
