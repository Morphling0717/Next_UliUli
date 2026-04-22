/**
 * DGP 平衡性常量。
 *
 * 把散落在引擎里的"魔法数字"集中管理，便于后续平衡性调优。
 * 每个常量都保留了 legacy 代码里的原始语义注释。
 */

// ===== 回合节点（Round Milestones）=====

/** 决胜阶段开启——从此 [DGP 骑士保护协议] 永久失效 */
export const DECISIVE_ROUND = 50;

/** GM 强制发放狂热大奖的"保底回合"（即使没有 boss，到此回合也必定触发） */
export const GM_FEVER_FORCE_ROUND = 25;

/** GM 狂热大奖的最早可能触发回合（需满足 2 个以上 boss 邪魔徒条件） */
export const GM_FEVER_EARLIEST_ROUND = 20;

/** 悬赏系统激活的最早回合（此回合之前不派发悬赏） */
export const BOUNTY_START_ROUND = 12;

/** GM 狂热后多少回合空投第一把指挥带扣（喷射器） */
export const COMMAND_DROP_OFFSET_FIRST = 3;

/** GM 狂热后多少回合空投第二把指挥带扣（喷射器） */
export const COMMAND_DROP_OFFSET_SECOND = 8;

/** 场地异变最早触发回合（第 10 回合必定首次触发） */
export const STAGE_EVENT_FIRST_ROUND = 10;

/** 每次场地结束后至少间隔多少回合才有机会再次触发 */
export const STAGE_EVENT_MIN_GAP = 5;

/** 场地持续回合数 */
export const STAGE_DURATION = 3;

// ===== 悬赏系统（Bounty）=====

/** 每次派发的悬赏持续回合数 */
export const BOUNTY_DURATION = 3;

/** 派发悬赏的基础概率（每回合抽取） */
export const BOUNTY_TRIGGER_CHANCE = 0.15;

/** 派发悬赏所需的最小存活实体数（人类+怪物，不含克隆） */
export const BOUNTY_MIN_ALIVE = 3;

// ===== 场地随机（Stage Randomization）=====

/** 达到 gap 后触发新场地的概率 */
export const STAGE_TRIGGER_CHANCE = 0.5;

// ===== 玩家互动（Player Interactions）=====

/** 玩家间 large 带扣互换成功的基础概率 */
export const TRADE_ACCEPT_CHANCE = 0.6;

/** 交易涉及推进器时，Tanuki 被哄骗交出的概率 */
export const TANUKI_BRIBE_CHANCE = 0.6;

/** 交易涉及推进器时，其他 idCore 玩家交出的概率 */
export const GENERIC_BRIBE_CHANCE = 0.15;

/** Bull 骑士的强夺成功率 */
export const BULL_STEAL_CHANCE = 0.8;

/** 普通骑士的强夺成功率 */
export const GENERIC_STEAL_CHANCE = 0.5;

// ===== 支持者/赞助商（Supporter Drops）=====

/** 支持者空投的基础概率（线性随回合增加） */
export const SUPPORTER_DROP_BASE_CHANCE = 0.15;

/** 支持者空投概率的每回合增量 */
export const SUPPORTER_DROP_ROUND_SCALE = 0.015;

/** Beroba 使邪魔徒步兵进化为骑士的概率 */
export const BEROBA_EVOLVE_CHANCE = 0.6;

// ===== 场地特效（Stage Modifiers）=====

/** 毒气沼泽：已中毒/淋湿目标的附加伤害倍率 */
export const TOXIC_STAGE_POISONED_SCALE = 0.2;

/** 毒气沼泽：普通目标的基础伤害倍率（按 maxHp） */
export const TOXIC_STAGE_BASE_SCALE = 0.1;

/** 停战休整场地：每回合回血倍率（按 maxHp） */
export const CEASEFIRE_HEAL_SCALE = 0.1;

// ===== Buff 相关 =====

/** 中毒对任何治疗效果的减益倍率（treat as halved heal） */
export const POISON_HEAL_PENALTY = 0.5;

/** 中毒每回合自伤倍率（按 maxHp） */
export const POISON_SELF_DMG_SCALE = 0.03;

/** Regen 每回合按缺失血量回血倍率 */
export const REGEN_SCALE = 0.15;

// ===== 狂热插槽摇奖（Fever Roulette）=====

/** 一次摇奖成功发牌之间的冷却回合数 */
export const FEVER_ROLL_CD = 3;

/** r <= 15 回合内禁用 SSS 档位（防前期爆炸） */
export const FEVER_SSS_BAN_UNTIL_ROUND = 15;

/** Tanuki 骑士摇出 SSS 档位的概率 */
export const FEVER_SSS_CHANCE_TANUKI = 0.1;

/** 其他骑士摇出 SSS 档位的概率 */
export const FEVER_SSS_CHANCE_DEFAULT = 0.05;

/** Tanuki 骑士摇出 C 档位（Miss）的概率 */
export const FEVER_MISS_CHANCE_TANUKI = 0.0;

/** 其他骑士摇出 C 档位（Miss）的概率 */
export const FEVER_MISS_CHANCE_DEFAULT = 0.2;

/** Hyper Boostriker Rush 的可用 `commandCharges` 阈值 */
export const COMMAND_TWIN_AWAKEN_CHARGES = 10;

/** 双重指挥触发模式切换（喷气机↔加农炮）的概率 */
export const COMMAND_MODE_SWITCH_CHANCE = 0.4;

// ===== 攻击/伤害阈值 =====

/** 造成超过 maxHp 这个比例的伤害时，触发"武装击飞"掉落 */
export const DISARM_DMG_THRESHOLD_SCALE = 0.4;

/** 引擎过载反噬的自伤比例（按当前 hp） */
export const ENGINE_OVERLOAD_PENALTY_SCALE = 0.15;

/** 摇奖 Miss 档位给予的安慰护盾 */
export const FEVER_MISS_CONSOLATION_SHIELD = 50;
