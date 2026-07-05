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
  StatusEffectsMap,
} from './types';
import { cloneJobDefinition, healFighter, isActiveCombatant, setCurrentHp, syncHpPct } from './combatState';
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
  getSelectableTargets,
  isSelectableTargetFor,
  resolveTarget,
  TargetingRuntime,
} from './targeting';
import {
  calculateDamage,
  DamageResolutionRuntime,
} from './damageResolution';
import {
  advanceGlobalTimedStatuses,
  clearSpinalSword,
  handleSelfTimedStatusExpiry,
  handleSpinalSwordDrop,
  processStatus,
  StatusProcessingRuntime,
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
  grantGachaLuck,
  isAdvancedSummonName,
  isLuckEmperor,
  triggerGachaDeathSave,
} from './gachaMechanics';
import { REVIVE_CLEAN_STATUS_TYPES } from './statusRules';
import {
  consumeSpellBlock,
  findDefenseStatus,
  formatInvul,
  formatSpellBlock,
  grantStatus,
} from './defenseStatus';
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
  consumeYuzuShield,
  ensureYuzuMarkedTarget,
  ensureYuzuOpeningShield,
  enterYuzuPhaseThree,
  hasAnyYuzuTeammate,
  tryAdvanceYuzuPhaseByHp,
  YUZU_PHASE_ONE_REDUCTION,
  YUZU_PHASE_THREE_REDUCTION,
  YUZU_TEAM_SHARE_RATIO,
} from './yuzuMechanics';

const DAMAGE_SOURCE_LABELS: Record<string, string> = {
  skill: '技能伤害',
  status: '状态伤害',
  counter: '反击伤害',
  reflect: '反弹伤害',
  transfer: '转移伤害',
  yuzu_share: '镜界分摊伤害',
};

function getDamageSourceLabel(source: string): string {
  return DAMAGE_SOURCE_LABELS[source] ?? `${source}伤害`;
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

const TING_CROC_KILL_CLEAN_STATUS_TYPES = new Set(REVIVE_CLEAN_STATUS_TYPES);
const TOKUSATSU_DEFIANCE_CLEAN_STATUS_TYPES = new Set(REVIVE_CLEAN_STATUS_TYPES);
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

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(fighter, type, duration, sourceId);
}

function grantWarThunderSpawnPoints(fighter: Fighter, amount: number): number {
  if (!fighter.isWT || fighter.job !== 'WT_TOP_TIER' || amount <= 0) return fighter.wtSpawnPoints ?? 0;
  const before = fighter.wtSpawnPoints ?? 0;
  fighter.wtSpawnPoints = Math.min(WT_SPAWN_POINT_MAX, before + amount);
  return fighter.wtSpawnPoints;
}

function restoreZeroedStatsIfNeeded(fighter: Fighter): void {
  if (!fighter.baseStatsForZero) return;
  fighter.atk = fighter.baseStatsForZero.atk;
  fighter.def = fighter.baseStatsForZero.def;
  fighter.res = fighter.baseStatsForZero.res;
  delete fighter.baseStatsForZero;
  fighter.wasZeroed = false;
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function isOriginalGamer(fighter?: Fighter): fighter is Fighter {
  return Boolean(fighter?.isGamer && !fighter.isSon && (fighter.job === 'HIGH_END_GAMER' || fighter.job === 'ALL_PLATFORM_CHAMPION'));
}

export class BattleEngine {
  fighters: Fighter[];
  addLogCallback: (e: { type: string; text: string }) => void;
  JOBS: Partial<Record<string, JobDefinition>>;
  SKILLS: Record<string, SkillDefinition>;
  Data: BattleEngineData;
  Core: BattleEngineCore;
  STATUS_EFFECTS: StatusEffectsMap;
  SKILL_TAGS: Record<string, string>;
  turnCount: number;
  activeSpinalSwordRef?: SpinalSwordRef;

  constructor(
    fighters: Fighter[],
    addLogCallback: (e: { type: string; text: string }) => void,
    JOBS: Partial<Record<string, JobDefinition>>,
    SKILLS: Record<string, SkillDefinition>,
    Data: BattleEngineData,
    Core: BattleEngineCore,
    turnCount = 0,
  ) {
    this.fighters = fighters;
    this.addLogCallback = addLogCallback;
    this.JOBS = JOBS;
    this.SKILLS = SKILLS;
    this.Data = Data;
    this.Core = Core;
    this.STATUS_EFFECTS = Data.STATUS_EFFECTS ?? {};
    this.SKILL_TAGS = Data.SKILL_TAGS ?? {};
    this.turnCount = turnCount;
    this.initializeYuzuOpeningShields();
  }

  log(type: string, text: string): void {
    this.addLogCallback({ type, text: text.replace(/\s*\r?\n\s*/g, ' ') });
  }

  queueOrLogDamageEvent(target: Fighter, options: DamageApplicationOptions, type: string, text: string): void {
    if (options.deferTransform) {
      target.pendingDamageEvents = target.pendingDamageEvents ?? [];
      target.pendingDamageEvents.push({ type, text });
      return;
    }
    this.log(type, text);
  }

  flushDeferredDamageEvents(fighter: Fighter): void {
    const pendingEvents = fighter.pendingDamageEvents ?? [];
    delete fighter.pendingDamageEvents;
    pendingEvents.forEach((event) => this.log(event.type, event.text));
    this.handleTransformations(fighter);
  }

  syncHpPct(f: Fighter): void {
    syncHpPct(f);
  }

  isActiveCombatant(f: Fighter): boolean {
    return isActiveCombatant(f);
  }

  getFatigueDamageBonus(): number {
    if (this.turnCount <= 500) return 0;
    const steadyFatigue = Math.min(80, Math.floor((this.turnCount - 500) / 25));
    if (this.turnCount <= 900) return steadyFatigue;
    const collapseFatigue = Math.floor((this.turnCount - 900) / 3) * 6;
    return Math.min(900, steadyFatigue + collapseFatigue);
  }

  initializeYuzuOpeningShields(): void {
    const runtime = this.createCharacterHookRuntime();
    this.fighters.forEach((fighter) => {
      if (fighter.isYuzu) ensureYuzuOpeningShield(runtime, fighter);
    });
  }

  getTeamId(f: Fighter): string {
    if (f.isMorphling || f.isSon) return 'WATER_TEAM';
    if (f.isSummon && f.summonerId) {
      const master = this.fighters.find((m) => m.id === f.summonerId);
      return master?.teamId ?? f.summonerId;
    }
    return f.teamId ?? f.id;
  }

  triggerRaPhoenix(target: Fighter, options: DamageApplicationOptions): boolean {
    if (
      getSummonBaseName(target) !== '翼神龙' ||
      target.hasUsedRaPhoenix ||
      !target.status.some((status) => status.type === GACHA_RA_PHOENIX_STATUS)
    ) {
      return false;
    }

    target.hasUsedRaPhoenix = true;
    target.status = target.status.filter((status) => status.type !== GACHA_RA_PHOENIX_STATUS);
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.32));
    this.syncHpPct(target);
    this.queueOrLogDamageEvent(target, options, 'heal', `🔥 【神不死鸟】${target.name} 在致死瞬间化为太阳火焰复燃，恢复到 ${target.currentHp} 点生命！`);

    const myTeamId = this.getTeamId(target);
    const enemies = this.fighters.filter((fighter) =>
      fighter.id !== target.id &&
      this.isActiveCombatant(fighter) &&
      this.getTeamId(fighter) !== myTeamId &&
      !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );
    const phoenixDmg = Math.floor(target.mag * 2.8 + target.atk * 1.4);
    enemies.forEach((enemy) => {
      const actualDmg = this.applyDamage(enemy, phoenixDmg, 'skill', true, target, {
        deferTransform: true,
        actionName: '神不死鸟',
        respectDefenses: true,
        canTriggerWaitCounter: false,
      });
      if (actualDmg > 0) {
        this.log('crit', `🔥 【神不死鸟】太阳火焰反扑 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
        this.flushDeferredDamageEvents(enemy);
      } else {
        this.log('info', `🔥 【神不死鸟】火焰扫过 ${enemy.name}，但没有造成实际伤害！`);
      }
      if (enemy.currentHp <= 0) {
        this.markDefeated(enemy, { message: `💀 【神不死鸟】${enemy.name} 被翼神龙的复燃火焰吞没！`, killer: target });
      }
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
    if (!target.isTokusatsu || target.counterUsed || !target.status.some((status) => status.type === 'WAIT_COUNTER')) return amount;
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
    target.status = target.status.filter((status) => !TOKUSATSU_DEFIANCE_CLEAN_STATUS_TYPES.has(status.type));
    refreshStatus(target, 'TOKUSATSU_DEFIANCE', 1);
    refreshStatus(target, 'BKB', 1, 'tokusatsu_defiance');
    refreshStatus(target, 'REGEN', 2);
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.13));
    target.atk = Math.floor(target.atk * 1.02);
    target.mag = Math.floor(target.mag * 1.02);
    target.spd = Math.floor(target.spd * 1.01);
    this.syncHpPct(target);
    this.queueOrLogDamageEvent(target, options, 'buff', `🔥 【悲愿不倒】${target.name} 的奇迹怪兽武刃拒绝退场！强行恢复到 ${target.currentHp}/${target.maxHp}，清除异常并准备立刻反扑！`);
    return true;
  }

  rewriteActiveDeathSaveDamage(target: Fighter, options: DamageApplicationOptions): boolean {
    const activeSave = target.status.find((status) => ACTIVE_DEATH_SAVE_STATUS_TYPES.has(status.type));
    if (!activeSave || target.isDead || target.isDeadAnnounced) return false;

    target.currentHp = 1;
    this.syncHpPct(target);
    if (activeSave.type === 'TING_DEFIANCE') {
      this.queueOrLogDamageEvent(target, options, 'info', `🩸 ${target.name} 仍处于【不甘倒下】，怨念把致死伤害强行压回 1 点生命！`);
    } else {
      this.queueOrLogDamageEvent(target, options, 'info', `🔥 ${target.name} 仍处于【悲愿不倒】，奇迹怪兽武刃把致死伤害强行压回 1 点生命！`);
    }
    return true;
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

  maybeEnterGamerWorldStage(fighter: Fighter, reason: string, options: DamageApplicationOptions = {}): void {
    if (!isOriginalGamer(fighter) || fighter.job !== 'ALL_PLATFORM_CHAMPION' || fighter.hasUsedGamerWorldStage) return;
    if ((fighter.apm ?? 0) < GAMER_WORLD_STAGE_THRESHOLD) return;

    fighter.hasUsedGamerWorldStage = true;
    fighter.gamerBoostReady = true;
    refreshStatus(fighter, 'GAMER_WORLD_STAGE', GAMER_WORLD_STAGE_DURATION);
    refreshStatus(fighter, 'BKB', 1, 'gamer_world_stage');
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
    refreshStatus(killer, 'AIM', 1);
    this.grantGamerApm(killer, 1, '击杀后进入收割节奏');
    this.log('buff', `🎮 【击杀滚动】${killer.name} 击败 ${target.name} 后进入残局处理，APM +1，输入缓存 +1！（当前 ${killer.apm ?? 0}/${GAMER_APM_MAX}）`);
  }

  applyDamage(
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage = false,
    attacker?: Fighter,
    options: DamageApplicationOptions = {},
  ): number {
    if (amount <= 0 || target.isDead || target.currentHp <= 0) return 0;
    if (target.status.some((s) => s.type === 'SYNERGY_SLACKING')) return 0;

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
        this.log('info', `🪞 【唯一目标】${target.name} 只承认 ${marked.name} 的苦痛，来自 ${attacker.name} 的伤害被镜界拒绝。`);
        return 0;
      }
    }

    if (options.respectDefenses) {
      const invul = findDefenseStatus(target, 'INVUL');
      if (invul) {
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', formatInvul(invul, target.name, incomingSource));
        return 0;
      }

      const spellBlock = target.status.find((status) => status.type === 'SPELL_BLOCK');
      if (spellBlock && (source === 'skill' || source === 'transfer')) {
        consumeSpellBlock(target);
        const healed = healFighter(target, Math.floor(target.maxHp * 0.15));
        const healText = healed > 0 ? `，并恢复了 ${healed} 点生命` : '，但生命已满，治疗溢出';
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', formatSpellBlock(spellBlock, target.name, incomingSource, healText));
        return 0;
      }
    }

    if (target.jobData?.name === '欧皇' && !isTrueDamage) amount = Math.floor(amount * 0.6);
    if (
      target.isWT &&
      target.transformed &&
      target.status.some((status) => status.type === 'WT_ERA') &&
      source !== 'status'
    ) {
      const eraMultiplier = source === 'reflect' || source === 'counter' ? 0.78 : (isTrueDamage ? 0.9 : 0.82);
      amount = Math.max(1, Math.floor(amount * eraMultiplier));
    }

    if (
      target.isEmote &&
      attacker &&
      attacker.id !== target.id &&
      !attacker.isSummon &&
      source !== 'status' &&
      target.status.some((status) => status.type === 'EMOTE_ADAPT')
    ) {
      const beforeAdapt = amount;
      amount = Math.max(1, Math.floor(amount * 0.7));
      target.status = target.status.filter((status) => status.type !== 'EMOTE_ADAPT');
      const gain = grantEmoteAdaptStats(target, attacker, 0.03);
      this.queueOrLogDamageEvent(
        target,
        options,
        'buff',
        `🧿 【适应转轮】${target.name} 记录 ${attacker.name} 的攻击模式，削减 ${beforeAdapt - amount} 点伤害，并复制 3% 属性（${formatEmoteStats(gain)}）；${attacker.name} 属性不降低。`,
      );
    }

    if (target.isYuzu && source !== 'status') {
      const phase = target.yuzuPhase ?? 1;
      const reduction = phase >= 3 ? YUZU_PHASE_THREE_REDUCTION : phase === 1 ? YUZU_PHASE_ONE_REDUCTION : 0;
      if (reduction > 0) {
        const beforeYuzuReduction = amount;
        amount = Math.max(1, Math.floor(amount * (1 - reduction)));
        this.log('info', `🪞 【镜界减伤】${target.name} 处于第 ${phase} 阶段，削减 ${beforeYuzuReduction - amount} 点伤害。`);
      }
    }

    const shieldResult = consumeYuzuShield(target, amount);
    if (shieldResult.absorbed > 0) {
      this.log('info', `🛡️ 【镜界护盾】${target.name} 的护盾吸收 ${shieldResult.absorbed} 点伤害，剩余 ${target.yuzuShield ?? 0}。`);
      amount = shieldResult.remaining;
      if (
        shieldResult.broke &&
        target.isYuzu &&
        (target.yuzuPhase ?? 1) === 2 &&
        !hasAnyYuzuTeammate(this.createCharacterHookRuntime(), target)
      ) {
        enterYuzuPhaseThree({
          fighters: this.fighters,
          getTeamId: (fighter) => this.getTeamId(fighter),
          isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
          log: (type, text) => this.log(type, text),
          syncHpPct: (fighter) => this.syncHpPct(fighter),
        }, target, '个人战护盾被击碎，溢出伤害被镜界无效化');
        this.syncHpPct(target);
        return 0;
      }
      if (amount <= 0) {
        this.syncHpPct(target);
        return 0;
      }
    }

    if (target.isYuzu && source !== 'status' && source !== 'yuzu_share') {
      const allies = activeYuzuTeammates(this.createCharacterHookRuntime(), target);
      const shareTotal = Math.floor(amount * YUZU_TEAM_SHARE_RATIO);
      const shareEach = allies.length > 0 ? Math.floor(shareTotal / allies.length) : 0;
      if (shareEach > 0) {
        const actualSharedTotal = shareEach * allies.length;
        amount = Math.max(1, amount - actualSharedTotal);
        this.log('info', `🪞 【镜界分摊】${target.name} 把 ${actualSharedTotal} 点伤害均摊给 ${allies.map((ally) => ally.name).join('、')}，自己承受 ${amount} 点。`);
        allies.forEach((ally) => {
          const shared = this.applyDamage(ally, shareEach, 'yuzu_share', true, target, {
            deferTransform: true,
            actionName: '镜界分摊',
            respectDefenses: false,
          });
          if (shared > 0) this.flushDeferredDamageEvents(ally);
        });
      }
    }

    const isProtected =
      target.isMorphling || target.isJoker || target.isTokusatsu || target.isGacha ||
      target.isTing || target.isSuccubus || target.isSigua || target.isTuJuanJuan || target.isWT ||
      (target.isYuzu && (target.yuzuPhase ?? 1) === 1);
    if (isProtected && !target.transformed && amount >= target.currentHp) {
      amount = Math.max(0, target.currentHp - 1);
      if (amount === 0) {
        this.syncHpPct(target);
        return 0;
      }
      this.queueOrLogDamageEvent(target, options, 'info', `🛡️ ${target.name} 触发了锁血保护，强制保留最后 1 点生命！`);
    }

    if (source === 'skill' && target.job === 'GOD_OF_TROLLS' && amount > 0 && Math.random() < 0.40) {
      if (target.status.some((s) => s.type === 'WATER_PRISON')) {
        this.log('info', `💧 ${target.name} 被困在深渊水牢中，无法施展魔术转移伤害，必须硬吃！`);
      } else {
        const originalAmount = amount;
        amount = 0;
        const myTeamId = this.getTeamId(target);
        const enemies = this.fighters.filter((f) =>
          !f.isDead &&
          !f.isDeadAnnounced &&
          f.currentHp > 0 &&
          f.id !== target.id &&
          this.getTeamId(f) !== myTeamId &&
          !f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
        );
        if (enemies.length > 0) {
          const victim = enemies[Math.floor(Math.random() * enemies.length)];
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('crit', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术完美闪避！并将伤害转移给了倒霉的 ${victim.name}！`);
          const transferredDmg = this.applyDamage(victim, originalAmount, 'transfer', isTrueDamage, attacker, {
            deferTransform: true,
            actionName: options.actionName,
            respectDefenses: true,
          });
          if (transferredDmg > 0) {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，实际承受 ${transferredDmg} 点伤害！`);
          } else {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，但没有造成实际伤害！`);
          }
          if (transferredDmg > 0) this.flushDeferredDamageEvents(victim);
          if (victim.currentHp <= 0 && !victim.isDead && !victim.isDeadAnnounced) {
            const transferKiller = attacker && attacker.id !== victim.id ? attacker : target;
            this.markDefeated(victim, {
              message: `💀 【伤害转移】${victim.name} 被 ${target.name} 的随机恶作剧转移来的 ${transferredDmg} 点伤害坑倒了！`,
              killer: transferKiller,
            });
          }
        } else {
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('info', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术，${originalAmount} 点伤害凭空消失！`);
        }
        options.redirectedByJoker = true;
      }
    }

    if (isLuckEmperor(target) && attacker?.isTing && amount > 0 && source !== 'status') {
      amount = this.applyGachaTingGuardianEffects(target, amount, attacker);
      if (amount <= 0) {
        target.gachaTingGuardTrapReady = false;
        this.syncHpPct(target);
        return 0;
      }
    }

    amount = this.triggerTokusatsuThroneFromDamage(target, amount, source, attacker, options);
    if (amount <= 0) {
      this.syncHpPct(target);
      return 0;
    }

    const hpBeforeDamage = target.currentHp;
    target.currentHp -= amount;
    target.stats.dmgTaken += amount;
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
        grantGachaLuck(target, 1, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), '承受重创');
      }
      if (attacker?.isTing) {
        if (!hasStatus(target, GACHA_TRAP_GUARD_COOLDOWN)) {
          target.gachaTingGuardTrapReady = true;
        }
        grantGachaLuck(target, 1, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), '被小汀针对');
      }
    }
    applyGachaSummonLifesteal({
      fighters: this.fighters,
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
    }, attacker, Math.min(hpBeforeDamage, amount));
    if (target.currentHp <= 0 && this.triggerRaPhoenix(target, options)) {
      if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
      return amount;
    }
    if (target.currentHp <= 0 && triggerGachaDeathSave(target, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), (fighter) => this.syncHpPct(fighter))) {
      return amount;
    }
    if (target.currentHp <= 0 && this.rewriteActiveDeathSaveDamage(target, options)) {
      return amount;
    }
    if (target.currentHp <= 0 && this.triggerTokusatsuDefiance(target, options)) {
      return amount;
    }
    if (target.currentHp <= 0 && target.isTing && target.transformed && !target.isDead && !target.isDeadAnnounced) {
      const hasActiveDefiance = target.status.some((status) => status.type === 'TING_DEFIANCE');
      if (hasActiveDefiance || !target.hasTriggeredTingDefiance) {
        target.currentHp = 1;
        if (!hasActiveDefiance) {
          target.status.push({ type: 'TING_DEFIANCE', duration: TING_DEFIANCE_DURATION });
        }
        if (!target.hasTriggeredTingDefiance) {
          target.hasTriggeredTingDefiance = true;
          target.atk = Math.floor(target.atk * 1.2);
          target.mag = Math.floor(target.mag * 1.2);
          target.spd = Math.floor(target.spd * 1.15);
          this.queueOrLogDamageEvent(target, options, 'buff', `🩸 【不甘倒下】${target.name} 被怨念强行钉在 1 点生命，拒绝退场！`);
        } else {
          this.queueOrLogDamageEvent(target, options, 'info', `🩸 ${target.name} 仍处于【不甘倒下】，硬是撑住了致命伤！`);
        }
      }
    }
    this.syncHpPct(target);
    if (target.isYuzu) {
      tryAdvanceYuzuPhaseByHp({
        fighters: this.fighters,
        getTeamId: (fighter) => this.getTeamId(fighter),
        isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
        log: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
        syncHpPct: (fighter) => this.syncHpPct(fighter),
      }, target);
    }
    if (amount > 0) {
      target.isHit = true;
      if (!options.deferTransform) this.handleTransformations(target);
    }
    if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
    return amount;
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
      this.flushDeferredDamageEvents(guardian);
    }
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
    const emit = (type: string, text: string) => this.log(type, text);
    const lethal = amount >= target.currentHp;
    const heavy = amount >= target.maxHp * 0.18;

    const exodia = this.activeFriendlySummonByBaseName(target, '黑暗大法师');
    if (lethal && exodia && !exodia.hasUsedExodiaGuard) {
      exodia.hasUsedExodiaGuard = true;
      refreshStatus(exodia, 'BKB', 2, 'exodia_seal_wall');
      refreshStatus(exodia, 'SPELL_BLOCK', 2, 'exodia_seal_wall');
      emit('crit', `🧙‍♂️ 【封印护壁】黑暗大法师 展开禁忌封印，直接无效化 ${attacker.name} 对 ${target.name} 的致死伤害！`);
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
      emit('crit', `☀️ 【太阳神护主】翼神龙 燃烧神力替 ${target.name} 抹去 ${blocked} 点致死伤害，将其强行保在 1 点生命！`);
      if (burnCost > 0) this.applyGuardianDamage(ra, burnCost, attacker, '太阳神护主');
      const retaliation = Math.max(1, Math.floor(ra.mag * 2.1 + ra.atk * 0.9));
      const actualRetaliation = this.applyDamage(attacker, retaliation, 'skill', true, ra, {
        deferTransform: true,
        actionName: '太阳神护主',
        respectDefenses: true,
      });
      if (actualRetaliation > 0) this.flushDeferredDamageEvents(attacker);
      if (!hasStatus(attacker, 'BURN')) attacker.status.push({ type: 'BURN', duration: 2 });
      emit('crit', `☀️ 【护主神炎】翼神龙 反灼 ${attacker.name}，实际造成 ${actualRetaliation} 点真实伤害！`);
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
      refreshStatus(ultimate, GACHA_ULTIMATE_GUARD_COOLDOWN, 2);
      const guardDamage = Math.max(1, Math.floor(block * 0.85));
      emit('buff', `🐉 【三首护主】青眼究极龙 第 ${ultimate.blueEyesUltimateGuardCount}/3 颗龙首替 ${target.name} 咬碎小汀攻势，分担 ${block} 点伤害！（融合负荷上升）`);
      this.applyGuardianDamage(ultimate, guardDamage, attacker, '三首护主');
      amount = Math.max(0, amount - block);
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    const blueEyes = this.activeFriendlySummonByBaseName(target, '青眼白龙');
    if (blueEyes && !hasStatus(blueEyes, GACHA_BLUE_EYES_GUARD_COOLDOWN)) {
      const block = Math.max(1, Math.floor(amount * 0.22));
      refreshStatus(blueEyes, GACHA_BLUE_EYES_GUARD_COOLDOWN, 3);
      refreshStatus(blueEyes, 'SPELL_BLOCK', 1, 'blue_eyes_guard');
      emit('buff', `🐲 【白龙护主】青眼白龙 振翼护在 ${target.name} 身前，削去 ${block} 点来自 ${attacker.name} 的伤害！`);
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
      refreshStatus(target, GACHA_TRAP_GUARD_COOLDOWN, 2);
      emit('buff', `🪤 【护主陷阱】${target.name} ${spent > 0 ? `消耗 ${spent} 点欧气，` : ''}翻开预先覆盖的防御牌，呼叫替身挡刀！`);
      this.executeSummonSkill(GACHA_TING_GUARD_TRAP_SUMMON, target, this.getTeamId(target));
      guard = this.activeOrdinaryFriendlySummons(target)
        .filter((summon) => getSummonBaseName(summon) === '护主栗子球')
        .sort((a, b) => a.currentHp - b.currentHp)[0] ?? guard;
    }

    if (guard && Math.random() < (getSummonBaseName(guard) === '护主栗子球' ? 1 : 0.42)) {
      const isTrapGuard = getSummonBaseName(guard) === '护主栗子球';
      const block = Math.max(1, Math.floor(amount * (isTrapGuard ? 0.36 : 0.28)));
      emit('buff', `🛡️ 【召唤物护主】${guard.name} 冲到 ${target.name} 身前，替召唤师分担 ${block} 点小汀伤害！`);
      this.applyGuardianDamage(guard, block, attacker, '召唤物护主');
      amount = Math.max(0, amount - block);
      target.gachaTingGuardTrapReady = false;
      return amount;
    }

    return amount;
  }

  markDefeated(target: Fighter, options: DefeatOptions = {}): boolean {
    if (target.isDead || target.isDeadAnnounced) return false;
    if (triggerGachaDeathSave(target, (type, text) => this.log(type, text), (fighter) => this.syncHpPct(fighter))) return false;

    if (options.setHpZero ?? true) setCurrentHp(target, 0);
    if (options.message) this.log(options.logType ?? 'death', options.message);
    target.isDeadAnnounced = true;
    this.runDefeatHooksOnce(target);

    const shouldAwardKill = options.awardKill ?? true;
    if (shouldAwardKill && options.killer && options.killer.id !== target.id) {
      options.killer.stats.kills += 1;
      this.grantGamerKillMomentum(options.killer, target);
      this.grantWarThunderKillMomentum(options.killer, target);
      this.grantTingCrocKillMomentum(options.killer, target);
      this.grantGachaSummonRevenge(target, options.killer);
    }
    runCharacterDefeatSettledHooks({
      fighter: target,
      runtime: this.createCharacterHookRuntime(),
      killer: options.killer,
    });
    this.tryMorphlingSonRescue(target);

    if (target.status.some((status) => status.type === 'VALO_ULT_RUN_IT_BACK')) {
      target.currentHp = target.maxHp;
      this.syncHpPct(target);
      target.status = target.status.filter((status) => status.type !== 'VALO_ULT_RUN_IT_BACK');
      target.isDead = false;
      target.isDeadAnnounced = false;
      target.defeatHooksResolved = false;
      this.log('heal', `🔥 浴火重生！${target.name} 受到致命伤，触发【再火一回】，原地满血复活！`);
    }

    return true;
  }

  grantWarThunderKillMomentum(killer: Fighter, target: Fighter): void {
    if (!killer.isWT || killer.job !== 'WT_TOP_TIER' || !this.isActiveCombatant(killer)) return;

    const before = killer.wtSpawnPoints ?? 0;
    const current = grantWarThunderSpawnPoints(killer, 1);
    killer.wtKillStreak = (killer.wtKillStreak ?? 0) + 1;
    refreshStatus(killer, 'AIM', 1);
    if (current > before) {
      this.log('buff', `🪖 【战雷击杀收益】${killer.name} 击毁 ${target.name}，出生点 +${current - before}，火控进入短暂锁定！（当前 SP ${current}/${WT_SPAWN_POINT_MAX}）`);
    } else {
      this.log('buff', `🪖 【战雷击杀收益】${killer.name} 击毁 ${target.name}，出生点已满，火控进入短暂锁定！（当前 SP ${current}/${WT_SPAWN_POINT_MAX}）`);
    }
  }

  grantTingCrocKillMomentum(killer: Fighter, target: Fighter): void {
    if (!killer.isTing || !target.isGacha || !this.isActiveCombatant(killer)) return;

    restoreZeroedStatsIfNeeded(killer);
    const statusCountBeforeCleanse = killer.status.length;
    killer.status = killer.status.filter((status) => !TING_CROC_KILL_CLEAN_STATUS_TYPES.has(status.type));
    const cleansed = killer.status.length !== statusCountBeforeCleanse;
    refreshStatus(killer, 'INVUL', 1, 'ting_croc_kill_embers');
    refreshStatus(killer, 'BKB', 2, 'ting_croc_kill_embers');
    refreshStatus(killer, 'SPELL_BLOCK', 1, 'ting_croc_kill_embers');
    refreshStatus(killer, 'REGEN', 4);
    const healed = healFighter(killer, Math.floor(killer.maxHp * 0.35));
    const cleanseText = cleansed ? '，清除负面状态' : '';
    const healText = healed > 0 ? `恢复 ${healed} 点生命` : '生命已满，治疗溢出';
    this.log('buff', `🩸 【爆鳄余烬】${killer.name} 亲手击倒 ${target.name}，怨念回流${cleanseText}，${healText}，并获得爆鳄余烬护体、怨念抗性、法术抵挡与再生！`);
  }

  grantGachaSummonRevenge(summoner: Fighter, killer: Fighter): void {
    if (!summoner.isGacha || !killer.isTing || !this.isActiveCombatant(killer)) return;

    const advancedSummons = this.activeFriendlySummonsFor(summoner)
      .filter((summon) => isAdvancedSummonName(getSummonBaseName(summon)) || summon.isAdvancedSummon)
      .sort((a, b) => (b.atk + b.mag + b.spd) - (a.atk + a.mag + a.spd));
    if (advancedSummons.length === 0) return;

    for (const summon of advancedSummons) {
      summon.atk = Math.floor(summon.atk * 1.08);
      summon.mag = Math.floor(summon.mag * 1.08);
      refreshStatus(summon, 'BKB', 1, 'summon_revenge_order');
      refreshStatus(summon, 'REGEN', 2);
    }

    this.log('buff', `🧿 【召唤师遗产】${summoner.name} 被 ${killer.name} 击倒，${advancedSummons.length} 只高级召唤物继承最后指令，短暂强化并锁定复仇目标！`);
    const leader = advancedSummons[0];
    if (!leader || !this.isActiveCombatant(leader) || !this.isActiveCombatant(killer)) return;
    this.log('skill', `🧿 【复仇指令】${leader.name} 响应 ${summoner.name} 的最后命令，立刻压制 ${killer.name}！`);
    this.executeSkillAction(null, leader, killer, 1);
  }

  tryMorphlingSonRescue(fighter: Fighter): boolean {
    const MORPHLING_SON = this.JOBS['MORPHLING_SON'];
    if (!fighter.isGamer || fighter.resurrected || !this.fighters.some((candidate) => candidate.isMorphling && this.isActiveCombatant(candidate)) || !MORPHLING_SON) {
      return false;
    }

    fighter.isDead = false;
    fighter.defeatHooksResolved = false;
    fighter.resurrected = true;
    fighter.isSon = true;
    fighter.jobData = cloneJobDefinition(MORPHLING_SON);
    fighter.maxHp = Math.floor(fighter.maxHp * 6);
    fighter.currentHp = fighter.maxHp;
    fighter.atk *= 6;
    fighter.mag *= 6;
    fighter.wis = Math.floor(fighter.wis * 4.0);
    fighter.spd = 100;
    this.syncHpPct(fighter);
    fighter.status = [];
    fighter.isDeadAnnounced = false;
    this.log('buff', `👶 ${fighter.name} 刚被判定退场，就被水人救起！清除了负面状态并转职为【${MORPHLING_SON.name}】！`);
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

    if (f.status.some((s) => s.type === 'VALO_ULT_RUN_IT_BACK')) {
      f.currentHp = f.maxHp;
      this.syncHpPct(f);
      f.status = f.status.filter((s) => s.type !== 'VALO_ULT_RUN_IT_BACK');
      f.isDeadAnnounced = false;
      this.log('heal', `🔥 浴火重生！${f.name} 受到致命伤，触发【再火一回】，原地满血复活！`);
      return;
    }

    if (!this.markDefeated(f, { message: deathMessage ?? formatFallbackDeathMessage(f), killer })) {
      setCurrentHp(f, 0);
    }
    if (f.currentHp > 0 && !f.isDeadAnnounced) return;
    f.isDead = true;
    this.runDefeatHooksOnce(f, spinalSwordRef);

    this.tryMorphlingSonRescue(f);
  }

  checkWinCondition(alive: Fighter[]): boolean {
    return checkWinCondition(this.createTurnFlowRuntime(), alive);
  }

  determineActor(alive: Fighter[]): Fighter | null {
    return determineActor(alive, this.createTurnFlowRuntime());
  }

  handleSelfTimedStatusExpiry(actor: Fighter, type: string): void {
    handleSelfTimedStatusExpiry(this.createStatusProcessingRuntime(), actor, type);
  }

  advanceGlobalTimedStatuses(): void {
    advanceGlobalTimedStatuses(this.fighters, this.turnCount, (type, text) => this.log(type, text));
  }

  finishStep(spinalSwordRef: SpinalSwordRef): void {
    this.handleDeathsAndRevives(spinalSwordRef);
    this.resolveGachaInstantActions(spinalSwordRef);
    this.resolveTokusatsuInstantActions(spinalSwordRef);
    this.resolveChimeraInstantActions(spinalSwordRef);
    this.resolveValorantInstantActions(spinalSwordRef);
    this.resolveGamerInstantActions(spinalSwordRef);
    this.advanceGlobalTimedStatuses();
    runCharacterGlobalTickHooks({ runtime: this.createCharacterHookRuntime() });
    runCharacterReentryHooks({ runtime: this.createCharacterHookRuntime() });
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

      this.log('skill', `👑 【欧气爆发】${actor.name} 欧气满溢，强行插队获得一次命运抽卡机会！`);
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
    if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) return;
    actor.styleTurnCounter = (actor.styleTurnCounter ?? 0) + 1;
    if (actor.styleTurnCounter >= 4) {
      actor.styleTurnCounter = 0;
      this.log('skill', `⏰ 【人设时钟】第 4 回合已到！${actor.name} 准时开启了新一轮的【光速换装】！`);
      this.executeSkillAction('v_rabbit_style_switch', actor, null, 1);
    }
  }

  handleTransformations(tgt: Fighter): void {
    if (tgt.isDead || tgt.transformed || tgt.currentHp >= tgt.maxHp * 0.5) return;

    const transform = (jobKey: string, msg: string, buffFn: () => void) => {
      tgt.transformed = true;
      const jobData = this.JOBS[jobKey];
      if (jobData) tgt.jobData = cloneJobDefinition(jobData);
      tgt.job = jobKey;
      buffFn();
      this.syncHpPct(tgt);
      this.log('transform', msg);
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

  isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
    return counterType === 'CTR_CHARM' && fighter.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR');
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
    if (actor.status.some((s) => s.type === 'SILENCE')) {
      this.log('info', `😶 ${actor.name} 处于【${this.STATUS_EFFECTS.SILENCE?.name ?? '沉默'}】状态，无法发动技能，只能普通攻击！`);
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

    if (Math.random() < (0.3 + actor.wis * 0.005)) {
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
          if (skData.isGacha || (rate > 0 && Math.random() < (rate * (1 + actor.wis * 0.002)))) return s;
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
      getTeamId: (fighter) => this.getTeamId(fighter),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text) => this.log(type, text),
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

  applySkillStatusEffect(skill: SkillDefinition, target: Fighter): void {
    applySkillStatusEffectAction(this.createActionResolutionRuntime(), skill, target);
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

  handlePrimaryTargetDefeat(user: Fighter, target: Fighter): void {
    handlePrimaryTargetDefeatAction(this.createActionResolutionRuntime(), user, target);
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
    executeSkillActionFlow(this.createActionResolutionRuntime(), skId, usr, forcedTarget, triggerDepth);
  }

  handleDeathsAndRevives(spinalSwordRef: SpinalSwordRef): void {
    const runtime = this.createCharacterHookRuntime();
    for (const f of this.fighters) {
      if ((f.currentHp <= 0 || f.isDeadAnnounced) && !f.isDead) {
        this.finalizeFighterDeath(f, spinalSwordRef);
      }

      runCharacterReviveHooks({ fighter: f, runtime, spinalSwordRef });
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
    this.activeSpinalSwordRef = spinalSwordRef;
    this.fighters.forEach((f) => { f.isActing = false; f.isHit = false; });

    const alive = this.fighters.filter((f) => this.isActiveCombatant(f));
    if (this.checkWinCondition(alive)) return true;

    this.turnCount += 1;
    if (this.turnCount === 501) {
      this.log('info', '⏳ 久战不决，战场进入疲劳阶段！所有伤害会随回合推进逐步提高，防止战斗无限拖延。');
    }
    if (this.turnCount === 901) {
      this.log('info', '⏳ 战斗拖入深度疲劳阶段！久战者的防线开始崩坏，伤害提升速度加快。');
    }

    const actor = this.determineActor(alive);
    if (!actor) { this.finishStep(spinalSwordRef); return false; }

    actor.isActing = true;
    this.handleSpinalSwordDrop(actor, spinalSwordRef);

    const canAct = this.processStatus(actor);
    this.handleTransformations(actor);

    if (actor.currentHp <= 0) {
      this.finishStep(spinalSwordRef);
      return false;
    }
    if (!canAct) {
      logUnableToAct(this.createTurnFlowRuntime(), actor);
      this.finishStep(spinalSwordRef);
      return false;
    }

    const waitingCounter = getWaitingCounterStatus(this.createTurnFlowRuntime(), actor);
    if (waitingCounter) {
      logWaitingCounter(this.createTurnFlowRuntime(), actor, waitingCounter);
      this.finishStep(spinalSwordRef);
      return false;
    }

    if (isLuckEmperor(actor) && actor.hpPct <= 0.35) {
      grantGachaLuck(actor, 1, (type, text) => this.log(type, text), '残血仍然行动');
    }

    const skId = this.selectSkill(actor);
    this.executeSkillAction(skId, actor);
    this.advanceBunnyStyleClock(actor);
    this.finishStep(spinalSwordRef);
    return false;
  }
}
