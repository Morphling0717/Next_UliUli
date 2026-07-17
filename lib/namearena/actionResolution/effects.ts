import type {
  Fighter,
  SkillDefinition,
} from '../types';
import { healFighter } from '../combatState';
import type { ActionResolutionRuntime } from './types';
import {
  grantStatus,
  statusSourceFromSkill,
} from '../defenseStatus';
import { consumeStatusCharge, normalizeStatusEntry } from '../statusLifecycle';
import { isCompetitiveTarget, isSelectableTargetFor } from '../targeting';
import { withTimedStatModifiersSuspended } from '../statModifiers';

const CHIMERA_BABY_SYNC_SKILLS: Record<string, string> = {
  chimera_devour: 'baby_feed',
  chimera_execute: 'baby_laser',
  chimera_funnels: 'baby_satellite',
  chimera_reconstruct: 'baby_cheer',
  chimera_petrify: 'baby_scan',
  chimera_fortress: 'baby_shield',
  chimera_warp: 'baby_speed',
  chimera_plague: 'baby_poison',
};

const VALO_FOCUS_MAX = 10;

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(fighter, type, duration, sourceId);
}

function gainValorantFocus(fighter: Fighter, amount: number): void {
  fighter.crosshairFocus = Math.min(VALO_FOCUS_MAX, Math.max(0, (fighter.crosshairFocus ?? 0) + amount));
}

function restoreValorantOperatorMobility(fighter: Fighter): boolean {
  if (!fighter.savedSpd) return false;
  fighter.spd = fighter.savedSpd;
  fighter.agl = fighter.savedAgl ?? fighter.agl;
  delete fighter.savedSpd;
  delete fighter.savedAgl;
  fighter.status = fighter.status.filter((status) => status.type !== 'VALO_OPERATOR_PENALTY');
  return true;
}

function activeEnemyCount(runtime: ActionResolutionRuntime, user: Fighter): number {
  return runtime.fighters.filter((fighter) =>
    isCompetitiveTarget(fighter) && isSelectableTargetFor(runtime, user, fighter),
  ).length;
}

export function applySelfDamage(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (!skill.selfDmgPct) return;

  const selfDamageFloor = skill.selfDmgCanKill ? 0 : 1;
  const beforeHp = user.currentHp;
  user.currentHp = Math.max(selfDamageFloor, user.currentHp - Math.floor(user.maxHp * skill.selfDmgPct));
  runtime.syncHpPct(user);
  const actualSelfDmg = Math.max(0, beforeHp - user.currentHp);
  if (actualSelfDmg > 0) {
    runtime.log('info', `🩸 ${user.name} 因【${skill.name}】反噬，实际损失 ${actualSelfDmg} 点生命！`);
  }
}

export function applyAttackerStyleEffects(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  allowHostileStatus = true,
): void {
  if (user.status.some((status) => status.type === 'STYLE_VAIN')) {
    const stealAtk = Math.floor(target.atk * 0.1);
    const stealMag = Math.floor(target.mag * 0.1);
    withTimedStatModifiersSuspended(target, () => {
      target.atk = Math.max(1, target.atk - stealAtk);
      target.mag = Math.max(1, target.mag - stealMag);
    });
    withTimedStatModifiersSuspended(user, () => {
      user.atk += stealAtk;
      user.mag += stealMag;
    });
    runtime.log('buff', `💅 虚荣窃取！${user.name} 偷走了 ${target.name} 的属性化为己用！(吸收了攻击和魔力)`);
  }

  if (allowHostileStatus && user.status.some((status) => status.type === 'STYLE_FOOL') && Math.random() < 0.5) {
    const debuffs = ['STUN', 'FREEZE', 'POISON', 'BURN'];
    const randomDebuff = debuffs[Math.floor(Math.random() * debuffs.length)];
    if (runtime.applyStatus(target, randomDebuff, 2, { applierId: user.id, applierName: user.name })) {
      runtime.log('skill', `🤪 笨蛋女人乱拳挥舞！不经意间给 ${target.name} 附加了【${runtime.statusEffects[randomDebuff]?.name ?? randomDebuff}】异常状态！`);
    }
  }
}

export function applySkillStatusEffect(
  runtime: ActionResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  target: Fighter,
  allowTargetStatus = true,
): void {
  if (!skill.status) return;

  const recipient = skill.statusTarget === 'user' ? user : target;
  if (!allowTargetStatus && recipient.id === target.id) return;
  const sourceId = statusSourceFromSkill(skill);
  const applied = runtime.applyStatus(recipient, skill.status, 2, {
    sourceId,
    applierId: user.id,
    applierName: user.name,
  });
  if (!applied) return;
  if (!runtime.isActiveCombatant(recipient)) return;

  const status = recipient.status.find((entry) =>
    entry.type === skill.status && (!sourceId || entry.sourceId === sourceId),
  );
  if (!status) return;
  normalizeStatusEntry(status);
  const statusName = runtime.statusEffects[skill.status]?.name ?? skill.status;
  const remaining = status.remainingTurns ?? status.duration;
  const durationText = status.expiresOn === 'global_action_end'
    ? `，持续接下来 ${remaining} 个全局行动回合`
    : status.expiresOn === 'self_turn_end'
      ? `，影响接下来 ${remaining} 次自身行动`
      : status.expiresOn === 'trigger'
        ? `，可触发 ${status.charges ?? status.duration} 次`
        : '';
  runtime.log(
    recipient.id === user.id ? 'buff' : 'debuff',
    `📌 【状态结算】${recipient.name} 获得【${statusName}】${durationText}。`,
  );
}

export function handleValorantWeaponDrop(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  actualDmg: number,
): void {
  if (target.job !== 'VALO_JUNIOR' || (target.economy ?? 0) < 6) return;

  const isHeavyHit = actualDmg > target.maxHp * 0.2;
  const isControlled = target.status.some((status) => ['STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED'].includes(status.type));
  if (!isHeavyHit && !isControlled) return;

  target.economy = Math.max(0, (target.economy ?? 0) - 5);
  if (target.savedSpd) {
    target.spd = target.savedSpd;
    target.agl = target.savedAgl ?? 0;
    delete target.savedSpd;
    delete target.savedAgl;
  }
  runtime.log('info', `💔 损失惨重！${target.name} 受到重创或被控，手中的【冥驹】掉落了！经济大幅衰退！`);
}

export function handlePhysicalCounterReflect(
  runtime: ActionResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  target: Fighter,
  actualDmg: number,
): void {
  if (skill.tag !== runtime.skillTags.PHYS || !target.status.some((status) => status.type === 'COUNTER')) return;

  const counter = target.status.find((status) => status.type === 'COUNTER');
  if (counter) consumeStatusCharge(target, counter);
  if (!runtime.isActiveCombatant(user)) {
    runtime.log('info', `💢 ${target.name} 的反击护盾亮起，但 ${user.name} 已经退场，反弹没有继续结算。`);
    return;
  }
  const reflectedDmg = runtime.applyDamage(user, actualDmg, 'reflect', false, target, { deferTransform: true });
  if (reflectedDmg > 0) {
    runtime.log('crit', `💢 ${target.name} 触发反击！将伤害弹回给了 ${user.name}，实际造成 ${reflectedDmg} 点反弹伤害！`);
  } else {
    runtime.log('info', `💢 ${target.name} 触发反击，但反弹没有对 ${user.name} 造成实际伤害！`);
  }
  if (reflectedDmg > 0 || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
  if (user.currentHp <= 0) {
    runtime.markDefeated(user, { message: `💀 ${user.name} 被自己造成的反弹伤害反死了！`, killer: target });
  }
}

export function grantValorantKillRewards(
  runtime: ActionResolutionRuntime,
  user: Fighter,
): void {
  if (user.job !== 'VALO_JUNIOR') return;

  user.economy = (user.economy ?? 0) + 2;
  user.ultPoints = (user.ultPoints ?? 0) + 1;
  gainValorantFocus(user, 1);
  const restored = restoreValorantOperatorMobility(user);
  refreshStatus(user, 'VALO_REPOSITION', 1);
  refreshStatus(user, 'VALO_CLUTCH', 3);
  refreshStatus(user, 'SPELL_BLOCK', 1, 'valo_reposition');
  const enemyCount = activeEnemyCount(runtime, user);
  if ((user.crosshairFocus ?? 0) >= 6 && (enemyCount <= 2 || (enemyCount <= 3 && hasStatus(user, 'VALO_ULT_EMPRESS')))) {
    user.valoInstantActionQueued = true;
  }
  runtime.log('info', `💰 ${user.name} 拿到击杀！经济+2，大招充能+1，准星专注+1（${user.crosshairFocus ?? 0}/${VALO_FOCUS_MAX}），立刻再定位${restored ? '并甩掉冥驹笨重' : ''}！`);
}

export function grantValorantHitRewards(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  actualDmg: number,
): void {
  if (user.job !== 'VALO_JUNIOR' || !isCompetitiveTarget(target) || actualDmg <= 0) return;

  user.economy = Math.min(12, (user.economy ?? 0) + 1);
  if (actualDmg < Math.max(300, user.atk)) return;
  const before = user.crosshairFocus ?? 0;
  gainValorantFocus(user, 1);
  if (before < 5 && (user.crosshairFocus ?? 0) >= 5) {
    runtime.log('buff', `🎯 【准星专注】${user.name} 手感升温，专注达到 ${user.crosshairFocus}/${VALO_FOCUS_MAX}，已能校准爆头线！`);
  } else if (before < 8 && (user.crosshairFocus ?? 0) >= 8) {
    runtime.log('buff', `🎯 【准星专注】${user.name} 完全进入状态，专注达到 ${user.crosshairFocus}/${VALO_FOCUS_MAX}，残局处决已就绪！`);
  }
}

export function handlePrimaryTargetDefeat(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill?: SkillDefinition,
): boolean {
  if (target.currentHp > 0) return false;

  const skillName = skill?.name && !['普通攻击', '魔力攻击'].includes(skill.name) ? `【${skill.name}】` : '攻击';
  const defeated = runtime.markDefeated(target, { message: `💀 【击杀】${target.name} 被 ${user.name} 的${skillName}击败！`, killer: user });
  return defeated;
}

export function applyLifestealEffects(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
  actualDmg: number,
  hpBeforeDamage: number,
): void {
  const tingBloodthirst = user.isTing ? (user.transformed ? 0.55 : 0.25) : 0;
  const lsPct =
    (skill.lifesteal ?? 0) +
    tingBloodthirst +
    (user.status.some((status) => status.type === 'PLUG_HEAD') ? 0.25 : 0) +
    (user.status.some((status) => status.type === 'VALO_ULT_EMPRESS') ? 1.0 : 0) +
    (user.status.some((status) => status.type === 'STYLE_SMART' || status.type === 'STYLE_EMPEROR') ? 0.5 : 0);
  if (lsPct <= 0 || actualDmg <= 0 || !runtime.isActiveCombatant(user)) return;

  if (user.status.some((status) => status.type === 'NO_HEAL')) {
    runtime.log('info', `🥀 ${user.name} 处于禁疗状态，无法触发吸血被动！`);
    return;
  }

  const tingOverkillCap = user.isTing ? Math.floor(target.maxHp * 0.4) : 0;
  const maxHealBase = user.isTing ? Math.max(hpBeforeDamage, tingOverkillCap) : hpBeforeDamage;
  const healBase = Math.min(actualDmg, maxHealBase);
  const healAmt = Math.floor(healBase * lsPct);
  if (healAmt <= 0) return;

  const healed = healFighter(user, healAmt, runtime.log);
  if (healed > 0) {
    runtime.log('heal', `💉 ${user.name} 触发吸血被动，恢复了 ${healed} 点生命！`);
  } else {
    runtime.log('info', `💉 ${user.name} 触发吸血被动，但生命已满，治疗溢出！`);
  }
}

export function consumeAimAfterAttack(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (skill.tag === runtime.skillTags.HEAL || skill.tag === runtime.skillTags.BUFF) return;

  const aim = user.status.find((status) => status.type === 'AIM');
  if (aim) consumeStatusCharge(user, aim);
  if (user.isWT && user.wtMarkedTargetId) {
    user.wtMarkedTargetId = undefined;
    runtime.log('info', `🎯 ${user.name} 已消耗激光测距坐标，本次火控优先窗口关闭。`);
  }
}

export function triggerSuccubusBabyFollowup(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skillId: string | null,
  userTeamId: string,
  triggerDepth: number,
): void {
  if (!user.isSuccubus || !user.transformed || !skillId?.startsWith('chimera_') || skillId === 'chimera_install') return;

  const baby = runtime.fighters.find((fighter) => fighter.job === 'MY_BABY' && runtime.isActiveCombatant(fighter) && runtime.getTeamId(fighter) === userTeamId);
  const syncSkillId = CHIMERA_BABY_SYNC_SKILLS[skillId];
  if (!baby || !syncSkillId) return;

  const syncSkill = runtime.skills[syncSkillId];
  const isHealOrBuff = syncSkill && (syncSkill.tag === runtime.skillTags.HEAL || syncSkill.tag === runtime.skillTags.BUFF);
  runtime.executeSkillAction(syncSkillId, baby, isHealOrBuff ? user : target, triggerDepth + 1);
}
