# 主题收件箱（Mail Topics）设计方案

> **状态**：草案 · 待主播确认  
> **创建时间**：2026-04-21  
> **作者**：Cascade + TMF  
> **目标项目**：`Next_UliUli`

---

## 0. 背景与目标

### 场景

现在发信箱只有**一个**收件箱，平时开放给所有用户（或整体关闭）。

主播在特别的节日（例如**一周年 / 生日 / 节日 / 读信节目**）希望临时开一个**新主题**的收件箱，这个主题箱要和常规收件箱**完全分开**：

- 只收入**通过这个主题链接**发送的留言
- 常规收件箱照常运作（或由主播选择临时关闭）
- 活动结束后，主题箱可以归档或关闭，留言仍保留以便回看

### 非目标（先不做）

- ❌ 普通访客能看到其他人的留言（仍然是一对一匿名信，不是社区话题墙）
- ❌ 访客订阅 / 关注主题
- ❌ 多账号多用户（只服务单个主播）

---

## 1. 现状快照

| 维度     | 现在的实现                                                            |
| -------- | --------------------------------------------------------------------- |
| 数据表   | 单表 `mail_messages`（无分组字段）                                    |
| 全局开关 | `mail_settings.mail.enabled`（布尔总闸）                              |
| 投递入口 | 首页浮动按钮 → `MailSendModal` → `POST /api/mail/messages`            |
| 管理台   | `/mail` 密码进入，看全部来信                                          |
| 已具备   | 限流（IP/指纹）、Turnstile、敏感词、黑名单（sender hash）、二维码海报 |

**核心复用点**：所有基础设施（限流、反垃圾、海报）都可以**原样套用**到每个主题，不需要重写。

---

## 2. 方案总览

核心思路：

> **每条留言归属某一个"收件组（Topic）"。**  
> **默认有且仅有一个"常规收件组"**，历史留言自动落在这里 → 零破坏。  
> 主播可按需创建 N 个"主题收件组"，每个独立**开关 / 链接 / 海报 / 管理视图**。

**没有全局总闸**——每个主题（含常规信箱）各自独立开关。关闭常规信箱 → 首页左下角按钮变灰；关闭活动主题 → 该 `/m/{slug}` 投不进；互不影响。

---

## 3. 数据模型

### 3.1 新增表 `mail_topics`

```sql
CREATE TABLE IF NOT EXISTS mail_topics (
  id          TEXT PRIMARY KEY NOT NULL,    -- UUID
  slug        TEXT UNIQUE NOT NULL,         -- URL 标识，如 'default' / 'birthday-2026'
  title       TEXT NOT NULL,                -- 例: "Uli 一周年特别信箱"
  description TEXT,                         -- 投信页展示给访客的提示文案
  note        TEXT,                         -- 备注（只给主播看）
  is_default  INTEGER NOT NULL DEFAULT 0,   -- 1 = 常规收件组，全表只能有一行
  is_enabled  INTEGER NOT NULL DEFAULT 1,   -- 每个主题独立的开关
  starts_at   TEXT,                         -- 可选：活动开始时间（ISO，NULL=立即开放）
  ends_at     TEXT,                         -- 可选：活动结束时间（ISO，NULL=长期）
  archived_at TEXT,                         -- 软删除
  sort_order  INTEGER NOT NULL DEFAULT 0,   -- 管理台列表排序
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_topics_one_default
  ON mail_topics (is_default) WHERE is_default = 1;
```

### 3.2 改造 `mail_messages`

```sql
ALTER TABLE mail_messages
  ADD COLUMN topic_id TEXT NOT NULL DEFAULT 'default';

-- 列表 / 分页
CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_created
  ON mail_messages (topic_id, deleted_at, created_at);

-- 未读数 badge 专用（切 tab 性能关键）
CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_unread
  ON mail_messages (topic_id, is_read) WHERE deleted_at IS NULL;
```

> SQLite 的 `ALTER TABLE ADD COLUMN` 写法可参考 `lib/db.ts` 已有的
> `is_flagged` 迁移：包在 `db.run` 回调里吞掉 `duplicate column name` 错误即可幂等。

### 3.3 默认主题自举

启动 `db.serialize()` 时 `INSERT OR IGNORE`：

```sql
INSERT OR IGNORE INTO mail_topics
  (id, slug, title, description, is_default, is_enabled, created_at, updated_at)
VALUES
  ('default', 'default', '常规信箱', NULL, 1, 1, ?, ?);
```

历史 `mail_messages` 已由 `DEFAULT 'default'` 自动落到默认主题 → **无需数据迁移脚本**。

**旧 `mail_settings.mail.enabled` 迁移**：启动时读出它当前的 `true/false`，作为 default 主题 `is_enabled` 的初值（仅迁移一次）。该 key 之后不再被业务读取（保留做历史归档，不清理）。

---

## 4. URL / 路由设计

| 场景           | 现在                           | 改造后                                                                                         |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 常规投信       | 首页浮动按钮 → `MailSendModal` | **不变**（隐式走 `default` 主题）                                                              |
| 活动发现入口   | —                              | **新增** 全站顶部**活动横幅**（仅在有启用中的非默认主题时出现，无活动时完全不渲染，详见 §6.3） |
| 主题投信页     | —                              | **新增** `/m/{slug}`，展示主题标题/说明，内置投信框                                            |
| 主题分享二维码 | —                              | 管理台为每个主题生成 `/m/{slug}` 的 QR + 海报                                                  |
| 活动列表页     | —                              | **新增** `/m`（公开页），同时有 2 个及以上活动时由顶部横幅引导进入                             |
| 管理台入口     | `/mail` 看全部                 | `/mail` 顶部把每个主题平铺成 **tab**（参考 `app/admin` 的 `AdminTabsNav`），点击即切换         |
| 新建/编辑主题  | —                              | `/mail` tab 栏里的 `+ 新建主题` 按钮                                                           |

> **为什么用 `/m/{slug}` 而不是 `/mail/{slug}`**：  
> `/mail` 是**管理员密码页**，放在同一前缀下容易和投信页混淆；`/m/` 短、专门给访客用。

---

## 5. API 变更

### 5.1 新增

| 方法     | 路径                      | 权限                           | 作用                                                              |
| -------- | ------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `GET`    | `/api/mail/topics`        | 公开                           | 列出 `is_enabled=1 AND archived_at IS NULL`，按 `sort_order` 排序 |
| `GET`    | `/api/mail/topics/{slug}` | 公开                           | 取单个主题的公开信息（title、description、isEnabledNow）          |
| `GET`    | `/api/mail/topics`        | 管理端（带 `x-mail-password`） | 返回**全部**主题（含归档）                                        |
| `POST`   | `/api/mail/topics`        | 管理端                         | 创建主题                                                          |
| `PATCH`  | `/api/mail/topics/{id}`   | 管理端                         | 改标题/说明/开关/时间窗/排序/备注                                 |
| `DELETE` | `/api/mail/topics/{id}`   | 管理端                         | 软删（写 `archived_at`）                                          |

**管理端 GET 与公开 GET 共用一个路径**，内部根据是否有有效密码决定返回集合 → 和现在 `/api/mail/messages` 的风格一致。

#### 写入保护字段（API 永不接受外部赋值）

`POST` / `PATCH /api/mail/topics` 请求体即使带以下字段也**静默忽略**：

- `id`（POST 服务端生成 UUID；PATCH 不可改）
- `is_default`（只在系统自举时写 `1`；API 永远读写为 `0`）
- `created_at`（服务端覆盖）

额外硬性约束：

- **不允许归档 `is_default=1` 的主题** → 400
- 对 `is_default=1` 的主题只允许 PATCH `is_enabled` / `title` / `description`，其它字段请求体里的值都无效

#### 错误码速查表

| 场景                                                | 状态码            | 错误文案                                                         |
| --------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| slug 重复                                           | `409 Conflict`    | `slug "xxx" 已被占用`                                            |
| slug 不符合正则 / 命中保留字黑名单                  | `400 Bad Request` | `slug 只能包含 a-z、0-9、短横；且不能是 default/new/admin/api/m` |
| `starts_at > ends_at`                               | `400`             | `开始时间不能晚于结束时间`                                       |
| `title` 空 / 超长（> 64）                           | `400`             | `标题必需 1~64 字符`                                             |
| PATCH / DELETE 不存在的主题                         | `404 Not Found`   | `主题不存在`                                                     |
| 尝试归档 default 主题                               | `400`             | `默认主题不可归档`                                               |
| PATCH 已归档主题（除 `archived_at: null` 恢复外）   | `409 Conflict`    | `请先恢复再编辑`                                                 |
| 投信：主题归档 / 未到时间 / 已过期 / `is_enabled=0` | `423 Locked`      | 对应具体文案（见 §5.2）                                          |
| 密码错 / 未带密码调管理端                           | `401`             | 既有逻辑                                                         |

### 5.2 改造 `POST /api/mail/messages`

- 入参新增可选 `topicSlug: string`；不传则视为 `'default'`
- 解析 slug → `topic_id`
- 校验：
  - 主题存在
  - `archived_at IS NULL`
  - `is_enabled = 1`
  - 当前时间在 `[starts_at, ends_at]` 内（端点缺省视为无限）
  - **无全局总闸**——只看该主题自身 `is_enabled`（default 主题亦然）
- 任一不满足 → `423 Locked` + 具体文案
- 落库 `INSERT ... topic_id = ?`

### 5.3 改造 `GET /api/mail/messages`（管理端）

- 新增 `?topicId=xxx`；**不传默认 `'default'`**（符合 §7 的设计预期："左下角按钮 → 常规信箱 / 活动链接 → 活动主题"两条管道互不串）
- `counts` 按**当前主题**统计（不跨主题）
- 跨主题汇总：`?topicId=all`（仅 v2 可能用到）

### 5.4 `/api/mail/settings` 语义透明切换（default 主题开关的透传）

- **全局总闸已移除**
- 此端点保留，但内部实现改为：`GET` 返回 default 主题的 `is_enabled`；`PUT` 直接代写 default 主题的 `is_enabled`
- 目的：**旧前端 0 改动**——`MailSpeedDial` 的 30s 轮询、`MailSendModal` 的 disabled 态判断继续工作
- 新前端应直接走 `PATCH /api/mail/topics/{id}`

### 5.5 `[id]` / `batch` / `block` 的跨主题防呆

四个管理端端点 `GET|PATCH|DELETE /api/mail/messages/{id}`、`POST /api/mail/messages/batch`、`POST /api/mail/messages/{id}/block` **强制带 `topicId`**：

- 服务端 SQL 条件：`WHERE id = ? AND topic_id = ?`（或 `id IN (...) AND topic_id = ?`）
- 跨主题的 id（例如 tab 切换时前端状态错乱把 A 主题 id 混进 B 主题批量请求）→ 命中为空，静默跳过
- 防止"我在生日 tab 点批量删除，结果把常规信箱的信也删了"

---

## 6. 前端改造

### 6.0 入口安全原则（避免误发）

> **核心**：主题归属由 **URL 决定**，**不在发信表单里提供任何主题选择控件**。  
> 用户到达哪张发信页，主题就锁死在哪张页，从机制上杜绝"发给错信箱"。

- ❌ 不做：`MailSendModal` 里加 `<select>` 选主题 / 多个 radio / 多个提交按钮
- ❌ 不做：首页右下角常规发信按钮旁边再叠一个"活动发信"按钮
- ✅ 只做：通过**全站顶部活动横幅**导航到 `/m/{slug}` 专属页再投信（见 §6.3）
- ✅ 前端约束：`topicSlug` 只从 URL 路径参数 → `WindChimeSender` props → API body，**绝不从表单里的 hidden input 或用户可见控件来**
- ✅ 服务端兜底（可选加固）：`POST /api/mail/messages` 在收到非 `default` 的 `topicSlug` 时，额外校验 `referer` / `origin` 路径是否是 `/m/{该 slug}`；不一致则记日志（v1 仅记录，不拦截，避免误伤无 referer 的客户端）

### 6.1 管理台 `/mail`（主题 Tab 栏 + 全局动作）

参考 `app/admin/components/AdminTabsNav.tsx` 的 `flex-wrap` 按钮布局，**每个主题平铺成一个一级 tab**，不再藏在下拉里：

```
┌──────────────────────────────────────────────────────────────────┐
│ [ 📬 常规信箱 12 ]  [ 🎂 生日 2026 进行中 3 ]  [ 🥮 中秋 未开始 ]│
│ [ 🎊 周年 2026 已结束 · 待归档 ]                                │
│ ───────────────                                                  │
│ [ 📁 往期活动 (8) ]   [ + 新建主题 ]   [ ⚙ 全局设置 ]            │
└──────────────────────────────────────────────────────────────────┘
           │
           ▼（选中某个主题 tab 后显示）
┌──────────────────────────────────────────────────────────────────┐
│  🎂 生日 2026  ·  2026-06-15 ~ 2026-06-20  [开关] [编辑]         │
│  [归档]   [复制分享链接 📎]                                      │
│                                                                  │
│  ┌─ INBOX · 收件箱（只列该 topic 的来信）                        │
│  ├─ 待审核                                                       │
│  ├─ 本主题二维码 + 海报                                          │
│  └─ 黑名单（跨主题共享，固定在页尾）                             │
└──────────────────────────────────────────────────────────────────┘
```

**主题 tab 上显示的信息**：

- 图标 + 主题 `title`（过长时截断）
- 未读数 badge（无未读时不显示）
- 状态视觉区分：
  - 已开启：高亮边框
  - 已关闭 / 未到开始时间 / 已过期：灰底 + 小图标提示
  - 已归档：默认不显示，需勾选"显示已归档"才出现

**三个固定动作按钮**（和主题 tab 之间有视觉分隔）：

- `📁 往期活动 (N)`：打开归档抽屉查看所有 `archived_at IS NOT NULL` 的历史主题（详见 §6.1.1）
- `+ 新建主题`：弹小型模态或展开表单（标题 / 说明 / 备注 / slug / 开始-结束时间）
  - **表单默认值**：时间窗默认勾选，开始=当前北京时间、结束=当前+7 天；主播取消勾选时 → 气泡提示 "⚠ 永久活动 ≈ 常规信箱平行版，确定？"，确认后两端存 NULL
  - **等价永久活动的状态**：`starts_at IS NULL AND ends_at IS NULL AND is_enabled=1 AND archived_at IS NULL` → §6.1.1 的"进行中"状态
- `⚙ 全局设置`：敏感词配置（**无全局总闸**——每个主题的开关已分散到各自 tab 的右上角）

**为什么比下拉好**：

- 所有主题状态**一眼可见**（哪几个在开、各自多少未读）
- 日常切换**一次点击完成**（下拉要两次）
- 和现有 `@c:\Users\ASUS\Desktop\Next.js网页开发\Next_UliUli\app\admin\page.tsx:1` 的导航风格一致，零学习成本
- 新建 / 设置**不会被埋在下拉里**

**溢出处理**：

- 主题数量少（< 10）时用 `flex-wrap` 自然换行，够用
- 未来超过 10 个再加 `更多 ↓` 折叠（v1 不做）

**保留不变**：

- 黑名单按 `sender_hash` 跨主题共享 → 页尾统一一个黑名单面板，不跟主题 tab 切换
- 敏感词全局配置（见 §9 Q8 已确认）→ 放在 `⚙ 全局设置` tab 内，不随主题切换

### 6.1.1 主题生命周期与归档抽屉（应对主题累积）

> 每年几次活动累积下来，主题数量会逐年增加。下面这套规则保证：  
> **主 tab 栏永远只显示"当前还值得看的"**；**历史主题永远可找到，但不占眼睛**。

#### 主题的 5 种状态

每个主题在任一时刻只处于下面一种状态，由 `is_default` / `is_enabled` / `starts_at` / `ends_at` / `archived_at` 派生（**不新增字段**）：

| 状态       | 条件                                                                      | 主 tab 栏              | 📁 往期活动 |
| ---------- | ------------------------------------------------------------------------- | ---------------------- | ----------- |
| **常驻**   | `is_default=1`                                                            | ✅ 永远最左，不可归档  | —           |
| **进行中** | `is_enabled=1` AND `now ∈ [starts_at, ends_at]` AND `archived_at IS NULL` | ✅ 高亮（活动主色）    | —           |
| **未开始** | `is_enabled=1` AND `now < starts_at` AND `archived_at IS NULL`            | ✅ 冷色/虚线           | —           |
| **已结束** | `now > ends_at` AND `archived_at IS NULL`                                 | ✅ 灰底 + "待归档"提示 | —           |
| **已归档** | `archived_at IS NOT NULL`                                                 | ❌ 不显示              | ✅          |

#### 主 tab 栏的排序

- 固定最左：**常驻**（永远在第一位）
- 然后：**进行中** → **未开始** → **已结束**（按状态优先级分组）
- 组内：按 `sort_order` 升序，次按 `ends_at DESC`（最近的事件先出现）
- **已归档**完全不进主 tab 栏

**规模估算**：  
主播一年办 4 个活动 × 3 年 = 12 个主题。正常节奏下：

- 进行中 ≤ 1 个（同一时间通常只办一件事）
- 未开始 ≤ 2 个（预约下一个活动）
- 已结束未归档 ≤ 3-5 个（主播懒得立刻清理）
- **主 tab 栏实际可见 ≈ 5-8 个，即使很偷懒也不会过 10 个**

当"已结束"累积到视觉碍眼时，主播一眼就能看出哪些该归档，点一次就清走。

#### 📁 往期活动 抽屉

点右侧 `📁 往期活动 (N)` 按钮，展开一个抽屉（或全屏模态，取决于屏宽）：

```
┌─ 往期活动 ──────────────────────────────┐
│ 🔍 搜索 title / slug ...                │
│ 状态: [ 全部 ▾ ]   时间: [ 按年份 ▾ ]   │
│                                         │
│ — 2026 ————————————————————————————     │
│  🎉 周年 2026 · 2026-04-10 ~ 04-15      │
│     [ 查看信件 ]  [ 恢复 ]              │
│  🎂 生日 2026 · 2026-06-15 ~ 06-20      │
│     [ 查看信件 ]  [ 恢复 ]              │
│                                         │
│ — 2025 ————————————————————————————     │
│  🐲 春节 2025 · 2025-02                 │
│     [ 查看信件 ]  [ 恢复 ]              │
│  ...                                    │
└─────────────────────────────────────────┘
```

**抽屉功能**：

- **搜索**：按 `title` / `slug` 模糊匹配
- **年份分组**：按 `starts_at` 或 `created_at` 的年份自动分组
- **状态筛选**（v1 只有"已归档"一种，预留给 v2）
- **查看信件**：在原位打开该主题的 inbox 视图（不把它从归档里拉出来）
- **恢复**：清空 `archived_at`，主题重新出现在主 tab 栏（状态按当前时间重新判定）

#### 防止失控的辅助机制

- **"已结束"状态的 tab** 右上角小图标写 `待归档`，点一下直接归档，不用进入主题内部
- **主 tab 栏出现 ≥ 3 个"已结束"** 时，tab 栏末尾显示一条提示：`"⚠ 你有 N 个已结束的主题，[一键归档全部 →]"`
- 不强制任何归档操作，全部由主播决定节奏

#### 状态在 API 层的体现

**不新增 DB 字段**，状态由 `/api/mail/topics` 接口在返回时动态计算后附加：

```ts
type TopicListItem = {
  id: string;
  slug: string;
  title: string;
  // ... 其它字段
  state: "default" | "active" | "scheduled" | "ended" | "archived"; // ← 派生
  unreadCount: number; // ← 管理端 join 消息表计算
};
```

前端拿到 `state` 直接用于染色 / 分组 / 排序，**无需自己算时间窗**。

#### 归档前的未读 / 待审核提醒

主播点某主题的"归档"按钮时，`PATCH /api/mail/topics/{id} { archived_at: <now> }` 响应里同时返回 `{ unreadCount, flaggedCount }`：

- 两者都为 0 → 直接归档，无提示
- 任一非 0 → 前端**拦截**并弹二次确认：

  > "🎂 XX 主题还有 **3 封未读 / 1 封待审核**，归档后需去【往期活动】才能查看。确定归档吗？"
  >
  > `[ 取消 ]` `[ 先标为已读再归档 ]` `[ 仍然归档 ]`

- "先标为已读再归档" = 前端先批量 `is_read=1` 再写 `archived_at`（两步串行即可，不强求事务）
- 防止主播误点归档后，未读信件永远被埋在往期活动里再没机会看到

#### v2 可选增强（不在 v1 做，记录备案）

- 创建主题时可选"结束后 N 天自动归档"（减少主播清理负担）
- Pin 功能：把某个特殊主题钉在主 tab 栏永不自动降级
- 归档后的存储压缩 / 匿名发送者 hash 清理

### 6.2 访客投信页 `/m/{slug}`

新建 `app/m/[slug]/page.tsx`：

- **服务端**从 `/api/mail/topics/{slug}` 预取数据，SEO 友好
- 顶部大标题 = `title`
- 副标题 = `description`
- 下方嵌入 `WindChimeSender`（和首页同一份组件），提交时带 `topicSlug`
- 主题已关闭 / 归档 / 未到时间 / 已过期 → 显示对应文案："活动还未开始" / "活动已结束，期待下次相遇"

### 6.3 全站顶部活动横幅 `ActiveTopicsBanner`

**挂载位置**：`app/layout.tsx` 的 `<body>` 下、`{children}` 之前，像导航栏一样**全站常驻**。

**展示规则**：

- **数据源复用 `/api/config` 轮询**：首页已有每 15s 轮询一次 `/api/config` 的机制（见 `@c:\Users\ASUS\Desktop\Next.js网页开发\Next_UliUli\app\page.tsx:143-146`）。把"当前有效活动主题列表"+"default 主题开关"都注入 `/api/config` 响应的 `siteConfig.activeTopics` / `siteConfig.mailEnabled` 字段 → 横幅和 `MailSpeedDial` 都从这里读，**不再各自打接口**
- 为什么这样做：
  1. 直播引流时 3000 人同时打开首页，各自发 `/api/mail/topics` 会瞬间打爆 SQLite；复用现有轮询 0 新请求
  2. 顺手砍掉 `MailSpeedDial` 的 30s 独立轮询（`@c:\Users\ASUS\Desktop\Next.js网页开发\Next_UliUli\components\mail\MailSpeedDial.tsx`），少一条心跳 + 状态感知更快（30s 最坏 → 15s）
- 服务端生成 `activeTopics` 的 SQL：`is_enabled=1 AND archived_at IS NULL AND is_default=0 AND (starts_at IS NULL OR starts_at <= now) AND (ends_at IS NULL OR ends_at >= now)`；每条至少带 `slug` + `title`
- `/m` 列表页等不走 `/api/config` 轮询的页面：SSR 时直接读一次 `/api/mail/topics` 即可（低频）

> **架构约定（重要）**：`siteConfig.activeTopics` / `siteConfig.mailEnabled` 只是**派生显示字段**，source of truth 仍在 `mail_topics` 表和 `/api/mail/*` 模块里。`/api/config` 只负责**聚合拼装**，不持有数据；mail 模块仍是这些数据的唯一所有者（与 admin 模块无关）。

- **返回 0 条** → 横幅**完全不渲染**（DOM 都不占位）
- **返回 1 条** → 显示：`[主题 title] · 点此投信 →`，整条横幅是一个 `<Link href="/m/{slug}">`
  - 主题 `title` 由主播在后台**完整手写**（emoji / "🎂 Uli 生日快乐来信 2026" / "给 Uli 一封信 · 一周年" 都随主播）
  - 系统只负责在 title 后拼接固定尾巴 `· 点此投信 →`，不额外加前缀 emoji
- **返回 2 条及以上** → 显示 `🎉 N 个活动进行中 · 查看全部 →`，整条横幅 `<Link href="/m">` 跳活动列表页（见 §6.5）
  - 聚合文案由系统固定，不读主播 title（多主题时展开会太长）

**样式原则**：

- `position: sticky; top: 0; z-index` 高于其它内容，但**高度控制在 ~40px**，不喧宾夺主
- 视觉上和站内常规配色**明显区分**（用活动色，如生日粉 / 周年金），一眼就能认出是"活动入口"而不是站内按钮
- **点击区域 = 整条横幅**，不要在横幅内部再套一个小按钮，避免误解为"横幅 = 信息 + 按钮 = 发信"
- 右侧提供 `×` 按钮；访客关闭后写入 `sessionStorage`，**同一标签页内不再弹**；换标签页 / 重启浏览器后再出现

**不显示的场景**：

- `/mail` 管理台（主播自己不需要给自己看广告）
- `/m/{slug}` 当前页的主题就是横幅指向的那个主题时（避免自跳）

**组件位置**：`components/mail/ActiveTopicsBanner.tsx`（客户端组件，静默失败：接口挂了就当没有活动，绝不阻塞页面渲染）

### 6.4 首页 `MailSendModal` 保持不变

- 不传 `topicSlug`
- 服务端默认落 `'default'`
- 行为和现在 **100% 一致**：禁用态优先读 `/api/config.mailEnabled`（见 §6.3）；`/api/config` 读失败时回落现有 `/api/mail/settings`（兼容兜底）
- **不在此处显示活动横幅**（活动横幅由 §6.3 的全站组件统一提供）

#### WindChime 核查结论（前置风险已消除）

`@windchime/embed` 是本项目自有包（`vendor/windchime-embed-0.3.1.tgz`，非 npm 公共包）。`WindChimeSender` **不负责网络请求**，只通过 `onSubmit(payload)` 钩子回调数据给业务层（见 `@c:\Users\ASUS\Desktop\Next.js网页开发\Next_UliUli\components\mail\MailSendModal.tsx:103-130`）。

结论：**加 `topicSlug` 完全不用改 embed 包**——只要在 `/m/[slug]` 页面的 `onSubmit` 里把 `topicSlug` 塞进 POST body 即可。v1 不需升级 / fork embed 包。

### 6.5 活动列表页 `/m`

当**同时有 2 个及以上**启用中的非默认主题时，顶部横幅折叠为 `🎉 N 个活动进行中 · 查看全部 →`，点击跳汇总页。

- **路径**：`/m`（无 slug）；`/m` 和 `/m/{slug}` 通过 Next.js params 有无自然区分
- **渲染**：SSR，从 `/api/mail/topics` 公开集合拉当前有效主题
- **内容**：每个主题渲染成一张卡片：`title` / `description` / 活动时间 / `去投信 →` 按钮 → `/m/{slug}`
- **空态**：0 条时显示友好文案（正常不会被引导到此，仅兼容直访）
- **文件位置**：`app/m/page.tsx`

---

## 7. 兼容性与回滚

### 零破坏保证

- 默认主题自动创建，历史数据全部自动归属 `default`
- 旧 `mail_settings.mail.enabled` 值被迁移到 default 主题的 `is_enabled`
- `/api/mail/settings` 端点**语义透明切换**为 default 主题开关的透传 → `MailSpeedDial` / `MailSendModal` 的现有轮询代码 **0 改动**
- 首页左下角按钮仍然只投常规信箱（`POST /api/mail/messages` 不传 `topicSlug` → 服务端落 `default`）

### 新行为的明确声明（非 bug，是设计预期）

- `GET /api/mail/messages` 不传 `topicId` 时**只返回 default 主题**的信，不再返回全部
- 这是"左下角按钮 → 常规信箱 / 活动链接 → 活动主题"两条管道互不串的自然结果
- 管理台切换到其它主题 tab 才能看到对应的活动信件
- 如需跨主题汇总（仅 v2 可能用到），再加 `?topicId=all`

### 回滚策略

- 若要回退到单信箱：代码层只需
  1. `POST /api/mail/messages` 忽略 `topicSlug`，永远写 `'default'`
  2. 管理台不再读取主题列表
  3. `mail_topics` 表保留，无副作用

---

## 8. 实施路线（3 次 PR）

### PR1 · 底层（不改前端行为）

- [ ] `lib/db.ts` 加 `mail_topics` 建表 + 默认行自举 + `mail_messages.topic_id` 迁移
- [ ] `lib/mail-topics.ts` 新模块：`listTopics` / `getTopicBySlug` / `createTopic` / `updateTopic` / `archiveTopic` / `restoreTopic`
- [ ] API：`/api/mail/topics` & `/api/mail/topics/[id]`（CRUD），列表返回时**动态派生 state 字段**（default / active / scheduled / ended / archived）
- [ ] 管理端列表支持 `?include=archived` 开关，默认仅返回非归档；归档主题走独立请求供抽屉用
- [ ] API：`/api/mail/messages` 接受 `topicSlug`，带活动窗 / 开关校验
- [ ] `GET /api/mail/messages` 支持 `?topicId=`
- [ ] **slug 校验**：正则 `^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$` + 保留字黑名单 `['default', 'new', 'admin', 'api', 'm']` + 唯一性；违反返回 400
- [ ] **写入保护字段**：POST/PATCH 的 `id` / `is_default` / `created_at` 一律服务端忽略；尝试归档 default 主题返回 400
- [ ] **API 错误码**：按 §5.1 错误码速查表返回具体 status + JSON `{ error }`，前端可直接 match 文案
- [ ] **时区规范（北京时间）**：管理端时间输入一律按 `Asia/Shanghai` 理解，入库前 `new Date(localInput + ':00+08:00').toISOString()` 转 UTC；DB 列永远存 UTC Z 串；回读 `toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })`
- [ ] **老 `mail.enabled` → default 主题 `is_enabled` 一次性迁移**：仅启动首次执行，之后不再同步
- [ ] **四端点跨主题防呆**：`GET|PATCH|DELETE /api/mail/messages/{id}` + `POST .../batch` + `POST .../{id}/block` 全部强制 `?topicId=`，SQL 条件带 `AND topic_id = ?`
- [ ] `/api/mail/settings` 重写为 default 主题 `is_enabled` 的透传（GET/PUT 均代理）
- [ ] `/api/mail/topics` 归档 PATCH 响应里带 `{ unreadCount, flaggedCount }`
- [ ] **冒烟测试**：默认主题下首页投信仍然正常、管理台默认 tab 能看到常规来信（活动 tab 看不到常规信，符合预期）

### PR2 · 管理台改造

- [ ] `/mail` 顶部改为**主题 tab 栏**（参考 `app/admin/components/AdminTabsNav.tsx`）：常规信箱 + 各主题 + `📁 往期活动 (N)` + `+ 新建主题` + `⚙ 全局设置`
- [ ] 每个主题 tab：标题 / 未读数 badge / 按 `state` 染色（进行中 / 未开始 / 已结束）
- [ ] "已结束"状态的 tab 带 `待归档` 小图标，一键归档（不进主题内部）
- [ ] 主 tab 栏末尾：当有 ≥ 3 个"已结束"主题时显示 `一键归档全部 →` 提示
- [ ] `📁 往期活动` 抽屉 / 模态：搜索、年份分组、查看信件、恢复（清空 `archived_at`）
- [ ] 新建主题表单（校验 slug 唯一、`[a-z0-9-]`、时间窗合理）
- [ ] 选中某主题后，右侧内容区展示：开关 / 编辑 / 归档 / 分享链接 + 收件箱 + 待审核 + 二维码
- [ ] 消息列表按 `topicId` 筛选 + counts 按 topic 切换
- [ ] 黑名单 / 敏感词 页尾统一展示，不随主题切换
- [ ] 每个主题 tab 内部放自己的"开关 / 编辑 / 归档 / 复制链接"按钮（不再有"全局总开关"按钮）
- [ ] 归档按钮点击 → 读响应里的 `unreadCount` / `flaggedCount`，非 0 时弹二次确认（取消 / 先标已读再归档 / 仍然归档）
- [ ] **拉黑文案更新**：`@c:\Users\ASUS\Desktop\Next.js网页开发\Next_UliUli\components\mail\FlaggedMailPanel.tsx` 的拉黑确认弹窗明确标注"TA 以后给**常规信箱 + 所有未来活动主题**投信都会被静默丢弃"，避免主播误以为只屏蔽当前主题

### PR3 · 公开投信页 + 全站活动入口

- [ ] `app/m/[slug]/page.tsx` SSR 主题投信页
- [ ] `app/m/page.tsx` SSR 多活动列表页（同时≥ 2 个活动时的汇总页）
- [ ] 主题状态文案（未开始 / 已结束 / 已归档）
- [ ] 管理台：每个主题的二维码 + 海报生成（复用 `WindChimeQrCard`）
- [ ] `components/mail/ActiveTopicsBanner.tsx` 全站顶部活动横幅
  - 1 条 → `<Link href="/m/{slug}">`
  - 2 条以上 → `<Link href="/m">` 聚合提示
  - `×` 按钮 + `sessionStorage` 记忆
- [ ] 在 `app/layout.tsx` 的 `<body>` 里挂载横幅（`{children}` 之前）
- [ ] **横幅数据源走 `/api/config.activeTopics`**（复用现有 15s 轮询，不单独请求 `/api/mail/topics`；防直播引流并发击穿 DB）；空列表时静默不渲染
- [ ] `MailSpeedDial` 去掉独立的 30s `/api/mail/settings` 轮询，改读 `siteConfig.mailEnabled`（由 `/api/config` 注入）；`MailSendModal` 打开时仍保留对 `/api/mail/settings` 的兑底读取（避免 `/api/config` 偶发失败导致 modal 一直禁用）
- [ ] 排除页：`/mail`、`/m`、`/m/{当前 slug}` 不显示
- [ ] `/api/config` 服务端同时生成 `activeTopics` 和 `mailEnabled` 两个字段：
  - `activeTopics` = 仅 `is_enabled=1 AND archived_at IS NULL AND is_default=0 AND 在时间窗内` 的主题（每条带 `slug` + `title`，用于横幅文案拼接）
  - `mailEnabled` = default 主题的 `is_enabled`（给 `MailSpeedDial` / `MailSendModal`）
- [ ] `/m/[slug]` 命中**未知 slug**（数据库根本没有）→ `notFound()` → HTTP 404
- [ ] `/m/[slug]` 命中**已归档 slug**（`archived_at IS NOT NULL`）→ **正常 SSR 渲染"活动已结束"页，HTTP 200**，并在 `<head>` 里 `<meta name="robots" content="noindex, nofollow">` 防搜索引擎长期收录
- [ ] `middleware.ts` 的 `matcher` 追加 `/m/:path*` 等价段，避免过期主题被搜索引擎永久收录

---

## 9. 待主播确认的问题

> 打 `[x]` 或直接改这份文档。

- [✅] **开主题时常规信箱是否自动关闭？**（已确认）
  - 主题与常规完全独立，主播手动分别开关

- [✅] **slug 由谁定？**（已确认）
  - 主播在新建时填写；校验唯一 + 只允许 `[a-z0-9-]` + 不能命中保留字黑名单（见 §5.1）

- [✅] **时间窗功能是否第一版就加？**（已确认）
  - 第一版加；主播可预约活动开始 / 结束时间，也可随时手动提前关闭
  - 表单默认勾选时间窗（开始=现在，结束=一周后）；取消勾选 → 气泡警告"≈ 常规信箱平行版"后允许存 NULL

- [✅] **访客从哪里知道有主题活动？**（已确认）
  - 主播在直播间 / 社媒分享主题链接 / 二维码
  - **全站顶部活动横幅**（类似导航栏，有活动时常驻，无活动时完全隐藏）
  - 横幅 title 由主播手写（含 emoji），系统拼接固定尾巴 `· 点此投信 →`

- [✅] **顶部横幅是否允许访客临时关闭？**（已确认）
  - 提供 `×` 按钮 + `sessionStorage` 记住；换标签页 / 重启浏览器后再出现
  - `×` 按钮 `onClick` 必须 `e.stopPropagation()` 阻止冒泡触发整条横幅的 `<Link>`

- [✅] **同时有多个活动主题时怎么展示？**（已确认）
  - 一条聚合横幅 `🎉 N 个活动进行中 · 查看全部 →`，点击跳活动列表页 `/m`
  - 聚合文案由系统固定（多主题时展开主播 title 会太长）

- [✅] **主题归档后，普通访客访问 `/m/{slug}` 看到什么？**（已确认）
  - **HTTP 200 + 友好提示页**"活动已结束，期待下次相遇"
  - 页面里 `<meta name="robots" content="noindex, nofollow">` 防搜索引擎长期收录
  - 注意区分：**未知 slug**（数据库根本没有）仍是 `notFound()` → 404

- [✅] **主题能否自带独立的"敏感词 / 限流阈值"？**（已确认）
  - 全部复用全局配置，不做每主题独立阈值

- [✅] **时区规范（已确认）**
  - 所有主播可见的时间输入/展示 = **北京时间（Asia/Shanghai）**，定死
  - 管理台输入控件：旁边提示"按北京时间"；提交前 `new Date(localInput + ':00+08:00').toISOString()` 入库
  - 展示回读：统一 `toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })`
  - DB 列：永远存 UTC Z 串（和现有 `created_at` 风格一致）

- [✅] **全局总闸已废弃（已确认）**
  - 每个主题（含常规信箱）各自独立开关，互不影响
  - 关闭常规信箱 = 首页左下角按钮变灰 + `MailSendModal` 禁用态（读 default 主题的 `is_enabled`）
  - 关闭活动主题 = `/m/{slug}` 显示"活动暂停中"，不影响其它主题
  - 旧 `mail_settings.mail.enabled` 一次性迁移到 default 主题后即停用

---

## 10. 参考

- Dreamail 新建收件组截图（见对话上下文）
- 现有实现文件：
  - `lib/db.ts` — DB schema + helpers
  - `app/api/mail/messages/route.ts` — 现有投递 / 列表接口
  - `app/api/mail/settings/route.ts` — default 主题开关透传端点（改造后；原总闸，v2 语义切换）
  - `app/mail/page.tsx` — 管理台
  - `components/mail/MailSendModal.tsx` — 首页投递浮层
