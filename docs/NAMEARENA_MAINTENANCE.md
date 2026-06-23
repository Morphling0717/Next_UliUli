# 名字大乱斗维护手册

这份文档记录 NameArena 的代码边界、扩展入口和测试要求。目标是让以后新增特殊角色、技能或状态时，不需要重新理解整个战斗引擎。

## 运行时结构

- `lib/namearena/battleEngine.ts`
  战斗总控。负责回合推进、胜负检查、死亡结算入口和对外兼容方法。

- `lib/namearena/battleRuntime.ts`
  各子模块 runtime 的装配层。这里只做接线，不写战斗规则。

- `lib/namearena/actionResolution/`
  攻击和技能行动解析：命中、反击、伤害后效果、吸血、击杀奖励、前置预瞄等。

- `lib/namearena/characterHooks/`
  特殊角色专属机制：变身、选技、复活、防止战斗提前结束、回场等。

- `lib/namearena/skills/`
  技能定义。原则是“一个角色或技能族一个 ts”，例如 `skills/rabbit.ts` 保持兔卷卷完整技能组，不再拆小文件。

- `lib/namearena/data.ts`
  数据聚合入口。外部仍然从这里拿 `namerenaData` 或具名数据池。

- `lib/namearena/data/`
  大型数据池按用途拆分：`constants.ts` 放 tag/status/color，`textPools.ts` 放随机台词，`gachaPools.ts` 放抽卡/红温/以命换命池，`supportPools.ts` 放歌姬、瓦学妹武器、baby 支援池，`rabbitPools.ts` 放兔卷卷计算器和人设池，`evolutionPools.ts` 放魅魔反击和合成兽插件池。

- `lib/namearena/damageResolution.ts`
  伤害数值计算。

- `lib/namearena/statusProcessing.ts`
  状态计时、持续伤害、脊髓剑状态同步。

- `lib/namearena/targeting.ts`
  目标选择和小汀傀儡拦截。

- `lib/namearena/summonResolution.ts`
  召唤、献祭、召唤物初始化。

- `lib/namearena/supportResolution.ts`
  治疗、buff、歌姬扩散、合成兽插件收益。

- `lib/namearena/turnFlow.ts`
  演员选择、胜负检查、无法行动日志、等待反击姿态。

## 新增特殊角色流程

1. 在 `lib/namearena/jobs.ts` 新增初始职业和必要的变身职业。
2. 在 `lib/namearena/skills/<角色或技能族>.ts` 新增技能定义。
3. 在 `lib/namearena/skills.ts` 汇总导出新技能组。
4. 在 `lib/namearena/fighterFactory.ts` 增加名字到初始职业的映射和特殊角色 flag。
5. 如果角色有专属规则，在 `lib/namearena/characterHooks/<角色>.ts` 新增 hook，并在 `characterHooks.ts` 注册。
6. 给 `scripts/namearena/regression/` 增加定点回归用例。
7. 跑完整测试链。

## 测试入口

- `npm run test:namearena`
  快速回归。包含特殊角色定点用例、规则契约校验、159 场小型战斗。

- `npm run test:namearena:stress`
  大型压力测试。覆盖有水人全特殊角色、无水人全特殊角色、2v2 到 5v5 所有特殊角色组合，并输出完整日志。

- `npm run test:namearena:compare -- <baselineRoot> <currentRoot> <reportPath>`
  A/B 日志对比。用于证明重构前后回合数、胜负、存活者和每条战斗日志完全一致。

测试工具主体在 `scripts/namearena/**/*.ts`，根入口 `scripts/namearena-*.js` 只负责注册本地 TS transpile hook 并启动对应 runner。当前 case 层保留迁移期宽类型，优先保证旧测试行为不漂移；后续可以按文件逐步收紧类型。

## 什么时候必须跑 A/B

只改文档、纯测试拆分，一般不需要 A/B。

以下改动必须跑 A/B：

- 改 `battleEngine.ts`
- 改 `battleRuntime.ts`
- 改 `actionResolution/`
- 改 `damageResolution.ts`
- 改 `statusProcessing.ts`
- 改 `targeting.ts`
- 改特殊角色 hook
- 改任何会影响随机数调用顺序的代码

## 规则契约校验覆盖

`scripts/namearena/regression/ruleContracts.ts` 会检查：

- 所有职业引用的技能都存在。
- 所有技能和池子条目的 tag/status/summonJob/newSkill 都存在。
- 专属技能没有挂到不该拥有的职业上。
- 特殊角色名字仍然映射到正确初始职业。
- 技能、职业、召唤物数值是有限数字。

如果新增状态，需要先加到 `lib/namearena/data/constants.ts` 的 `STATUS_EFFECTS`，再在技能里引用。

## 压力测试输出

默认输出目录是系统临时目录：

```bash
/tmp/namearena-mega-stress
```

可以通过环境变量改目录：

```bash
NAMEARENA_STRESS_OUT_DIR=/tmp/namearena-run npm run test:namearena:stress
```

主要文件：

- `summary.json`：总体是否通过、各 phase 统计。
- `battle-summaries.json`：每场战斗的回合数、存活者、日志路径。
- `issue-contexts.json`：最多 500 条问题上下文。
- `logs/`：每场战斗完整日志。

## 重构守则

- 先拷贝基线，再改代码。
- 能拆接线层就不要拆角色设计本体。
- 角色技能文件保持角色语义完整，不为了行数强行拆碎。
- 改运行时后，至少跑 `test:namearena`、`test:namearena:stress`、`test:namearena:compare`。
- 如果 A/B 出现日志差异，先判断是不是预期规则修复；如果不是，回到最小 diff 查随机数调用顺序。
