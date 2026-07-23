import type {
  Fighter,
  DamageApplicationOptions,
  JobDefinition,
  SkillDefinition,
  SkillContext,
  DefeatOptions,
  StatKey,
  SpinalSwordRef,
  BattleEngineData,
  BattleEngineCore,
  BattleEvent,
  BattleLogMetadata,
  BattleLogEntry,
  BattleState,
  DamageResolutionRecord,
  DamageResolutionOutcome,
  DispelOptions,
  DispelResolution,
  StatusApplication,
} from './types';
import {
  commitFormTransition,
  resolveSkillPresentation,
} from './battlePresentation';
import type { PuruisaishiRuntime } from './puruisaishiMechanics';
import { applyPermanentStatBuff, clearZeroedStatPenalty, cloneJobDefinition, isActiveCombatant, resolveHealing, setCurrentHp, syncHpPct } from './combatState';
import {
  ActionResolutionRuntime,
  applyAttackerStyleEffects as applyAttackerStyleEffectsAction,
  applyLifestealEffects as applyLifestealEffectsAction,
  applySelfDamage as applySelfDamageAction,
  applySkillStatusEffect as applySkillStatusEffectAction,
  breakAbsoluteDefense as breakAbsoluteDefenseAction,
  canTouchDamagePlane as canTouchDamagePlaneAction,
  consumeAimAfterAttack as consumeAimAfterAttackAction,
  createSkillContext as createSkillContextAction,
  dodgesWithPassiveSkill as dodgesWithPassiveSkillAction,
  executeSkillAction as executeSkillActionFlow,
  grantValorantKillRewards as grantValorantKillRewardsAction,
  handleCounterStatus as handleCounterStatusAction,
  handlePhysicalCounterReflect as handlePhysicalCounterReflectAction,
  handlePrimaryTargetDefeat as handlePrimaryTargetDefeatAction,
  handleValorantPreFire as handleValorantPreFireAction,
  handleValorantWeaponDrop as handleValorantWeaponDropAction,
  handleWaitCounter as handleWaitCounterAction,
  missesSkill as missesSkillAction,
  tryApplyHostileStatus as tryApplyHostileStatusAction,
  triggerSuccubusBabyFollowup as triggerSuccubusBabyFollowupAction,
} from './actionResolution';
import {
  CharacterHookRuntime,
  runCharacterDefeatHooks,
  runCharacterDefeatSettledHooks,
  runCharacterGlobalTickHooks,
  runCharacterReentryHooks,
  runCharacterReviveHooks,
  runCharacterSkillSelectionHooks,
  runCharacterTransformHooks,
} from './characterHooks';
import { enterTokusatsuMonsterForm } from './characterHooks/tokusatsu';
import {
  selectSpinalSwordRouteSkill,
  selectSpinalSwordSpecialSkill,
  shouldUseSpinalSwordRoute,
} from './specialMechanics';
import {
  formatSkillText,
  resolveSkillDefinition,
} from './skillResolution';
import {
  getConfusionTargets,
  getSelectableTargets,
  findActivePuppetProtector,
  isCompetitiveTarget,
  isSelectableTargetFor,
  resolveTarget,
  TargetingRuntime,
} from './targeting';
import {
  calculateDamage,
  DamageResolutionRuntime,
  getFatigueDamageBonusForTurn,
} from './damageResolution';
import { getResolvedDamageTotal, isDamageRedirected } from './damageRedirects';
import {
  advanceGlobalTimedStatuses,
  advanceLargeRoundTimedBarriers,
  clearSpinalSword,
  handleSpinalSwordDrop,
  processStatus,
  processStatusTurn,
  resolveAirborneLanding,
  settleSelfOpportunityStatuses,
  StatusProcessingRuntime,
  StatusTurnOptions,
  StatusTurnResult,
  syncPuppetMasterStatus,
  syncSpinalSwordState,
} from './statusProcessing';
import {
  checkWinCondition,
  determineActor,
  getWaitingCounterStatus,
  logUnableToAct,
  logWaitingCounter,
  TurnFlowRuntime,
} from './turnFlow';
import {
  executeSummonSkill as executeSummonSkillEffect,
  SummonResolutionRuntime,
} from './summonResolution';
import {
  applyStatBuff as applyStatBuffEffect,
  cleanseCommonNegativeStatuses as cleanseCommonNegativeStatusesEffect,
  executeSupportSkill as executeSupportSkillEffect,
  handleChimeraUltimateEvolution as handleChimeraUltimateEvolutionEffect,
  spreadDivaSupport as spreadDivaSupportEffect,
  SupportResolutionRuntime,
} from './supportResolution';
import {
  buildActionResolutionRuntime,
  buildCharacterHookRuntime,
  buildDamageResolutionRuntime,
  buildStatusProcessingRuntime,
  buildSummonResolutionRuntime,
  buildSupportResolutionRuntime,
  buildTargetingRuntime,
  buildTurnFlowRuntime,
} from './battleRuntime';
import {
  applyGachaSummonLifesteal,
  consumeGachaLuck,
  GACHA_LUCK_MAX,
  GACHA_RA_PHOENIX_STATUS,
  gachaEffectMetadata,
  gachaReactionMetadata,
  grantGachaLuck,
  isAdvancedSummonName,
  isLuckEmperor,
  triggerGachaDeathSave,
} from './gachaMechanics';
import { consumeSpellBlock, findDefenseStatus, formatInvul, formatSpellBlock } from './defenseStatus';

import {
  addTokusatsuThroneResonance,
  canUseTokusatsuThrone,
  TOKUSATSU_THRONE_RESONANCE_MAX,
} from './tokusatsuMechanics';
import {
  formatEmoteStats,
  grantEmoteAdaptStats,
} from './emoteMechanics';
import {
  activeYuzuTeammates,
  ensureYuzuMarkedTarget,
  ensureYuzuOpeningShield,
  enterYuzuPhaseThree,
  hasAnyYuzuTeammate,
  tryAdvanceYuzuPhaseByHp,
  YUZU_BARRIER_IDENTITY,
  YUZU_PHASE_ONE_REDUCTION,
  YUZU_PHASE_THREE_REDUCTION,
  YUZU_TEAM_SHARE_RATIO,
  YUZU_UNMARKED_INCOMING_DAMAGE_MULTIPLIER,
} from './yuzuMechanics';
import {
  consumePuruisaishiShield,
  grantOriginiumCrystalBreakReward,
  PURUISAISHI_BARRIER_IDENTITY,
  notePuruisaishiRoundActor,
  noteOriginiumDamageLanded,
  processPuruisaishiLargeRoundEnd,
  processPuruisaishiRoundEnd,
  redirectOriginiumCoreDamage,
  spawnCrystalFromInfectedDeath,
  trySpawnPuruisaishiEvent,
} from './puruisaishiMechanics';
import {
  consumeCompletedLargeRound,
  createBattleState,
  getLargeRoundPriorityActorIds,
  noteLargeRoundActor,
  syncLargeRoundState,
  withBattleRandom,
} from './battleState';
import { recordDamageSettlement } from './combatLedger';
import {
  ensureOwlState,
  findOwlEmperor,
  getOwlIncomingMultiplier,
  getOwlOutgoingMultiplier,
  getOwlWarFormDisplayName,
  markOwlSummonDeathSave,
  owlResistsHostileStatus,
  tryEnterOwlDefeat,
  type OwlRuntime,
} from './owlMechanics';
import {
  activeMomoShareCaptains,
  applyMomoCaptainDamageRewards,
  ensureMomoState,
  initializeMomoTeam,
  processMomoActorTurnEnd,
  withMomoCaptainHpBonusesSuspended,
  type MomoRuntime,
} from './momoMechanics';
import { consumeBarriers, dispelBarrierEffects, dispelStatusEffects, findIdentity, getBarrierTotal, hasIdentity, initializeEffectState, removeEffects, applyStatus, withPersistentStatusShapesSuspended } from './statusSystem';
import {
  getEffectiveCombatStat,
  getIncomingDirectStatusMultiplier,
  getMoraleDamageMultiplier,
  getOutgoingDirectStatusMultiplier,
  resolveDirectDamageStatusAftermath,
  settleBurnAtLargeRound,
  settleSelfOpportunityResources,
  hasMentalBreakdown,
  resetStatusResourcesOnDeath,
  resetStatusResourcesOnRevive,
  WT_REPAIRING_PROFILE,
  type StatusMechanicsRuntime,
} from './statusMechanics';
import type { DamageSourceKind } from './types';
import { getStatusIdentityDefinition, isDirectDamageKind } from './statusRegistry';
import { buildFighterStatusPresentation, buildStatusPresentationMember } from './statusPresentation';

const DAMAGE_SOURCE_LABELS: Record<string, string> = {
  skill: '技能伤害',
  status: '状态伤害',
  counter: '反击伤害',
  reflect: '反弹伤害',
  transfer: '转移伤害',
  yuzu_share: '镜界分摊伤害',
  originium_share: '阿喃那伤害均摊',
  owl_redirect: '帝王之征承伤',
  owl_coop: '过江协同伤害',
  owl_explosion: '蛐蛐自爆伤害',
  owl_cost: '鸮的机制消耗',
  momo_share: '|OMO均摊伤害',
  momo_cost: '萌月沫沫的机制消耗',
};

function getDamageSourceLabel(source: string): string {
  return DAMAGE_SOURCE_LABELS[source] ?? `${source}伤害`;
}

function inferDamageSourceKind(source: string, options: DamageApplicationOptions): DamageSourceKind {
  if (options.sourceKind) return options.sourceKind;
  if (source === 'skill' || source === 'owl_coop') return 'standard';
  if (source === 'status') return 'status';
  if (source === 'counter') return 'counter';
  if (source === 'reflect') return 'reflect';
  if (source === 'transfer' || source === 'owl_redirect') return 'transfer';
  if (source === 'yuzu_share' || source === 'originium_share' || source === 'momo_share') return 'share';
  if (source.endsWith('_cost') || source === 'self_damage') return 'self_cost';
  return 'environment';
}

function fighterPhaseIdentity(fighter: Fighter): string {
  return [
    fighter.job,
    fighter.transformed ? 1 : 0,
    fighter.yuzuPhase ?? 0,
    fighter.owlState?.phase ?? 0,
    fighter.momoState?.phase ?? 0,
    fighter.puruisaishiPhase ?? 0,
  ].join(':');
}

function pickRandomFighters(fighters: Fighter[], maxCount: number): Fighter[] {
  const pool = [...fighters];
  const picked: Fighter[] = [];
  while (picked.length < maxCount && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [fighter] = pool.splice(index, 1);
    if (fighter) picked.push(fighter);
  }
  return picked;
}

function splitDamageAcrossTargets(totalDamage: number, targetCount: number): number[] {
  if (totalDamage <= 0 || targetCount <= 0) return [];
  const base = Math.floor(totalDamage / targetCount);
  let remainder = totalDamage % targetCount;
  return Array.from({ length: targetCount }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return base + extra;
  });
}

function formatFallbackDeathMessage(fighter: Fighter): string {
  const lastDamage = fighter.lastDamage;
  if (!lastDamage || lastDamage.amount <= 0) {
    return `💀 ${fighter.name} 生命归零，倒在了战场上！`;
  }

  const sourceText = lastDamage.attackerName
    ? `${lastDamage.attackerName} 的${lastDamage.sourceLabel}`
    : lastDamage.sourceLabel;
  return `💀 ${fighter.name} 因 ${sourceText}（${lastDamage.amount}点）倒下了！`;
}

function formatIncomingDamageSource(source: string, attacker?: Fighter, actionName?: string): string {
  const actionText = actionName ? `【${actionName}】` : getDamageSourceLabel(source);
  return attacker ? `${attacker.name}的${actionText}` : actionText;
}

function getSummonBaseName(fighter: Fighter): string {
  return fighter.summonBaseName ?? fighter.name;
}

const ACTIVE_DEATH_SAVE_STATUS_TYPES = new Set(['TING_DEFIANCE', 'TOKUSATSU_DEFIANCE']);
const TING_DEFIANCE_DURATION = 3;
const GACHA_BLUE_EYES_GUARD_COOLDOWN = 'GACHA_BLUE_EYES_GUARD_COOLDOWN';
const GACHA_ULTIMATE_GUARD_COOLDOWN = 'GACHA_ULTIMATE_GUARD_COOLDOWN';
const GACHA_TRAP_GUARD_COOLDOWN = 'GACHA_TRAP_GUARD_COOLDOWN';
const GAMER_APM_MAX = 12;
const GAMER_WORLD_STAGE_THRESHOLD = 11;
const GAMER_WORLD_STAGE_DURATION = 2;
const WT_SPAWN_POINT_MAX = 8;

const GACHA_TING_GUARD_TRAP_SUMMON: SkillDefinition = {
  name: '护主陷阱',
  tag: 'special',
  isSummon: true,
  summonName: '护主栗子球',
  summonJob: 'WARRIOR',
  stats: { hp: 1200, atk: 20, def: 160, res: 160, spd: 90, agl: 80, mag: 20, wis: 80 },
  text: '🪤 {USER} 翻开覆盖的「护主陷阱」，临时召唤「护主栗子球」挡在身前！',
};

function grantWarThunderSpawnPoints(fighter: Fighter, amount: number): number {
  if (!fighter.isWT || fighter.job !== 'WT_TOP_TIER' || amount <= 0) return fighter.wtSpawnPoints ?? 0;
  const before = fighter.wtSpawnPoints ?? 0;
  fighter.wtSpawnPoints = Math.min(WT_SPAWN_POINT_MAX, before + amount);
  return fighter.wtSpawnPoints;
}

function restoreZeroedStatsIfNeeded(fighter: Fighter): void {
  clearZeroedStatPenalty(fighter);
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function isOriginalGamer(fighter?: Fighter): fighter is Fighter {
  return Boolean(fighter?.isGamer && !fighter.isSon && (fighter.job === 'HIGH_END_GAMER' || fighter.job === 'ALL_PLATFORM_CHAMPION'));
}

type ActiveActionContext = {
  id: string;
  actorId: string;
  actorName: string;
  skillId: string | null;
  skillName: string;
  presentation: import('./types').SkillPresentation;
  triggerDepth: number;
  forcedTargetId?: string;
  primaryTargetId?: string;
  primaryPreDefenseDamage?: number;
  combatVisualClaimed?: boolean;
};

type ActionDescriptorOverride = {
  skillName?: string;
  presentation?: import('./types').SkillPresentation;
  targetIds?: readonly string[];
};

export class BattleEngine {
  fighters: Fighter[];
  addLogCallback: (e: BattleLogEntry) => void;
  addEventCallback?: (event: BattleEvent) => void;
  JOBS: Partial<Record<string, JobDefinition>>;
  SKILLS: Record<string, SkillDefinition>;
  Data: BattleEngineData;
  Core: BattleEngineCore;
  SKILL_TAGS: Record<string, string>;
  turnCount: number;
  activeSpinalSwordRef?: SpinalSwordRef;
  battleState: BattleState;
  events: BattleEvent[] = [];
  private deterministicRandom: boolean;
  private randomDepth = 0;
  private actionStack: ActiveActionContext[] = [];
  private causalScopeStack: string[] = [];
  private deferredDamageActions = new Map<string, Array<() => void>>();

  constructor(
    fighters: Fighter[],
    addLogCallback: (e: BattleLogEntry) => void,
    JOBS: Partial<Record<string, JobDefinition>>,
    SKILLS: Record<string, SkillDefinition>,
    Data: BattleEngineData,
    Core: BattleEngineCore,
    turnCount = 0,
    battleState?: BattleState,
    addEventCallback?: (event: BattleEvent) => void,
  ) {
    this.fighters = fighters;
    this.fighters.forEach(initializeEffectState);
    this.addLogCallback = addLogCallback;
    this.JOBS = JOBS;
    this.SKILLS = SKILLS;
    this.Data = Data;
    this.Core = Core;
    this.addEventCallback = addEventCallback;
    this.SKILL_TAGS = Data.SKILL_TAGS ?? {};
    this.turnCount = turnCount;
    this.deterministicRandom = !!battleState;
    this.battleState = battleState ?? createBattleState(Math.floor(Math.random() * 2147483646) + 1, turnCount);
    this.battleState.turnCount = turnCount;
    syncLargeRoundState(this.battleState, this.fighters);
    this.initializeYuzuOpeningShields();
    this.initializeOwlStates();
  }

  log(type: string, text: string, metadata: BattleLogMetadata = {}): void {
    const action = this.actionStack[this.actionStack.length - 1];
    const isPrimaryCombatVisual = metadata.visualCue?.kind === 'combat_action';
    let resolvedMetadata = metadata;
    if (action && isPrimaryCombatVisual) {
      if (action.combatVisualClaimed) {
        const withoutDuplicateCue = { ...metadata };
        delete withoutDuplicateCue.visualCue;
        delete withoutDuplicateCue.visualCueId;
        resolvedMetadata = withoutDuplicateCue;
      } else {
        action.combatVisualClaimed = true;
      }
    }
    const event = this.createEvent('log', type, text.replace(/\s*\r?\n\s*/g, ' '), true, resolvedMetadata);
    this.addLogCallback(event as BattleLogEntry);
  }

  createEvent(
    kind: BattleEvent['kind'],
    type: string,
    text: string,
    visible: boolean,
    extra: Partial<BattleEvent> = {},
  ): BattleEvent {
    const action = this.actionStack[this.actionStack.length - 1];
    const sequence = ++this.battleState.eventSequence;
    const eventId = `event-${sequence}`;
    const event: BattleEvent = {
      id: eventId,
      rootEventId: this.causalScopeStack[0] ?? this.actionStack[0]?.id ?? eventId,
      sequence,
      kind,
      visible,
      type,
      text,
      turn: this.turnCount,
      largeRound: this.battleState.largeRound.number,
      seed: this.battleState.seed,
      ...(action ? {
        actionId: action.id,
        actorId: action.actorId,
        actorName: action.actorName,
        skillId: action.skillId,
        skillName: action.skillName,
        presentation: action.presentation,
        triggerDepth: action.triggerDepth,
      } : {}),
      ...extra,
      ...(extra.visualCue ? { visualCueId: extra.visualCueId ?? `${eventId}:visual` } : {}),
    };
    this.events.push(event);
    this.addEventCallback?.(event);
    return event;
  }

  recordEvent(kind: BattleEvent['kind'], type: string, text: string, extra: Partial<BattleEvent> = {}): BattleEvent {
    return this.createEvent(kind, type, text, false, extra);
  }

  runWithBattleRandom<T>(callback: () => T): T {
    if (!this.deterministicRandom || this.randomDepth > 0) return callback();
    this.randomDepth += 1;
    try {
      return withBattleRandom(this.battleState, callback);
    } finally {
      this.randomDepth -= 1;
    }
  }

  beginAction(
    skillId: string | null,
    actor: Fighter,
    forcedTarget: Fighter | null,
    triggerDepth: number,
    override: ActionDescriptorOverride = {},
  ): ActiveActionContext {
    const actionNumber = ++this.battleState.actionSequence;
    const skillName = override.skillName ?? (skillId ? (this.SKILLS[skillId]?.name ?? skillId) : '普通攻击');
    const action: ActiveActionContext = {
      id: `action-${actionNumber}`,
      actorId: actor.id,
      actorName: actor.name,
      skillId,
      skillName,
      presentation: override.presentation ?? resolveSkillPresentation(skillId, skillId ? this.SKILLS[skillId] : undefined, actor),
      triggerDepth,
      forcedTargetId: forcedTarget?.id,
    };
    this.actionStack.push(action);
    this.recordEvent('action_start', 'action', `${actor.name} 开始执行【${skillName}】。`, {
      targetIds: override.targetIds ? [...override.targetIds] : forcedTarget ? [forcedTarget.id] : undefined,
    });
    return action;
  }

  runReactionAction(
    actor: Fighter,
    descriptor: import('./characterHooks').ReactionActionDescriptor,
    callback: () => void,
  ): void {
    const action = this.beginAction(
      descriptor.skillId,
      actor,
      descriptor.targets?.[0] ?? null,
      descriptor.triggerDepth ?? this.actionStack.length,
      {
        skillName: descriptor.skillName,
        presentation: descriptor.presentation ?? 'skill',
        targetIds: descriptor.targets?.map((target) => target.id),
      },
    );
    try {
      callback();
    } finally {
      this.endAction(action);
    }
  }

  runCausalScope<T>(label: string, callback: () => T): T {
    if (this.actionStack.length > 0 || this.causalScopeStack.length > 0) return callback();
    const scopeNumber = ++this.battleState.actionSequence;
    const scopeId = `scope-${scopeNumber}:${label}`;
    this.causalScopeStack.push(scopeId);
    try {
      return callback();
    } finally {
      this.causalScopeStack.pop();
    }
  }

  endAction(action: ActiveActionContext): void {
    this.resolveOwlCrossingAssists(action);
    this.recordEvent('action_end', 'action', `${action.actorName} 的【${action.skillName}】结算结束。`);
    const index = this.actionStack.lastIndexOf(action);
    if (index >= 0) this.actionStack.splice(index, 1);
  }

  resolveOwlCrossingAssists(action: ActiveActionContext): void {
    if (
      action.skillId === 'owl_crossing_assist' ||
      !action.primaryTargetId ||
      !action.primaryPreDefenseDamage ||
      action.primaryPreDefenseDamage <= 0
    ) return;
    const victim = this.fighters.find((fighter) => fighter.id === action.primaryTargetId);
    if (!victim || !this.isActiveCombatant(victim)) return;

    const markedActorId = action.actorId;
    const owls = this.fighters.filter((fighter) => {
      if (!fighter.isOwl || !this.isActiveCombatant(fighter)) return false;
      const state = ensureOwlState(fighter, this.turnCount);
      return state.phase === 2 &&
        state.riverMarkedTargetId === markedActorId &&
        (state.riverMarkExpiresTurn ?? -1) > this.turnCount &&
        !hasStatus(fighter, 'OWL_FORM_DEFEAT');
    });

    for (const owl of owls) {
      if (!this.isActiveCombatant(owl) || !this.isActiveCombatant(victim)) break;
      if (owl.id === victim.id) {
        this.log('info', `🌊 【过江协同】${action.actorName} 攻向 ${victim.name}，但 ${owl.name} 不会把协同攻击打向自己。`);
        continue;
      }
      const protector = findActivePuppetProtector(this.createTargetingRuntime(), victim, owl);
      const target = protector ?? victim;
      if (!this.isActiveCombatant(target)) continue;
      const assistAction = this.beginAction('owl_crossing_assist', owl, target, action.triggerDepth + 1);
      try {
        this.log('skill', `🌊 【过江协同】${action.actorName} 攻向 ${victim.name}，触发 ${owl.name} 追击同一个受害者！`, {
          actorId: owl.id,
          actorName: owl.name,
          targetIds: [target.id],
          visualCue: {
            kind: 'combat_action',
            sourceId: owl.id,
            targetIds: [target.id],
            presentation: 'skill',
          },
        });
        if (protector) {
          this.log('info', `🛡️ 【傀儡援护】${protector.name} 挡在 ${victim.name} 身前，接管 ${owl.name} 的【过江协同】！`);
        }
        const skill = this.SKILLS.owl_crossing_assist;
        if (skill && this.missesSkill(owl, target, skill, !!protector)) {
          this.log('info', `💨 【过江协同】${owl.name} 追击 ${target.name}，但被对方闪开了！`);
          continue;
        }
        if (target.id !== owl.id) {
          if (this.handleWaitCounter(target, owl, action.triggerDepth + 1)) continue;
          if (this.handleCounterStatus(target, owl) || !this.isActiveCombatant(owl)) continue;
        }
        const copied = Math.max(1, Math.floor(action.primaryPreDefenseDamage));
        this.log('skill', `🌊 【过江协同】${owl.name} 同步过江，复制 ${copied} 点防御前冲击追击 ${target.name}！`);
        const options: DamageApplicationOptions = {
          actionName: '过江协同',
          respectDefenses: true,
          suppressOwlCooperation: true,
          deferTransform: true,
        };
        const actual = this.applyDamage(target, copied, 'skill', false, owl, options);
        this.flushDeferredDamageEvents(target, 'mitigation');
        const resolved = getResolvedDamageTotal(actual, options);
        const redirected = isDamageRedirected(options);
        if (!redirected) {
          this.log(resolved > 0 ? 'skill' : 'info', `🌊 【过江协同】${target.name} 实际承受 ${resolved} 点伤害。`);
        }
        if (resolved > 0 || (target.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(target);
        if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
          this.markDefeated(target, {
            message: `💀 【过江协同】${target.name} 被 ${owl.name} 的协同追击击败！`,
            killer: owl,
          });
        }
      } finally {
        this.endAction(assistAction);
      }
    }
  }

  queueOrLogDamageEvent(
    target: Fighter,
    options: DamageApplicationOptions,
    type: string,
    text: string,
    metadata?: BattleLogMetadata,
    phase: 'mitigation' | 'aftermath' = 'aftermath',
    dedupeKey?: string,
  ): void {
    if (options.deferTransform) {
      target.pendingDamageEvents = target.pendingDamageEvents ?? [];
      if (dedupeKey && target.pendingDamageEvents.some((event) => event.dedupeKey === dedupeKey)) return;
      target.pendingDamageEvents.push({ type, text, metadata, phase, dedupeKey });
      return;
    }
    this.log(type, text, metadata);
  }

  queueOrRunDamageAction(target: Fighter, options: DamageApplicationOptions, action: () => void): void {
    if (!options.deferTransform) {
      action();
      return;
    }
    const queued = this.deferredDamageActions.get(target.id) ?? [];
    queued.push(action);
    this.deferredDamageActions.set(target.id, queued);
  }

  flushDeferredDamageEvents(fighter: Fighter, phase: 'mitigation' | 'all' = 'all'): void {
    if (phase === 'mitigation') {
      const pendingEvents = fighter.pendingDamageEvents ?? [];
      const mitigationEvents = pendingEvents.filter((event) => event.phase === 'mitigation');
      const aftermathEvents = pendingEvents.filter((event) => event.phase !== 'mitigation');
      mitigationEvents.forEach((event) => this.log(event.type, event.text, event.metadata));
      if (aftermathEvents.length > 0) fighter.pendingDamageEvents = aftermathEvents;
      else delete fighter.pendingDamageEvents;
      return;
    }
    let needsTransformCheck = true;
    while (needsTransformCheck || (fighter.pendingDamageEvents?.length ?? 0) > 0 || this.deferredDamageActions.has(fighter.id)) {
      const pendingEvents = fighter.pendingDamageEvents ?? [];
      delete fighter.pendingDamageEvents;
      pendingEvents.forEach((event) => this.log(event.type, event.text, event.metadata));
      if (needsTransformCheck || pendingEvents.length > 0) this.handleTransformations(fighter);
      needsTransformCheck = false;

      const pendingActions = this.deferredDamageActions.get(fighter.id) ?? [];
      this.deferredDamageActions.delete(fighter.id);
      pendingActions.forEach((action) => action());
    }
  }

  syncHpPct(f: Fighter): void {
    syncHpPct(f);
  }

  isActiveCombatant(f: Fighter): boolean {
    return isActiveCombatant(f);
  }

  getFatigueDamageBonus(): number {
    return getFatigueDamageBonusForTurn(this.turnCount);
  }

  applyStatus(
    target: Fighter,
    application: StatusApplication,
  ): boolean {
    const identityId = application.identityId;
    const statusApplication: StatusApplication = {
      ...application,
      attribution: {
        ...application.attribution,
        effectSourceId: application.attribution?.effectSourceId ?? identityId,
        applierName: application.attribution?.applierName ?? (
          application.attribution?.applierId
            ? this.fighters.find((fighter) => fighter.id === application.attribution?.applierId)?.name
            : undefined
        ),
      },
      observedAt: {
        globalAction: this.turnCount,
        largeRound: this.battleState.largeRound.number,
      },
    };
    const statusesBefore = new Set(target.statuses);
    const presentationKeysBefore = new Set(buildFighterStatusPresentation(target).map((item) => item.key));
    const requestedDefinition = getStatusIdentityDefinition(identityId);
    const isHostile = requestedDefinition.polarity === 'negative';
    if (target.currentHp <= 0 || target.isDead || target.isDeadAnnounced) {
      this.recordEvent('status', 'status_blocked', `${target.name}:${identityId}:defeated`, { targetIds: [target.id] });
      return false;
    }
    if (
      identityId !== 'SYNERGY_SLACKING' &&
      hasIdentity(target, 'SYNERGY_SLACKING')
    ) {
      if (statusApplication.logBlocked ?? true) {
        this.log('info', `⛺ 【场外OB】${target.name} 已暂时离开战场，不会获得【${requestedDefinition.displayName}】。`);
      }
      this.recordEvent('status', 'status_blocked', `${target.name}:${identityId}:off_field`, { targetIds: [target.id] });
      return false;
    }
    if (isHostile && owlResistsHostileStatus(target)) {
      this.log('info', `🌫️ 【败兵抗性】${target.name} 在败阵混乱中避开了【${requestedDefinition.displayName}】！`);
      this.recordEvent('status', 'status_blocked', `${target.name}:${identityId}`, { targetIds: [target.id] });
      return false;
    }
    const applied = tryApplyHostileStatusAction(
      this.createActionResolutionRuntime(),
      target,
      statusApplication,
    );
    if (applied) {
      const expectedSourceId = statusApplication.attribution?.effectSourceId ?? identityId;
      const status = findIdentity(target, identityId, {
        effectSourceIds: [expectedSourceId],
        applierIds: statusApplication.attribution?.applierId
          ? [statusApplication.attribution.applierId]
          : undefined,
      }) ?? findIdentity(target, identityId);
      const appliedStatus = status;
      if (appliedStatus && statusApplication.silent !== true) {
        const presentation = buildFighterStatusPresentation(target).find((item) =>
          item.members.some((member) => member.key === appliedStatus.instanceId),
        ) ?? buildStatusPresentationMember(appliedStatus);
        const valueText = presentation.valueLabel ? `（${presentation.valueLabel}）` : '';
        const sourceText = presentation.sourceLabel ? `，来源：${presentation.sourceLabel}` : '';
        const stacked = presentationKeysBefore.has(presentation.key) || statusesBefore.has(appliedStatus);
        this.log(
          presentation.polarity === 'negative' ? 'debuff' : presentation.polarity === 'positive' ? 'buff' : 'info',
          `${presentation.icon} 【状态${stacked ? '叠加' : '施加'}】${target.name} 的【${presentation.name}】${valueText}生效${sourceText}。`,
        );
      }
    }
    this.recordEvent('status', applied ? 'status_applied' : 'status_blocked', `${target.name}:${identityId}`, {
      targetIds: [target.id],
    });
    return applied;
  }

  dispelStatusEffects(target: Fighter, options: DispelOptions): DispelResolution {
    const result = dispelStatusEffects(target, options);
    const barrierResult = dispelBarrierEffects(target, options);
    const emitLog = options.emitLog ?? ((type: string, text: string) => this.log(type, text));
    const removedAirborne = result.removed.filter((status) => status.mechanicId === 'AIRBORNE');
    const strengthName = options.strength === 'absolute' ? '绝对驱散' : options.strength === 'strong' ? '强驱散' : '驱散';
    const removedNames = [
      ...result.removed.map((status) => buildStatusPresentationMember(status).name),
      ...barrierResult.removed.map((barrier) => barrier.displayName),
    ];
    if (removedNames.length > 0) {
      emitLog('info', `✨ 【${strengthName}】${target.name} 移除了【${[...new Set(removedNames)].join('】、【')}】。`);
    }
    if (result.blocked.length > 0) {
      const blockedNames = [...new Set(result.blocked.map((status) => buildStatusPresentationMember(status).name))];
      emitLog('info', `🔒 【驱散受阻】${target.name} 的【${blockedNames.join('】、【')}】不受本次${strengthName}影响。`);
    }
    if (removedAirborne.length > 0 && (options.strength === 'strong' || options.strength === 'absolute')) {
      emitLog('info', `🚀 【提前落地】${target.name} 的击飞被${strengthName}提前解除，立即结算落地伤害！`);
      const landingRuntime = this.createStatusProcessingRuntime();
      landingRuntime.log = emitLog;
      resolveAirborneLanding(landingRuntime, target, removedAirborne[0]);
    }

    if (result.removed.length > 0 || barrierResult.removed.length > 0) {
      this.recordEvent('status', 'status_dispelled', `${target.name}:${options.strength}`, {
        targetIds: [target.id],
      });
    }
    return {
      removed: result.removed,
      blocked: result.blocked,
      removedBarriers: barrierResult.removed,
      blockedBarriers: barrierResult.blocked,
    };
  }

  initializeYuzuOpeningShields(): void {
    const runtime = this.createCharacterHookRuntime();
    this.fighters.forEach((fighter) => {
      if (fighter.isYuzu) ensureYuzuOpeningShield(runtime, fighter);
    });
  }

  createStatusMechanicsRuntime(): StatusMechanicsRuntime {
    return {
      fighters: this.fighters,
      log: (type, text) => this.log(type, text),
      applyDamage: (target, amount, source, isTrueDamage, attacker, options) =>
        this.applyDamage(target, amount, source, isTrueDamage, attacker, options),
      markDefeated: (target, options) => this.markDefeated(target, options),
      flushDeferredDamageEvents: (fighter, phase) => this.flushDeferredDamageEvents(fighter, phase),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
    };
  }

  createOwlRuntime(): OwlRuntime {
    return {
      fighters: this.fighters,
      jobs: this.JOBS,
      turnCount: this.turnCount,
      getTeamId: (fighter) => this.getTeamId(fighter),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text, metadata) => this.log(type, text, metadata),
      syncHpPct: (fighter) => this.syncHpPct(fighter),
      applyDamage: (target, amount, source, isTrueDamage, attacker, options) =>
        this.applyDamage(target, amount, source, isTrueDamage, attacker, options),
      applyStatus: (target, application) => this.applyStatus(target, application),
      dispelStatusEffects: (target, options) => this.dispelStatusEffects(target, options),
      markDefeated: (target, options) => this.markDefeated(target, options),
      flushDeferredDamageEvents: (target, phase) => this.flushDeferredDamageEvents(target, phase),
    };
  }

  createMomoRuntime(logOverride?: (type: string, text: string, metadata?: BattleLogMetadata) => void): MomoRuntime {
    return {
      fighters: this.fighters,
      jobs: this.JOBS,
      turnCount: this.turnCount,
      getTeamId: (fighter) => this.getTeamId(fighter),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: logOverride ?? ((type, text, metadata) => this.log(type, text, metadata)),
      syncHpPct: (fighter) => this.syncHpPct(fighter),
      applyDamage: (target, amount, source, isTrueDamage, attacker, options) =>
        this.applyDamage(target, amount, source, isTrueDamage, attacker, options),
      applyStatus: (target, application) => this.applyStatus(target, application),
      dispelStatusEffects: (target, options) => this.dispelStatusEffects(target, options),
      markDefeated: (target, options) => this.markDefeated(target, options),
      flushDeferredDamageEvents: (fighter) => this.flushDeferredDamageEvents(fighter),
    };
  }

  initializeMomoTeams(): void {
    const runtime = this.createMomoRuntime();
    this.fighters.forEach((fighter) => {
      if (fighter.isMomo) initializeMomoTeam(runtime, fighter);
    });
  }

  initializeOwlStates(): void {
    this.fighters.forEach((fighter) => {
      if (fighter.isOwl) ensureOwlState(fighter, this.turnCount);
    });
  }

  getTeamId(f: Fighter): string {
    if (f.isMorphling || f.isSon) return f.teamId ?? 'WATER_TEAM';
    if (f.isSummon && f.summonerId) {
      const master = this.fighters.find((m) => m.id === f.summonerId);
      return master ? this.getTeamId(master) : f.summonerId;
    }
    return f.teamId ?? f.id;
  }

  triggerRaPhoenix(target: Fighter, options: DamageApplicationOptions): boolean {
    if (
      getSummonBaseName(target) !== '翼神龙' ||
      target.hasUsedRaPhoenix ||
      !hasStatus(target, GACHA_RA_PHOENIX_STATUS)
    ) {
      return false;
    }

    target.hasUsedRaPhoenix = true;
    removeEffects(target, { identityIds: [GACHA_RA_PHOENIX_STATUS], reason: 'consumed' });
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.32));
    this.syncHpPct(target);
    this.queueOrLogDamageEvent(
      target,
      options,
      'heal',
      `🔥 【神不死鸟】${target.name} 在致死瞬间化为太阳火焰复燃，恢复到 ${target.currentHp} 点生命！`,
      gachaReactionMetadata('summon_ra_rebirth', target, [target]),
    );

    this.queueOrRunDamageAction(target, options, () => {
      const enemies = this.fighters.filter((fighter) =>
        isSelectableTargetFor(this.createTargetingRuntime(), target, fighter),
      );
      this.runReactionAction(target, {
        skillId: 'summon_ra_phoenix_reaction',
        skillName: '神不死鸟',
        presentation: 'finisher',
        targets: enemies,
      }, () => {
        this.log('crit', `🔥 【神不死鸟】${target.name} 化作太阳火海，向 ${enemies.map((enemy) => enemy.name).join('、')} 发动复燃反扑！`, {
          actorId: target.id,
          actorName: target.name,
          targetIds: enemies.map((enemy) => enemy.id),
          visualCue: {
            kind: 'combat_action',
            sourceId: target.id,
            targetIds: enemies.map((enemy) => enemy.id),
            presentation: 'finisher',
            effectId: 'gacha_ra_phoenix',
          },
        });
        const phoenixDmg = Math.floor(
          getEffectiveCombatStat(target, 'mag', 'custom') * 2.8 +
          getEffectiveCombatStat(target, 'atk', 'custom') * 1.4,
        );
        for (const enemy of enemies) {
          if (!this.isActiveCombatant(target)) {
            this.log('info', `🔥 【神不死鸟】${target.name} 在反扑途中被击倒，余下的太阳火焰随之熄灭！`);
            break;
          }
          if (!isSelectableTargetFor(this.createTargetingRuntime(), target, enemy)) continue;
          const damageOptions: DamageApplicationOptions = {
            deferTransform: true,
            actionName: '神不死鸟',
            respectDefenses: true,
            canTriggerWaitCounter: false,
            sourceKind: 'counter',
          };
          const actualDmg = this.applyDamage(enemy, phoenixDmg, 'skill', true, target, damageOptions);
          this.flushDeferredDamageEvents(enemy, 'mitigation');
          if (actualDmg > 0) {
            this.log('crit', `🔥 【神不死鸟】太阳火焰反扑 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`, {
              actorId: target.id,
              actorName: target.name,
              targetIds: [enemy.id],
            });
          } else if (this.isActiveCombatant(target)) {
            this.log('info', `🔥 【神不死鸟】火焰扫过 ${enemy.name}，但没有造成实际伤害！`, {
              actorId: target.id,
              actorName: target.name,
              targetIds: [enemy.id],
            });
          }
          if (actualDmg > 0 || (enemy.pendingDamageEvents?.length ?? 0) > 0) {
            this.flushDeferredDamageEvents(enemy);
          }
          if (enemy.currentHp <= 0 && !enemy.isDead && !enemy.isDeadAnnounced) {
            this.markDefeated(enemy, { message: `💀 【神不死鸟】${enemy.name} 被翼神龙的复燃火焰吞没！`, killer: target });
          }
        }
      });
    });

    return true;
  }

  triggerTokusatsuThroneFromDamage(
    target: Fighter,
    amount: number,
    source: string,
    attacker: Fighter | undefined,
    options: DamageApplicationOptions,
  ): number {
    if (amount <= 0) return amount;
    if (options.canTriggerWaitCounter === false) return amount;
    if (!target.isTokusatsu || target.counterUsed || !hasStatus(target, 'WAIT_COUNTER')) return amount;
    if (!attacker || attacker.id === target.id || this.getTeamId(attacker) === this.getTeamId(target)) return amount;
    if (source !== 'skill' && source !== 'counter') return amount;

    const actionText = options.actionName ? `【${options.actionName}】` : getDamageSourceLabel(source);
    this.log('info', `⚔️ ${attacker.name} 的${actionText}波及坐在【武神王座】上的 ${target.name}，触发等待反击判定！`);
    enterTokusatsuMonsterForm(target, this.createCharacterHookRuntime(), attacker, 0);

    const reducedAmount = Math.floor(amount * 0.25);
    const blocked = Math.max(0, amount - reducedAmount);
    this.log('info', `🪑 【武神王座】${target.name} 的怪兽形态压碎来袭攻势，削减 ${blocked} 点伤害，余波只剩 ${reducedAmount} 点！`);
    return reducedAmount;
  }

  grantTokusatsuHeavyDamageResonance(target: Fighter, actualDmg: number, source: string, options: DamageApplicationOptions): void {
    if (actualDmg <= 0 || target.currentHp <= 0 || !canUseTokusatsuThrone(target)) return;
    if (source !== 'skill' && source !== 'counter' && source !== 'reflect') return;
    if (actualDmg < target.maxHp * 0.16) return;

    const before = target.tokusatsuThroneResonance ?? 0;
    const after = addTokusatsuThroneResonance(target, 1);
    if (after > before && after >= 2) {
      this.queueOrLogDamageEvent(target, options, 'buff', `🪑 【悲愿共鸣】${target.name} 承受重创，王座共鸣 ${after}/${TOKUSATSU_THRONE_RESONANCE_MAX}！`);
    }
  }

  triggerTokusatsuDefiance(target: Fighter, options: DamageApplicationOptions): boolean {
    if (
      !target.isTokusatsu ||
      target.job !== 'MIRACLE_MONSTER_BUJIN' ||
      target.hasUsedTokusatsuDefiance ||
      target.isDead ||
      target.isDeadAnnounced
    ) {
      return false;
    }

    target.hasUsedTokusatsuDefiance = true;
    target.tokusatsuInstantActionQueued = true;
    restoreZeroedStatsIfNeeded(target);
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.13));
    this.queueOrLogDamageEvent(target, options, 'buff', `🔥 【悲愿不倒】${target.name} 的奇迹怪兽武刃拒绝退场！强行恢复到 ${target.currentHp}/${target.maxHp}，怨火开始清除异常并准备立刻反扑！`);
    this.dispelStatusEffects(target, {
      strength: 'strong',
      direction: 'negative',
      emitLog: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
    });
    applyStatus(target, { identityId: 'TOKUSATSU_DEFIANCE', remainingTurns: 1 });
    applyStatus(target, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_defiance' } });
    applyStatus(target, { identityId: 'REGEN', remainingTurns: 2 });
    applyPermanentStatBuff(target, { atk: 1.02, mag: 1.02, spd: 1.01 });
    this.syncHpPct(target);
    options.suppressOnHitStatuses = true;
    return true;
  }

  triggerGamerContinue(target: Fighter, options: DamageApplicationOptions): boolean {
    if (
      !target.isGamer ||
      target.isSon ||
      target.job !== 'ALL_PLATFORM_CHAMPION' ||
      target.hasUsedGamerContinue ||
      target.isDead ||
      target.isDeadAnnounced
    ) {
      return false;
    }

    target.hasUsedGamerContinue = true;
    restoreZeroedStatsIfNeeded(target);
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.25));
    this.queueOrLogDamageEvent(target, options, 'buff', `🎮 【CONTINUE?】${target.name} 在败北判定前完成最后一帧续关，恢复到 ${target.currentHp}/${target.maxHp}，开始重置异常与操作状态！`);
    this.dispelStatusEffects(target, {
      strength: 'strong',
      direction: 'negative',
      emitLog: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
    });
    target.apm = Math.max(8, target.apm ?? 0);
    target.gamerInputBuffer = Math.max(1, target.gamerInputBuffer ?? 0);
    target.gamerClutchWindow = Math.max(2, target.gamerClutchWindow ?? 0);
    target.gamerBoostReady = true;
    target.gamerInstantActionQueued = false;
    applyStatus(target, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_continue' } });
    applyStatus(target, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'gamer_continue' } });
    applyStatus(target, { identityId: 'AIM', charges: 1 });
    applyStatus(target, { identityId: 'REGEN', remainingTurns: 2 });
    this.syncHpPct(target);
    options.suppressOnHitStatuses = true;
    this.queueOrLogDamageEvent(target, options, 'buff', `🎮 【续关完成】${target.name} 的 APM 拉回 ${target.apm}，保住下一次操作机会！`);
    return true;
  }

  clampPersistentDeathSaveDamage(
    target: Fighter,
    amount: number,
    options: DamageApplicationOptions,
  ): number {
    if (amount < target.currentHp || target.isDead || target.isDeadAnnounced) return amount;

    const activeSave = [...ACTIVE_DEATH_SAVE_STATUS_TYPES]
      .map((identityId) => findIdentity(target, identityId))
      .find((status) => !!status);
    if (activeSave) {
      options.phaseLockTriggered = true;
      options.lockbloodLabel = activeSave.identityId === 'TING_DEFIANCE' ? '不甘倒下' : '悲愿不倒';
      this.queueOrLogDamageEvent(
        target,
        options,
        'info',
        activeSave.identityId === 'TING_DEFIANCE'
          ? `🩸 ${target.name} 仍处于【不甘倒下】，怨念把致死伤害强行压回 1 点生命！`
          : `🔥 ${target.name} 仍处于【悲愿不倒】，奇迹怪兽武刃把致死伤害强行压回 1 点生命！`,
        undefined,
        'aftermath',
      );
      return Math.max(0, target.currentHp - 1);
    }

    if (
      target.isTing &&
      target.transformed &&
      !target.hasTriggeredTingDefiance
    ) {
      options.phaseLockTriggered = true;
      options.lockbloodLabel = '不甘倒下';
      target.hasTriggeredTingDefiance = true;
      applyStatus(target, { identityId: 'TING_DEFIANCE', remainingTurns: TING_DEFIANCE_DURATION });
      applyPermanentStatBuff(target, { atk: 1.2, mag: 1.2, spd: 1.15 });
      this.queueOrLogDamageEvent(
        target,
        options,
        'buff',
        `🩸 【不甘倒下】${target.name} 被怨念强行钉在 1 点生命，拒绝退场！`,
        undefined,
        'aftermath',
      );
      return Math.max(0, target.currentHp - 1);
    }

    return amount;
  }

  createCharacterHookRuntime(): CharacterHookRuntime {
    return buildCharacterHookRuntime(this);
  }

  createTargetingRuntime(): TargetingRuntime {
    return buildTargetingRuntime(this);
  }

  createDamageResolutionRuntime(): DamageResolutionRuntime {
    return buildDamageResolutionRuntime(this);
  }

  createStatusProcessingRuntime(): StatusProcessingRuntime {
    return buildStatusProcessingRuntime(this);
  }

  createSummonResolutionRuntime(): SummonResolutionRuntime {
    return buildSummonResolutionRuntime(this);
  }

  createSupportResolutionRuntime(): SupportResolutionRuntime {
    return buildSupportResolutionRuntime(this);
  }

  createActionResolutionRuntime(): ActionResolutionRuntime {
    return buildActionResolutionRuntime(this);
  }

  createTurnFlowRuntime(): TurnFlowRuntime {
    return buildTurnFlowRuntime(this);
  }

  createPuruisaishiRuntime(): PuruisaishiRuntime {
    return {
      fighters: this.fighters,
      core: this.Core,
      turnCount: this.turnCount,
      largeRound: this.battleState.largeRound.number,
      completedLargeRound: this.battleState.completedLargeRound,
      largeRoundParticipantIds: [...this.battleState.largeRound.participantIds],
      largeRoundActedIds: [...this.battleState.largeRound.actedIds],
      log: (type, text, metadata) => this.log(type, text, metadata),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      syncHpPct: (fighter) => this.syncHpPct(fighter),
      applyDamage: (target, amount, source, isTrueDamage, attacker, options) =>
        this.applyDamage(target, amount, source, isTrueDamage, attacker, options),
      flushDeferredDamageEvents: (fighter, phase) => this.flushDeferredDamageEvents(fighter, phase),
      markDefeated: (target, options) => this.markDefeated(target, options),
    };
  }

  maybeEnterGamerWorldStage(fighter: Fighter, reason: string, options: DamageApplicationOptions = {}): void {
    if (!isOriginalGamer(fighter) || fighter.job !== 'ALL_PLATFORM_CHAMPION' || fighter.hasUsedGamerWorldStage) return;
    if ((fighter.apm ?? 0) < GAMER_WORLD_STAGE_THRESHOLD) return;

    fighter.hasUsedGamerWorldStage = true;
    fighter.gamerBoostReady = true;
    applyStatus(fighter, { identityId: 'GAMER_WORLD_STAGE', remainingTurns: GAMER_WORLD_STAGE_DURATION });
    applyStatus(fighter, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'gamer_world_stage' } });
    this.queueOrLogDamageEvent(fighter, options, 'crit', `🏆 【世界赛舞台】${fighter.name} APM 拉到 ${fighter.apm ?? 0}/${GAMER_APM_MAX}，${reason}，所有冠军技能短暂进入强化版！`);
  }

  grantGamerApm(fighter: Fighter, amount: number, reason: string, options: DamageApplicationOptions = {}): void {
    if (!isOriginalGamer(fighter) || amount <= 0) return;
    const before = fighter.apm ?? 0;
    fighter.apm = Math.min(GAMER_APM_MAX, before + amount);
    if (fighter.apm <= before) return;
    if (fighter.job === 'ALL_PLATFORM_CHAMPION' && before < GAMER_WORLD_STAGE_THRESHOLD && fighter.apm >= GAMER_WORLD_STAGE_THRESHOLD) {
      this.maybeEnterGamerWorldStage(fighter, reason, options);
    }
  }

  grantGamerDamageReward(attacker: Fighter | undefined, actualDmg: number, target: Fighter, options: DamageApplicationOptions): void {
    if (!isOriginalGamer(attacker) || actualDmg <= 0 || !this.isActiveCombatant(attacker)) return;
    if (attacker.job === 'ALL_PLATFORM_CHAMPION') return;
    if (attacker.gamerDamageRewardTurn === this.turnCount) return;
    const meaningfulDamage = Math.max(260, Math.floor(target.maxHp * 0.08));
    if (actualDmg < meaningfulDamage) return;

    attacker.gamerDamageRewardTurn = this.turnCount;
    this.grantGamerApm(attacker, 1, '通过有效伤害把节奏续上', options);
  }

  grantGamerHeavyHitReward(target: Fighter, actualDmg: number, attacker: Fighter | undefined, source: string, options: DamageApplicationOptions): void {
    if (!isOriginalGamer(target) || target.job !== 'ALL_PLATFORM_CHAMPION' || actualDmg <= 0 || source === 'status') return;
    if (hasStatus(target, 'GAMER_WORLD_STAGE')) return;
    if (target.gamerHeavyHitRewardTurn === this.turnCount) return;
    if (actualDmg < target.maxHp * 0.16) return;

    target.gamerHeavyHitRewardTurn = this.turnCount;
    if (attacker && attacker.id !== target.id) {
      target.gamerMarkedTargetId = attacker.id;
      target.gamerClutchWindow = Math.max(target.gamerClutchWindow ?? 0, 2);
    }
    this.grantGamerApm(target, 1, '被重创后读到对手习惯', options);
    this.queueOrLogDamageEvent(target, options, 'buff', `🎮 【游戏理解】${target.name} 被重创后没有断线，反而读到对手习惯，APM +1！（当前 ${target.apm ?? 0}/${GAMER_APM_MAX}）`);
  }

  grantGamerKillMomentum(killer: Fighter, target: Fighter): void {
    if (!isOriginalGamer(killer) || killer.job !== 'ALL_PLATFORM_CHAMPION' || !this.isActiveCombatant(killer)) return;

    killer.gamerClutchWindow = Math.max(killer.gamerClutchWindow ?? 0, 3);
    killer.gamerInputBuffer = Math.min(3, (killer.gamerInputBuffer ?? 0) + 1);
    applyStatus(killer, { identityId: 'AIM', charges: 1 });
    this.grantGamerApm(killer, 1, '击杀后进入收割节奏');
    this.log('buff', `🎮 【击杀滚动】${killer.name} 击败 ${target.name} 后进入残局处理，APM +1，输入缓存 +1！（当前 ${killer.apm ?? 0}/${GAMER_APM_MAX}）`);
  }

  settleDamageRecord(
    target: Fighter,
    attacker: Fighter | undefined,
    source: string,
    attempted: number,
    hpDamage: number,
    shieldDamage: number,
    overkillDamage: number,
    options: DamageApplicationOptions,
    outcome: DamageResolutionOutcome = hpDamage > 0 ? 'hp_damage' : shieldDamage > 0 ? 'shielded' : 'prevented',
  ): DamageResolutionRecord {
    const sourceKind = options.sourceKind ?? inferDamageSourceKind(source, options);
    const resolution: DamageResolutionRecord = {
      rootEventId: options.rootEventId ?? this.causalScopeStack[0] ?? this.actionStack[0]?.id,
      attempted: Math.max(0, Math.floor(attempted)),
      hpDamage: Math.max(0, Math.floor(hpDamage)),
      shieldDamage: Math.max(0, Math.floor(shieldDamage)),
      barrierAbsorptions: options.barrierAbsorptions?.map((entry) => ({ ...entry })),
      overkillDamage: Math.max(0, Math.floor(overkillDamage)),
      outcome,
      source,
      sourceKind,
      originSourceKind: options.originSourceKind ?? sourceKind,
      damageScope: options.damageScope,
      actionName: options.actionName,
      attackerId: attacker?.id,
      originalTargetId: options.originalTargetId ?? target.id,
      targetId: target.id,
      actualTargetId: target.id,
      statusHitIndex: options.statusHitIndex,
      statusHitCount: options.statusHitCount,
      phaseLockTriggered: options.phaseLockTriggered,
      lockbloodLabel: options.lockbloodLabel,
    };
    options.resolution = resolution;
    recordDamageSettlement(target, attacker, resolution, options.creditAttacker ?? true);
    const event = this.recordEvent('damage', 'damage', `${attacker?.name ?? '环境'} -> ${target.name}`, {
      actorId: attacker?.id,
      actorName: attacker?.name,
      targetIds: [target.id],
      damage: resolution,
    });
    resolution.eventId = event.id;
    if (!resolution.rootEventId) resolution.rootEventId = event.id;
    options.eventId = event.id;
    options.rootEventId = resolution.rootEventId;
    return resolution;
  }

  applyDamage(
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage = false,
    attacker?: Fighter,
    options: DamageApplicationOptions = {},
  ): number {
    amount = Math.max(0, Math.floor(amount));
    if (amount <= 0 || target.isDead || target.currentHp <= 0) return 0;
    if (hasStatus(target, 'SYNERGY_SLACKING')) return 0;
    const phaseIdentityBeforeDamage = fighterPhaseIdentity(target);
    options.sourceKind = options.sourceKind ?? inferDamageSourceKind(source, options);
    options.originSourceKind = options.originSourceKind ?? options.sourceKind;
    options.rootEventId = options.rootEventId ?? this.causalScopeStack[0] ?? this.actionStack[0]?.id;
    options.originalTargetId = options.originalTargetId ?? target.id;

    const activeAction = this.actionStack[this.actionStack.length - 1];
    if (
      activeAction &&
      activeAction.actorId === attacker?.id &&
      activeAction.skillId !== 'owl_crossing_assist' &&
      !options.suppressOwlCooperation &&
      source === 'skill' &&
      target.id !== attacker?.id &&
      activeAction.primaryTargetId === undefined
    ) {
      activeAction.primaryTargetId = target.id;
      activeAction.primaryPreDefenseDamage = amount;
    }

    if (target.owlSummonState?.kind === 'meal' || target.owlSummonState?.kind === 'rice') {
      this.log('info', `🍚 ${target.name} 是不可选中的食物单位，这次伤害没有作用。`);
      this.settleDamageRecord(target, attacker, source, amount, 0, 0, 0, options, 'prevented');
      return 0;
    }

    if (!options.bypassOwlOutgoingModifier) {
      const beforeOwlFormation = amount;
      amount = Math.max(1, Math.floor(amount * getOwlOutgoingMultiplier(attacker)));
      if (attacker && amount !== beforeOwlFormation) {
        const formationName = getOwlWarFormDisplayName(attacker) ?? '天意阵势';
        this.queueOrLogDamageEvent(
          target,
          options,
          'buff',
          `🦉 【${formationName}】${attacker.name} 的天意阵势使本次攻击由 ${beforeOwlFormation} 调整为 ${amount}。`,
          undefined,
          'mitigation',
        );
      }
    }
    if (attacker && isDirectDamageKind(options.sourceKind)) {
      const beforeOutgoingStatuses = amount;
      const outgoingMultiplier = getOutgoingDirectStatusMultiplier(attacker, options.sourceKind, options.damageScope, 'post_formula');
      amount = Math.max(1, Math.floor(amount * outgoingMultiplier));
      if (amount !== beforeOutgoingStatuses) {
        this.queueOrLogDamageEvent(
          target,
          options,
          amount > beforeOutgoingStatuses ? 'buff' : 'debuff',
          `⚔️ 【输出状态】${attacker.name} 的威势或衰弱使本次直接攻击由 ${beforeOutgoingStatuses} 调整为 ${amount}。`,
          undefined,
          'mitigation',
        );
      }
      const beforeMorale = amount;
      amount = Math.max(1, Math.floor(amount * getMoraleDamageMultiplier(attacker)));
      if (amount < beforeMorale) {
        this.queueOrLogDamageEvent(
          target,
          options,
          'debuff',
          `🫧 【士气低迷】${attacker.name} 当前士气仅 ${attacker.morale ?? 0}/${attacker.maxMorale ?? 100}，直接攻击由 ${beforeMorale} 降低至 ${amount}。`,
          undefined,
          'mitigation',
        );
      }
    }
    const charmStatus = attacker
      ? findIdentity(attacker, 'CHARMED', { applierIds: [target.id] })
      : undefined;
    if (
      charmStatus &&
      attacker &&
      source !== 'status' &&
      source !== 'transfer' &&
      source !== 'yuzu_share' &&
      attacker.id !== target.id
    ) {
      const beforeCharm = amount;
      amount = Math.max(1, Math.floor(amount * 0.4));
      this.log('info', `😍 【魅惑牵制】${attacker.name} 无法对 ${target.name} 彻底下狠手，伤害由 ${beforeCharm} 降至 ${amount}！`);
    }
    if (source !== 'status' && hasStatus(target, 'WT_REPAIRING')) {
      const beforeRepairExposure = amount;
      amount = Math.max(1, Math.floor(amount * WT_REPAIRING_PROFILE.incomingDamageMultiplier));
      this.queueOrLogDamageEvent(
        target,
        options,
        'info',
        `🔧 【抢修暴露】${target.name} 停车维修无法规避火力，来袭伤害由 ${beforeRepairExposure} 放大至 ${amount}！`,
        undefined,
        'mitigation',
      );
    }
    const attemptedDamage = amount;
    let shieldDamage = 0;

    // Attacker-side modifiers are already final at this point. Emit them before
    // target redirection, mitigation, barriers, or settlement can describe the result.
    this.flushDeferredDamageEvents(target, 'mitigation');

    if (target.isOwl && !options.bypassOwlEmperorRedirect) {
      const emperor = findOwlEmperor(this.createOwlRuntime(), target);
      if (emperor) {
        const emperorOptions: DamageApplicationOptions = {
          deferTransform: options.deferTransform,
          actionName: options.actionName,
          respectDefenses: options.respectDefenses,
          creditAttacker: options.creditAttacker,
          rootEventId: options.rootEventId,
          originalTargetId: options.originalTargetId,
          originSourceKind: options.originSourceKind,
          damageScope: options.damageScope,
          statusHitCount: options.statusHitCount,
          statusHitIndex: options.statusHitIndex,
          suppressStatusAftermath: options.suppressStatusAftermath,
          bypassOwlEmperorRedirect: true,
          bypassOwlOutgoingModifier: true,
          suppressOwlCooperation: true,
        };
        const redirectedDamage = this.applyDamage(
          emperor,
          amount,
          'owl_redirect',
          isTrueDamage,
          attacker,
          emperorOptions,
        );
        options.redirectedByOwlEmperor = true;
        options.redirectedOwlEmperorDamage = redirectedDamage;
        this.log('info', `🐲 【帝王之征】${target.name} 将 ${amount} 点来袭伤害全部转给 ${emperor.name}，龙实际承受 ${redirectedDamage} 点！`);
        if (redirectedDamage > 0 || (emperor.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(emperor);
        if (emperor.currentHp <= 0 && !emperor.isDead && !emperor.isDeadAnnounced) {
          this.markDefeated(emperor, {
            message: `💀 【帝王之征】${emperor.name} 替 ${target.name} 承受致命伤后倒下！`,
            killer: attacker,
          });
        }
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, 0, 0, options, 'redirected');
        return 0;
      }
    }

    const originiumRedirect = redirectOriginiumCoreDamage(
      this.createPuruisaishiRuntime(),
      target,
      amount,
      source,
      isTrueDamage,
      attacker,
      options,
    );
    if (originiumRedirect.handled) {
      this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, 0, 0, options, 'redirected');
      return 0;
    }

    if (
      target.isYuzu &&
      (target.yuzuPhase ?? 1) >= 3 &&
      attacker &&
      attacker.id !== target.id &&
      this.getTeamId(attacker) !== this.getTeamId(target) &&
      source !== 'status' &&
      source !== 'yuzu_share'
    ) {
      const runtime = this.createCharacterHookRuntime();
      const marked = ensureYuzuMarkedTarget(runtime, target);
      if (marked && marked.id !== attacker.id) {
        const beforeUniqueTarget = amount;
        amount = Math.max(1, Math.floor(amount * YUZU_UNMARKED_INCOMING_DAMAGE_MULTIPLIER));
        const reducedDamage = beforeUniqueTarget - amount;
        if (reducedDamage > 0) {
          this.log('info', `🪞 【唯一目标】${target.name} 只承认 ${marked.name} 的苦痛，来自 ${attacker.name} 的伤害被镜界偏折 ${reducedDamage} 点，剩余 ${amount} 点继续结算。`);
        }
      }
    }

    if (options.respectDefenses) {
      if (target.owlSummonState?.kind === 'zhao_adou' && source !== 'status') {
        this.log('info', `🏇 【七进七出】${target.name} 以 100% 闪避穿过攻击，没有受到伤害！`);
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, 0, 0, options, 'invulnerable');
        return 0;
      }
      const invul = findDefenseStatus(target, 'INVUL');
      if (invul) {
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', formatInvul(invul, target.name, incomingSource));
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, 0, 0, options, 'invulnerable');
        return 0;
      }

      const spellBlock = findIdentity(target, 'SPELL_BLOCK');
      if (spellBlock && (source === 'skill' || source === 'transfer')) {
        consumeSpellBlock(target);
        const healing = resolveHealing(target, Math.floor(target.maxHp * 0.15), {}, (type, text) => this.log(type, text));
        const healText = healing.actual > 0
          ? `，并恢复了 ${healing.actual} 点生命`
          : healing.outcome === 'blocked'
            ? '，但附带治疗被完全阻止'
            : '，但生命已满，治疗溢出';
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', formatSpellBlock(spellBlock, target.name, incomingSource, healText));
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, 0, 0, options, 'spell_blocked');
        return 0;
      }
    }

    if (target.jobData?.name === '欧皇' && !isTrueDamage) amount = Math.floor(amount * 0.63);
    if (
      target.isWT &&
      target.transformed &&
      hasStatus(target, 'WT_ERA') &&
      source !== 'status'
    ) {
      const eraMultiplier = source === 'reflect' || source === 'counter' ? 0.75 : (isTrueDamage ? 0.88 : 0.79);
      amount = Math.max(1, Math.floor(amount * eraMultiplier));
    }

    if (target.job === 'EXPLOSIVE_ANTI_CROC' && attacker && attacker.id !== target.id && source !== 'status') {
      amount = Math.max(1, Math.floor(amount * 0.72));
    }

    if (
      target.isEmote &&
      attacker &&
      attacker.id !== target.id &&
      !attacker.isSummon &&
      source !== 'status' &&
      hasStatus(target, 'EMOTE_ADAPT')
    ) {
      const beforeAdapt = amount;
      amount = Math.max(1, Math.floor(amount * 0.7));
      removeEffects(target, { identityIds: ['EMOTE_ADAPT'], reason: 'consumed' });
      const gain = grantEmoteAdaptStats(target, attacker, 0.03);
      const reducedDamage = beforeAdapt - amount;
      const reductionText = reducedDamage > 0
        ? `削减 ${reducedDamage} 点伤害`
        : '这次伤害已处于最低值，无法继续削减';
      this.queueOrLogDamageEvent(
        target,
        options,
        'buff',
        `🧿 【适应转轮】${target.name} 记录 ${attacker.name} 的攻击模式，${reductionText}，并复制 3% 属性（${formatEmoteStats(gain)}）；${attacker.name} 属性不降低。`,
        undefined,
        'mitigation',
      );
    }

    if (target.isYuzu && source !== 'status') {
      const phase = target.yuzuPhase ?? 1;
      const reduction = phase >= 3 ? YUZU_PHASE_THREE_REDUCTION : phase === 1 ? YUZU_PHASE_ONE_REDUCTION : 0;
      if (reduction > 0) {
        const beforeYuzuReduction = amount;
        amount = Math.max(1, Math.floor(amount * (1 - reduction)));
        const reducedDamage = beforeYuzuReduction - amount;
        if (reducedDamage > 0) {
          this.queueOrLogDamageEvent(
            target,
            options,
            'info',
            `🪞 【镜界减伤】${target.name} 处于第 ${phase} 阶段，削减 ${reducedDamage} 点伤害。`,
            undefined,
            'mitigation',
          );
        }
      }
    }

    if (target.isOwl && !options.bypassOwlIncomingModifier) {
      const incomingMultiplier = getOwlIncomingMultiplier(target);
      if (incomingMultiplier < 1) {
        const beforeOwlReduction = amount;
        amount = Math.max(1, Math.floor(amount * incomingMultiplier));
        const reduced = beforeOwlReduction - amount;
        if (reduced > 0) {
          const state = ensureOwlState(target, this.turnCount);
          const sourceName = state.warForm === 'defeat'
            ? '败兵阵势'
            : hasStatus(target, 'OWL_EAR_GUARD')
              ? '扎耳警觉'
              : '不怕酸';
          this.queueOrLogDamageEvent(
            target,
            options,
            'info',
            `🦉 【${sourceName}】${target.name} 削减 ${reduced} 点伤害，剩余 ${amount} 点继续结算。`,
            undefined,
            'mitigation',
          );
        }
      }
    }

    if (isDirectDamageKind(options.sourceKind)) {
      const statusMultiplier = getIncomingDirectStatusMultiplier(target, options.sourceKind, options.damageScope);
      if (statusMultiplier !== 1) {
        const beforeStatusModifier = amount;
        amount = Math.max(1, Math.floor(amount * statusMultiplier));
        const direction = amount >= beforeStatusModifier ? '放大' : '降低';
        this.queueOrLogDamageEvent(
          target,
          options,
          amount >= beforeStatusModifier ? 'debuff' : 'buff',
          `🩹 【状态承伤修正】${target.name} 的易损、防护或踉跄使来袭伤害由 ${beforeStatusModifier} ${direction}至 ${amount}。`,
          undefined,
          'mitigation',
        );
      }
    }

    // All target-side numeric modifiers must be visible before a barrier reports
    // the amount it absorbed.
    this.flushDeferredDamageEvents(target, 'mitigation');

    const barrierResult = options.bypassShields
      ? { absorbed: 0, remaining: amount, broken: [], touched: [], absorptions: [] }
      : consumeBarriers(target, amount, { excludeIdentityIds: [PURUISAISHI_BARRIER_IDENTITY] });
    options.barrierAbsorptions = barrierResult.absorptions.map(({ barrier, amount: absorbedAmount }) => ({
      barrierId: barrier.id,
      sourceId: barrier.sourceId,
      displayName: barrier.displayName,
      amount: absorbedAmount,
      applierId: barrier.attribution?.applierId,
      applierName: barrier.attribution?.applierName,
    }));
    const shieldResult = {
      absorbed: barrierResult.absorbed,
      remaining: barrierResult.remaining,
      broke: barrierResult.broken.some((barrier) =>
        barrier.identityId === YUZU_BARRIER_IDENTITY,
      ),
    };
    if (shieldResult.absorbed > 0) {
      shieldDamage += shieldResult.absorbed;
      const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
      const barrierNames = [...new Set(barrierResult.touched.map((barrier) => barrier.displayName))];
      this.log('info', `🔵 【${barrierNames.join('、') || '屏障'}】${target.name} 的屏障挡下 ${incomingSource} 的 ${shieldResult.absorbed} 点伤害，屏障剩余 ${getBarrierTotal(target)}。`);
      amount = shieldResult.remaining;
      if (
        shieldResult.broke &&
        target.isYuzu &&
        (target.yuzuPhase ?? 1) === 2 &&
        !hasAnyYuzuTeammate(this.createCharacterHookRuntime(), target)
      ) {
        enterYuzuPhaseThree({
          fighters: this.fighters,
          turnCount: this.turnCount,
          getTeamId: (fighter) => this.getTeamId(fighter),
          isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
          log: (type, text, metadata) => this.log(type, text, metadata),
          syncHpPct: (fighter) => this.syncHpPct(fighter),
          runReactionAction: (actor, descriptor, callback) => this.runReactionAction(actor, descriptor, callback),
        }, target, '个人战护盾被击碎，溢出伤害被镜界无效化');
        this.syncHpPct(target);
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'shielded');
        return 0;
      }
      if (amount <= 0) {
        this.syncHpPct(target);
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'shielded');
        return 0;
      }
    }

    if (
      target.isMomo &&
      ensureMomoState(target).phase >= 2 &&
      attacker &&
      attacker.id !== target.id &&
      source !== 'momo_cost' &&
      source !== 'momo_share' &&
      source !== 'yuzu_share'
    ) {
      const captains = activeMomoShareCaptains(this.createMomoRuntime(), target);
      const shares = splitDamageAcrossTargets(amount, captains.length);
      if (captains.length > 0 && shares.length > 0) {
        const sharingCaptains = captains.filter((_, index) => (shares[index] ?? 0) > 0);
        this.log('info', `💗 【|OMO】${target.name} 将 ${amount} 点有效伤害均摊给 ${sharingCaptains.map((captain) => captain.name).join('、')}，自己不承受本次伤害。`);
        let actualShared = 0;
        const sharedTargetIds: string[] = [];
        const defeatedTargetIds: string[] = [];
        captains.forEach((captain, index) => {
          const share = shares[index] ?? 0;
          if (share <= 0) return;
          const shareOptions: DamageApplicationOptions = {
            deferTransform: true,
            actionName: '|OMO伤害均摊',
            respectDefenses: false,
            rootEventId: options.rootEventId,
            originalTargetId: options.originalTargetId,
            originSourceKind: options.originSourceKind,
            damageScope: options.damageScope,
            statusHitCount: options.statusHitCount,
            statusHitIndex: options.statusHitIndex,
            suppressStatusAftermath: options.suppressStatusAftermath,
            bypassOwlEmperorRedirect: true,
            bypassOwlOutgoingModifier: true,
            suppressOwlCooperation: true,
          };
          const actual = this.applyDamage(captain, share, 'momo_share', true, attacker, shareOptions);
          this.flushDeferredDamageEvents(captain, 'mitigation');
          actualShared += actual;
          sharedTargetIds.push(captain.id);
          const settlement = shareOptions.resolution;
          const shieldText = settlement?.shieldDamage ? `，护盾吸收 ${settlement.shieldDamage} 点` : '';
          const hpText = settlement?.hpDamage ? `，生命实际损失 ${settlement.hpDamage} 点` : '，生命没有损失';
          this.log('info', `📌 【|OMO结算】${captain.name} 分得 ${share} 点伤害${shieldText}${hpText}。`);
          if (actual > 0 || (captain.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(captain);
          if (captain.currentHp <= 0 && !captain.isDead && !captain.isDeadAnnounced) {
            const defeated = this.markDefeated(captain, {
              message: `💀 【|OMO】${captain.name} 替 ${target.name} 分担伤害后倒下！`,
              killer: attacker,
            });
            if (defeated) defeatedTargetIds.push(captain.id);
          }
        });
        options.redirectedByMomo = true;
        options.redirectedMomoDamage = actualShared;
        options.redirectedMomoTargetIds = sharedTargetIds;
        options.redirectedMomoDefeatedTargetIds = defeatedTargetIds;
        if (defeatedTargetIds.length > 0) options.targetDefeatedDuringDamage = true;
        options.suppressOnHitStatuses = true;
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'redistributed');
        this.syncHpPct(target);
        return 0;
      }
    }

    if (target.isYuzu && source !== 'status' && source !== 'yuzu_share' && source !== 'momo_share') {
      const allies = pickRandomFighters(activeYuzuTeammates(this.createCharacterHookRuntime(), target), 3);
      const shareTotal = Math.floor(amount * YUZU_TEAM_SHARE_RATIO);
      const shares = splitDamageAcrossTargets(shareTotal, allies.length);
      const actualSharedTotal = shares.reduce((sum, share) => sum + share, 0);
      if (actualSharedTotal > 0) {
        const sharingAllies = allies.filter((_, index) => (shares[index] ?? 0) > 0);
        let actualSharedHpDamage = 0;
        const sharedTargetIds: string[] = [];
        const defeatedTargetIds: string[] = [];
        amount = Math.max(0, amount - actualSharedTotal);
        this.log('info', `🪞 【镜界分摊】${target.name} 把 ${actualSharedTotal} 点伤害随机均摊给 ${sharingAllies.map((ally) => ally.name).join('、')}，自己承受 ${amount} 点。`);
        allies.forEach((ally, index) => {
          const share = shares[index] ?? 0;
          if (share <= 0) return;
          sharedTargetIds.push(ally.id);
          const shareOptions: DamageApplicationOptions = {
            deferTransform: true,
            actionName: '镜界分摊',
            respectDefenses: false,
            rootEventId: options.rootEventId,
            originalTargetId: options.originalTargetId,
            originSourceKind: options.originSourceKind,
            damageScope: options.damageScope,
            statusHitCount: options.statusHitCount,
            statusHitIndex: options.statusHitIndex,
            suppressStatusAftermath: options.suppressStatusAftermath,
            bypassOwlOutgoingModifier: true,
          };
          const shared = this.applyDamage(ally, share, 'yuzu_share', true, attacker, shareOptions);
          actualSharedHpDamage += shared;
          this.flushDeferredDamageEvents(ally, 'mitigation');
          const settlement = shareOptions.resolution;
          if (settlement) {
            const shieldText = settlement.shieldDamage > 0 ? `，护盾吸收 ${settlement.shieldDamage} 点` : '';
            const hpText = settlement.hpDamage > 0 ? `，生命实际损失 ${settlement.hpDamage} 点` : '，生命没有损失';
            const overkillText = settlement.overkillDamage > 0 ? `，${settlement.overkillDamage} 点为溢出伤害` : '';
            this.log('info', `📌 【镜界分摊结算】${ally.name} 分得 ${share} 点伤害${shieldText}${hpText}${overkillText}。`);
          }
          if (shared > 0 || (ally.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(ally);
          if (ally.currentHp <= 0 && !ally.isDead && !ally.isDeadAnnounced) {
            const defeated = this.markDefeated(ally, {
              message: `💀 【镜界分摊】${ally.name} 替 ${target.name} 分担伤害后倒下！`,
              killer: attacker,
            });
            if (defeated) {
              defeatedTargetIds.push(ally.id);
              options.targetDefeatedDuringDamage = true;
            }
          }
        });
        options.redirectedByYuzu = true;
        options.redirectedYuzuDamage = actualSharedHpDamage;
        options.redirectedYuzuTargetIds = sharedTargetIds;
        options.redirectedYuzuDefeatedTargetIds = defeatedTargetIds;
        if (amount <= 0) {
          options.suppressOnHitStatuses = true;
          this.syncHpPct(target);
          this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'redistributed');
          return 0;
        }
      }
    }

    const puruisaishiDamageRuntime = this.createPuruisaishiRuntime();
    puruisaishiDamageRuntime.log = (type, text, metadata) => this.queueOrLogDamageEvent(
      target,
      options,
      type,
      text,
      metadata,
      'aftermath',
    );
    puruisaishiDamageRuntime.logMitigation = (type, text, metadata) => this.queueOrLogDamageEvent(
      target,
      options,
      type,
      text,
      metadata,
      'mitigation',
    );
    const puruisaishiBarrier = options.bypassShields
      ? { handled: false, absorbed: 0, remaining: amount, retreated: false, absorptions: [] }
      : consumePuruisaishiShield(puruisaishiDamageRuntime, target, amount);
    if (puruisaishiBarrier.handled) {
      shieldDamage += puruisaishiBarrier.absorbed;
      options.barrierAbsorptions = [
        ...(options.barrierAbsorptions ?? []),
        ...puruisaishiBarrier.absorptions.map(({ barrier, amount: absorbedAmount }) => ({
          barrierId: barrier.id,
          sourceId: barrier.sourceId,
          displayName: barrier.displayName,
          amount: absorbedAmount,
          applierId: barrier.attribution?.applierId,
          applierName: barrier.attribution?.applierName,
        })),
      ];
      amount = puruisaishiBarrier.remaining;
      if (puruisaishiBarrier.retreated || amount <= 0) {
        this.syncHpPct(target);
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'shielded');
        return 0;
      }
    }

    const isProtected =
      target.isMorphling || target.isJoker || target.isTokusatsu || target.isGacha ||
      target.isTing || target.isSuccubus || target.isSigua || target.isTuJuanJuan || target.isWT ||
      target.isOwl || target.isMomo ||
      (target.isYuzu && (target.yuzuPhase ?? 1) === 1);
    if (isProtected && !target.transformed && amount >= target.currentHp) {
      options.phaseLockTriggered = true;
      options.lockbloodLabel = '阶段锁血保护';
      amount = Math.max(0, target.currentHp - 1);
      this.queueOrLogDamageEvent(
        target,
        options,
        'info',
        `🛡️ ${target.name} 触发了锁血保护，强制保留最后 1 点生命！`,
        undefined,
        'aftermath',
        'phase-lockblood',
      );
      if (amount === 0) {
        this.syncHpPct(target);
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'lockblood');
        return 0;
      }
    }

    if (source === 'skill' && target.job === 'GOD_OF_TROLLS' && amount > 0 && Math.random() < 0.57) {
      if (hasStatus(target, 'WATER_PRISON')) {
        this.log('info', `💧 ${target.name} 被困在深渊水牢中，无法施展魔术转移伤害，必须硬吃！`);
      } else {
        const originalAmount = amount;
        amount = 0;
        const enemies = this.fighters.filter((f) =>
          isSelectableTargetFor(this.createTargetingRuntime(), target, f),
        );
        if (enemies.length > 0) {
          const victim = enemies[Math.floor(Math.random() * enemies.length)];
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('crit', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术完美闪避！并将伤害转移给了倒霉的 ${victim.name}！`);
          const transferOptions: DamageApplicationOptions = {
            deferTransform: true,
            actionName: options.actionName,
            respectDefenses: true,
            rootEventId: options.rootEventId,
            originalTargetId: options.originalTargetId,
            originSourceKind: options.originSourceKind,
            damageScope: options.damageScope,
            statusHitCount: options.statusHitCount,
            statusHitIndex: options.statusHitIndex,
            suppressStatusAftermath: options.suppressStatusAftermath,
            bypassOwlOutgoingModifier: true,
          };
          const transferredDmg = this.applyDamage(victim, originalAmount, 'transfer', isTrueDamage, attacker, transferOptions);
          const resolvedTransfer = getResolvedDamageTotal(transferredDmg, transferOptions);
          options.redirectedJokerDamage = resolvedTransfer;
          this.flushDeferredDamageEvents(victim, 'mitigation');
          if (transferOptions.redirectedByMomo) {
            this.log('info', resolvedTransfer > 0
              ? `🎭 转移伤害落在 ${victim.name} 后触发【|OMO】，舰长合计承受 ${resolvedTransfer} 点伤害，${victim.name} 本体未受伤！`
              : `🎭 转移伤害落在 ${victim.name} 后触发【|OMO】，但舰长均未损失生命！`);
          } else if (transferOptions.redirectedByOriginiumCore) {
            this.log('info', resolvedTransfer > 0
              ? `🎭 转移伤害落在 ${victim.name} 后被导入源石网络，源石结晶合计实际损失 ${resolvedTransfer} 点生命，${victim.name} 本体未受伤！`
              : `🎭 转移伤害落在 ${victim.name} 后被导入源石网络，但源石结晶均未损失生命！`);
          } else if (transferOptions.redirectedByOwlEmperor) {
            this.log('info', resolvedTransfer > 0
              ? `🎭 转移伤害落在 ${victim.name} 后被【帝王之征】接管，龙实际承受 ${resolvedTransfer} 点伤害，${victim.name} 本体未受伤！`
              : `🎭 转移伤害落在 ${victim.name} 后被【帝王之征】接管，但龙未损失生命！`);
          } else if (transferOptions.redirectedByYuzu) {
            this.log('info', resolvedTransfer > 0
              ? `🎭 转移伤害落在 ${victim.name} 后触发【镜界分摊】，队友合计实际损失 ${resolvedTransfer} 点生命，${victim.name} 本体未受伤！`
              : `🎭 转移伤害落在 ${victim.name} 后触发【镜界分摊】，但队友均未损失生命！`);
          } else if (transferredDmg > 0) {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，实际承受 ${transferredDmg} 点伤害！`);
          } else {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，但没有造成实际伤害！`);
          }
          if (resolvedTransfer > 0 || (victim.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(victim);
          if (victim.currentHp <= 0 && !victim.isDead && !victim.isDeadAnnounced) {
            const transferKiller = attacker && attacker.id !== victim.id ? attacker : target;
            this.markDefeated(victim, {
              message: `💀 【伤害转移】${victim.name} 被 ${target.name} 的随机恶作剧转移来的 ${transferredDmg} 点伤害坑倒了！`,
              killer: transferKiller,
            });
          }
        } else {
          options.redirectedJokerDamage = 0;
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('info', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术，${originalAmount} 点伤害凭空消失！`);
        }
        options.redirectedByJoker = true;
        this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'redirected');
      }
    }

    if (isLuckEmperor(target) && attacker?.isTing && amount > 0 && source !== 'status') {
      amount = this.applyGachaTingGuardianEffects(target, amount, attacker);
      if (amount <= 0) {
        target.gachaTingGuardTrapReady = false;
        this.syncHpPct(target);
        if (!options.resolution) this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options);
        return 0;
      }
    }

    amount = this.triggerTokusatsuThroneFromDamage(target, amount, source, attacker, options);
    if (amount <= 0) {
      this.syncHpPct(target);
      if (!options.resolution) this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options);
      return 0;
    }

    let pendingOwlSummonDeathSave: 'specter' | 'spalter' | null = null;
    let triggerCricketExplosion = false;
    const owlSummonState = target.owlSummonState;
    if (
      owlSummonState?.kind === 'cricket' &&
      !owlSummonState.suicideTriggered &&
      attacker && attacker.id !== target.id &&
      source !== 'status' && source !== 'owl_explosion'
    ) {
      owlSummonState.lastAttackerId = attacker.id;
      const threshold = Math.max(1, Math.floor(target.maxHp * 0.1));
      if (target.currentHp - amount <= threshold) {
        options.phaseLockTriggered = true;
        options.lockbloodLabel = '自刎锁血';
        amount = Math.min(amount, Math.max(0, target.currentHp - 1));
        triggerCricketExplosion = true;
        this.queueOrLogDamageEvent(
          target,
          options,
          'buff',
          `🦗 【自刎锁血】${target.name} 被压到 10% 生命线，强行留住最后一口气准备自爆！`,
          undefined,
          'mitigation',
        );
      }
    }

    if (
      (owlSummonState?.kind === 'specter' || owlSummonState?.kind === 'spalter') &&
      amount >= target.currentHp
    ) {
      const lockStatus = owlSummonState.kind === 'specter' ? 'OWL_SPECTER_LOCK' : 'OWL_SPALTER_LOCK';
      const alreadyLocked = hasStatus(target, lockStatus);
      if (alreadyLocked || !owlSummonState.deathSaveUsed) {
        options.phaseLockTriggered = true;
        options.lockbloodLabel = '濒死锁血';
        amount = Math.max(0, target.currentHp - 1);
        pendingOwlSummonDeathSave = alreadyLocked ? null : owlSummonState.kind;
        this.queueOrLogDamageEvent(
          target,
          options,
          'buff',
          `🦈 【濒死锁血】${target.name} 强行保留最后 1 点生命！`,
          undefined,
          'mitigation',
        );
      }
    }

    amount = this.clampPersistentDeathSaveDamage(target, amount, options);

    if (amount <= 0) {
      if (pendingOwlSummonDeathSave) markOwlSummonDeathSave(target, this.turnCount);
      this.syncHpPct(target);
      this.settleDamageRecord(target, attacker, source, attemptedDamage, 0, shieldDamage, 0, options, 'lockblood');
      if (triggerCricketExplosion) this.triggerOwlCricketChain(target);
      return 0;
    }

    const hpBeforeDamage = target.currentHp;
    const resolvedIncomingDamage = amount;
    const hpDamage = Math.min(hpBeforeDamage, resolvedIncomingDamage);
    const overkillDamage = Math.max(0, resolvedIncomingDamage - hpBeforeDamage);
    target.currentHp = Math.max(0, hpBeforeDamage - hpDamage);
    amount = hpDamage;
    this.settleDamageRecord(
      target,
      attacker,
      source,
      attemptedDamage,
      hpDamage,
      shieldDamage,
      overkillDamage,
      options,
    );
    if (pendingOwlSummonDeathSave) markOwlSummonDeathSave(target, this.turnCount);
    if (triggerCricketExplosion) {
      this.queueOrRunDamageAction(target, options, () => this.triggerOwlCricketChain(target));
    }
    noteOriginiumDamageLanded(puruisaishiDamageRuntime, target, source, attacker, options);
    if (amount > 0) {
      target.lastDamage = {
        amount,
        source,
        sourceLabel: getDamageSourceLabel(source),
        attackerId: attacker?.id,
        attackerName: attacker?.name,
        turn: this.turnCount,
      };
    }
    this.grantGamerDamageReward(attacker, amount, target, options);
    this.grantGamerHeavyHitReward(target, amount, attacker, source, options);
    this.grantTokusatsuHeavyDamageResonance(target, amount, source, options);
    if (isLuckEmperor(target) && amount > 0) {
      if (amount >= target.maxHp * 0.2) {
        grantGachaLuck(target, 1, (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata), '承受重创');
      }
      if (attacker?.isTing) {
        if (!hasStatus(target, GACHA_TRAP_GUARD_COOLDOWN)) {
          target.gachaTingGuardTrapReady = true;
        }
        if (!hasStatus(target, 'GACHA_TING_LUCK_COOLDOWN')) {
          grantGachaLuck(target, 1, (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata), '被小汀针对');
          applyStatus(target, { identityId: 'GACHA_TING_LUCK_COOLDOWN', remainingTurns: 1 });
        }
      }
    }
    applyGachaSummonLifesteal({
      fighters: this.fighters,
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata),
    }, attacker, Math.min(hpBeforeDamage, amount));
    const momoRewards = applyMomoCaptainDamageRewards(
      this.createMomoRuntime((type, text) => this.queueOrLogDamageEvent(target, options, type, text)),
      attacker,
      amount,
      source,
    );
    momoRewards.forEach((reward) => {
      if (reward.joyHealed <= 0 && reward.momoHealed <= 0) return;
      const parts: string[] = [];
      if (reward.joyHealed > 0) parts.push(`${attacker?.name ?? '舰长'} 吸血恢复 ${reward.joyHealed} 点`);
      if (reward.momoHealed > 0) parts.push(`${reward.momo.name} 获得舰长回馈 ${reward.momoHealed} 点`);
      this.queueOrLogDamageEvent(target, options, 'heal', `🎉 【舰长联动】${parts.join('，')}。`);
    });
    if (target.currentHp <= 0 && this.triggerRaPhoenix(target, options)) {
      if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
      return amount;
    }
    if (target.currentHp <= 0 && triggerGachaDeathSave(
      target,
      (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata),
      (fighter) => this.syncHpPct(fighter),
      (fighter) => {
        this.dispelStatusEffects(fighter, {
          strength: 'strong',
          direction: 'negative',
          emitLog: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
        });
      },
    )) {
      options.suppressOnHitStatuses = true;
      return amount;
    }
    if (target.currentHp <= 0 && this.triggerGamerContinue(target, options)) {
      return amount;
    }
    if (target.currentHp <= 0 && this.triggerTokusatsuDefiance(target, options)) {
      return amount;
    }
    this.syncHpPct(target);
    if (target.isYuzu) {
      tryAdvanceYuzuPhaseByHp({
        fighters: this.fighters,
        turnCount: this.turnCount,
        getTeamId: (fighter) => this.getTeamId(fighter),
        isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
        log: (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata),
        syncHpPct: (fighter) => this.syncHpPct(fighter),
      }, target);
    }
    if (target.isOwl) {
      const owlRuntime = this.createOwlRuntime();
      owlRuntime.log = (type, text, metadata) => this.queueOrLogDamageEvent(target, options, type, text, metadata);
      tryEnterOwlDefeat(owlRuntime, target);
    }

    if (
      target.owlSummonState?.kind === 'emperor' &&
      amount > 0 &&
      source === 'skill' &&
      attacker && attacker.id !== target.id
    ) {
      const owl = target.summonerId
        ? this.fighters.find((fighter) => fighter.id === target.summonerId && fighter.isOwl)
        : undefined;
      if (owl && this.isActiveCombatant(owl)) {
        const earOptions: DamageApplicationOptions = {
          actionName: '扎龙自己的耳朵',
          respectDefenses: false,
          creditAttacker: false,
          bypassOwlEmperorRedirect: true,
          bypassOwlOutgoingModifier: true,
          bypassOwlIncomingModifier: true,
          suppressOwlCooperation: true,
        };
        const earCost = this.applyDamage(owl, 10, 'owl_cost', true, owl, earOptions);
        applyStatus(owl, { identityId: 'OWL_EAR_GUARD', remainingTurns: 1, attribution: { effectSourceId: owl.id } });
        this.log('buff', `👂 【扎龙自己的耳朵！】${target.name} 被主动攻击，${owl.name} 损失 ${earCost} 点生命并获得 1 回合减伤。`);
        if (owl.currentHp <= 0 && !owl.isDead && !owl.isDeadAnnounced) {
          this.markDefeated(owl, {
            message: `💀 【扎龙自己的耳朵！】${owl.name} 因反复扎耳耗尽生命！`,
            awardKill: false,
          });
        }
      }
    }
    if (amount > 0) {
      target.isHit = true;
      if (!options.deferTransform) this.handleTransformations(target);
    }
    if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
    if (options.resolution) {
      options.resolution.phaseTransition = fighterPhaseIdentity(target) !== phaseIdentityBeforeDamage;
      options.resolution.defeated = target.currentHp <= 0 || target.isDead || target.isDeadAnnounced;
    }
    resolveDirectDamageStatusAftermath(
      this.createStatusMechanicsRuntime(),
      target,
      options.resolution,
      options,
    );
    return amount;
  }

  triggerOwlCricketChain(firstCricket: Fighter): void {
    const firstState = firstCricket.owlSummonState;
    if (
      firstState?.kind !== 'cricket' ||
      firstState.suicideTriggered ||
      firstCricket.isDead ||
      firstCricket.isDeadAnnounced
    ) return;
    const target = firstState.lastAttackerId
      ? this.fighters.find((fighter) => fighter.id === firstState.lastAttackerId)
      : undefined;
    if (!target) return;

    const partner = this.fighters.find((fighter) =>
      fighter.id !== firstCricket.id &&
      fighter.isSummon &&
      fighter.summonerId === firstCricket.summonerId &&
      fighter.owlSummonState?.kind === 'cricket' &&
      this.isActiveCombatant(fighter) &&
      (!firstState.pairId || fighter.owlSummonState?.pairId === firstState.pairId),
    ) ?? this.fighters.find((fighter) =>
      fighter.id !== firstCricket.id &&
      fighter.isSummon &&
      fighter.summonerId === firstCricket.summonerId &&
      fighter.owlSummonState?.kind === 'cricket' &&
      this.isActiveCombatant(fighter),
    );

    const explode = (cricket: Fighter, chain: boolean) => {
      const state = cricket.owlSummonState;
      if (!state || state.suicideTriggered || cricket.isDead || cricket.isDeadAnnounced) return;
      state.suicideTriggered = true;
      const title = chain ? '有情有义' : '自刎归天';
      this.log('skill', chain
        ? `🦗 【有情有义】${cricket.name} 目睹同伴自爆，追随同伴化身奥特炸弹冲向 ${target.name}！`
        : `🦗 【自刎归天】“战至最后一刻，自刎归天！”${cricket.name} 化身奥特炸弹冲向最后攻击者 ${target.name}！`);
      if (this.isActiveCombatant(target)) {
        const raw = Math.max(120, Math.floor(getEffectiveCombatStat(cricket, 'atk', 'custom') * 1.9 + cricket.maxHp * 0.32));
        const damageOptions: DamageApplicationOptions = {
          actionName: title,
          respectDefenses: true,
          suppressOwlCooperation: true,
        };
        const actual = this.applyDamage(target, raw, 'owl_explosion', false, cricket, damageOptions);
        const resolved = getResolvedDamageTotal(actual, damageOptions);
        const redirected = isDamageRedirected(damageOptions);
        if (!redirected) {
          this.log(resolved > 0 ? 'skill' : 'info', resolved > 0
            ? `💥 【${title}】爆炸在 ${target.name} 身上结算，实际造成 ${resolved} 点伤害！`
            : `💥 【${title}】爆炸被 ${target.name} 的防护完全化解，未造成生命伤害！`);
        }
        if (resolved > 0 || (target.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(target);
        if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
          this.markDefeated(target, {
            message: `💀 【${title}】${target.name} 被 ${cricket.name} 的奥特炸弹炸倒！`,
            killer: cricket,
          });
        }
      } else {
        this.log('info', `💥 【${title}】${target.name} 已经倒下，${cricket.name} 仍在原处完成自爆。`);
      }
      this.markDefeated(cricket, {
        message: `💀 【${title}】${cricket.name} 完成自爆，真实死亡！`,
        awardKill: false,
      });
    };

    explode(firstCricket, false);
    if (partner) explode(partner, true);
  }

  activeFriendlySummonsFor(owner: Fighter): Fighter[] {
    const ownerTeamId = this.getTeamId(owner);
    return this.fighters.filter((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === owner.id &&
      this.isActiveCombatant(fighter) &&
      this.getTeamId(fighter) === ownerTeamId,
    );
  }

  activeFriendlySummonByBaseName(owner: Fighter, baseName: string): Fighter | undefined {
    return this.activeFriendlySummonsFor(owner).find((fighter) => getSummonBaseName(fighter) === baseName);
  }

  activeOrdinaryFriendlySummons(owner: Fighter): Fighter[] {
    return this.activeFriendlySummonsFor(owner).filter((fighter) => !isAdvancedSummonName(getSummonBaseName(fighter)));
  }

  applyGuardianDamage(
    guardian: Fighter,
    amount: number,
    attacker: Fighter,
    actionName: string,
  ): number {
    if (amount <= 0 || !this.isActiveCombatant(guardian)) return 0;
    const actual = this.applyDamage(guardian, amount, 'skill', true, attacker, {
      deferTransform: true,
      actionName,
      respectDefenses: false,
    });
    if (actual > 0) {
      this.log('info', `🛡️ 【${actionName}】${guardian.name} 为护主承受 ${actual} 点反冲伤害！`);
    }
    if (actual > 0 || (guardian.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(guardian);
    if (guardian.currentHp <= 0 && !guardian.isDead && !guardian.isDeadAnnounced) {
      this.markDefeated(guardian, { message: `💀 【${actionName}】${guardian.name} 为护住召唤师承受伤害，被 ${attacker.name} 击溃！`, killer: attacker });
    }
    return actual;
  }

  applyGachaTingGuardianEffects(
    target: Fighter,
    incomingAmount: number,
    attacker: Fighter,
  ): number {
    let amount = incomingAmount;
    const emit = (type: string, text: string, metadata?: BattleLogMetadata) => this.log(type, text, metadata);
    const lethal = amount >= target.currentHp;
    const heavy = amount >= target.maxHp * 0.18;

    const exodia = this.activeFriendlySummonByBaseName(target, '黑暗大法师');
    if (lethal && exodia && !exodia.hasUsedExodiaGuard) {
      exodia.hasUsedExodiaGuard = true;
      applyStatus(exodia, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'exodia_seal_wall' } });
      applyStatus(exodia, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'exodia_seal_wall' } });
      emit(
        'crit',
        `🧙‍♂️ 【封印护壁】黑暗大法师 展开禁忌封印，直接无效化 ${attacker.name} 对 ${target.name} 的致死伤害！`,
        gachaEffectMetadata('summon_exodia_guard', exodia, [attacker]),
      );
      target.gachaTingGuardTrapReady = false;
      return 0;
    }

    const ra = this.activeFriendlySummonByBaseName(target, '翼神龙');
    if (lethal && ra && !ra.hasUsedRaTingGuard) {
      ra.hasUsedRaTingGuard = true;
      const burnCost = Math.min(ra.currentHp - 1, Math.max(1, Math.floor(ra.maxHp * 0.24)));
      const reducedTo = Math.max(0, target.currentHp - 1);
      const blocked = Math.max(0, amount - reducedTo);
      amount = reducedTo;
      emit(
        'crit',
        `☀️ 【太阳神护主】翼神龙 燃烧神力替 ${target.name} 抹去 ${blocked} 点致死伤害，将其强行保在 1 点生命！`,
        gachaEffectMetadata('summon_ra_guard', ra, [target]),
      );
      if (burnCost > 0) this.applyGuardianDamage(ra, burnCost, attacker, '太阳神护主');
      const retaliation = Math.max(1, Math.floor(
        getEffectiveCombatStat(ra, 'mag', 'custom') * 2.1 +
        getEffectiveCombatStat(ra, 'atk', 'custom') * 0.9,
      ));
      const actualRetaliation = this.applyDamage(attacker, retaliation, 'skill', true, ra, {
        deferTransform: true,
        actionName: '太阳神护主',
        respectDefenses: true,
        sourceKind: 'counter',
      });
      this.flushDeferredDamageEvents(attacker, 'mitigation');
      emit(
        'crit',
        `☀️ 【护主神炎】翼神龙 反灼 ${attacker.name}，实际造成 ${actualRetaliation} 点真实伤害！`,
        gachaEffectMetadata('summon_ra_flare', ra, [attacker]),
      );
      if (actualRetaliation > 0 || (attacker.pendingDamageEvents?.length ?? 0) > 0) this.flushDeferredDamageEvents(attacker);
      if (this.isActiveCombatant(attacker)) {
        this.applyStatus(attacker, { identityId: 'BURN', count: 2, attribution: { applierId: ra.id, applierName: ra.name } });
      }
      if (attacker.currentHp <= 0 && !attacker.isDead && !attacker.isDeadAnnounced) {
        this.markDefeated(attacker, { message: `💀 【太阳神护主】${attacker.name} 被翼神龙的护主神炎反噬击倒！`, killer: ra });
      }
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    const ultimate = this.activeFriendlySummonByBaseName(target, '青眼究极龙');
    if ((lethal || heavy) && ultimate && (ultimate.blueEyesUltimateGuardCount ?? 0) < 3 && !hasStatus(ultimate, GACHA_ULTIMATE_GUARD_COOLDOWN)) {
      const block = Math.max(1, Math.floor(amount * (lethal ? 0.62 : 0.48)));
      ultimate.blueEyesUltimateGuardCount = (ultimate.blueEyesUltimateGuardCount ?? 0) + 1;
      ultimate.blueEyesUltimateStrain = (ultimate.blueEyesUltimateStrain ?? 0) + 1;
      applyStatus(ultimate, {
        identityId: GACHA_ULTIMATE_GUARD_COOLDOWN,
        remainingTurns: 2,
        attribution: { effectSourceId: GACHA_ULTIMATE_GUARD_COOLDOWN },
      });
      const guardDamage = Math.max(1, Math.floor(block * 0.85));
      emit(
        'buff',
        `🐉 【三首护主】青眼究极龙 第 ${ultimate.blueEyesUltimateGuardCount}/3 颗龙首替 ${target.name} 咬碎小汀攻势，分担 ${block} 点伤害！（融合负荷上升）`,
        gachaEffectMetadata('summon_ultimate_guard', ultimate, [attacker], { count: ultimate.blueEyesUltimateGuardCount }),
      );
      this.applyGuardianDamage(ultimate, guardDamage, attacker, '三首护主');
      amount = Math.max(0, amount - block);
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    const blueEyes = this.activeFriendlySummonByBaseName(target, '青眼白龙');
    if (blueEyes && !hasStatus(blueEyes, GACHA_BLUE_EYES_GUARD_COOLDOWN)) {
      const block = Math.max(1, Math.floor(amount * 0.22));
      applyStatus(blueEyes, {
        identityId: GACHA_BLUE_EYES_GUARD_COOLDOWN,
        remainingTurns: 3,
        attribution: { effectSourceId: GACHA_BLUE_EYES_GUARD_COOLDOWN },
      });
      applyStatus(blueEyes, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'blue_eyes_guard' } });
      emit(
        'buff',
        `🐲 【白龙护主】青眼白龙 振翼护在 ${target.name} 身前，削去 ${block} 点来自 ${attacker.name} 的伤害！`,
        gachaEffectMetadata('summon_blue_eyes_guard', blueEyes, [attacker]),
      );
      this.applyGuardianDamage(blueEyes, Math.max(1, Math.floor(block * 0.8)), attacker, '白龙护主');
      amount = Math.max(0, amount - block);
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    const ordinarySummons = this.activeOrdinaryFriendlySummons(target)
      .sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp));
    let guard = ordinarySummons[0];
    const trapCanFlip =
      !guard &&
      !hasStatus(target, GACHA_TRAP_GUARD_COOLDOWN) &&
      (target.gachaTingGuardTrapReady || (target.gachaLuck ?? 0) >= 3 || lethal);
    if (trapCanFlip) {
      const spent = consumeGachaLuck(target, 1);
      target.gachaTingGuardTrapReady = false;
      applyStatus(target, {
        identityId: GACHA_TRAP_GUARD_COOLDOWN,
        remainingTurns: 2,
        attribution: { effectSourceId: GACHA_TRAP_GUARD_COOLDOWN },
      });
      emit(
        'buff',
        `🪤 【护主陷阱】${target.name} ${spent > 0 ? `消耗 ${spent} 点欧气，` : ''}翻开预先覆盖的防御牌，呼叫替身挡刀！`,
        gachaEffectMetadata('gacha_guard_trap', target, [attacker]),
      );
      this.executeSummonSkill(GACHA_TING_GUARD_TRAP_SUMMON, target, this.getTeamId(target));
      guard = this.activeOrdinaryFriendlySummons(target)
        .filter((summon) => getSummonBaseName(summon) === '护主栗子球')
        .sort((a, b) => a.currentHp - b.currentHp)[0] ?? guard;
    }

    if (guard && Math.random() < (getSummonBaseName(guard) === '护主栗子球' ? 1 : 0.42)) {
      const isTrapGuard = getSummonBaseName(guard) === '护主栗子球';
      const block = Math.max(1, Math.floor(amount * (isTrapGuard ? 0.36 : 0.28)));
      emit(
        'buff',
        `🛡️ 【召唤物护主】${guard.name} 冲到 ${target.name} 身前，替召唤师分担 ${block} 点小汀伤害！`,
        gachaEffectMetadata('gacha_summon_guard', guard, [attacker]),
      );
      this.applyGuardianDamage(guard, block, attacker, '召唤物护主');
      amount = Math.max(0, amount - block);
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    return amount;
  }

  markDefeated(target: Fighter, options: DefeatOptions = {}): boolean {
    if (target.isDead || target.isDeadAnnounced) return false;
    if (triggerGachaDeathSave(
      target,
      (type, text, metadata) => this.log(type, text, metadata),
      (fighter) => this.syncHpPct(fighter),
      (fighter) => { this.dispelStatusEffects(fighter, { strength: 'strong', direction: 'negative' }); },
    )) return false;
    if (this.triggerGamerContinue(target, {})) return false;

    if (options.setHpZero ?? true) setCurrentHp(target, 0);
    if (options.message) this.log(options.logType ?? 'death', options.message);
    target.isDeadAnnounced = true;
    this.recordEvent('defeat', 'defeat', `${target.name} 被判定击败。`, {
      actorId: options.killer?.id,
      actorName: options.killer?.name,
      targetIds: [target.id],
    });
    this.runDefeatHooksOnce(target);

    const shouldAwardKill = options.awardKill ?? !target.isNpc;
    if (shouldAwardKill && options.killer && options.killer.id !== target.id) {
      options.killer.stats.kills += 1;
      this.grantGamerKillMomentum(options.killer, target);
      this.grantWarThunderKillMomentum(options.killer, target);
      this.grantTingCrocKillMomentum(options.killer, target);
      this.grantGachaSummonRevenge(target, options.killer);
      if (isCompetitiveTarget(target)) this.grantValorantKillRewards(options.killer);
    }
    grantOriginiumCrystalBreakReward(this.createPuruisaishiRuntime(), target, options.killer);
    runCharacterDefeatSettledHooks({
      fighter: target,
      runtime: this.createCharacterHookRuntime(),
      killer: options.killer,
    });
    this.tryMorphlingSonRescue(target);

    this.tryValorantRunItBackRevive(target);

    return true;
  }

  tryValorantRunItBackRevive(target: Fighter): boolean {
    if (!hasStatus(target, 'VALO_ULT_RUN_IT_BACK')) return false;
    this.runReactionAction(target, {
      skillId: 'valo_run_it_back_revival',
      skillName: '再火一回',
      presentation: 'skill',
      targets: [target],
    }, () => {
      target.currentHp = target.maxHp;
      this.syncHpPct(target);
      removeEffects(target, { identityIds: ['VALO_ULT_RUN_IT_BACK'], reason: 'consumed' });
      target.isDead = false;
      target.isDeadAnnounced = false;
      target.defeatHooksResolved = false;
      this.log('heal', `🔥 浴火重生！${target.name} 受到致命伤，触发【再火一回】，原地满血复活！`, {
        actorId: target.id,
        actorName: target.name,
        targetIds: [target.id],
      });
    });
    return true;
  }

  grantWarThunderKillMomentum(killer: Fighter, target: Fighter): void {
    if (!killer.isWT || killer.job !== 'WT_TOP_TIER' || !this.isActiveCombatant(killer)) return;

    const before = killer.wtSpawnPoints ?? 0;
    const current = grantWarThunderSpawnPoints(killer, 1);
    killer.wtKillStreak = (killer.wtKillStreak ?? 0) + 1;
    applyStatus(killer, { identityId: 'AIM', charges: 1 });
    if (current > before) {
      this.log('buff', `🪖 【战雷击杀收益】${killer.name} 击毁 ${target.name}，出生点 +${current - before}，火控进入短暂锁定！（当前 SP ${current}/${WT_SPAWN_POINT_MAX}）`);
    } else {
      this.log('buff', `🪖 【战雷击杀收益】${killer.name} 击毁 ${target.name}，出生点已满，火控进入短暂锁定！（当前 SP ${current}/${WT_SPAWN_POINT_MAX}）`);
    }
  }

  grantTingCrocKillMomentum(killer: Fighter, target: Fighter): void {
    if (!killer.isTing || !target.isGacha || !this.isActiveCombatant(killer)) return;

    restoreZeroedStatsIfNeeded(killer);
    this.log('buff', `🩸 【爆鳄余烬】${killer.name} 亲手击倒 ${target.name}，被针对的怨念开始回流并重写伤势！`);
    const cleansed = this.dispelStatusEffects(killer, {
      strength: 'strong',
      direction: 'negative',
    }).removed.length > 0;
    applyStatus(killer, { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'ting_croc_kill_embers' } });
    applyStatus(killer, { identityId: 'BKB', remainingTurns: 2, attribution: { effectSourceId: 'ting_croc_kill_embers' } });
    applyStatus(killer, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'ting_croc_kill_embers' } });
    applyStatus(killer, { identityId: 'REGEN', remainingTurns: 4 });
    const healing = resolveHealing(killer, Math.floor(killer.maxHp * 0.58), {}, (type, text) => this.log(type, text));
    const cleanseText = cleansed ? '，清除负面状态' : '';
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    this.log('buff', `🩸 【爆鳄余烬结算】${killer.name}${cleanseText}，${healText}，并获得爆鳄余烬护体、怨念抗性、法术抵挡与再生！`);
  }

  grantGachaSummonRevenge(summoner: Fighter, killer: Fighter): void {
    if (!summoner.isGacha || !killer.isTing || !this.isActiveCombatant(killer)) return;

    const advancedSummons = this.activeFriendlySummonsFor(summoner)
      .filter((summon) => isAdvancedSummonName(getSummonBaseName(summon)) || summon.isAdvancedSummon)
      .sort((a, b) => (
        getEffectiveCombatStat(b, 'atk') + getEffectiveCombatStat(b, 'mag') + getEffectiveCombatStat(b, 'spd')
      ) - (
        getEffectiveCombatStat(a, 'atk') + getEffectiveCombatStat(a, 'mag') + getEffectiveCombatStat(a, 'spd')
      ));
    if (advancedSummons.length === 0) return;

    for (const summon of advancedSummons) {
      applyPermanentStatBuff(summon, { atk: 1.08, mag: 1.08 });
      applyStatus(summon, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'summon_revenge_order' } });
      applyStatus(summon, { identityId: 'REGEN', remainingTurns: 2 });
    }

    this.log('buff', `🧿 【召唤师遗产】${summoner.name} 被 ${killer.name} 击倒，${advancedSummons.length} 只高级召唤物继承最后指令，短暂强化并锁定复仇目标！`);
    const leader = advancedSummons[0];
    if (!leader || !this.isActiveCombatant(leader) || !this.isActiveCombatant(killer)) return;
    this.log('skill', `🧿 【复仇指令】${leader.name} 响应 ${summoner.name} 的最后命令，立刻压制 ${killer.name}！`);
    this.executeSkillAction(null, leader, killer, 1);
  }

  tryMorphlingSonRescue(fighter: Fighter): boolean {
    const MORPHLING_SON = this.JOBS['MORPHLING_SON'];
    const waterAnchor = this.fighters.find((candidate) => candidate.isMorphling && this.isActiveCombatant(candidate));
    if (!fighter.isGamer || fighter.resurrected || !waterAnchor || !MORPHLING_SON) {
      return false;
    }

    const changed = commitFormTransition({
      fighter,
      kind: 'form_shift',
      cause: 'revival',
      log: (type, text, metadata) => this.log(type, text, metadata),
      message: `👶 ${fighter.name} 刚被判定退场，就被水人救起并转职为【${MORPHLING_SON.name}】！`,
      mutate: () => {
        fighter.isDead = false;
        fighter.defeatHooksResolved = false;
        fighter.resurrected = true;
        fighter.isSon = true;
        fighter.teamId = waterAnchor.teamId ?? 'WATER_TEAM';
        fighter.job = 'MORPHLING_SON';
        fighter.jobData = cloneJobDefinition(MORPHLING_SON);
        fighter.maxHp = Math.floor(fighter.maxHp * 6);
        fighter.currentHp = fighter.maxHp;
        fighter.atk *= 6;
        fighter.mag *= 6;
        fighter.wis = Math.floor(fighter.wis * 4.0);
        fighter.spd = 100;
        this.syncHpPct(fighter);
        fighter.isDeadAnnounced = false;
      },
    });
    if (!changed) return false;
    this.dispelStatusEffects(fighter, {
      strength: 'absolute',
      direction: 'all',
      includeNeutral: true,
      includeIndependent: true,
    });
    return true;
  }

  runDefeatHooksOnce(fighter: Fighter, spinalSwordRef = this.activeSpinalSwordRef): void {
    if (!spinalSwordRef || fighter.defeatHooksResolved) return;
    fighter.defeatHooksResolved = true;
    runCharacterDefeatHooks({
      fighter,
      runtime: this.createCharacterHookRuntime(),
      spinalSwordRef,
    });
  }

  finalizeFighterDeath(
    f: Fighter,
    spinalSwordRef: SpinalSwordRef,
    deathMessage?: string,
    killer?: Fighter,
  ): void {
    if (f.isDead || (f.currentHp > 0 && !f.isDeadAnnounced)) return;

    if (this.tryValorantRunItBackRevive(f)) return;

    const defeated = this.markDefeated(f, { message: deathMessage ?? formatFallbackDeathMessage(f), killer });
    // markDefeated may synchronously revive or redeploy the fighter. Do not
    // overwrite that resolved state with the outer death finalizer.
    if (f.currentHp > 0 && !f.isDeadAnnounced) return;
    if (!defeated && f.currentHp > 0 && !f.isDeadAnnounced) return;
    if (!defeated && f.currentHp <= 0) setCurrentHp(f, 0);
    f.isDead = true;
    this.runDefeatHooksOnce(f, spinalSwordRef);

    this.tryMorphlingSonRescue(f);
    if (f.isDead) {
      spawnCrystalFromInfectedDeath(this.createPuruisaishiRuntime(), f);
      resetStatusResourcesOnDeath(f);
    }
  }

  checkWinCondition(alive: Fighter[]): boolean {
    return checkWinCondition(this.createTurnFlowRuntime(), alive);
  }

  determineActor(alive: Fighter[], priorityActorIds: readonly string[] = []): Fighter | null {
    return determineActor(alive, this.createTurnFlowRuntime(), priorityActorIds);
  }

  advanceGlobalTimedStatuses(): void {
    advanceGlobalTimedStatuses(this.fighters, this.turnCount, this.createStatusProcessingRuntime());
  }

  finishStep(spinalSwordRef: SpinalSwordRef): void {
    let settledStatusLargeRound: number | undefined;
    const settleCompletedStatusRound = () => {
      const completed = this.battleState.completedLargeRound;
      if (completed === undefined || completed === settledStatusLargeRound) return;
      settledStatusLargeRound = completed;
      this.runCausalScope(`large-round-${completed}-status`, () => {
        settleBurnAtLargeRound(this.createStatusMechanicsRuntime(), completed);
        advanceLargeRoundTimedBarriers(this.fighters, completed, (type, text) => this.log(type, text));
        this.handleDeathsAndRevives(spinalSwordRef);
      });
    };
    this.handleDeathsAndRevives(spinalSwordRef);
    this.resolveGachaInstantActions(spinalSwordRef);
    this.resolveTokusatsuInstantActions(spinalSwordRef);
    this.resolveChimeraInstantActions(spinalSwordRef);
    this.resolveValorantInstantActions(spinalSwordRef);
    this.resolveGamerInstantActions(spinalSwordRef);
    settleCompletedStatusRound();
    this.runCausalScope(`turn-${this.turnCount}-global-effects`, () => {
      this.advanceGlobalTimedStatuses();
      runCharacterGlobalTickHooks({ runtime: this.createCharacterHookRuntime() });
      runCharacterReentryHooks({ runtime: this.createCharacterHookRuntime() });
    });
    const completedBeforePuruisaishi = syncLargeRoundState(this.battleState, this.fighters);
    if (completedBeforePuruisaishi !== undefined) {
      this.recordEvent('round', 'round_complete', `第 ${completedBeforePuruisaishi} 个大回合因参与者退场而结束。`);
    }
    settleCompletedStatusRound();
    this.runCausalScope(`turn-${this.turnCount}-puruisaishi`, () => {
      processPuruisaishiRoundEnd(this.createPuruisaishiRuntime());
      this.handleDeathsAndRevives(spinalSwordRef);
    });
    const completedAfterPuruisaishi = syncLargeRoundState(this.battleState, this.fighters);
    if (completedAfterPuruisaishi !== undefined) {
      this.recordEvent('round', 'round_complete', `第 ${completedAfterPuruisaishi} 个大回合因参与者退场而结束。`);
      processPuruisaishiLargeRoundEnd(this.createPuruisaishiRuntime());
    }
    settleCompletedStatusRound();
    consumeCompletedLargeRound(this.battleState, this.fighters);
  }

  resolveGachaInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.gachaInstantActionQueued &&
        (fighter.gachaLuck ?? 0) >= GACHA_LUCK_MAX &&
        isLuckEmperor(fighter) &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.gachaInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      this.log('skill', `👑 【欧气爆发】${actor.name} 欧气满溢，强行插队获得一次命运抽卡机会！`, {
        actorId: actor.id,
        actorName: actor.name,
        targetIds: [actor.id],
      });
      const skillId = actor.jobData.skills.includes('destiny_draw') ? 'destiny_draw' : this.selectSkill(actor);
      this.executeSkillAction(skillId, actor);
      this.advanceBunnyStyleClock(actor);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 欧气插队结算次数过多，本轮剩余插队已被中止以防止循环。');
  }

  resolveTokusatsuInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.tokusatsuInstantActionQueued &&
        fighter.isTokusatsu &&
        fighter.job === 'MIRACLE_MONSTER_BUJIN' &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.tokusatsuInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      this.log('skill', `🔥 【悲愿反扑】${actor.name} 借【悲愿不倒】抢回一个镜头，立刻发动怪兽形态反击！`);
      const skillId = actor.jobData.skills.includes('bujin_monster_combo') ? 'bujin_monster_combo' : this.selectSkill(actor);
      this.executeSkillAction(skillId, actor);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 刺猬人悲愿反扑结算次数过多，本轮剩余反扑已被中止以防止循环。');
  }

  resolveChimeraInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.chimeraInstantActionQueued &&
        fighter.isSuccubus &&
        fighter.transformed &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.chimeraInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      const pluginSkills = actor.jobData.skills.filter((skillId) =>
        skillId.startsWith('chimera_') &&
        skillId !== 'chimera_install' &&
        skillId !== 'chimera_strike' &&
        this.SKILLS[skillId],
      );
      const skillId = pluginSkills.length > 0
        ? pluginSkills[Math.floor(Math.random() * pluginSkills.length)]
        : 'chimera_strike';
      this.log('skill', `🧬 【兽性苏醒】${actor.name} 的插件神经同时点火，立刻追加一次合成兽行动！`);
      this.executeSkillAction(skillId ?? 'chimera_strike', actor, null, 1);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 克蕾儿兽性苏醒结算次数过多，本轮剩余追加行动已被中止以防止循环。');
  }

  resolveValorantInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.valoInstantActionQueued &&
        fighter.job === 'VALO_JUNIOR' &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.valoInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      let skillId = 'valo_pre_fire';
      if ((actor.crosshairFocus ?? 0) >= 9) {
        actor.crosshairFocus = Math.max(0, (actor.crosshairFocus ?? 0) - 9);
        skillId = 'valo_clutch_execute';
        this.log('skill', `🧭 【再定位补枪】${actor.name} 击杀后立刻换位，用 9 层准星专注接上残局处决！`);
      } else if ((actor.crosshairFocus ?? 0) >= 6) {
        actor.crosshairFocus = Math.max(0, (actor.crosshairFocus ?? 0) - 6);
        skillId = 'valo_clutch_headshot';
        this.log('skill', `🧭 【再定位补枪】${actor.name} 击杀后拉开身位，用 6 层准星专注接上爆头线！`);
      } else {
        this.log('skill', `🧭 【再定位补枪】${actor.name} 击杀后快速换点，补出一发提前枪截停追击者！`);
      }

      this.executeSkillAction(skillId, actor, null, 1);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 瓦学妹再定位补枪次数过多，本轮剩余补枪已被中止以防止循环。');
  }

  resolveGamerInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.gamerInstantActionQueued &&
        fighter.job === 'ALL_PLATFORM_CHAMPION' &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.gamerInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      let skillId = this.selectSkill(actor);
      if (hasStatus(actor, 'GAMER_WORLD_STAGE') && !actor.hasUsedGamerChampionCombo && (actor.apm ?? 0) >= 5) {
        skillId = 'gamer_world_combo';
      }
      this.log('skill', `🎮 【高光抢回合】${actor.name} 抓住变身/世界赛窗口，立刻追加一次冠军操作！`);
      this.executeSkillAction(skillId, actor, null, 1);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 玄凝高光抢回合结算次数过多，本轮剩余操作已被中止以防止循环。');
  }

  advanceBunnyStyleClock(actor: Fighter): void {
    if (actor.isDead || actor.job !== 'VERSATILE_RABBIT') return;
    if (hasStatus(actor, 'SYNERGY_SLACKING')) return;
    actor.styleTurnCounter = (actor.styleTurnCounter ?? 0) + 1;
    if (actor.styleTurnCounter >= 4) {
      actor.styleTurnCounter = 0;
      this.log('skill', `⏰ 【人设时钟】第 4 次自身行动已到！${actor.name} 准时开启了新一轮的【光速换装】！`);
      this.executeSkillAction('v_rabbit_style_switch', actor, null, 1);
    }
  }

  handleTransformations(tgt: Fighter): void {
    if (tgt.isDead || tgt.transformed || tgt.currentHp >= tgt.maxHp * 0.5) return;

    const transform = (jobKey: string, msg: string, applyForm: () => void, afterCommit?: () => void) => {
      const changed = commitFormTransition({
        fighter: tgt,
        message: msg,
        log: (type, text, metadata) => this.log(type, text, metadata),
        mutate: () => {
          tgt.transformed = true;
          const jobData = this.JOBS[jobKey];
          if (jobData) tgt.jobData = cloneJobDefinition(jobData);
          tgt.job = jobKey;
          withPersistentStatusShapesSuspended(tgt, () =>
            withMomoCaptainHpBonusesSuspended(tgt, applyForm),
          );
          this.syncHpPct(tgt);
        },
      });
      if (changed && afterCommit) {
        this.runReactionAction(tgt, {
          skillId: 'form_transition_aftermath',
          skillName: '转阶段后续',
          presentation: 'skill',
          targets: [tgt],
        }, afterCommit);
      }
    };

    runCharacterTransformHooks({
      fighter: tgt,
      runtime: this.createCharacterHookRuntime(),
      transform,
    });
  }

  processStatus(actor: Fighter): boolean {
    return processStatus(this.createStatusProcessingRuntime(), actor);
  }

  processStatusTurn(actor: Fighter, options?: StatusTurnOptions): StatusTurnResult {
    const runtime = this.createStatusProcessingRuntime();
    const result = processStatusTurn(runtime, actor, options);
    if (!options?.deferSelfOpportunitySettlement) {
      settleSelfOpportunityStatuses(
        runtime,
        actor,
        result.selfOpportunityStatuses,
        result.selfOpportunityBarriers,
        result.selfOpportunityStatusVersions,
        result.selfOpportunityBarrierVersions,
      );
    }
    return result;
  }

  isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
    return counterType === 'CTR_CHARM' && (hasStatus(fighter, 'STYLE_SEXY') || hasStatus(fighter, 'STYLE_EMPEROR'));
  }

  handleSpinalSwordDrop(actor: Fighter, spinalSwordRef: SpinalSwordRef): void {
    handleSpinalSwordDrop(this.createStatusProcessingRuntime(), actor, spinalSwordRef);
  }

  clearSpinalSword(actor: Fighter, logWhenActive = false): void {
    clearSpinalSword(this.createStatusProcessingRuntime(), actor, logWhenActive);
  }

  syncSpinalSwordState(actor: Fighter, logWhenExpired = false): void {
    syncSpinalSwordState(this.createStatusProcessingRuntime(), actor, logWhenExpired);
  }

  syncPuppetMasterStatus(actor: Fighter): void {
    syncPuppetMasterStatus(this.createStatusProcessingRuntime(), actor);
  }

  selectSkill(actor: Fighter): string | null {
    if (hasMentalBreakdown(actor)) {
      this.log('info', `🫥 【精神崩溃】${actor.name} 无法组织复杂行动，这次只能进行不会暴击的普通攻击！`);
      return null;
    }
    if (hasStatus(actor, 'SILENCE')) {
      this.log('info', `😶 ${actor.name} 处于【${getStatusIdentityDefinition('SILENCE').displayName}】状态，无法发动技能，只能普通攻击！`);
      return null;
    }

    const selectSwordSkill = () => selectSpinalSwordRouteSkill(
      actor,
      this.fighters,
      (fighter) => this.isActiveCombatant(fighter),
    );
    if (shouldUseSpinalSwordRoute(actor)) return selectSwordSkill();

    const runtime = this.createCharacterHookRuntime();
    const characterSkill = runCharacterSkillSelectionHooks({
      actor,
      runtime,
      phase: 'preMechanics',
    });
    if (characterSkill) return characterSkill;

    const spinalSwordSkill = actor.isGacha
      ? selectSpinalSwordSpecialSkill(actor, this.fighters, (fighter) => this.isActiveCombatant(fighter))
      : null;
    if (spinalSwordSkill) return spinalSwordSkill;

    const postMechanicCharacterSkill = runCharacterSkillSelectionHooks({
      actor,
      runtime,
      phase: 'postMechanics',
    });
    if (postMechanicCharacterSkill) return postMechanicCharacterSkill;

    if (Math.random() < (0.3 + getEffectiveCombatStat(actor, 'wis') * 0.005)) {
      const jobSkills = (actor.jobData.skills ?? []).filter((s) => s !== 'slacking' && s !== 'moyu');
      const isSpecialFighter =
        ((actor.isJoker || actor.isTokusatsu || actor.isGacha || actor.isTing || actor.isSigua || actor.isMorphling || actor.isSuccubus || actor.isTuJuanJuan || actor.isWT) && actor.transformed) ||
        actor.isGamer;

      if (isSpecialFighter) {
        let availableSkills = (actor.isTokusatsu && actor.counterUsed)
          ? jobSkills.filter((s) => s !== 'great_monster_victory' && s !== 'bujin_chair')
          : jobSkills;
        availableSkills = availableSkills.filter((s) => {
          const skData = this.SKILLS[s];
          if (!skData) return false;
          if (skData.condition && !skData.condition(actor)) return false;
          if (skData.tag === this.SKILL_TAGS['HEAL'] && actor.hpPct > 0.9) return false;
          return true;
        });
        if (availableSkills.length > 0) return availableSkills[Math.floor(Math.random() * availableSkills.length)];
      } else {
        for (const s of jobSkills) {
          const skData = this.SKILLS[s];
          if (!skData || (skData.condition && !skData.condition(actor)) || (skData.tag === this.SKILL_TAGS['HEAL'] && actor.hpPct > 0.9)) continue;
          const rate = skData.rate !== undefined ? skData.rate : 0.3;
          if (skData.isGacha || (rate > 0 && Math.random() < (rate * (1 + getEffectiveCombatStat(actor, 'wis') * 0.002)))) return s;
        }
      }
    }
    if (actor.hasSpinalSword && actor.isGacha) return 'spinal_slash';
    return null;
  }

  isSelectableTargetFor(user: Fighter, target: Fighter): boolean {
    return isSelectableTargetFor(this.createTargetingRuntime(), user, target);
  }

  getSelectableTargets(user: Fighter): Fighter[] {
    return getSelectableTargets(this.createTargetingRuntime(), user);
  }

  handleValorantPreFire(user: Fighter, userTeamId: string, targets: Fighter[], triggerDepth: number): boolean {
    return handleValorantPreFireAction(this.createActionResolutionRuntime(), user, userTeamId, targets, triggerDepth);
  }

  resolveTarget(
    user: Fighter,
    forcedTarget: Fighter | null,
    currentTargets: Fighter[],
  ): { target: Fighter; isIntercepted: boolean } | null {
    return resolveTarget(this.createTargetingRuntime(), user, forcedTarget, currentTargets);
  }

  resolveSkillDefinition(skillId: string | null, user: Fighter): SkillDefinition {
    return resolveSkillDefinition({
      skills: this.SKILLS,
      data: this.Data,
      fighters: this.fighters,
      turnCount: this.turnCount,
      getTeamId: (fighter) => this.getTeamId(fighter),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text, metadata) => this.log(type, text, metadata),
    }, skillId, user);
  }

  formatSkillText(skill: SkillDefinition, text: string): string {
    return formatSkillText(skill, text);
  }

  executeSummonSkill(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    executeSummonSkillEffect(this.createSummonResolutionRuntime(), skill, user, userTeamId);
  }

  createSkillContext(
    user: Fighter,
    target: Fighter,
    currentTargets: Fighter[],
    triggerDepth: number,
    actionName?: string,
  ): SkillContext {
    return createSkillContextAction(this.createActionResolutionRuntime(), user, target, currentTargets, triggerDepth, actionName);
  }

  spreadDivaSupport(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    spreadDivaSupportEffect(this.createSupportResolutionRuntime(), skill, user, userTeamId);
  }

  cleanseCommonNegativeStatuses(target: Fighter): void {
    cleanseCommonNegativeStatusesEffect(target);
  }

  applyStatBuff(target: Fighter, buff: Partial<Record<StatKey | 'crit', number>>): void {
    applyStatBuffEffect(target, buff);
  }

  handleChimeraUltimateEvolution(target: Fighter): void {
    handleChimeraUltimateEvolutionEffect(this.createSupportResolutionRuntime(), target);
  }

  executeSupportSkill(skill: SkillDefinition, user: Fighter, forcedTarget: Fighter | null, userTeamId: string): boolean {
    return executeSupportSkillEffect(this.createSupportResolutionRuntime(), skill, user, forcedTarget, userTeamId);
  }

  missesSkill(user: Fighter, target: Fighter, skill: SkillDefinition, isIntercepted: boolean): boolean {
    return missesSkillAction(user, target, skill, isIntercepted);
  }

  handleWaitCounter(target: Fighter, user: Fighter, triggerDepth: number): boolean {
    return handleWaitCounterAction(this.createActionResolutionRuntime(), target, user, triggerDepth);
  }

  handleCounterStatus(target: Fighter, user: Fighter): boolean {
    return handleCounterStatusAction(this.createActionResolutionRuntime(), target, user);
  }

  breakAbsoluteDefense(skillId: string | null, user: Fighter, target: Fighter): boolean {
    return breakAbsoluteDefenseAction(this.createActionResolutionRuntime(), skillId, user, target);
  }

  dodgesWithPassiveSkill(user: Fighter, target: Fighter): boolean {
    return dodgesWithPassiveSkillAction(this.createActionResolutionRuntime(), user, target);
  }

  canTouchDamagePlane(user: Fighter, target: Fighter, skill: SkillDefinition): boolean {
    return canTouchDamagePlaneAction(this.createActionResolutionRuntime(), user, target, skill);
  }

  calculateDamage(
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    userTeamId: string,
    usedSkillId: string | null,
  ): { dmg: number; logType: string; ignoreDefOverride: boolean; sexyTrueDamage: boolean } {
    return calculateDamage(
      this.createDamageResolutionRuntime(),
      user,
      target,
      skill,
      userTeamId,
      usedSkillId,
    );
  }

  applySelfDamage(user: Fighter, skill: SkillDefinition): void {
    applySelfDamageAction(this.createActionResolutionRuntime(), user, skill);
  }

  applyAttackerStyleEffects(user: Fighter, target: Fighter): void {
    applyAttackerStyleEffectsAction(this.createActionResolutionRuntime(), user, target);
  }

  applySkillStatusEffect(skill: SkillDefinition, target: Fighter, user: Fighter = target): void {
    applySkillStatusEffectAction(this.createActionResolutionRuntime(), skill, user, target);
  }

  handleValorantWeaponDrop(target: Fighter, actualDmg: number): void {
    handleValorantWeaponDropAction(this.createActionResolutionRuntime(), target, actualDmg);
  }

  handlePhysicalCounterReflect(skill: SkillDefinition, user: Fighter, target: Fighter, actualDmg: number): void {
    handlePhysicalCounterReflectAction(this.createActionResolutionRuntime(), skill, user, target, actualDmg);
  }

  grantValorantKillRewards(user: Fighter): void {
    grantValorantKillRewardsAction(this.createActionResolutionRuntime(), user);
  }

  handlePrimaryTargetDefeat(user: Fighter, target: Fighter): boolean {
    return handlePrimaryTargetDefeatAction(this.createActionResolutionRuntime(), user, target);
  }

  applyLifestealEffects(
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    actualDmg: number,
    hpBeforeDamage: number,
  ): void {
    applyLifestealEffectsAction(this.createActionResolutionRuntime(), user, target, skill, actualDmg, hpBeforeDamage);
  }

  consumeAimAfterAttack(user: Fighter, skill: SkillDefinition): void {
    consumeAimAfterAttackAction(this.createActionResolutionRuntime(), user, skill);
  }

  triggerSuccubusBabyFollowup(
    user: Fighter,
    target: Fighter,
    skillId: string | null,
    userTeamId: string,
    triggerDepth: number,
  ): void {
    triggerSuccubusBabyFollowupAction(this.createActionResolutionRuntime(), user, target, skillId, userTeamId, triggerDepth);
  }

  executeSkillAction(skId: string | null, usr: Fighter, forcedTarget: Fighter | null = null, triggerDepth = 0): void {
    this.runWithBattleRandom(() => {
      const action = this.beginAction(skId, usr, forcedTarget, triggerDepth);
      try {
        executeSkillActionFlow(this.createActionResolutionRuntime(), skId, usr, forcedTarget, triggerDepth);
      } finally {
        this.endAction(action);
      }
    });
  }

  handleDeathsAndRevives(spinalSwordRef: SpinalSwordRef): void {
    const runtime = this.createCharacterHookRuntime();
    for (const f of this.fighters) {
      const wasOutOfBattle = f.isDead || f.isDeadAnnounced || f.currentHp <= 0;
      if ((f.currentHp <= 0 || f.isDeadAnnounced) && !f.isDead) {
        this.finalizeFighterDeath(f, spinalSwordRef);
      }

      runCharacterReviveHooks({ fighter: f, runtime, spinalSwordRef });
      if (wasOutOfBattle && this.isActiveCombatant(f)) resetStatusResourcesOnRevive(f);
      this.syncHpPct(f);
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
    }
    this.fighters.forEach((f) => {
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
      this.syncHpPct(f);
    });
    runCharacterReentryHooks({ runtime });
  }

  step(spinalSwordRef: SpinalSwordRef): boolean {
    return this.runWithBattleRandom(() => this.stepInternal(spinalSwordRef));
  }

  private stepInternal(spinalSwordRef: SpinalSwordRef): boolean {
    this.activeSpinalSwordRef = spinalSwordRef;
    this.fighters.forEach((f) => { f.isActing = false; f.isHit = false; });
    this.initializeMomoTeams();

    const alive = this.fighters.filter((f) => this.isActiveCombatant(f));
    if (this.checkWinCondition(alive)) return true;

    this.turnCount += 1;
    this.battleState.turnCount = this.turnCount;
    syncLargeRoundState(this.battleState, this.fighters);
    if (this.turnCount === 501) {
      this.log('info', '⏳ 久战不决，战场进入疲劳阶段！所有伤害会随回合推进逐步提高，防止战斗无限拖延。');
    }
    if (this.turnCount === 901) {
      this.log('info', '⏳ 战斗拖入深度疲劳阶段！久战者的防线开始崩坏，伤害提升速度加快。');
    }
    trySpawnPuruisaishiEvent(this.createPuruisaishiRuntime());

    const priorityActorIds = getLargeRoundPriorityActorIds(this.battleState, this.fighters);
    const actor = this.determineActor(alive, priorityActorIds);
    if (!actor) { this.finishStep(spinalSwordRef); return false; }

    actor.isActing = true;
    const completedLargeRound = noteLargeRoundActor(this.battleState, this.fighters, actor);
    if (completedLargeRound !== undefined) {
      this.recordEvent('round', 'round_complete', `第 ${completedLargeRound} 个大回合结束。`, {
        actorId: actor.id,
        actorName: actor.name,
      });
    }
    notePuruisaishiRoundActor(this.createPuruisaishiRuntime(), actor);
    this.handleSpinalSwordDrop(actor, spinalSwordRef);

    const statusTurn = this.runCausalScope(`turn-${this.turnCount}-${actor.id}-status-start`, () =>
      this.processStatusTurn(actor, { deferSelfOpportunitySettlement: true }),
    );
    const settleActorOpportunity = (completedAction: boolean) => {
      settleSelfOpportunityStatuses(
        this.createStatusProcessingRuntime(),
        actor,
        statusTurn.selfOpportunityStatuses,
        statusTurn.selfOpportunityBarriers,
        statusTurn.selfOpportunityStatusVersions,
        statusTurn.selfOpportunityBarrierVersions,
      );
      this.handleTransformations(actor);
      settleSelfOpportunityResources(actor, completedAction, (type, text) => this.log(type, text));
    };
    this.handleTransformations(actor);

    if (actor.currentHp <= 0) {
      settleSelfOpportunityResources(actor, false, (type, text) => this.log(type, text));
      this.finishStep(spinalSwordRef);
      return false;
    }
    if (!statusTurn.canAct) {
      this.runCausalScope(`turn-${this.turnCount}-${actor.id}-blocked-action`, () => {
        logUnableToAct(this.createTurnFlowRuntime(), actor, statusTurn.blockingStatusType);
        settleActorOpportunity(false);
        processMomoActorTurnEnd(this.createMomoRuntime(), actor, false);
      });
      this.finishStep(spinalSwordRef);
      return false;
    }

    if (statusTurn.embarrassed) {
      if (Math.random() < 0.5) {
        this.runCausalScope(`turn-${this.turnCount}-${actor.id}-embarrassed-action`, () => {
          this.log('info', `🥶 【尴尬】${actor.name} 当场僵住，没能完成这次行动！`);
          settleActorOpportunity(false);
          processMomoActorTurnEnd(this.createMomoRuntime(), actor, false);
        });
        this.finishStep(spinalSwordRef);
        return false;
      }
      this.log('info', `😤 【强装镇定】${actor.name} 顶住了尴尬，仍然完成本次行动！`);
    }

    const waitingCounter = getWaitingCounterStatus(this.createTurnFlowRuntime(), actor);
    if (waitingCounter) {
      this.runCausalScope(`turn-${this.turnCount}-${actor.id}-waiting-action`, () => {
        logWaitingCounter(this.createTurnFlowRuntime(), actor, waitingCounter);
        settleActorOpportunity(false);
        processMomoActorTurnEnd(this.createMomoRuntime(), actor, false);
      });
      this.finishStep(spinalSwordRef);
      return false;
    }

    if (this.getSelectableTargets(actor).length === 0) {
      this.runCausalScope(`turn-${this.turnCount}-${actor.id}-no-target-action`, () => {
        this.log('info', `⏸️ 【等待目标】${actor.name} 暂时找不到可以交战的目标，本次行动机会保留战斗资源后结束。`);
        settleActorOpportunity(false);
        processMomoActorTurnEnd(this.createMomoRuntime(), actor, false);
      });
      this.finishStep(spinalSwordRef);
      return false;
    }

    if (isLuckEmperor(actor) && actor.hpPct <= 0.35) {
      grantGachaLuck(actor, 1, (type, text, metadata) => this.log(type, text, metadata), '残血仍然行动');
    }

    if (statusTurn.confused) {
      const confusionTargets = getConfusionTargets(this.createTargetingRuntime(), actor);
      if (confusionTargets.length === 0) {
        this.log('info', `🌀 【混乱】${actor.name} 分不清敌我，却找不到可以攻击的其他单位！`);
        settleActorOpportunity(false);
        processMomoActorTurnEnd(this.createMomoRuntime(), actor, false);
        this.finishStep(spinalSwordRef);
        return false;
      }
      const confusedTarget = confusionTargets[Math.floor(Math.random() * confusionTargets.length)];
      actor.confusedForcedTargetId = confusedTarget.id;
      this.log('info', `🌀 【混乱】${actor.name} 认错了目标，只能用普通攻击打向 ${confusedTarget.name}！`);
      try {
        this.executeSkillAction(null, actor, confusedTarget);
      } finally {
        delete actor.confusedForcedTargetId;
      }
    } else {
      const skId = this.selectSkill(actor);
      this.executeSkillAction(skId, actor);
    }
    settleActorOpportunity(true);
    this.advanceBunnyStyleClock(actor);
    processMomoActorTurnEnd(this.createMomoRuntime(), actor, true);
    this.finishStep(spinalSwordRef);
    return false;
  }
}
