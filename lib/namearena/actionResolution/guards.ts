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

export function missesSkill(
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
  isIntercepted: boolean,
): boolean {
  const userAgl = user.status.some((status) => status.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(user.agl * 1.2) : user.agl;
  const effectiveTargetAgl = target.status.some((status) =>
    status.type === 'WT_SUPPRESS' ||
    status.type === 'WT_TRACK_DAMAGED' ||
    status.type === 'NEURAL_THEFT_DEBUFF',
  ) ? 0 : target.agl;
  let targetAgl = target.status.some((status) => status.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(effectiveTargetAgl * 1.2) : effectiveTargetAgl;
  if (target.status.some((status) => status.type === 'YUZU_EVADE_DOWN')) targetAgl = Math.floor(targetAgl * 0.55);
  let hitChance = 0.95 + (userAgl - targetAgl) * 0.005;
  const guaranteedHit =
    user.status.some((status) => status.type === 'AIM') ||
    (user.isWT && target.status.some((status) => status.type === 'WT_SCOUTED')) ||
    isIntercepted ||
    target.status.some((status) => status.type === 'NEURAL_THEFT_DEBUFF') ||
    skill.alwaysHit ||
    skill.isGacha;
  if (guaranteedHit) {
    hitChance = 10.0;
  } else {
    if (user.status.some((status) => status.type === 'BLIND')) hitChance -= 0.45;
    if (user.status.some((status) => status.type === 'VALO_FLASH')) hitChance -= 0.55;
    if (user.status.some((status) => status.type === 'VALO_AIM_PUNCH')) hitChance -= 0.8;
    hitChance = Math.max(0.05, Math.min(0.98, hitChance));
  }

  return Math.random() > hitChance && !skill.ignoreDef;
}

export function breakAbsoluteDefense(
  runtime: ActionResolutionRuntime,
  skillId: string | null,
  user: Fighter,
  target: Fighter,
): boolean {
  if (skillId === 'cosmic_slap' && target.status.some((status) => status.type === 'INVUL' || status.type === 'BKB')) {
    const brokenStatuses = target.status.filter((status) => status.type === 'INVUL' || status.type === 'BKB');
    target.status = target.status.filter((status) => status.type !== 'INVUL' && status.type !== 'BKB');
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
): boolean {
  const targetSkills = target.jobData.skills ?? [];
  if (targetSkills.includes('flash_lol') && Math.random() < 0.2) {
    runtime.log('skill', `✨ ${target.name} 极限反应！交出闪现（D键），规避了 ${user.name} 的伤害！`);
    return true;
  }
  if (targetSkills.includes('roll_dodge') && Math.random() < 0.25) {
    runtime.log('skill', `🔄 ${target.name} 战术翻滚！利用无敌帧躲过了 ${user.name} 的攻击！`);
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
  if (user.status.some((status) => status.type === 'ETHEREAL') && skill.tag === runtime.skillTags.PHYS) {
    runtime.log('info', `👻 ${user.name} 处于虚无界，无法造成物理伤害！`);
    return false;
  }
  if (target.status.some((status) => status.type === 'ETHEREAL') && skill.tag === runtime.skillTags.PHYS) {
    runtime.log('info', `👻 ${target.name} 处于虚无界，物理攻击无法触碰！`);
    return false;
  }
  return true;
}
