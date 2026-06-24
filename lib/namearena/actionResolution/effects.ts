import type {
  Fighter,
  SkillDefinition,
} from '../types';
import { healFighter } from '../combatState';
import type { ActionResolutionRuntime } from './types';

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
): void {
  if (user.status.some((status) => status.type === 'STYLE_VAIN')) {
    const stealAtk = Math.floor(target.atk * 0.1);
    const stealMag = Math.floor(target.mag * 0.1);
    target.atk = Math.max(1, target.atk - stealAtk);
    target.mag = Math.max(1, target.mag - stealMag);
    user.atk += stealAtk;
    user.mag += stealMag;
    runtime.log('buff', `💅 虚荣窃取！${user.name} 偷走了 ${target.name} 的属性化为己用！(吸收了攻击和魔力)`);
  }

  if (user.status.some((status) => status.type === 'STYLE_FOOL') && Math.random() < 0.5) {
    const debuffs = ['STUN', 'FREEZE', 'POISON', 'BURN'];
    const randomDebuff = debuffs[Math.floor(Math.random() * debuffs.length)];
    if (!target.status.some((status) => status.type === 'BKB')) {
      target.status.push({ type: randomDebuff, duration: 2 });
      runtime.log('skill', `🤪 笨蛋女人乱拳挥舞！不经意间给 ${target.name} 附加了【${runtime.statusEffects[randomDebuff]?.name ?? randomDebuff}】异常状态！`);
    }
  }
}

export function applySkillStatusEffect(
  runtime: ActionResolutionRuntime,
  skill: SkillDefinition,
  target: Fighter,
): void {
  if (!skill.status) return;

  if (target.status.some((status) => status.type === 'BKB') && ['STUN', 'FREEZE', 'SILENCE', 'CONFUSED', 'CHARMED'].includes(skill.status)) {
    runtime.log('info', `🟡 ${target.name} 处于 BKB 状态，免疫了 ${runtime.statusEffects[skill.status]?.name ?? skill.status} 效果！`);
    return;
  }
  target.status.push({ type: skill.status, duration: 2 });
}

export function handleValorantWeaponDrop(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  actualDmg: number,
): void {
  if (target.job !== 'VALO_JUNIOR' || (target.economy ?? 0) < 6) return;

  const isHeavyHit = actualDmg > target.maxHp * 0.2;
  const isControlled = target.status.some((status) => ['STUN', 'FREEZE', 'CONFUSED', 'CHARMED'].includes(status.type));
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

  target.status = target.status.filter((status) => status.type !== 'COUNTER');
  const reflectedDmg = runtime.applyDamage(user, actualDmg, 'reflect', false, target);
  if (reflectedDmg > 0) {
    runtime.log('crit', `💢 ${target.name} 触发反击！将伤害弹回给了 ${user.name}，实际造成 ${reflectedDmg} 点反弹伤害！`);
  } else {
    runtime.log('info', `💢 ${target.name} 触发反击，但反弹没有对 ${user.name} 造成实际伤害！`);
  }
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
  runtime.log('info', `💰 ${user.name} 拿到击杀！大招充能+1，经济大幅增长(+2)！`);
}

export function handlePrimaryTargetDefeat(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill?: SkillDefinition,
): void {
  if (target.currentHp > 0) return;

  const skillName = skill?.name && !['普通攻击', '魔力攻击'].includes(skill.name) ? `【${skill.name}】` : '攻击';
  const defeated = runtime.markDefeated(target, { message: `💀 【击杀】${target.name} 被 ${user.name} 的${skillName}击败！`, killer: user });
  if (defeated) grantValorantKillRewards(runtime, user);
}

export function applyLifestealEffects(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
  actualDmg: number,
  hpBeforeDamage: number,
): void {
  const tingBloodthirst = user.isTing ? (user.transformed ? 0.4 : 0.2) : 0;
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

  const healBase = Math.min(hpBeforeDamage, actualDmg);
  const healAmt = Math.floor(healBase * lsPct);
  if (healAmt <= 0) return;

  const healed = healFighter(user, healAmt);
  if (healed > 0) runtime.log('heal', `💉 ${user.name} 触发吸血被动，恢复了 ${healed} 点生命！`);
}

export function consumeAimAfterAttack(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (skill.tag === runtime.skillTags.HEAL || skill.tag === runtime.skillTags.BUFF) return;
  if (!user.status.some((status) => status.type === 'AIM')) return;

  user.status = user.status.filter((status) => status.type !== 'AIM');
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
