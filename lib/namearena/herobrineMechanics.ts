import type {
  BattleEngineCore,
  BattleLogMetadata,
  BattleState,
  BattleVisualCue,
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  HerobrineCopiedSkillSnapshot,
  HerobrineEventState,
  HerobrineTraceKind,
  JobDefinition,
  NpcUnitKind,
  SkillDefinition,
  SkillPresentation,
  StatusApplication,
} from './types';
import { resolveHealing, setCurrentHp } from './combatState';
import { generateUniqueRuntimeId } from './core';
import { commitFormTransition } from './battlePresentation';
import {
  canTargetAcrossHerobrineBoundary,
  configureNpcUnit,
  getHerobrineEvent,
  isHerobrine,
  isHerobrineClone,
  isHerobrineEventUnit,
  isHerobrineTrace,
  isOnFinalPursuitContestantSide,
  setNpcCombatCapabilities,
} from './npcCombat';
import {
  consumeBarriers,
  hasIdentity,
  initializeEffectState,
  queryMechanic,
  removeBarriers,
  removeEffects,
} from './statusSystem';
import { getStatusIdentityDefinition, identityHasTag, isDirectDamageKind } from './statusRegistry';
import { didDamageConnect, getResolvedDamageTotal, isDamageRedirected } from './damageRedirects';

export const HEROBRINE_WITNESS = 'HEROBRINE_WITNESS';
export const HEROBRINE_WITHER = 'HEROBRINE_WITHER';
export const HEROBRINE_ISOLATED = 'HEROBRINE_ISOLATED';
export const HEROBRINE_DONT_LOOK_BACK = 'HEROBRINE_DONT_LOOK_BACK';
export const HEROBRINE_SETTLEMENT_PROMPTS = ['Removed Herobrine.', '……你确定吗？'] as const;

export const HEROBRINE_SPAWN_START_TURN = 30;
export const HEROBRINE_SPAWN_END_TURN = 260;
export const HEROBRINE_MAJOR_EVENT_CHANCE = 0.0015;
export const HEROBRINE_MIN_CONTESTANTS = 5;

const HEROBRINE_TEAM = 'HEROBRINE_EVENT';
const HEROBRINE_CANONICAL_NAME = 'Herobrine';
const HEROBRINE_HIDDEN_NAME = '【未知】';
const FOG_REVEAL_TURNS = 10;
const FOG_HIDDEN_ATTACK_TURN = 5;
const FOG_BEHIND_DURATION = 5;
const FOG_BEHIND_DIRECT_HITS = 3;
const FOG_BEHIND_COOLDOWN_ROUNDS = 2;
const PHASE_TWO_TURN_THRESHOLD = 40;
const REMOVED_RETURN_TURNS = 10;
const SINGLE_WORLD_COOLDOWN_ROUNDS = 2;
const WORLD_SEED_COOLDOWN_TURNS = 4;
const DONT_LOOK_BACK_COOLDOWN_ROUNDS = 2;
const MAX_CLONES = 3;
const HEROBRINE_COPYABLE_STATUS_IDENTITIES = new Set([
  'STUN',
  'FREEZE',
  'BURN',
  'POISON',
  'BLEED',
  'BLIND',
  'SILENCE',
  'CONFUSED',
  'EMBARRASSED',
  'CHARMED',
  'WEAK',
  'AIRBORNE',
]);

const HEROBRINE_PHASE_ONE_STATS = {
  atk: 220,
  def: 185,
  spd: 145,
  agl: 125,
  mag: 220,
  res: 185,
  wis: 170,
  critRate: 0.1,
};

const CLONE_STATS = {
  hp: 700,
  atk: 120,
  def: 80,
  spd: 115,
  agl: 95,
  mag: 120,
  res: 80,
  wis: 60,
  critRate: 0.05,
};

const TRACE_STATS: Record<HerobrineTraceKind, { hp: number; def: number; res: number }> = {
  tunnel: { hp: 1400, def: 100, res: 100 },
  leafless_tree: { hp: 1600, def: 115, res: 115 },
  sand_pyramid: { hp: 1200, def: 90, res: 90 },
};

const TRACE_NAMES: Record<HerobrineTraceKind, {
  name: string;
  icon: string;
  unitKind: Extract<NpcUnitKind, 'herobrine_tunnel' | 'herobrine_leafless_tree' | 'herobrine_sand_pyramid'>;
}> = {
  tunnel: { name: '二乘二隧道', icon: '⬛', unitKind: 'herobrine_tunnel' },
  leafless_tree: { name: '无叶之树', icon: '🌳', unitKind: 'herobrine_leafless_tree' },
  sand_pyramid: { name: '沙土金字塔', icon: '🔺', unitKind: 'herobrine_sand_pyramid' },
};

interface HerobrineActionDescriptor {
  skillId: string;
  skillName: string;
  presentation?: SkillPresentation;
  targets?: Fighter[];
}

function runHerobrineAction(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  descriptor: HerobrineActionDescriptor,
  callback: () => void,
  options: { anonymous?: boolean } = {},
): void {
  const event = getHerobrineEvent(runtime.battleState);
  const anonymous = options.anonymous === true ||
    (!!event?.hiddenUntilTurn && event.hiddenUntilTurn > runtime.turnCount);
  if (!anonymous) {
    runtime.runAction(herobrine, descriptor, callback);
    return;
  }

  const previousName = herobrine.name;
  const previousDisplayName = herobrine.displayName;
  herobrine.name = HEROBRINE_HIDDEN_NAME;
  herobrine.displayName = HEROBRINE_HIDDEN_NAME;
  try {
    runtime.runAction(herobrine, descriptor, callback);
  } finally {
    const currentEvent = getHerobrineEvent(runtime.battleState);
    const identityMustBeVisible =
      currentEvent?.completed === true ||
      currentEvent?.finalPursuit === true ||
      !currentEvent?.hiddenUntilTurn ||
      currentEvent.hiddenUntilTurn <= runtime.turnCount;
    if (identityMustBeVisible) {
      restoreHerobrineIdentity(herobrine);
    } else {
      herobrine.name = previousName;
      herobrine.displayName = previousDisplayName;
    }
  }
}

function hideHerobrineIdentity(herobrine: Fighter): void {
  herobrine.name = HEROBRINE_HIDDEN_NAME;
  herobrine.displayName = HEROBRINE_HIDDEN_NAME;
}

function restoreHerobrineIdentity(herobrine?: Fighter): void {
  if (!herobrine) return;
  herobrine.name = HEROBRINE_CANONICAL_NAME;
  herobrine.displayName = HEROBRINE_CANONICAL_NAME;
}

export interface HerobrineRuntime {
  fighters: Fighter[];
  battleState: BattleState;
  core: BattleEngineCore;
  skills: Record<string, SkillDefinition>;
  skillTags: Record<string, string>;
  turnCount: number;
  largeRound: number;
  /** Number of currently nested action scopes, including the action being closed. */
  activeActionDepth: number;
  completedLargeRound?: number;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  isActiveCombatant: (fighter: Fighter) => boolean;
  getTeamId: (fighter: Fighter) => string;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  applyStatus: (target: Fighter, application: StatusApplication) => boolean;
  dispelStatusEffects: (
    target: Fighter,
    options: import('./types').DispelOptions,
  ) => import('./types').DispelResolution;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  getSelectableTargets: (fighter: Fighter) => Fighter[];
  resolveTarget: (
    user: Fighter,
    forcedTarget: Fighter | null,
    currentTargets: Fighter[],
  ) => { target: Fighter; isIntercepted: boolean; protectedTarget?: Fighter } | null;
  handleWaitCounter: (target: Fighter, user: Fighter, triggerDepth: number, actionName?: string) => boolean;
  handleCounterStatus: (target: Fighter, user: Fighter) => boolean;
  dodgesWithPassiveSkill: (user: Fighter, target: Fighter, actionName?: string) => boolean;
  runAction: (actor: Fighter, descriptor: HerobrineActionDescriptor, callback: () => void) => void;
}

export type HerobrineSpawnRuntime = Pick<
  HerobrineRuntime,
  'fighters' | 'battleState' | 'core' | 'turnCount' | 'largeRound' | 'log' | 'isActiveCombatant'
>;

function npcJob(name: string, icon: string): JobDefinition {
  return {
    name,
    icon,
    hp: 1,
    atk: 1,
    def: 1,
    spd: 1,
    agl: 1,
    mag: 1,
    res: 1,
    wis: 1,
    skills: [],
  };
}

function uniqueNpcId(runtime: Pick<HerobrineRuntime, 'fighters' | 'core'>, prefix: string): string {
  return generateUniqueRuntimeId(
    runtime.fighters.map((fighter) => fighter.id),
    () => runtime.core.generateUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2)}`,
    prefix,
  );
}

function makeNpc(
  runtime: Pick<HerobrineRuntime, 'fighters' | 'core'>,
  name: string,
  icon: string,
  hp: number,
  stats: Partial<typeof HEROBRINE_PHASE_ONE_STATS> = {},
  jobKey = 'NPC',
  jobName = name,
): Fighter {
  const jobData = npcJob(jobName, icon);
  const fighter: Fighter = {
    id: uniqueNpcId(runtime, 'herobrine'),
    name,
    displayName: name,
    job: jobKey,
    jobData,
    maxHp: hp,
    currentHp: hp,
    hpPct: 1,
    atk: stats.atk ?? 1,
    def: stats.def ?? 1,
    spd: stats.spd ?? 1,
    agl: stats.agl ?? 1,
    mag: stats.mag ?? 1,
    res: stats.res ?? 1,
    wis: stats.wis ?? 1,
    critRate: stats.critRate ?? 0,
    color: 'from-zinc-950 to-stone-600',
    isDead: false,
    isDeadAnnounced: false,
    statuses: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    teamId: HEROBRINE_TEAM,
  };
  initializeEffectState(fighter);
  return fighter;
}

function activeContestants(runtime: Pick<HerobrineRuntime, 'fighters' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    !fighter.isNpc &&
    !fighter.isSummon &&
    !fighter.cannotWin,
  );
}

function witnessEligibleUnits(runtime: Pick<HerobrineRuntime, 'fighters' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    !fighter.isNpc &&
    (!fighter.cannotWin || fighter.isSummon) &&
    fighter.owlSummonState?.kind !== 'meal' &&
    fighter.owlSummonState?.kind !== 'rice' &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING'),
  );
}

function witnessEligibleFromSource(runtime: HerobrineRuntime, source: Fighter): Fighter[] {
  return witnessEligibleUnits(runtime).filter((target) =>
    canTargetAcrossHerobrineBoundary(runtime.battleState, source, target),
  );
}

function randomPick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function randomSample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const result: T[] = [];
  while (pool.length > 0 && result.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) result.push(item);
  }
  return result;
}

function traceScale(contestantCount: number): number {
  return 1 + Math.min(0.45, Math.max(0, contestantCount - 5) * 0.05);
}

function createHerobrine(runtime: Pick<HerobrineRuntime, 'fighters' | 'core'>, contestantCount: number): Fighter {
  const maxHp = Math.min(20250, Math.max(8000, 8000 + Math.max(0, contestantCount - 5) * 1250));
  const fighter = makeNpc(
    runtime,
    HEROBRINE_CANONICAL_NAME,
    '◻️',
    maxHp,
    HEROBRINE_PHASE_ONE_STATS,
    'HEROBRINE_FOG',
    '雾中人',
  );
  configureNpcUnit(fighter, 'herobrine', 'herobrine', {
    actionMode: 'none',
    visible: false,
    targetable: false,
    aoeVulnerable: false,
    blocksSettlement: true,
  });
  return fighter;
}

function createTrace(
  runtime: Pick<HerobrineRuntime, 'fighters' | 'core'>,
  kind: HerobrineTraceKind,
  contestantCount: number,
): Fighter {
  const definition = TRACE_NAMES[kind];
  const stats = TRACE_STATS[kind];
  const scale = traceScale(contestantCount);
  const fighter = makeNpc(
    runtime,
    definition.name,
    definition.icon,
    Math.floor(stats.hp * scale),
    {
      def: Math.floor(stats.def * scale),
      res: Math.floor(stats.res * scale),
      spd: 1,
      agl: 1,
    },
  );
  configureNpcUnit(fighter, 'herobrine', definition.unitKind, {
    actionMode: 'none',
    visible: true,
    targetable: kind === 'sand_pyramid',
    aoeVulnerable: kind === 'sand_pyramid',
    blocksSettlement: false,
  });
  if (fighter.npcUnitState) {
    fighter.npcUnitState.traceKind = kind;
    fighter.npcUnitState.exposed = kind === 'sand_pyramid';
  }
  return fighter;
}

function getEventHerobrine(runtime: Pick<HerobrineRuntime, 'fighters' | 'battleState'>): Fighter | undefined {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event?.herobrineId) return undefined;
  return runtime.fighters.find((fighter) => fighter.id === event.herobrineId);
}

function getEventTraces(runtime: Pick<HerobrineRuntime, 'fighters' | 'battleState'>): Fighter[] {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event) return [];
  const ids = new Set(event.traceIds);
  return runtime.fighters.filter((fighter) => ids.has(fighter.id) && isHerobrineTrace(fighter));
}

function activeTraces(runtime: HerobrineRuntime, kind?: HerobrineTraceKind): Fighter[] {
  return getEventTraces(runtime).filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    (kind === undefined || fighter.npcUnitState?.traceKind === kind),
  );
}

function setTraceExposure(trace: Fighter, exposed: boolean): void {
  if (!isHerobrineTrace(trace) || trace.npcUnitState?.traceKind === 'sand_pyramid') return;
  if (trace.npcUnitState) trace.npcUnitState.exposed = exposed;
  setNpcCombatCapabilities(trace, {
    targetable: exposed,
    aoeVulnerable: exposed,
  });
}

function clearHerobrineTargetLocks(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  context: {
    title?: string;
    action?: string;
  } = {},
): void {
  const removed = removeEffects(herobrine, {
    identityIds: [
      'YUZU_MARKED',
      'WT_SCOUTED',
      'OWL_RIVER_MARK',
      'GAMER_READ_INPUTS',
      'VALO_CYPHER_REVEALED',
    ],
    reason: 'scripted',
  });
  let pointerCount = 0;
  for (const fighter of runtime.fighters) {
    if (fighter.yuzuMarkedTargetId === herobrine.id) {
      fighter.yuzuMarkedTargetId = undefined;
      fighter.yuzuMarkedHitCount = 0;
      fighter.yuzuFuriosoCountedTurn = undefined;
      pointerCount += 1;
    }
    if (fighter.wtMarkedTargetId === herobrine.id) {
      fighter.wtMarkedTargetId = undefined;
      pointerCount += 1;
    }
    if (fighter.owlState?.riverMarkedTargetId === herobrine.id) {
      delete fighter.owlState.riverMarkedTargetId;
      delete fighter.owlState.riverMarkExpiresTurn;
      pointerCount += 1;
    }
    if (fighter.gamerMarkedTargetId === herobrine.id) {
      delete fighter.gamerMarkedTargetId;
      pointerCount += 1;
    }
  }
  if (removed.length > 0 || pointerCount > 0) {
    runtime.log('info', `⬛ 【${context.title ?? '雾后之人·脱锁'}】${herobrine.name} ${context.action ?? '没入隧道'}，清除了 ${removed.length + pointerCount} 项追踪、侦察或唯一目标锁定。`, {
      actorId: herobrine.id,
      actorName: herobrine.name,
      targetIds: [herobrine.id],
    });
  }
}

export function getWitnessStacks(fighter: Fighter): number {
  return Math.max(0, Math.min(5, Math.floor(queryMechanic(fighter, HEROBRINE_WITNESS).potency)));
}

export function hasSeenThroughHerobrine(fighter: Fighter): boolean {
  return getWitnessStacks(fighter) >= 3;
}

export function isHerobrineAttackHitKind(
  sourceKind: DamageApplicationOptions['sourceKind'],
): boolean {
  return isDirectDamageKind(sourceKind) || sourceKind === 'counter';
}

export function applyHerobrineWitness(
  runtime: HerobrineRuntime,
  target: Fighter,
  amount = 1,
  reason = '直视了白色眼睛',
  source?: Fighter,
): number {
  if (amount <= 0 || target.isNpc || !runtime.isActiveCombatant(target)) return 0;
  const before = getWitnessStacks(target);
  if (before >= 5) return 0;
  const gained = Math.min(5 - before, Math.max(1, Math.floor(amount)));
  const attributionSource = source ?? getEventHerobrine(runtime);
  const attributionName = attributionSource?.name ?? 'Herobrine';
  const applied = runtime.applyStatus(target, {
    identityId: HEROBRINE_WITNESS,
    potency: gained,
    silent: true,
    attribution: {
      effectSourceId: attributionSource?.id
        ? `herobrine:witness:${attributionSource.id}`
        : 'herobrine:witness',
      effectSourceName: attributionName,
      applierId: attributionSource?.id,
      applierName: attributionName,
    },
  });
  if (!applied) return 0;
  const after = getWitnessStacks(target);
  const actualGain = after - before;
  if (actualGain <= 0) return 0;
  runtime.log(
    after >= 3 ? 'debuff' : 'info',
    `◻️ 【目击】${target.name} 因${reason}增加 ${actualGain} 层目击（当前 ${after}/5）${after === 3 ? '；其已能看破部分异常，并获得对 Herobrine 的反制能力' : ''}。`,
    { actorId: attributionSource?.id, actorName: attributionName, targetIds: [target.id] },
  );
  return actualGain;
}

export function clearHerobrineWitness(target: Fighter): number {
  const before = getWitnessStacks(target);
  if (before <= 0) return 0;
  removeEffects(target, { identityIds: [HEROBRINE_WITNESS], reason: 'absolute_dispel' });
  return before;
}

function completedRoundAfterOneFullLargeRound(runtime: HerobrineSpawnRuntime): number {
  const round = runtime.battleState.largeRound;
  const currentRoundHasStarted = round.actionCount > 0 || round.actedIds.length > 0;
  return runtime.largeRound + (currentRoundHasStarted ? 1 : 0);
}

export function spawnHerobrineEvent(runtime: HerobrineSpawnRuntime, reason = '白色眼睛出现在雾里'): Fighter | undefined {
  if (runtime.battleState.majorNpcEvent || runtime.fighters.some(isHerobrineEventUnit)) return undefined;
  const contestants = activeContestants(runtime);
  if (contestants.length === 0) return undefined;

  const herobrine = createHerobrine(runtime, contestants.length);
  runtime.fighters.push(herobrine);
  const traceKinds = randomSample<HerobrineTraceKind>(
    ['tunnel', 'leafless_tree', 'sand_pyramid'],
    2,
  );
  const traces: Fighter[] = [];
  traceKinds.forEach((kind) => {
    const trace = createTrace(runtime, kind, contestants.length);
    runtime.fighters.push(trace);
    traces.push(trace);
  });

  const event: HerobrineEventState = {
    kind: 'herobrine',
    startedTurn: runtime.turnCount,
    phase: 'fog',
    hiddenAttackResolved: false,
    traceIds: traces.map((trace) => trace.id),
    cloneIds: [],
    herobrineId: herobrine.id,
    revivalCount: 0,
    directDamageMultiplier: 1,
    herobrineActionCount: 0,
    phaseActionCount: 0,
    attackedThisLargeRoundIds: [],
    firstShieldBypassConsumedIds: [],
    finalPursuit: false,
    completed: false,
    recentSkills: {},
  };
  runtime.battleState.majorNpcEvent = event;

  const pyramid = traces.find((trace) => trace.npcUnitState?.traceKind === 'sand_pyramid');
  if (pyramid?.npcUnitState) {
    const marked = randomPick(witnessEligibleUnits(runtime));
    pyramid.npcUnitState.markedTargetId = marked?.id;
    pyramid.npcUnitState.collapseAfterLargeRound = completedRoundAfterOneFullLargeRound(runtime);
  }

  runtime.log('system', `◻️ 【异常目击】${reason}。雾里没有出现可供攻击的敌人，但战场留下了 ${traces.map((trace) => `【${trace.name}】`).join('与')}。`);
  for (const trace of traces) {
    const kind = trace.npcUnitState?.traceKind;
    if (kind === 'tunnel') {
      runtime.log('info', '⬛ 【二乘二隧道】规整得不自然的隧道横在雾中；它暂时无法被选中，也不受范围攻击影响。');
    } else if (kind === 'leafless_tree') {
      runtime.log('info', '🌳 【无叶之树】没有一片叶子的树静立场边；它暂时无法被选中，也不受范围攻击影响。');
    } else {
      const marked = runtime.fighters.find((fighter) => fighter.id === trace.npcUnitState?.markedTargetId);
      runtime.log('debuff', `🔺 【沙土金字塔】异常沙土开始坍缩，锁定 ${marked?.name ?? '一名参赛者'}；若一个大回合内未被摧毁，它将波及多人。`);
    }
  }
  return herobrine;
}

export function getHerobrineDamageMultiplier(attacker: Fighter | undefined, target: Fighter): number {
  if (!attacker) return 1;
  if (isHerobrine(attacker)) {
    const witnessBonus = getWitnessStacks(target) >= 2 ? 1.2 : 1;
    return witnessBonus;
  }
  if (!attacker.isNpc && isHerobrineEventUnit(target) && getWitnessStacks(attacker) >= 3) {
    return 1.2;
  }
  return 1;
}

export function shouldHerobrineBypassShield(
  state: BattleState,
  attacker: Fighter | undefined,
  target: Fighter,
): boolean {
  const event = getHerobrineEvent(state);
  if (!event || !isHerobrine(attacker) || getWitnessStacks(target) < 5) return false;
  return !event.firstShieldBypassConsumedIds.includes(target.id);
}

export function consumeHerobrineShieldBypass(state: BattleState, target: Fighter): void {
  const event = getHerobrineEvent(state);
  if (!event || event.firstShieldBypassConsumedIds.includes(target.id)) return;
  event.firstShieldBypassConsumedIds.push(target.id);
}

function mixedAttackDamage(attacker: Fighter, target: Fighter, multiplier = 1): number {
  const roll = 0.94 + Math.random() * 0.12;
  const physical = Math.max(1, attacker.atk * 0.65 * roll - target.def * 0.32);
  const magical = Math.max(1, attacker.mag * 0.65 * roll - target.res * 0.32);
  return Math.max(1, Math.floor((physical + magical) * multiplier));
}

function hitChance(attacker: Fighter, target: Fighter): number {
  const witness = getWitnessStacks(target);
  const evadeIgnored = witness >= 2 ? 0.3 : 0;
  const agilityGap = (attacker.agl - target.agl * (1 - evadeIgnored)) * 0.0012;
  return Math.max(0.68, Math.min(0.98, 0.88 + agilityGap));
}

function chooseHerobrineTarget(runtime: HerobrineRuntime, herobrine: Fighter): Fighter | undefined {
  const event = getHerobrineEvent(runtime.battleState);
  if (event?.singleWorld) {
    const isolated = runtime.fighters.find((fighter) => fighter.id === event.singleWorld?.targetId);
    return isolated && runtime.isActiveCombatant(isolated) ? isolated : undefined;
  }
  if (event?.finalPursuit) {
    const contestants = activeContestants(runtime);
    return contestants.length === 1 ? contestants[0] : undefined;
  }
  const candidates = witnessEligibleUnits(runtime).filter((fighter) => fighter.id !== herobrine.id);
  if (candidates.length === 0) return undefined;
  const maxWitness = Math.max(...candidates.map(getWitnessStacks));
  const highest = candidates.filter((fighter) => getWitnessStacks(fighter) === maxWitness);
  return randomPick(Math.random() < 0.78 ? highest : candidates);
}

function resolveHerobrineAttackTarget(
  runtime: HerobrineRuntime,
  attacker: Fighter,
  intendedTarget: Fighter,
  actionName: string,
): { target: Fighter; isIntercepted: boolean } | undefined {
  const result = runtime.resolveTarget(
    attacker,
    intendedTarget,
    runtime.getSelectableTargets(attacker),
  );
  if (!result) return undefined;
  if (result.isIntercepted && result.protectedTarget) {
    runtime.log(
      'info',
      `🛡️ 【傀儡援护】${result.target.name} 挡在 ${result.protectedTarget.name} 身前，接管 ${attacker.name} 的【${actionName}】！`,
      {
        actorId: result.target.id,
        actorName: result.target.name,
        targetIds: [result.target.id, result.protectedTarget.id],
      },
    );
  }
  return { target: result.target, isIntercepted: result.isIntercepted };
}

function maybeTriggerWitnessFollowup(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  target: Fighter,
  connectedAmount: number,
  allowFollowup = true,
  hidden = false,
): void {
  if (
    !allowFollowup ||
    connectedAmount <= 0 ||
    getWitnessStacks(target) < 4 ||
    !runtime.isActiveCombatant(herobrine) ||
    !runtime.isActiveCombatant(target) ||
    Math.random() >= 0.35
  ) return;
  runtime.log('debuff', `👁️ 【他就在身后】${target.name} 回头时，${herobrine.name} 已经再次站在身后！`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: [target.id],
  });
  attackWithEmptyGaze(runtime, herobrine, target, {
    hidden,
    enhanced: false,
    applyWitness: false,
    allowFollowup: false,
    actionName: '身后追击',
    secondaryVisual: true,
  });
}

function attackWithEmptyGaze(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  intendedTarget: Fighter,
  options: {
    hidden?: boolean;
    enhanced?: boolean;
    applyWitness?: boolean;
    allowFollowup?: boolean;
    actionName?: string;
    presentation?: SkillPresentation;
    secondaryVisual?: boolean;
  } = {},
): number {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || !runtime.isActiveCombatant(intendedTarget)) return 0;
  const actorName = options.hidden ? '【未知】' : herobrine.name;
  const actionName = options.actionName ?? '空洞凝视';
  const targetResolution = resolveHerobrineAttackTarget(
    runtime,
    herobrine,
    intendedTarget,
    actionName,
  );
  if (!targetResolution) return 0;
  const target = targetResolution.target;
  const effectId = options.hidden ? 'herobrine_hidden_strike' : 'herobrine_empty_gaze';
  const visualCue: BattleVisualCue = options.secondaryVisual
    ? {
        kind: 'combat_fx',
        effectId,
        sourceId: herobrine.id,
        targetIds: [target.id],
      }
    : {
        kind: 'combat_action',
        sourceId: herobrine.id,
        targetIds: [target.id],
        presentation: options.presentation ?? 'basic',
        effectId,
      };
  if (Math.random() > hitChance(herobrine, target)) {
    runtime.log('info', `🌫️ 【${actionName}】${actorName} 的白眼在 ${target.name} 身后闪过，但攻击落空。`, {
      actorId: herobrine.id,
      actorName,
      targetIds: [target.id],
      skillId: 'herobrine_empty_gaze',
      skillName: actionName,
      visualCue,
    });
    return 0;
  }
  if (runtime.handleWaitCounter(target, herobrine, 1, actionName)) return 0;
  if (runtime.handleCounterStatus(target, herobrine)) return 0;
  if (!runtime.isActiveCombatant(herobrine)) return 0;
  if (runtime.dodgesWithPassiveSkill(herobrine, target, actionName)) return 0;

  const noFootsteps =
    !event.attackedThisLargeRoundIds.includes(target.id) &&
    !options.hidden;
  const criticalChance = Math.min(1, Math.max(0, (herobrine.critRate ?? 0) + (noFootsteps ? 0.25 : 0)));
  const critical = Math.random() < criticalChance;
  const multiplier =
    (options.hidden ? 0.6 : 1) *
    (options.enhanced ? 1.25 : 1) *
    (noFootsteps ? 1.22 : 1) *
    (critical ? 1.5 : 1) *
    event.directDamageMultiplier;
  const damage = mixedAttackDamage(herobrine, target, multiplier);
  const damageOptions: DamageApplicationOptions = {
    actionName,
    sourceKind: 'custom',
    damageScope: 'magical',
    respectDefenses: true,
    bypassSpellBlock: event.finalPursuit,
    deferTransform: true,
  };
  runtime.log(
    'skill',
    `◻️ 【${actionName}】${actorName} 以物理与魔法混合冲击袭向 ${target.name}${noFootsteps ? '；目标本大回合未受他人攻击，【没有脚步声】强化了追猎' : ''}${critical ? '；白色眼睛锁住破绽，本次攻击暴击' : ''}！`,
    {
      actorId: herobrine.id,
      actorName,
      targetIds: [target.id],
      skillId: 'herobrine_empty_gaze',
      skillName: actionName,
      visualCue,
    },
  );
  const actual = runtime.applyDamage(target, damage, 'skill', false, herobrine, damageOptions);
  runtime.flushDeferredDamageEvents(target, 'mitigation');
  const resolvedHpDamage = getResolvedDamageTotal(actual, damageOptions);
  const redirectedHpDamage = Math.max(0, resolvedHpDamage - actual);
  const barrierDamage = (damageOptions.barrierAbsorptions ?? []).reduce((sum, item) => sum + item.amount, 0);
  const total = resolvedHpDamage + barrierDamage;
  const connected = total > 0 || didDamageConnect(actual, damageOptions);
  const resolvedActorName = event.finalPursuit || event.completed
    ? HEROBRINE_CANONICAL_NAME
    : actorName;
  runtime.log(
    total > 0 ? 'skill' : 'info',
    `◻️ 【${actionName}结算】${resolvedActorName} 对 ${target.name} 造成 ${actual} 点实际生命伤害${redirectedHpDamage > 0 ? `，分摊或替代承伤者另承受 ${redirectedHpDamage} 点生命伤害` : ''}${barrierDamage > 0 ? `，另有 ${barrierDamage} 点被护盾吸收` : ''}。`,
    { actorId: herobrine.id, actorName: resolvedActorName, targetIds: [target.id] },
  );
  runtime.flushDeferredDamageEvents(target);
  if (connected && options.applyWitness !== false) {
    applyHerobrineWitness(runtime, target, 1, `成为【${actionName}】的锁定目标而`);
  }
  if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    runtime.markDefeated(target, {
      message: `💀 【${actionName}】${target.name} 被 ${resolvedActorName} 的白色眼睛拖入雾中！`,
      killer: herobrine,
    });
  }
  if (event.completed || event.finalPursuit) return actual;
  maybeTriggerWitnessFollowup(
    runtime,
    herobrine,
    target,
    total,
    options.allowFollowup !== false,
    options.hidden === true,
  );
  return actual;
}

function spawnClone(runtime: HerobrineRuntime): Fighter | undefined {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event) return undefined;
  const activeCloneCount = event.cloneIds
    .map((id) => runtime.fighters.find((fighter) => fighter.id === id))
    .filter((fighter): fighter is Fighter => !!fighter && runtime.isActiveCombatant(fighter)).length;
  if (activeCloneCount >= MAX_CLONES) return undefined;
  const index = event.cloneIds.length + 1;
  const clone = makeNpc(
    runtime,
    'Herobrine',
    '◻️',
    CLONE_STATS.hp,
    CLONE_STATS,
    'HEROBRINE_CLONE',
    '远处的白眼',
  );
  configureNpcUnit(clone, 'herobrine', 'herobrine_clone', {
    actionMode: 'normal',
    visible: true,
    targetable: true,
    aoeVulnerable: true,
    blocksSettlement: false,
  });
  if (clone.npcUnitState) {
    clone.npcUnitState.revealed = false;
    clone.npcUnitState.cloneIndex = index;
  }
  runtime.fighters.push(clone);
  event.cloneIds.push(clone.id);
  return clone;
}

function spawnCloneAction(runtime: HerobrineRuntime, herobrine: Fighter, count: number): void {
  const created: Fighter[] = [];
  for (let index = 0; index < count; index += 1) {
    const clone = spawnClone(runtime);
    if (clone) created.push(clone);
  }
  if (created.length === 0) {
    runtime.log('info', '▫️ 【错误的玩家】白眼分身数量已经达到上限，雾中的影子没有继续增加。');
    return;
  }
  runtime.log('skill', `▫️ 【错误的玩家】${herobrine.name} 在雾中留下 ${created.length} 个无法立刻辨认真假的白眼分身；未被识破前，它们都会显示为 Herobrine。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: created.map((clone) => clone.id),
    skillId: 'herobrine_wrong_player',
    skillName: '错误的玩家',
  });
}

function ordinaryPositiveStatus(target: Fighter) {
  return target.statuses
    .filter((status) => {
      const identity = getStatusIdentityDefinition(status.identityId);
      return identity.polarity === 'positive' &&
        identity.dispelTier === 'normal' &&
        identity.tickMode !== 'permanent' &&
        !identityHasTag(status.identityId, 'important_removal');
    })
    .sort((a, b) => a.appliedSequence - b.appliedSequence)[0];
}

function stripOneBenefit(runtime: HerobrineRuntime, target: Fighter, sourceName: string): boolean {
  const status = ordinaryPositiveStatus(target);
  if (status) {
    const definition = getStatusIdentityDefinition(status.identityId);
    const groupedInstanceIds = status.groupId
      ? target.statuses
          .filter((candidate) => candidate.groupId === status.groupId)
          .map((candidate) => candidate.instanceId)
      : [status.instanceId];
    const resolution = runtime.dispelStatusEffects(target, {
      strength: 'normal',
      direction: 'positive',
      instanceIds: groupedInstanceIds,
      // The tree emits a more specific cause-and-result line below.
      emitLog: () => undefined,
    });
    if (resolution.removed.length > 0) {
      runtime.log('debuff', `🌳 【${sourceName}】${target.name} 身上的【${definition.displayName}】被无声剥去。`);
      return true;
    }
  }
  const barrier = (target.barriers ?? [])
    .filter((entry) => entry.value > 0 && entry.polarity === 'positive')
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
  if (barrier) {
    const stripped = Math.max(1, Math.floor(barrier.value * 0.35));
    const resolution = consumeBarriers(target, stripped, { barrierIds: [barrier.id] });
    if (resolution.absorbed > 0) {
      runtime.log('debuff', `🌳 【${sourceName}】${target.name} 的【${barrier.displayName}】被无叶枝条削去 ${resolution.absorbed} 点，剩余 ${Math.max(0, barrier.value)} 点。`);
      return true;
    }
  }
  return false;
}

function applyWither(
  runtime: HerobrineRuntime,
  target: Fighter,
  sourceName: string,
  strippedBenefit = false,
): boolean {
  const applied = runtime.applyStatus(target, {
    identityId: HEROBRINE_WITHER,
    remainingTurns: 1,
    silent: true,
    attribution: {
      effectSourceId: 'herobrine:leafless_tree',
      effectSourceName: sourceName,
    },
  });
  if (!applied) return false;
  runtime.log(
    'debuff',
    strippedBenefit
      ? `🌫️ 【枯萎】${target.name} 的普通增益或护盾被剥去后，治疗与护盾获取量继续降低 30%，持续至下个大回合。`
      : `🌫️ 【枯萎】${target.name} 没有可剥离的普通增益，治疗与护盾获取量降低 30%，持续至下个大回合。`,
  );
  return true;
}

function useStrippedLeaves(runtime: HerobrineRuntime, herobrine: Fighter): void {
  const hidden = (getHerobrineEvent(runtime.battleState)?.hiddenUntilTurn ?? 0) > runtime.turnCount;
  const candidates = witnessEligibleFromSource(runtime, herobrine);
  const count = Math.min(candidates.length, 1 + Math.floor(Math.random() * 3));
  const targets = randomSample(candidates, count);
  runtime.log('skill', `🌳 【被剥去的树叶】${herobrine.name} 令枯枝掠过 ${targets.map((target) => target.name).join('、')}。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: targets.map((target) => target.id),
    visualCue: {
      kind: 'combat_action',
      sourceId: herobrine.id,
      targetIds: targets.map((target) => target.id),
      presentation: 'skill',
      effectId: 'herobrine_stripped_leaves',
    },
  });
  for (const target of targets) {
    if (getHerobrineEvent(runtime.battleState)?.completed) break;
    const stripped = stripOneBenefit(runtime, target, '被剥去的树叶');
    if (stripped) {
      applyWither(runtime, target, '被剥去的树叶', true);
      continue;
    }
    const damageOptions: DamageApplicationOptions = {
      actionName: '被剥去的树叶',
      sourceKind: 'custom',
      damageScope: 'magical',
      respectDefenses: true,
      deferTransform: true,
    };
    const event = getHerobrineEvent(runtime.battleState);
    const damage = Math.max(1, Math.floor(herobrine.mag * 0.58 * (event?.directDamageMultiplier ?? 1)));
    const actual = runtime.applyDamage(target, damage, 'skill', false, herobrine, damageOptions);
    runtime.flushDeferredDamageEvents(target, 'mitigation');
    runtime.log('skill', `🌳 【被剥去的树叶】${target.name} 无可剥离的效果，实际受到 ${actual} 点魔法伤害。`);
    runtime.flushDeferredDamageEvents(target);
    const connectedDamage = actual + (damageOptions.barrierAbsorptions ?? [])
      .reduce((sum, absorption) => sum + absorption.amount, 0);
    const connected = connectedDamage > 0 || didDamageConnect(actual, damageOptions);
    if (connected && !isDamageRedirected(damageOptions)) {
      applyHerobrineWitness(runtime, target, 1, '被枯枝直接触及');
    }
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【被剥去的树叶】${target.name} 被无叶枝条拖入浓雾！`,
        killer: herobrine,
      });
    }
    maybeTriggerWitnessFollowup(runtime, herobrine, target, connectedDamage, true, hidden);
  }
}

function chooseWeighted<T extends string>(entries: Array<{ value: T; weight: number }>): T | undefined {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return undefined;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1]?.value;
}

function enterFogBehind(runtime: HerobrineRuntime, herobrine: Fighter): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.phase !== 'phase_one' && event.phase !== 'phase_two') return false;
  if (!runtime.isActiveCombatant(herobrine)) return false;
  if (event.singleWorld || event.finalPursuit || event.hiddenUntilTurn !== undefined) return false;
  if ((event.directHitsSinceFog ?? 0) < FOG_BEHIND_DIRECT_HITS) return false;
  if ((event.fogCooldownUntilLargeRound ?? 0) > runtime.largeRound) return false;
  if (activeTraces(runtime, 'tunnel').length === 0) return false;
  event.directHitsSinceFog = 0;
  event.hiddenUntilTurn = runtime.turnCount + FOG_BEHIND_DURATION;
  clearHerobrineTargetLocks(runtime, herobrine);
  setNpcCombatCapabilities(herobrine, {
    actionMode: 'normal',
    visible: false,
    targetable: false,
    aoeVulnerable: false,
  });
  runtime.log('skill', `⬛ 【雾后之人】${herobrine.name} 在连续承受 ${FOG_BEHIND_DIRECT_HITS} 次直接攻击后解除锁定，退入二乘二隧道；接下来 ${FOG_BEHIND_DURATION} 个全局行动中，他仍会从雾后发动攻击。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: activeTraces(runtime, 'tunnel').map((trace) => trace.id),
  });
  hideHerobrineIdentity(herobrine);
  return true;
}

function revealHerobrine(runtime: HerobrineRuntime, reason: string): void {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (!event || !herobrine || event.phase !== 'fog') return;
  restoreHerobrineIdentity(herobrine);
  commitFormTransition({
    fighter: herobrine,
    log: runtime.log,
    kind: 'form_shift',
    cause: 'form_change',
    message: `◻️ 【远处的白眼】${reason}。当你试图看清那个人影时，他已经不在那里了。Herobrine 正式加入战斗。`,
    mutate: () => {
      event.phase = 'phase_one';
      event.formalAppearanceTurn = runtime.turnCount;
      event.phaseActionCount = 0;
      herobrine.job = 'HEROBRINE_PHASE_ONE';
      herobrine.jobData = npcJob('远处的白眼', '◻️');
      setNpcCombatCapabilities(herobrine, {
        actionMode: 'normal',
        visible: true,
        targetable: true,
        aoeVulnerable: true,
        blocksSettlement: true,
      });
    },
  });
}

function enterPhaseTwo(runtime: HerobrineRuntime, reason: string): void {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (!event || !herobrine || event.phase !== 'phase_one') return;
  commitFormTransition({
    fighter: herobrine,
    log: runtime.log,
    message: `👁️ 【你不是一个人在玩】${reason}。Herobrine 的防御与魔抗降低 15%，追猎频率随之提高。`,
    mutate: () => {
      event.phase = 'phase_two';
      event.phaseTwoStartedTurn = runtime.turnCount;
      event.phaseActionCount = 0;
      herobrine.job = 'HEROBRINE_PHASE_TWO';
      herobrine.jobData = npcJob('你不是一个人在玩', '👁️');
      herobrine.def = Math.max(1, Math.floor(herobrine.def * 0.85));
      herobrine.res = Math.max(1, Math.floor(herobrine.res * 0.85));
      herobrine.spd = Math.max(1, Math.floor(herobrine.spd * 1.18));
    },
  });
  runtime.log('info', '“这是你的单人世界。那我是谁？”');
  if (activeTraces(runtime, 'tunnel').length === 0) {
    const tunnel = createTrace(runtime, 'tunnel', activeContestants(runtime).length);
    runtime.fighters.push(tunnel);
    event.traceIds.push(tunnel.id);
    runtime.log('info', `⬛ 【异常增生】${tunnel.name} 在 Herobrine 脚下重新裂开。`);
  }
  spawnCloneAction(runtime, herobrine, 2);
  witnessEligibleUnits(runtime).forEach((target) => applyHerobrineWitness(runtime, target, 1, '第二阶段的白眼扫过全场'));
}

function endSingleWorld(runtime: HerobrineRuntime, reason: string): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event?.singleWorld) return;
  const target = runtime.fighters.find((fighter) => fighter.id === event.singleWorld?.targetId);
  const herobrine = getEventHerobrine(runtime);
  if (herobrine && event.singleWorldSpeedBefore !== undefined) {
    herobrine.spd = event.singleWorldSpeedBefore;
  }
  delete event.singleWorldSpeedBefore;
  if (target) removeEffects(target, { identityIds: [HEROBRINE_ISOLATED], reason: 'scripted' });
  if (event.phase !== 'removed') {
    activeTraces(runtime).forEach((trace) => setTraceExposure(trace, false));
  }
  delete event.singleWorld;
  runtime.log('system', `⬜ 【单人世界结束】${reason}${target ? `，${target.name} 回到原本战场` : ''}。`);
}

function enterSingleWorld(runtime: HerobrineRuntime, herobrine: Fighter): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.phase !== 'phase_two' || event.singleWorld) return false;
  if ((event.singleWorldCooldownUntilLargeRound ?? 0) > runtime.largeRound) return false;
  const tunnel = randomPick(activeTraces(runtime, 'tunnel'));
  const targets = witnessEligibleUnits(runtime).filter((fighter) => getWitnessStacks(fighter) >= 5);
  const target = randomPick(targets);
  if (!tunnel || !target) return false;

  event.singleWorld = {
    targetId: target.id,
    tunnelId: tunnel.id,
    startedLargeRound: runtime.largeRound,
    endsAfterLargeRound: runtime.largeRound + 1,
  };
  event.singleWorldSpeedBefore = herobrine.spd;
  event.directHitsSinceFog = 0;
  herobrine.spd = Math.max(1, Math.floor(herobrine.spd * 1.28));
  event.singleWorldCooldownUntilLargeRound = runtime.largeRound + SINGLE_WORLD_COOLDOWN_ROUNDS;
  activeTraces(runtime).forEach((trace) => setTraceExposure(trace, true));
  runtime.applyStatus(target, {
    identityId: HEROBRINE_ISOLATED,
    silent: true,
    attribution: {
      effectSourceId: 'herobrine:single_world',
      effectSourceName: herobrine.name,
      applierId: herobrine.id,
      applierName: herobrine.name,
    },
  });
  runtime.log('finisher', `⬜ 【单人世界】${herobrine.name} 将五层目击的 ${target.name} 拖入只剩白色眼睛的世界！双方只能直接攻击彼此；外界可摧毁 ${tunnel.name} 提前结束隔离。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: [target.id, tunnel.id],
    visualCue: {
      kind: 'combat_action',
      sourceId: herobrine.id,
      targetIds: [target.id, tunnel.id],
      presentation: 'finisher',
      effectId: 'herobrine_single_world',
    },
  });
  return true;
}

function safeCopyTemplate(
  actor: Fighter,
  skillId: string,
  skill: SkillDefinition,
  skillTags: Record<string, string>,
): HerobrineCopiedSkillSnapshot | undefined {
  if (skill.presentation === 'finisher' || skill.isSummon || skill.advancedSummon || skill.unique) return undefined;
  if (skill.newSkill || skill.requiresBlueEyesFusion || skill.tributes || skill.triggerAgain) return undefined;
  const ordinaryStatus = skill.statusApplications?.find((application) =>
    HEROBRINE_COPYABLE_STATUS_IDENTITIES.has(application.identityId),
  );
  let template: HerobrineCopiedSkillSnapshot['template'];
  if (skill.tag === skillTags.HEAL) template = 'self_heal';
  else if (skill.tag === skillTags.BUFF) template = 'self_buff';
  else if (ordinaryStatus) template = 'ordinary_status';
  else if (skill.herobrineCopyTargetCap) template = 'limited_aoe';
  else if (skill.tag === skillTags.MAG || skill.tag === skillTags.DEBUFF) template = 'single_magical';
  else template = 'single_physical';
  return {
    sourceActorId: actor.id,
    sourceActorName: actor.name,
    sourceSkillId: skillId,
    sourceSkillName: skill.name,
    template,
    potency: Math.max(0.45, Math.min(1.35, skill.mult ?? 0.75)),
    damageSchool:
      skill.tag === skillTags.MAG || skill.tag === skillTags.DEBUFF
        ? 'magical'
        : 'physical',
    targetCap: skill.herobrineCopyTargetCap,
    statusIdentityId: ordinaryStatus?.identityId,
  };
}

export function captureHerobrineRecentSkill(
  runtime: Pick<HerobrineRuntime, 'battleState' | 'skills' | 'skillTags'>,
  actor: Fighter,
  skillId: string | null,
  successfullyResolved = true,
): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed || !skillId || !successfullyResolved || actor.isNpc || actor.isSummon) return;
  const skill = runtime.skills[skillId];
  if (!skill) return;
  const snapshot = safeCopyTemplate(actor, skillId, skill, runtime.skillTags);
  if (snapshot) event.recentSkills[actor.id] = snapshot;
}

function useWorldSeedError(runtime: HerobrineRuntime, herobrine: Fighter): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || (event.worldSeedCooldownUntilTurn ?? 0) > runtime.turnCount) return false;
  const snapshot = randomPick(Object.values(event.recentSkills));
  if (!snapshot) return false;
  const target = chooseHerobrineTarget(runtime, herobrine);
  if (!target && snapshot.template !== 'self_heal' && snapshot.template !== 'self_buff') return false;
  const selectableTargetIds = new Set(
    runtime.getSelectableTargets(herobrine).map((fighter) => fighter.id),
  );
  const copiedTargets = target
    ? snapshot.template === 'limited_aoe'
      ? [
          target,
          ...randomSample(
            witnessEligibleUnits(runtime).filter((fighter) =>
              fighter.id !== target.id && selectableTargetIds.has(fighter.id),
            ),
            Math.max(0, Math.min(3, snapshot.targetCap ?? 3) - 1),
          ),
        ]
      : [target]
    : [];
  event.worldSeedCooldownUntilTurn = runtime.turnCount + WORLD_SEED_COOLDOWN_TURNS;
  runtime.log('skill', `🧩 【世界种子错误】${herobrine.name} 读取 ${snapshot.sourceActorName} 最近成功释放的【${snapshot.sourceSkillName}】，将其压缩为不含专属资源的安全异常模板。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: copiedTargets.length > 0 ? copiedTargets.map((fighter) => fighter.id) : [herobrine.id],
    ...(snapshot.template === 'limited_aoe' ? {
      visualCue: {
        kind: 'combat_action' as const,
        sourceId: herobrine.id,
        targetIds: copiedTargets.map((fighter) => fighter.id),
        presentation: 'skill' as const,
        effectId: 'herobrine_world_seed_error',
      },
    } : {}),
  });
  if (snapshot.template === 'self_heal') {
    const healing = resolveHealing(
      herobrine,
      Math.floor(herobrine.maxHp * Math.min(0.18, 0.08 + snapshot.potency * 0.06)),
      { kind: 'direct', sourceId: '世界种子错误', healer: herobrine },
      (type, text) => runtime.log(type, text),
    );
    runtime.log(
      healing.actual > 0 ? 'heal' : 'info',
      healing.actual > 0
        ? `🧩 【世界种子错误】异常模板为 ${herobrine.name} 恢复 ${healing.actual} 点生命。`
        : `🧩 【世界种子错误】${herobrine.name} 当前生命已满，复制的治疗模板没有产生实际恢复。`,
    );
  } else if (snapshot.template === 'self_buff') {
    runtime.applyStatus(herobrine, {
      identityId: 'OUTPUT_UP',
      potency: 18,
      remainingTurns: 2,
      silent: true,
      attribution: {
        effectSourceId: 'herobrine:world_seed',
        effectSourceName: '世界种子错误',
        applierId: herobrine.id,
        applierName: herobrine.name,
      },
    });
    runtime.log('buff', `🧩 【世界种子错误】${herobrine.name} 复制了强化模板，直接攻击威力提高 18%，持续 2 回合。`, {
      actorId: herobrine.id,
      actorName: herobrine.name,
      targetIds: [herobrine.id],
    });
  } else {
    for (const copiedTarget of copiedTargets) {
      if (event.completed) break;
      if (!runtime.isActiveCombatant(copiedTarget)) continue;
      let resolvedTarget = copiedTarget;
      if (snapshot.template !== 'limited_aoe') {
        const resolution = resolveHerobrineAttackTarget(
          runtime,
          herobrine,
          copiedTarget,
          `世界种子错误·${snapshot.sourceSkillName}`,
        );
        if (!resolution) continue;
        resolvedTarget = resolution.target;
        runtime.log(
          'skill',
          `🧩 【世界种子错误·投影】复制的【${snapshot.sourceSkillName}】在 ${resolvedTarget.name} 身前具现。`,
          {
            actorId: herobrine.id,
            actorName: herobrine.name,
            targetIds: [resolvedTarget.id],
            visualCue: {
              kind: 'combat_action',
              sourceId: herobrine.id,
              targetIds: [resolvedTarget.id],
              presentation: 'skill',
              effectId: 'herobrine_world_seed_error',
            },
          },
        );
        if (Math.random() > hitChance(herobrine, resolvedTarget)) {
          runtime.log(
            'info',
            `🧩 【世界种子错误】复制的【${snapshot.sourceSkillName}】锁定 ${resolvedTarget.name}，但异常攻击落空。`,
            {
              actorId: herobrine.id,
              actorName: herobrine.name,
              targetIds: [resolvedTarget.id],
            },
          );
          continue;
        }
        if (
          runtime.handleWaitCounter(
            resolvedTarget,
            herobrine,
            1,
            `世界种子错误·${snapshot.sourceSkillName}`,
          )
        ) {
          continue;
        }
        if (runtime.handleCounterStatus(resolvedTarget, herobrine)) continue;
        if (!runtime.isActiveCombatant(herobrine)) break;
        if (
          runtime.dodgesWithPassiveSkill(
            herobrine,
            resolvedTarget,
            `世界种子错误·${snapshot.sourceSkillName}`,
          )
        ) {
          continue;
        }
      }
      const magical =
        snapshot.template === 'single_magical' ||
        snapshot.template === 'ordinary_status' ||
        (snapshot.template === 'limited_aoe' && snapshot.damageSchool === 'magical');
      const stat = magical ? herobrine.mag : herobrine.atk;
      const defense = magical ? resolvedTarget.res : resolvedTarget.def;
      const areaMultiplier = snapshot.template === 'limited_aoe' ? 0.78 : 1;
      const damage = Math.max(
        1,
        Math.floor((stat * snapshot.potency - defense * 0.35) * event.directDamageMultiplier * areaMultiplier),
      );
      const options: DamageApplicationOptions = {
        actionName: `世界种子错误·${snapshot.sourceSkillName}`,
        sourceKind: 'custom',
        damageScope: magical ? 'magical' : 'physical',
        respectDefenses: true,
        deferTransform: true,
        isAreaDamage: snapshot.template === 'limited_aoe',
      };
      const actual = runtime.applyDamage(resolvedTarget, damage, 'skill', false, herobrine, options);
      runtime.flushDeferredDamageEvents(resolvedTarget, 'mitigation');
      runtime.log(
        'skill',
        `🧩 【世界种子错误结算】${resolvedTarget.name} 实际受到 ${actual} 点${magical ? '魔法' : '物理'}伤害。`,
        {
          actorId: herobrine.id,
          actorName: herobrine.name,
          targetIds: [resolvedTarget.id],
        },
      );
      runtime.flushDeferredDamageEvents(resolvedTarget);
      if (
        snapshot.template === 'ordinary_status' &&
        snapshot.statusIdentityId &&
        runtime.isActiveCombatant(resolvedTarget) &&
        didDamageConnect(actual, options) &&
        !isDamageRedirected(options)
      ) {
        runtime.applyStatus(resolvedTarget, {
          identityId: snapshot.statusIdentityId,
          remainingTurns: 1,
          attribution: {
            effectSourceId: 'herobrine:world_seed',
            effectSourceName: `复制自${snapshot.sourceActorName}的${snapshot.sourceSkillName}`,
            applierId: herobrine.id,
            applierName: herobrine.name,
          },
        });
      }
      if (resolvedTarget.currentHp <= 0 && !resolvedTarget.isDead && !resolvedTarget.isDeadAnnounced) {
        runtime.markDefeated(resolvedTarget, {
          message: `💀 【世界种子错误】${resolvedTarget.name} 被错误复制的【${snapshot.sourceSkillName}】击败！`,
          killer: herobrine,
        });
      }
      if (event.completed || event.finalPursuit) break;
      const connected = actual + (options.barrierAbsorptions ?? [])
        .reduce((sum, absorption) => sum + absorption.amount, 0);
      maybeTriggerWitnessFollowup(
        runtime,
        herobrine,
        resolvedTarget,
        connected,
        true,
        (event.hiddenUntilTurn ?? 0) > runtime.turnCount,
      );
    }
  }
  if (event.completed || event.finalPursuit) return true;
  const traceKind = randomPick<HerobrineTraceKind>(['tunnel', 'leafless_tree', 'sand_pyramid']);
  if (traceKind) {
    const trace = createTrace(runtime, traceKind, activeContestants(runtime).length);
    runtime.fighters.push(trace);
    event.traceIds.push(trace.id);
    if (event.singleWorld || event.phase === 'removed') setTraceExposure(trace, true);
    let pyramidTarget: Fighter | undefined;
    if (traceKind === 'sand_pyramid' && trace.npcUnitState) {
      pyramidTarget = randomPick(witnessEligibleFromSource(runtime, trace));
      trace.npcUnitState.markedTargetId = pyramidTarget?.id;
      trace.npcUnitState.collapseAfterLargeRound = runtime.largeRound + 1;
    }
    const pyramidDetail = traceKind === 'sand_pyramid'
      ? `；它锁定 ${pyramidTarget?.name ?? '一名参赛者'}，若一个大回合内未被摧毁便会坍塌`
      : '';
    runtime.log('info', `🧩 【世界残留】复制结束后，场上留下新的【${trace.name}】${pyramidDetail}。`, {
      actorId: herobrine.id,
      actorName: herobrine.name,
      targetIds: [trace.id, ...(pyramidTarget ? [pyramidTarget.id] : [])],
    });
  }
  return true;
}

function useDontLookBack(runtime: HerobrineRuntime, herobrine: Fighter): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || (event.dontLookBackCooldownUntilLargeRound ?? 0) > runtime.largeRound) return false;
  const target = chooseHerobrineTarget(runtime, herobrine);
  if (!target) return false;
  const prior = runtime.fighters.find((fighter) => fighter.id === event.dontLookBackTargetId);
  if (prior) removeEffects(prior, { identityIds: [HEROBRINE_DONT_LOOK_BACK], reason: 'replaced' });
  event.dontLookBackTargetId = target.id;
  event.dontLookBackExpiresLargeRound = runtime.largeRound + 1;
  event.dontLookBackCooldownUntilLargeRound = runtime.largeRound + DONT_LOOK_BACK_COOLDOWN_ROUNDS;
  runtime.applyStatus(target, {
    identityId: HEROBRINE_DONT_LOOK_BACK,
    silent: true,
    attribution: {
      effectSourceId: 'herobrine:dont_look_back',
      effectSourceName: herobrine.name,
      applierId: herobrine.id,
      applierName: herobrine.name,
    },
  });
  runtime.log('debuff', `👁️ 【不要回头】${target.name} 被白色眼睛标记：攻击异常本体或异常痕迹可以解除；若攻击其他参赛者，白色眼睛将立即从身后追击。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: [target.id],
  });
  return true;
}

export function executeHerobrineTurn(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  forcedBasicTarget?: Fighter,
): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed || !isHerobrine(herobrine)) return false;
  if (event.phase === 'fog' || event.phase === 'removed' || event.phase === 'retreated') return false;
  const target = forcedBasicTarget && runtime.isActiveCombatant(forcedBasicTarget)
    ? forcedBasicTarget
    : chooseHerobrineTarget(runtime, herobrine);
  if (!target) return false;
  event.herobrineActionCount += 1;
  event.phaseActionCount += 1;
  event.lastActionTurn = runtime.turnCount;

  let hidden = (event.hiddenUntilTurn ?? 0) > runtime.turnCount;

  if (forcedBasicTarget) {
    const actionName = hidden ? '雾后袭击' : '空洞凝视';
    runHerobrineAction(runtime, herobrine, {
      skillId: hidden ? 'herobrine_fog_attack' : 'herobrine_empty_gaze',
      skillName: actionName,
      presentation: 'basic',
      targets: [target],
    }, () => attackWithEmptyGaze(runtime, herobrine, target, {
      hidden,
      enhanced: event.finalPursuit,
      actionName,
    }));
    return true;
  }

  if (event.finalPursuit) {
    runHerobrineAction(runtime, herobrine, {
      skillId: 'herobrine_final_pursuit',
      skillName: '最终追猎',
      presentation: 'finisher',
      targets: [target],
    }, () => attackWithEmptyGaze(runtime, herobrine, target, {
      enhanced: true,
      actionName: '最终追猎',
      presentation: 'finisher',
    }));
    return true;
  }

  if (event.phase === 'phase_one') {
    const activeCloneCount = event.cloneIds.filter((id) => {
      const clone = runtime.fighters.find((fighter) => fighter.id === id);
      return !!clone && runtime.isActiveCombatant(clone);
    }).length;
    const choice = chooseWeighted([
      { value: 'gaze', weight: 45 },
      { value: 'leaves', weight: 25 },
      { value: 'clones', weight: activeCloneCount < MAX_CLONES ? 30 : 0 },
    ]);
    if (choice === 'leaves') {
      runHerobrineAction(runtime, herobrine, {
        skillId: 'herobrine_stripped_leaves',
        skillName: '被剥去的树叶',
        targets: witnessEligibleUnits(runtime),
      }, () => useStrippedLeaves(runtime, herobrine));
    } else if (choice === 'clones') {
      runHerobrineAction(runtime, herobrine, {
        skillId: 'herobrine_wrong_player',
        skillName: '错误的玩家',
        targets: [herobrine],
      }, () => spawnCloneAction(runtime, herobrine, 1 + Math.floor(Math.random() * 3)));
    } else {
      runHerobrineAction(runtime, herobrine, {
        skillId: hidden ? 'herobrine_fog_attack' : 'herobrine_empty_gaze',
        skillName: hidden ? '雾后袭击' : '空洞凝视',
        presentation: 'basic',
        targets: [target],
      }, () => attackWithEmptyGaze(runtime, herobrine, target, hidden
        ? { hidden: true, actionName: '雾后袭击' }
        : undefined));
    }
    return true;
  }

  const canSingleWorld =
    !event.singleWorld &&
    (event.singleWorldCooldownUntilLargeRound ?? 0) <= runtime.largeRound &&
    activeTraces(runtime, 'tunnel').length > 0 &&
    witnessEligibleUnits(runtime).some((fighter) => getWitnessStacks(fighter) >= 5);
  const canSeed =
    (event.worldSeedCooldownUntilTurn ?? 0) <= runtime.turnCount &&
    Object.keys(event.recentSkills).length > 0;
  const canMark = (event.dontLookBackCooldownUntilLargeRound ?? 0) <= runtime.largeRound;
  const shiftedSkillWeight = Math.min(20, event.revivalCount * 8);
  const perSkillWeightBonus = shiftedSkillWeight / 3;
  const choice = chooseWeighted([
    { value: 'gaze', weight: 30 - shiftedSkillWeight },
    { value: 'single', weight: canSingleWorld ? 25 + perSkillWeightBonus : 0 },
    { value: 'seed', weight: canSeed ? 25 + perSkillWeightBonus : 0 },
    { value: 'look', weight: canMark ? 20 + perSkillWeightBonus : 0 },
  ]);
  if (choice === 'single') {
    if (hidden) {
      completeFogBehindReturn(runtime, herobrine, '为了建立【单人世界】，白色眼睛主动从隧道中现身');
      hidden = false;
    }
    runHerobrineAction(runtime, herobrine, {
      skillId: 'herobrine_single_world',
      skillName: '单人世界',
      presentation: 'finisher',
      targets: witnessEligibleUnits(runtime).filter((fighter) => getWitnessStacks(fighter) >= 5),
    }, () => {
      if (!enterSingleWorld(runtime, herobrine)) attackWithEmptyGaze(runtime, herobrine, target);
    });
  } else if (choice === 'seed') {
    runHerobrineAction(runtime, herobrine, {
      skillId: 'herobrine_world_seed_error',
      skillName: '世界种子错误',
      targets: [target],
    }, () => {
      if (!useWorldSeedError(runtime, herobrine)) {
        attackWithEmptyGaze(runtime, herobrine, target, hidden
          ? { hidden: true, actionName: '雾后袭击' }
          : undefined);
      }
    });
  } else if (choice === 'look') {
    runHerobrineAction(runtime, herobrine, {
      skillId: 'herobrine_dont_look_back',
      skillName: '不要回头',
      targets: [target],
    }, () => {
      if (!useDontLookBack(runtime, herobrine)) {
        attackWithEmptyGaze(runtime, herobrine, target, hidden
          ? { hidden: true, actionName: '雾后袭击' }
          : undefined);
      }
    });
  } else {
    runHerobrineAction(runtime, herobrine, {
      skillId: hidden ? 'herobrine_fog_attack' : 'herobrine_empty_gaze',
      skillName: hidden ? '雾后袭击' : '空洞凝视',
      presentation: 'basic',
      targets: [target],
    }, () => attackWithEmptyGaze(runtime, herobrine, target, hidden
      ? { hidden: true, actionName: '雾后袭击' }
      : undefined));
  }
  return true;
}

export function executeHerobrineCloneTurn(
  runtime: HerobrineRuntime,
  clone: Fighter,
  forcedBasicTarget?: Fighter,
): boolean {
  if (!isHerobrineClone(clone)) return false;
  const candidates = witnessEligibleUnits(runtime).filter((fighter) => fighter.id !== clone.id);
  const intendedTarget = forcedBasicTarget && runtime.isActiveCombatant(forcedBasicTarget)
    ? forcedBasicTarget
    : randomPick(candidates);
  if (!intendedTarget) return false;
  const revealed = clone.npcUnitState?.revealed === true;
  const actionName = revealed ? '白眼分身攻击' : '空洞袭击';
  const actionLabel = revealed ? '白眼分身' : '未知玩家';
  runtime.runAction(clone, {
    skillId: 'herobrine_clone_attack',
    skillName: actionName,
    presentation: 'basic',
    targets: [intendedTarget],
  }, () => {
    const targetResolution = resolveHerobrineAttackTarget(
      runtime,
      clone,
      intendedTarget,
      actionName,
    );
    if (!targetResolution) return;
    const target = targetResolution.target;
    if (Math.random() > hitChance(clone, target)) {
      runtime.log('info', `▫️ 【${actionLabel}】${clone.name} 无声扑向 ${target.name}，却只抓住了一团散开的雾。`, {
        actorId: clone.id,
        actorName: clone.name,
        targetIds: [target.id],
        skillId: 'herobrine_clone_attack',
        skillName: actionName,
        visualCue: {
          kind: 'combat_action',
          sourceId: clone.id,
          targetIds: [target.id],
          presentation: 'basic',
          effectId: 'herobrine_clone_attack',
        },
      });
      return;
    }
    if (runtime.handleWaitCounter(target, clone, 1, actionName)) return;
    if (runtime.handleCounterStatus(target, clone)) return;
    if (!runtime.isActiveCombatant(clone)) return;
    if (runtime.dodgesWithPassiveSkill(clone, target, actionName)) return;
    const damage = Math.max(1, Math.floor(clone.atk * (0.7 + Math.random() * 0.15) - target.def * 0.3));
    const options: DamageApplicationOptions = {
      actionName,
      sourceKind: 'custom',
      damageScope: 'physical',
      respectDefenses: true,
      deferTransform: true,
    };
    runtime.log('attack', `▫️ 【${actionLabel}】${clone.name} 无声扑向 ${target.name}！`, {
      actorId: clone.id,
      actorName: clone.name,
      targetIds: [target.id],
      visualCue: {
        kind: 'combat_action',
        sourceId: clone.id,
        targetIds: [target.id],
        presentation: 'basic',
        effectId: 'herobrine_clone_attack',
      },
    });
    const actual = runtime.applyDamage(target, damage, 'skill', false, clone, options);
    runtime.flushDeferredDamageEvents(target, 'mitigation');
    runtime.log(
      actual > 0 ? 'attack' : 'info',
      revealed
        ? `▫️ 【分身攻击结算】${target.name} 实际受到 ${actual} 点物理伤害；白眼分身不会施加目击。`
        : `▫️ 【空洞袭击结算】${target.name} 实际受到 ${actual} 点物理伤害；这次袭击没有增加目击。`,
    );
    runtime.flushDeferredDamageEvents(target);
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【${actionLabel}】${target.name} 被 ${clone.name} 扑倒！`,
        killer: clone,
      });
    }
  });
  return true;
}

function revealCloneIdentity(clone: Fighter): void {
  if (!isHerobrineClone(clone) || clone.npcUnitState?.revealed) return;
  const cloneIndex = Math.max(1, clone.npcUnitState?.cloneIndex ?? 1);
  const revealedName = `白眼分身#${cloneIndex}`;
  clone.npcUnitState!.revealed = true;
  clone.name = revealedName;
  clone.displayName = revealedName;
}

export function tryRevealHerobrineCloneBeforeTargeting(
  runtime: Pick<HerobrineRuntime, 'log'> & { battleState?: BattleState },
  attacker: Fighter,
  target: Fighter,
): boolean {
  if (
    runtime.battleState?.majorNpcEvent?.kind !== 'herobrine' ||
    !isHerobrineClone(target) ||
    target.npcUnitState?.revealed
  ) return false;
  const stacks = getWitnessStacks(attacker);
  const detectionChance = stacks >= 5 ? 1 : stacks === 4 ? 0.8 : stacks === 3 ? 0.6 : 0;
  if (Math.random() >= detectionChance) return false;
  revealCloneIdentity(target);
  runtime.log('info', `👁️ 【看破真相】${attacker.name} 凭 ${stacks} 层目击在出手前识破 ${target.name} 只是分身；其后会降低对该分身的攻击倾向。`, {
    actorId: attacker.id,
    actorName: attacker.name,
    targetIds: [target.id],
  });
  return true;
}

export function revealHerobrineCloneOnAttack(
  runtime: Pick<HerobrineRuntime, 'battleState' | 'log'>,
  attacker: Fighter,
  target: Fighter,
): boolean {
  if (
    runtime.battleState.majorNpcEvent?.kind !== 'herobrine' ||
    !isHerobrineClone(target) ||
    target.npcUnitState?.revealed
  ) return false;
  revealCloneIdentity(target);
  runtime.log('info', `▫️ 【错误的玩家】${attacker.name} 的攻击接触 ${target.name} 后，白眼分身的伪装破裂；其后会降低对该分身的攻击倾向。`, {
    actorId: attacker.id,
    actorName: attacker.name,
    targetIds: [target.id],
  });
  return true;
}

export function noteHerobrineDirectHit(
  runtime: HerobrineRuntime,
  attacker: Fighter | undefined,
  target: Fighter,
  actualDamage: number,
  sourceKind: DamageApplicationOptions['sourceKind'],
  deferUntilActionEnd = false,
): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed || actualDamage <= 0) return;
  if (
    attacker &&
    attacker.id !== target.id &&
    !isHerobrine(attacker) &&
    !isHerobrineTrace(attacker) &&
    isHerobrineAttackHitKind(sourceKind)
  ) {
    if (!event.attackedThisLargeRoundIds.includes(target.id)) event.attackedThisLargeRoundIds.push(target.id);
  }
  if (
    isHerobrine(target) &&
    attacker &&
    attacker.id !== target.id &&
    !attacker.isNpc &&
    isHerobrineAttackHitKind(sourceKind) &&
    event.phase !== 'removed'
  ) {
    if (event.fogBehindPending) return;
    const canBuildFogHits =
      (event.phase === 'phase_one' || event.phase === 'phase_two') &&
      !event.finalPursuit &&
      !event.singleWorld &&
      event.hiddenUntilTurn === undefined &&
      (event.fogCooldownUntilLargeRound ?? 0) <= runtime.largeRound &&
      activeTraces(runtime, 'tunnel').length > 0;
    if (!canBuildFogHits) {
      event.directHitsSinceFog = 0;
      return;
    }
    event.directHitsSinceFog = (event.directHitsSinceFog ?? 0) + 1;
    if ((event.directHitsSinceFog ?? 0) >= FOG_BEHIND_DIRECT_HITS && deferUntilActionEnd) {
      event.fogBehindPending = true;
    } else {
      enterFogBehind(runtime, target);
    }
  }
}

export function commitPendingHerobrineFogBehind(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event?.fogBehindPending) return false;
  delete event.fogBehindPending;
  return enterFogBehind(runtime, herobrine);
}

function collapsePyramid(runtime: HerobrineRuntime, pyramid: Fighter): void {
  if (!runtime.isActiveCombatant(pyramid) || pyramid.npcUnitState?.traceKind !== 'sand_pyramid') return;
  const eligibleTargets = witnessEligibleFromSource(runtime, pyramid);
  const marked = runtime.fighters.find((fighter) => fighter.id === pyramid.npcUnitState?.markedTargetId);
  const primary = marked && eligibleTargets.some((candidate) => candidate.id === marked.id)
    ? marked
    : undefined;
  const secondaryPool = eligibleTargets.filter((fighter) => fighter.id !== marked?.id);
  const secondaryTargets = randomSample(secondaryPool, Math.min(2, secondaryPool.length));
  const targets = [
    ...(primary ? [{ target: primary, isPrimary: true }] : []),
    ...secondaryTargets.map((target) => ({ target, isPrimary: false })),
  ];
  const collapseText = primary
    ? `异常结构轰然塌落，主冲击锁定 ${primary.name}${secondaryTargets.length > 0 ? `，余波扫向 ${secondaryTargets.map((target) => target.name).join('、')}` : ''}！`
    : marked
      ? `本应落向 ${marked.name} 的主冲击因目标不在可波及战场而落空${secondaryTargets.length > 0 ? `，余波扫向 ${secondaryTargets.map((target) => target.name).join('、')}` : '，余波也没有命中其他单位'}。`
      : `异常结构未能锁定主目标${secondaryTargets.length > 0 ? `，余波扫向 ${secondaryTargets.map((target) => target.name).join('、')}` : '，坍塌没有命中任何单位'}。`;
  runtime.log('skill', `🔺 【沙土金字塔坍塌】${collapseText}`, {
    actorId: pyramid.id,
    actorName: pyramid.name,
    targetIds: targets.map(({ target }) => target.id),
  });
  for (const { target, isPrimary } of targets) {
    if (getHerobrineEvent(runtime.battleState)?.completed) break;
    const cap = isPrimary ? 220 : 130;
    const damage = Math.min(
      cap,
      Math.max(1, Math.floor(target.maxHp * (isPrimary ? 0.06 : 0.03) + (isPrimary ? 35 : 25))),
    );
    const options: DamageApplicationOptions = {
      actionName: '沙土金字塔坍塌',
      sourceKind: 'environment',
      bypassShields: false,
      deferTransform: true,
      creditAttacker: false,
    };
    const actual = runtime.applyDamage(target, damage, 'environment', true, pyramid, options);
    runtime.flushDeferredDamageEvents(target, 'mitigation');
    runtime.log('skill', `🔺 【坍塌结算】${target.name} 实际受到 ${actual} 点真实伤害。`, {
      actorId: pyramid.id,
      actorName: pyramid.name,
      targetIds: [target.id],
    });
    runtime.flushDeferredDamageEvents(target);
    if (getHerobrineEvent(runtime.battleState)?.completed) return;
    if (didDamageConnect(actual, options) && !isDamageRedirected(options)) {
      applyHerobrineWitness(runtime, target, 1, '被异常金字塔波及', pyramid);
    }
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【沙土金字塔】${target.name} 被坍塌的异常结构掩埋！`,
        causeName: '沙土金字塔坍塌',
        awardKill: false,
      });
    }
  }
  setCurrentHp(pyramid, 0);
  pyramid.isDead = true;
  pyramid.isDeadAnnounced = true;
  if (!getHerobrineEvent(runtime.battleState)?.completed) {
    runtime.log('info', '🔺 【坍塌结束】沙土金字塔彻底解体，从战场上消失。', {
      actorId: pyramid.id,
      actorName: pyramid.name,
      targetIds: [pyramid.id],
    });
  }
}

function processLeaflessTree(runtime: HerobrineRuntime, completedRound: number): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.lastTreeResolutionLargeRound === completedRound) return;
  event.lastTreeResolutionLargeRound = completedRound;
  for (const tree of activeTraces(runtime, 'leafless_tree')) {
    if (getHerobrineEvent(runtime.battleState)?.completed) break;
    const target = randomPick(witnessEligibleFromSource(runtime, tree));
    if (!target) continue;
    runtime.log('skill', `🌳 【无叶之树】第 ${completedRound + 1} 个大回合开始时，${tree.name} 的枯枝无声伸向 ${target.name}。`, {
      actorId: tree.id,
      actorName: tree.name,
      targetIds: [target.id],
    });
    if (!stripOneBenefit(runtime, target, tree.name)) applyWither(runtime, target, tree.name);
  }
}

function processWitnessDamage(runtime: HerobrineRuntime, completedRound: number): void {
  const herobrine = getEventHerobrine(runtime);
  for (const target of witnessEligibleUnits(runtime)) {
    if (getHerobrineEvent(runtime.battleState)?.completed) break;
    if (getWitnessStacks(target) < 3) continue;
    const damage = Math.max(1, Math.floor(target.maxHp * 0.015));
    const options: DamageApplicationOptions = {
      actionName: '白色眼睛',
      sourceKind: 'status',
      suppressStatusAftermath: true,
      creditAttacker: false,
      deferTransform: true,
    };
    const actual = runtime.applyDamage(target, damage, 'status', true, herobrine, options);
    runtime.flushDeferredDamageEvents(target, 'mitigation');
    runtime.log('debuff', `👁️ 【白色眼睛】第 ${completedRound} 个大回合结束，${target.name} 的目击造成 ${actual} 点真实伤害（最大生命的 1.5%）。`, {
      actorId: herobrine?.id,
      actorName: herobrine?.name ?? HEROBRINE_CANONICAL_NAME,
      targetIds: [target.id],
    });
    runtime.flushDeferredDamageEvents(target);
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【白色眼睛】${target.name} 在持续注视中失去了最后的生命！`,
        killer: herobrine,
      });
    }
  }
}

function exposeRemovedTraces(runtime: HerobrineRuntime, exposed: boolean): void {
  activeTraces(runtime).forEach((trace) => {
    if (trace.npcUnitState?.traceKind !== 'sand_pyramid') setTraceExposure(trace, exposed);
  });
}

function reviveHerobrine(runtime: HerobrineRuntime, reason: string): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (!event || !herobrine || event.phase !== 'removed' || event.completed) return false;
  event.revivalCount += 1;
  herobrine.maxHp = Math.max(1, Math.floor(herobrine.maxHp * 0.7));
  event.directDamageMultiplier = 1 + event.revivalCount * 0.15;
  setCurrentHp(herobrine, herobrine.maxHp);
  herobrine.isDead = false;
  herobrine.isDeadAnnounced = false;
  herobrine.defeatHooksResolved = false;
  event.phase = 'phase_two';
  restoreHerobrineIdentity(herobrine);
  if (herobrine.job !== 'HEROBRINE_PHASE_TWO') {
    event.phaseTwoStartedTurn = runtime.turnCount;
    commitFormTransition({
      fighter: herobrine,
      log: runtime.log,
      kind: 'form_shift',
      cause: 'revival',
      message: '◻️ 【世界状态修正】消失中的白眼恢复了它应有的猎杀形态。',
      mutate: () => {
        herobrine.job = 'HEROBRINE_PHASE_TWO';
        herobrine.jobData = npcJob('你不是一个人在玩', '👁️');
        herobrine.def = Math.max(1, Math.floor(herobrine.def * 0.85));
        herobrine.res = Math.max(1, Math.floor(herobrine.res * 0.85));
        herobrine.spd = Math.max(1, Math.floor(herobrine.spd * 1.18));
      },
    });
  }
  delete event.removedReturnTurn;
  setNpcCombatCapabilities(herobrine, {
    actionMode: 'normal',
    visible: true,
    targetable: true,
    aoeVulnerable: true,
    blocksSettlement: true,
  });
  exposeRemovedTraces(runtime, false);
  const clone = spawnClone(runtime);
  const targets = randomSample(witnessEligibleUnits(runtime), 1 + Math.floor(Math.random() * 3));
  targets.forEach((target) => applyHerobrineWitness(runtime, target, 1, '听见了本不该存在的返回脚步'));
  const gazeWeight = Math.max(10, 30 - event.revivalCount * 8);
  runtime.log('system', `◻️ 【你确定吗？】${reason}。Herobrine 以 ${herobrine.maxHp} 点新生命上限满血回归；这是第 ${event.revivalCount} 次重现，直接伤害倍率提高至 ${event.directDamageMultiplier.toFixed(2)}，普通攻击基础权重降至 ${gazeWeight}%，其余权重转入二阶段技能。${clone ? ' 另一个无法辨认真假的白眼身影同时出现。' : ''}`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: [herobrine.id, ...(clone ? [clone.id] : [])],
  });
  return true;
}

function finishHerobrineEvent(
  runtime: HerobrineRuntime,
  reason: string,
  outcome: 'true_removal' | 'contestants_defeated',
): void {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (!event || event.completed) return;
  restoreHerobrineIdentity(herobrine);
  event.phase = 'retreated';
  event.completed = true;
  event.outcome = outcome;
  event.finalPursuit = false;
  delete event.fogBehindPending;
  delete event.singleWorld;
  delete event.removedReturnTurn;
  for (const fighter of runtime.fighters) {
    if (isHerobrineEventUnit(fighter)) {
      setCurrentHp(fighter, 0);
      fighter.isDead = true;
      fighter.isDeadAnnounced = true;
      setNpcCombatCapabilities(fighter, {
        actionMode: 'none',
        visible: false,
        targetable: false,
        aoeVulnerable: false,
        blocksSettlement: false,
      });
    }
    removeEffects(fighter, {
      identityIds: [
        HEROBRINE_WITNESS,
        HEROBRINE_WITHER,
        HEROBRINE_ISOLATED,
        HEROBRINE_DONT_LOOK_BACK,
      ],
      reason: 'scripted',
    });
  }
  const text = outcome === 'true_removal'
    ? `⬜ 【真正退场】${reason}。Herobrine 与所有异常痕迹、白眼分身一同消失；目击也从全场清除。`
    : `👁️ 【猎杀结束】${reason}。场上已无存活参赛者，重大事件停止继续生成单位；Herobrine 不进入排名，目击随结算清除。`;
  runtime.log('system', text, {
    actorId: herobrine?.id,
    actorName: herobrine?.name,
    targetIds: herobrine ? [herobrine.id] : undefined,
  });
}

function trulyRemoveHerobrine(runtime: HerobrineRuntime, reason: string): void {
  finishHerobrineEvent(runtime, reason, 'true_removal');
}

function concludeHerobrineHunt(runtime: HerobrineRuntime, reason: string): void {
  finishHerobrineEvent(runtime, reason, 'contestants_defeated');
}

function enterFinalPursuit(runtime: HerobrineRuntime, soleSurvivor: Fighter): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.finalPursuit || event.completed) return;
  if (event.phase === 'fog') {
    revealHerobrine(runtime, `战场骤然只剩 ${soleSurvivor.name}，雾中的猎手不再等待`);
  }
  if (event.singleWorld) {
    endSingleWorld(runtime, '最终追猎开始，旧的隔离试探被强制结束');
  }
  const dontLookBackTarget = runtime.fighters.find((fighter) => fighter.id === event.dontLookBackTargetId);
  if (dontLookBackTarget) {
    removeEffects(dontLookBackTarget, {
      identityIds: [HEROBRINE_DONT_LOOK_BACK],
      reason: 'scripted',
    });
  }
  delete event.dontLookBackTargetId;
  delete event.dontLookBackExpiresLargeRound;
  event.finalPursuit = true;
  event.finalPursuitContestantId = soleSurvivor.id;
  if (event.phase === 'removed') {
    reviveHerobrine(runtime, `战场只剩 ${soleSurvivor.name}，最终追猎立即开始`);
  }
  const herobrine = getEventHerobrine(runtime);
  const retiredEventUnits = runtime.fighters.filter((fighter) =>
    fighter.id !== herobrine?.id &&
    isHerobrineEventUnit(fighter) &&
    runtime.isActiveCombatant(fighter),
  );
  retiredEventUnits.forEach(markNpcGone);
  event.traceIds = [];
  event.cloneIds = [];
  if (herobrine) {
    delete event.hiddenUntilTurn;
    restoreHerobrineIdentity(herobrine);
    setNpcCombatCapabilities(herobrine, {
      actionMode: 'normal',
      visible: true,
      targetable: true,
      aoeVulnerable: true,
      blocksSettlement: true,
    });
    event.directDamageMultiplier = Number((event.directDamageMultiplier * 4.4).toFixed(3));
    herobrine.spd = Math.max(1, Math.floor(herobrine.spd * 1.5));
  }
  event.finalPursuitOpeningPending = true;
  runtime.log('system', `👁️ 【最终追猎】战场只剩 ${soleSurvivor.name} 一名参赛者。Herobrine 不再隐匿或试探，行动速度与直接伤害大幅提高；此后双方任意一方被击倒，战斗都会直接结束，Herobrine 不再复活。`, {
    actorId: herobrine?.id,
    actorName: 'Herobrine',
    targetIds: [soleSurvivor.id],
  });
  if (retiredEventUnits.length > 0) {
    runtime.log(
      'system',
      `👁️ 【最终追猎·清场】${retiredEventUnits.length} 个异常痕迹与白眼分身一同没入雾中；终局只保留 Herobrine 与 ${soleSurvivor.name} 一方。`,
      {
        actorId: herobrine?.id,
        actorName: 'Herobrine',
        targetIds: retiredEventUnits.map((fighter) => fighter.id),
      },
    );
  }
}

function processFogLifecycle(runtime: HerobrineRuntime): void {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (!event || !herobrine) return;
  const elapsed = runtime.turnCount - event.startedTurn;
  if (!event.hiddenAttackResolved && elapsed >= FOG_HIDDEN_ATTACK_TURN) {
    event.hiddenAttackResolved = true;
    const target = randomPick(witnessEligibleUnits(runtime));
    if (target) {
      runHerobrineAction(runtime, herobrine, {
        skillId: 'herobrine_unknown_attack',
        skillName: '未知袭击',
        presentation: 'basic',
        targets: [target],
      }, () => attackWithEmptyGaze(runtime, herobrine, target, {
        hidden: true,
        actionName: '未知袭击',
        allowFollowup: false,
      }), { anonymous: true });
    }
  }
  if (elapsed >= FOG_REVEAL_TURNS) revealHerobrine(runtime, '异常痕迹持续了十个全局行动，雾中的白眼终于靠近');
}

function completeFogBehindReturn(
  runtime: HerobrineRuntime,
  herobrine: Fighter,
  reason: string,
): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || (event.phase !== 'phase_one' && event.phase !== 'phase_two')) return;
  delete event.hiddenUntilTurn;
  restoreHerobrineIdentity(herobrine);
  setNpcCombatCapabilities(herobrine, {
    actionMode: 'normal',
    visible: true,
    targetable: true,
    aoeVulnerable: true,
  });
  event.fogCooldownUntilLargeRound = runtime.largeRound + FOG_BEHIND_COOLDOWN_ROUNDS;
  runtime.log('system', `◻️ 【雾中归来】${reason}；${herobrine.name} 进入 ${FOG_BEHIND_COOLDOWN_ROUNDS} 个大回合的【雾后之人】冷却。这不是转阶段，不会重复播放变身动画。`, {
    actorId: herobrine.id,
    actorName: herobrine.name,
    targetIds: [herobrine.id],
  });
}

function processHiddenReturn(runtime: HerobrineRuntime): void {
  const event = getHerobrineEvent(runtime.battleState);
  const herobrine = getEventHerobrine(runtime);
  if (
    !event ||
    !herobrine ||
    (event.phase !== 'phase_one' && event.phase !== 'phase_two') ||
    !event.hiddenUntilTurn ||
    event.hiddenUntilTurn > runtime.turnCount
  ) return;
  completeFogBehindReturn(runtime, herobrine, '五个全局行动结束，Herobrine 从二乘二隧道尽头重新出现');
}

export function processHerobrineGlobalActionEnd(runtime: HerobrineRuntime): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed) return;
  if (event.phase === 'fog') processFogLifecycle(runtime);
  processHiddenReturn(runtime);
  if (
    event.phase === 'phase_one' &&
    (
      getEventHerobrine(runtime)?.hpPct !== undefined &&
      (getEventHerobrine(runtime)?.hpPct ?? 1) <= 0.6 ||
      (runtime.turnCount - (event.formalAppearanceTurn ?? runtime.turnCount)) >= PHASE_TWO_TURN_THRESHOLD
    )
  ) {
    const herobrine = getEventHerobrine(runtime);
    const reason = herobrine && herobrine.hpPct <= 0.6
      ? 'Herobrine 的生命降至 60%'
      : 'Herobrine 正式现身已满 40 个全局行动';
    if (
      herobrine &&
      event.hiddenUntilTurn !== undefined &&
      event.hiddenUntilTurn > runtime.turnCount
    ) {
      completeFogBehindReturn(
        runtime,
        herobrine,
        '阶段阈值已经满足，白色眼睛主动结束隐匿并显露真正的猎杀形态',
      );
    }
    enterPhaseTwo(runtime, reason);
  }
  if (event.phase === 'removed' && (event.removedReturnTurn ?? Number.MAX_SAFE_INTEGER) <= runtime.turnCount) {
    reviveHerobrine(runtime, 'Removed Herobrine. 的十个全局行动倒计时归零；异常痕迹是否存在都无法阻止这次回归');
  }

  const contestants = activeContestants(runtime);
  if (contestants.length === 1) enterFinalPursuit(runtime, contestants[0]);
  if (contestants.length === 0) {
    concludeHerobrineHunt(runtime, '所有参赛者都已被 Herobrine 或战场后续伤害击败');
    return;
  }
  if (event.finalPursuitOpeningPending && contestants.length === 1 && !event.completed) {
    event.finalPursuitOpeningPending = false;
    const herobrine = getEventHerobrine(runtime);
    const target = contestants[0];
    if (herobrine && runtime.isActiveCombatant(herobrine) && runtime.isActiveCombatant(target)) {
      runHerobrineAction(runtime, herobrine, {
        skillId: 'herobrine_final_pursuit_opening',
        skillName: '最终追猎·开幕',
        presentation: 'finisher',
        targets: [target],
      }, () => {
        attackWithEmptyGaze(runtime, herobrine, target, {
          enhanced: true,
          allowFollowup: false,
          actionName: '最终追猎·开幕',
          presentation: 'finisher',
        });
        if (
          !getHerobrineEvent(runtime.battleState)?.completed &&
          runtime.isActiveCombatant(target)
        ) {
          attackWithEmptyGaze(runtime, herobrine, target, {
            enhanced: false,
            allowFollowup: false,
            actionName: '最终追猎·回身',
            presentation: 'finisher',
            secondaryVisual: true,
          });
        }
      });
    }
  }
}

export function processHerobrineLargeRoundEnd(runtime: HerobrineRuntime, completedRound: number): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed) return;
  processWitnessDamage(runtime, completedRound);
  if (event.completed) return;
  for (const pyramid of activeTraces(runtime, 'sand_pyramid')) {
    if ((pyramid.npcUnitState?.collapseAfterLargeRound ?? Number.MAX_SAFE_INTEGER) <= completedRound) {
      collapsePyramid(runtime, pyramid);
      if (event.completed) return;
    }
  }
  if (event.singleWorld && completedRound >= event.singleWorld.endsAfterLargeRound) {
    endSingleWorld(runtime, '一个完整大回合已经结束');
  }
  if (
    event.dontLookBackTargetId &&
    (event.dontLookBackExpiresLargeRound ?? Number.MAX_SAFE_INTEGER) <= completedRound
  ) {
    const target = runtime.fighters.find((fighter) => fighter.id === event.dontLookBackTargetId);
    if (target) removeEffects(target, { identityIds: [HEROBRINE_DONT_LOOK_BACK], reason: 'expired' });
    delete event.dontLookBackTargetId;
    delete event.dontLookBackExpiresLargeRound;
    if (target) runtime.log('info', `👁️ 【不要回头结束】${target.name} 撑过了标记期，背后的注视暂时消失。`);
  }
  event.attackedThisLargeRoundIds = [];
  processLeaflessTree(runtime, completedRound);
}

export function processHerobrineActionEnd(
  runtime: HerobrineRuntime,
  actor: Fighter,
  primaryTargetId?: string,
): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed) return;
  if (event.dontLookBackTargetId === actor.id) {
    const target = runtime.fighters.find((fighter) => fighter.id === primaryTargetId);
    if (
      target &&
      (
        isHerobrineEventUnit(target) ||
        (!target.isNpc && !target.isSummon && !target.cannotWin)
      )
    ) {
      removeEffects(actor, { identityIds: [HEROBRINE_DONT_LOOK_BACK], reason: 'consumed' });
      delete event.dontLookBackTargetId;
      delete event.dontLookBackExpiresLargeRound;
      if (isHerobrineEventUnit(target)) {
        runtime.log('info', `👁️ 【直面异常】${actor.name} 选择攻击 ${target.name}，【不要回头】安全解除。`);
      } else {
        const herobrine = getEventHerobrine(runtime);
        if (herobrine && runtime.isActiveCombatant(herobrine) && event.phase !== 'removed') {
          const hidden = (event.hiddenUntilTurn ?? 0) > runtime.turnCount;
          const pursuerName = hidden ? '【未知】' : herobrine.name;
          runtime.log('debuff', `👁️ 【不要回头】${actor.name} 转而攻击 ${target.name}；${pursuerName} 已经站在其身后！`, {
            actorId: herobrine.id,
            actorName: pursuerName,
            targetIds: [actor.id, target.id],
          });
          runHerobrineAction(runtime, herobrine, {
            skillId: 'herobrine_dont_look_back_followup',
            skillName: '不要回头·身后追猎',
            presentation: 'skill',
            targets: [actor],
          }, () => attackWithEmptyGaze(runtime, herobrine, actor, {
            enhanced: true,
            hidden,
            applyWitness: false,
            allowFollowup: false,
            actionName: '不要回头·身后追猎',
            presentation: 'skill',
          }));
        }
      }
    }
  }

  const currentEvent = getHerobrineEvent(runtime.battleState);
  if (!currentEvent?.fogBehindPending) return;
  // A counter or follow-up can satisfy the three-hit condition while the
  // outer skill is still resolving. Hiding here would split one action across
  // two public identities, so only the outermost action may commit the retreat.
  if (runtime.activeActionDepth > 1) return;
  const herobrine = getEventHerobrine(runtime);
  if (herobrine) commitPendingHerobrineFogBehind(runtime, herobrine);
}

function markNpcGone(target: Fighter): void {
  setCurrentHp(target, 0);
  target.isDead = true;
  target.isDeadAnnounced = true;
  setNpcCombatCapabilities(target, {
    actionMode: 'none',
    visible: false,
    targetable: false,
    aoeVulnerable: false,
    blocksSettlement: false,
  });
}

function logDirectNpcExecution(
  runtime: HerobrineRuntime,
  target: Fighter,
  options: DefeatOptions,
): void {
  if (!options.directExecution) return;
  const killerName = options.killer?.name ?? '战场效果';
  const causeName = options.causeName ?? '直接处决';
  runtime.log(
    options.logType ?? 'death',
    `☠️ 【${causeName}】结算：${killerName} 成功直接处决 ${target.name}；该结果不经过生命伤害结算。`,
    {
      actorId: options.killer?.id,
      actorName: options.killer?.name,
      targetIds: [target.id],
    },
  );
}

export function handleHerobrineNpcDefeat(
  runtime: HerobrineRuntime,
  target: Fighter,
  options: DefeatOptions,
): boolean {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed || !isHerobrineEventUnit(target)) return false;
  if (
    isHerobrine(target) &&
    event.finalPursuit &&
    !isOnFinalPursuitContestantSide(runtime.battleState, options.killer)
  ) {
    setCurrentHp(target, Math.max(1, target.currentHp));
    runtime.log('info', `👁️ 【最终追猎边界】${options.killer?.name ?? '外界效果'} 不属于最后参赛者一方，无法替其结束与 Herobrine 的终局。`, {
      actorId: options.killer?.id,
      actorName: options.killer?.name,
      targetIds: [target.id],
    });
    return true;
  }

  if (isHerobrineClone(target)) {
    const attacker = options.killer;
    revealCloneIdentity(target);
    logDirectNpcExecution(runtime, target, options);
    markNpcGone(target);
    runtime.log('death', `▫️ 【分身识破】${attacker?.name ?? '攻击者'} 击碎了 ${target.name}；白眼像像素错误一样熄灭，未提供击杀数或角色资源。`, {
      actorId: attacker?.id,
      actorName: attacker?.name,
      targetIds: [target.id],
    });
    return true;
  }

  if (isHerobrineTrace(target)) {
    const kind = target.npcUnitState?.traceKind;
    logDirectNpcExecution(runtime, target, options);
    markNpcGone(target);
    runtime.log('death', `⬜ 【异常痕迹摧毁】${options.killer?.name ?? '战场冲击'} 摧毁了【${target.name}】；该单位不提供击杀收益。`, {
      actorId: options.killer?.id,
      actorName: options.killer?.name,
      targetIds: [target.id],
    });
    if (kind === 'sand_pyramid' && event.phase === 'fog') {
      revealHerobrine(runtime, '沙土金字塔在坍塌前被提前摧毁，躲在雾后的存在被迫现身');
    }
    if (event.singleWorld?.tunnelId === target.id) {
      endSingleWorld(runtime, '维系隔离的二乘二隧道被摧毁');
    }
    return true;
  }

  if (!isHerobrine(target)) return false;
  logDirectNpcExecution(runtime, target, options);
  if (event.finalPursuit || target.maxHp < 1000) {
    markNpcGone(target);
    trulyRemoveHerobrine(
      runtime,
      event.finalPursuit
        ? `${options.killer?.name ?? '最后的参赛者'} 在最终追猎中击倒了 Herobrine`
        : `Herobrine 的生命上限已低于 1000，${options.killer?.name ?? '参赛者'} 令其再次死亡`,
    );
    return true;
  }

  if (event.phase === 'phase_one') {
    if (
      event.hiddenUntilTurn !== undefined &&
      event.hiddenUntilTurn > runtime.turnCount
    ) {
      completeFogBehindReturn(
        runtime,
        target,
        '致命伤越过阶段阈值，白色眼睛在被暂时移除前结束隐匿',
      );
    }
    enterPhaseTwo(runtime, 'Herobrine 的生命被压至零，越过 60% 阈值后显露真正的猎杀形态');
  }
  const defeatedWhileHidden =
    event.hiddenUntilTurn !== undefined &&
    event.hiddenUntilTurn > runtime.turnCount;
  clearHerobrineTargetLocks(runtime, target, {
    title: defeatedWhileHidden ? '异常脱锁' : 'Removed Herobrine·脱锁',
    action: '被暂时从世界状态中移除',
  });
  const clearedStatuses = removeEffects(target, { reason: 'scripted' });
  const clearedBarriers = removeBarriers(target);
  if (clearedStatuses.length > 0 || clearedBarriers.length > 0) {
    runtime.log(
      'info',
      `⬜ 【Removed 状态重置】${target.name} 的 ${clearedStatuses.length} 个临时状态与 ${clearedBarriers.length} 层护盾随本体一同消失，不会冻结到下次回归。`,
      {
        actorId: target.id,
        actorName: target.name,
        targetIds: [target.id],
      },
    );
  }
  delete event.hiddenUntilTurn;
  delete event.fogBehindPending;
  event.directHitsSinceFog = 0;
  const marked = runtime.fighters.find((fighter) => fighter.id === event.dontLookBackTargetId);
  if (marked) {
    removeEffects(marked, { identityIds: [HEROBRINE_DONT_LOOK_BACK], reason: 'scripted' });
    runtime.log('info', `👁️ 【不要回头中断】${target.name} 被暂时移除，${marked.name} 背后的注视随之消失。`, {
      actorId: target.id,
      actorName: target.name,
      targetIds: [marked.id],
    });
  }
  delete event.dontLookBackTargetId;
  delete event.dontLookBackExpiresLargeRound;
  setCurrentHp(target, 0);
  target.isDead = true;
  target.isDeadAnnounced = true;
  event.phase = 'removed';
  event.removedReturnTurn = runtime.turnCount + REMOVED_RETURN_TURNS;
  if (event.singleWorld) endSingleWorld(runtime, 'Herobrine 暂时被击倒');
  setNpcCombatCapabilities(target, {
    actionMode: 'none',
    visible: false,
    targetable: false,
    aoeVulnerable: false,
    blocksSettlement: true,
  });
  exposeRemovedTraces(runtime, true);
  runtime.log('system', `⬜ 【Removed Herobrine.】${options.killer?.name ?? '参赛者'} 将 Herobrine 的生命压至零，但这不是真正退场。十个全局行动后他必定回归，清除异常痕迹也无法阻止。`, {
    actorId: options.killer?.id,
    actorName: options.killer?.name,
    targetIds: [target.id],
  });
  return true;
}

export function handleHerobrineContestantDefeat(runtime: HerobrineRuntime, defeated: Fighter): void {
  const event = getHerobrineEvent(runtime.battleState);
  if (!event || event.completed || defeated.isNpc) return;
  if (event.singleWorld?.targetId === defeated.id) {
    endSingleWorld(runtime, `${defeated.name} 在隔离期间被击倒`);
  }
  if (event.dontLookBackTargetId === defeated.id) {
    removeEffects(defeated, { identityIds: [HEROBRINE_DONT_LOOK_BACK], reason: 'scripted' });
    delete event.dontLookBackTargetId;
    delete event.dontLookBackExpiresLargeRound;
  }
  if (defeated.isSummon) return;
  const contestants = activeContestants(runtime);
  if (event.finalPursuit && contestants.length === 0) {
    event.finalPursuitDefeatedContestantId = defeated.id;
    concludeHerobrineHunt(runtime, `${defeated.name} 在最终追猎中被击倒，比赛按参赛者死亡顺序结算`);
  } else if (contestants.length === 1) {
    enterFinalPursuit(runtime, contestants[0]);
  }
}

export function isHerobrineCharmImmune(target: Fighter, identityId: string): boolean {
  return isHerobrine(target) && identityId === 'CHARMED';
}

export function shouldPreventHerobrineSupport(
  state: BattleState,
  provider: Fighter | undefined,
  target: Fighter,
): boolean {
  const event = getHerobrineEvent(state);
  if (!event?.singleWorld || !provider || provider.id === target.id) return false;
  const targetInside = target.id === event.singleWorld.targetId || target.id === event.herobrineId;
  const providerInside = provider.id === event.singleWorld.targetId || provider.id === event.herobrineId;
  return targetInside !== providerInside;
}
