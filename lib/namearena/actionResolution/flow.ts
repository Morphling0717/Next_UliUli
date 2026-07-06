import type {
  DamageApplicationOptions,
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
import {
  consumeSpellBlock,
  formatPreSkillSpellBlock,
} from '../defenseStatus';
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
  grantValorantHitRewards,
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
    turnCount: runtime.turnCount,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
  };
}

function clarifyDamagePlaceholderText(text: string): string {
  return text
    .replace(/重创 \{TARGET\} \{VAL\}\)/g, '重创 {TARGET}，造成 {VAL} 点伤害)')
    .replace(/造成 9999 \({VAL}\) 真实伤害/g, '造成 {VAL} 点真实伤害')
    .replace(/\({VAL}\s*伤害\)/g, '(造成 {VAL} 点伤害)')
    .replace(/\({VAL}\)/g, '(造成 {VAL} 点伤害)')
    .replace(/{VAL}伤害/g, '{VAL} 点伤害');
}

function canJokerRedirectSkillDamage(target: Fighter, skillTag: string, runtime: ActionResolutionRuntime): boolean {
  return (
    target.job === 'GOD_OF_TROLLS' &&
    skillTag !== runtime.skillTags.BUFF &&
    skillTag !== runtime.skillTags.HEAL &&
    !target.status.some((status) => status.type === 'WATER_PRISON')
  );
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
  let interceptionLabel = isIntercepted
    ? `【援护】${target.name} 冲了出来，替宿主挡下了 ${user.name} 的攻击`
    : '';

  const gachaStateBeforeResolution = {
    luck: user.gachaLuck,
    pityPower: user.gachaPityPower,
  };
  const skill = resolveSkillDefinition({
    skills: runtime.skills,
    data: runtime.data,
    fighters: runtime.fighters,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
    log: (type, text) => runtime.log(type, text),
  }, skillId, user);
  const incomingActionName = skill.name ?? '攻击';
  if (isIntercepted) {
    interceptionLabel = `【援护】${target.name} 冲了出来，替宿主挡下了 ${user.name} 的【${incomingActionName}】`;
  }
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

  const deferredTransformTargets: Fighter[] = [];
  const queuedPreResolutionLogs: Array<{ type: string; text: string }> = [];
  const trackDeferredDamageTarget = (fighter: Fighter) => {
    if (!deferredTransformTargets.some((targetCandidate) => targetCandidate.id === fighter.id)) {
      deferredTransformTargets.push(fighter);
    }
  };
  const flushDeferredDamageEvents = () => {
    while (deferredTransformTargets.length > 0) {
      const damagedTarget = deferredTransformTargets.shift();
      if (damagedTarget) runtime.flushDeferredDamageEvents(damagedTarget);
    }
  };
  const flushQueuedPreResolutionLogs = () => {
    while (queuedPreResolutionLogs.length > 0) {
      const entry = queuedPreResolutionLogs.shift();
      if (entry) runtime.log(entry.type, entry.text);
    }
  };

  const skillCtx = createSkillContext(
    runtime,
    user,
    target,
    currentTargets,
    triggerDepth,
    incomingActionName,
    trackDeferredDamageTarget,
    flushDeferredDamageEvents,
    (type, text) => queuedPreResolutionLogs.push({ type, text }),
  );
  const refundInterruptedGacha = (reason: string) => {
    if (!skill.isGacha) return;
    const changed =
      user.gachaLuck !== gachaStateBeforeResolution.luck ||
      user.gachaPityPower !== gachaStateBeforeResolution.pityPower;
    if (gachaStateBeforeResolution.luck === undefined) delete user.gachaLuck;
    else user.gachaLuck = gachaStateBeforeResolution.luck;
    if (gachaStateBeforeResolution.pityPower === undefined) delete user.gachaPityPower;
    else user.gachaPityPower = gachaStateBeforeResolution.pityPower;
    if (changed) {
      runtime.log('info', `🎲 ${user.name} 的【${incomingActionName}】${reason}，本次抽卡未结算，欧气已返还！`);
    }
  };

  if (skill.onExecute && skill.onExecute(skillCtx)) {
    flushDeferredDamageEvents();
    return;
  }

  if (skill.tag !== runtime.skillTags.HEAL && skill.tag !== runtime.skillTags.BUFF && target.status.some((status) => status.type === 'SPELL_BLOCK')) {
    const spellBlock = consumeSpellBlock(target);
    const healed = healFighter(target, Math.floor(target.maxHp * 0.15));
    const healText = healed > 0 ? `，并恢复了 ${healed} 点生命` : '，但生命已满，治疗溢出';
    runtime.log('info', spellBlock
      ? formatPreSkillSpellBlock(spellBlock, user.name, skill.name, target.name, healText)
      : `🔵 ${target.name} 的防护光幕挡下了 ${user.name} 的【${skill.name}】${healText}！`);
    refundInterruptedGacha('被法术抵挡挡下');
    return;
  }

  if (runtime.executeSupportSkill(skill, user, forcedTarget, userTeamId)) {
    runtime.spreadDivaSupport(skill, user, userTeamId);
    return;
  }

  if (missesSkill(user, target, skill, isIntercepted)) {
    runtime.log('info', `💨 ${user.name} 的 ${skill.name ?? '攻击'} 被 ${target.name} 闪避了！`);
    refundInterruptedGacha('被闪避');
    return;
  }

  if (handleWaitCounter(runtime, target, user, triggerDepth, incomingActionName)) {
    refundInterruptedGacha('被反击打断');
    return;
  }
  if (handleCounterStatus(runtime, target, user)) {
    refundInterruptedGacha('被反击打断');
    return;
  }

  if (breakAbsoluteDefense(runtime, skillId, user, target)) {
    refundInterruptedGacha('用于击破绝对防御');
    return;
  }
  if (dodgesWithPassiveSkill(runtime, user, target)) {
    refundInterruptedGacha('被特殊闪避');
    return;
  }
  if (!canTouchDamagePlane(runtime, user, target, skill)) {
    refundInterruptedGacha('无法触碰目标');
    return;
  }

  const damageResult = runtime.calculateDamage(user, target, skill, userTeamId, skillId);
  let { dmg } = damageResult;
  const { logType, ignoreDefOverride, sexyTrueDamage } = damageResult;

  if (skillId === 'suicide_bomb' && target.status.some((status) => status.type === 'LIQUID_BODY')) {
    dmg = Math.floor(dmg * 0.3);
    runtime.log('info', `💦 爆炸的冲击波被 ${target.name} 的液态身躯卸掉了大半伤害！`);
  }

  let preMitigationDmg = isIntercepted ? Math.floor(dmg * 0.5) : dmg;

  if (preMitigationDmg >= target.currentHp && target.job === 'GOD_SLIME') {
    const sonProtector = runtime.fighters.find((fighter) => fighter.isSon && runtime.isActiveCombatant(fighter) && runtime.getTeamId(fighter) === runtime.getTeamId(target) && fighter.id !== target.id);
    if (sonProtector) {
      runtime.log('info', `🛡️ 致命一击袭来！但在命中的瞬间，${target.name} 与【水人的好大儿】互换了位置！好大儿化作一滩清水替水神挡下了这次致命攻击！`);
      target = sonProtector;
      isIntercepted = true;
      interceptionLabel = `【换位援护】${target.name} 化作一滩清水，替水神挡下了 ${user.name} 的【${incomingActionName}】`;
      preMitigationDmg = Math.floor(dmg * 0.5);
    }
  }

  skillCtx.target = target;
  skillCtx.targetWasTransformedBeforeDamage = !!target.transformed;
  const hpBeforeDamage = target.currentHp;
  const usesPreResolutionDamageLog = !isIntercepted && preMitigationDmg > 0 && canJokerRedirectSkillDamage(target, skill.tag, runtime);

  if (isIntercepted) {
    runtime.log('info', `🛡️ ${interceptionLabel}！援护减伤后准备承受 ${preMitigationDmg} 点伤害！`);
  } else if (usesPreResolutionDamageLog) {
    runtime.log(logType, `${logType === 'crit' ? '💥 暴击！' : ''}🎭 ${user.name} 的【${incomingActionName}】锁定 ${target.name}，即将结算 ${preMitigationDmg} 点预估伤害！`);
  } else {
    let msg = formatText(skill.text ?? '');
    if (skill.isRandomText && skill.pool) {
      const pool = skill.pool as string[];
      msg = msg.replace(/{JOKE}/g, pool[Math.floor(Math.random() * pool.length)]);
    }
    if (preMitigationDmg > 0 && skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL) {
      msg = clarifyDamagePlaceholderText(msg);
    }
    if (!msg.includes('{VAL}') && preMitigationDmg > 0 && skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL) {
      msg += ` (造成 {VAL} 点伤害)`;
    }
    runtime.log(logType, (logType === 'crit' ? '💥 暴击！' : '') + msg.replace(/{USER}/g, user.name).replace(/{TARGET}/g, target.name).replace(/{VAL}/g, String(preMitigationDmg)));
  }
  flushQueuedPreResolutionLogs();

  applySelfDamage(runtime, user, skill);

  const damageOptions: DamageApplicationOptions = isIntercepted
    ? { deferTransform: true, actionName: incomingActionName }
    : { deferTransform: true, actionName: incomingActionName };
  const actualDmg = runtime.applyDamage(
    target,
    preMitigationDmg,
    'skill',
    !!ignoreDefOverride || sexyTrueDamage,
    user,
    damageOptions,
  );
  if (isIntercepted) {
    if (actualDmg > 0) {
      runtime.log('info', `🛡️ ${interceptionLabel}，实际承受 ${actualDmg} 点伤害！`);
    } else {
      runtime.log('info', `🛡️ ${interceptionLabel}，但没有造成实际伤害！`);
    }
  } else if (usesPreResolutionDamageLog && !damageOptions.redirectedByJoker && !damageOptions.targetDefeatedDuringDamage) {
    if (actualDmg > 0) {
      runtime.log('info', `📌 实际结算：${target.name} 实际承受 ${actualDmg} 点伤害（原始预估 ${preMitigationDmg}）。`);
    } else {
      runtime.log('info', `📌 实际结算：${target.name} 完全抵消了这次伤害（原始预估 ${preMitigationDmg}），没有承受实际伤害。`);
    }
  }
  if (
    preMitigationDmg > 0 &&
    actualDmg !== preMitigationDmg &&
    !usesPreResolutionDamageLog &&
    runtime.isActiveCombatant(target) &&
    !damageOptions.redirectedByJoker &&
    !damageOptions.targetDefeatedDuringDamage
  ) {
    if (actualDmg > 0) {
      runtime.log('info', `📌 实际结算：${target.name} 实际承受 ${actualDmg} 点伤害（原始预估 ${preMitigationDmg}）。`);
    } else {
      runtime.log('info', `📌 实际结算：${target.name} 完全抵消了这次伤害（原始预估 ${preMitigationDmg}），没有承受实际伤害。`);
    }
  }
  if (actualDmg > 0 && target.currentHp > 0 && !damageOptions.redirectedByJoker) {
    applySkillStatusEffect(runtime, skill, target);
    applyAttackerStyleEffects(runtime, user, target);
  }
  if (actualDmg > 0 || (target.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(target);

  handleValorantWeaponDrop(runtime, target, actualDmg);
  handlePhysicalCounterReflect(runtime, skill, user, target, actualDmg);
  consumeAimAfterAttack(runtime, user, skill);

  user.stats.dmgDealt += actualDmg;
  grantValorantHitRewards(runtime, user, actualDmg);
  handlePrimaryTargetDefeat(runtime, user, target, skill);

  applyLifestealEffects(runtime, user, target, skill, actualDmg, hpBeforeDamage);
  triggerSuccubusBabyFollowup(runtime, user, target, skillId, userTeamId, triggerDepth);

  if (actualDmg <= 0) runtime.handleTransformations(target);
  runtime.handleTransformations(user);
  if (skill.afterExecute && !damageOptions.redirectedByJoker) {
    skill.afterExecute(skillCtx, actualDmg, hpBeforeDamage);
    flushDeferredDamageEvents();
  }
}
