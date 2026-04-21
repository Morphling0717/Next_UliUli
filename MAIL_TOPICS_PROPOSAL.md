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

| 维度 | 现在的实现 |
|---|---|
| 数据表 | 单表 `mail_messages`（无分组字段） |
| 全局开关 | `mail_settings.mail.enabled`（布尔总闸） |
| 投递入口 | 首页浮动按钮 → `MailSendModal` → `POST /api/mail/messages` |
| 管理台 | `/mail` 密码进入，看全部来信 |
| 已具备 | 限流（IP/指纹）、Turnstile、敏感词、黑名单（sender hash）、二维码海报 |

**核心复用点**：所有基础设施（限流、反垃圾、海报）都可以**原样套用**到每个主题，不需要重写。

---

## 2. 方案总览

核心思路：

> **每条留言归属某一个"收件组（Topic）"。**  
> **默认有且仅有一个"常规收件组"**，历史留言自动落在这里 → 零破坏。  
> 主播可按需创建 N 个"主题收件组"，每个独立**开关 / 链接 / 海报 / 管理视图**。

总闸 `mail.enabled` 保留，一旦关闭 **所有** 主题都投不进（应急兜底）。

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

CREATE INDEX IF NOT EXISTS idx_mail_messages_topic_created
  ON mail_messages (topic_id, deleted_at, created_at);
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

---

## 4. URL / 路由设计

| 场景 | 现在 | 改造后 |
|---|---|---|
| 常规投信 | 首页浮动按钮 → `MailSendModal` | **不变**（隐式走 `default` 主题）|
| 活动发现入口 | — | **新增** 全站顶部**活动横幅**（仅在有启用中的非默认主题时出现，无活动时完全不渲染，详见 §6.3） |
| 主题投信页 | — | **新增** `/m/{slug}`，展示主题标题/说明，内置投信框 |
| 主题分享二维码 | — | 管理台为每个主题生成 `/m/{slug}` 的 QR + 海报 |
| 活动列表页 | — | **新增** `/m`（公开页），同时有 2 个及以上活动时由顶部横幅引导进入 |
| 管理台入口 | `/mail` 看全部 | `/mail` 顶部把每个主题平铺成 **tab**（参考 `app/admin` 的 `AdminTabsNav`），点击即切换 |
| 新建/编辑主题 | — | `/mail` tab 栏里的 `+ 新建主题` 按钮 |

> **为什么用 `/m/{slug}` 而不是 `/mail/{slug}`**：  
> `/mail` 是**管理员密码页**，放在同一前缀下容易和投信页混淆；`/m/` 短、专门给访客用。

---

## 5. API 变更

### 5.1 新增

| 方法 | 路径 | 权限 | 作用 |
|---|---|---|---|
| `GET` | `/api/mail/topics` | 公开 | 列出 `is_enabled=1 AND archived_at IS NULL`，按 `sort_order` 排序 |
| `GET` | `/api/mail/topics/{slug}` | 公开 | 取单个主题的公开信息（title、description、isEnabledNow） |
| `GET` | `/api/mail/topics` | 管理端（带 `x-mail-password`） | 返回**全部**主题（含归档） |
| `POST` | `/api/mail/topics` | 管理端 | 创建主题 |
| `PATCH` | `/api/mail/topics/{id}` | 管理端 | 改标题/说明/开关/时间窗/排序/备注 |
| `DELETE` | `/api/mail/topics/{id}` | 管理端 | 软删（写 `archived_at`）|

**管理端 GET 与公开 GET 共用一个路径**，内部根据是否有有效密码决定返回集合 → 和现在 `/api/mail/messages` 的风格一致。

### 5.2 改造 `POST /api/mail/messages`

- 入参新增可选 `topicSlug: string`；不传则视为 `'default'`
- 解析 slug → `topic_id`
- 校验：
  - 主题存在
  - `archived_at IS NULL`
  - `is_enabled = 1`
  - 当前时间在 `[starts_at, ends_at]` 内（端点缺省视为无限）
  - 总闸 `mail.enabled = 1`
- 任一不满足 → `423 Locked` + 具体文案
- 落库 `INSERT ... topic_id = ?`

### 5.3 改造 `GET /api/mail/messages`（管理端）

- 新增 `?topicId=xxx`（不传默认 `'default'`，保持现有 URL 行为）
- `counts` 按**当前主题**统计
- 如需跨主题汇总（未来扩展），再加 `?topicId=all`

### 5.4 `/api/mail/settings` 不变

- 继续管理**总闸** `mail.enabled`
- 主题级开关走 `/api/mail/topics/{id}` 的 `PATCH`

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
│ [ 📬 常规信箱 12 ]  [ 🎂 生日 2026 进行中 3 ]  [ � 中秋 未开始 ]│
│ [ � 周年 2026 已结束 · 待归档 ]                                 │
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
- `⚙ 全局设置`：现有总开关 `mail.enabled` + 敏感词配置

**为什么比下拉好**：

- 所有主题状态**一眼可见**（哪几个在开、各自多少未读）
- 日常切换**一次点击完成**（下拉要两次）
- 和现有 `@/Users/tmf_imac/Downloads/Next.js网页开发/Next_UliUli/app/admin/page.tsx:1` 的导航风格一致，零学习成本
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

| 状态 | 条件 | 主 tab 栏 | 📁 往期活动 |
|---|---|---|---|
| **常驻** | `is_default=1` | ✅ 永远最左，不可归档 | — |
| **进行中** | `is_enabled=1` AND `now ∈ [starts_at, ends_at]` AND `archived_at IS NULL` | ✅ 高亮（活动主色）| — |
| **未开始** | `is_enabled=1` AND `now < starts_at` AND `archived_at IS NULL` | ✅ 冷色/虚线 | — |
| **已结束** | `now > ends_at` AND `archived_at IS NULL` | ✅ 灰底 + "待归档"提示 | — |
| **已归档** | `archived_at IS NOT NULL` | ❌ 不显示 | ✅ |

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
  state: 'default' | 'active' | 'scheduled' | 'ended' | 'archived';  // ← 派生
  unreadCount: number;  // ← 管理端 join 消息表计算
};
```

前端拿到 `state` 直接用于染色 / 分组 / 排序，**无需自己算时间窗**。

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

- 客户端挂载后异步 `GET /api/mail/topics`（公开集合，只返回 `is_enabled=1 AND archived_at IS NULL AND 在 [starts_at, ends_at] 时间窗内 AND is_default=0` 的主题）
- **返回 0 条** → 横幅**完全不渲染**（DOM 都不占位，等于没有这个东西）
- **返回 1 条** → 显示：`🎂 [主题 title] · 点此投信 →`，整条横幅是一个 `<Link href="/m/{slug}">`
- **返回 2 条及以上** → 显示 `🎉 N 个活动进行中 · 查看全部 →`，整条横幅 `<Link href="/m">` 跳活动列表页（见 §6.5）

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
- 行为和现在 **100% 一致**
- **不在此处显示活动横幅**（活动横幅由 §6.3 的全站组件统一提供）

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
- 首页 `MailSendModal` 未改 API 形状 → 旧前端也能正常工作
- `GET /api/mail/messages` 不传 `topicId` 时默认返回 `default` → 旧管理台（如果有客户端缓存了旧代码）仍能看到期望中的数据

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
- [ ] **冒烟测试**：默认主题下首页投信仍然正常、管理台仍然能看到

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
- [ ] 横幅接入 `/api/mail/topics` 公开接口，空列表时静默不渲染
- [ ] 排除页：`/mail`、`/m`、`/m/{当前 slug}` 不显示

---

## 9. 待主播确认的问题

> 打 `[x]` 或直接改这份文档。

- [A] **开主题时常规信箱是否自动关闭？**  
  - **A**：主题与常规完全独立，主播手动分别开关 ✅ 当前方案默认
  - **B**：一旦开主题，常规自动关，结束后自动恢复

- [A] **slug 由谁定？**  
  - **A**：主播在新建时填写（需校验唯一、只允许 `[a-z0-9-]`） ✅ 已确认
  - **B**：系统自动生成短码（如 Dreamail 的 UUID）
  - **C**：系统自动从 title 拼音化生成，主播可改

- [A] **时间窗功能是否第一版就加？**  
  - **A**：第一版加，主播设置 `ends_at` 后自动关闭，主播可以预定活动时间，从什么时间开始到什么时间关闭，也可以手动提前关闭 ✅ 当前方案默认
  - **B**：第一版只做手动开关，时间窗留给后续

- [A+B] **访客从哪里知道有主题活动？**  
  - A：通过主播在直播间 / 社媒分享的主题链接/主题二维码进入
  - B：首页显示"当前活动：XXX"的横幅，点击跳转
  - **B+**：**全站顶部活动横幅**（类似导航栏，有活动时常驻，无活动时完全隐藏） ✅ 已确认

- [B] **顶部横幅是否允许访客临时关闭？**  
  - **A**：不可关闭，一直显示到活动结束
  - **B**：提供 `×` 按钮，访客关闭后用 `sessionStorage` 记住，刷新后再出现 ✅ 已确认
  - **C**：提供 `×` 按钮，用 `localStorage` 记住，除非主题有更新再弹出

- [B] **同时有多个活动主题时怎么展示？**  
  - **A**：一条横幅 + 跑马灯 / 轮播（每 5s 切一条）
  - **B**：一条横幅显示 "🎉 3 个活动进行中 · 查看全部 →"，点击去活动列表页 `/m`（需新增） ✅ 已确认
  - **C**：只显示 `sort_order` 最靠前的那一条，其余忽略

- [A] **主题归档后，普通访客访问 `/m/{slug}` 看到什么？**  
  - **A**：友好提示"活动已结束" ✅ 已确认
  - **B**：直接 404

- [A] **主题能否自带独立的"敏感词 / 限流阈值"？**  
  - **A**：全部复用全局配置 ✅ 当前方案默认
  - **B**：每个主题独立配置（工作量翻倍，不建议 v1 做）

---

## 10. 参考

- Dreamail 新建收件组截图（见对话上下文）
- 现有实现文件：
  - `lib/db.ts` — DB schema + helpers
  - `app/api/mail/messages/route.ts` — 现有投递 / 列表接口
  - `app/api/mail/settings/route.ts` — 现有总闸接口
  - `app/mail/page.tsx` — 管理台
  - `components/mail/MailSendModal.tsx` — 首页投递浮层
