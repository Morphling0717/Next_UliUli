import type { Fighter, SkillDefinition } from './types';
import {
  consumeCriticalDamageStatuses,
  consumeParalysis,
  consumePoiseOnCritical,
  getCriticalDamagePointModifier,
  getCritRateBonus,
  getEffectiveCombatStat,
  getMoraleCritModifier,
  getOpeningCritBonus,
  getOutgoingDirectStatusMultiplier,
  getPoiseCritBonus,
  hasMentalBreakdown,
  isParalyzedForAttack,
} from './statusMechanics';
import { getStatusIdentityIdsByTag } from './statusRegistry';
import { findIdentity, hasIdentity, hasMechanic } from './statusSystem';

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

export function getFatigueDamageBonusForTurn(turnCount: number): number {
  if (turnCount <= 500) return 0;
  const steadyFatigue = Math.min(80, Math.floor((turnCount - 500) / 25));
  if (turnCount <= 900) return steadyFatigue;
  const collapseFatigue = Math.floor((turnCount - 900) / 3) * 6;
  return Math.min(900, steadyFatigue + collapseFatigue);
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
  const usesCustomFormula = !!skill.damageFormula || !!skill.noDamage;
  const sexyTrueDamage = hasIdentity(user, 'STYLE_SEXY') || hasIdentity(user, 'STYLE_EMPEROR');
  const ignoreDefOverride = !!skill.ignoreDef || sexyTrueDamage;
  const effectiveAtk = getEffectiveCombatStat(user, 'atk', 'standard');
  const effectiveMag = getEffectiveCombatStat(user, 'mag', 'standard');
  const paralyzed = isParalyzedForAttack(user);
  const rollDamageMultiplier = () => paralyzed ? 1 : 1 + Math.random() * 0.2;

  if (skill.noDamage) {
    dmg = 0;
  } else if (skill.damageFormula) {
    dmg = Math.max(0, Math.floor(skill.damageFormula(
      user,
      target,
      runtime.fighters,
      (fighter, key) => getEffectiveCombatStat(fighter, key, 'custom'),
    )));
  } else if (skill.tag === runtime.skillTags.PHYS || skill.tag === runtime.skillTags.SPECIAL) {
    const standardFormulaOutput = getOutgoingDirectStatusMultiplier(user, 'standard', 'physical', 'standard_formula');
    const atk = effectiveAtk * standardFormulaOutput * (user.hasSpinalSword ? 2.5 : 1);
    let def = (hasMechanic(target, 'FREEZE') || ignoreDefOverride || sexyTrueDamage)
      ? 0
      : Math.floor(getEffectiveCombatStat(target, 'def', 'standard') * (user.jobData?.name === '欧皇' ? 0.5 : 1));
    if (hasIdentity(target, 'WT_ERA')) def = Math.floor(def * 2.0);
    dmg = Math.max(1, Math.floor((atk * rollDamageMultiplier() - def * 0.5) * (skill.mult ?? 1)));
    if (hasIdentity(target, 'LIQUID_BODY')) dmg = Math.floor(dmg * 0.5);
  } else if (skill.tag === runtime.skillTags.MAG || skill.tag === runtime.skillTags.DEBUFF) {
    const standardFormulaOutput = getOutgoingDirectStatusMultiplier(user, 'standard', 'magical', 'standard_formula');
    const res = (ignoreDefOverride || sexyTrueDamage)
      ? 0
      : Math.floor(getEffectiveCombatStat(target, 'res', 'standard') * (user.jobData?.name === '欧皇' ? 0.5 : 1));
    dmg = Math.max(1, Math.floor((effectiveMag * standardFormulaOutput * rollDamageMultiplier() - res * 0.5) * (skill.mult ?? 1)));
    if (skill.tag === runtime.skillTags.DEBUFF) dmg = Math.max(1, Math.floor(dmg * 0.5));
    if (hasIdentity(target, 'ETHEREAL')) {
      dmg = Math.floor(dmg * 2.0);
      runtime.log('crit', `👻 魔法爆裂！${target.name} 处于虚无状态，受到了双倍的魔法打击！`);
    }
  }

  if (!usesCustomFormula && user.job === 'GOD_SLIME') {
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

  const charmedByTarget = findIdentity(user, 'CHARMED')?.attribution.applierId === target.id;
  const canCrit = !skill.cannotCrit && !skill.noDamage && !paralyzed && !hasMentalBreakdown(user);
  const ordinaryCritChance = Math.max(
    0,
    user.critRate +
      getCritRateBonus(user) +
      getEffectiveCombatStat(user, 'agl', 'standard') * 0.001 +
      getPoiseCritBonus(user) +
      getOpeningCritBonus(target) +
      getMoraleCritModifier(user),
  );
  const isCrit = canCrit && !charmedByTarget && (
    hasMechanic(user, 'AIM') ||
    (user.isWT && hasIdentity(target, 'WT_SCOUTED')) ||
    skill.alwaysCrit ||
    Math.random() < ordinaryCritChance ||
    hasIdentity(user, 'STYLE_ANGRY')
  );

  if (isCrit) {
    if (hasIdentity(target, 'LIQUID_BODY') && skill.tag === runtime.skillTags.PHYS) {
      // Liquid body immune to physical crits.
    } else {
      const critMultiplier = Math.max(1, 1.5 + getCriticalDamagePointModifier(user, target));
      dmg = Math.floor(dmg * critMultiplier);
      logType = 'crit';
      if (consumePoiseOnCritical(user)) {
        runtime.log('buff', `🫁 【呼吸】${user.name} 借助呼吸打出暴击，并消耗 1 次呼吸。`);
      }
      consumeCriticalDamageStatuses(user, target);
    }
  }

  if (skill.hits) dmg *= skill.hits;
  if (
    user.isSuccubus &&
    user.transformed &&
    usedSkillId?.startsWith('chimera_') &&
    usedSkillId !== 'chimera_install' &&
    usedSkillId !== 'chimera_strike' &&
    dmg > 0
  ) {
    const plugCount = getStatusIdentityIdsByTag('chimera_plug')
      .filter((identityId) => hasIdentity(user, identityId)).length;
    if (plugCount >= 6) dmg = Math.floor(dmg * 1.17);
    else if (plugCount >= 4) dmg = Math.floor(dmg * 1.09);
  }
  if (skill.minDamagePct && (skill.tag === runtime.skillTags.PHYS || skill.tag === runtime.skillTags.SPECIAL)) {
    const standardFormulaOutput = getOutgoingDirectStatusMultiplier(user, 'standard', 'physical', 'standard_formula');
    const minDamageBase = effectiveAtk * standardFormulaOutput * (skill.mult ?? 1) * (skill.hits ?? 1);
    dmg = Math.max(dmg, Math.floor(minDamageBase * skill.minDamagePct));
  }
  const fatigueBonus = usesCustomFormula ? 0 : runtime.getFatigueDamageBonus();
  if (fatigueBonus > 0 && dmg > 0) dmg += fatigueBonus;

  if (paralyzed && !skill.noDamage) {
    consumeParalysis(user);
    runtime.log('debuff', `⚡ 【麻痹】${user.name} 的这次攻击只能打出最低浮动且无法暴击，并消耗 1 次麻痹。`);
  }
  return { dmg, logType, ignoreDefOverride, sexyTrueDamage };
}
