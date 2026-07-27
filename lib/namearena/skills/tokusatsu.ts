import { resolveHealing, syncHpPct } from '../combatState';
import type {
  BattleCombatEffectId,
  BattleLogMetadata,
  DamageApplicationOptions,
  Fighter,
  HealingResolutionRecord,
  SkillContext,
  SkillDefinition,
  StatusInstance,
} from '../types';
import { namerenaData as Data } from '../data';
import { STATUS_IDENTITIES } from '../statusRegistry';

import { isSelectableTargetFor } from '../targeting';
import {
  enterTokusatsuThroneStance,
  getTokusatsuThroneResonance,
} from '../tokusatsuMechanics';
import { buildStatusPresentationMember } from '../statusPresentation';
import { applyStatus, hasIdentity, hasMechanic, queryDispellableStatuses, queryMechanic } from '../statusSystem';
import {
  type DamageRedirectKind,
  didDamageConnect,
  getDamageRedirectKind,
  getResolvedDamageTotal,
} from '../damageRedirects';

const {
  SKILL_TAGS,
  TOKUSATSU_BASIC_POOL,
} = Data;


function isActive(fighter: Fighter): boolean {
  return !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING');
}

function userCanContinue(ctx: SkillContext): boolean {
  return isActive(ctx.user);
}

function enemiesOf(ctx: SkillContext, user = ctx.user): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    isSelectableTargetFor({
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant: isActive,
    }, user, fighter),
  );
}

function applyTemporaryTokusatsuStats(
  fighter: Fighter,
  identityId: string,
  remainingTurns: number,
): void {
  const sourceId = `tokusatsu:${identityId.toLowerCase()}`;
  applyStatus(fighter, {
    identityId,
    remainingTurns,
    attribution: { effectSourceId: sourceId, applierId: fighter.id, applierName: fighter.name },
  });
}

function cleanseTokusatsu(ctx: SkillContext, fighter: Fighter, strength: 'normal' | 'strong' = 'strong'): number {
  return ctx.dispelStatusEffects(fighter, {
    strength,
    direction: 'negative',
  }).removed.length;
}

function activeNegativeCount(fighter: Fighter): number {
  return queryDispellableStatuses(fighter, { strength: 'strong', direction: 'negative' }).length;
}

function recoveryText(healing: HealingResolutionRecord): string {
  if (healing.actual > 0) return `恢复 ${healing.actual} 点生命`;
  return healing.outcome === 'blocked' ? '治疗被完全阻止' : '生命已满，治疗溢出';
}

function cleanseSuffix(cleanCount: number): string {
  return cleanCount > 0 ? `，清除 ${cleanCount} 个异常` : '';
}

function markIfDefeated(ctx: SkillContext, target: Fighter, skillName: string): void {
  if (target.currentHp > 0 || target.isDead || target.isDeadAnnounced) return;
  ctx.markDefeated(target, {
    message: `💀 【${skillName}】${target.name} 被 ${ctx.user.name} 的特摄终结技击败！`,
    killer: ctx.user,
  });
}

function applyNamedDamageDetailed(
  ctx: SkillContext,
  target: Fighter,
  amount: number,
  actionName: string,
  trueDamage = true,
  respectDefenses = true,
): {
  actual: number;
  connected: boolean;
  redirected: boolean;
  redirectedActual: number;
  redirectKind: DamageRedirectKind;
  defeatedDuringDamage: boolean;
  withdrawnDuringDamage: boolean;
} {
  if (!isActive(target) || amount <= 0) {
    return {
      actual: 0,
      connected: false,
      redirected: false,
      redirectedActual: 0,
      redirectKind: null,
      defeatedDuringDamage: false,
      withdrawnDuringDamage: false,
    };
  }
  const damageOptions: DamageApplicationOptions = {
    actionName,
    respectDefenses,
  };
  const actual = ctx.applyDamage(target, amount, 'skill', trueDamage, ctx.user, damageOptions);
  const redirectKind = getDamageRedirectKind(damageOptions);
  const redirectedActual = getResolvedDamageTotal(actual, damageOptions);
  return {
    actual,
    connected: redirectKind === null && didDamageConnect(actual, damageOptions),
    redirected: redirectKind !== null,
    redirectedActual,
    redirectKind,
    defeatedDuringDamage: !!damageOptions.targetDefeatedDuringDamage || target.isDead || target.isDeadAnnounced,
    withdrawnDuringDamage: !!damageOptions.targetWithdrawnDuringDamage,
  };
}

function healAndSync(ctx: SkillContext, fighter: Fighter, amount: number): HealingResolutionRecord {
  const healing = resolveHealing(fighter, amount, {
    kind: 'direct',
    sourceId: '特摄技能恢复',
    healer: fighter,
  }, ctx.log);
  syncHpPct(fighter);
  return healing;
}

function chooseSplashTargets(ctx: SkillContext, primary: Fighter, limit: number): Fighter[] {
  return enemiesOf(ctx)
    .filter((fighter) => fighter.id !== primary.id)
    .sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))
    .slice(0, limit);
}

function tokusatsuVisual(
  effectId: BattleCombatEffectId,
  source: Fighter,
  targets: readonly Fighter[],
): BattleLogMetadata {
  const targetIds = [...new Set(targets.map((target) => target.id))];
  return {
    targetIds,
    visualCue: {
      kind: 'combat_fx',
      effectId,
      sourceId: source.id,
      targetIds,
    },
  };
}

function removeOnePositiveStatus(ctx: SkillContext, target: Fighter): StatusInstance | null {
  const removable = Object.values(STATUS_IDENTITIES)
    .filter((identity) => identity.polarity === 'positive' && identity.dispelTier !== 'none')
    .flatMap((identity) => queryMechanic(target, identity.mechanicId, { identityIds: [identity.identityId] }).entries)
    .sort((a, b) => a.appliedSequence - b.appliedSequence)[0];
  if (!removable) return null;
  const removed = ctx.dispelStatusEffects(target, {
    strength: 'strong',
    direction: 'positive',
    instanceIds: [removable.instanceId],
  }).removed;
  if (removed.length === 0) return null;
  return removed[0] ?? null;
}

export const tokusatsuSkills: Record<string, SkillDefinition> = {
  tokusatsu_basic: {
    name: '特摄必杀', tag: SKILL_TAGS.PHYS, mult: 1.7, isRandomText: true,
    visualEffect: 'toku_fan_strike',
    pool: TOKUSATSU_BASIC_POOL,
    randomTextVisualEffects: [
      'toku_fan_rider_kick',
      'toku_fan_cross_beam',
      'toku_fan_rocket',
      'toku_fan_hero_punch',
      'toku_fan_hero_punch',
      'toku_fan_hero_punch',
      'toku_fan_hero_punch',
      'toku_fan_hero_punch',
      'toku_fan_hero_punch',
    ],
    text: '⚡ {USER} 大喊："{JOKE}" 向 {TARGET} 发起必杀！造成 {VAL} 点伤害！',
  },
  rider_kick: { name: '骑士踢', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_fan_rider_kick', mult: 2.8, minDamagePct: 0.65, text: '🦶 {USER} 飞跃而起，对 {TARGET} 释放了毁天灭地的骑士踢！造成 {VAL} 伤害！' },
  henshin_rehearsal: {
    name: '变身预演', tag: SKILL_TAGS.BUFF,
    condition: (u) => !!u.isTokusatsu && !u.transformed,
    text: '🧪 {USER} 在战场边缘快速调试腰带，预演下一次变身节奏！',
    onExecute: (ctx) => {
      applyTemporaryTokusatsuStats(ctx.user, 'TOKUSATSU_REHEARSAL', 3);
      applyStatus(ctx.user, { identityId: 'AIM', charges: 2 });
      ctx.log('buff', `🧪 【变身预演】${ctx.user.name} 校准腰带与武神之刃，攻击、魔力、速度小幅提升，并获得锁头准备！`, tokusatsuVisual('toku_henshin_rehearsal', ctx.user, [ctx.user]));
      return true;
    },
  },
  tokusatsu_soul: {
    name: '特摄魂', tag: SKILL_TAGS.BUFF,
    condition: (u) => !!u.isTokusatsu && !u.transformed,
    text: '🔥 {USER} 靠特摄魂咬牙稳住身体，等待真正的变身时刻！',
    onExecute: (ctx) => {
      ctx.log('heal', `🔥 【特摄魂】${ctx.user.name} 咬牙稳住身体，开始排除常规异常并修复伤势！`, tokusatsuVisual('toku_soul', ctx.user, [ctx.user]));
      const cleanCount = cleanseTokusatsu(ctx, ctx.user, 'normal');
      const healing = healAndSync(ctx, ctx.user, Math.floor(ctx.user.maxHp * 0.16 + ctx.getEffectiveStat(ctx.user, 'wis') * 2));
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 3 });
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'tokusatsu_soul' } });
      if (ctx.user.hpPct <= 0.5) applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_soul' } });
      ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🔥 【特摄魂结算】${ctx.user.name} ${recoveryText(healing)}${cleanseSuffix(cleanCount)}，获得再生与短暂法术抵挡！`);
      return true;
    },
  },
  bujin_slash: { name: '武神之刃', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_bujin_slash', mult: 3.6, ignoreDef: true, lifesteal: 0.18, minDamagePct: 0.85, text: '🗡️ {USER} 拔出黑色的武神之刃，瞬间斩过 {TARGET}！造成 {VAL} 真实伤害！' },
  miracle_magic: { name: '奇迹魔法', tag: SKILL_TAGS.MAG, visualEffect: 'toku_miracle_magic', mult: 2.8, statusApplications: [{ identityId: 'STUN' }], text: '✨ {USER} 发动奇迹炼金术！对 {TARGET} 造成 {VAL} 魔法伤害并眩晕！' },
  black_mist_wave: {
    name: '黑气斩波', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_black_mist_wave',
    spellBlockMode: 'perHit',
    condition: (u) => !!u.isTokusatsu && !!u.transformed,
    text: '🌑 {USER} 挥出【黑气斩波】，黑色剑气沿战场扩散！',
    onExecute: (ctx) => {
      const base = Math.floor(ctx.getEffectiveStat(ctx.user, 'atk') * 2.4 + ctx.getEffectiveStat(ctx.user, 'spd') * 0.45);
      const splashTargets = chooseSplashTargets(ctx, ctx.target, 2);
      ctx.log('skill', `🌑 【黑气斩波】${ctx.user.name} 挥出漆黑剑气，主斩 ${ctx.target.name}，余波追向附近敌人！`, tokusatsuVisual('toku_black_mist_wave', ctx.user, [ctx.target, ...splashTargets]));
      const primaryResult = applyNamedDamageDetailed(ctx, ctx.target, base, '黑气斩波', true);
      if (!userCanContinue(ctx)) return true;
      if (!primaryResult.redirected && !primaryResult.withdrawnDuringDamage) {
        ctx.log(primaryResult.connected ? 'skill' : 'info', primaryResult.actual > 0
          ? `🌑 【黑气斩波】${ctx.target.name} 实际承受 ${primaryResult.actual} 点真实伤害！`
          : primaryResult.connected
            ? `🌑 【黑气斩波】主斩成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`
          : `🌑 【黑气斩波】主斩被 ${ctx.target.name} 化解，没有造成生命伤害！`);
        ctx.flushDeferredDamageEvents?.();
        markIfDefeated(ctx, ctx.target, '黑气斩波');
      }
      for (const enemy of splashTargets) {
        if (!isActive(enemy)) continue;
        const splashResult = applyNamedDamageDetailed(ctx, enemy, Math.floor(base * 0.3), '黑气斩波余波', true);
        if (!userCanContinue(ctx)) return true;
        if (!splashResult.redirected && !splashResult.withdrawnDuringDamage) {
          ctx.log(splashResult.connected ? 'skill' : 'info', splashResult.actual > 0
            ? `🌑 黑气余波扫过 ${enemy.name}，实际造成 ${splashResult.actual} 点真实伤害！`
            : splashResult.connected
              ? `🌑 黑气余波成功命中 ${enemy.name}；但【黄昏余命】期间未再损失生命！`
            : `🌑 黑气余波被 ${enemy.name} 化解，没有造成生命伤害！`);
          ctx.flushDeferredDamageEvents?.();
          markIfDefeated(ctx, enemy, '黑气斩波');
        }
      }
      return true;
    },
  },
  adversity_flash: {
    name: '悲愿居合', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_adversity_flash',
    directTarget: true,
    condition: (u) => !!u.isTokusatsu && !!u.transformed,
    text: '⚔️ {USER} 以悲愿驱动武刃，踏步居合斩向 {TARGET}！',
    onExecute: (ctx) => {
      const missingPct = 1 - ctx.user.hpPct;
      const base = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'atk') * (2.35 + missingPct * 1.75) +
          ctx.getEffectiveStat(ctx.user, 'spd') * 0.5,
      );
      ctx.log('skill', `⚔️ 【悲愿居合】${ctx.user.name} 把濒死压力压进刀锋，斩向 ${ctx.target.name}！`, tokusatsuVisual('toku_adversity_flash', ctx.user, [ctx.target]));
      const damageResult = applyNamedDamageDetailed(ctx, ctx.target, base, '悲愿居合', true);
      const actual = damageResult.actual;
      if (!userCanContinue(ctx)) return true;
      const healing = healAndSync(ctx, ctx.user, Math.floor(actual * 0.25));
      const recovery = actual > 0
        ? healing.actual > 0
          ? `${ctx.user.name} 借悲愿回流恢复 ${healing.actual} 点生命`
          : healing.outcome === 'blocked'
            ? `${ctx.user.name} 的悲愿回流治疗被完全阻止`
            : `${ctx.user.name} 生命已满，悲愿回流溢出`
        : '悲愿没有形成有效回流';
      if (!damageResult.redirected) {
        ctx.log(actual > 0 && healing.actual > 0 ? 'heal' : damageResult.connected ? 'skill' : 'info', actual > 0
          ? `⚔️ 【悲愿居合】${ctx.target.name} 实际承受 ${actual} 点真实伤害，${recovery}！`
          : damageResult.connected
            ? `⚔️ 【悲愿居合】居合斩成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命，${recovery}！`
          : `⚔️ 【悲愿居合】居合斩被 ${ctx.target.name} 化解，没有造成生命伤害，${recovery}！`);
        ctx.flushDeferredDamageEvents?.();
        if (isActive(ctx.target) && !hasIdentity(ctx.target, 'WEAK') && damageResult.connected) {
          if (ctx.applyStatus(ctx.target, { identityId: 'WEAK', remainingTurns: 2 })) ctx.log('debuff', `⚔️ 【悲愿居合】${ctx.target.name} 被悲愿压制，虚弱 2 回合！`);
        }
        markIfDefeated(ctx, ctx.target, '悲愿居合');
      }
      return true;
    },
  },
  miracle_alchemy: {
    name: '奇迹炼金', tag: SKILL_TAGS.BUFF, visualEffect: 'toku_miracle_alchemy',
    condition: (u) => !!u.isTokusatsu && !!u.transformed,
    text: '✨ {USER} 展开奇迹炼金阵，修复装甲并重构异常状态！',
    onExecute: (ctx) => {
      ctx.log('heal', `✨ 【奇迹炼金】${ctx.user.name} 展开炼金阵，开始重构装甲与异常状态！`, tokusatsuVisual('toku_miracle_alchemy', ctx.user, [ctx.user]));
      const cleanCount = cleanseTokusatsu(ctx, ctx.user);
      const healing = healAndSync(
        ctx,
        ctx.user,
        Math.floor(ctx.user.maxHp * 0.22 + ctx.getEffectiveStat(ctx.user, 'mag') * 1.8 + ctx.getEffectiveStat(ctx.user, 'wis')),
      );
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'tokusatsu_miracle_alchemy' } });
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 4 });
      if (ctx.user.hpPct <= 0.48 || cleanCount > 0) applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_miracle_alchemy' } });
      applyTemporaryTokusatsuStats(ctx.user, 'TOKUSATSU_ALCHEMY_RES', 4);
      ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `✨ 【奇迹炼金结算】${ctx.user.name} ${recoveryText(healing)}${cleanseSuffix(cleanCount)}，并获得再生与法术抵挡！`);
      return true;
    },
  },
  alchemy_armor: {
    name: '炼成护甲', tag: SKILL_TAGS.BUFF, visualEffect: 'toku_alchemy_armor',
    condition: (u) => !!u.isTokusatsu && !!u.transformed,
    text: '🛡️ {USER} 以炼金术临时加厚武刃装甲！',
    onExecute: (ctx) => {
      applyTemporaryTokusatsuStats(ctx.user, 'TOKUSATSU_ALCHEMY_ARMOR', 2);
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_alchemy_armor' } });
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'tokusatsu_alchemy_armor' } });
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 2 });
      ctx.log('buff', `🛡️ 【炼成护甲】${ctx.user.name} 加厚武刃装甲，防御与魔抗提升，并获得短暂抗控制装甲、法术抵挡和再生！`, tokusatsuVisual('toku_alchemy_armor', ctx.user, [ctx.user]));
      return true;
    },
  },
  bujin_chair: {
    name: '武神王座', tag: SKILL_TAGS.BUFF, visualEffect: 'toku_bujin_chair', statusApplications: [{ identityId: 'WAIT_COUNTER' }],
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_BUJIN' && !u.counterUsed,
    text: '🪑 {USER} 召唤出武神王座并坐下，闭上眼睛进入绝对防守反击状态！',
    onExecute: (ctx) => {
      if (!ctx.user.isTokusatsu || ctx.user.job !== 'MIRACLE_BUJIN' || ctx.user.counterUsed) {
        ctx.log('info', `🪑 ${ctx.user.name} 试图召唤【武神王座】，但王座只回应奇迹武刃形态的一次悲愿。`);
        return true;
      }
      const resonance = getTokusatsuThroneResonance(ctx.user);
      enterTokusatsuThroneStance(ctx.user, 2, 2);
      const resonanceText = resonance > 0 ? `悲愿共鸣 ${resonance} 层一并燃起，` : '';
      ctx.log('buff', `🪑 【武神王座】${ctx.user.name} 坐上专属王座，${resonanceText}进入等待反击：下一次敌方主动伤害会触发奇迹怪兽武刃，并大幅减免余波！`, tokusatsuVisual('toku_bujin_chair', ctx.user, [ctx.user]));
      return true;
    },
  },
  monster_punch: { name: '怪兽重拳', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_monster_punch', mult: 3.3, minDamagePct: 0.75, statusApplications: [{ identityId: 'AIRBORNE' }], text: '🦖 {USER} 挥动巨大的星形拳套，一拳将 {TARGET} 轰飞！造成 {VAL} 伤害并击飞！' },
  energy_crush: {
    name: '能量粉碎', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_energy_crush',
    directTarget: true,
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN',
    text: '🦀 {USER} 将怪兽能量集中到双臂，对 {TARGET} 发动能量粉碎！',
    onExecute: (ctx) => {
      const base = Math.floor(ctx.getEffectiveStat(ctx.user, 'atk') * 2.0 + ctx.getEffectiveStat(ctx.user, 'mag'));
      ctx.log('skill', `🦀 【能量粉碎】${ctx.user.name} 用怪兽巨臂钳住 ${ctx.target.name}，炼金能量开始崩解护盾！`, tokusatsuVisual('toku_energy_crush', ctx.user, [ctx.target]));
      const damageResult = applyNamedDamageDetailed(ctx, ctx.target, base, '能量粉碎', true);
      const actual = damageResult.actual;
      if (!userCanContinue(ctx)) return true;
      if (damageResult.redirected) return true;
      const removedStatus = damageResult.connected ? removeOnePositiveStatus(ctx, ctx.target) : null;
      const removedName = removedStatus ? buildStatusPresentationMember(removedStatus).name : '';
      const statusText = removedStatus
        ? actual > 0
          ? `，并粉碎了【${removedName}】`
          : `；虽未造成生命损失，炼金崩解仍粉碎了【${removedName}】`
        : '';
      ctx.log(damageResult.connected ? 'skill' : 'info', actual > 0
        ? `🦀 【能量粉碎】${ctx.target.name} 实际承受 ${actual} 点真实伤害${statusText}！`
        : damageResult.connected
          ? `🦀 【能量粉碎】炼金冲击成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命${statusText}！`
        : `🦀 【能量粉碎】炼金冲击被 ${ctx.target.name} 化解，没有造成生命伤害${statusText}！`);
      ctx.flushDeferredDamageEvents?.();
      if (damageResult.connected && isActive(ctx.target) && !hasIdentity(ctx.target, 'WEAK')) {
        if (ctx.applyStatus(ctx.target, { identityId: 'WEAK', remainingTurns: 2 })) ctx.log('debuff', `🦀 【能量粉碎】${ctx.target.name} 被炼金冲击压制，虚弱 2 回合！`);
      }
      markIfDefeated(ctx, ctx.target, '能量粉碎');
      return true;
    },
  },
  miracle_armor: {
    name: '奇迹炼成装甲', tag: SKILL_TAGS.BUFF, visualEffect: 'toku_miracle_armor',
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN',
    text: '🌈 {USER} 以彩虹炼金术重铸怪兽装甲！',
    onExecute: (ctx) => {
      ctx.log('heal', `🌈 【奇迹炼成装甲】${ctx.user.name} 展开彩虹炼金阵，开始重铸怪兽装甲并净化异常！`, tokusatsuVisual('toku_miracle_armor', ctx.user, [ctx.user]));
      const cleanCount = cleanseTokusatsu(ctx, ctx.user);
      const healing = healAndSync(ctx, ctx.user, Math.floor(ctx.user.maxHp * 0.26 + ctx.getEffectiveStat(ctx.user, 'mag') * 2.2));
      applyTemporaryTokusatsuStats(ctx.user, 'TOKUSATSU_MIRACLE_ARMOR', 4);
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'tokusatsu_miracle_armor' } });
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'tokusatsu_miracle_armor' } });
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 4 });
      ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🌈 【装甲重铸完成】${ctx.user.name} ${recoveryText(healing)}${cleanseSuffix(cleanCount)}，并获得彩虹抗性、双层法术抵挡与再生！`);
      return true;
    },
  },
  bujin_monster_combo: {
    name: '武神怪兽连斩', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_monster_combo',
    spellBlockMode: 'perHit',
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN',
    text: '🗡️ {USER} 在怪兽形态下连续挥动武神之刃！',
    onExecute: (ctx) => {
      const enemies = enemiesOf(ctx);
      if (enemies.length === 0) return true;
      const hits = [ctx.target, ...chooseSplashTargets(ctx, ctx.target, 2)].filter((fighter, index, arr) => arr.findIndex((candidate) => candidate.id === fighter.id) === index);
      const base = Math.floor(ctx.getEffectiveStat(ctx.user, 'atk') * 1.1 + ctx.getEffectiveStat(ctx.user, 'spd') * 0.22);
      ctx.log('skill', `🗡️ 【武神怪兽连斩】${ctx.user.name} 以怪兽力量拖动武神之刃，连续斩击 ${hits.map((fighter) => fighter.name).join('、')}！`, tokusatsuVisual('toku_monster_combo', ctx.user, hits));
      for (const [index, enemy] of hits.entries()) {
        if (!isActive(enemy)) continue;
        const damageResult = applyNamedDamageDetailed(ctx, enemy, Math.floor(base * (index === 0 ? 1 : 0.72)), '武神怪兽连斩', true);
        if (!userCanContinue(ctx)) return true;
        if (!damageResult.redirected) {
          ctx.log(damageResult.connected ? 'skill' : 'info', damageResult.actual > 0
            ? `🗡️ 第 ${index + 1} 斩命中 ${enemy.name}，实际造成 ${damageResult.actual} 点真实伤害！`
            : damageResult.connected
              ? `🗡️ 第 ${index + 1} 斩成功命中 ${enemy.name}；但【黄昏余命】期间未再损失生命！`
            : `🗡️ 第 ${index + 1} 斩被 ${enemy.name} 化解，没有造成生命伤害！`);
          ctx.flushDeferredDamageEvents?.();
          markIfDefeated(ctx, enemy, '武神怪兽连斩');
        }
      }
      return true;
    },
  },
  monster_roar: {
    name: '怪兽咆哮', tag: SKILL_TAGS.MAG, visualEffect: 'toku_monster_roar',
    spellBlockMode: 'perHit',
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN',
    text: '📣 {USER} 发出怪兽咆哮，炼金冲击波席卷全场！',
    onExecute: (ctx) => {
      const enemies = enemiesOf(ctx);
      if (enemies.length === 0) return true;
      const base = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'mag') * 0.95 +
          ctx.getEffectiveStat(ctx.user, 'atk') * 0.22 +
          ctx.getEffectiveStat(ctx.user, 'wis') * 0.15,
      );
      ctx.log('skill', `📣 【怪兽咆哮】${ctx.user.name} 发出压制性咆哮，炼金冲击波扫过 ${enemies.length} 名敌人！`, tokusatsuVisual('toku_monster_roar', ctx.user, enemies));
      for (const enemy of enemies) {
        if (!isActive(enemy)) continue;
        const damageResult = applyNamedDamageDetailed(ctx, enemy, base, '怪兽咆哮', true);
        const actual = damageResult.actual;
        if (!userCanContinue(ctx)) return true;
        if (damageResult.redirected) continue;
        ctx.log(damageResult.connected ? 'skill' : 'info', actual > 0
          ? `📣 咆哮冲击命中 ${enemy.name}，实际造成 ${actual} 点真实伤害！`
          : damageResult.connected
            ? `📣 咆哮冲击成功命中 ${enemy.name}；但【黄昏余命】期间未再损失生命！`
          : `📣 咆哮冲击被 ${enemy.name} 化解，没有造成生命伤害！`);
        ctx.flushDeferredDamageEvents?.();
        const appliedEffects: string[] = [];
        if (damageResult.connected && isActive(enemy) && !hasIdentity(enemy, 'WEAK')) {
          if (ctx.applyStatus(enemy, { identityId: 'WEAK', remainingTurns: 2 })) appliedEffects.push('虚弱 2 回合');
        }
        if (damageResult.connected && isActive(enemy) && Math.random() < 0.35 && !hasMechanic(enemy, 'AIRBORNE')) {
          if (ctx.applyStatus(enemy, { identityId: 'AIRBORNE', remainingTurns: 1 })) appliedEffects.push('击飞 1 回合');
        }
        if (appliedEffects.length > 0) {
          ctx.log('debuff', `📣 【怪兽咆哮】${enemy.name} 被附加${appliedEffects.join('、')}！`);
        }
        markIfDefeated(ctx, enemy, '怪兽咆哮');
      }
      return true;
    },
  },
  great_monster_victory: {
    name: '怪兽胜利', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_great_monster_victory', presentation: 'finisher', mult: 7.0, ignoreDef: true, alwaysHit: true,
    directTarget: true,
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN' && !u.hasUsedGreatMonsterVictory,
    text: '⭐ {USER} 触发必杀！【GREAT MONSTER VICTORY】！星光粉碎了 {TARGET}，造成 {VAL} 伤害！',
    onExecute: (ctx) => {
      if (!ctx.user.isTokusatsu || ctx.user.job !== 'MIRACLE_MONSTER_BUJIN') {
        ctx.log('info', `⭐ ${ctx.user.name} 试图发动【GREAT MONSTER VICTORY】，但还没有进化到奇迹怪兽武刃形态！`);
        return true;
      }
      if (ctx.user.hasUsedGreatMonsterVictory) {
        ctx.log('info', `⭐ ${ctx.user.name} 已经释放过【GREAT MONSTER VICTORY】，怪兽胜利的能量没有再次回应。`);
        return true;
      }
      ctx.user.hasUsedGreatMonsterVictory = true;
      ctx.user.jobData.skills = (ctx.user.jobData.skills ?? []).filter((s) => s !== 'great_monster_victory');
      const base = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'atk') * 2.7 +
          ctx.getEffectiveStat(ctx.user, 'mag') * 1.05 +
          ctx.getEffectiveStat(ctx.user, 'spd') * 0.35,
      );
      ctx.log('crit', `⭐ 【GREAT MONSTER VICTORY】${ctx.user.name} 怪兽拳套爆发星光，终结技锁定 ${ctx.target.name}！`, tokusatsuVisual('toku_great_monster_victory', ctx.user, [ctx.target]));
      const damageResult = applyNamedDamageDetailed(ctx, ctx.target, base, 'GREAT MONSTER VICTORY', true, false);
      const actual = damageResult.actual;
      if (!userCanContinue(ctx)) return true;
      const healing = healAndSync(ctx, ctx.user, Math.floor(ctx.user.maxHp * 0.12 + actual * 0.12));
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_great_monster_victory' } });
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 3 });
      const recovery = actual > 0
        ? healing.actual > 0
          ? `${ctx.user.name} 借星光回流恢复 ${healing.actual} 点生命`
          : healing.outcome === 'blocked'
            ? `${ctx.user.name} 的星光回流治疗被完全阻止`
            : `${ctx.user.name} 生命已满，星光回流溢出`
        : '星光没有形成有效回流';
      if (damageResult.withdrawnDuringDamage) return true;
      if (damageResult.redirected) {
        const redirectText = damageResult.redirectKind === 'owl_emperor'
          ? damageResult.redirectedActual > 0
            ? `被【帝王之征】全数接走，龙实际承受 ${damageResult.redirectedActual} 点伤害`
            : '被【帝王之征】全数接走，但龙未损失生命'
          : damageResult.redirectKind === 'originium'
            ? damageResult.redirectedActual > 0
              ? `被转入源石网络，源石结晶共结算 ${damageResult.redirectedActual} 点伤害`
              : '被转入源石网络，但源石结晶均未损失生命'
            : damageResult.redirectKind === 'momo'
              ? damageResult.redirectedActual > 0
                ? `被【|OMO】均摊给舰长，舰长合计损失 ${damageResult.redirectedActual} 点生命`
                : '被【|OMO】均摊给舰长，但舰长均未损失生命'
              : damageResult.redirectKind === 'yuzu'
                ? damageResult.redirectedActual > 0
                  ? `被【镜界分摊】交给队友，队友合计损失 ${damageResult.redirectedActual} 点生命`
                  : '被【镜界分摊】交给队友，但队友均未损失生命'
              : damageResult.redirectedActual > 0
                ? `被随机恶作剧转移，转移目标实际承受 ${damageResult.redirectedActual} 点伤害`
                : '被随机恶作剧转移，但转移后仍被化解，没有单位损失生命';
        ctx.log('info', `⭐ 【GREAT MONSTER VICTORY】星光${redirectText}，原目标没有承受终结技伤害；${recovery}！`);
      } else if (damageResult.defeatedDuringDamage) {
        ctx.log(actual > 0 ? 'heal' : 'info', actual > 0
          ? `⭐ 【GREAT MONSTER VICTORY】星光造成 ${actual} 点真实伤害并触发致死连锁，后续退场已单独结算；${recovery}！`
          : `⭐ 【GREAT MONSTER VICTORY】星光未直接造成生命伤害，但触发了单独的致死连锁；${recovery}！`);
      } else {
        ctx.log(damageResult.connected ? 'heal' : 'info', actual > 0
          ? `⭐ 【GREAT MONSTER VICTORY】${ctx.target.name} 实际承受 ${actual} 点真实伤害，${recovery}！`
          : damageResult.connected
            ? `⭐ 【GREAT MONSTER VICTORY】终结星光成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命，${recovery}！`
          : `⭐ 【GREAT MONSTER VICTORY】终结星光被 ${ctx.target.name} 化解，没有造成生命伤害，${recovery}！`);
        ctx.flushDeferredDamageEvents?.();
        markIfDefeated(ctx, ctx.target, 'GREAT MONSTER VICTORY');
      }
      return true;
    },
  },
  rainbow_fever: {
    name: '彩虹狂热', tag: SKILL_TAGS.PHYS, visualEffect: 'toku_rainbow_fever', presentation: 'finisher', mult: 5.4, ignoreDef: true, alwaysHit: true,
    spellBlockMode: 'perHit',
    condition: (u) => !!u.isTokusatsu && u.job === 'MIRACLE_MONSTER_BUJIN' && !u.hasUsedRainbowFever,
    text: '🌈 {USER} 点三下彩虹龙头："Gon Gon GonGonGonGon"！推动腰带拉杆发动【彩虹狂热】："GOTCHARD RAINBOW FEVER! FEVER! FEVER! FEVER!"\n🚂 {USER} 使用炼金术将巨型列车用来附身的蒸汽列车模型再炼成，模型巨大化后与脚部一体化，化作火车头骑士踢贯穿 {TARGET}，造成 {VAL} 真实伤害！',
    onExecute: (ctx) => {
      if (!ctx.user.isTokusatsu || ctx.user.job !== 'MIRACLE_MONSTER_BUJIN') {
        ctx.log('info', `🌈 ${ctx.user.name} 试图发动【彩虹狂热】，但还没有进化到奇迹怪兽武刃形态！`);
        return true;
      }
      if (ctx.user.hasUsedRainbowFever) {
        ctx.log('info', `🌈 ${ctx.user.name} 已经释放过【彩虹狂热】，彩虹龙头暂时沉寂了下来。`);
        return true;
      }
      ctx.user.hasUsedRainbowFever = true;
      ctx.user.jobData.skills = (ctx.user.jobData.skills ?? []).filter((s) => s !== 'rainbow_fever');
      const base = Math.floor(
        ctx.getEffectiveStat(ctx.user, 'atk') * 3.0 +
          ctx.getEffectiveStat(ctx.user, 'mag') * 1.45 +
          ctx.getEffectiveStat(ctx.user, 'spd') * 0.5,
      );
      const splashTargets = chooseSplashTargets(ctx, ctx.target, 3);
      ctx.log('crit', `🌈 ${ctx.user.name} 点三下彩虹龙头："Gon Gon GonGonGonGon"！推动腰带拉杆发动【彩虹狂热】："GOTCHARD RAINBOW FEVER! FEVER! FEVER! FEVER!"`, tokusatsuVisual('toku_rainbow_fever', ctx.user, [ctx.target, ...splashTargets]));
      ctx.log('crit', `🚂 巨型蒸汽列车模型被再炼成并巨大化，与 ${ctx.user.name} 的脚部一体化，火车头骑士踢贯穿 ${ctx.target.name}！`);
      const primaryResult = applyNamedDamageDetailed(ctx, ctx.target, base, '彩虹狂热', true, false);
      const primary = primaryResult.actual;
      if (!userCanContinue(ctx)) return true;
      if (!primaryResult.redirected) {
        ctx.log(primaryResult.connected ? 'crit' : 'info', primary > 0
          ? `🌈 【彩虹狂热】${ctx.target.name} 实际承受 ${primary} 点真实伤害！`
          : primaryResult.connected
            ? `🌈 【彩虹狂热】火车头骑士踢成功命中 ${ctx.target.name}；但【黄昏余命】期间未再损失生命！`
          : `🌈 【彩虹狂热】火车头骑士踢被 ${ctx.target.name} 化解，没有造成生命伤害！`);
        ctx.flushDeferredDamageEvents?.();
        markIfDefeated(ctx, ctx.target, '彩虹狂热');
      }
      for (const enemy of splashTargets) {
        if (!isActive(enemy)) continue;
        const splashResult = applyNamedDamageDetailed(ctx, enemy, Math.floor(base * 0.18), '彩虹狂热余波', true);
        if (!userCanContinue(ctx)) return true;
        if (!splashResult.redirected) {
          ctx.log(splashResult.connected ? 'skill' : 'info', splashResult.actual > 0
            ? `🌈 彩虹列车余波撞上 ${enemy.name}，实际造成 ${splashResult.actual} 点真实伤害！`
            : splashResult.connected
              ? `🌈 彩虹列车余波成功命中 ${enemy.name}；但【黄昏余命】期间未再损失生命！`
            : `🌈 彩虹列车余波被 ${enemy.name} 化解，没有造成生命伤害！`);
          ctx.flushDeferredDamageEvents?.();
          markIfDefeated(ctx, enemy, '彩虹狂热');
        }
      }
      const healing = healAndSync(ctx, ctx.user, Math.floor(ctx.user.maxHp * 0.18 + primary * 0.1));
      const cleanCount = activeNegativeCount(ctx.user) > 0 ? cleanseTokusatsu(ctx, ctx.user) : 0;
      applyStatus(ctx.user, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'tokusatsu_rainbow_fever' } });
      applyStatus(ctx.user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'tokusatsu_rainbow_fever' } });
      applyStatus(ctx.user, { identityId: 'REGEN', remainingTurns: 4 });
      ctx.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🌈 【彩虹狂热】彩虹炼金余波回流，${ctx.user.name} ${recoveryText(healing)}${cleanseSuffix(cleanCount)}，并获得彩虹抗性、法术抵挡与再生！`);
      return true;
    },
  },
};
