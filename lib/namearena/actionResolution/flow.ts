import type {
  BattleCombatEffectId,
  BattleLogMetadata,
  DamageApplicationOptions,
  Fighter,
} from '../types';
import { resolveHealing } from '../combatState';
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
  canTriggerOwlEvadeOpening,
  canTouchDamagePlane,
  consumeOwlEvadeOpening,
  dodgesWithPassiveSkill,
  missesSkill,
} from './guards';
import { handleValorantPreFire } from './preAction';
import { isDamageRedirected } from '../damageRedirects';
import type { ActionResolutionRuntime } from './types';
import { triggerBleedBeforeAttack } from '../statusMechanics';
import { getStatusIdentityDefinition } from '../statusRegistry';
import { hasIdentity, hasMechanic } from '../statusSystem';
import { resolveDeclarativeSkillDispel } from '../skillDispel';
import { resolveSkillPresentation } from '../battlePresentation';

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

function clarifyPendingStatusText(text: string, statusType?: string): string {
  if (!statusType) return text;
  const replacements: Partial<Record<string, Array<[RegExp, string]>>> = {
    STUN: [
      [/并眩晕了/g, '并尝试眩晕'],
      [/并眩晕/g, '并尝试眩晕'],
      [/并震慑目标/g, '并尝试震慑目标'],
      [/并震慑/g, '并尝试震慑'],
      [/并封锁行动/g, '并尝试封锁行动'],
      [/并使其石化/g, '并尝试使其石化'],
    ],
    AIRBORNE: [
      [/并将其当场【击飞】/g, '并尝试将其【击飞】'],
      [/并击飞/g, '并尝试击飞'],
    ],
    BURN: [
      [/并灼烧/g, '并尝试灼烧'],
      [/并燃烧/g, '并尝试点燃'],
    ],
    POISON: [
      [/并施加剧毒/g, '并尝试施加剧毒'],
      [/并附加剧毒/g, '并尝试附加剧毒'],
      [/并中毒/g, '并尝试使其中毒'],
    ],
    CONFUSED: [
      [/\{TARGET\} 陷入了深深的自我怀疑！\(附加混乱\)/g, '{TARGET} 受到认知干扰，技能尝试施加【混乱】！'],
      [/并附加混乱/g, '并尝试附加混乱'],
    ],
    CHARMED: [
      [/被彻底迷住了/g, '受到魅惑冲击'],
      [/陷入了【魅惑】/g, '被尝试施加【魅惑】'],
    ],
    BLIND: [[/丢失视野/g, '受到烟幕干扰，技能尝试施加【致盲】']],
    EMBARRASSED: [[/陷入了【尴尬】/g, '被尝试施加【尴尬】']],
    FREEZE: [[/并被冻结了/g, '并尝试冻结目标']],
    SILENCE: [[/并使其沉默/g, '并尝试使其沉默']],
    WEAK: [
      [/并附加虚弱/g, '并尝试附加虚弱'],
      [/受到诅咒，攻击力大幅下降/g, '受到诅咒冲击，技能尝试降低其攻击力'],
    ],
  };
  return (replacements[statusType] ?? []).reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

type GachaDrawChainState = {
  resolvedDraws: number;
  truncated?: boolean;
};

const MAX_GACHA_CHAIN_DRAWS = 128;

function formatGachaCardPreview(
  skillText: string,
  formatText: (text: string) => string,
  userName: string,
  targetName: string,
  estimatedDamage: number,
): string {
  const preview = clarifyDamagePlaceholderText(formatText(skillText))
    .replace(/{USER}/g, userName)
    .replace(/{TARGET}/g, targetName)
    .replace(/造成\s+\{VAL\}/g, '预计造成 {VAL}')
    .replace(/{VAL}/g, String(estimatedDamage));
  return `🎴 【牌面揭示】${preview}（伤害数值为转移与防御结算前预估）`;
}

function canJokerRedirectSkillDamage(target: Fighter, skillTag: string, runtime: ActionResolutionRuntime): boolean {
  return (
    target.job === 'GOD_OF_TROLLS' &&
    skillTag !== runtime.skillTags.BUFF &&
    skillTag !== runtime.skillTags.HEAL &&
    !hasIdentity(target, 'WATER_PRISON')
  );
}

function isActiveAttackSkill(skill: import('../types').SkillDefinition): boolean {
  if (skill.noDamage || skill.tag === 'heal' || skill.tag === 'buff' || skill.isSummon) return false;
  return (skill.mult ?? 0) > 0 || !!skill.damageFormula || !!skill.directTarget;
}

function combatActionMetadata(
  skill: { visualEffect?: BattleCombatEffectId },
  source: Fighter,
  targetIds: string[],
  presentation: import('../types').SkillPresentation,
): BattleLogMetadata {
  return {
    targetIds,
    visualCue: {
      kind: 'combat_action',
      sourceId: source.id,
      targetIds,
      presentation,
      ...(skill.visualEffect ? { effectId: skill.visualEffect } : {}),
    },
  };
}

export function executeSkillAction(
  runtime: ActionResolutionRuntime,
  skillId: string | null,
  user: Fighter,
  forcedTarget: Fighter | null = null,
  triggerDepth = 0,
  gachaDrawChain?: GachaDrawChainState,
): void {
  if ((triggerDepth > 5 && !gachaDrawChain) || !user || user.isDead || user.isDeadAnnounced || user.currentHp <= 0) return;

  const userTeamId = runtime.getTeamId(user);
  let currentTargets = getSelectableTargets(createTargetingRuntime(runtime), user);

  if (handleValorantPreFire(runtime, user, userTeamId, currentTargets, triggerDepth)) return;

  if (user.job === 'EXPLOSIVE_ANTI_CROC' && !user.confusedForcedTargetId) {
    const crocTargets = currentTargets.filter((fighter) => fighter.isGacha);
    if (crocTargets.length > 0) currentTargets = crocTargets;
  }

  const targetSelection = resolveTarget(createTargetingRuntime(runtime), user, forcedTarget, currentTargets);
  if (!targetSelection) return;
  let { target, isIntercepted } = targetSelection;
  const initiallyProtectedTarget = targetSelection.protectedTarget;
  let interceptionLabel = isIntercepted
    ? `【援护】${target.name} 冲了出来，替 ${initiallyProtectedTarget?.name ?? '宿主'} 挡下了 ${user.name} 的攻击`
    : '';

  const gachaStateBeforeResolution = {
    luck: user.gachaLuck,
    pityPower: user.gachaPityPower,
  };
  const skill = resolveSkillDefinition({
    skills: runtime.skills,
    data: runtime.data,
    fighters: runtime.fighters,
    turnCount: runtime.turnCount,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
    log: (type, text, metadata) => runtime.log(type, text, metadata),
  }, skillId, user);
  const incomingActionName = skill.name ?? '攻击';
  const actionPresentation = resolveSkillPresentation(skillId, skill, user);
  if (isIntercepted) {
    interceptionLabel = `【援护】${target.name} 冲了出来，替 ${initiallyProtectedTarget?.name ?? '宿主'} 挡下了 ${user.name} 的【${incomingActionName}】`;
  }
  const formatText = (text: string): string => formatSkillText(skill, text);

  if (skillId === 'bujin_chair' && !user.isTokusatsu) {
    return runtime.log('info', `🪑 ${user.name} 试图模仿刺猬人召唤【武神王座】，但由于缺乏特摄之魂，椅子刚落地就散架了！`);
  }

  if (skill.triggerAgain) {
    runtime.log(
      'buff',
      formatText(skill.text ?? '').replace(/{USER}/g, user.name),
      combatActionMetadata(skill, user, [user.id], actionPresentation),
    );
    const chain = gachaDrawChain ?? { resolvedDraws: 0 };
    for (let i = 0; i < skill.triggerAgain; i++) {
      if (chain.resolvedDraws >= MAX_GACHA_CHAIN_DRAWS) {
        if (!chain.truncated) {
          chain.truncated = true;
          runtime.log('info', `🃏 【强欲之壶】连续抽卡达到 ${MAX_GACHA_CHAIN_DRAWS} 次安全上限，本次极端连锁在此收束。`);
        }
        break;
      }
      chain.resolvedDraws += 1;
      executeSkillAction(runtime, skillId, user, null, triggerDepth + 1, chain);
    }
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
    skill,
  );
  let actionSettled = false;
  const settleAction = () => {
    if (actionSettled) return;
    actionSettled = true;
    skill.onActionSettled?.(skillCtx);
  };
  skillCtx.targetWasIntercepted = isIntercepted;
  skillCtx.interceptedProtectedTargetId = initiallyProtectedTarget?.id;
  const randomTextPool = skill.isRandomText && skill.pool ? skill.pool as string[] : null;
  const randomTextIndex = randomTextPool && randomTextPool.length > 0
    ? Math.floor(Math.random() * randomTextPool.length)
    : null;
  const resolvedVisualEffect = randomTextIndex !== null
    ? skill.randomTextVisualEffects?.[randomTextIndex] ?? skill.visualEffect
    : skill.visualEffect;
  const makeSkillVisualMetadata = (visualTargetIds: string[]) => combatActionMetadata(
    { visualEffect: resolvedVisualEffect },
    user,
    visualTargetIds,
    actionPresentation,
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

  const isSupportAction = skill.tag === runtime.skillTags.HEAL || skill.tag === runtime.skillTags.BUFF;
  if (!isSupportAction && runtime.prepareYuzuProphetIncomingAction(user, target)) {
    refundInterruptedGacha('被预言家裁定取消');
    settleAction();
    return;
  }
  if (!isSupportAction) {
    resolveDeclarativeSkillDispel(runtime, skill, user, target, 'before_action', 'before_action');
  }

  if (isActiveAttackSkill(skill)) {
    const bleed = triggerBleedBeforeAttack({
      fighters: runtime.fighters,
      log: runtime.log,
      applyDamage: runtime.applyDamage,
      markDefeated: runtime.markDefeated,
      flushDeferredDamageEvents: runtime.flushDeferredDamageEvents,
      isActiveCombatant: runtime.isActiveCombatant,
    }, user, skill.bleedTriggerCount ?? 1);
    if (!bleed.canContinue) {
      runtime.log('info', `🩸 ${user.name} 在出手前被流血撕裂，本次【${incomingActionName}】被迫中止！`);
      settleAction();
      return;
    }
  }

  const consumePreSkillBlock = (): boolean => {
    if (
      skill.tag === runtime.skillTags.HEAL ||
      skill.tag === runtime.skillTags.BUFF ||
      !hasMechanic(target, 'SPELL_BLOCK')
    ) return false;

    const spellBlock = consumeSpellBlock(target);
    const healing = resolveHealing(target, Math.floor(target.maxHp * 0.15), {}, runtime.log);
    const healText = healing.actual > 0
      ? `，并恢复了 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '，但附带治疗被完全阻止'
        : '，但生命已满，治疗溢出';
    if (skill.spellBlockMode !== 'afterSetup') {
      runtime.log(
        'skill',
        `⚔️ 【技能发动】${user.name} 向 ${target.name} 发动【${incomingActionName}】！`,
        makeSkillVisualMetadata([target.id]),
      );
    }
    runtime.log('info', spellBlock
      ? formatPreSkillSpellBlock(spellBlock, user.name, skill.name, target.name, healText)
      : `🔵 ${target.name} 的防护光幕挡下了 ${user.name} 的【${skill.name}】${healText}！`);
    refundInterruptedGacha('被法术抵挡挡下');
    return true;
  };

  if (skill.spellBlockMode !== 'perHit' && skill.spellBlockMode !== 'afterSetup' && consumePreSkillBlock()) {
    settleAction();
    return;
  }

  if (skill.onExecute && skill.onExecute(skillCtx)) {
    flushDeferredDamageEvents();
    settleAction();
    return;
  }

  if (skill.spellBlockMode === 'afterSetup' && consumePreSkillBlock()) {
    settleAction();
    return;
  }

  if (runtime.executeSupportSkill(skill, user, forcedTarget, userTeamId)) {
    runtime.spreadDivaSupport(skill, user, userTeamId);
    settleAction();
    return;
  }

  const owlOpeningReady = canTriggerOwlEvadeOpening(target, skill, isIntercepted);
  if (!owlOpeningReady && missesSkill(user, target, skill, isIntercepted)) {
    runtime.log('info', `💨 ${user.name} 的 ${skill.name ?? '攻击'} 被 ${target.name} 闪避了！`);
    refundInterruptedGacha('被闪避');
    settleAction();
    return;
  }

  if (handleWaitCounter(runtime, target, user, triggerDepth, incomingActionName)) {
    refundInterruptedGacha('被反击打断');
    settleAction();
    return;
  }
  if (handleCounterStatus(runtime, target, user)) {
    refundInterruptedGacha('被反击打断');
    settleAction();
    return;
  }
  if (!runtime.isActiveCombatant(user)) {
    refundInterruptedGacha('因反击退场而中止');
    settleAction();
    return;
  }

  if (breakAbsoluteDefense(runtime, skillId, user, target)) {
    refundInterruptedGacha('用于击破绝对防御');
    settleAction();
    return;
  }
  if (!owlOpeningReady && dodgesWithPassiveSkill(runtime, user, target, incomingActionName)) {
    refundInterruptedGacha('被特殊闪避');
    settleAction();
    return;
  }
  if (!canTouchDamagePlane(runtime, user, target, skill)) {
    refundInterruptedGacha('无法触碰目标');
    settleAction();
    return;
  }

  if (owlOpeningReady && consumeOwlEvadeOpening(target, skill, isIntercepted)) {
    runtime.log('debuff', `🍃 【乘风失衡】${target.name} 的身位破绽被 ${user.name} 抓住，这次直接单体攻击必定命中！`);
  }

  const damageResult = runtime.calculateDamage(user, target, skill, userTeamId, skillId);
  let { dmg } = damageResult;
  const { logType, ignoreDefOverride, sexyTrueDamage } = damageResult;

  if (skillId === 'suicide_bomb' && hasIdentity(target, 'LIQUID_BODY')) {
    dmg = Math.floor(dmg * 0.3);
    runtime.log('info', `💦 爆炸的冲击波被 ${target.name} 的液态身躯卸掉了大半伤害！`);
  }

  let preMitigationDmg = isIntercepted ? Math.floor(dmg * 0.5) : dmg;

  if (preMitigationDmg >= target.currentHp && target.job === 'GOD_SLIME') {
    const sonProtector = runtime.fighters.find((fighter) =>
      fighter.isSon &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === runtime.getTeamId(target) &&
      fighter.id !== target.id &&
      !hasMechanic(fighter, 'STAGGERED'),
    );
    if (sonProtector) {
      runtime.log('info', `🛡️ 致命一击袭来！但在命中的瞬间，${target.name} 与【水人的好大儿】互换了位置！好大儿化作一滩清水替水神挡下了这次致命攻击！`);
      target = sonProtector;
      isIntercepted = true;
      interceptionLabel = `【换位援护】${target.name} 化作一滩清水，替水神挡下了 ${user.name} 的【${incomingActionName}】`;
      preMitigationDmg = Math.floor(dmg * 0.5);
    }
  }

  skillCtx.target = target;
  skillCtx.preMitigationDamage = preMitigationDmg;
  skillCtx.targetWasTransformedBeforeDamage = !!target.transformed;
  const hpBeforeDamage = target.currentHp;
  const redirectsThroughOriginiumNetwork = target.isOriginiumCore && runtime.fighters.some((fighter) =>
    fighter.isOriginiumCrystal && runtime.isActiveCombatant(fighter),
  );
  const usesJokerPreResolutionLog = canJokerRedirectSkillDamage(target, skill.tag, runtime);
  const usesPreResolutionDamageLog = !isIntercepted && preMitigationDmg > 0 && (usesJokerPreResolutionLog || redirectsThroughOriginiumNetwork);

  if (isIntercepted) {
    runtime.log('info', `🛡️ ${interceptionLabel}！援护减伤后准备承受 ${preMitigationDmg} 点伤害！`, makeSkillVisualMetadata([target.id]));
  } else if (redirectsThroughOriginiumNetwork) {
    runtime.log(logType, `${logType === 'crit' ? '💥 暴击！' : ''}🜚 ${user.name} 的【${incomingActionName}】锁定 ${target.name}，预计形成 ${preMitigationDmg} 点冲击；源石网络将接管实际伤害结算。`, makeSkillVisualMetadata([target.id]));
  } else if (usesPreResolutionDamageLog) {
    if (user.isGacha && skill.isGacha && skill.text) {
      runtime.log('skill', formatGachaCardPreview(
        skill.text,
        formatText,
        user.name,
        target.name,
        preMitigationDmg,
      ), makeSkillVisualMetadata([target.id]));
    }
    runtime.log(
      logType,
      `${logType === 'crit' ? '💥 暴击！' : ''}🎭 ${user.name} 的【${incomingActionName}】锁定 ${target.name}，即将结算 ${preMitigationDmg} 点预估伤害！`,
      user.isGacha && skill.isGacha && skill.text
        ? { targetIds: [target.id] }
        : makeSkillVisualMetadata([target.id]),
    );
  } else {
    let msg = formatText(skill.text ?? '');
    if (randomTextPool && randomTextIndex !== null) {
      msg = msg.replace(/{JOKE}/g, randomTextPool[randomTextIndex] ?? '必杀！');
    }
    if (preMitigationDmg > 0 && skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL) {
      msg = clarifyPendingStatusText(
        clarifyDamagePlaceholderText(msg)
          .replace(/造成了?\s+\{VAL\}/g, '预计造成 {VAL}'),
        skill.statusApplications?.find((application) => application.target !== 'user')?.identityId,
      );
    }
    if (!msg.includes('{VAL}') && preMitigationDmg > 0 && skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL) {
      msg += ` (造成 {VAL} 点伤害)`;
    }
    runtime.log(
      logType,
      (logType === 'crit' ? '💥 暴击！' : '') + msg.replace(/{USER}/g, user.name).replace(/{TARGET}/g, target.name).replace(/{VAL}/g, String(preMitigationDmg)) +
        (preMitigationDmg > 0 ? '（结算前预估；若伤害发生变化会追加实际结算，附加状态另行确认）' : ''),
      makeSkillVisualMetadata([target.id]),
    );
  }
  flushQueuedPreResolutionLogs();

  applySelfDamage(runtime, user, skill);

  const damageOptions: DamageApplicationOptions = {
    deferTransform: true,
    actionName: incomingActionName,
    sourceKind: skill.damageSourceKind ?? (skill.damageFormula ? 'custom' : 'standard'),
    damageScope: skill.tag === runtime.skillTags.MAG || skill.tag === runtime.skillTags.DEBUFF ? 'magical' : 'physical',
    statusHitCount: skill.statusHitCount ?? 1,
  };
  const actualDmg = runtime.applyDamage(
    target,
    preMitigationDmg,
    'skill',
    !!ignoreDefOverride || sexyTrueDamage,
    user,
    damageOptions,
  );
  runtime.flushDeferredDamageEvents(target, 'mitigation');
  const yuzuFullyRedirected = !!damageOptions.redirectedByYuzu && actualDmg <= 0;
  const targetActualDmg = damageOptions.redirectedByOriginiumCore || damageOptions.redirectedByOwlEmperor || damageOptions.redirectedByMomo ? 0 : actualDmg;
  const dealtDmg = damageOptions.redirectedOriginiumDamage ??
    damageOptions.redirectedOwlEmperorDamage ??
    damageOptions.redirectedMomoDamage ??
    (actualDmg + (damageOptions.redirectedYuzuDamage ?? 0));
  skillCtx.damageRedirectedByOriginiumCore = !!damageOptions.redirectedByOriginiumCore;
  skillCtx.redirectedOriginiumDamage = damageOptions.redirectedOriginiumDamage;
  skillCtx.damageRedirectedByOwlEmperor = !!damageOptions.redirectedByOwlEmperor;
  skillCtx.redirectedOwlEmperorDamage = damageOptions.redirectedOwlEmperorDamage;
  skillCtx.damageRedirectedByMomo = !!damageOptions.redirectedByMomo;
  skillCtx.redirectedMomoDamage = damageOptions.redirectedMomoDamage;
  skillCtx.redirectedMomoTargetIds = damageOptions.redirectedMomoTargetIds;
  skillCtx.redirectedMomoDefeatedTargetIds = damageOptions.redirectedMomoDefeatedTargetIds;
  skillCtx.damageRedirectedByYuzu = !!damageOptions.redirectedByYuzu;
  skillCtx.redirectedYuzuDamage = damageOptions.redirectedYuzuDamage;
  skillCtx.redirectedYuzuTargetIds = damageOptions.redirectedYuzuTargetIds;
  skillCtx.redirectedYuzuDefeatedTargetIds = damageOptions.redirectedYuzuDefeatedTargetIds;
  skillCtx.suppressOnHitStatuses = !!damageOptions.suppressOnHitStatuses;
  skillCtx.suppressOnHitStatusTargetId = target.id;
  skillCtx.primaryHitConnectedWithoutHpDamage = !!damageOptions.hitWithoutHpDamage;
  if (isIntercepted) {
    if (actualDmg > 0) {
      runtime.log('info', `🛡️ ${interceptionLabel}，实际承受 ${actualDmg} 点伤害！`);
    } else if (damageOptions.hitWithoutHpDamage) {
      runtime.log('info', `🛡️ ${interceptionLabel}，攻击成功命中；但【黄昏余命】期间显示生命已为 0，不再产生生命损失！`);
    } else {
      runtime.log('info', `🛡️ ${interceptionLabel}，但没有造成实际伤害！`);
    }
  } else if (
    usesPreResolutionDamageLog &&
    !damageOptions.redirectedByJoker &&
    !damageOptions.redirectedByOriginiumCore &&
    !damageOptions.redirectedByOwlEmperor &&
    !damageOptions.redirectedByMomo &&
    !yuzuFullyRedirected &&
    !damageOptions.targetWithdrawnDuringDamage
  ) {
    if (actualDmg > 0) {
      runtime.log('info', `📌 实际结算：${target.name} 实际承受 ${actualDmg} 点伤害（原始预估 ${preMitigationDmg}）。`);
    } else if (damageOptions.hitWithoutHpDamage) {
      runtime.log('info', `📌 实际结算：攻击成功命中 ${target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命（原始预估 ${preMitigationDmg}）。`);
    } else {
      runtime.log('info', `📌 实际结算：${target.name} 完全抵消了这次伤害（原始预估 ${preMitigationDmg}），没有承受实际伤害。`);
    }
  }
  if (
    preMitigationDmg > 0 &&
    actualDmg !== preMitigationDmg &&
    !usesPreResolutionDamageLog &&
    !damageOptions.redirectedByJoker &&
    !damageOptions.redirectedByOriginiumCore &&
    !damageOptions.redirectedByOwlEmperor &&
    !damageOptions.redirectedByMomo &&
    !yuzuFullyRedirected &&
    !damageOptions.targetWithdrawnDuringDamage
  ) {
    if (actualDmg > 0) {
      runtime.log('info', `📌 实际结算：${target.name} 实际承受 ${actualDmg} 点伤害（原始预估 ${preMitigationDmg}）。`);
    } else if (damageOptions.hitWithoutHpDamage) {
      runtime.log('info', `📌 实际结算：攻击成功命中 ${target.name}；但【黄昏余命】期间显示生命已为 0，未再损失生命（原始预估 ${preMitigationDmg}）。`);
    } else {
      runtime.log('info', `📌 实际结算：${target.name} 完全抵消了这次伤害（原始预估 ${preMitigationDmg}），没有承受实际伤害。`);
    }
  }
  if (yuzuFullyRedirected) {
    const sharedDamage = damageOptions.redirectedYuzuDamage ?? 0;
    const sharedCount = damageOptions.redirectedYuzuTargetIds?.length ?? 0;
    runtime.log('info', `🪞 【镜界分摊完成】${target.name} 本人没有损失生命；${sharedCount} 名队友合计实际承受 ${sharedDamage} 点生命伤害。`);
  }
  if (preMitigationDmg > 0 && !damageOptions.targetWithdrawnDuringDamage) {
    runtime.log('system', `state-sync:${target.id}`, {
      displayInFeed: false,
      targetIds: [target.id],
    });
  }
  if (!isSupportAction) {
    resolveDeclarativeSkillDispel(runtime, skill, user, target, 'after_damage', 'before_action');
  }
  const selfStatusApplications = (skill.statusApplications ?? []).filter((application) => application.target === 'user');
  const targetStatusApplications = (skill.statusApplications ?? []).filter((application) => application.target !== 'user');
  const selfBarrierApplications = (skill.barrierApplications ?? []).filter((application) => application.target === 'user');
  const targetBarrierApplications = (skill.barrierApplications ?? []).filter((application) => application.target !== 'user');
  const selfStatusResolvedThroughShield = (selfStatusApplications.length > 0 || selfBarrierApplications.length > 0) && (damageOptions.resolution?.shieldDamage ?? 0) > 0;
  const targetedUtilityStatusReady = !!skill.noDamage && (targetStatusApplications.length > 0 || targetBarrierApplications.length > 0);
  const connectedWithoutHpDamage = !!damageOptions.hitWithoutHpDamage;
  if ((actualDmg > 0 || connectedWithoutHpDamage || selfStatusResolvedThroughShield || targetedUtilityStatusReady) && !damageOptions.redirectedByJoker && !damageOptions.redirectedByOriginiumCore && !damageOptions.redirectedByOwlEmperor && !damageOptions.redirectedByMomo) {
    if (selfStatusApplications.length > 0 || selfBarrierApplications.length > 0 || (targetedUtilityStatusReady && runtime.isActiveCombatant(target)) || ((actualDmg > 0 || connectedWithoutHpDamage) && target.currentHp > 0)) {
      applySkillStatusEffect(runtime, skill, user, target, !damageOptions.suppressOnHitStatuses);
    }
    if (!skill.noDamage && (actualDmg > 0 || connectedWithoutHpDamage) && target.currentHp > 0) {
      applyAttackerStyleEffects(runtime, user, target, !damageOptions.suppressOnHitStatuses);
    }
  }
  if (
    targetStatusApplications.length > 0 &&
    preMitigationDmg > 0 &&
    actualDmg <= 0 &&
    !connectedWithoutHpDamage &&
    !skill.noDamage &&
    !damageOptions.targetDefeatedDuringDamage
  ) {
    const statusName = targetStatusApplications.map((application) => getStatusIdentityDefinition(application.identityId).displayName).join('、');
    const redirected = isDamageRedirected(damageOptions);
    runtime.log('info', redirected
      ? `📌 状态结算：攻击伤害已从 ${target.name} 身上转移，本次【${statusName}】不会跟随伤害转移，未生效。`
      : `📌 状态结算：${target.name} 没有承受生命伤害，本次【${statusName}】未生效。`);
  }
  if (actualDmg > 0 || connectedWithoutHpDamage || (target.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(target);

  handleValorantWeaponDrop(runtime, target, targetActualDmg);
  handlePhysicalCounterReflect(runtime, skill, user, target, targetActualDmg);
  consumeAimAfterAttack(runtime, user, skill);

  grantValorantHitRewards(runtime, user, target, damageOptions.redirectedByMomo || damageOptions.redirectedByYuzu ? dealtDmg : targetActualDmg);
  applyLifestealEffects(runtime, user, target, skill, dealtDmg, hpBeforeDamage);
  skillCtx.targetDefeatedDuringAction = handlePrimaryTargetDefeat(runtime, user, target, skill) ||
    (damageOptions.redirectedMomoDefeatedTargetIds?.length ?? 0) > 0 ||
    (damageOptions.redirectedYuzuDefeatedTargetIds?.length ?? 0) > 0;
  if (!isSupportAction) {
    resolveDeclarativeSkillDispel(runtime, skill, user, target, 'after_recovery', 'before_action');
  }
  triggerSuccubusBabyFollowup(runtime, user, target, skillId, userTeamId, triggerDepth);

  if (targetActualDmg <= 0) runtime.handleTransformations(target);
  runtime.handleTransformations(user);
  if (skill.afterExecute && !damageOptions.redirectedByJoker) {
    skill.afterExecute(skillCtx, dealtDmg, hpBeforeDamage);
    flushDeferredDamageEvents();
  }
  settleAction();
}
