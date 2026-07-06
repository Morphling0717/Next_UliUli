import { isActiveCombatant, isWinningCombatant, setCurrentHp, syncHpPct } from './combatState';
import type {
  BattleEngineCore,
  DefeatOptions,
  Fighter,
  JobDefinition,
} from './types';

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

const ANANNA_UNTARGETABLE_TURNS = 5;
const CRYSTAL_UNTARGETABLE_TURNS = 1;
const CRYSTAL_MAX_COUNT = 12;
const CRYSTAL_THRESHOLD_COUNT = 10;
const CRYSTAL_ATTACK_INFECTION_CHANCE = 0.35;
const CRYSTAL_ATTACK_INFECTION_STACKS = 3;
const CRYSTAL_OVERFLOW_INFECTION_STACKS = 2;
const ORIGINIUM_MAX_STACKS = 80;
const ORIGINIUM_BONUS_CLEAR_STACKS = 60;

type OriginiumStatKey = 'maxHp' | 'atk' | 'def' | 'res';
const ORIGINIUM_STAT_KEYS: OriginiumStatKey[] = ['maxHp', 'atk', 'def', 'res'];

export interface PuruisaishiRuntime {
  fighters: Fighter[];
  core: BattleEngineCore;
  turnCount: number;
  log: (type: string, text: string) => void;
  isActiveCombatant: (fighter: Fighter) => boolean;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: {
      deferTransform?: boolean;
      actionName?: string;
      respectDefenses?: boolean;
    },
  ) => number;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
}

type PuruisaishiSpawnRuntime = Pick<PuruisaishiRuntime, 'fighters' | 'core' | 'turnCount' | 'log'>;

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
  runtime.log('transform', `🜲 【普瑞赛斯】${reason}，${puruisaishi.name} 出现在战场边缘。她不在参赛名单中，不会攻击，也不会成为胜利者。`);
  runtime.log('skill', `🜚 【阿喃那】最初的源石在 ${puruisaishi.name} 身旁生成；5 回合内无法被选为攻击目标，并将开始增殖源石结晶。`);
  return puruisaishi;
}

export function trySpawnPuruisaishiEvent(runtime: PuruisaishiRuntime): boolean {
  if (!shouldTrySpawnPuruisaishi(runtime)) return false;
  spawnPuruisaishiEvent(runtime);
  return true;
}

function ensureOriginiumBaseStats(target: Fighter): void {
  if (target.originiumBaseStats) return;
  target.originiumBaseStats = {
    maxHp: target.maxHp,
    atk: target.atk,
    def: target.def,
    res: target.res,
  };
}

function ensureOriginiumStatus(target: Fighter): void {
  const status = target.status.find((entry) => entry.type === ORIGINIUM_DISEASE_STATUS);
  if (status) {
    status.duration = 999;
    return;
  }
  target.status.push({ type: ORIGINIUM_DISEASE_STATUS, duration: 999 });
}

function applyOriginiumStatShape(target: Fighter): void {
  const stacks = Math.max(0, Math.min(ORIGINIUM_MAX_STACKS, target.originiumInfectionStacks ?? 0));
  const base = target.originiumBaseStats;
  if (!base) return;

  const hpMultiplier = Math.max(0.42, 1 - stacks * 0.0065);
  const defMultiplier = Math.max(0.28, 1 - stacks * 0.008);
  const hasOffensiveBonus = stacks < ORIGINIUM_BONUS_CLEAR_STACKS;
  const offenseMultiplier = hasOffensiveBonus ? 1 + stacks * 0.01 : 1;

  target.maxHp = Math.max(1, Math.floor(base.maxHp * hpMultiplier));
  target.def = Math.max(1, Math.floor(base.def * defMultiplier));
  target.atk = Math.max(1, Math.floor(base.atk * offenseMultiplier));
  target.res = Math.max(1, Math.floor(base.res * offenseMultiplier));
  if (target.currentHp > target.maxHp) target.currentHp = target.maxHp;
  syncHpPct(target);
}

function clearOriginiumInfection(target: Fighter): void {
  const base = target.originiumBaseStats;
  if (base) {
    ORIGINIUM_STAT_KEYS.forEach((key) => {
      target[key] = base[key];
    });
  }
  delete target.originiumBaseStats;
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
): number {
  if (stacks <= 0 || !runtime.isActiveCombatant(target)) return 0;
  if (target.isPuruisaishi || target.isOriginiumCore || target.isOriginiumCrystal) return 0;

  ensureOriginiumBaseStats(target);
  const before = Math.max(0, target.originiumInfectionStacks ?? 0);
  const next = Math.min(ORIGINIUM_MAX_STACKS, before + stacks);
  target.originiumInfectionStacks = next;
  ensureOriginiumStatus(target);
  applyOriginiumStatShape(target);
  const gained = next - before;
  if (gained > 0) {
    runtime.log('poison', `🦠 【矿石病】${target.name} 因${reason}感染加深 +${gained} 层（当前 ${next}/${ORIGINIUM_MAX_STACKS}）。`);
  }
  if (next >= ORIGINIUM_MAX_STACKS) {
    runtime.markDefeated(target, {
      message: `💀 【矿石病】${target.name} 的矿石病达到 80 层，身体被源石彻底吞没！`,
      awardKill: false,
    });
  }
  return gained;
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

function processOriginiumGrowth(runtime: PuruisaishiRuntime): void {
  const actors = activePhaseRoundActors(runtime);
  if (actors.length === 0) return;
  const actorIds = new Set(actors.map((actor) => actor.id));
  const core = runtime.fighters.find((fighter) => fighter.isOriginiumCore && runtime.isActiveCombatant(fighter));
  const growthSources = [
    ...(core ? [core] : []),
    ...activeCrystals(runtime),
  ].filter((source) => (source.originiumSpawnTurn ?? runtime.turnCount) < runtime.turnCount);

  growthSources.forEach((source) => {
    const actedIds = new Set((source.originiumGrowthRoundActorIds ?? []).filter((id) => actorIds.has(id)));
    source.originiumGrowthRoundActorIds = [...actedIds];
    if (actors.some((actor) => !actedIds.has(actor.id))) return;

    const wasAttacked = !!source.originiumWasAttackedThisGrowthRound;
    source.originiumGrowthRoundActorIds = [];
    source.originiumWasAttackedThisGrowthRound = false;
    if (source.isOriginiumCrystal && wasAttacked) return;
    if (source.isOriginiumCore) {
      growCrystal(runtime, source.id, '阿喃那完成一个大回合增殖');
    } else {
      growCrystal(runtime, source.originiumParentId ?? core?.id ?? source.id, `${source.name} 一个大回合内没有被攻击`);
    }
  });
}

function processCrystalOverflowInfection(runtime: PuruisaishiRuntime): void {
  const count = activeCrystals(runtime).length;
  if (count <= CRYSTAL_THRESHOLD_COUNT) return;
  const targets = activeInfectionTargets(runtime);
  if (targets.length === 0) return;
  runtime.log('poison', `🦠 【源石泛滥】场上源石结晶达到 ${count} 个，除普瑞赛斯外全场感染矿石病！`);
  targets.forEach((target) => addOriginiumInfection(runtime, target, CRYSTAL_OVERFLOW_INFECTION_STACKS, '源石结晶泛滥'));
}

function processPuruisaishiPhase(runtime: PuruisaishiRuntime): void {
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi) return;
  const phase = puruisaishi.puruisaishiPhase ?? 1;
  const enteredTurn = puruisaishi.puruisaishiEnteredTurn ?? runtime.turnCount;

  if (phase < 2 && runtime.turnCount - enteredTurn >= PURUISAISHI_PHASE_TWO_TURN) {
    puruisaishi.puruisaishiPhase = 2;
    puruisaishi.untargetableUntilTurn = undefined;
    puruisaishi.puruisaishiShield = Math.max(puruisaishi.puruisaishiShield ?? 0, PURUISAISHI_PHASE_TWO_SHIELD);
    puruisaishi.puruisaishiRoundActorIds = [];
    puruisaishi.status.push({ type: 'PURUISAISHI_SHIELD', duration: 999 });
    runtime.log('transform', `🜲 【这里万籁俱寂，太安静了，别丢下我】${puruisaishi.name} 出场 50 回合后进入二阶段，生成 ${puruisaishi.puruisaishiShield} 点护盾。`);
  }
}

function processPuruisaishiPhaseTwoBigRound(runtime: PuruisaishiRuntime): void {
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi || (puruisaishi.puruisaishiPhase ?? 1) < 2) return;

  const actors = activePhaseRoundActors(runtime);
  if (actors.length === 0) return;
  const actorIds = new Set(actors.map((actor) => actor.id));
  const actedIds = new Set((puruisaishi.puruisaishiRoundActorIds ?? []).filter((id) => actorIds.has(id)));
  puruisaishi.puruisaishiRoundActorIds = [...actedIds];
  if (actors.some((actor) => !actedIds.has(actor.id))) return;

  const candidates = activeInfectionTargets(runtime);
  const targetCount = Math.min(
    candidates.length,
    PURUISAISHI_PHASE_TWO_TARGET_MIN + Math.floor(Math.random() * (PURUISAISHI_PHASE_TWO_TARGET_MAX - PURUISAISHI_PHASE_TWO_TARGET_MIN + 1)),
  );
  const picked = new Set<string>();
  runtime.log('poison', `🜲 【普瑞赛斯二阶段注视】场上可行动单位完成一个大回合，源石映像开始随机加深矿石病。`);
  for (let i = 0; i < targetCount; i += 1) {
    const remaining = candidates.filter((target) => !picked.has(target.id));
    const target = roll(remaining);
    if (!target) break;
    picked.add(target.id);
    addOriginiumInfection(runtime, target, PURUISAISHI_PHASE_TWO_STACKS, '普瑞赛斯二阶段注视');
  }
  puruisaishi.puruisaishiRoundActorIds = [];
}

function processOriginiumDot(runtime: PuruisaishiRuntime): void {
  const targets = activeInfectionTargets(runtime).filter((fighter) => (fighter.originiumInfectionStacks ?? 0) > 0);
  targets.forEach((target) => {
    if (!runtime.isActiveCombatant(target)) return;
    const stacks = Math.max(0, target.originiumInfectionStacks ?? 0);
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
      runtime.log('poison', `🦠 【矿石病】${target.name} 承受 ${actual} 点源石侵蚀伤害（${stacks}/${ORIGINIUM_MAX_STACKS} 层）。`);
    }
    if (target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【矿石病】${target.name} 被源石侵蚀拖垮，倒在战场上！`,
        awardKill: false,
      });
    }
  });
}

export function processPuruisaishiRoundEnd(runtime: PuruisaishiRuntime): void {
  if (!runtime.fighters.some((fighter) => fighter.isPuruisaishi)) return;
  processPuruisaishiPhase(runtime);
  processPuruisaishiPhaseTwoBigRound(runtime);
  processOriginiumGrowth(runtime);
  processCrystalOverflowInfection(runtime);
  processOriginiumDot(runtime);
}

export function notePuruisaishiRoundActor(runtime: PuruisaishiRuntime, actor: Fighter): void {
  if (!runtime.isActiveCombatant(actor) || actor.isNpc || actor.cannotAct || hasRoundBlockingStatus(actor)) return;

  const puruisaishi = activePuruisaishi(runtime);
  if (puruisaishi && (puruisaishi.puruisaishiPhase ?? 1) >= 2) {
    const ids = new Set(puruisaishi.puruisaishiRoundActorIds ?? []);
    ids.add(actor.id);
    puruisaishi.puruisaishiRoundActorIds = [...ids];
  }

  runtime.fighters.forEach((fighter) => {
    if (!fighter.isOriginiumCore && !fighter.isOriginiumCrystal) return;
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
): { handled: boolean; actualDamage: number } {
  if (!target.isOriginiumCore || source === 'originium_share') return { handled: false, actualDamage: amount };
  const crystals = activeCrystals(runtime);
  if (crystals.length === 0) return { handled: false, actualDamage: amount };

  const share = Math.max(1, Math.floor(amount / crystals.length));
  let actualTotal = 0;
  runtime.log('info', `🜚 【阿喃那】${target.name} 将 ${amount} 点伤害均摊给 ${crystals.length} 个源石结晶。`);
  crystals.forEach((crystal) => {
    const actual = runtime.applyDamage(crystal, share, 'originium_share', isTrueDamage, attacker, {
      deferTransform: true,
      actionName: '阿喃那伤害均摊',
      respectDefenses: false,
    });
    actualTotal += actual;
  });
  return { handled: true, actualDamage: actualTotal };
}

export function consumePuruisaishiShield(runtime: PuruisaishiRuntime, target: Fighter, amount: number): { remaining: number; absorbed: number; retreated: boolean } {
  if (!target.isPuruisaishi || (target.puruisaishiShield ?? 0) <= 0 || amount <= 0) {
    return { remaining: amount, absorbed: 0, retreated: false };
  }

  const before = target.puruisaishiShield ?? 0;
  const crystalsExist = activeCrystals(runtime).length > 0;
  const floor = crystalsExist ? 1 : 0;
  const after = Math.max(floor, before - amount);
  const absorbed = before - after;
  target.puruisaishiShield = after;
  runtime.log('info', `🛡️ 【普瑞赛斯护盾】${target.name} 的护盾吸收 ${absorbed} 点伤害，剩余 ${after}。`);

  if (after <= 0 && !crystalsExist) {
    clearAllOriginiumAndRetreat(runtime, target);
    return { remaining: 0, absorbed, retreated: true };
  }

  return { remaining: crystalsExist ? 0 : Math.max(0, amount - absorbed), absorbed, retreated: false };
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
  runtime.log('transform', `🜲 【普瑞赛斯退场】${puruisaishi.name} 的护盾归零，清除全场矿石病层数后离开战场。`);
}

export function isOriginiumNpc(fighter: Fighter): boolean {
  return !!(fighter.isPuruisaishi || fighter.isOriginiumCore || fighter.isOriginiumCrystal);
}

export function isActiveNonNpcCombatant(fighter: Fighter): boolean {
  return isActiveCombatant(fighter) && !fighter.isNpc;
}
