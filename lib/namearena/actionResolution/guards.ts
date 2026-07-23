import type {
  Fighter,
  SkillDefinition,
} from '../types';
import type { ActionResolutionRuntime } from './types';
import {
  findDefenseStatus,
  formatAttackInvul,
  formatDefenseBreak,
} from '../defenseStatus';
import {
  consumeAccuracyCharge,
  consumeParalysis,
  getAccuracyAgilityMultiplier,
  getAccuracyPointModifier,
  getEffectiveCombatStat,
  getEvasionMultiplier,
  isParalyzedForAttack,
} from '../statusMechanics';
import { findIdentity, findMechanic, hasIdentity, hasMechanic, removeEffects } from '../statusSystem';

export function missesSkill(
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
  isIntercepted: boolean,
): boolean {
  const baseUserAgl = getEffectiveCombatStat(user, 'agl');
  const userAgl = Math.floor(baseUserAgl * getAccuracyAgilityMultiplier(user));
  const effectiveTargetAgl = getEffectiveCombatStat(target, 'agl');
  const targetAgl = Math.floor(effectiveTargetAgl * getEvasionMultiplier(target));
  let hitChance = 0.95 + (userAgl - targetAgl) * 0.005 + getAccuracyPointModifier(user);
  const guaranteedHit =
    hasMechanic(user, 'AIM') ||
    (user.isWT && hasIdentity(target, 'WT_SCOUTED')) ||
    isIntercepted ||
    !!findMechanic(target, 'SURE_HIT_TAKEN') ||
    skill.alwaysHit ||
    skill.isGacha;
  if (guaranteedHit) {
    hitChance = 10.0;
  } else {
    hitChance = Math.max(0.05, Math.min(0.98, hitChance));
  }
  const missed = Math.random() > hitChance;
  if (!guaranteedHit) consumeAccuracyCharge(user);
  const isDamagingAttack = !skill.noDamage && skill.tag !== 'heal' && skill.tag !== 'buff';
  if (missed && isDamagingAttack && isParalyzedForAttack(user)) consumeParalysis(user);
  return missed;
}

export function canTriggerOwlEvadeOpening(
  target: Fighter,
  skill: SkillDefinition,
  isIntercepted: boolean,
): boolean {
  if (
    isIntercepted ||
    skill.tag === 'heal' ||
    skill.tag === 'buff' ||
    (skill.mult ?? 0) <= 0
  ) return false;
  return hasIdentity(target, 'OWL_EVADE_DOWN');
}

export function consumeOwlEvadeOpening(
  target: Fighter,
  skill: SkillDefinition,
  isIntercepted: boolean,
): boolean {
  if (!canTriggerOwlEvadeOpening(target, skill, isIntercepted)) return false;
  const opening = findIdentity(target, 'OWL_EVADE_DOWN');
  if (!opening) return false;
  removeEffects(target, { instanceIds: [opening.instanceId], reason: 'consumed' });
  return true;
}

export function breakAbsoluteDefense(
  runtime: ActionResolutionRuntime,
  skillId: string | null,
  user: Fighter,
  target: Fighter,
): boolean {
  if (skillId === 'cosmic_slap' && (hasMechanic(target, 'INVUL') || hasMechanic(target, 'BKB'))) {
    runtime.log('skill', `🌌 【神明压制】${user.name} 抬手压向 ${target.name}，开始撕开对方的绝对防御！`);
    const brokenStatuses = runtime.dispelStatusEffects(target, {
      strength: 'absolute',
      direction: 'positive',
      identityIds: ['INVUL', 'BKB'],
    }).removed;
    runtime.log('skill', `🌌 所谓绝对防御，在神明眼中不过是层薄纸！${user.name} 强行捏碎了 ${formatDefenseBreak(brokenStatuses, target.name)}！`);
  }
  const invul = findDefenseStatus(target, 'INVUL');
  if (!invul) return false;

  runtime.log('info', formatAttackInvul(invul, target.name, user.name));
  return true;
}

export function dodgesWithPassiveSkill(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  actionName = '攻击',
): boolean {
  const targetSkills = target.jobData.skills ?? [];
  if (targetSkills.includes('flash_lol') && Math.random() < 0.2) {
    runtime.log('skill', `✨ ${target.name} 极限反应！交出闪现（D键），规避了 ${user.name} 的【${actionName}】！`);
    return true;
  }
  if (targetSkills.includes('roll_dodge') && Math.random() < 0.25) {
    runtime.log('skill', `🔄 ${target.name} 战术翻滚！利用无敌帧躲过了 ${user.name} 的【${actionName}】！`);
    return true;
  }
  return false;
}

export function canTouchDamagePlane(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
): boolean {
  if (hasIdentity(user, 'ETHEREAL') && skill.tag === runtime.skillTags.PHYS) {
    runtime.log('info', `👻 ${user.name} 处于虚无界，无法造成物理伤害！`);
    return false;
  }
  if (hasIdentity(target, 'ETHEREAL') && skill.tag === runtime.skillTags.PHYS) {
    runtime.log('info', `👻 ${target.name} 处于虚无界，物理攻击无法触碰！`);
    return false;
  }
  return true;
}
