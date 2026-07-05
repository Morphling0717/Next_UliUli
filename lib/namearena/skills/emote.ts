import type { DamageApplicationOptions, Fighter, SkillContext, SkillDefinition } from '../types';
import { healFighter } from '../combatState';
import { namerenaData as Data } from '../data';
import {
  formatEmoteStats,
  getEmoteAdaptTotal,
  grantEmoteAdaptStats,
  randomEmoteStatKeys,
} from '../emoteMechanics';

const { SKILL_TAGS } = Data;

type EmoteDamageResult = {
  actual: number;
  interrupted: boolean;
  redirected: boolean;
};

function canContinueEmoteAction(fighter: Fighter): boolean {
  return fighter.currentHp > 0 && !fighter.isDead && !fighter.isDeadAnnounced;
}

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  const existing = fighter.status.find((status) =>
    status.type === type && (!sourceId || status.sourceId === sourceId),
  );
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (sourceId) existing.sourceId = sourceId;
    delete existing.appliedTurn;
    return;
  }
  fighter.status.push({ type, duration, ...(sourceId ? { sourceId } : {}) });
}

function activePlayerTargets(ctx: SkillContext): Fighter[] {
  return ctx.fighters.filter((fighter) =>
    fighter.id !== ctx.user.id &&
    !fighter.isSummon &&
    fighter.currentHp > 0 &&
    !fighter.isDead &&
    !fighter.isDeadAnnounced,
  );
}

function livingKillTargets(ctx: SkillContext): Fighter[] {
  return activePlayerTargets(ctx).filter((fighter) => fighter.stats.kills > 0);
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
  logText: (actual: number, redirected: boolean) => string,
  guardsResolved = false,
): EmoteDamageResult {
  if (!guardsResolved && !resolveEmoteAttackGuards(ctx, target, actionName)) {
    return { actual: 0, interrupted: true, redirected: false };
  }

  const damageOptions: DamageApplicationOptions = {
    actionName,
    respectDefenses: true,
    canTriggerWaitCounter: false,
  };
  const actual = ctx.applyDamage(target, Math.max(1, Math.floor(amount)), 'skill', false, ctx.user, damageOptions);
  const redirected = !!damageOptions.redirectedByJoker;
  if (!canContinueEmoteAction(ctx.user)) {
    return { actual, interrupted: true, redirected };
  }

  ctx.user.stats.dmgDealt += actual;
  ctx.log(actual > 0 ? 'skill' : 'info', logText(actual, redirected));
  if (actual > 0) ctx.flushDeferredDamageEvents?.();
  if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    ctx.markDefeated(target, {
      message: `💀 【${actionName}】${target.name} 被 ${ctx.user.name} 的适应轮盘碾碎！`,
      killer: ctx.user,
    });
  }
  return { actual, interrupted: false, redirected };
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function executeMemeSlap(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.user.mag * 1.2 + ctx.user.wis * 0.8 + ctx.user.maxHp * 0.045 + adaptTotal * 0.08;
  const statusPool = ['WEAK', 'CONFUSED', 'NO_HEAL'];
  const status = statusPool[Math.floor(Math.random() * statusPool.length)] ?? 'WEAK';
  const { actual, interrupted } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '表情包糊脸',
    (damage, redirected) => redirected
      ? `🫠 【表情包糊脸】${ctx.user.name} 把一整套怪表情怼向 ${ctx.target.name}，但表情包被随机恶作剧带偏，原目标实际造成 ${damage} 点伤害！`
      : `🫠 【表情包糊脸】${ctx.user.name} 把一整套怪表情怼到 ${ctx.target.name} 脸上，实际造成 ${damage} 点伤害！`,
  );
  if (interrupted) return true;
  if (actual > 0 && Math.random() < 0.45 && ctx.target.currentHp > 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
    refreshStatus(ctx.target, status, 1);
    ctx.log('debuff', `🫠 【表情污染】${ctx.target.name} 被表情干扰，获得【${ctx.STATUS_EFFECTS[status]?.name ?? status}】1 回合！`);
  }
  return true;
}

function executeTenthClaim(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.user.atk * 1.5 + ctx.user.mag * 1.2 + ctx.user.maxHp * 0.055 + adaptTotal * 0.12;
  const killsBefore = ctx.target.stats.kills;
  const { actual, interrupted, redirected } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '十分之一索赔',
    (damage, wasRedirected) => wasRedirected
      ? `📜 【十分之一索赔】${ctx.user.name} 翻出认主账本，向 ${ctx.target.name} 追讨战绩债，但账本被随机恶作剧带偏，原目标实际造成 ${damage} 点伤害！`
      : `📜 【十分之一索赔】${ctx.user.name} 翻出认主账本，向 ${ctx.target.name} 追讨战绩债，实际造成 ${damage} 点伤害！`,
  );
  if (interrupted) return true;
  if (redirected) return true;

  if (actual > 0 && killsBefore > 0) {
    ctx.target.stats.kills = Math.max(0, ctx.target.stats.kills - 1);
    const keys = randomEmoteStatKeys(2);
    const gain = grantEmoteAdaptStats(ctx.user, ctx.target, 0.05, keys);
    ctx.log('buff', `📜 【适应记录】${ctx.user.name} 复制 ${ctx.target.name} 的两项属性（${formatEmoteStats(gain)}），${ctx.target.name} 属性不降低，击杀数 ${killsBefore} -> ${ctx.target.stats.kills}。`);
  } else if (actual > 0) {
    ctx.log('info', `📜 ${ctx.target.name} 现在没有击杀数，${ctx.user.name} 只能记账，暂时没有复制到属性。`);
  }
  return true;
}

function executeAdaptationWheel(ctx: SkillContext): boolean {
  refreshStatus(ctx.user, 'EMOTE_ADAPT', 2);
  ctx.log('buff', `🧿 【适应转轮】${ctx.user.name} 背后的轮盘开始转动：下一次受到玩家伤害时减免 30%，并复制攻击者 3% 属性。`);
  return true;
}

function executeMarkOwner(ctx: SkillContext): boolean {
  if (!resolveEmoteAttackGuards(ctx, ctx.target, '先认个脸熟')) return true;

  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.user.wis + ctx.user.maxHp * 0.025 + adaptTotal * 0.05;
  const { actual, interrupted, redirected } = applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '先认个脸熟',
    (damage, wasRedirected) => wasRedirected
      ? `👁️ 【先认个脸熟】${ctx.user.name} 盯向 ${ctx.target.name}，但视线被随机恶作剧带偏，原目标实际造成 ${damage} 点伤害！`
      : damage > 0
      ? `👁️ 【先认个脸熟】${ctx.user.name} 死死盯住 ${ctx.target.name}，先把未来主人的脸记下来，实际造成 ${damage} 点伤害！`
      : `👁️ 【先认个脸熟】${ctx.user.name} 盯向 ${ctx.target.name}，但防护把视线挡开，实际造成 0 点伤害！`,
    true,
  );
  if (interrupted) return true;
  if (redirected) {
    ctx.log('info', `👁️ 【脸熟失败】${ctx.user.name} 的视线被 ${ctx.target.name} 的随机恶作剧转走，暂时没有记住这张脸。`);
    return true;
  }
  if (actual > 0 && ctx.target.currentHp > 0 && !ctx.target.isDead && !ctx.target.isDeadAnnounced) {
    ctx.fighters.forEach((fighter) => {
      fighter.status = fighter.status.filter((status) =>
        !(status.type === 'EMOTE_FAMILIAR' && status.sourceId === ctx.user.id),
      );
    });
    ctx.user.emoteFamiliarTargetId = ctx.target.id;
    refreshStatus(ctx.target, 'EMOTE_FAMILIAR', 3, ctx.user.id);
    refreshStatus(ctx.target, 'WEAK', 1);
    ctx.log('debuff', `👁️ 【脸熟】如果 ${ctx.user.name} 在 3 回合内死亡，认主会优先找 ${ctx.target.name}；${ctx.target.name} 还被盯得有点虚弱。`);
  } else if (actual <= 0) {
    ctx.log('info', `👁️ 【脸熟失败】${ctx.user.name} 没能穿过 ${ctx.target.name} 的防护，暂时没有记住这张脸。`);
  } else {
    ctx.log('info', `👁️ 【脸熟中断】${ctx.target.name} 已经倒下，不能再成为 ${ctx.user.name} 的临时主人候选。`);
  }
  return true;
}

function executeWheelCleave(ctx: SkillContext): boolean {
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const zeroKillMultiplier = ctx.target.stats.kills === 0 ? 1.2 : 1;
  const amount = (
    ctx.user.atk * 2.0 +
    ctx.user.spd * 1.2 +
    ctx.user.agl * 1.2 +
    ctx.user.maxHp * 0.08 +
    adaptTotal * 0.35
  ) * zeroKillMultiplier;
  applyEmoteDamage(
    ctx,
    ctx.target,
    amount,
    '轮盘斩',
    (damage, redirected) => {
      const zeroText = ctx.target.stats.kills === 0 ? '，零击杀目标被轮盘额外校准' : '';
      if (redirected) {
        return `🧿 【轮盘斩】${ctx.user.name} 将累计适应值压进轮盘，一刀切向 ${ctx.target.name}${zeroText}，但刀路被随机恶作剧带偏，原目标实际造成 ${damage} 点伤害！`;
      }
      return `🧿 【轮盘斩】${ctx.user.name} 将累计适应值压进轮盘，一刀切向 ${ctx.target.name}${zeroText}，实际造成 ${damage} 点伤害！`;
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

  refreshStatus(ctx.user, 'EMOTE_ULT_COOLDOWN', 3);
  const adaptTotal = getEmoteAdaptTotal(ctx.user);
  const amount = ctx.user.mag * 1.5 + ctx.user.wis * 1.5 + ctx.user.maxHp * 0.06 + adaptTotal * 0.18;
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
      (damage, redirected) => redirected
        ? `🔁 【万主归一】轮盘账本扫过 ${target.name}，但账页被随机恶作剧带偏，原目标实际造成 ${damage} 点伤害！`
        : `🔁 【万主归一】轮盘账本扫过 ${target.name}，实际造成 ${damage} 点伤害！`,
    );
    interrupted = result.interrupted;
    if (result.actual > 0 && !result.redirected) affectedTargetIds.add(target.id);
  });
  if (interrupted || !canContinueEmoteAction(ctx.user)) return true;
  if (affectedTargetIds.size === 0) return true;

  const survivorsWithKills = targets.filter((target) =>
    affectedTargetIds.has(target.id) &&
    target.currentHp > 0 &&
    !target.isDead &&
    !target.isDeadAnnounced &&
    target.stats.kills > 0,
  );
  const chosen = survivorsWithKills[Math.floor(Math.random() * survivorsWithKills.length)];
  if (!chosen) return true;

  const killsBefore = chosen.stats.kills;
  chosen.stats.kills = Math.max(0, chosen.stats.kills - 1);
  ctx.log('debuff', `🔁 【击杀数回拨】${chosen.name} 被 ${ctx.user.name} 的账本划掉一笔，击杀数 ${killsBefore} -> ${chosen.stats.kills}。`);
  if (killsBefore > 0 && chosen.stats.kills === 0) {
    const healed = healFighter(ctx.user, Math.floor(ctx.user.wis + adaptTotal * 0.08));
    if (healed > 0) {
      ctx.log('heal', `🔁 【零杀锚点】场上出现新的 0 击杀玩家，${ctx.user.name} 的复活锚点发亮，恢复 ${healed} 点生命。`);
    }
  }
  return true;
}

export const emoteSkills: Record<string, SkillDefinition> = {
  emote_meme_slap: {
    name: '表情包糊脸',
    tag: SKILL_TAGS.MAG,
    rate: 0.45,
    onExecute: executeMemeSlap,
  },
  emote_tenth_claim: {
    name: '十分之一索赔',
    tag: SKILL_TAGS.SPECIAL,
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
    rate: 0.32,
    onExecute: executeMarkOwner,
  },
  emote_wheel_cleave: {
    name: '轮盘斩',
    tag: SKILL_TAGS.SPECIAL,
    rate: 0.38,
    onExecute: executeWheelCleave,
  },
  emote_all_masters_return: {
    name: '万主归一',
    tag: SKILL_TAGS.SPECIAL,
    rate: 0.18,
    condition: (user) =>
      !hasStatus(user, 'EMOTE_ULT_COOLDOWN') &&
      ((user.emoteDeathCount ?? 0) >= 2 || getEmoteAdaptTotal(user) >= 80),
    onExecute: executeAllMastersReturn,
  },
};
