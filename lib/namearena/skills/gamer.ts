import type { DamageApplicationOptions, Fighter, HealingResolutionRecord, SkillContext, SkillDefinition, StatKey } from '../types';
import { namerenaData as Data } from '../data';
import { isActiveCombatant, resolveHealing } from '../combatState';
import { didDamageConnect, isDamageRedirected } from '../damageRedirects';
import { getSurtrTacticalHpPct } from '../surtrMechanics';

import { applyStatus, hasIdentity } from '../statusSystem';

const { SKILL_TAGS } = Data;

const MAX_APM = 12;
const WORLD_STAGE_THRESHOLD = 11;
const WORLD_STAGE_DURATION = 2;

type GamerSkillType = 'fps' | 'moba' | 'action' | 'fighting' | 'macro';

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function gamerSelfLogMetadata(fighter: Fighter) {
  return {
    actorId: fighter.id,
    actorName: fighter.name,
    targetIds: [fighter.id],
  };
}

function applyTemporaryGamerStats(
  fighter: Fighter,
  identityId: string,
  remainingTurns: number,
  buff: Partial<Record<StatKey | 'crit', number>>,
): void {
  const sourceId = `gamer:${identityId.toLowerCase()}`;
  const componentPotencies = Object.fromEntries(Object.entries(buff).map(([key, multiplier]) => {
    if (key === 'crit') return ['CRIT_RATE_UP', Math.round((multiplier ?? 0) * 100)];
    const value = multiplier ?? 1;
    return [`${key.toUpperCase()}_${value >= 1 ? 'UP' : 'DOWN'}`, Math.round(Math.abs(value - 1) * 100)];
  }));
  applyStatus(fighter, {
    identityId,
    remainingTurns,
    componentPotencies,
    attribution: { effectSourceId: sourceId, applierId: fighter.id, applierName: fighter.name },
  });
}

function recoveryText(healing: HealingResolutionRecord): string {
  if (healing.actual > 0) return `恢复了 ${healing.actual} 点生命`;
  return healing.outcome === 'blocked' ? '治疗被完全阻止' : '生命已满，治疗溢出';
}

function isWorldStage(user: Fighter): boolean {
  return hasStatus(user, 'GAMER_WORLD_STAGE');
}

function effectiveApmCost(user: Fighter, baseCost: number): number {
  if (baseCost <= 0) return 0;
  const worldDiscount = isWorldStage(user) ? 1 : 0;
  const bufferDiscount = Math.min(user.gamerInputBuffer ?? 0, 1);
  return Math.max(1, baseCost - worldDiscount - bufferDiscount);
}

function spendApm(user: Fighter, baseCost: number): number | null {
  const cost = effectiveApmCost(user, baseCost);
  if ((user.apm ?? 0) < cost) return null;
  if (cost > 0) {
    const bufferDiscount = Math.min(user.gamerInputBuffer ?? 0, 1);
    user.apm = Math.max(0, Math.min(MAX_APM, (user.apm ?? 0) - cost));
    if (bufferDiscount > 0) user.gamerInputBuffer = Math.max(0, (user.gamerInputBuffer ?? 0) - bufferDiscount);
  }
  return cost;
}

function canPay(user: Fighter, baseCost: number): boolean {
  return (user.apm ?? 0) >= effectiveApmCost(user, baseCost);
}

function consumeBoost(user: Fighter): boolean {
  if (isWorldStage(user)) return true;
  if (!user.gamerBoostReady) return false;
  user.gamerBoostReady = false;
  return true;
}

function enterWorldStage(ctx: SkillContext, reason: string): void {
  if (ctx.user.job !== 'ALL_PLATFORM_CHAMPION' || ctx.user.hasUsedGamerWorldStage) return;
  ctx.user.hasUsedGamerWorldStage = true;
  ctx.user.gamerBoostReady = true;
  applyStatus(ctx.user, { identityId: 'GAMER_WORLD_STAGE', remainingTurns: WORLD_STAGE_DURATION });
  applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_world_stage' } });
  ctx.log(
    'crit',
    `🏆 【世界赛舞台】${ctx.user.name} APM 拉到 ${ctx.user.apm ?? 0}/${MAX_APM}，${reason}，所有冠军技能短暂进入强化版！`,
    gamerSelfLogMetadata(ctx.user),
  );
}

function gainApm(ctx: SkillContext, amount: number, reason: string): void {
  if (amount <= 0) return;
  const before = ctx.user.apm ?? 0;
  ctx.user.apm = Math.min(MAX_APM, before + amount);
  if (ctx.user.apm <= before) return;
  if (before < WORLD_STAGE_THRESHOLD && (ctx.user.apm ?? 0) >= WORLD_STAGE_THRESHOLD) {
    enterWorldStage(ctx, reason);
  }
}

function completeTechnique(ctx: SkillContext, skillType: GamerSkillType, options: { apmGain?: number; reason?: string } = {}): void {
  const previousType = ctx.user.gamerLastSkillType;
  if (!previousType || previousType === skillType) {
    ctx.user.gamerMastery = 1;
  } else {
    ctx.user.gamerMastery = Math.min(3, (ctx.user.gamerMastery ?? 1) + 1);
  }
  ctx.user.gamerLastSkillType = skillType;

  if ((ctx.user.gamerMastery ?? 0) >= 3) {
    ctx.user.gamerMastery = 0;
    ctx.user.gamerBoostReady = true;
    ctx.log(
      'buff',
      `🎮 【跨平台精通】${ctx.user.name} 连续切换不同游戏理解，下一次冠军技能将自动强化！`,
      gamerSelfLogMetadata(ctx.user),
    );
  }

  if ((ctx.user.gamerClutchWindow ?? 0) > 0) {
    ctx.user.gamerClutchWindow = Math.max(0, (ctx.user.gamerClutchWindow ?? 0) - 1);
  }
  if (options.apmGain) gainApm(ctx, options.apmGain, options.reason ?? '通过有效操作把节奏续上');
}

function applyControl(ctx: SkillContext, target: Fighter, identityId: string, remainingTurns: number, label: string): void {
  ctx.applyStatus(target, { identityId, remainingTurns, effectName: label });
}

function applyTrackedDamage(
  ctx: SkillContext,
  target: Fighter,
  amount: number,
  actionName: string,
  trueDamage: boolean,
  logPrefix: string,
): { actualDmg: number; connected: boolean; redirected: boolean } {
  const options: DamageApplicationOptions = { actionName, deferTransform: true, respectDefenses: true };
  const actualDmg = ctx.applyDamage(target, Math.max(0, amount), 'skill', trueDamage, ctx.user, options);
  if (options.targetWithdrawnDuringDamage) {
    ctx.flushDeferredDamageEvents?.();
    return { actualDmg: 0, connected: false, redirected: false };
  }
  if (isDamageRedirected(options)) {
    ctx.flushDeferredDamageEvents?.();
    return { actualDmg: 0, connected: false, redirected: true };
  }
  const connected = didDamageConnect(actualDmg, options);
  if (actualDmg > 0 && (options.targetDefeatedDuringDamage || target.isDead || target.isDeadAnnounced)) {
    ctx.log('info', `${logPrefix}，这一击造成 ${actualDmg} 点${trueDamage ? '真实' : ''}伤害并触发了致死连锁；${target.name} 已在后续效果中退场！`);
  } else if (actualDmg > 0) {
    ctx.log('crit', `${logPrefix}，对 ${target.name} 实际造成 ${actualDmg} 点${trueDamage ? '真实' : ''}伤害！`);
  } else if (connected) {
    ctx.log('crit', `${logPrefix}，成功命中 ${target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命！`);
  } else {
    ctx.log('info', `${logPrefix}，但 ${target.name} 没有承受实际伤害！`);
  }
  ctx.flushDeferredDamageEvents?.();
  if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    ctx.markDefeated(target, { message: `💀 【${actionName}】${target.name} 被玄凝的冠军操作带走！`, killer: ctx.user });
  }
  return { actualDmg, connected, redirected: false };
}

function livingEnemies(ctx: SkillContext, excludeTargetId?: string): Fighter[] {
  return (ctx.currentTargets ?? []).filter((target) =>
    target.id !== excludeTargetId &&
    target.currentHp > 0 &&
    !target.isDead &&
    !target.isDeadAnnounced &&
    !hasStatus(target, 'SYNERGY_SLACKING'),
  );
}

function executeCrackConfirm(ctx: SkillContext, label = '破绽确认'): boolean {
  const cost = spendApm(ctx.user, 3);
  if (cost === null) return false;
  const boosted = consumeBoost(ctx.user);
  const marked = ctx.user.gamerMarkedTargetId === ctx.target.id;
  const vulnerable =
    marked ||
    getSurtrTacticalHpPct(ctx.target) <= (boosted ? 0.48 : 0.35) ||
    ['STUN', 'FREEZE', 'NEURAL_THEFT_DEBUFF', 'VALO_AIM_PUNCH', 'VALO_CYPHER_REVEALED', 'BABY_WEAKNESS_MARK', 'BLIND']
      .some((identityId) => hasIdentity(ctx.target, identityId));
  const base = Math.max(ctx.getEffectiveStat(ctx.user, 'atk'), ctx.getEffectiveStat(ctx.user, 'mag'));
  const multiplier = boosted ? (vulnerable ? 3.45 : 2.62) : (vulnerable ? 2.85 : 2.14);
  const dmg = Math.floor(base * multiplier + ctx.getEffectiveStat(ctx.user, 'wis') * (boosted ? 1.0 : 0.66));
  const prefix = boosted ? `强化${label}` : label;
  ctx.log('skill', `🥊 【${prefix}】${ctx.user.name} 消耗 ${cost} APM，把 ${ctx.target.name} 的硬直、血线和习惯全部读完！`);
  const result = applyTrackedDamage(ctx, ctx.target, dmg, label, true, `🥊 【${prefix}】确认命中`);
  if (result.connected && marked) {
    delete ctx.user.gamerMarkedTargetId;
    if (ctx.target.currentHp > 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
      ctx.log('info', `👁️ 【读输入】${ctx.user.name} 已经把 ${ctx.target.name} 的标记转化为确认伤害，标记解除。`);
    }
  }
  completeTechnique(ctx, 'fighting', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '用确认连段把比赛节奏接住' });
  return true;
}

export const gamerSkills: Record<string, SkillDefinition> = {
  awp_shot: { name: '大狙盲狙', tag: SKILL_TAGS.PHYS, mult: 3.0, ignoreDef: true, text: '🎯 {USER} 掏出AWP，空中转体360度盲狙，一枪爆了 {TARGET} 的头！造成 {VAL} 真实伤害！' },
  flash_lol: { name: '闪现A', tag: SKILL_TAGS.PHYS, mult: 1.5, alwaysHit: true, text: '✨ {USER} 极限闪现拉近距离，对 {TARGET} 打出必中一击！造成 {VAL} 伤害！' },
  hook_dota: { name: '肉钩', tag: SKILL_TAGS.PHYS, mult: 1.5, statusApplications: [{ identityId: 'STUN' }], text: '🪝 {USER} 盲出肉钩，精准命中了 {TARGET}，造成 {VAL} 伤害并眩晕！' },
  helm_breaker: { name: '登龙剑', tag: SKILL_TAGS.PHYS, mult: 2.5, text: '🐉 {USER} 高高跃起，一招气刃兜割劈在 {TARGET} 身上！造成 {VAL} 伤害！' },
  tcs_mh: { name: '真蓄力斩', tag: SKILL_TAGS.PHYS, mult: 4.0, text: '⚔️ {USER} 完美铁山靠顶住攻击，随后猛力劈下真蓄力斩！对 {TARGET} 造成 {VAL} 伤害！' },
  waterfowl: { name: '水鸟乱舞', tag: SKILL_TAGS.PHYS, mult: 0.8, hits: 5, text: '🦢 {USER} 化身女武神，对 {TARGET} 施展水鸟乱舞！连续劈砍 5 次，共造成 {VAL} 伤害！' },
  bkb_dota: { name: '开启BKB', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'BKB', attribution: { effectSourceId: 'gamer_bkb' } }], text: '🟡 {USER} 开启了黑皇杖，全身散发金光，免疫一切魔法控制！' },
  rush_b: { name: 'Rush B', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'GAMER_RUSH_B' }], text: "🏃 {USER} 大喊一声 \"Rush B, Don't stop!\"，速度和攻击力飙升！" },
  yasuo_q: { name: '哈撒给', tag: SKILL_TAGS.MAG, mult: 1.5, statusApplications: [{ identityId: 'AIRBORNE' }], text: '🌪️ {USER} 斩出一道龙卷风，将 {TARGET} 高高击飞！造成 {VAL} 伤害！' },
  teemo_shroom: { name: '种蘑菇', tag: SKILL_TAGS.MAG, mult: 1.0, statusApplications: [{ identityId: 'POISON' }], text: '🍄 {USER} 偷偷在 {TARGET} 脚下种了个毒蘑菇，造成 {VAL} 伤害并施加剧毒！' },
  divine_sunderer: { name: '神圣分离者', tag: SKILL_TAGS.PHYS, mult: 1.5, lifesteal: 0.5, text: '🔨 {USER} 触发耀光效果重击 {TARGET}，造成 {VAL} 伤害并回复自身血量！' },
  judgment_cut: { name: '次元斩', tag: SKILL_TAGS.MAG, mult: 3.0, ignoreDef: true, text: '🗡️ {USER} 拔刀瞬间切开空间，对 {TARGET} 造成 {VAL} 无视魔抗的次元伤害！' },
  kamehameha: { name: '龟派气功', tag: SKILL_TAGS.MAG, mult: 4.0, text: '🐢 {USER} 双手聚气："龟—派—气—功—波！" 轰穿了 {TARGET}，造成 {VAL} 伤害！' },
  zonia: { name: '金身', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'INVUL', attribution: { effectSourceId: 'gamer_zhonya' } }], text: '⏱️ {USER} 按下了中娅沙漏，化为小金人，进入无敌状态！' },
  aim_bot: { name: '锁头挂', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'AIM' }], text: '💻 {USER} 偷偷开启了锁头脚本... 下次攻击必定暴击且无法闪避！' },
  lag_switch: { name: '拔网线', tag: SKILL_TAGS.DEBUFF, statusApplications: [{ identityId: 'STUN' }], text: '🔌 {USER} 物理拔掉了服务器网线！{TARGET} 掉线了，原地罚站！' },
  roll_dodge: { name: '翻滚无敌帧', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'INVUL', attribution: { effectSourceId: 'gamer_roll_dodge' } }], text: '🔄 {USER} 熟练地进行翻滚，利用无敌帧规避了即将到来的所有伤害！' },
  tp_scroll: { name: 'TP逃生', tag: SKILL_TAGS.HEAL, mult: 2.0, text: '📜 {USER} 亮起TP光芒，瞬间回到泉水恢复了 {VAL} 点生命值，又TP回了战场！' },
  warcry_dota: { name: '战吼', tag: SKILL_TAGS.BUFF, statusApplications: [{ identityId: 'GAMER_WARCRY' }], text: '吼 {USER} 发出战吼，护甲和魔抗大幅提升！' },

  gamer_headshot_line: {
    name: '冠军爆头线',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    condition: (user) => canPay(user, 2),
    text: '🎯 {USER} 把准星压到爆头线，准备收掉 {TARGET}！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 2);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      const executeLine = boosted ? 0.45 : 0.35;
      const hpRatio = getSurtrTacticalHpPct(ctx.target);
      const multiplier = boosted ? (hpRatio <= executeLine ? 3.28 : 2.72) : (hpRatio <= executeLine ? 2.72 : 2.22);
      const dmg = Math.floor(
        Math.max(ctx.getEffectiveStat(ctx.user, 'atk'), ctx.getEffectiveStat(ctx.user, 'mag')) * multiplier +
          ctx.getEffectiveStat(ctx.user, 'wis') * (boosted ? 0.72 : 0.4),
      );
      const prefix = boosted ? '强化冠军爆头线' : '冠军爆头线';
      ctx.log('skill', `🎯 【${prefix}】${ctx.user.name} 消耗 ${cost} APM 锁定 ${ctx.target.name}，${hpRatio <= executeLine ? '目标已经进入斩杀线' : '先打一枪压低血线'}！`);
      const result = applyTrackedDamage(ctx, ctx.target, dmg, '冠军爆头线', true, `🎯 【${prefix}】爆头命中`);
      completeTechnique(ctx, 'fps', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '用爆头线续住枪感' });
      return true;
    },
  },
  gamer_perfect_parry: {
    name: '完美弹反',
    tag: SKILL_TAGS.BUFF,
    condition: (user) => canPay(user, 2),
    text: '🛡️ {USER} 读准前摇，进入完美弹反姿态！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 2);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      applyStatus(ctx.user, { identityId: 'COUNTER', remainingTurns: boosted ? 2 : 1 });
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_perfect_parry' } });
      if (boosted) applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gamer_perfect_parry' } });
      applyTemporaryGamerStats(ctx.user, 'GAMER_PARRY_GUARD', 2, {
        def: boosted ? 1.18 : 1.08,
        res: boosted ? 1.18 : 1.08,
      });
      ctx.log('buff', `🛡️ 【${boosted ? '强化完美弹反' : '完美弹反'}】${ctx.user.name} 消耗 ${cost} APM 读准前摇，获得反击、防守抗性${boosted ? '与法术抵挡' : ''}！`);
      completeTechnique(ctx, 'action', { apmGain: boosted ? 1 : 0, reason: '用弹反把防守转成操作资源' });
      return true;
    },
  },
  gamer_estus_cancel: {
    name: '喝瓶取消',
    tag: SKILL_TAGS.HEAL,
    condition: (user) => canPay(user, 2),
    text: '🧃 {USER} 卡掉后摇喝下恢复道具，稳住血线！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 2);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      ctx.log('heal', `🧃 【${boosted ? '强化喝瓶取消' : '喝瓶取消'}】${ctx.user.name} 消耗 ${cost} APM 卡掉后摇，开始清除常规异常并恢复血线！`);
      ctx.dispelStatusEffects(ctx.user, { strength: 'normal', direction: 'negative' });
      const healAmt = Math.floor(ctx.user.maxHp * (boosted ? 0.3 : 0.22) + ctx.getEffectiveStat(ctx.user, 'wis') * (boosted ? 1.0 : 0.65));
      const healing = resolveHealing(ctx.user, healAmt, {
        kind: 'direct',
        sourceId: '喝瓶取消',
        healer: ctx.user,
      }, ctx.log);
      if (boosted) {
        applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 2 });
        applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_clutch_focus' } });
        ctx.user.gamerInputBuffer = Math.min(2, (ctx.user.gamerInputBuffer ?? 0) + 1);
      }
      ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🧃 【喝瓶结算】${ctx.user.name} ${recoveryText(healing)}${boosted ? '，并接上输入缓存' : ''}！`);
      completeTechnique(ctx, 'action', { apmGain: boosted ? 1 : 0, reason: '用取消后摇保持操作不断档' });
      return true;
    },
  },
  gamer_tactical_pause: {
    name: '开团指挥',
    tag: SKILL_TAGS.SPECIAL,
    herobrineCopyTargetCap: 3,
    spellBlockMode: 'perHit',
    condition: (user) => canPay(user, 3),
    text: '⏸️ {USER} 抓住对局节奏强行暂停，读到 {TARGET} 的下一步行动！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 3);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      const primary = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'mag') * (boosted ? 2.2 : 1.75) +
          ctx.getEffectiveStat(ctx.user, 'wis') * 0.5,
      );
      const extras = boosted ? livingEnemies(ctx, ctx.target.id).slice(0, 2) : [];
      ctx.setVisualTargets([ctx.target, ...extras]);
      ctx.log('skill', `⏸️ 【${boosted ? '强化开团指挥' : '开团指挥'}】${ctx.user.name} 消耗 ${cost} APM 强行暂停对局，主目标锁定 ${ctx.target.name}！`);
      const result = applyTrackedDamage(ctx, ctx.target, primary, '开团指挥', false, `⏸️ 【开团指挥】主控命中`);
      if (result.connected) applyControl(ctx, ctx.target, 'STUN', boosted ? 2 : 1, '开团眩晕');
      if (boosted && isActiveCombatant(ctx.user)) {
        for (const enemy of extras) {
          if (!ctx.canOffensivelyTarget(enemy)) continue;
          const splash = Math.floor(primary * 0.42);
          applyTrackedDamage(ctx, enemy, splash, '开团指挥余波', false, `⏸️ 【开团余波】波及 ${enemy.name}`);
        }
        applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_clutch_focus' } });
      }
      completeTechnique(ctx, 'moba', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '用开团指挥稳住团战节奏' });
      return true;
    },
  },
  gamer_wombo_combo: {
    name: 'Wombo Combo',
    tag: SKILL_TAGS.SPECIAL,
    herobrineCopyTargetCap: 3,
    spellBlockMode: 'perHit',
    condition: (user) => canPay(user, 3),
    text: '🌀 {USER} 开启 MOBA 团战思路，准备打一套群体连招！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 3);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      const enemies = livingEnemies(ctx).slice(0, boosted ? 4 : 3);
      const baseDmg = Math.floor(
        Math.max(ctx.getEffectiveStat(ctx.user, 'atk'), ctx.getEffectiveStat(ctx.user, 'mag')) * (boosted ? 1.2 : 0.98) +
          ctx.getEffectiveStat(ctx.user, 'wis') * 0.25,
      );
      ctx.setVisualTargets(enemies);
      ctx.log('skill', `🌀 【${boosted ? '强化Wombo Combo' : 'Wombo Combo'}】${ctx.user.name} 消耗 ${cost} APM 多线操作，向 ${enemies.length} 名敌人打出团战连招！`);
      let totalDmg = 0;
      let hitCount = 0;
      let redirectedAny = false;
      const resolvedTargets: Fighter[] = [];
      for (const enemy of enemies) {
        if (!isActiveCombatant(ctx.user)) break;
        if (!ctx.canOffensivelyTarget(enemy)) continue;
        resolvedTargets.push(enemy);
        const result = applyTrackedDamage(ctx, enemy, baseDmg, 'Wombo Combo', false, `🎮 连招命中 ${enemy.name}`);
        if (result.redirected) redirectedAny = true;
        if (result.actualDmg > 0) {
          totalDmg += result.actualDmg;
          hitCount += 1;
        }
      }
      if (boosted && totalDmg > 0) {
        const healing = resolveHealing(ctx.user, Math.floor(totalDmg * 0.16), {
          kind: 'lifesteal',
          sourceId: '强化Wombo Combo',
          healer: ctx.user,
        }, (type, text) => ctx.log(type, text, gamerSelfLogMetadata(ctx.user)));
        const healText = healing.actual > 0
          ? `${ctx.user.name} 从强化连招中恢复了 ${healing.actual} 点生命`
          : healing.outcome === 'blocked'
            ? `${ctx.user.name} 的强化连招触发吸血，但治疗被完全阻止`
            : `${ctx.user.name} 的强化连招触发吸血，但生命已满，治疗溢出`;
        ctx.log(
          healing.actual > 0 ? 'heal' : 'info',
          `🌀 【团战吸血】${healText}！`,
          gamerSelfLogMetadata(ctx.user),
        );
      }
      const summaryMetadata = {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        targetIds: resolvedTargets
          .filter((enemy) => isActiveCombatant(enemy) || !enemy.isNpc)
          .map((enemy) => enemy.id),
      };
      if (totalDmg > 0) {
        const totalLabel = redirectedAny ? '对未被转移的目标总计造成' : '本次团战连招总计造成';
        ctx.log(
          'info',
          `🌀 【Wombo Combo】${ctx.user.name} ${totalLabel} ${totalDmg} 点伤害！`,
          summaryMetadata,
        );
      } else if (redirectedAny) {
        ctx.log(
          'info',
          `🌀 【Wombo Combo】${ctx.user.name} 的部分伤害被目标防护机制转移，转移伤害已单独结算！`,
          summaryMetadata,
        );
      } else {
        ctx.log(
          'info',
          `🌀 【Wombo Combo】${ctx.user.name} 这轮团战连招没有打出有效伤害！`,
          summaryMetadata,
        );
      }
      completeTechnique(ctx, 'moba', { apmGain: hitCount >= 3 ? 1 : 0, reason: '命中多人后把团战手感续住' });
      return true;
    },
  },
  gamer_crack_confirm: {
    name: '破绽确认',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    condition: (user) => canPay(user, 3),
    text: '🥊 {USER} 抓到 {TARGET} 的破绽，准备把机会转成击杀！',
    onExecute: (ctx) => executeCrackConfirm(ctx),
  },
  gamer_qte_execute: {
    name: '处决QTE',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    condition: (user) => canPay(user, 3),
    text: '🎮 {USER} 看到处决提示亮起，按下完美 QTE！',
    onExecute: (ctx) => executeCrackConfirm(ctx, '处决QTE'),
  },
  gamer_speedrun_route: {
    name: '速通路线优化',
    tag: SKILL_TAGS.BUFF,
    condition: (user) => canPay(user, 1),
    text: '🏃 {USER} 规划速通路线，压缩下一轮操作成本！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 1);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      ctx.user.gamerInputBuffer = Math.min(3, (ctx.user.gamerInputBuffer ?? 0) + (boosted ? 2 : 1));
      applyStatus(ctx.user, { identityId: 'AIM', charges: boosted ? 2 : 1 });
      applyTemporaryGamerStats(ctx.user, 'GAMER_ROUTE_BOOST', 2, {
        spd: boosted ? 1.12 : 1.06,
        agl: boosted ? 1.12 : 1.06,
      });
      ctx.log('buff', `🏃 【${boosted ? '强化速通路线优化' : '速通路线优化'}】${ctx.user.name} 消耗 ${cost} APM，获得 ${boosted ? 2 : 1} 层输入缓存、锁头与身位优势！`);
      completeTechnique(ctx, 'macro', { apmGain: boosted ? 1 : 0, reason: '用速通路线优化压缩后续成本' });
      return true;
    },
  },
  gamer_resource_macro: {
    name: '资源运营',
    tag: SKILL_TAGS.BUFF,
    condition: () => true,
    text: '📈 {USER} 暂停硬拼，开始运营 APM 与下一轮路线。',
    onExecute: (ctx) => {
      const boosted = consumeBoost(ctx.user);
      const apmGain = boosted ? 4 : 3;
      const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * (boosted ? 0.1 : 0.07)), {
        kind: 'direct',
        sourceId: '资源运营',
        healer: ctx.user,
      }, ctx.log);
      ctx.user.gamerInputBuffer = Math.min(3, (ctx.user.gamerInputBuffer ?? 0) + 1);
      if (boosted) applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gamer_clutch_focus' } });
      ctx.log(healing.actual > 0 ? 'heal' : 'buff', `📈 【${boosted ? '强化资源运营' : '资源运营'}】${ctx.user.name} 放弃无意义平 A，重新规划资源，APM +${apmGain}，输入缓存 +1，${recoveryText(healing)}${boosted ? '，并获得法术抵挡' : ''}！`);
      completeTechnique(ctx, 'macro');
      gainApm(ctx, apmGain, '通过资源运营把手感重新拉满');
      return true;
    },
  },
  gamer_read_inputs: {
    name: '读输入',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    condition: (user) => canPay(user, 2),
    text: '👁️ {USER} 像打格斗游戏一样读到了 {TARGET} 的输入！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 2);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      const dmg = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'mag') * (boosted ? 1.95 : 1.45) +
          ctx.getEffectiveStat(ctx.user, 'wis') * (boosted ? 0.7 : 0.4),
      );
      ctx.user.gamerMarkedTargetId = ctx.target.id;
      ctx.log('skill', `👁️ 【${boosted ? '强化读输入' : '读输入'}】${ctx.user.name} 消耗 ${cost} APM，看穿 ${ctx.target.name} 的下一步，施加破绽标记！`);
      const result = applyTrackedDamage(ctx, ctx.target, dmg, '读输入', false, `👁️ 【读输入】情报打击命中`);
      if (result.connected) {
        applyControl(ctx, ctx.target, 'NEURAL_THEFT_DEBUFF', boosted ? 3 : 2, '输入读取');
        if (boosted) {
          ctx.applyStatus(ctx.target, { identityId: 'GAMER_READ_INPUTS', remainingTurns: 3 });
        }
      }
      completeTechnique(ctx, 'fighting', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '读到对手输入后继续提速' });
      return true;
    },
  },
  gamer_clutch_ace: {
    name: '1vX残局',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    condition: (user) => canPay(user, 4),
    text: '🏅 {USER} 进入 1vX 残局，开始冷静拆解战场！',
    onExecute: (ctx) => {
      const cost = spendApm(ctx.user, 4);
      if (cost === null) return false;
      const boosted = consumeBoost(ctx.user);
      const hasLivingAlly = ctx.fighters.some((fighter) =>
        fighter.id !== ctx.user.id &&
        isActiveCombatant(fighter) &&
        ctx.getTeamId(fighter) === ctx.getTeamId(ctx.user),
      );
      const clutchName = hasLivingAlly ? '残局专注' : '1vX残局';
      const displayName = boosted ? `强化${clutchName}` : clutchName;
      ctx.log('crit', `🏅 【${displayName}】${ctx.user.name} 消耗 ${cost} APM 进入残局专注，开始重整状态并拆解 ${ctx.target.name}！`);
      const cleanCount = ctx.dispelStatusEffects(ctx.user, {
        strength: 'strong',
        direction: 'negative',
      }).removed.length;
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: boosted ? 2 : 1, attribution: { effectSourceId: 'gamer_clutch_focus' } });
      applyStatus(ctx.user, { identityId: 'AIM', charges: boosted ? 2 : 1 });
      if (boosted) applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gamer_clutch_focus' } });
      const effectiveWis = ctx.getEffectiveStat(ctx.user, 'wis');
      const effectivePower = Math.max(ctx.getEffectiveStat(ctx.user, 'atk'), ctx.getEffectiveStat(ctx.user, 'mag'));
      const healing = resolveHealing(ctx.user, Math.floor(ctx.user.maxHp * (boosted ? 0.25 : 0.17) + effectiveWis * (boosted ? 0.85 : 0.55)), {
        kind: 'direct',
        sourceId: clutchName,
        healer: ctx.user,
      }, ctx.log);
      const dmg = Math.floor(effectivePower * (boosted ? 3.35 : 2.52) + effectiveWis * (boosted ? 1.05 : 0.7));
      const cleanseText = cleanCount > 0 ? `清掉 ${cleanCount} 个异常` : '状态稳定';
      ctx.log('crit', `🏅 【残局准备完成】${ctx.user.name} ${cleanseText}、${recoveryText(healing)}，锁定 ${ctx.target.name}！`);
      const result = applyTrackedDamage(ctx, ctx.target, dmg, clutchName, true, `🏅 【${clutchName}】反打命中`);
      if (boosted && result.actualDmg > 0) ctx.user.gamerInputBuffer = Math.min(3, (ctx.user.gamerInputBuffer ?? 0) + 1);
      completeTechnique(ctx, 'fps', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '用残局处理续住枪线' });
      return true;
    },
  },
  gamer_world_combo: {
    name: '全平台冠军连段',
    tag: SKILL_TAGS.SPECIAL,
    herobrineCopyTargetCap: 3,
    spellBlockMode: 'perHit',
    condition: (user) => hasStatus(user, 'GAMER_WORLD_STAGE') && canPay(user, 6) && !user.hasUsedGamerChampionCombo,
    text: '🏆 {USER} 进入世界赛状态，开始打出全平台冠军连段！',
    onExecute: (ctx) => {
      if (!hasStatus(ctx.user, 'GAMER_WORLD_STAGE') || ctx.user.hasUsedGamerChampionCombo) return false;
      const cost = spendApm(ctx.user, 6);
      if (cost === null) return false;
      ctx.user.hasUsedGamerChampionCombo = true;
      const base = Math.max(ctx.getEffectiveStat(ctx.user, 'atk'), ctx.getEffectiveStat(ctx.user, 'mag'));
      const primary = Math.floor(base * 3.6 + ctx.getEffectiveStat(ctx.user, 'wis') * 1.18);
      const splashTargets = livingEnemies(ctx, ctx.target.id).slice(0, 2);
      ctx.setVisualTargets([ctx.target, ...splashTargets]);
      ctx.log('crit', `🏆 【全平台冠军连段】${ctx.user.name} 消耗 ${cost} APM，FPS 爆头、MOBA 控制、魂系无敌帧、格斗确认与速通路线全部串联，主目标锁定 ${ctx.target.name}！`);
      const result = applyTrackedDamage(ctx, ctx.target, primary, '全平台冠军连段', true, `🏆 【冠军连段】主段命中`);
      if (result.connected) applyControl(ctx, ctx.target, 'STUN', 1, '冠军连段压制');
      if (!isActiveCombatant(ctx.user)) return true;
      const splash = Math.floor(primary * 0.28);
      for (const enemy of splashTargets) {
        if (!isActiveCombatant(ctx.user)) break;
        if (!ctx.canOffensivelyTarget(enemy)) continue;
        applyTrackedDamage(ctx, enemy, splash, '全平台冠军连段余波', true, `🏆 【冠军连段余波】波及 ${enemy.name}`);
      }
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_world_stage' } });
      ctx.user.gamerInputBuffer = Math.min(3, (ctx.user.gamerInputBuffer ?? 0) + 1);
      completeTechnique(ctx, 'macro', { apmGain: result.actualDmg > 0 ? 1 : 0, reason: '世界赛高光后继续接管比赛' });
      return true;
    },
  },
};
