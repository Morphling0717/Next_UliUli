# Next_UliUli Codex 交接说明

> 更新时间：2026-07-27
>
> 适用仓库：`Morphling0717/Next_UliUli`
>
> 当前工作重点：名字大乱斗，以及新 NPC“柚子·预言家”
>
> 本文不包含任何密码、私钥、生产环境变量或隐藏调试暗号。

## 0. 接手后先做什么

接手这项工作时，先按以下顺序确认现场，不要一上来重构或重置工作区：

```bash
pwd
git status --short --branch
git log -5 --oneline --decorate
npm ci
npm run test:namearena
```

必须先阅读：

1. 本文。
2. `NAMEARENA_DEEP_AUDIT.md`。
3. 与当前任务有关的 `docs/NAMEARENA_*.md` 或 NPC 文档。
4. `scripts/namearena/regression/architectureCases.ts` 中的架构契约。

重要原则：

- 工作区可能是脏的。不要 `git reset --hard`，不要删除或覆盖未确认的文件。
- 名字大乱斗刚完成状态底层统一，绝不能重新引入第二套状态机制。
- Bug 修复和机制重构期间不要顺手调整角色强度，平衡必须单独验证。
- 用户要求“深度测试”或“人工审查日志”时，自动扫描不等于完成，必须逐条阅读有代表性的完整战报。
- 除非用户明确要求，否则不要推送 GitHub，也不要部署生产服务器。
- 部署时数据库保护高于一切，任何时候都不能覆盖服务器的 `data/codes.db`。

## 1. 当前 Git 与线上快照

### Git

- 当前分支：`main`
- 本地 HEAD：`8aac8112709e33f5a442f88a0919b834c0ec9d11`
- `origin/main`：同一个提交
- 提交标题：`refactor(namearena): unify status and battle presentation`
- 远端：`git@github.com:Morphling0717/Next_UliUli.git`

该提交包含：

- 名字大乱斗状态底层彻底统一。
- 形态转换和视觉事件权威化。
- 战斗日志、播放同步、动画去重与 UI 深度审查修复。
- 组合状态详情去重。
- 角色详情独立锁定模式和状态弹窗持久化。
- 相关回归、机制、视觉、因果和覆盖测试。

### 当前未提交文件

当前机器上至少有以下未跟踪内容：

- `docs/namearena-npc-yuzu-prophet.md`
  - 本轮新增。
  - 是新 NPC“柚子·预言家”的策划文档。
  - 尚未实现代码，尚未提交、推送或部署。
- `CODEX_HANDOFF.md`
  - 即本文。
- `docs/假面骑士吧删帖理由细化`
  - 与当前名字大乱斗任务无关的个人文档，不要擅自提交或删除。
- `output/`
  - 生成的 PDF 等产物，不要默认提交或删除。

接手后再次执行 `git status --short`，以实际输出为准。

### 生产环境

截至 2026-07-27：

- 公开地址：`https://www.uliuli.cc`
- `/api/health`：`status=ok`
- SSH 别名：`UliUli`
- 项目目录：`/opt/1panel/www/uliuli/app`
- Docker Compose 服务：`website`
- 容器名：`uliuli-website`
- 服务器 HEAD：`8aac8112709e33f5a442f88a0919b834c0ec9d11`
- 当前镜像 ID：`sha256:09a7bb839a55c6bc4c58d63fabf78269c1e20e7c4d02e0a6d34d61e09b3cc21e`
- 上一个回滚标签：`app-website:rollback-4c19c53`
- 服务器 Git 远端使用 SSH 别名 `github.com-uliuli`。

当前生产数据库通过宿主机目录挂载：

```text
/opt/1panel/www/uliuli/app/data       -> /app/data
/opt/1panel/www/uliuli/app/public/pic -> /app/public/pic
/opt/1panel/www/uliuli/app/public/memes -> /app/public/memes
```

2026-07-27 健康检查所见：

- 歌曲 308 首，隐藏 21 首。
- 抽卡用户 9，资料 9，库存记录 358。
- migration 全部已应用。
- 最新自动备份为 `/app/data/backups/codes-20260726T191702Z.db`。
- 最新备份 SHA-256 为 `8032816d86a47ae3b4c4c28173bb79a008e6b843914b80d0dbc9a5d7b88fe9d8`。

这些数字只是交接时快照，不应被写成永久断言。

## 2. 当前待办：柚子·预言家

新 NPC 设计已经整理到：

```text
docs/namearena-npc-yuzu-prophet.md
```

当前状态：

- 只有策划文档。
- 未进入战斗代码。
- 未加入测试。
- 未制作视觉资源或专属动画。
- 未提交、未推送、未部署。

不要在用户尚未要求实现时提前写代码。用户可能还会继续修改这份设计。

### 核心设计摘要

- 只在普瑞赛斯进入二阶段、且柚子存活时有 50% 概率登场。
- 身份为 NPC，不会成为胜利者。
- 一阶段叫“巴别塔的恶灵”。
- 一阶段接管所有“明日方舟”阵营召唤物；若没有可接管对象则召唤史尔特尔。
- 柚子和柚子·预言家永远互相优先锁定，不受嘲讽影响。
- 柚子死亡前，预言家无视除柚子以外来源的伤害和状态。
- 被接管召唤物攻击柚子时改为双方释放技能并拼点。
- 被接管召唤物死亡后变成源石结晶。
- 柚子死亡或被接管召唤物全部死亡时，预言家进入二阶段。
- 二阶段技能和受到攻击时围绕拼点、矿石病、沉沦与震颤展开。
- 达到退场条件时与普瑞赛斯、阿喃那、被接管召唤物、源石结晶共同退场。
- 出现预言家的对局取消原普瑞赛斯结算弹窗，改用新的长退场台词。

### 实现前必须向用户确认的歧义

以下内容不能靠猜测直接写死：

1. “明日方舟阵营召唤物”的完整范围。
   - 当前明显候选有 `ARKNIGHTS_OP` 的史尔特尔。
   - 鸮的诗怀雅、琳琅诗怀雅、幽灵鲨、归溟幽灵鲨也来自明日方舟，但用户尚未明确它们是否全部可被接管。
2. 拼点的点数公式。
   - 当前引擎没有通用拼点系统。
   - 需要确认使用技能威力、属性、随机范围、士气还是独立骰点。
3. 拼点时“同时释放技能”的技能选择规则。
   - 是各自正常选技、锁定当前技能，还是使用专门拼点技能。
4. 一阶段登场后新生成的明日方舟召唤物是否也会立即被接管。
5. 对非柚子来源的完全免疫是否包含环境伤害、自伤、绝对驱散和水人处决。
6. 预言家自身死亡导致全事件退场时，是否沿用普瑞赛斯现有的全场矿石病清除规则。
7. 拼点失败获得的 50% 额外减伤，是否与常规减伤乘算。

### 预计实现入口

若用户确认开始实现，优先考虑：

- 新建 `lib/namearena/yuzuProphetMechanics.ts`，集中管理 NPC 阶段、接管和拼点。
- 在 `lib/namearena/puruisaishiMechanics.ts` 接入登场与共同退场事件。
- 在 `lib/namearena/types.ts` 增加必要的结构化 NPC/接管状态，避免散落动态字段。
- 在 `lib/namearena/targeting.ts` 和统一伤害入口接入强制互锁及免疫。
- 技能可放入独立的 `lib/namearena/skills/yuzuProphet.ts`，再从 `skills.ts` 汇总。
- 在 `scripts/namearena/regression/` 新建定向用例，不要把所有用例塞进一个已有大文件。
- 拼点结果、召唤接管、共同退场都必须产生结构化日志元数据。

NPC 不应加入玩家输入列表，也不应通过 `fighterFactory.ts` 的普通名字映射生成。

## 3. 项目整体

这是 UliUli 的个人站点与互动系统，不是 npm 库。

主要技术：

- Next.js 16.2.9 App Router
- React 18
- TypeScript
- Tailwind CSS 4
- SQLite `sqlite3`
- Three.js、GSAP、Framer Motion
- Node.js 20
- Docker Compose

主要系统：

- 主页、视频、歌单、社交链接与 SEO/PWA。
- 后台配置和服务端 session。
- 抽卡、兑换码、账号云端进度和一次性本地进度导入。
- 匿名发信箱。
- B 站站内代理 `/api/bilibili`。
- 健康检查 `/api/health`。
- 名字大乱斗 Name Arena。
- DGP 战斗模拟器。

优先阅读根目录 `README.md`。数据库和非 Name Arena 系统的说明以 README、migration 与 API 代码为准。

## 4. 名字大乱斗目录和职责

### 战斗总控

- `lib/namearena/battleEngine.ts`
  - 战斗循环、死亡、胜负、召唤和复杂跨系统接线。
- `lib/namearena/battleRuntime.ts`
  - 将各运行时模块装配到引擎。
- `lib/namearena/battleState.ts`
  - 大回合与战斗状态。
- `lib/namearena/turnFlow.ts`
  - 行动者、控制跳过、等待反击和胜负流程。

### 行动与伤害

- `lib/namearena/actionResolution/`
  - 攻击、反击、命中、前置与后置效果。
- `lib/namearena/damageResolution.ts`
  - 权威伤害计算。
- `lib/namearena/damageRedirects.ts`
  - 屑、阿喃那、帝王之征、沫沫、柚子等转移与分摊类型。
- `lib/namearena/combatLedger.ts`
  - 伤害与统计归属。
- `lib/namearena/targeting.ts`
  - 目标选择、嘲讽、特殊拦截和傀儡小汀。

### 角色

- `lib/namearena/jobs.ts`
  - 职业、阶段职业、面板倍率和技能列表。
- `lib/namearena/fighterFactory.ts`
  - 玩家输入名到特殊角色初始职业的映射。
- `lib/namearena/skills/<角色>.ts`
  - 技能定义。
- `lib/namearena/characterHooks/<角色>.ts`
  - 转阶段、选技、额外行动、复活和角色专属流程。
- `lib/namearena/*Mechanics.ts`
  - 复杂角色、NPC 或召唤体系的独立机械。

遵循现有约定：一个角色或完整技能族一个技能 TS，不为追求小文件强行拆散角色语义。

### UI 与播放

- `components/namearena/NameArenaGame.tsx`
  - 输入、经典界面、战斗播放状态和新版舞台入口。
- `components/namearena/NameArenaBattleStage.tsx`
  - 新舞台、角色卡、动画、日志、详情与状态弹窗。
- `components/namearena/StatusDetailContent.tsx`
  - 经典和新舞台共用的状态详情。
- `lib/namearena/battlePlaybackModel.ts`
  - 日志与权威战斗快照提交。
- `lib/namearena/battlePresentation.ts`
  - 形态转换和可视事件。
- `lib/namearena/battleVisualLedger.ts`
  - 每局视觉事件去重。
- `lib/namearena/battleVisualTiming.ts`
  - 日志与动画共享时长。
- `lib/namearena/stageAnimationScheduler.ts`
  - 全屏动画队列与取消。
- `lib/namearena/combatEffects.ts`
  - 技能到战斗特效、角色位移与冲击表现的映射。

## 5. 状态系统：严格单轨

这是当前最重要的架构边界。

### 权威数据

- 战斗状态只存放在 `fighter.statuses: StatusInstance[]`。
- 护盾只存放在 `fighter.barriers: BarrierEntry[]`。
- 不再存在 `fighter.status`。
- 不再存在 `StatusEntry`、`legacyType`、`timedStatModifiers`、`statusLifecycle`、`statusRules` 或 `STATUS_EFFECTS` 运行时规则表。
- 士气和失衡槽是角色资源，但只能由统一状态机械影响，不构成第二套状态生命周期。

### 权威文件

- `lib/namearena/types.ts`
  - `StatusInstance`、`BarrierEntry`、应用、驱散和伤害类型。
- `lib/namearena/statusRegistry.ts`
  - 唯一机械目录、身份目录和护盾身份目录。
- `lib/namearena/statusSystem.ts`
  - 唯一施加、查询、消耗、移除、驱散、推进和护盾服务。
- `lib/namearena/statusMechanics.ts`
  - 灼烧、流血、中毒、破裂、震颤、士气等实际机械。
- `lib/namearena/statusProcessing.ts`
  - 状态时钟、行动机会结算和特定生命周期衔接。
- `lib/namearena/statusPresentation.ts`
  - UI 与日志共用的中文展示模型。

### 只能使用的接口

新增或修改状态时使用：

- `applyStatus`
- `applyStatusBundle`
- `queryMechanic`
- `hasMechanic`
- `findIdentity`
- `hasIdentity`
- `consumeStatusValue`
- `removeEffects`
- `dispelEffects`
- `advanceEffects`
- `grantBarrier`
- `consumeBarriers`

禁止：

- 在 `statusSystem.ts` 外直接 `push/splice/filter` 或重新赋值 `fighter.statuses`。
- 在角色技能和 Hook 中直接遍历、读取或修改内部状态实例。
- 用字符串前缀猜通用机械。
- 使用 `duration: 999` 表示永久状态。
- 未注册身份或机械就直接施加。
- 直接修改状态的 `potency/count/remainingTurns/charges`。

`scripts/namearena/regression/architectureCases.ts` 会静态扫描这些违规行为。新增状态时必须先注册目录，再写角色技能。

### 组合状态

- 一个主题状态可以展开成多个机械实例。
- 同一主题通过 `groupId` 在 UI 合并。
- 展示使用“主题摘要 + 效果列表 + 共享来源/时钟/驱散信息”。
- 不得在 UI 暴露内部 ID。
- 不要重新把组合状态详情做成每个机械重复整段说明的形式。

## 6. 形态、日志和动画契约

### 形态转换

运行中的 `job/jobData/transformed` 等形态字段只能通过 `commitFormTransition` 修改。

- 真正的 1→2、2→3 使用 `transformation`。
- 同阶段换职业、复活换形态、重新部署使用 `form_shift`。
- 每条视觉事件必须有唯一 `visualCueId`。
- 不允许从中文日志、职业前后快照或技能名猜测是否变身。
- 阶段转换、必杀、召唤动画属于互斥视觉分类。

架构测试会扫描绕开统一形态入口的直接赋值。

### 战斗日志

日志必须回答：

- 谁发动了什么。
- 为什么触发。
- 命中了谁。
- 原始效果和实际效果是什么。
- 护盾、分摊、转移、锁血、复活后实际损失多少。
- 谁因此死亡，击杀和伤害归属给谁。

同一攻击的技能、伤害、状态、转移和死亡要共享根事件与行动元数据。不要只补一句文案掩盖错误的结算顺序。

### 动画

- 普攻、普通技能、必杀、转阶段、形态切换、召唤卡片必须显式分类。
- 不得用日志文字猜施法者或目标。
- 角色近战位移必须完成“接近、命中、回位”的完整时序。
- 小汀自爆的固定时序是：贴近目标 → 蓄力 → 自爆 → 回到原位 → 触发吸血。
- 牢鳄普通召唤物不播放高级召唤物必杀动画。
- 青眼白龙、青眼究极龙、翼神龙、黑暗大法师有独立卡片召唤动画。
- 新战斗、切页、组件卸载、页面隐藏时必须取消旧 RAF、计时器、位移和延迟后续。

## 7. 当前角色与不可误改的设计

特殊角色名单由 `scripts/namearena/shared/harness.ts` 的 `SPECIALS` 定义：

```text
水人、玄凝、小汀、牢鳄、克蕾儿丝菲尔、丝瓜uli、兔卷卷、
刺猬人、屑、M1A2_abrams_sep、表情、柚子、鸮、萌月沫沫
```

### 全局原则

- 水人是规格外最强角色，不纳入无水 FFA 平衡目标。
- 水人的处决和绝对驱散可以斩杀/清除“不甘倒下”“悲愿不倒”等规则，但不能绕过一阶段进入二阶段的阶段锁血。
- “好大儿”是玄凝，不是丝瓜。
- “我的 baby”是丝瓜，不是玄凝。
- 特殊角色通常在半血附近进入二阶段；除非用户明确设计例外，不要提前转阶段。
- 大回合指当前参与者各获得一次行动机会后完成，不是固定若干秒，也不是每名角色独立拥有的大回合。
- 修 Bug 时不要把角色特色当成异常删掉。

### 高风险角色规则

#### 小汀

- 掉落脊髓剑是核心特色，也给牢鳄被针对提供补偿，不能删除。
- 除牢鳄的专属逻辑外，其他角色拿到脊髓剑后都在“自身技能”和“使用脊髓剑”之间随机。
- 自爆可以高伤害，但不能一次把二阶段满血牢鳄和自己一起炸死，导致战局瞬间少两人。
- 当前动画时序不能回退。

#### 牢鳄

- 核心身份是欧皇、氪金、游戏王和召唤师，不应重新塞回大量无关直伤技能。
- 高级召唤物为青眼白龙、青眼究极龙、拉的翼神龙和黑暗大法师。
- 召唤物的伤害和击杀必须归属牢鳄。
- 欧气满时可立即获得一次行动机会，避免欧气满却一直轮不到行动。
- 强欲之壶可以抽两张；抽到另一张强欲之壶可以继续套娃，这是刻意的欧皇特色。

#### 克蕾儿丝菲尔与兔卷卷

- 克蕾儿主动取得的魅惑反击是 100% 触发。
- 兔卷卷通过风格获得的常驻魅惑反击为 50%，避免帝皇铠甲状态下无人能攻击她。
- 这两个概率必须分开，不能为了兔卷卷削弱克蕾儿。

#### 丝瓜uli与兔卷卷

- 双方触发“摸鱼伙伴羁绊”进入场外 OB 时不行动、不可被选中、免疫攻击与技能。
- 敌对兔卷卷也可能触发摸鱼，这是正常特色。
- OB 结束后回场并恢复。

#### 刺猬人

- 武神王座是刺猬人专属技能，其他角色不能随机选到。
- 三阶段仍可使用二阶段技能。
- `GREAT MONSTER VICTORY` 的一次性反击必杀必须保留。
- `彩虹狂热` 也是三阶段一次性必杀。
- 不会从“奇迹怪兽武刃”退回“奇迹武刃”。
- “境界标记”不可驱散，不能因为它无法驱散而无限重复使用奇迹炼成装甲。

#### 屑

- 伤害转移必须有明确前因日志。
- 持续伤害和 debuff 自身结算不能被无条件转移，否则机制过强且因果混乱。

#### M1A2_abrams_sep

- 设计原型是 War Thunder 玩家，允许略强于普通特殊角色。
- 苏-30SM2 洗地不能轻易一次清空全场。
- 清理不同异常时必须使用符合类型的文案，灼烧可写灭火器，中毒不能写成灭火器扑灭。

#### 表情

- 只剩两名玩家时的最终认主挑战是特色，不是 Bug。
- 零杀锚点不能把普瑞赛斯、阿喃那或源石结晶算作玩家击杀目标。

#### 柚子

- 团队战受到的有效伤害全部随机均摊给最多三名存活队友。
- FFA 被萌月沫沫临时认主时视为进入团队模式；沫沫死亡并解除临时队伍后，柚子应能按队友死亡规则进入三阶段。
- 三阶段只有技能实际打到标记目标才计数，同一个大回合最多计数一次。
- 计数达到 9 解锁 `Furioso-Replica`，释放后清零。
- 傀儡小汀挡下攻击时，攻击傀儡仍可为 Furioso 计数。
- 三阶段可以随机标记源石结晶，但不能优先把结晶作为标记目标。
- 一阶段普瑞赛斯和阿喃那不可成为柚子标记对象。

#### 鸮

- 玩家和召唤物真实死亡都会增加天意。
- 普瑞赛斯、阿喃那和源石结晶死亡不增加天意。
- 【过江！过江！】的定义是协同攻击被标记者攻击的同一个受害者。
- 如果被标记者攻击鸮自己的召唤物，鸮仍协同攻击该召唤物，这是已确认的设计取舍。

#### 萌月沫沫

- FFA 随机认主有次数上限。
- 重新组队不能选择 NPC。
- OB 时暂时移除舰长，回场后自动重新获得，众宾欢不会因此消失。
- 不可叠加的装备状态会替换；醒剑直接替换村好剑。

## 8. 普瑞赛斯事件

- 策划文档：`docs/namearena-npc-puruisaishi.md`
- 实现：`lib/namearena/puruisaishiMechanics.ts`

当前主要规则：

- 是 NPC，不会成为胜利者。
- 一阶段普瑞赛斯不可被选中，也不受 AOE。
- 阿喃那和源石结晶按全局行动回合推进增殖。
- 普瑞赛斯出场 50 个全局行动后进入二阶段。
- 二阶段护盾存在时，玩家会更积极共同压制源石网络与普瑞赛斯。
- 有源石结晶时护盾保留最后 1 点；结晶清空后才可破盾退场。
- 护盾归零后清除全场矿石病并退场。
- 当前代码随机登场窗口为全局行动 30 到 260，每次判定概率 `0.0015`。
- 输入解析中存在 hash 校验的强制事件调试入口，位于 `lib/namearena/setupInput.ts`。

不要把隐藏调试暗号明文写进源码、文档、日志或回复。测试中优先使用结构化的 `forcePuruisaishi` 入口。

此前策划希望登场局击退率约 50% 到 55%。最新不同样本曾出现约 57% 到 62%，属于后续平衡观察，不是当前结算 Bug，除非用户要求不要擅自调数值。

## 9. 新舞台与角色详情

当前正确行为：

- 玩家点击角色卡、日志头像或状态后，进入独立手动锁定模式。
- 锁定只绑定角色 ID 和当前 `battleRunId`，不随行动、回合或 x1/x2/x3 变化失效。
- 再次点击同一角色、点击战场空白处、点击“恢复跟随”会解除锁定。
- 新战斗、重置大厅、切换界面或锁定 NPC/召唤物退场时自动解除。
- 普通玩家死亡后仍可继续查看尸体详情。
- 状态弹窗不会因其他角色行动或全屏动画关闭。
- 状态自然结束后弹窗保留最后信息并显示“该状态或资源已结束”。
- 全屏动画期间详情卡可暂时隐藏，弹窗保持置顶，动画结束后恢复原锁定。

相关文件：

- `lib/namearena/battleStageModel.ts`
- `components/namearena/NameArenaBattleStage.tsx`
- `components/namearena/NameArenaBattleStage.module.css`

`NAMEARENA_DEEP_AUDIT.md` 的 UI 章节仍写着“下一次行动恢复跟随”，那是本次锁定修复之前的旧描述，不再成立。

## 10. 测试与审查

### 快速必跑

```bash
npm run test:namearena
npm run test:namearena:mechanisms
npm run lint
npx tsc --noEmit
npm run build
```

### 视觉、因果和覆盖

```bash
npm run test:namearena:visual
npm run test:namearena:causal
npm run test:namearena:coverage
npm run test:namearena:coverage-parallel
```

### 平衡与大型压力测试

```bash
npm run test:namearena:stress
npm run test:namearena:balance-parallel
```

并行无水 FFA 默认 15,000 场、基准种子 `1910000`，输出：

```text
.tmp/namearena-deep-audit/no-water-15000.json
```

可通过环境变量调整：

```bash
NAMEARENA_BALANCE_BATTLES=15000 \
NAMEARENA_BALANCE_BASE_SEED=1910000 \
NAMEARENA_BALANCE_WORKERS=4 \
npm run test:namearena:balance-parallel
```

### 最近已通过的基线

提交 `8aac811` 完成时：

- 回归：301 场全部通过。
- 机制矩阵：248 场全部通过。
- 视觉审计：1,000 场，超过 400 万结构化事件，错误为 0。
- 最终无水 FFA：15,000 场，无超时、运行错误、状态不变量错误或日志错误。
- TypeScript、ESLint、Next 生产构建通过。
- 生产环境 x3 实测锁定角色经过 14 个全局行动不跳转，状态弹窗保持打开。

`NAMEARENA_DEEP_AUDIT.md` 记录了更完整的规模、问题根因和胜率快照。

### 人工日志审查标准

用户要求人工审查时：

1. 保存完整战报，不只看摘要。
2. 按事件编号逐条阅读。
3. 检查行动前因、目标、命中、伤害、护盾、分摊、转移、状态、锁血、复活、死亡和胜负。
4. 对所有自动扫描失败种子额外复核。
5. 至少覆盖无水 FFA、含水 FFA、2v2 到 5v5、普瑞赛斯、召唤密集、OB 和高反击对局。
6. 发现问题先记录复现种子和上下文，再修根因并补回归。

不要声称“人工逐条审查全部 15,000 场日志”。合理做法是自动检查全部、人工逐条读覆盖矩阵和所有异常样本，并如实报告范围。

## 11. 文档可信度

### 当前优先级较高

- `CODEX_HANDOFF.md`
- 当前 TypeScript 代码
- `scripts/namearena/regression/architectureCases.ts`
- `NAMEARENA_DEEP_AUDIT.md`
- 各角色最新策划文档

### 已知部分过期

`docs/NAMEARENA_MAINTENANCE.md` 仍包含旧状态架构描述，例如：

- 建议把状态加入 `data/constants.ts` 的 `STATUS_EFFECTS`。
- 把 `statusProcessing.ts` 描述为全部状态规则入口。

这些内容在状态底层统一后已经过期。新增状态必须使用 `statusRegistry.ts` 和 `statusSystem.ts`。

`NAMEARENA_DEEP_AUDIT.md` 的本轮边界写着“未推送、未部署”，那是审查完成当时的记录。之后整个版本已经提交、推送并部署到生产。

## 12. 浏览器与性能验证

名字大乱斗 UI 改动不能只看代码。

至少检查：

- 1440×900
- 1920×1080
- 844×390
- 932×430
- 390×844

关注：

- 2、9、14、18、19+ 单位布局。
- 卡片重叠、文字遮挡和技术长名称。
- 状态中文名、组合状态详情和内部 ID 泄漏。
- 蓝色护盾血条。
- 经典/新舞台切换。
- x1/x2/x3 下日志与伤害帧同步。
- 转阶段、形态切换、必杀和召唤动画是否重复。
- 连续多局后 RAF、计时器、Canvas、DOM 和视觉对象是否增长。

开发环境卡顿时先检查是否残留多个 `next dev` 或压力测试进程。不要先假定是网页性能问题。

## 13. 安全部署标准流程

只有用户明确要求部署时执行。

### 迁移到新电脑前

SSH 别名、私钥和 GitHub 身份不会随仓库自动迁移。新电脑需要单独配置：

- `UliUli` SSH 别名。
- GitHub SSH 或 `gh` 登录。
- 本地 `.env.local`。

不要把私钥或生产 `.env` 提交到仓库。

### 部署前检查

```bash
ssh UliUli
cd /opt/1panel/www/uliuli/app
git status --short --branch
git rev-parse HEAD
docker inspect uliuli-website --format '{{.Image}}'
docker compose ps
```

服务器仓库必须干净。若有不明修改，先停止部署并调查。

### 数据库备份

在旧容器仍运行时：

```bash
docker compose exec -T website npm run db:backup
curl -fsS http://127.0.0.1:3000/api/health
```

记录备份路径、大小与 SHA-256，并用容器内的 SQLite Node 依赖执行 `PRAGMA integrity_check`。

本项目 Name Arena 改动不需要数据库 migration。不要因为“部署流程完整”就无条件运行 migration。

### 拉取、构建与切换

```bash
git pull --ff-only origin main
docker compose build website
docker compose up -d --no-deps --force-recreate --no-build website
```

构建新镜像期间保持旧容器运行。切换前记录旧镜像并创建回滚标签。

切换后检查：

```bash
docker inspect uliuli-website
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://www.uliuli.cc/api/health
docker logs --since 10m --tail 100 uliuli-website
```

确认挂载仍然是原宿主机目录，并比较数据库 inode、大小、完整性和关键记录数。

### 禁止操作

- 不要 `docker compose down -v`。
- 不要删除 `data/`。
- 不要从本地复制 `codes.db` 覆盖服务器数据库。
- 不要把旧备份自动恢复到仍健康的生产数据库。
- 不要使用 `git reset --hard` 清理服务器。
- 不要在健康检查失败时修改数据库尝试“修好”；只回滚应用镜像并继续挂载原数据库。

## 14. 用户协作偏好

- 默认使用中文沟通。
- 用户希望先理解角色设计理念，再讨论 Bug 或平衡。
- 对设计争议要明确区分：
  - 确定性 Bug：可直接修复。
  - 可能的平衡问题：先报告和压测，不擅自改。
  - 已确认特色：保留并补测试。
- 给策划看的角色文档不要塞内部 ID、TypeScript 字段或代码实现细节。
- 战斗日志必须让普通玩家看懂，不能显示 `YUZU_BARRIER` 之类内部名称。
- 用户非常重视前因后果、伤害数值、日志顺序和视觉同步。
- UI 目标不只是“合理”，而是让名字大乱斗真正像游戏；角色攻击和必杀应有与文本、设定一致的独特表现。
- 用户经常要求推送和部署，但只有当次明确提出时才执行。
- 部署汇报要写清提交、测试、备份、数据库完整性、健康检查和回滚点。

## 15. 推荐的下一次对话开场

接手 Codex 可以先向用户简洁确认：

> 我已经读取交接文档并核对仓库。当前线上与 GitHub 都在 `8aac811`，本地尚未提交的是“柚子·预言家”策划文档和交接文档；NPC 还没有进入代码。我会保留现有状态单轨、日志与动画架构，不动服务器数据库。接下来可以继续修改预言家设计，或在你确认拼点和明日方舟召唤物范围后开始实现。

然后根据用户最新指令继续，不要擅自把“可能的下一步”当成已经授权的任务。
