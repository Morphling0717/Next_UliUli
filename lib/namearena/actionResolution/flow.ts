import type {
  Fighter,
} from '../types';
import { healFighter } from '../combatState';
import {
  getSelectableTargets,
  resolveTarget,
} from '../targeting';
import {
  formatSkillText,
  resolveSkillDefinition,
} from '../skillResolution';
import { createSkillContext } from './context';
import {
  handleCounterStatus,
  handleWaitCounter,
} from './counters';
import {
  applyAttackerStyleEffects,
  applyLifestealEffects,
  applySelfDamage,
  applySkillStatusEffect,
  consumeAimAfterAttack,
  handlePhysicalCounterReflect,
  handlePrimaryTargetDefeat,
  handleValorantWeaponDrop,
  triggerSuccubusBabyFollowup,
} from './effects';
import {
  breakAbsoluteDefense,
  canTouchDamagePlane,
  dodgesWithPassiveSkill,
  missesSkill,
} from './guards';
import { handleValorantPreFire } from './preAction';
import type { ActionResolutionRuntime } from './types';

function createTargetingRuntime(runtime: ActionResolutionRuntime) {
  return {
    fighters: runtime.fighters,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
  };
}

export function executeSkillAction(
  runtime: ActionResolutionRuntime,
  skillId: string | null,
  user: Fighter,
  forcedTarget: Fighter | null = null,
  triggerDepth = 0,
): void {
  if (triggerDepth > 5 || !user || user.isDead || user.isDeadAnnounced || user.currentHp <= 0) return;

  const userTeamId = runtime.getTeamId(user);
  let currentTargets = getSelectableTargets(createTargetingRuntime(runtime), user);

  if (handleValorantPreFire(runtime, user, userTeamId, currentTargets, triggerDepth)) return;

  if (user.job === 'EXPLOSIVE_ANTI_CROC') {
    const crocTargets = currentTargets.filter((fighter) => fighter.isGacha);
    if (crocTargets.length > 0) currentTargets = crocTargets;
  }

  const targetSelection = resolveTarget(createTargetingRuntime(runtime), user, forcedTarget, currentTargets);
  if (!targetSelection) return;
  let { target, isIntercepted } = targetSelection;

  const skill = resolveSkillDefinition({
    skills: runtime.skills,
    data: runtime.data,
    log: (type, text) => runtime.log(type, text),
  }, skillId, user);
  const formatText = (text: string): string => formatSkillText(skill, text);

  if (skillId === 'bujin_chair' && !user.isTokusatsu) {
    return runtime.log('info', `🪑 ${user.name} 试图模仿刺猬人召唤【武神王座】，但由于缺乏特摄之魂，椅子刚落地就散架了！`);
  }

  if (skill.triggerAgain && triggerDepth === 0) {
    runtime.log('buff', formatText(skill.text ?? '').replace(/{USER}/g, user.name));
    for (let i = 0; i < skill.triggerAgain; i++) executeSkillAction(runtime, skillId, user, null, triggerDepth + 1);
    return;
  }

  if (skill.isSummon) {
    runtime.executeSummonSkill(skill, user, userTeamId);
    return;
  }

  const skillCtx = createSkillContext(runtime, user, target, currentTargets, triggerDepth);
  if (skill.onExecute && skill.onExecute(skillCtx)) return;

  if (skill.tag !== runtime.skillTags.HEAL && skill.tag !== runtime.skillTags.BUFF && target.status.some((status) => status.type === 'SPELL_BLOCK')) {
    target.status = target.status.filter((status) => status.type !== 'SPELL_BLOCK');
    healFighter(target, Math.floor(target.maxHp * 0.15));
    return runtime.log('info', `🔵 庇护之音！林肯法球(或特种装甲)的光幕为 ${target.name} 挡下了 ${user.name} 的攻击，并恢复了部分生命！`);
  }

  runtime.spreadDivaSupport(skill, user, userTeamId);

  if (runtime.executeSupportSkill(skill, user, forcedTarget, userTeamId)) return;

  if (missesSkill(user, target, skill, isIntercepted)) {
    return runtime.log('info', `💨 ${user.name} 的 ${skill.name ?? '攻击'} 被 ${target.name} 闪避了！`);
  }

  if (handleWaitCounter(runtime, target, user, triggerDepth)) return;
  if (handleCounterStatus(runtime, target, user)) return;

  if (breakAbsoluteDefense(runtime, skillId, user, target)) return;
  if (dodgesWithPassiveSkill(runtime, user, target)) return;
  if (!canTouchDamagePlane(runtime, user, target, skill)) return;

  const damageResult = runtime.calculateDamage(user, target, skill, userTeamId, skillId);
  let { dmg } = damageResult;
  const { logType, ignoreDefOverride, sexyTrueDamage } = damageResult;
  applySelfDamage(runtime, user, skill);
  applyAttackerStyleEffects(runtime, user, target);
  applySkillStatusEffect(runtime, skill, target);

  if (skillId === 'suicide_bomb' && target.status.some((status) => status.type === 'LIQUID_BODY')) {
    dmg = Math.floor(dmg * 0.3);
    runtime.log('info', `💦 爆炸的冲击波被 ${target.name} 的液态身躯卸掉了大半伤害！`);
  }

  let preMitigationDmg = isIntercepted ? Math.floor(dmg * 0.5) : dmg;

  if (preMitigationDmg >= target.currentHp && target.job === 'GOD_SLIME') {
    const sonProtector = runtime.fighters.find((fighter) => fighter.isSon && runtime.isActiveCombatant(fighter) && runtime.getTeamId(fighter) === runtime.getTeamId(target) && fighter.id !== target.id);
    if (sonProtector) {
      runtime.log('info', `🛡️ 致命一击袭来！但在命中的瞬间，${target.name} 与【水人的好大儿】互换了位置！好大儿化作一滩清水替水神挡下了必杀！`);
      target = sonProtector;
      isIntercepted = true;
      preMitigationDmg = Math.floor(dmg * 0.5);
    }
  }

  skillCtx.target = target;
  const hpBeforeDamage = target.currentHp;

  if (isIntercepted) {
    runtime.log('info', `🛡️ 【援护】小汀(傀儡) 冲了出来，替宿主挡下了 ${user.name} 的攻击！预计受到 ${preMitigationDmg} 点伤害！(减伤50%)`);
  } else {
    let msg = formatText(skill.text ?? '');
    if (skill.isRandomText && skill.pool) {
      const pool = skill.pool as string[];
      msg = msg.replace(/{JOKE}/g, pool[Math.floor(Math.random() * pool.length)]);
    }
    if (!msg.includes('{VAL}') && preMitigationDmg > 0 && skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL) {
      msg += ` (造成 {VAL} 点伤害)`;
    }
    runtime.log(logType, (logType === 'crit' ? '💥 暴击！' : '') + msg.replace(/{USER}/g, user.name).replace(/{TARGET}/g, target.name).replace(/{VAL}/g, String(preMitigationDmg)));
  }

  const actualDmg = runtime.applyDamage(target, preMitigationDmg, 'skill', !!ignoreDefOverride || sexyTrueDamage);

  handleValorantWeaponDrop(runtime, target, actualDmg);
  handlePhysicalCounterReflect(runtime, skill, user, target, actualDmg);
  consumeAimAfterAttack(runtime, user, skill);

  user.stats.dmgDealt += actualDmg;
  handlePrimaryTargetDefeat(runtime, user, target);

  applyLifestealEffects(runtime, user, skill, actualDmg, hpBeforeDamage);
  triggerSuccubusBabyFollowup(runtime, user, target, skillId, userTeamId, triggerDepth);

  // Transformation check fires immediately after damage so HP is restored at once
  runtime.handleTransformations(target);
  runtime.handleTransformations(user);
  if (skill.afterExecute) skill.afterExecute(skillCtx, actualDmg, hpBeforeDamage);
}
