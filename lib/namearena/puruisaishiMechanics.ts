import { healFighter, isActiveCombatant, isWinningCombatant, setCurrentHp, syncHpPct } from './combatState';
import type {
  BattleEngineCore,
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  JobDefinition,
} from './types';
import { createLifecycleStatus, refreshLifecycleStatus } from './statusLifecycle';
import { withTimedStatModifiersSuspended } from './statModifiers';

export const ORIGINIUM_DISEASE_STATUS = 'ORIGINIUM_DISEASE';
export const PURUISAISHI_SETTLEMENT_MESSAGE = '我会一直看着你，预言家';

const PURUISAISHI_SPAWN_START_TURN = 30;
const PURUISAISHI_SPAWN_END_TURN = 260;
const PURUISAISHI_SPAWN_CHANCE = 0.0015;
const PURUISAISHI_PHASE_TWO_TURN = 50;
const PURUISAISHI_PHASE_TWO_SHIELD = 16000;
const PURUISAISHI_PHASE_TWO_STACKS = 4;
const PURUISAISHI_PHASE_TWO_TARGET_MIN = 1;
const PURUISAISHI_PHASE_TWO_TARGET_MAX = 3;
const PURUISAISHI_PHASE_TWO_PULSE_TURNS = 20;

const ANANNA_UNTARGETABLE_TURNS = 5;
const ANANNA_GROWTH_TURNS = 20;
const CRYSTAL_UNTARGETABLE_TURNS = 1;
const CRYSTAL_MAX_COUNT = 12;
const CRYSTAL_THRESHOLD_COUNT = 10;
const CRYSTAL_ATTACK_INFECTION_CHANCE = 0.35;
const CRYSTAL_ATTACK_INFECTION_STACKS = 3;
const CRYSTAL_OVERFLOW_INFECTION_STACKS = 2;
const CRYSTAL_BREAK_CLEANSE_STACKS = 2;
const CRYSTAL_BREAK_HEAL_RATIO = 0.03;
const ORIGINIUM_MAX_STACKS = 80;
const ORIGINIUM_BONUS_CLEAR_STACKS = 60;

type OriginiumStatKey = 'maxHp' | 'atk' | 'def' | 'res';
type OriginiumStatMultipliers = Record<OriginiumStatKey, number>;

const NEUTRAL_ORIGINIUM_MULTIPLIERS: OriginiumStatMultipliers = {
  maxHp: 1,
  atk: 1,
  def: 1,
  res: 1,
};

export interface PuruisaishiRuntime {
  fighters: Fighter[];
  core: BattleEngineCore;
  turnCount: number;
  largeRound?: number;
  completedLargeRound?: number;
  largeRoundParticipantIds?: string[];
  largeRoundActedIds?: string[];
  log: (type: string, text: string) => void;
  isActiveCombatant: (fighter: Fighter) => boolean;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  flushDeferredDamageEvents?: (fighter: Fighter) => void;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
}

type PuruisaishiSpawnRuntime = Pick<PuruisaishiRuntime, 'fighters' | 'core' | 'turnCount' | 'log' | 'largeRound'>;

function createNpcJob(name: string, icon: string): JobDefinition {
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

function npcId(runtime: Pick<PuruisaishiRuntime, 'core'>, prefix: string): string {
  return runtime.core.generateUUID ? runtime.core.generateUUID() : `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function makeNpcBase(runtime: Pick<PuruisaishiRuntime, 'core'>, name: string, jobName: string, icon: string, hp: number): Fighter {
  const jobData = createNpcJob(jobName, icon);
  return {
    id: npcId(runtime, name),
    name,
    displayName: name,
    job: 'NPC',
    jobData,
    maxHp: hp,
    currentHp: hp,
    hpPct: 1,
    atk: 1,
    def: 1,
    spd: 1,
    agl: 1,
    mag: 1,
    res: 1,
    wis: 1,
    critRate: 0,
    color: 'from-violet-500 to-fuchsia-500',
    isDead: false,
    isDeadAnnounced: false,
    status: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    teamId: 'PURUISAISHI_EVENT',
    isNpc: true,
    cannotWin: true,
    cannotAct: true,
  };
}

function createPuruisaishi(runtime: Pick<PuruisaishiRuntime, 'core' | 'turnCount'>): Fighter {
  const puruisaishi = makeNpcBase(runtime, '普瑞赛斯的源石映像', '非玩家角色', '🜲', 9999);
  puruisaishi.isPuruisaishi = true;
  puruisaishi.puruisaishiPhase = 1;
  puruisaishi.puruisaishiEnteredTurn = runtime.turnCount;
  puruisaishi.puruisaishiAppeared = true;
  puruisaishi.puruisaishiShield = 0;
  puruisaishi.untargetableUntilTurn = Number.MAX_SAFE_INTEGER;
  return puruisaishi;
}

function createAnanna(runtime: Pick<PuruisaishiRuntime, 'core' | 'turnCount'>, parent: Fighter): Fighter {
  const ananna = makeNpcBase(runtime, '阿喃那', '最初的源石', '🜚', 5200);
  ananna.color = 'from-stone-400 to-violet-500';
  ananna.isOriginiumCore = true;
  ananna.originiumParentId = parent.id;
  ananna.originiumSpawnTurn = runtime.turnCount;
  ananna.originiumGrowthRoundActorIds = [];
  ananna.untargetableUntilTurn = runtime.turnCount + ANANNA_UNTARGETABLE_TURNS;
  return ananna;
}

function createOriginiumCrystal(runtime: PuruisaishiRuntime, parentId: string): Fighter {
  const existing = runtime.fighters.filter((fighter) => fighter.isOriginiumCrystal).length;
  const name = existing === 0 ? '源石结晶' : `源石结晶#${existing + 1}`;
  const crystal = makeNpcBase(runtime, name, '源石结晶', '◆', 760);
  crystal.color = 'from-purple-400 to-slate-500';
  crystal.isOriginiumCrystal = true;
  crystal.originiumParentId = parentId;
  crystal.originiumSpawnTurn = runtime.turnCount;
  crystal.originiumSpawnLargeRound = runtime.largeRound ?? 1;
  crystal.originiumGrowthRoundActorIds = [];
  crystal.untargetableUntilTurn = runtime.turnCount + CRYSTAL_UNTARGETABLE_TURNS;
  return crystal;
}

function activeCrystals(runtime: Pick<PuruisaishiRuntime, 'fighters' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((fighter) => fighter.isOriginiumCrystal && runtime.isActiveCombatant(fighter));
}

function activePuruisaishi(runtime: Pick<PuruisaishiRuntime, 'fighters' | 'isActiveCombatant'>): Fighter | undefined {
  return runtime.fighters.find((fighter) => fighter.isPuruisaishi && runtime.isActiveCombatant(fighter));
}

function activeInfectionTargets(runtime: Pick<PuruisaishiRuntime, 'fighters' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    !fighter.isPuruisaishi &&
    !fighter.isOriginiumCore &&
    !fighter.isOriginiumCrystal,
  );
}

function activeWinningParticipants(runtime: Pick<PuruisaishiRuntime, 'fighters'>): Fighter[] {
  return runtime.fighters.filter(isWinningCombatant);
}

function hasRoundBlockingStatus(fighter: Fighter): boolean {
  return fighter.status.some((status) =>
    status.type === 'SYNERGY_SLACKING' ||
    status.type === 'WAIT_COUNTER' ||
    status.type.startsWith('CTR_'),
  );
}

function activePhaseRoundActors(runtime: Pick<PuruisaishiRuntime, 'fighters' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    runtime.isActiveCombatant(fighter) &&
    !fighter.isNpc &&
    !fighter.cannotAct &&
    !hasRoundBlockingStatus(fighter),
  );
}

export function hasPuruisaishiAppeared(fighters: Fighter[]): boolean {
  return fighters.some((fighter) => fighter.isPuruisaishi || fighter.puruisaishiAppeared);
}

export function shouldTrySpawnPuruisaishi(runtime: PuruisaishiRuntime): boolean {
  if (runtime.fighters.some((fighter) => fighter.isPuruisaishi || fighter.puruisaishiAppeared)) return false;
  if (runtime.turnCount < PURUISAISHI_SPAWN_START_TURN || runtime.turnCount > PURUISAISHI_SPAWN_END_TURN) return false;
  if (activeWinningParticipants(runtime).length < 5) return false;
  return Math.random() < PURUISAISHI_SPAWN_CHANCE;
}

export function spawnPuruisaishiEvent(runtime: PuruisaishiSpawnRuntime, reason = '源石映像干涉战场'): Fighter {
  const existing = runtime.fighters.find((fighter) => fighter.isPuruisaishi);
  if (existing) return existing;

  const puruisaishi = createPuruisaishi(runtime);
  const ananna = createAnanna(runtime, puruisaishi);
  runtime.fighters.push(puruisaishi, ananna);
  runtime.log('system', `🜲 【普瑞赛斯】${reason}，${puruisaishi.name} 出现在战场边缘。她不在参赛名单中，不会攻击，也不会成为胜利者。`);
  runtime.log('skill', `🜚 【阿喃那】最初的源石在 ${puruisaishi.name} 身旁生成；5 回合内无法被选为攻击目标，并将开始增殖源石结晶。`);
  return puruisaishi;
}

export function trySpawnPuruisaishiEvent(runtime: PuruisaishiRuntime): boolean {
  if (!shouldTrySpawnPuruisaishi(runtime)) return false;
  spawnPuruisaishiEvent(runtime);
  return true;
}

function ensureOriginiumStatus(target: Fighter): void {
  const status = target.status.find((entry) => entry.type === ORIGINIUM_DISEASE_STATUS);
  if (status) {
    refreshLifecycleStatus(status, 999);
    return;
  }
  target.status.push(createLifecycleStatus(ORIGINIUM_DISEASE_STATUS, 999));
}

function originiumMultipliersForStacks(stacks: number): OriginiumStatMultipliers {
  const hpMultiplier = Math.max(0.42, 1 - stacks * 0.0065);
  const defMultiplier = Math.max(0.28, 1 - stacks * 0.008);
  const hasOffensiveBonus = stacks < ORIGINIUM_BONUS_CLEAR_STACKS;
  const offenseMultiplier = hasOffensiveBonus ? 1 + stacks * 0.01 : 1;
  return {
    maxHp: hpMultiplier,
    atk: offenseMultiplier,
    def: defMultiplier,
    res: offenseMultiplier,
  };
}

function sameOriginiumMultipliers(a: OriginiumStatMultipliers, b: OriginiumStatMultipliers): boolean {
  return a.maxHp === b.maxHp && a.atk === b.atk && a.def === b.def && a.res === b.res;
}

function transitionOriginiumStatShape(target: Fighter, next: OriginiumStatMultipliers): void {
  const previous = target.originiumStatMultipliers ?? NEUTRAL_ORIGINIUM_MULTIPLIERS;
  if (sameOriginiumMultipliers(previous, next)) return;
  withTimedStatModifiersSuspended(target, () => {
    const rescale = (value: number, from: number, to: number) => {
      const unshaped = Math.max(1, Math.round(value / Math.max(0.0001, from)));
      return Math.max(1, Math.floor(unshaped * to));
    };

    target.maxHp = rescale(target.maxHp, previous.maxHp, next.maxHp);
    target.atk = rescale(target.atk, previous.atk, next.atk);
    target.def = rescale(target.def, previous.def, next.def);
    target.res = rescale(target.res, previous.res, next.res);
    target.originiumStatMultipliers = { ...next };
    if (target.currentHp > target.maxHp) target.currentHp = target.maxHp;
    syncHpPct(target);
  });
}

function applyOriginiumStatShape(target: Fighter): void {
  const stacks = Math.max(0, Math.min(ORIGINIUM_MAX_STACKS, target.originiumInfectionStacks ?? 0));
  transitionOriginiumStatShape(target, originiumMultipliersForStacks(stacks));
}

export function withOriginiumStatShapeSuspended(target: Fighter, mutate: () => void): void {
  const stacks = Math.max(0, Math.min(ORIGINIUM_MAX_STACKS, target.originiumInfectionStacks ?? 0));
  const hasShape = stacks > 0 && !!target.originiumStatMultipliers;
  if (!hasShape) {
    mutate();
    return;
  }

  transitionOriginiumStatShape(target, NEUTRAL_ORIGINIUM_MULTIPLIERS);
  try {
    mutate();
  } finally {
    applyOriginiumStatShape(target);
  }
}

function clearOriginiumInfection(target: Fighter): void {
  transitionOriginiumStatShape(target, NEUTRAL_ORIGINIUM_MULTIPLIERS);
  delete target.originiumStatMultipliers;
  target.originiumInfectionStacks = 0;
  target.status = target.status.filter((status) => status.type !== ORIGINIUM_DISEASE_STATUS);
  if (target.currentHp > target.maxHp) target.currentHp = target.maxHp;
  syncHpPct(target);
}

export function addOriginiumInfection(
  runtime: PuruisaishiRuntime,
  target: Fighter,
  stacks: number,
  reason: string,
  options: { log?: boolean; deferDefeat?: boolean } = {},
): number {
  if (stacks <= 0 || !runtime.isActiveCombatant(target)) return 0;
  if (target.isPuruisaishi || target.isOriginiumCore || target.isOriginiumCrystal) return 0;

  const before = Math.max(0, target.originiumInfectionStacks ?? 0);
  const next = Math.min(ORIGINIUM_MAX_STACKS, before + stacks);
  target.originiumInfectionStacks = next;
  ensureOriginiumStatus(target);
  applyOriginiumStatShape(target);
  const gained = next - before;
  if (gained > 0 && options.log !== false) {
    runtime.log('poison', `🦠 【矿石病】${target.name} 因${reason}感染加深 +${gained} 层（当前 ${next}/${ORIGINIUM_MAX_STACKS}）。`);
  }
  if (next >= ORIGINIUM_MAX_STACKS && !options.deferDefeat) {
    runtime.markDefeated(target, {
      message: `💀 【矿石病】${target.name} 的矿石病达到 80 层，身体被源石彻底吞没！`,
      awardKill: false,
    });
  }
  return gained;
}

export function reduceOriginiumInfection(target: Fighter, stacks: number): number {
  const before = Math.max(0, target.originiumInfectionStacks ?? 0);
  if (before <= 0 || stacks <= 0) return 0;
  const next = Math.max(0, before - stacks);
  target.originiumInfectionStacks = next;
  applyOriginiumStatShape(target);
  if (next === 0) {
    delete target.originiumStatMultipliers;
    target.status = target.status.filter((status) => status.type !== ORIGINIUM_DISEASE_STATUS);
  }
  return before - next;
}

function roll<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function growCrystal(runtime: PuruisaishiRuntime, parentId: string, reason: string): boolean {
  if (activeCrystals(runtime).length >= CRYSTAL_MAX_COUNT) return false;
  const crystal = createOriginiumCrystal(runtime, parentId);
  runtime.fighters.push(crystal);
  runtime.log('skill', `◆ 【源石增殖】${reason}，新的 ${crystal.name} 在战场上生成。`);
  return true;
}

function shouldTriggerInterval(runtime: PuruisaishiRuntime, startTurn: number, intervalTurns: number): boolean {
  const elapsed = runtime.turnCount - startTurn;
  return elapsed > 0 && elapsed % intervalTurns === 0;
}

function processAnannaGrowth(runtime: PuruisaishiRuntime): void {
  const core = runtime.fighters.find((fighter) => fighter.isOriginiumCore && runtime.isActiveCombatant(fighter));
  if (!core) return;
  const spawnTurn = core.originiumSpawnTurn ?? runtime.turnCount;
  if (core.originiumLastGrowthTurn === runtime.turnCount) return;
  if (!shouldTriggerInterval(runtime, spawnTurn, ANANNA_GROWTH_TURNS)) return;
  core.originiumLastGrowthTurn = runtime.turnCount;
  growCrystal(runtime, core.id, '阿喃那经过 20 回合完成增殖');
}

function processOriginiumCrystalGrowth(runtime: PuruisaishiRuntime): void {
  if (runtime.completedLargeRound !== undefined) {
    const completedRound = runtime.completedLargeRound;
    const core = runtime.fighters.find((fighter) => fighter.isOriginiumCore && runtime.isActiveCombatant(fighter));
    activeCrystals(runtime).forEach((source) => {
      if (source.originiumLastGrowthLargeRound === completedRound) return;
      source.originiumLastGrowthLargeRound = completedRound;
      const wasAttacked = !!source.originiumWasAttackedThisGrowthRound;
      source.originiumGrowthRoundActorIds = [];
      source.originiumWasAttackedThisGrowthRound = false;
      const existedForFullRound = (source.originiumSpawnLargeRound ?? completedRound) < completedRound;
      if (!existedForFullRound) return;
      if (wasAttacked) return;
      growCrystal(
        runtime,
        source.originiumParentId ?? core?.id ?? source.id,
        `${source.name} 在第 ${completedRound} 个大回合内没有被攻击`,
      );
    });
    return;
  }

  // The fallback actor ledger exists only for old isolated callers. A live
  // battle with a formal roster must wait for BattleState to complete the round.
  if (runtime.largeRoundParticipantIds !== undefined) return;

  const actors = activePhaseRoundActors(runtime);
  if (actors.length === 0) return;
  const actorIds = new Set(actors.map((actor) => actor.id));
  const core = runtime.fighters.find((fighter) => fighter.isOriginiumCore && runtime.isActiveCombatant(fighter));
  const growthSources = activeCrystals(runtime)
    .filter((source) => (source.originiumSpawnTurn ?? runtime.turnCount) < runtime.turnCount);

  growthSources.forEach((source) => {
    const actedIds = new Set((source.originiumGrowthRoundActorIds ?? []).filter((id) => actorIds.has(id)));
    source.originiumGrowthRoundActorIds = [...actedIds];
    if (actors.some((actor) => !actedIds.has(actor.id))) return;

    const wasAttacked = !!source.originiumWasAttackedThisGrowthRound;
    source.originiumGrowthRoundActorIds = [];
    source.originiumWasAttackedThisGrowthRound = false;
    if (wasAttacked) return;
    growCrystal(runtime, source.originiumParentId ?? core?.id ?? source.id, `${source.name} 一个大回合内没有被攻击`);
  });
}

export function processPuruisaishiLargeRoundEnd(runtime: PuruisaishiRuntime): void {
  if (!runtime.fighters.some((fighter) => fighter.isPuruisaishi)) return;
  processOriginiumCrystalGrowth(runtime);
}

function processCrystalOverflowInfection(runtime: PuruisaishiRuntime): void {
  const count = activeCrystals(runtime).length;
  if (count <= CRYSTAL_THRESHOLD_COUNT) return;
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi) return;
  const largeRound = runtime.completedLargeRound ?? runtime.largeRound ?? 1;
  if (puruisaishi.puruisaishiLastOverflowLargeRound === largeRound) return;
  const targets = activeInfectionTargets(runtime);
  if (targets.length === 0) return;
  puruisaishi.puruisaishiLastOverflowLargeRound = largeRound;
  const terminalTargets: Fighter[] = [];
  const affected = targets.flatMap((target) => {
    const gained = addOriginiumInfection(
      runtime,
      target,
      CRYSTAL_OVERFLOW_INFECTION_STACKS,
      '源石结晶泛滥',
      { log: false, deferDefeat: true },
    );
    if ((target.originiumInfectionStacks ?? 0) >= ORIGINIUM_MAX_STACKS) terminalTargets.push(target);
    return gained > 0 ? [`${target.name} +${gained}（${target.originiumInfectionStacks ?? 0}/${ORIGINIUM_MAX_STACKS}）`] : [];
  });
  const affectedText = affected.length > 0 ? `本轮感染：${affected.join('、')}。` : '本轮没有可继续加深感染的目标。';
  runtime.log('poison', `🦠 【源石泛滥】场上源石结晶达到 ${count} 个，除普瑞赛斯外全场感染矿石病！${affectedText}`);
  terminalTargets.forEach((target) => {
    runtime.markDefeated(target, {
      message: `💀 【矿石病】${target.name} 的矿石病达到 80 层，身体被源石彻底吞没！`,
      awardKill: false,
    });
  });
}

function processPuruisaishiPhase(runtime: PuruisaishiRuntime): void {
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi) return;
  const phase = puruisaishi.puruisaishiPhase ?? 1;
  const enteredTurn = puruisaishi.puruisaishiEnteredTurn ?? runtime.turnCount;
  const phaseTwoTurn = enteredTurn + PURUISAISHI_PHASE_TWO_TURN;

  if (phase < 2 && runtime.turnCount >= phaseTwoTurn) {
    puruisaishi.puruisaishiPhase = 2;
    puruisaishi.puruisaishiPhaseTwoStartedTurn = phaseTwoTurn;
    puruisaishi.untargetableUntilTurn = undefined;
    puruisaishi.puruisaishiShield = Math.max(puruisaishi.puruisaishiShield ?? 0, PURUISAISHI_PHASE_TWO_SHIELD);
    puruisaishi.status.push(createLifecycleStatus('PURUISAISHI_SHIELD', 999));
    runtime.log('transform', `🜲 【这里万籁俱寂，太安静了，别丢下我】${puruisaishi.name} 出场 50 回合后进入二阶段，生成 ${puruisaishi.puruisaishiShield} 点护盾。`);
  }
}

function processPuruisaishiPhaseTwoPulse(runtime: PuruisaishiRuntime): void {
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi || (puruisaishi.puruisaishiPhase ?? 1) < 2) return;
  const phaseTwoStartedTurn = puruisaishi.puruisaishiPhaseTwoStartedTurn ?? runtime.turnCount;
  if (puruisaishi.puruisaishiLastPhaseTwoPulseTurn === runtime.turnCount) return;
  if (!shouldTriggerInterval(runtime, phaseTwoStartedTurn, PURUISAISHI_PHASE_TWO_PULSE_TURNS)) return;
  puruisaishi.puruisaishiLastPhaseTwoPulseTurn = runtime.turnCount;

  const candidates = activeInfectionTargets(runtime);
  const targetCount = Math.min(
    candidates.length,
    PURUISAISHI_PHASE_TWO_TARGET_MIN + Math.floor(Math.random() * (PURUISAISHI_PHASE_TWO_TARGET_MAX - PURUISAISHI_PHASE_TWO_TARGET_MIN + 1)),
  );
  const picked = new Set<string>();
  runtime.log('poison', `🜲 【普瑞赛斯二阶段注视】距离二阶段启动已过去 ${runtime.turnCount - phaseTwoStartedTurn} 回合，源石映像开始随机加深矿石病。`);
  for (let i = 0; i < targetCount; i += 1) {
    const remaining = candidates.filter((target) => !picked.has(target.id));
    const target = roll(remaining);
    if (!target) break;
    picked.add(target.id);
    addOriginiumInfection(runtime, target, PURUISAISHI_PHASE_TWO_STACKS, '普瑞赛斯二阶段注视');
  }
}

function processOriginiumDot(runtime: PuruisaishiRuntime): void {
  const targets = activeInfectionTargets(runtime).filter((fighter) => (fighter.originiumInfectionStacks ?? 0) > 0);
  const settlements: string[] = [];
  const defeatedTargets: Fighter[] = [];
  targets.forEach((target) => {
    if (!runtime.isActiveCombatant(target)) return;
    const stacks = Math.max(0, target.originiumInfectionStacks ?? 0);
    ensureOriginiumStatus(target);
    applyOriginiumStatShape(target);
    if (stacks >= ORIGINIUM_MAX_STACKS) {
      runtime.markDefeated(target, {
        message: `💀 【矿石病】${target.name} 的矿石病达到 80 层，身体被源石彻底吞没！`,
        awardKill: false,
      });
      return;
    }
    const damage = Math.max(stacks, Math.floor(target.maxHp * (0.003 + stacks * 0.0008)));
    const actual = runtime.applyDamage(target, damage, 'status', true, undefined, {
      deferTransform: false,
      actionName: '矿石病',
      respectDefenses: false,
    });
    if (actual > 0) {
      settlements.push(`${target.name} ${actual} 点（${stacks}/${ORIGINIUM_MAX_STACKS} 层）`);
    }
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      defeatedTargets.push(target);
    }
  });
  if (settlements.length > 0) {
    runtime.log('poison', `🦠 【矿石病侵蚀】${settlements.join('、')}。`);
  }
  defeatedTargets.forEach((target) => {
    runtime.markDefeated(target, {
      message: `💀 【矿石病】${target.name} 被源石侵蚀拖垮，倒在战场上！`,
      awardKill: false,
    });
  });
}

export function processPuruisaishiRoundEnd(runtime: PuruisaishiRuntime): void {
  if (!runtime.fighters.some((fighter) => fighter.isPuruisaishi)) return;
  processPuruisaishiPhase(runtime);
  processPuruisaishiPhaseTwoPulse(runtime);
  processAnannaGrowth(runtime);
  processPuruisaishiLargeRoundEnd(runtime);
  processCrystalOverflowInfection(runtime);
  processOriginiumDot(runtime);
}

export function notePuruisaishiRoundActor(runtime: PuruisaishiRuntime, actor: Fighter): void {
  if (runtime.largeRoundParticipantIds) {
    runtime.fighters.forEach((fighter) => {
      if (!fighter.isOriginiumCrystal || !runtime.isActiveCombatant(fighter)) return;
      fighter.originiumGrowthRoundActorIds = [...(runtime.largeRoundActedIds ?? [])];
    });
    return;
  }
  if (!runtime.isActiveCombatant(actor) || actor.isNpc || actor.cannotAct || hasRoundBlockingStatus(actor)) return;

  runtime.fighters.forEach((fighter) => {
    if (!fighter.isOriginiumCrystal) return;
    if (!runtime.isActiveCombatant(fighter)) return;
    const ids = new Set(fighter.originiumGrowthRoundActorIds ?? []);
    ids.add(actor.id);
    fighter.originiumGrowthRoundActorIds = [...ids];
  });
}

export function redirectOriginiumCoreDamage(
  runtime: PuruisaishiRuntime,
  target: Fighter,
  amount: number,
  source: string,
  isTrueDamage: boolean,
  attacker?: Fighter,
  options?: DamageApplicationOptions,
): { handled: boolean; actualDamage: number } {
  if (!target.isOriginiumCore || source === 'originium_share') return { handled: false, actualDamage: amount };
  const crystals = activeCrystals(runtime);
  if (crystals.length === 0) return { handled: false, actualDamage: amount };
  if (options) options.redirectedByOriginiumCore = true;

  const baseShare = Math.floor(amount / crystals.length);
  let remainder = amount % crystals.length;
  let actualTotal = 0;
  const settlements: Array<{ crystal: Fighter; share: number; actual: number }> = [];
  const incoming = attacker
    ? `${attacker.name} 的${options?.actionName ? `【${options.actionName}】` : '攻击'}`
    : options?.actionName
      ? `【${options.actionName}】`
      : '来袭攻击';
  runtime.log('info', `🜚 【阿喃那】${target.name} 截获 ${incoming} 形成的 ${amount} 点冲击，并将其均摊给 ${crystals.length} 个源石结晶；阿喃那本体不承受伤害。`);
  crystals.forEach((crystal) => {
    const share = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    if (share <= 0) return;
    const actual = runtime.applyDamage(crystal, share, 'originium_share', isTrueDamage, attacker, {
      deferTransform: true,
      actionName: '阿喃那伤害均摊',
      respectDefenses: false,
      bypassOwlOutgoingModifier: true,
    });
    actualTotal += actual;
    settlements.push({ crystal, share, actual });
  });
  if (settlements.length > 0) {
    runtime.log('info', `🜚 【阿喃那分流结算】${settlements.map(({ crystal, share, actual }) =>
      `${crystal.name} 分得 ${share} 点、生命实际损失 ${actual} 点`
    ).join('；')}。`);
  }
  settlements.forEach(({ crystal, actual }) => {
    runtime.flushDeferredDamageEvents?.(crystal);
    if (crystal.currentHp <= 0 && !crystal.isDead && !crystal.isDeadAnnounced) {
      runtime.markDefeated(crystal, {
        message: `💀 【阿喃那伤害均摊】${crystal.name} 被 ${incoming} 经源石网络分流的 ${actual} 点伤害击碎！`,
        killer: attacker,
      });
    }
  });
  if (options) options.redirectedOriginiumDamage = actualTotal;
  return { handled: true, actualDamage: actualTotal };
}

export function consumePuruisaishiShield(runtime: PuruisaishiRuntime, target: Fighter, amount: number): { handled: boolean; remaining: number; absorbed: number; retreated: boolean } {
  if (!target.isPuruisaishi || (target.puruisaishiShield ?? 0) <= 0 || amount <= 0) {
    return { handled: false, remaining: amount, absorbed: 0, retreated: false };
  }

  const before = target.puruisaishiShield ?? 0;
  const crystalsExist = activeCrystals(runtime).length > 0;
  const floor = crystalsExist ? 1 : 0;
  const after = Math.max(floor, before - amount);
  const absorbed = before - after;
  target.puruisaishiShield = after;
  const diverted = crystalsExist && after === 1 ? Math.max(0, amount - absorbed) : 0;
  const networkText = diverted > 0 ? `；源石结晶维系最后 1 点护盾，并导走剩余 ${diverted} 点冲击` : '';
  runtime.log('info', `🛡️ 【普瑞赛斯护盾】${target.name} 的护盾吸收 ${absorbed} 点伤害，剩余 ${after}${networkText}。`);

  if (after <= 0 && !crystalsExist) {
    clearAllOriginiumAndRetreat(runtime, target);
    return { handled: true, remaining: 0, absorbed, retreated: true };
  }

  return { handled: true, remaining: crystalsExist ? 0 : Math.max(0, amount - absorbed), absorbed, retreated: false };
}

export function noteOriginiumDamageLanded(
  runtime: PuruisaishiRuntime,
  target: Fighter,
  source: string,
  attacker?: Fighter,
): void {
  if (!target.isOriginiumCrystal && !target.isOriginiumCore) return;
  target.originiumWasAttackedTurn = runtime.turnCount;
  target.originiumWasAttackedThisGrowthRound = true;
  if (
    target.isOriginiumCrystal &&
    attacker &&
    attacker.id !== target.id &&
    source !== 'status' &&
    source !== 'originium_share' &&
    Math.random() < CRYSTAL_ATTACK_INFECTION_CHANCE
  ) {
    addOriginiumInfection(runtime, attacker, CRYSTAL_ATTACK_INFECTION_STACKS, `攻击 ${target.name}`);
  }
}

export function spawnCrystalFromInfectedDeath(runtime: PuruisaishiRuntime, carrier: Fighter): void {
  if ((carrier.originiumInfectionStacks ?? 0) <= 0) return;
  if (carrier.isPuruisaishi || carrier.isOriginiumCore || carrier.isOriginiumCrystal) return;
  if (!runtime.fighters.some((fighter) => fighter.isPuruisaishi)) return;
  if (activeCrystals(runtime).length >= CRYSTAL_MAX_COUNT) return;
  const parent = runtime.fighters.find((fighter) => fighter.isOriginiumCore) ?? activePuruisaishi(runtime);
  const crystal = createOriginiumCrystal(runtime, parent?.id ?? carrier.id);
  runtime.fighters.push(crystal);
  runtime.log('death', `◆ 【源石析出】${carrier.name} 死亡后，体内矿石病结晶化，生成了 ${crystal.name}。`);
}

export function grantOriginiumCrystalBreakReward(
  runtime: Pick<PuruisaishiRuntime, 'fighters' | 'log'>,
  crystal: Fighter,
  killer?: Fighter,
): void {
  if (!crystal.isOriginiumCrystal || !killer) return;
  const summoner = killer.isSummon && killer.summonerId
    ? runtime.fighters.find((fighter) => fighter.id === killer.summonerId)
    : undefined;
  const beneficiary = summoner ?? killer;
  if (beneficiary.isNpc || beneficiary.cannotWin || beneficiary.isDead || beneficiary.currentHp <= 0) return;

  const reduced = reduceOriginiumInfection(beneficiary, CRYSTAL_BREAK_CLEANSE_STACKS);
  const healed = healFighter(beneficiary, Math.floor(beneficiary.maxHp * CRYSTAL_BREAK_HEAL_RATIO), runtime.log);
  const recovery = [
    reduced > 0 ? `矿石病 -${reduced} 层（当前 ${beneficiary.originiumInfectionStacks ?? 0}/${ORIGINIUM_MAX_STACKS}）` : '没有可清除的矿石病层数',
    healed > 0 ? `恢复 ${healed} 点生命` : '生命已满',
  ].join('，');
  runtime.log(healed > 0 || reduced > 0 ? 'heal' : 'info', `◆ 【源石破拆】${beneficiary.name} 摧毁 ${crystal.name}，从崩解源石中争取到喘息：${recovery}。`);
}

export function clearAllOriginiumAndRetreat(runtime: PuruisaishiRuntime, puruisaishi: Fighter): void {
  runtime.fighters.forEach((fighter) => {
    if ((fighter.originiumInfectionStacks ?? 0) > 0 || fighter.status.some((status) => status.type === ORIGINIUM_DISEASE_STATUS)) {
      clearOriginiumInfection(fighter);
    }
    if (fighter.isOriginiumCore || fighter.isOriginiumCrystal) {
      setCurrentHp(fighter, 0);
      fighter.isDead = true;
      fighter.isDeadAnnounced = true;
    }
  });

  puruisaishi.puruisaishiShield = 0;
  puruisaishi.status = puruisaishi.status.filter((status) => status.type !== 'PURUISAISHI_SHIELD');
  setCurrentHp(puruisaishi, 0);
  puruisaishi.isDead = true;
  puruisaishi.isDeadAnnounced = true;
  runtime.log('system', `🜲 【普瑞赛斯退场】${puruisaishi.name} 的护盾归零，清除全场矿石病层数后离开战场。`);
}

export function isOriginiumNpc(fighter: Fighter): boolean {
  return !!(fighter.isPuruisaishi || fighter.isOriginiumCore || fighter.isOriginiumCrystal);
}

export function isActiveNonNpcCombatant(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) && !fighter.isNpc;
}
