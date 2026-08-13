import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import type { BattleEngine } from '../../../lib/namearena/battleEngine';
import type {
  BattleEvent,
  BattleState,
  BattleEngineCore,
  BattleEngineData,
  Fighter,
  JobDefinition,
  SkillDefinition,
  SpinalSwordRef,
  StatKey,
  StatusApplication,
  StatusInstance,
} from '../../../lib/namearena/types';
import { createBattleState, withBattleRandom } from '../../../lib/namearena/battleState';
import { generateUniqueRuntimeId } from '../../../lib/namearena/core';
import {
  grantPuruisaishiBarrier,
  spawnPuruisaishiEvent,
} from '../../../lib/namearena/puruisaishiMechanics';
import { spawnHerobrineEvent } from '../../../lib/namearena/herobrineMechanics';
import {
  isHerobrine,
  isHerobrineClone,
  setNpcCombatCapabilities,
} from '../../../lib/namearena/npcCombat';
import { getBarrierIdentityDefinition, getStatusIdentityDefinition, getStatusMechanicDefinition } from '../../../lib/namearena/statusRegistry';
import { applyStatus, initializeEffectState, removeEffects } from '../../../lib/namearena/statusSystem';
import {
  enterSurtrAfterglow,
  initializeSurtrState,
  SURTR_BASE_STATS,
  SURTR_TWILIGHT_MAX_HP_GAIN,
  syncSurtrAffiliation,
} from '../../../lib/namearena/surtrMechanics';
import {
  enterYuzuProphetPhaseTwo,
  getYuzuProphetBoundYuzu,
  trySpawnYuzuProphet,
} from '../../../lib/namearena/yuzuProphetMechanics';
import { installTypeScriptHook, projectRoot } from './register';

installTypeScriptHook(projectRoot);

const moduleRequire = createRequire(__filename);

type SeededRng = {
  next: () => number;
};

type BattleEngineCoreWithRng = BattleEngineCore & {
  SeededRNG: new (seed: number) => SeededRng;
};

type CoreModule = Partial<BattleEngineCoreWithRng> & {
  namerenaCore?: BattleEngineCoreWithRng;
};

type CombatStateModule = {
  cloneFighters: (fighters: Fighter[]) => Fighter[];
  setCurrentHp: (fighter: Fighter, hp: number) => void;
};

type BattleEngineModule = {
  BattleEngine: typeof BattleEngine;
};

type JobsModule = {
  namerenaJobs: Partial<Record<string, JobDefinition>>;
};

type SkillsModule = {
  namerenaSkills: Record<string, SkillDefinition>;
};

type DataModule = {
  namerenaData: BattleEngineData & Record<string, unknown>;
};

type FighterFactoryModule = {
  generateNameArenaFighter: (name: string) => Fighter | null;
};

export type LogEntry = {
  id?: string;
  sequence?: number;
  type: string;
  text: string;
  rootEventId?: string;
  actionId?: string;
  actorId?: string;
  actorName?: string;
  targetIds?: string[];
  skillId?: string | null;
  skillName?: string;
  turn?: number;
  displayInFeed?: boolean;
  visualCue?: BattleEvent['visualCue'];
};

export type BattleSpec = {
  phase: string;
  label: string;
  names: string[];
  seed: number;
};

export type RunBattleOptions = {
  checkInvariants?: boolean;
  checkInvariantsEachStep?: boolean;
  includeInvariantLabel?: boolean;
  maxTurns?: number;
  scanLogs?: boolean;
  scanRosterNames?: boolean;
  forcePuruisaishi?: boolean;
  forceHerobrine?: boolean;
  forceYuzuProphet?: boolean;
  forceYuzuProphetPhaseTwo?: boolean;
  forceYuzuProphetUnboundPhaseTwo?: boolean;
  forceSurtr?: boolean;
  forceSurtrLifecycle?: 'normal' | 'twilight' | 'afterglow';
};

export type LogIssue = {
  label: string;
  line: number;
  type: string;
  text: string;
  name?: string;
};

export type FighterSnapshot = {
  name: string;
  hp: number;
  hpPct: number;
  dmgTaken: number;
  status: string;
};

export type BattleResult = BattleSpec & {
  turns: number;
  ended: boolean;
  timedOut: boolean;
  error: string | null;
  invariantErrors: string[];
  logIssues: LogIssue[];
  logCount: number;
  survivors: string[];
  logs: LogEntry[];
  events: BattleEvent[];
  fighterDirectory: FighterTraceDescriptor[];
};

export type BattleEngineInstance = InstanceType<typeof BattleEngine>;

export type FighterTraceDescriptor = {
  id: string;
  name: string;
  kind: string;
  teamId?: string;
  summonerId?: string;
  isNpc: boolean;
  isSummon: boolean;
  isSurtr: boolean;
  isYuzuProphet: boolean;
  isYuzu: boolean;
  prophetControlDisposition?: 'controlled' | 'returned' | 'erased' | 'withdrawn';
  surtrOwnerIds?: string[];
};

export type LoadedProject = {
  root: string;
  BattleEngine: typeof BattleEngine;
  jobs: Partial<Record<string, JobDefinition>>;
  skills: Record<string, SkillDefinition>;
  data: BattleEngineData & Record<string, unknown>;
  core: BattleEngineCoreWithRng;
  cloneFighters: (fighters: Fighter[]) => Fighter[];
  setCurrentHp: (fighter: Fighter, hp: number) => void;
  generateNameArenaFighter: (name: string) => Fighter | null;
};

const COMBAT_STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];
const STATUS_NUMERIC_FIELDS = ['potency', 'count', 'remainingTurns', 'charges', 'appliedSequence', 'lastAdvancedAt'] as const;
let statusFixtureSequence = 0;

export function purgeProjectCache(root: string): void {
  const prefix = `${path.resolve(root)}${path.sep}`;
  Object.keys(moduleRequire.cache).forEach((key) => {
    if (key.startsWith(prefix)) delete moduleRequire.cache[key];
  });
}

export function loadProject(root = projectRoot, options: { purge?: boolean } = {}): LoadedProject {
  const resolvedRoot = path.resolve(root);
  installTypeScriptHook(resolvedRoot);
  if (options.purge) purgeProjectCache(resolvedRoot);

  const rootRequire = createRequire(path.join(resolvedRoot, 'scripts/namearena/shared/harness.ts'));
  const coreModule = rootRequire(path.join(resolvedRoot, 'lib/namearena/core.ts')) as CoreModule;
  const combatState = rootRequire(path.join(resolvedRoot, 'lib/namearena/combatState.ts')) as CombatStateModule;
  const battleEngineModule = rootRequire(path.join(resolvedRoot, 'lib/namearena/battleEngine.ts')) as BattleEngineModule;
  const jobsModule = rootRequire(path.join(resolvedRoot, 'lib/namearena/jobs.ts')) as JobsModule;
  const skillsModule = rootRequire(path.join(resolvedRoot, 'lib/namearena/skills.ts')) as SkillsModule;
  const dataModule = rootRequire(path.join(resolvedRoot, 'lib/namearena/data.ts')) as DataModule;
  const fighterFactory = rootRequire(path.join(resolvedRoot, 'lib/namearena/fighterFactory.ts')) as FighterFactoryModule;

  return {
    root: resolvedRoot,
    BattleEngine: battleEngineModule.BattleEngine,
    jobs: jobsModule.namerenaJobs,
    skills: skillsModule.namerenaSkills,
    data: dataModule.namerenaData,
    core: coreModule.namerenaCore ?? (coreModule as BattleEngineCoreWithRng),
    cloneFighters: combatState.cloneFighters,
    setCurrentHp: combatState.setCurrentHp,
    generateNameArenaFighter: fighterFactory.generateNameArenaFighter,
  };
}

export const localProject = loadProject(projectRoot);
export const SPECIALS = ['水人', '玄凝', '小汀', '牢鳄', '克蕾儿丝菲尔', '丝瓜uli', '兔卷卷', '刺猬人', '屑', 'M1A2_abrams_sep', '表情', '柚子', '鸮', '萌月沫沫'];
export const NO_WATER = SPECIALS.filter((name) => name !== '水人');
export const DEFAULT_REGRESSION_MAX_TURNS = 1200;
export const DEFAULT_STRESS_MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);
export const DEFAULT_CHAOS_SEEDS = Number.parseInt(process.env.NAMEARENA_CHAOS_SEEDS ?? '300', 10);

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function withProjectSeed<T>(project: LoadedProject, seed: number, fn: () => T): T {
  const rng = new project.core.SeededRNG(seed);
  const originalRandom = Math.random;
  Math.random = () => rng.next();
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

export function withSeed<T>(seed: number, fn: () => T): T {
  return withProjectSeed(localProject, seed, fn);
}

export function withRandomSequence<T>(values: number[], fn: () => T): T {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)] ?? values[values.length - 1] ?? 0;
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

export function makeProjectFighter(project: LoadedProject, name: string): Fighter {
  const fighter = project.generateNameArenaFighter(name);
  assert(fighter, `failed to generate fighter: ${name}`);
  return fighter;
}

export function makeFighter(name: string): Fighter {
  return makeProjectFighter(localProject, name);
}

export function makeStatusFixtures(application: StatusApplication): StatusInstance[] {
  statusFixtureSequence += 1;
  const holder = {
    id: `status-fixture-${statusFixtureSequence}`,
    name: '状态测试夹具',
    statuses: [],
    barriers: [],
    statusSequence: 0,
    barrierSequence: 0,
    isNpc: true,
  } as unknown as Fighter;
  return applyStatus(holder, application).statuses.map((status) => ({
    ...status,
    attribution: { ...status.attribution },
    damageSourceMask: status.damageSourceMask ? [...status.damageSourceMask] : undefined,
    statScope: status.statScope ? [...status.statScope] : undefined,
  }));
}

export function applyTestStatus(fighter: Fighter, application: StatusApplication): StatusInstance[] {
  return applyStatus(fighter, application).statuses;
}

export function applySingleTestStatus(fighter: Fighter, application: StatusApplication): StatusInstance {
  return applyStatus(fighter, application).primary;
}

export function replaceTestStatuses(
  fighter: Fighter,
  applications: readonly StatusApplication[],
): StatusInstance[] {
  removeEffects(fighter, { reason: 'scripted' });
  return applications.flatMap((application) => applyStatus(fighter, application).statuses);
}

export function makeProjectEngine(
  project: LoadedProject,
  fighters: Fighter[],
  logs: LogEntry[],
  turnCount = 0,
  battleState?: BattleState,
  events?: BattleEvent[],
): BattleEngineInstance {
  return new project.BattleEngine(
    fighters,
    (entry: LogEntry) => logs.push(entry),
    project.jobs,
    project.skills,
    project.data,
    project.core,
    turnCount,
    battleState,
    events ? (event) => events.push(event) : undefined,
  );
}

export function makeEngine(fighters: Fighter[], logs: LogEntry[], turnCount = 0): BattleEngineInstance {
  return makeProjectEngine(localProject, fighters, logs, turnCount);
}

function forcedSurtrName(fighters: readonly Fighter[]): string {
  const existing = fighters.filter((fighter) =>
    fighter.isSummon && (fighter.summonBaseName ?? fighter.name).replace(/#\d+$/, '') === '史尔特尔',
  ).length;
  return existing === 0 ? '史尔特尔' : `史尔特尔#${existing + 1}`;
}

export function injectForcedSurtr(
  project: LoadedProject,
  engine: BattleEngineInstance,
  lifecycle: NonNullable<RunBattleOptions['forceSurtrLifecycle']> = 'normal',
): Fighter {
  const primaryOwner = engine.fighters.find((fighter) => fighter.isGacha && engine.isActiveCombatant(fighter));
  const owlOwner = engine.fighters.find((fighter) => fighter.isOwl && engine.isActiveCombatant(fighter));
  assert(primaryOwner, 'Forced Surtr fixture requires 牢鳄');
  assert(owlOwner, 'Forced Surtr fixture requires 鸮');
  const job = project.jobs.ARKNIGHTS_OP ?? project.jobs.WARRIOR;
  assert(job, 'Forced Surtr fixture requires ARKNIGHTS_OP or WARRIOR job');
  const primaryTeamId = engine.getTeamId(primaryOwner);
  const owlTeamId = engine.getTeamId(owlOwner);
  const summon = makeProjectFighter(project, `史尔特尔测试体@${primaryTeamId}`);
  summon.id = generateUniqueRuntimeId(
    engine.fighters.map((fighter) => fighter.id),
    () => project.core.generateUUID?.() ?? `forced-surtr-${Math.random().toString(36).slice(2)}`,
    'forced-surtr',
  );
  const name = forcedSurtrName(engine.fighters);
  summon.name = name;
  summon.displayName = name;
  summon.job = 'ARKNIGHTS_OP';
  summon.jobData = { ...job, skills: [...job.skills] };
  summon.maxHp = SURTR_BASE_STATS.hp;
  summon.currentHp = SURTR_BASE_STATS.hp;
  summon.hpPct = 1;
  summon.atk = SURTR_BASE_STATS.atk;
  summon.def = SURTR_BASE_STATS.def;
  summon.spd = SURTR_BASE_STATS.spd;
  summon.agl = SURTR_BASE_STATS.agl;
  summon.mag = SURTR_BASE_STATS.mag;
  summon.res = SURTR_BASE_STATS.res;
  summon.wis = SURTR_BASE_STATS.wis;
  summon.critRate = 0.1;
  summon.color = primaryOwner.color;
  summon.isDead = false;
  summon.isDeadAnnounced = false;
  summon.statuses = [];
  summon.barriers = [];
  summon.stats = { kills: 0, dmgDealt: 0, dmgTaken: 0 };
  summon.summonerId = primaryOwner.id;
  summon.summonBaseName = '史尔特尔';
  summon.teamId = primaryTeamId;
  summon.isSummon = true;
  summon.isAdvancedSummon = true;
  summon.isSurtr = true;
  summon.surtrState = initializeSurtrState(
    primaryOwner,
    primaryTeamId,
    owlOwner,
    owlTeamId,
  );
  initializeEffectState(summon);
  engine.fighters.push(summon);
  engine.log(
    'crit',
    `🔥 【共同主人确立】${summon.name} 同时认 ${primaryOwner.name} 与 ${owlOwner.name} 为主人（测试场景强制建立完整共同主人关系）。黄昏的尽头，莱万汀将烧尽一切。`,
    {
      actorId: summon.id,
      actorName: summon.name,
      targetIds: [primaryOwner.id, owlOwner.id],
    },
  );
  syncSurtrAffiliation({
    fighters: engine.fighters,
    getTeamId: (fighter) => engine.getTeamId(fighter),
    isActiveCombatant: (fighter) => engine.isActiveCombatant(fighter),
    log: (type, text, metadata) => engine.log(type, text, metadata),
  }, summon, { announceInitial: true, resetBaseline: true });
  if (lifecycle === 'twilight') {
    summon.surtrState.twilightUsed = true;
    summon.surtrState.twilightActivatedTurn = engine.turnCount;
    summon.maxHp += SURTR_TWILIGHT_MAX_HP_GAIN;
    summon.currentHp = summon.maxHp;
    engine.syncHpPct(summon);
    engine.log(
      'crit',
      `🌇 【黄昏】${summon.name}：“莱万汀！”测试场景从黄昏已发动后的权威状态开始；最大生命 +${SURTR_TWILIGHT_MAX_HP_GAIN}，本局唯一一次黄昏已经消耗，并锁定 0 名目标。`,
      { actorId: summon.id, actorName: summon.name, targetIds: [] },
    );
    engine.log(
      'debuff',
      `🌇 【黄昏流失启动】${summon.name} 将从下一次自身行动机会结束时流失 1% 最大生命，之后逐次递增，最高 20%。`,
      { actorId: summon.id, actorName: summon.name, targetIds: [summon.id] },
    );
  } else if (lifecycle === 'afterglow') {
    enterSurtrAfterglow({
      turnCount: engine.turnCount,
      syncHpPct: (fighter) => engine.syncHpPct(fighter),
      log: (type, text, metadata) => engine.log(type, text, metadata),
    }, summon);
  }
  return summon;
}

function fighterTraceKind(fighter: Fighter): string {
  if (fighter.isYuzuProphet) return 'npc:yuzu_prophet';
  if (fighter.isPuruisaishi) return 'npc:puruisaishi';
  if (isHerobrine(fighter)) return 'npc:herobrine';
  if (isHerobrineClone(fighter)) return 'npc:herobrine_clone';
  if (fighter.isOriginiumCore) return 'npc:originium_core';
  if (fighter.isOriginiumCrystal) return 'npc:originium_crystal';
  if (fighter.isSurtr) return 'summon:surtr';
  if (fighter.owlSummonState) return `summon:owl:${fighter.owlSummonState.kind}`;
  if (fighter.isSummon) return `summon:${(fighter.summonBaseName ?? fighter.name).replace(/#\d+$/, '')}`;
  if (fighter.isNpc) return `npc:${fighter.name.replace(/#\d+$/, '')}`;
  return `player:${fighter.name.replace(/#\d+$/, '')}`;
}

function fighterDirectory(fighters: readonly Fighter[]): FighterTraceDescriptor[] {
  return fighters.map((fighter) => ({
    id: fighter.id,
    name: fighter.name,
    kind: fighterTraceKind(fighter),
    teamId: fighter.teamId,
    summonerId: fighter.summonerId,
    isNpc: !!fighter.isNpc,
    isSummon: !!fighter.isSummon,
    isSurtr: !!fighter.isSurtr,
    isYuzuProphet: !!fighter.isYuzuProphet,
    isYuzu: !!fighter.isYuzu,
    prophetControlDisposition: fighter.yuzuProphetControlState?.disposition,
    surtrOwnerIds: fighter.surtrState
      ? [fighter.surtrState.primaryOwnerId, fighter.surtrState.owlOwnerId]
        .filter((id): id is string => !!id)
      : undefined,
  }));
}

export function snapshot(fighters: Fighter[]): FighterSnapshot[] {
  return fighters.map((fighter) => ({
    name: fighter.name,
    hp: fighter.currentHp,
    hpPct: fighter.hpPct,
    dmgTaken: fighter.stats.dmgTaken,
    status: fighter.statuses.map((status) => [
      status.identityId,
      status.mechanicId,
      status.potency ?? '-',
      status.count ?? '-',
      status.remainingTurns ?? '-',
      status.charges ?? '-',
      status.attribution.effectSourceId,
    ].join(':')).sort().join(','),
  }));
}

export function assertUnchanged(before: FighterSnapshot[], fighters: Fighter[], names: string[], options: { checkStatus?: boolean } = {}): void {
  const checkStatus = options.checkStatus ?? true;
  names.forEach((name) => {
    const prev = before.find((item) => item.name === name);
    const next = fighters.find((item) => item.name === name);
    assert(prev && next, `${name} disappeared`);
    assert(next.currentHp === prev.hp, `${name} HP changed: ${prev.hp} -> ${next.currentHp}`);
    assert(next.hpPct === prev.hpPct, `${name} hpPct changed: ${prev.hpPct} -> ${next.hpPct}`);
    assert(next.stats.dmgTaken === prev.dmgTaken, `${name} dmgTaken changed: ${prev.dmgTaken} -> ${next.stats.dmgTaken}`);
    if (checkStatus) {
      assert(snapshot([next])[0]?.status === prev.status, `${name} status changed unexpectedly`);
    }
  });
}

export function applySlacking(fighter: Fighter): Fighter {
  removeEffects(fighter, { reason: 'scripted' });
  ['SYNERGY_SLACKING', 'INVUL', 'BKB', 'STUN'].forEach((identityId) => {
    applyStatus(fighter, {
      identityId,
      remainingTurns: 5,
      attribution: {
        effectSourceId: 'SYNERGY_SLACKING',
        effectSourceName: '摸鱼伙伴羁绊',
      },
    });
  });
  fighter.wasSynergySlacking = true;
  return fighter;
}

export function checkInvariants(fighters: Fighter[], label: string, options: { includeLabel?: boolean } = {}): string[] {
  const errors: string[] = [];
  const suffix = options.includeLabel ? ` in ${label}` : '';
  const fighterIds = new Set<string>();
  fighters.forEach((fighter) => {
    if (fighterIds.has(fighter.id)) errors.push(`duplicate fighter id ${fighter.id} (${fighter.name})${suffix}`);
    fighterIds.add(fighter.id);
    const hpPct = fighter.isSurtr && fighter.surtrState?.afterglowActive
      ? 0
      : fighter.maxHp > 0
        ? Math.max(0, fighter.currentHp) / fighter.maxHp
        : 0;
    const hpPctDelta = Math.abs((fighter.hpPct ?? 0) - hpPct);
    if (!Number.isFinite(fighter.currentHp) || !Number.isFinite(fighter.maxHp) || !Number.isFinite(fighter.hpPct)) errors.push(`${fighter.name} has non-finite HP${suffix}`);
    if (COMBAT_STAT_KEYS.some((key) => !Number.isFinite(fighter[key]))) errors.push(`${fighter.name} has non-finite stat${suffix}`);
    if (fighter.currentHp > fighter.maxHp) errors.push(`${fighter.name} currentHp ${fighter.currentHp} > maxHp ${fighter.maxHp}${suffix}`);
    if (fighter.currentHp < 0) errors.push(`${fighter.name} currentHp negative: ${fighter.currentHp}${suffix}`);
    if (hpPctDelta > 0.0001) errors.push(`${fighter.name} hpPct mismatch in ${label}: ${fighter.hpPct} vs ${hpPct}`);
    if (fighter.isDead && fighter.currentHp > 0) errors.push(`${fighter.name} is dead but currentHp is ${fighter.currentHp}${suffix}`);
    if (!fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp <= 0) errors.push(`${fighter.name} is active but currentHp is ${fighter.currentHp}${suffix}`);
    fighter.statuses.forEach((status) => {
      try {
        getStatusIdentityDefinition(status.identityId);
        getStatusMechanicDefinition(status.mechanicId);
      } catch (error) {
        errors.push(`${fighter.name} has unregistered status ${status.identityId}/${status.mechanicId}${suffix}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!status.instanceId || !status.identityId || !status.mechanicId || !status.attribution?.effectSourceId) {
        errors.push(`${fighter.name} has incomplete status instance${suffix}`);
      }
      if (STATUS_NUMERIC_FIELDS.some((field) => status[field] !== undefined && !Number.isFinite(status[field]))) {
        errors.push(`${fighter.name} has non-finite status value${suffix}`);
      }
    });
    (fighter.barriers ?? []).forEach((barrier) => {
      try {
        getBarrierIdentityDefinition(barrier.identityId);
      } catch (error) {
        errors.push(`${fighter.name} has unregistered barrier ${barrier.identityId}${suffix}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!barrier.id || !barrier.sourceId || !barrier.attribution?.effectSourceId) {
        errors.push(`${fighter.name} has incomplete barrier instance${suffix}`);
      }
      if (!Number.isFinite(barrier.value) || !Number.isFinite(barrier.maxValue)) {
        errors.push(`${fighter.name} has non-finite barrier value${suffix}`);
      }
    });
    if ((fighter.pendingDamageEvents?.length ?? 0) > 0) errors.push(`${fighter.name} retained ${fighter.pendingDamageEvents?.length ?? 0} deferred damage event(s)${suffix}`);
  });
  return errors;
}

export function parseSlackingPair(text: string): [string, string] | null {
  const match = text.match(/战斗进行到一半，(.+?) 和 (.+?) 突然对视/);
  return match ? [match[1], match[2]] : null;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactNamePattern(text: string): string {
  return `${escapeRegExp(text)}(?=[，,。！!、\\s]|$)`;
}

export function sanitizeFileName(text: string): string {
  return text.replace(/[^\w.-]+/g, '_').slice(0, 180);
}

export function scanLogs(logs: LogEntry[], label: string, rosterNames: string[] = []): LogIssue[] {
  const issues: LogIssue[] = [];
  const activeSlacking = new Set<string>();
  const names = [...new Set([
    ...rosterNames,
    ...SPECIALS,
    '小汀(傀儡)',
    '史瓦罗',
    '克拉拉',
    '钟离',
    'Saber',
    '萨姆',
    '巴哈姆特',
    '伊莫库',
    '史尔特尔',
    '青眼究极龙',
    '青眼白龙',
    '黑暗大法师',
    '翼神龙',
  ])];
  const orderedNames = [...names].sort((a, b) => b.length - a.length);
  const mentionedName = (value: string): string | undefined => orderedNames.find((name) => value.includes(name));
  const leadingMentionedName = (value: string): string | undefined => {
    const withoutIcon = value.replace(/^\S+\s+/, '');
    return orderedNames.find((name) => withoutIcon.startsWith(name));
  };
  const titledSubjectName = (value: string): string | undefined => {
    const titleEnd = value.indexOf('】');
    if (titleEnd < 0) return undefined;
    const afterTitle = value.slice(titleEnd + 1).trimStart();
    return orderedNames.find((name) => new RegExp(`^${exactNamePattern(name)}`).test(afterTitle));
  };
  const parseDeathVictim = (value: string): string | undefined => {
    const match = value.match(/^(?:💀|☠️) (?:【[^】]+】)?(.+?) (?:被|因|承受不住|遭到|跌入|化为|化为了)/);
    if (!match?.[1]) return undefined;
    const rawName = (match[1].split(/[！!。]/).pop() ?? match[1]).trim();
    const listedNames = rawName.split(/[、，,]/).map((name) => name.trim()).filter(Boolean);
    if (listedNames.length > 1) return undefined;
    if (/#\d+$/.test(rawName)) return rawName;
    return orderedNames.find((name) => rawName === name) ?? orderedNames.find((name) => rawName.includes(name));
  };
  const patterns: Array<[string, RegExp]> = [
    ['newline-in-log-text', /\r|\n/],
    ['nan-or-undefined', /\b(?:NaN|undefined|null)\b/],
    ['negative-number-log', /(?:造成|承受|恢复|损失)了? -\d/],
      ['zero-heal-log', /恢复了? 0 点生命/],
      ['zero-reduction-log', /削减 0 点伤害/],
      ['zero-deflection-log', /偏折 0 点/],
    ['zero-shield-absorb-log', /护盾吸收 0 点伤害/],
    ['zero-damage-control', /(?:承受了|造成了|实际造成) 0 点.*(?:并被|并深度|并使其|并施加|眩晕|魅惑|击飞|中毒|灼烧|沉默|混乱)/],
    ['duplicate-damage-type', /物理\(物理\)|魔法\(魔法\)/],
    ['legacy-generic-death', /伤重不治倒下了/],
    ['death-without-cause', /生命归零，倒在了战场上/],
    ['legacy-ting-double-death-text', /倒下了，但他拔出了/],
    ['joker-redundant-zero-settlement', /📌 实际结算：屑 实际承受 0 点伤害/],
    ['legacy-joker-no-victim-dodge', /【随机恶作剧】屑 .*躲开了 \d+ 点伤害/],
    ['originium-ammo-rack-language', /(?:源石结晶|阿喃那|普瑞赛斯).*(?:弹药架|弹药区|弹药库|炮塔)|(?:弹药架|弹药区|弹药库|炮塔).*(?:源石结晶|阿喃那|普瑞赛斯)/],
    ['internal-status-id-leak', /【(?:YUZU|WT|MOMO|OWL|TING|GACHA|VALO|TOKUSATSU|EMOTE|GAMER|CHIMERA|ORIGINIUM|CTR|STYLE|PLUG|SPELL|WATER)_[A-Z0-9_]+】/],
  ];
  let expectWaterSonInterceptLine = 0;
  const pendingCounterOutcomes: Array<{ counterName: string; line: number; text: string; deadline: number }> = [];
  const pendingInterceptions: Array<{ targetName: string; line: number; text: string; deadline: number; settlePattern: RegExp }> = [];
  const pendingGachaPityOutcomes: Array<{ line: number; text: string; deadline: number }> = [];
  const pendingPostDamageAftermath: Array<{
    line: number;
    text: string;
    deadline: number;
    subjectName?: string;
    targetIds?: string[];
    rootEventId?: string;
    actionId?: string;
    turn?: number;
  }> = [];
  const pendingBlockedHealing: Array<{
    name: string;
    line: number;
    text: string;
    deadline: number;
    rootEventId?: string;
    actionId?: string;
  }> = [];
  const recentDeaths: Array<{
    name: string;
    line: number;
    text: string;
    deadline: number;
    targetPattern: RegExp;
    rootEventId?: string;
    actionTitle?: string;
  }> = [];
  const summonedBaseNames = new Set<string>();
  const repeatedTargetNamesByRoot = new Map<string, Set<string>>();

  logs.forEach((entry, index) => {
      const line = index + 1;
      const text = entry.text;
      const sameCausalWindow = (pending: {
        rootEventId?: string;
        actionId?: string;
        turn?: number;
      }): boolean => {
        if (pending.turn !== undefined && entry.turn !== undefined && pending.turn !== entry.turn) return false;
        if (pending.rootEventId && entry.rootEventId && pending.rootEventId !== entry.rootEventId) return false;
        if (pending.actionId && entry.actionId && pending.actionId !== entry.actionId) return false;
        return true;
      };
      const sharesTarget = (pending: {
        subjectName?: string;
        targetIds?: string[];
      }, subjectName?: string): boolean => {
        if (
          pending.targetIds?.length &&
          entry.targetIds?.length &&
          pending.targetIds.some((targetId) => entry.targetIds?.includes(targetId))
        ) {
          return true;
        }
        return !!pending.subjectName && !!subjectName && pending.subjectName === subjectName;
      };
      const settlementSubject = text.match(/^📌 实际结算：(.+?) (?:实际承受|完全抵消|没有承受|未承受)/)?.[1];
      for (let i = pendingPostDamageAftermath.length - 1; i >= 0; i -= 1) {
        const pending = pendingPostDamageAftermath[i];
        if (!pending) continue;
        if (line > pending.deadline || !sameCausalWindow(pending)) {
          pendingPostDamageAftermath.splice(i, 1);
          continue;
        }
        if (text.startsWith('state-sync:') && sharesTarget(pending)) {
          pendingPostDamageAftermath.splice(i, 1);
          continue;
        }
        if (settlementSubject && sharesTarget(pending, settlementSubject)) {
          issues.push({
            label,
            line: pending.line,
            type: 'aftermath-before-damage-result',
            text: `${pending.text}\nLATER: ${text}`,
            name: pending.subjectName,
          });
          pendingPostDamageAftermath.splice(i, 1);
        }
      }
      if (
        /结算前预估/.test(text) &&
        entry.targetIds?.length
      ) {
        for (let i = pendingPostDamageAftermath.length - 1; i >= 0; i -= 1) {
          const pending = pendingPostDamageAftermath[i];
          if (pending && sameCausalWindow(pending) && sharesTarget(pending)) {
            pendingPostDamageAftermath.splice(i, 1);
          }
        }
      }
      const firstEventTitle = text.match(/【([^】]+)】/)?.[1];
      if (
        ['悲愿不倒', 'CONTINUE?', '提前落地', '炮震坠落', '击飞坠地'].includes(firstEventTitle ?? '') ||
        (firstEventTitle === '欧皇护符' && /致死瞬间|锁住了/.test(text))
      ) {
        pendingPostDamageAftermath.push({
          line,
          text,
          deadline: line + 12,
          subjectName: titledSubjectName(text) ?? leadingMentionedName(text),
          targetIds: entry.targetIds ? [...entry.targetIds] : undefined,
          rootEventId: entry.rootEventId,
          actionId: entry.actionId,
          turn: entry.turn,
        });
      }
      for (let i = pendingBlockedHealing.length - 1; i >= 0; i -= 1) {
        const pending = pendingBlockedHealing[i];
        if (!pending) continue;
        const sameCausalWindow = pending.actionId && entry.actionId
          ? pending.actionId === entry.actionId
          : !pending.rootEventId || !entry.rootEventId || pending.rootEventId === entry.rootEventId;
        const namedFullHealth = new RegExp(
          `${escapeRegExp(pending.name)}(?: 的[^，。！？!]{0,24})? 生命(?:已|已经)(?:全)?满`,
        ).test(text);
        if (sameCausalWindow && namedFullHealth) {
          issues.push({
            label,
            line,
            type: 'blocked-healing-described-as-full-health',
            text: `${pending.text}\nNEXT: ${text}`,
            name: pending.name,
          });
          pendingBlockedHealing.splice(i, 1);
        } else if (line > pending.deadline) {
          pendingBlockedHealing.splice(i, 1);
        }
      }
      const blockedHealingTarget = text.match(/【枯竭】(.+?) 的治疗被完全阻止/)?.[1];
      if (blockedHealingTarget) {
        pendingBlockedHealing.push({
          name: blockedHealingTarget,
          line,
          text,
          deadline: line + 3,
          rootEventId: entry.rootEventId,
          actionId: entry.actionId,
        });
      }
      const listedTargets = text.match(/\d+ 名敌人：(.+?)(?:！|!|。|$)/)?.[1]
        ?.split(/、|，|,/)
        .map((name) => name.trim())
        .filter(Boolean);
      if (entry.rootEventId && listedTargets) {
        const counts = new Map<string, number>();
        listedTargets.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
        const repeated = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
        if (repeated.size > 0) repeatedTargetNamesByRoot.set(entry.rootEventId, repeated);
      }
      if (
        text.includes('触发了锁血保护') &&
        logs.slice(Math.max(0, index - 3), index).some((previous) => previous.text === text)
      ) {
        issues.push({ label, line, type: 'duplicate-phase-lock-log', text });
      }
    for (let i = recentDeaths.length - 1; i >= 0; i -= 1) {
      const recentDeath = recentDeaths[i];
      if (!recentDeath) continue;
      if (text.includes(recentDeath.name) && /复活|死者苏生|拉回战场|从地狱归来|从水里捞起|并没有死|浴火重生|被水人救起|备用载具|重新部署/.test(text)) {
        recentDeaths.splice(i, 1);
      } else if (
        line <= recentDeath.deadline &&
        recentDeath.targetPattern.test(text)
      ) {
        const repeatedInSameAction = !!(
          entry.rootEventId &&
          entry.rootEventId === recentDeath.rootEventId &&
          repeatedTargetNamesByRoot.get(entry.rootEventId)?.has(recentDeath.name)
        );
        const numberedFollowUpInSameAction = !!(
          entry.rootEventId &&
          entry.rootEventId === recentDeath.rootEventId &&
          recentDeath.actionTitle &&
          text.includes(`【${recentDeath.actionTitle}】`) &&
          /第 \d+\/\d+ 击/.test(text)
        );
        if (!repeatedInSameAction && !numberedFollowUpInSameAction) {
          issues.push({ label, line, type: 'dead-fighter-mentioned-as-target', text: `${recentDeath.text}\nNEXT: ${text}`, name: recentDeath.name });
        }
        recentDeaths.splice(i, 1);
      } else if (line > recentDeath.deadline) {
        recentDeaths.splice(i, 1);
      }
    }
    for (let i = pendingInterceptions.length - 1; i >= 0; i -= 1) {
      const pending = pendingInterceptions[i];
      if (!pending) continue;
      if (pending.settlePattern.test(text)) {
        pendingInterceptions.splice(i, 1);
      } else if (line > pending.deadline) {
        issues.push({ label, line: pending.line, type: 'intercept-without-actual-damage', text: pending.text });
        pendingInterceptions.splice(i, 1);
      }
    }
    for (let i = pendingGachaPityOutcomes.length - 1; i >= 0; i -= 1) {
      const pending = pendingGachaPityOutcomes[i];
      if (!pending) continue;
      if (/【(?:氪金改命|十连金光|天井兑换|小保底歪了但没完全歪|封印组件|灰流丽|圣防护罩·镜之力|黑莲花|召唤指令|全军进击|献祭准备|召唤物回收|死者苏生|毁灭爆裂疾风弹|真之光|古之咒文|太阳神火焰加农|神不死鸟|献祭升格)】|抽到吸血牌|抽到了吸血牌|【召唤成功】|【单抽】|【命运抽卡】|未结算，欧气已返还/.test(text)) {
        pendingGachaPityOutcomes.splice(i, 1);
      } else if (line > pending.deadline) {
        issues.push({ label, line: pending.line, type: 'gacha-pity-without-outcome', text: pending.text });
        pendingGachaPityOutcomes.splice(i, 1);
      }
    }
    for (let i = pendingCounterOutcomes.length - 1; i >= 0; i -= 1) {
      const pending = pendingCounterOutcomes[i];
      if (!pending) continue;
      const resolved = text.includes(`【${pending.counterName}】`) && !/触发了【[^】]+反击】/.test(text);
      if (resolved) {
        pendingCounterOutcomes.splice(i, 1);
      } else if (line > pending.deadline) {
        issues.push({ label, line: pending.line, type: 'counter-trigger-without-outcome', text: pending.text });
        pendingCounterOutcomes.splice(i, 1);
      }
    }

    patterns.forEach(([type, regex]) => {
      if (regex.test(text)) issues.push({ label, line, type, text });
    });

    const counterTrigger = text.match(/触发了【([^】]+反击)】！/);
    if (counterTrigger?.[1]) {
      pendingCounterOutcomes.push({
        counterName: counterTrigger[1],
        line,
        text,
        deadline: line + 3,
      });
    }

    if (/^🎭 【随机恶作剧】/.test(text)) {
      if (!/遭到.+【[^】]+】/.test(text)) {
        issues.push({ label, line, type: 'joker-transfer-without-source', text });
      }
      if (/遭到(?:状态伤害|持续伤害|深渊水牢窒息)/.test(text)) {
        issues.push({ label, line, type: 'joker-transfer-from-status-damage', text });
      }
    }

    if (/(?:大保底启动|小保底启动)/.test(text)) {
      pendingGachaPityOutcomes.push({
        line,
        text,
        deadline: line + 6,
      });
    }

    if (entry.type === 'death' && !/脊髓剑遗留/.test(text)) {
      const deathName = parseDeathVictim(text);
      if (deathName) {
        recentDeaths.push({
          name: deathName,
          line,
          text,
          deadline: line + 4,
          rootEventId: entry.rootEventId,
          actionTitle: text.match(/【([^】]+)】/)?.[1],
          targetPattern: new RegExp(`(?:对 ${exactNamePattern(deathName)}|命中 ${exactNamePattern(deathName)}|攻击了 ${exactNamePattern(deathName)}|${exactNamePattern(deathName)} (?:承受|实际承受|受到持续伤害|在深渊水牢中窒息|没有承受实际伤害|被附加|陷入|获得【))`),
        });
      }
    }

    const interceptStart = text.match(/🛡️ (?:【(?:换位援护|援护)】)?(.+?) (?:化作一滩清水|冲了出来)，.*准备承受 \d+ 点伤害/);
    if (interceptStart?.[1]) {
      pendingInterceptions.push({
        targetName: interceptStart[1],
        line,
        text,
        deadline: line + 3,
        settlePattern: new RegExp(`${escapeRegExp(interceptStart[1])}.*(?:实际承受|没有造成实际伤害)`),
      });
    }

    const nextText = logs[index + 1]?.text ?? '';
    const abyssDeathVictim = text.match(/【溺毙处决】(.+?) 在深渊水牢/)?.[1];
    if (abyssDeathVictim && nextText.includes(`【深渊水牢】`) && nextText.includes(`${abyssDeathVictim} `)) {
      issues.push({ label, line, type: 'death-before-abyssal-prison-source', text: `${text}\nNEXT: ${nextText}` });
    }
    const currentDamageTarget = text.match(/(?:命中|吞噬了|重创了|波及|溅射到了|对) (.+?)[，,]/)?.[1];
    const blockedTarget = nextText.match(/光幕为 (.+?) 挡下/)?.[1];
    if (currentDamageTarget && blockedTarget && currentDamageTarget === blockedTarget && /实际造成 \d+/.test(text) && /挡下了.+【[^】]+】/.test(nextText)) {
      issues.push({ label, line, type: 'block-after-damage-result', text: `${text}\nNEXT: ${nextText}` });
    }
    if (/削减 \d+ 点伤害/.test(text)) {
      const mitigationTarget = titledSubjectName(text) ?? leadingMentionedName(text) ?? mentionedName(text);
      if (mitigationTarget) {
        const targetPattern = exactNamePattern(mitigationTarget);
        const sameCausalWindow = (candidate: LogEntry): boolean => {
          if (entry.turn !== undefined && candidate.turn !== undefined && entry.turn !== candidate.turn) return false;
          if (entry.rootEventId && candidate.rootEventId && entry.rootEventId !== candidate.rootEventId) return false;
          if (entry.actionId && candidate.actionId && entry.actionId !== candidate.actionId) return false;
          return true;
        };
        const targetsMitigationFighter = (value: string): boolean => new RegExp(
          `(?:${targetPattern}[^\n]{0,120}(?:(?:实际)?(?:造成|承受|损失)(?:了)? \\d+|没有承受实际伤害|未受到生命伤害|(?:本体)?生命(?:实际)?未减少)|(?:命中|冲向|击中|波及|吞噬了|对) ${targetPattern}[^\n]{0,120}实际造成 \\d+)`,
        ).test(value);
        let hasFollowingSettlement = false;
        for (let laterIndex = index + 1; laterIndex < Math.min(logs.length, index + 25); laterIndex += 1) {
          const later = logs[laterIndex];
          if (!later || !sameCausalWindow(later)) break;
          if (later.type === 'system' && later.text.startsWith('state-sync:')) break;
          if (targetsMitigationFighter(later.text)) {
            hasFollowingSettlement = true;
            break;
          }
        }
        if (!hasFollowingSettlement) {
          for (let previousIndex = index - 1; previousIndex >= Math.max(0, index - 3); previousIndex -= 1) {
            const previous = logs[previousIndex];
            if (!previous) continue;
            if (!sameCausalWindow(previous)) break;
            if (
              /转移伤害已单独结算|【(?:\|OMO|镜界分摊)结算】|【状态(?:施加|叠加|结束|变化)】|安装了.+插件/.test(previous.text)
            ) break;
            if (
              targetsMitigationFighter(previous.text) &&
              /实际(?:造成|承受|损失) \d+/.test(previous.text)
            ) {
              const previousTitle = previous.text.match(/【([^】]+)】/)?.[1];
              const previousSegment = previous.text.match(/第 (\d+)\/(\d+) (?:段|击)/);
              const nextSegmentContinuesSameAction = !!(
                previousTitle &&
                previousSegment &&
                logs.slice(index + 1, index + 3).some((later) =>
                  later.text.includes(`【${previousTitle}】`) &&
                  new RegExp(`第 ${Number(previousSegment[1]) + 1}\\/${previousSegment[2]} (?:段|击)`).test(later.text),
                )
              );
              if (nextSegmentContinuesSameAction) break;
              issues.push({
                label,
                line: previousIndex + 1,
                type: 'result-before-mitigation',
                text: `${previous.text}\nLATER: ${text}`,
                name: mitigationTarget,
              });
              break;
            }
            if (previous.type === 'system' && previous.text.startsWith('state-sync:')) break;
            if (/结算前预估|动作开始结算|开始随机寻找目标/.test(previous.text)) break;
            if ((previous.type === 'attack' || previous.type === 'crit') && !/实际(?:造成|承受|损失)/.test(previous.text)) break;
            if (previous.type === 'skill' || previous.type === 'poison') break;
          }
        }
      }
    }
    const summonMatch = text.match(/【召唤成功】.+?召唤出了 (.+?)！/);
    if (summonMatch?.[1]) {
      const summonName = summonMatch[1];
      const baseName = summonName.replace(/#\d+$/, '');
      if (summonedBaseNames.has(baseName) && summonName === baseName && baseName !== '黑暗大法师') {
        issues.push({ label, line, type: 'duplicate-unnumbered-summon-name', text });
      }
      summonedBaseNames.add(baseName);
    }
    const currentEventName = (entry.type === 'transform' || /触发了锁血保护/.test(text))
      ? (leadingMentionedName(text) ?? mentionedName(text))
      : mentionedName(text);
    const nextTargetsCurrent = currentEventName
      ? new RegExp(
        `(?:对 ${escapeRegExp(currentEventName)} (?:实际)?造成|命中 ${escapeRegExp(currentEventName)}|吞噬了 ${escapeRegExp(currentEventName)}|` +
          `${escapeRegExp(currentEventName)} (?:承受|实际承受|受到|损失))`,
      ).test(nextText)
      : false;
    const previousExplainsTransform = currentEventName
      ? logs
        .slice(Math.max(0, index - 3), index)
        .some((previousEntry) =>
          previousEntry.text.includes(currentEventName) &&
          /(?:造成|受到|承受|损失|命中|攻击了|击中|贯穿|吞噬|波及|反弹伤害)/.test(previousEntry.text),
        )
      : false;
    if (
      (entry.type === 'transform' || /触发了锁血保护/.test(text)) &&
      /实际(?:造成|承受)/.test(nextText) &&
      !/📌 实际结算/.test(nextText) &&
      !/反弹伤害|触发反击/.test(nextText) &&
      currentEventName &&
      nextTargetsCurrent &&
      !previousExplainsTransform
    ) {
      issues.push({ label, line, type: 'transform-before-hit-result', text: `${text}\nNEXT: ${nextText}` });
    }

    if (/被提前枪截停/.test(text) && /被 .* 的【提前枪】击败/.test(logs[index - 1]?.text ?? '')) {
      issues.push({ label, line, type: 'prefire-interrupt-after-death', text });
    }

    if (expectWaterSonInterceptLine > 0 && line <= expectWaterSonInterceptLine && /【援护】小汀\(傀儡\) 冲了出来/.test(text)) {
      issues.push({ label, line, type: 'water-son-intercept-mislabeled-as-puppet', text });
    }
    if (/与【水人的好大儿】互换了位置/.test(text)) {
      expectWaterSonInterceptLine = line + 2;
    } else if (expectWaterSonInterceptLine > 0 && line > expectWaterSonInterceptLine) {
      expectWaterSonInterceptLine = 0;
    }
    if (
      /(全场敌人|所有敌人|敌方全体).*(眩晕|魅惑|击飞|中毒|灼烧|沉默|混乱|致盲|弱点暴露)/.test(text) &&
      !/(?:\d+ 名敌人：|敌人：)/.test(text)
    ) {
      issues.push({ label, line, type: 'blanket-status-without-target-list', text });
    }

    const pair = parseSlackingPair(text);
    if (pair) pair.forEach((name) => activeSlacking.add(name));

    [...activeSlacking].forEach((name) => {
      if (
        text.includes(`摸鱼时间结束！${name}`) ||
        text.includes(`看到搭子回去打工了，${name}`) ||
        (text.includes(`${name} 赶紧扔掉手里的奶茶`) && text.includes('满血跑回战场假装还在战斗')) ||
        text.includes(`${name} 满血跑回战场假装还在战斗`)
      ) {
        activeSlacking.delete(name);
      }
    });

    activeSlacking.forEach((name) => {
      const n = escapeRegExp(name);
      const suspicious = new RegExp(`(对 ${n}|攻击了 ${n}|${n} 承受|${n} 受到持续伤害|${n} 在深渊水牢|${n} 被(?:魔音|空袭|击中|冻结|眩晕|击飞|抹杀|魅惑|中毒|灼烧|沉默))`);
      const allowed =
        text.includes(`${name} 正在场外OB摸鱼`) ||
        text.includes('摸鱼伙伴羁绊') ||
        text.includes('场外OB状态') ||
        text.includes('摸鱼时间结束') ||
        text.includes('看到搭子回去打工') ||
        text.includes('满血跑回战场');
      if (!allowed && suspicious.test(text)) {
        issues.push({ label, line, type: 'slacking-hit-or-targeted', text, name });
      }
    });

    names.forEach((name) => {
      if (text.includes(`对 ${name} 造成了 0`) && /眩晕|魅惑|击飞|中毒|灼烧|沉默/.test(text)) {
        issues.push({ label, line, type: 'zero-damage-status-inline', text, name });
      }
    });
  });

  pendingCounterOutcomes.forEach((pending) => {
    issues.push({ label, line: pending.line, type: 'counter-trigger-without-outcome', text: pending.text });
  });
  pendingInterceptions.forEach((pending) => {
    issues.push({ label, line: pending.line, type: 'intercept-without-actual-damage', text: pending.text });
  });
  pendingGachaPityOutcomes.forEach((pending) => {
    issues.push({ label, line: pending.line, type: 'gacha-pity-without-outcome', text: pending.text });
  });

  return issues;
}

export function runProjectBattle(project: LoadedProject, spec: BattleSpec, options: RunBattleOptions = {}): BattleResult {
  const maxTurns = options.maxTurns ?? DEFAULT_REGRESSION_MAX_TURNS;
  return withProjectSeed(project, spec.seed, () => {
    let battleState = createBattleState(spec.seed, 0);
    let fighters = withBattleRandom(battleState, () => spec.names.map((name) => makeProjectFighter(project, name)));
    const logs: LogEntry[] = [];
    const events: BattleEvent[] = [];
    const spinalSwordRef: SpinalSwordRef = { current: false };
    let turnCount = 0;
    let ended = false;
    let error: string | null = null;
    const stepInvariantErrors: string[] = [];
    const seenStepInvariantErrors = new Set<string>();

    for (let i = 0; i < maxTurns; i += 1) {
      const engine = makeProjectEngine(project, project.cloneFighters(fighters), logs, turnCount, battleState, events);
      try {
        if (
          (
            options.forcePuruisaishi ||
            options.forceHerobrine ||
            options.forceYuzuProphet ||
            options.forceYuzuProphetPhaseTwo ||
            options.forceYuzuProphetUnboundPhaseTwo ||
            options.forceSurtr
          ) &&
          i === 0
        ) {
          if (options.forceSurtr) {
            injectForcedSurtr(project, engine, options.forceSurtrLifecycle);
          }
          if (options.forceHerobrine) {
            spawnHerobrineEvent(engine.createHerobrineRuntime(), '机制压力测试强制出场');
          } else if (
            options.forcePuruisaishi ||
            options.forceYuzuProphet ||
            options.forceYuzuProphetPhaseTwo ||
            options.forceYuzuProphetUnboundPhaseTwo
          ) {
            const puruisaishi = spawnPuruisaishiEvent(engine.createPuruisaishiRuntime(), '机制压力测试强制出场');
            if (
            options.forceYuzuProphet ||
            options.forceYuzuProphetPhaseTwo ||
            options.forceYuzuProphetUnboundPhaseTwo
            ) {
              puruisaishi.puruisaishiPhase = 2;
              puruisaishi.puruisaishiPhaseTwoStartedTurn = engine.turnCount;
              delete puruisaishi.untargetableUntilTurn;
              setNpcCombatCapabilities(puruisaishi, {
                targetable: true,
                aoeVulnerable: true,
              });
              grantPuruisaishiBarrier(puruisaishi, 6000, '预言家压力测试');
              const prophet = trySpawnYuzuProphet(engine.createYuzuProphetRuntime(), puruisaishi, { force: true });
              if (prophet && (options.forceYuzuProphetPhaseTwo || options.forceYuzuProphetUnboundPhaseTwo)) {
                enterYuzuProphetPhaseTwo(engine.createYuzuProphetRuntime(), prophet, '机制压力测试强制进入二阶段');
                if (options.forceYuzuProphetUnboundPhaseTwo) {
                  const boundYuzu = getYuzuProphetBoundYuzu(engine.fighters, prophet);
                  if (boundYuzu) {
                    project.setCurrentHp(boundYuzu, 0);
                    boundYuzu.isDead = true;
                    boundYuzu.isDeadAnnounced = true;
                    boundYuzu.defeatHooksResolved = true;
                  }
                }
              }
            }
          }
        }
        ended = engine.step(spinalSwordRef);
        turnCount = engine.turnCount;
        battleState = engine.battleState;
        fighters = engine.fighters;
        if (options.checkInvariants !== false && options.checkInvariantsEachStep) {
          checkInvariants(fighters, spec.label, {
            includeLabel: options.includeInvariantLabel ?? false,
          }).forEach((invariantError) => {
            if (seenStepInvariantErrors.has(invariantError)) return;
            seenStepInvariantErrors.add(invariantError);
            stepInvariantErrors.push(`[after step ${i + 1}; turn ${turnCount}] ${invariantError}`);
          });
        }
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.stack || err.message}` : String(err);
        break;
      }
      if (ended) break;
    }

    const rosterNames = spec.names.map((name) => name.split('@')[0] ?? name);
    const survivors = fighters
      .filter((fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0)
      .map((fighter) => `${fighter.name}:${fighter.job}:${fighter.currentHp}`);

    return {
      ...spec,
      turns: turnCount,
      ended,
      timedOut: !ended && !error,
      error,
      invariantErrors: options.checkInvariants === false
        ? []
        : options.checkInvariantsEachStep
          ? stepInvariantErrors
          : checkInvariants(fighters, spec.label, {
              includeLabel: options.includeInvariantLabel ?? false,
            }),
      logIssues: options.scanLogs === false ? [] : scanLogs(logs, spec.label, options.scanRosterNames ? rosterNames : []),
      logCount: logs.length,
      survivors,
      logs,
      events,
      fighterDirectory: fighterDirectory(fighters),
    };
  });
}

export function runBattle(spec: BattleSpec, options: RunBattleOptions = {}): BattleResult {
  return runProjectBattle(localProject, spec, options);
}

export function combinations<T>(items: T[], size: number, start = 0, chosen: T[] = [], out: T[][] = []): T[][] {
  if (chosen.length === size) {
    out.push([...chosen]);
    return out;
  }

  const remainingSlots = size - chosen.length;
  for (let i = start; i <= items.length - remainingSlots; i += 1) {
    const item = items[i];
    assert(item !== undefined, `missing item at index ${i}`);
    chosen.push(item);
    combinations(items, size, i + 1, chosen, out);
    chosen.pop();
  }
  return out;
}

export function buildChaosSpecs(names: string[], phase: string, baseSeed: number, chaosSeeds = DEFAULT_CHAOS_SEEDS): BattleSpec[] {
  const specs: BattleSpec[] = [];
  for (let i = 0; i < chaosSeeds; i += 1) {
    specs.push({
      phase,
      label: `${phase}-${i}`,
      names,
      seed: baseSeed + i,
    });
  }
  return specs;
}

export function buildTeamSpecs(teamSize: number, baseSeed: number): BattleSpec[] {
  const specs: BattleSpec[] = [];
  const teamAs = combinations(SPECIALS, teamSize);

  teamAs.forEach((teamA) => {
    const teamASet = new Set(teamA);
    const remaining = SPECIALS.filter((name) => !teamASet.has(name));
    combinations(remaining, teamSize).forEach((teamB) => {
      const label = `${teamSize}v${teamSize}-${teamA.join('+')}-vs-${teamB.join('+')}`;
      specs.push({
        phase: `special-${teamSize}v${teamSize}`,
        label,
        names: [
          ...teamA.map((name) => `${name}@A`),
          ...teamB.map((name) => `${name}@B`),
        ],
        seed: baseSeed + specs.length * 31,
      });
    });
  });

  return specs;
}

export function buildMegaStressSpecs(chaosSeeds = DEFAULT_CHAOS_SEEDS): BattleSpec[] {
  return [
    ...buildChaosSpecs(SPECIALS, 'all-special-with-water', 8000, chaosSeeds),
    ...buildChaosSpecs(NO_WATER, 'all-special-no-water', 9000, chaosSeeds),
    ...buildTeamSpecs(2, 200000),
    ...buildTeamSpecs(3, 300000),
    ...buildTeamSpecs(4, 400000),
    ...buildTeamSpecs(5, 500000),
  ];
}

export function buildRegressionSpecs(): BattleSpec[] {
  const specs: BattleSpec[] = [];
  for (let i = 0; i < 12; i += 1) specs.push({ phase: 'all-special', label: `all-special-${i}`, names: SPECIALS, seed: 8000 + i });
  for (let i = 0; i < 12; i += 1) specs.push({ phase: 'no-water', label: `no-water-${i}`, names: NO_WATER, seed: 9000 + i });
  specs.push({ phase: 'no-water-edge', label: 'no-water-joker-phoenix-chain', names: NO_WATER, seed: 9311 });
  specs.push({
    phase: '2v2-regression',
    label: '2v2-yuzu-tokusatsu-timeout-gamer',
    names: ['玄凝@A', '柚子@A', '兔卷卷@B', '刺猬人@B'],
    seed: 405950,
  });
  specs.push({
    phase: '2v2-regression',
    label: '2v2-yuzu-tokusatsu-timeout-ting',
    names: ['小汀@A', '柚子@A', '兔卷卷@B', '刺猬人@B'],
    seed: 411458,
  });
  specs.push({
    phase: '2v2-regression',
    label: '2v2-yuzu-tokusatsu-timeout-war-thunder',
    names: ['M1A2_abrams_sep@A', '柚子@A', '兔卷卷@B', '刺猬人@B'],
    seed: 120078,
  });
  SPECIALS.forEach((a, i) => {
    SPECIALS.forEach((b, j) => {
      if (i !== j) specs.push({ phase: '1v1', label: `1v1-${a}-vs-${b}`, names: [a, b], seed: 20000 + i * 97 + j });
    });
  });
  for (let i = 0; i < SPECIALS.length; i += 1) {
    for (let j = i + 1; j < SPECIALS.length; j += 1) {
      const firstSpecial = SPECIALS[i];
      const secondSpecial = SPECIALS[j];
      assert(firstSpecial && secondSpecial, `missing special pair at ${i}, ${j}`);
      specs.push({
        phase: 'pair-team',
        label: `pair-team-${firstSpecial}-${secondSpecial}`,
        names: SPECIALS.map((name, idx) => (idx === i || idx === j ? `${name}@PAIR_${i}_${j}` : name)),
        seed: 30000 + i * 101 + j,
      });
    }
  }
  return specs;
}

export { installTypeScriptHook, os, projectRoot };
