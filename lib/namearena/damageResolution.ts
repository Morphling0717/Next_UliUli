import type { Fighter, SkillDefinition } from './types';

export interface DamageResolutionRuntime {
  skillTags: Record<string, string>;
  fighters: Fighter[];
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  getFatigueDamageBonus: () => number;
  log: (type: string, text: string) => void;
}

export interface DamageResult {
  dmg: number;
  logType: string;
  ignoreDefOverride: boolean;
  sexyTrueDamage: boolean;
}

export function calculateDamage(
  runtime: DamageResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
  userTeamId: string,
  usedSkillId: string | null,
): DamageResult {
  let dmg = 0;
  let logType = usedSkillId ? 'skill' : 'attack';
  const sexyTrueDamage = user.status.some((status) => status.type === 'STYLE_SEXY' || status.type === 'STYLE_EMPEROR');
  const ignoreDefOverride = !!skill.ignoreDef || sexyTrueDamage;
  const weakOutputMultiplier = user.status.some((status) => status.type === 'WEAK') ? 0.5 : 1;

  if (skill.tag === runtime.skillTags.PHYS || skill.tag === runtime.skillTags.SPECIAL) {
    const atk = user.atk * weakOutputMultiplier * (user.status.some((status) => status.type === 'RAGE') ? 1.5 : 1) * (user.hasSpinalSword ? 2.5 : 1);
    let def = (target.status.some((status) => status.type === 'FREEZE') || ignoreDefOverride || sexyTrueDamage)
      ? 0
      : (user.jobData?.name === '欧皇' ? Math.floor(target.def * 0.5) : target.def);
    if (target.status.some((status) => status.type === 'WT_ERA')) def = Math.floor(def * 2.0);
    dmg = Math.max(1, Math.floor((atk * (1 + Math.random() * 0.2) - def * 0.5) * (skill.mult ?? 1)));
    if (target.status.some((status) => status.type === 'LIQUID_BODY')) dmg = Math.floor(dmg * 0.5);
  }

  if (skill.tag === runtime.skillTags.MAG || skill.tag === runtime.skillTags.DEBUFF) {
    const res = (ignoreDefOverride || sexyTrueDamage) ? 0 : (user.jobData?.name === '欧皇' ? Math.floor(target.res * 0.5) : target.res);
    dmg = Math.max(1, Math.floor((user.mag * weakOutputMultiplier * (1 + Math.random() * 0.2) - res * 0.5) * (skill.mult ?? 1)));
    if (skill.tag === runtime.skillTags.DEBUFF) dmg = Math.max(1, Math.floor(dmg * 0.5));
    if (target.status.some((status) => status.type === 'ETHEREAL')) {
      dmg = Math.floor(dmg * 2.0);
      runtime.log('crit', `👻 魔法爆裂！${target.name} 处于虚无状态，受到了双倍的魔法打击！`);
    }
  }

  if (user.job === 'GOD_SLIME') {
    const sonBattery = runtime.fighters.find((fighter) =>
      fighter.isSon &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === userTeamId,
    );
    if (sonBattery) {
      dmg = Math.floor(dmg * 1.5);
      runtime.log('buff', `🔋 【魔力泵浦】水人的好大儿为 ${user.name} 提供了庞大的魔力增幅！伤害1.5倍！`);
    }
  }

  const isCrit =
    user.status.some((status) => status.type === 'AIM') ||
    target.status.some((status) => status.type === 'NEURAL_THEFT_DEBUFF') ||
    skill.alwaysCrit ||
    Math.random() < (user.critRate + user.agl * 0.001) ||
    user.status.some((status) => status.type === 'STYLE_ANGRY');

  if (isCrit) {
    if (target.status.some((status) => status.type === 'LIQUID_BODY') && skill.tag === runtime.skillTags.PHYS) {
      // Liquid body immune to physical crits.
    } else {
      dmg = Math.floor(dmg * 1.5);
      logType = 'crit';
    }
  }

  if (skill.hits) dmg *= skill.hits;
  if (skill.minDamagePct && (skill.tag === runtime.skillTags.PHYS || skill.tag === runtime.skillTags.SPECIAL)) {
    const minDamageBase = user.atk * weakOutputMultiplier * (skill.mult ?? 1) * (skill.hits ?? 1);
    dmg = Math.max(dmg, Math.floor(minDamageBase * skill.minDamagePct));
  }
  const fatigueBonus = runtime.getFatigueDamageBonus();
  if (fatigueBonus > 0 && dmg > 0) dmg += fatigueBonus;

  return { dmg, logType, ignoreDefOverride, sexyTrueDamage };
}
