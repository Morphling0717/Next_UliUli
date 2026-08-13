import { isActiveCombatant, resolveHealing } from '../combatState';
import type { HealingResolutionRecord } from '../types';
import { namerenaData as Data } from '../data';

import { namerenaJobs } from '../jobs';
import {
  MOMO_ALTERNATE_DRAGON_CHANCE,
  activeMomoCaptains,
  addMomoCrowdJoy,
  addMomoCrowdJoyToCaptain,
  cleanseMomoCaptains,
  grantMomoSword,
  registerMomoRiderKick,
  syncMomoCaptains,
  type MomoRuntime,
} from '../momoMechanics';
import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { queryMechanic } from '../statusSystem';
import { getSelectableTargets } from '../targeting';

const { SKILL_TAGS } = Data;

function asMomoRuntime(ctx: SkillContext): MomoRuntime {
  return {
    fighters: ctx.fighters,
    battleState: ctx.battleState,
    jobs: namerenaJobs,
    turnCount: ctx.turnCount,
    getTeamId: ctx.getTeamId,
    isActiveCombatant,
    log: (type, text, metadata) => ctx.log(type, text, metadata),
    syncHpPct: (fighter) => {
      fighter.hpPct = fighter.maxHp > 0 ? fighter.currentHp / fighter.maxHp : 0;
    },
    applyDamage: ctx.applyDamage,
    applyStatus: ctx.applyStatus,
    dispelStatusEffects: ctx.dispelStatusEffects,
    markDefeated: ctx.markDefeated,
    flushDeferredDamageEvents: (fighter, phase) => {
      if (phase === 'mitigation') return;
      if (fighter.id === ctx.target.id || fighter.id === ctx.user.id) ctx.flushDeferredDamageEvents?.();
    },
  };
}

function momoDamageFormula(multiplier: number, trueDamage = false): NonNullable<SkillDefinition['damageFormula']> {
  return (attacker, target, _fighters, getEffectiveStat) => {
    const raw = getEffectiveStat(attacker, 'atk') * multiplier +
      getEffectiveStat(attacker, 'mag') * 0.24 +
      getEffectiveStat(attacker, 'wis') * 0.18;
    return Math.max(1, raw - (trueDamage ? 0 : getEffectiveStat(target, 'def') * 0.32));
  };
}

const finalVentDamageFormula: NonNullable<SkillDefinition['damageFormula']> = (owner, target, fighters, getEffectiveStat) => {
  const dragon = fighters.find((fighter) =>
    fighter.summonerId === owner.id && fighter.momoDragonVariant && isActiveCombatant(fighter),
  );
  return Math.max(
    1,
    getEffectiveStat(owner, 'atk') * 2.15 +
      (dragon ? getEffectiveStat(dragon, 'atk') : 0) * 1.45 +
      getEffectiveStat(owner, 'wis') * 0.3 -
      getEffectiveStat(target, 'def') * 0.28,
  );
};

function addJoy(ctx: SkillContext, amount: number, actionName: string): void {
  const gains = addMomoCrowdJoy(asMomoRuntime(ctx), ctx.user, amount);
  const totalGained = gains.reduce((sum, gain) => sum + gain.gained, 0);
  ctx.log('buff', gains.length === 0
    ? `🎉 【${actionName}】当前没有可结算【众宾欢也】的在场舰长。`
    : totalGained > 0
    ? `🎉 【${actionName}】${gains.length} 名舰长结算【众宾欢也】，实际合计增加 ${totalGained} 层（单人上限 138）。`
    : `🎉 【${actionName}】${gains.length} 名舰长的【众宾欢也】均已达到上限，本次没有继续增加。`);
}

function payMomoCost(
  ctx: SkillContext,
  amount: number,
  actionName: string,
  beforeFlush?: (actual: number) => void,
): number {
  const options: DamageApplicationOptions = {
    actionName,
    respectDefenses: false,
    creditAttacker: false,
    bypassOwlEmperorRedirect: true,
    bypassOwlOutgoingModifier: true,
    bypassOwlIncomingModifier: true,
    bypassShields: true,
    suppressOwlCooperation: true,
  };
  const actual = ctx.applyDamage(ctx.user, Math.max(1, Math.floor(amount)), 'momo_cost', true, ctx.user, options);
  beforeFlush?.(actual);
  if (actual > 0 || (ctx.user.pendingDamageEvents?.length ?? 0) > 0) ctx.flushDeferredDamageEvents?.();
  if (ctx.user.currentHp <= 0 && !ctx.user.isDead && !ctx.user.isDeadAnnounced) {
    ctx.markDefeated(ctx.user, { message: `💀 【${actionName}】${ctx.user.name} 没能承受自己的代价！`, awardKill: false });
  }
  return actual;
}

function executeTopRank(ctx: SkillContext): boolean {
  addJoy(ctx, 15, '我要当榜一！');
  payMomoCost(ctx, 15, '我要当榜一！', (cost) => {
    ctx.log('skill', `📦 【我要当榜一！】${ctx.user.name} 听从牢鳄教唆给自己开盲盒，被 B 站禁止，实际损失 ${cost} 点生命。`);
  });
  return true;
}

function executeSummonDragon(ctx: SkillContext): boolean {
  addJoy(ctx, 5, '我去，扫福瑞！');
  const activeDragon = ctx.fighters.find((fighter) =>
    fighter.summonerId === ctx.user.id &&
    fighter.momoDragonVariant &&
    isActiveCombatant(fighter),
  );
  if (activeDragon) {
    ctx.log('info', `🐉 【我去，扫福瑞！】${activeDragon.name} 仍在场上，契约兽不能重复召唤。`);
    return true;
  }
  const alternate = Math.random() < MOMO_ALTERNATE_DRAGON_CHANCE;
  const summonName = alternate ? '异色无双龙' : '无双龙';
  const beforeIds = new Set(ctx.fighters.map((fighter) => fighter.id));
  ctx.executeSummonSkill({
    name: '我去，扫福瑞！',
    tag: SKILL_TAGS.SPECIAL,
    text: `🐉 {USER} 开盲盒开出「${summonName}」，契约兽响应召唤！`,
    isSummon: true,
    summonName,
    summonJob: 'MOMO_CONTRACT_DRAGON',
    stats: { hp: 2800, atk: 180, def: 150, spd: 140, agl: 130, mag: 190, res: 150, wis: 160 },
    unique: true,
  }, ctx.user, ctx.getTeamId(ctx.user));
  const dragon = ctx.fighters.find((fighter) => !beforeIds.has(fighter.id) && fighter.summonerId === ctx.user.id);
  if (dragon) {
    dragon.momoDragonVariant = alternate ? 'alternate' : 'normal';
    syncMomoCaptains(asMomoRuntime(ctx), ctx.user);
    ctx.log('buff', alternate
      ? `🎨 【异色契约】${dragon.name} 是龙牙的契约兽；数值与无双龙相同，三阶段变身时可能被沫沫失手处决。`
      : `🐉 【镜中契约】${dragon.name} 与 ${ctx.user.name} 建立契约，将使用三套 VENT 卡协同作战。`);
  }
  return true;
}

function ownerForDragon(ctx: SkillContext): Fighter | undefined {
  return ctx.user.summonerId
    ? ctx.fighters.find((fighter) => fighter.id === ctx.user.summonerId && fighter.isMomo && isActiveCombatant(fighter))
    : undefined;
}

function executeSwordVent(ctx: SkillContext): boolean {
  const owner = ownerForDragon(ctx);
  if (!owner) {
    ctx.log('info', `🗡️ 【SWORD VENT】${ctx.user.name} 找不到仍在场的契约者，武器降临失败。`);
    return true;
  }
  if (!ctx.canProvideSupport(owner)) {
    ctx.log('info', `⬜ 【单人世界边界】${ctx.user.name} 的【SWORD VENT】无法越过隔离降临到 ${owner.name}。`);
    return true;
  }
  const result = grantMomoSword(asMomoRuntime(ctx), owner);
  if (result === 'existing') ctx.log('info', `🗡️ 【SWORD VENT】${owner.name} 已持有村好剑或醒剑，装备不能叠加。`);
  else if (result === 'awakened') ctx.log('crit', `⚔️ 【SWORD VENT】村好剑在降临瞬间与 ${owner.name} 共鸣，直接觉醒为【醒剑】！`);
  return true;
}

function executeGuardVent(ctx: SkillContext): boolean {
  const owner = ownerForDragon(ctx);
  if (!owner) {
    ctx.log('info', `🛡️ 【GUARD VENT】${ctx.user.name} 找不到仍在场的契约者，防御降临失败。`);
    return true;
  }
  if (!ctx.canProvideSupport(owner)) {
    ctx.log('info', `⬜ 【单人世界边界】${ctx.user.name} 的【GUARD VENT】无法越过隔离保护 ${owner.name}。`);
    return true;
  }
  const exists = queryMechanic(owner, 'SPELL_BLOCK').entries.some((status) =>
    status.attribution.effectSourceId === 'momo_guard_vent',
  );
  if (exists) {
    ctx.log('info', `🛡️ 【GUARD VENT】${owner.name} 的防御降临仍未消耗，本次不重复装备。`);
    return true;
  }
  ctx.applyStatus(owner, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'momo_guard_vent' } });
  ctx.log('buff', `🛡️ 【GUARD VENT】${ctx.user.name} 降下一面契约盾，为 ${owner.name} 抵挡下一次技能伤害或控制！`);
  return true;
}

function executeFinalVent(ctx: SkillContext): boolean {
  const owner = ownerForDragon(ctx);
  if (!owner) return true;
  if (!ctx.canProvideSupport(owner)) {
    ctx.log('info', `⬜ 【单人世界边界】${ctx.user.name} 无法越过隔离与 ${owner.name} 发动【FINAL VENT】。`);
    return true;
  }
  if (ctx.targetWasIntercepted && ctx.interceptedProtectedTargetId) {
    const protectedTarget = ctx.fighters.find((fighter) => fighter.id === ctx.interceptedProtectedTargetId);
    if (protectedTarget) {
      ctx.log('info', `🛡️ 【傀儡援护】${ctx.target.name} 挡在 ${protectedTarget.name} 身前，接管【FINAL VENT】！`);
    }
  }
  ctx.log('crit', `🦇 【FINAL VENT】${owner.name} 与 ${ctx.user.name} 同步跃起，对 ${ctx.target.name} 发动契约骑士踢！`);
  ctx.executeSkillAction('momo_final_vent_hit', owner, ctx.target, ctx.triggerDepth + 1);
  registerMomoRiderKick(asMomoRuntime(ctx), owner, 'FINAL VENT');
  return true;
}

type PrizeCounts = {
  ticket: number;
  candy: number;
  pillow: number;
  scepter: number;
  station: number;
  seal: number;
  castle: number;
};

function drawPrize(roll: number): keyof PrizeCounts {
  if (roll < 0.9) return 'ticket';
  if (roll < 0.95) return 'candy';
  if (roll < 0.96) return 'pillow';
  if (roll < 0.97) return 'scepter';
  if (roll < 0.98) return 'station';
  if (roll < 0.99) return 'seal';
  return 'castle';
}

function executeTenPull(ctx: SkillContext): boolean {
  const counts: PrizeCounts = { ticket: 0, candy: 0, pillow: 0, scepter: 0, station: 0, seal: 0, castle: 0 };
  for (let i = 0; i < 10; i += 1) counts[drawPrize(Math.random())] += 1;
  const runtime = asMomoRuntime(ctx);
  ctx.log('skill', `✨ 【十连！金光！】${ctx.user.name} 开出：电影票×${counts.ticket}、棉花糖×${counts.candy}、爱心抱枕×${counts.pillow}、绮彩权杖×${counts.scepter}、时空之站×${counts.station}、神驹宝玺×${counts.seal}、浪漫城堡×${counts.castle}；现在开始逐项结算。`);

  const healingResults: HealingResolutionRecord[] = [];
  const settlePrizeHealing = (amount: number, sourceId: string): void => {
    if (amount <= 0) return;
    healingResults.push(resolveHealing(ctx.user, amount, {
      kind: 'direct',
      sourceId,
      healer: ctx.user,
    }, ctx.log));
  };
  settlePrizeHealing(Math.floor(ctx.user.maxHp * 0.06) * counts.ticket, '十连·电影票');
  settlePrizeHealing(Math.floor(ctx.user.maxHp * 0.1) * counts.candy, '十连·棉花糖');
  if (counts.pillow > 0) settlePrizeHealing(ctx.user.maxHp, '十连·爱心抱枕');
  const healed = healingResults.reduce((sum, result) => sum + result.actual, 0);

  for (let i = 0; i < counts.scepter; i += 1) {
    const captains = activeMomoCaptains(runtime, ctx.user, true);
    const captain = captains[Math.floor(Math.random() * captains.length)];
    if (captain) {
      const gain = addMomoCrowdJoyToCaptain(ctx.user, captain, 50);
      ctx.log('buff', gain.gained > 0
        ? `👑 【绮彩权杖】随机祝福 ${captain.name}，【众宾欢也】${gain.before} -> ${gain.after}（实际 +${gain.gained}）。`
        : `👑 【绮彩权杖】随机祝福 ${captain.name}，但其【众宾欢也】已经达到 138 层上限。`);
    }
  }
  let cleansed = 0;
  if (counts.station > 0) cleansed += cleanseMomoCaptains(runtime, ctx.user);
  if (counts.castle > 0) {
    const castleGains = addMomoCrowdJoy(runtime, ctx.user, 70 * counts.castle);
    const actualCastleGain = castleGains.reduce((sum, gain) => sum + gain.gained, 0);
    ctx.log('buff', `🏰 【浪漫城堡】${castleGains.length} 名舰长的【众宾欢也】实际合计增加 ${actualCastleGain} 层。`);
    cleansed += cleanseMomoCaptains(runtime, ctx.user);
  }
  let settledSeals = 0;
  for (let i = 0; i < counts.seal; i += 1) {
    if (!isActiveCombatant(ctx.user)) break;
    ctx.executeSkillAction('momo_seal_hit', ctx.user, null, ctx.triggerDepth + 1);
    settledSeals += 1;
  }
  const recoveryText = healed > 0
    ? `实际恢复 ${healed} 点生命`
    : healingResults.some((result) => result.outcome === 'blocked')
      ? '治疗奖品被完全阻止，未产生实际恢复'
      : '生命已满，治疗奖品未产生实际恢复';
  const cleanseText = cleansed > 0
    ? `清除 ${cleansed} 个负面状态`
    : '没有可清除的负面状态';
  const sealText = counts.seal === 0
    ? '本次未抽到神驹宝玺'
    : settledSeals === counts.seal
      ? `${settledSeals} 枚神驹宝玺均已分别完成命中与防护判定`
      : `抽到 ${counts.seal} 枚神驹宝玺，其中 ${settledSeals} 枚完成结算，其余因 ${ctx.user.name} 退场而取消`;
  ctx.log('info', `📦 【十连结算】${ctx.user.name} ${recoveryText}，${cleanseText}；${sealText}。`);
  return true;
}

function executePeaches(ctx: SkillContext): boolean {
  payMomoCost(ctx, Math.floor(ctx.user.currentHp * 0.4), '！？桃桃？！', (cost) => {
    ctx.log('skill', `🍑 【！？桃桃？！】${ctx.user.name}：“四个桃子花了 40 块钱！”先损失当前生命 40%（实际 ${cost} 点），随后连续出手 4 次！`);
  });
  for (let hit = 1; hit <= 4 && isActiveCombatant(ctx.user); hit += 1) {
    const selectableTargets = getSelectableTargets({
      fighters: ctx.fighters,
      battleState: ctx.battleState,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant,
    }, ctx.user);
    if (selectableTargets.length === 0) {
      ctx.log('info', `🍑 【！？桃桃？！】第 ${hit}/4 击开始前已没有可选目标，剩余 ${5 - hit} 击取消。`);
      break;
    }
    ctx.log('skill', `🍑 【！？桃桃？！】第 ${hit}/4 击开始随机寻找目标。`);
    ctx.executeSkillAction('momo_peach_hit', ctx.user, null, ctx.triggerDepth + 1);
  }
  return true;
}

function executeClawMachine(ctx: SkillContext): boolean {
  let successes = 0;
  for (let i = 0; i < 10; i += 1) if (Math.random() < 0.01) successes += 1;
  if (successes > 0) {
    const gains = addMomoCrowdJoy(asMomoRuntime(ctx), ctx.user, 138 * successes);
    const actual = gains.reduce((sum, gain) => sum + gain.gained, 0);
    ctx.log('crit', `🧸 【！？区区？！】${ctx.user.name} 十抓成功 ${successes} 次！全体舰长的【众宾欢也】补到上限，实际合计增加 ${actual} 层。`);
  } else {
    ctx.log('info', `🧸 【！？区区？！】${ctx.user.name} 连抓 10 次全部落空，没有获得众宾欢也。`);
  }
  return true;
}

export const momoSkills: Record<string, SkillDefinition> = {
  momo_what_zone: {
    name: '我是什么区的？', tag: SKILL_TAGS.PHYS, mult: 1, spellBlockMode: 'afterSetup',
    damageFormula: momoDamageFormula(1.25), cannotCrit: true,
    text: '🫧 {USER}：“直播时忘记改分区了！”攻向 {TARGET}，造成 {VAL} 点伤害！',
    onExecute: (ctx) => { addJoy(ctx, 1, '我是什么区的？'); return false; },
  },
  momo_mic_open: {
    name: '麦霸', tag: SKILL_TAGS.DEBUFF, spellBlockMode: 'afterSetup', noDamage: true,
    statusApplications: [{ identityId: 'MOMO_MIC_DEF_DOWN' }],
    text: '🎙️ {USER}：“上厕所忘记关麦了！”尝试让 {TARGET} 陷入【麦霸破防】！',
    onExecute: (ctx) => { addJoy(ctx, 3, '麦霸'); return false; },
  },
  momo_top_rank: {
    name: '我要当榜一！', tag: SKILL_TAGS.BUFF,
    text: '📦 {USER} 给自己开盲盒，却被 B 站禁止了！',
    onExecute: executeTopRank,
  },
  momo_wps_pillar: {
    name: 'WPS人柱力', tag: SKILL_TAGS.PHYS, mult: 1, spellBlockMode: 'afterSetup',
    damageFormula: momoDamageFormula(1.58), cannotCrit: true,
    text: '📄 {USER}：“忘记关会员续费了！”将账单砸向 {TARGET}，造成 {VAL} 点伤害！',
    onExecute: (ctx) => { addJoy(ctx, 21, 'WPS人柱力'); return false; },
  },
  momo_what_is_this: {
    name: '这是啥子？', tag: SKILL_TAGS.BUFF,
    text: '🧮 {USER} 背诵九九乘法表时爆出了五八四十五！',
    onExecute: (ctx) => {
      addJoy(ctx, 45, '这是啥子？');
      return true;
    },
  },
  momo_345: {
    name: '345！！！！！', tag: SKILL_TAGS.PHYS, mult: 1, spellBlockMode: 'afterSetup',
    damageFormula: momoDamageFormula(2.45), cannotCrit: true,
    text: '🦇 {USER} 数着“五八四十五”跃起，对 {TARGET} 使出骑士踢，造成 {VAL} 点伤害！',
    onExecute: (ctx) => { addJoy(ctx, 5, '345！！！！！'); return false; },
    onActionSettled: (ctx) => registerMomoRiderKick(asMomoRuntime(ctx), ctx.user, '345！！！！！'),
  },
  momo_sweep_furry: {
    name: '我去，扫福瑞！', tag: SKILL_TAGS.BUFF,
    text: '🐉 {USER} 开盲盒开出契约兽！',
    onExecute: executeSummonDragon,
  },
  momo_sword_vent: {
    name: 'SWORD VENT', tag: SKILL_TAGS.BUFF,
    text: '🗡️ 武器降临！',
    onExecute: executeSwordVent,
  },
  momo_guard_vent: {
    name: 'GUARD VENT', tag: SKILL_TAGS.BUFF,
    text: '🛡️ 防御降临！',
    onExecute: executeGuardVent,
  },
  momo_final_vent: {
    name: 'FINAL VENT', tag: SKILL_TAGS.BUFF,
    text: '🦇 契约骑士踢！',
    onExecute: executeFinalVent,
  },
  momo_final_vent_hit: {
    name: 'FINAL VENT', tag: SKILL_TAGS.PHYS, mult: 1, presentation: 'finisher',
    damageFormula: finalVentDamageFormula, cannotCrit: true,
    text: '🦇 {USER} 延续契约合击，骑士踢命中 {TARGET}，造成 {VAL} 点伤害！',
  },
  momo_dragon_strike: {
    name: '契约龙爪', tag: SKILL_TAGS.PHYS, mult: 1,
    damageFormula: momoDamageFormula(1.25), cannotCrit: true,
    text: '🐉 {USER} 以龙爪撕向 {TARGET}，造成 {VAL} 点伤害！',
  },
  momo_ten_pull: {
    name: '十连！金光！', tag: SKILL_TAGS.BUFF,
    text: '✨ {USER} 连开十次盲盒！',
    onExecute: executeTenPull,
  },
  momo_peaches: {
    name: '！？桃桃？！', tag: SKILL_TAGS.BUFF,
    text: '🍑 {USER} 四个桃子花了 40 块钱！',
    onExecute: executePeaches,
  },
  momo_peach_hit: {
    name: '！？桃桃？！', tag: SKILL_TAGS.PHYS, mult: 1,
    damageFormula: momoDamageFormula(1.08), cannotCrit: true,
    text: '🍑 {USER} 把桃子攻势打向 {TARGET}，造成 {VAL} 点伤害！',
  },
  momo_seal_hit: {
    name: '神驹宝玺', tag: SKILL_TAGS.PHYS, mult: 1, ignoreDef: true,
    damageFormula: momoDamageFormula(3.05, true), cannotCrit: true,
    text: '🏯 {USER} 亮出【神驹宝玺】镇向 {TARGET}，造成 {VAL} 点真实伤害！',
  },
  momo_claw_machine: {
    name: '！？区区？！', tag: SKILL_TAGS.BUFF,
    text: '🧸 {USER} 连抓十次玩偶！',
    onExecute: executeClawMachine,
  },
};
