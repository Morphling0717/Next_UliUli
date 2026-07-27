import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { healFighter } from '../combatState';
import { namerenaData as Data } from '../data';
import {
  formatEmoteStats,
  consumeEmoteClaimableKills,
  getEmoteAdaptTotal,
  getEmoteClaimableKills,
  grantEmoteAdaptStats,
  randomEmoteStatKeys,
} from '../emoteMechanics';

import { hasIdentity, removeEffects, applyStatus } from '../statusSystem';
import { getStatusIdentityDefinition } from '../statusRegistry';
import {
  type DamageRedirectKind,
  didDamageConnect,
  getDamageRedirectKind,
  getResolvedDamageTotal,
} from '../damageRedirects';

const { SKILL_TAGS } = Data;

type EmoteDamageResult = {
  actual: number;
  connected: boolean;
  interrupted: boolean;
  redirected: boolean;
  redirectKind: DamageRedirectKind;
};

function canContinueEmoteAction(fighter: Fighter): boolean {
  return fighter.currentHp > 0 && !fighter.isDead && !fighter.isDeadAnnounced;
}

function activePlayerTargets(ctx: SkillContext): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id &&
    !fighter.isSummon &&
    !fighter.isNpc &&
    !fighter.cannotWin &&
    fighter.currentHp > 0 &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced,
  );
}

function livingKillTargets(ctx: SkillContext): Fighter[] {
  return activePlayerTargets(ctx).filter((fighter) => getEmoteClaimableKills(fighter) > 0);
}

function resolveEmoteAttackGuards(ctx: SkillContext, target: Fighter, actionName: string): boolean {
  if (!canContinueEmoteAction(ctx.user) || !canContinueEmoteAction(target)) return false;
  if (ctx.handleWaitCounter?.(target, ctx.user, actionName)) return false;
  const interruptedByCounter = ctx.handleCounterStatus?.(target, ctx.user) ?? false;
  return !interruptedByCounter && canContinueEmoteAction(ctx.user);
}

function applyEmoteDamage(
  ctx: SkillContext,
  target: Fighter,
  amount: number,
  actionName: string,
  logText: (actual: number, redirectKind: EmoteDamageResult['redirectKind']) => string,
  guardsResolved = false,
): EmoteDamageResult {
  if (!guardsResolved && !resolveEmoteAttackGuards(ctx, target, actionName)) {
    return { actual: 0, connected: false, interrupted: true, redirected: false, redirectKind: null };
  }

  ctx.log('skill', `🎬 【${actionName}】${ctx.user.name} 锁定 ${target.name}，动作开始结算！`);
  const damageOptions: DamageApplicationOptions = {
    actionName,
    respectDefenses: true,
    canTriggerWaitCounter: false,
  };
  const actual = ctx.applyDamage(target, Math.max(1, Math.floor(amount)), 'skill', false, ctx.user, damageOptions);
  const redirectKind = getDamageRedirectKind(damageOptions);
  const redirected = redirectKind !== null;
  const resolvedActual = getResolvedDamageTotal(actual, damageOptions);
  const connected = !redirected && didDamageConnect(actual, damageOptions);
  if (!canContinueEmoteAction(ctx.user)) {
    return { actual: resolvedActual, connected, interrupted: true, redirected, redirectKind };
  }

  const outcomeText = resolvedActual > 0
    ? redirectKind === 'owl_emperor'
      ? `🐲 【${actionName}】${ctx.user.name} 对 ${target.name} 的攻击被帝王之征全数接走，龙实际承受 ${resolvedActual} 点伤害。`
      : redirectKind === 'momo'
        ? `💗 【${actionName}】${target.name} 通过【|OMO】把伤害均摊给舰长，舰长合计损失 ${resolvedActual} 点生命。`
        : redirectKind === 'yuzu'
          ? `🪞 【${actionName}】${target.name} 通过【镜界分摊】把伤害交给队友，队友合计损失 ${resolvedActual} 点生命。`
        : logText(resolvedActual, redirectKind)
    : connected
      ? `🎭 【${actionName}】${ctx.user.name} 的攻击成功命中 ${target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命。`
    : redirectKind === 'joker'
      ? `🎭 【${actionName}】攻击被 ${target.name} 的随机恶作剧带偏，但转移后仍被化解，没有单位损失生命。`
      : redirectKind === 'originium'
        ? `𖽚 【${actionName}】攻击被阿喃那转入源石网络，但源石结晶均未损失生命。`
        : redirectKind === 'owl_emperor'
          ? `🐲 【${actionName}】攻击被帝王之征全数接走，但龙未损失生命。`
          : redirectKind === 'momo'
            ? `💗 【${actionName}】${target.name} 通过【|OMO】完成均摊，但舰长均未损失生命。`
            : redirectKind === 'yuzu'
              ? `🪞 【${actionName}】${target.name} 通过【镜界分摊】把伤害交给队友，但队友均未损失生命。`
            : `🛡️ 【${actionName}】${ctx.user.name} 的攻击被 ${target.name} 化解，没有造成生命伤害。`;
  ctx.log(resolvedActual > 0 || connected ? 'skill' : 'info', outcomeText);
  if (resolvedActual > 0 || connected) ctx.flushDeferredDamageEvents?.();
  if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    ctx.markDefeated(target, {
      message: `💀 【${actionName}】${target.name} 被 ${ctx.user.name} 的适应轮盘碾碎！`,
      killer: ctx.user,
    });
  }
  return { actual: resolvedActual, connected, interrupted: false, redirected, redirectKind };
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function executeMemeSlap(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.getEffectiveStat(ctx.user, 'mag') * 1.2 +
    ctx.getEffectiveStat(ctx.user, 'wis') * 0.8 +
    ctx.user.maxHp * 0.045 +
    adaptTotal * 0.08;
  const statusPool = ['WEAK', 'EMBARRASSED', 'NO_HEAL'];
  const status = statusPool[Math.floor(Math.random() * statusPool.length)] ?? 'WEAK';
  const { connected, interrupted, redirected } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '表情包糊脸',
    (damage, redirectKind) => redirectKind === 'joker'
      ? `🫠 【表情包糊脸】${ctx.user.name} 把一整套怪表情怼向 ${ctx.target.name}，但表情包被随机恶作剧带偏，转移目标实际承受 ${damage} 点伤害！`
      : redirectKind === 'originium'
        ? `🫠 【表情包糊脸】${ctx.user.name} 把一整套怪表情怼向 ${ctx.target.name}，但阿喃那将冲击转入源石网络，共对源石结晶结算 ${damage} 点伤害；阿喃那本体未受伤！`
        : `🫠 【表情包糊脸】${ctx.user.name} 把一整套怪表情怼到 ${ctx.target.name} 脸上，实际造成 ${damage} 点伤害！`,
  );
  if (interrupted) return true;
  if (connected && !redirected && Math.random() < 0.45 && ctx.target.currentHp > 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
    if (ctx.applyStatus(ctx.target, { identityId: status, remainingTurns: 1 })) {
      ctx.log('debuff', `🫠 【表情污染】${ctx.target.name} 被表情干扰，获得【${getStatusIdentityDefinition(status).displayName}】1 回合！`);
    }
  }
  return true;
}

function executeTenthClaim(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.getEffectiveStat(ctx.user, 'atk') * 1.5 +
    ctx.getEffectiveStat(ctx.user, 'mag') * 1.2 +
    ctx.user.maxHp * 0.055 +
    adaptTotal * 0.12;
  const killsBefore = getEmoteClaimableKills(ctx.target);
  const { connected, interrupted, redirected } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '十分之一索赔',
    (damage, redirectKind) => redirectKind === 'joker'
      ? `📜 【十分之一索赔】${ctx.user.name} 翻出认主账本，向 ${ctx.target.name} 追讨战绩债，但账本被随机恶作剧带偏，转移目标实际承受 ${damage} 点伤害！`
      : redirectKind === 'originium'
        ? `📜 【十分之一索赔】${ctx.user.name} 向 ${ctx.target.name} 追讨战绩债，但阿喃那将冲击转入源石网络，共对源石结晶结算 ${damage} 点伤害；阿喃那本体未受伤！`
        : `📜 【十分之一索赔】${ctx.user.name} 翻出认主账本，向 ${ctx.target.name} 追讨战绩债，实际造成 ${damage} 点伤害！`,
  );
  if (interrupted) return true;
  if (redirected) return true;
  if (!canContinueEmoteAction(ctx.target)) return true;

  if (connected && killsBefore > 0) {
    consumeEmoteClaimableKills(ctx.target, 1);
    const killsAfter = getEmoteClaimableKills(ctx.target);
    const keys = randomEmoteStatKeys(2);
    const gain = grantEmoteAdaptStats(ctx.user, ctx.target, 0.05, keys);
    ctx.log('buff', `📜 【适应记录】${ctx.user.name} 复制 ${ctx.target.name} 的两项属性（${formatEmoteStats(gain)}），${ctx.target.name} 的真实击杀统计不变，认主账本余额 ${killsBefore} -> ${killsAfter}。`);
  } else if (connected) {
    ctx.log('info', `📜 ${ctx.target.name} 现在没有击杀数，${ctx.user.name} 只能记账，暂时没有复制到属性。`);
  }
  return true;
}

function executeAdaptationWheel(ctx: SkillContext): boolean {
  applyStatus(ctx.user, { identityId: 'EMOTE_ADAPT', remainingTurns: 2 });
  ctx.log('buff', `🧿 【适应转轮】${ctx.user.name} 背后的轮盘开始转动：下一次受到玩家伤害时减免 30%，并复制攻击者 3% 属性。`);
  return true;
}

function executeMarkOwner(ctx: SkillContext): boolean {
  if (!resolveEmoteAttackGuards(ctx, ctx.target, '先认个脸熟')) return true;

  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.getEffectiveStat(ctx.user, 'wis') + ctx.user.maxHp * 0.025 + adaptTotal * 0.05;
  const { connected, interrupted, redirected, redirectKind } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '先认个脸熟',
    (damage, kind) => kind === 'joker'
      ? `👁️ 【先认个脸熟】${ctx.user.name} 盯向 ${ctx.target.name}，但视线被随机恶作剧带偏，转移目标实际承受 ${damage} 点伤害！`
      : kind === 'originium'
        ? `👁️ 【先认个脸熟】${ctx.user.name} 盯向 ${ctx.target.name}，但阿喃那将冲击转入源石网络，共对源石结晶结算 ${damage} 点伤害；阿喃那本体未受伤！`
        : damage > 0
          ? `👁️ 【先认个脸熟】${ctx.user.name} 死死盯住 ${ctx.target.name}，先把未来主人的脸记下来，实际造成 ${damage} 点伤害！`
          : `👁️ 【先认个脸熟】${ctx.user.name} 盯向 ${ctx.target.name}，但防护把视线挡开，没有造成生命伤害！`,
    true,
  );
  if (interrupted) return true;
  if (redirected) {
    const redirectedReason = redirectKind === 'originium'
      ? '被阿喃那转入源石网络'
      : redirectKind === 'owl_emperor'
        ? `被 ${ctx.target.name} 的【帝王之征】全数接走`
        : redirectKind === 'momo'
          ? `被 ${ctx.target.name} 通过【|OMO】均摊给舰长`
          : redirectKind === 'yuzu'
            ? `被 ${ctx.target.name} 通过【镜界分摊】交给队友`
          : `被 ${ctx.target.name} 的随机恶作剧转走`;
    ctx.log('info', `👁️ 【脸熟失败】${ctx.user.name} 的视线${redirectedReason}，暂时没有记住这张脸。`);
    return true;
  }
  if (connected && ctx.target.currentHp > 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
    const familiarApplied = ctx.applyStatus(ctx.target, { identityId: 'EMOTE_FAMILIAR', remainingTurns: 3, attribution: { effectSourceId: ctx.user.id } });
    if (!familiarApplied) {
      ctx.log('info', `👁️ 【脸熟失败】${ctx.target.name} 的保命净化抹掉了这次认脸标记，${ctx.user.name} 保留原来的认主记忆。`);
      return true;
    }
    ctx.fighters.forEach((fighter) => {
      if (fighter.id === ctx.target.id) return;
      removeEffects(fighter, { identityIds: ['EMOTE_FAMILIAR'], effectSourceIds: [ctx.user.id], reason: 'replaced' });
    });
    ctx.user.emoteFamiliarTargetId = ctx.target.id;
    const weakened = ctx.applyStatus(ctx.target, { identityId: 'WEAK', remainingTurns: 1 });
    ctx.log('debuff', `👁️ 【脸熟】如果 ${ctx.user.name} 在 3 回合内死亡，认主会优先找 ${ctx.target.name}${weakened ? `；${ctx.target.name} 还被盯得有点虚弱` : '；但虚弱效果被抵抗'}。`);
  } else if (!connected) {
    ctx.log('info', `👁️ 【脸熟失败】${ctx.user.name} 没能穿过 ${ctx.target.name} 的防护，暂时没有记住这张脸。`);
  } else {
    ctx.log('info', `👁️ 【脸熟中断】${ctx.target.name} 已经倒下，不能再成为 ${ctx.user.name} 的临时主人候选。`);
  }
  return true;
}

function executeWheelCleave(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const zeroKillMultiplier = getEmoteClaimableKills(ctx.target) === 0 ? 1.2 : 1;
  const amount = (
    ctx.getEffectiveStat(ctx.user, 'atk') * 2.0 +
    ctx.getEffectiveStat(ctx.user, 'spd') * 1.2 +
    ctx.getEffectiveStat(ctx.user, 'agl') * 1.2 +
    ctx.user.maxHp * 0.08 +
    adaptTotal * 0.35
  ) * zeroKillMultiplier;
  applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '退魔之剑',
    (damage, redirectKind) => {
      const zeroText = getEmoteClaimableKills(ctx.target) === 0 ? '，认主账本余额为 0 的锚点目标被轮盘额外校准' : '';
      if (redirectKind === 'joker') {
        return `🧿 【退魔之剑】${ctx.user.name} 将累计适应值压进轮盘，一刀切向 ${ctx.target.name}${zeroText}，但刀路被随机恶作剧带偏，转移目标实际承受 ${damage} 点伤害！`;
      }
      if (redirectKind === 'originium') {
        return `🧿 【退魔之剑】${ctx.user.name} 一刀切向 ${ctx.target.name}${zeroText}，但阿喃那将斩击转入源石网络，共对源石结晶结算 ${damage} 点伤害；阿喃那本体未受伤！`;
      }
      return `🧿 【退魔之剑】${ctx.user.name} 将累计适应值压进轮盘，一刀切向 ${ctx.target.name}${zeroText}，实际造成 ${damage} 点伤害！`;
    },
  );
  return true;
}

function executeAllMastersReturn(ctx: SkillContext): boolean {
  const targets = livingKillTargets(ctx);
  if (targets.length === 0) {
    ctx.log('info', `🔁 【万主归一】${ctx.user.name} 试图召回所有认主账本，但场上没有带击杀数的玩家。`);
    return true;
  }

  ctx.setVisualTargets(targets);
  applyStatus(ctx.user, { identityId: 'EMOTE_ULT_COOLDOWN', remainingTurns: 3 });
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.getEffectiveStat(ctx.user, 'mag') * 1.5 +
    ctx.getEffectiveStat(ctx.user, 'wis') * 1.5 +
    ctx.user.maxHp * 0.06 +
    adaptTotal * 0.18;
  ctx.log('skill', `🔁 【万主归一】${ctx.user.name} 把认主账本摊开，${targets.length} 名有击杀数的玩家同时被轮盘点名：${targets.map((target) => target.name).join('、')}！`);

  let interrupted = false;
  const affectedTargetIds = new Set<string>();
  targets.forEach((target) => {
    if (interrupted || !canContinueEmoteAction(ctx.user)) return;
    if (target.currentHp <= 0 || target.isDead || target.isDeadAnnounced) return;
    const result = applyEmoteDamage(
      ctx,
      target,
      amount,
      '万主归一',
      (damage, redirectKind) => redirectKind === 'joker'
        ? `🔁 【万主归一】轮盘账本扫过 ${target.name}，但账页被随机恶作剧带偏，转移目标实际承受 ${damage} 点伤害！`
        : redirectKind === 'originium'
          ? `🔁 【万主归一】轮盘账本扫过 ${target.name}，但阿喃那将冲击转入源石网络，共对源石结晶结算 ${damage} 点伤害；阿喃那本体未受伤！`
          : `🔁 【万主归一】轮盘账本扫过 ${target.name}，实际造成 ${damage} 点伤害！`,
    );
    interrupted = result.interrupted;
    if (result.connected && !result.redirected) affectedTargetIds.add(target.id);
  });
  if (interrupted || !canContinueEmoteAction(ctx.user)) return true;
  if (affectedTargetIds.size === 0) return true;

  const survivorsWithKills = targets.filter((target) =>
    affectedTargetIds.has(target.id) &&
    target.currentHp > 0 &&
    !target.isDead &&
    !target.isDeadAnnounced &&
    getEmoteClaimableKills(target) > 0,
  );
  const chosen = survivorsWithKills[Math.floor(Math.random() * survivorsWithKills.length)];
  if (!chosen) return true;

  const killsBefore = getEmoteClaimableKills(chosen);
  consumeEmoteClaimableKills(chosen, 1);
  const killsAfter = getEmoteClaimableKills(chosen);
  ctx.log('debuff', `🔁 【认主账本回拨】${chosen.name} 被 ${ctx.user.name} 的账本划掉一笔，账本余额 ${killsBefore} -> ${killsAfter}；真实击杀统计不变。`);
  if (killsBefore > 0 && killsAfter === 0) {
    const healed = healFighter(ctx.user, Math.floor(ctx.getEffectiveStat(ctx.user, 'wis') + adaptTotal * 0.08), ctx.log);
    if (healed > 0) {
      ctx.log('heal', `🔁 【零杀锚点】场上出现新的“认主账本余额为 0”玩家，${ctx.user.name} 的复活锚点发亮，恢复 ${healed} 点生命。`);
    }
  }
  return true;
}

export const emoteSkills: Record<string, SkillDefinition> = {
  emote_meme_slap: {
    name: '表情包糊脸',
    tag: SKILL_TAGS.MAG,
    directTarget: true,
    rate: 0.45,
    onExecute: executeMemeSlap,
  },
  emote_tenth_claim: {
    name: '十分之一索赔',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    rate: 0.42,
    onExecute: executeTenthClaim,
  },
  emote_adaptation_wheel: {
    name: '适应转轮',
    tag: SKILL_TAGS.BUFF,
    rate: 0.38,
    condition: (user) => !hasStatus(user, 'EMOTE_ADAPT'),
    onExecute: executeAdaptationWheel,
  },
  emote_mark_owner: {
    name: '先认个脸熟',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    rate: 0.32,
    onExecute: executeMarkOwner,
  },
  emote_wheel_cleave: {
    name: '退魔之剑',
    tag: SKILL_TAGS.SPECIAL,
    directTarget: true,
    rate: 0.38,
    onExecute: executeWheelCleave,
  },
  emote_all_masters_return: {
    name: '万主归一',
    tag: SKILL_TAGS.SPECIAL,
    spellBlockMode: 'perHit',
    rate: 0.18,
    condition: (user) =>
      !hasStatus(user, 'EMOTE_ULT_COOLDOWN') &&
      ((user.emoteDeathCount ?? 0) >= 2 || getEmoteAdaptTotal(user) >= 80),
    onExecute: executeAllMastersReturn,
  },
};
