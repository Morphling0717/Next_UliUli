# new-website

Next.js 16 + sqlite3 项目。为了避免“本地能跑、1Panel 上翻车”，建议统一使用 Docker 部署，并且把数据库与上传目录做持久化挂载。

## Node 版本要求

- 推荐并已验证：`Node.js 20.x`（仓库内 `.nvmrc` 也是 `20`）
- 不建议直接用 `Node.js 22` 跑本项目（`sqlite3` 原生模块兼容性较差，容易出现构建失败）

## 本地开发

1. 安装依赖

```bash
npm ci
```

2. 配置环境变量（复制示例）

```bash
cp .env.example .env.local
```

3. 启动开发环境

```bash
npm run dev
```

## 环境变量

`.env.local`（本地）或 1Panel 应用环境变量中至少配置：

```bash
ADMIN_PASSWORD=your_admin_password_here
DEV_UNLOCK_PASSWORD=your_dev_unlock_password_here
DATABASE_PATH=./codes.db
```

- `ADMIN_PASSWORD`：用于 `/api/admin/save`、`/api/admin/upload`
- `DEV_UNLOCK_PASSWORD`：用于 `/api/admin/unlock`
- `DATABASE_PATH`：sqlite 文件路径  
  - 本地建议：`./codes.db`
  - Docker/1Panel 建议：`/app/data/codes.db`

## 生产构建验证

发布前请至少执行：

```bash
npm ci
npm run build
```

## 1Panel 部署建议（Dockerfile）

本项目仓库包含可直接构建的 `Dockerfile`，默认：

- 监听地址：`0.0.0.0:3000`
- 默认数据库路径：`/app/data/codes.db`
- 声明卷：
  - `/app/data`
  - `/app/public/memes`
  - `/app/public/pic`

在 1Panel 中请配置：

1. **环境变量**：至少设置 `ADMIN_PASSWORD`、`DEV_UNLOCK_PASSWORD`
2. **端口映射**：容器 `3000`
3. **持久化卷挂载**（强烈建议）：
   - 宿主机目录 -> `/app/data`
   - 宿主机目录 -> `/app/public/memes`
   - 宿主机目录 -> `/app/public/pic`

这样可以避免容器重建后数据库和上传图片丢失。
