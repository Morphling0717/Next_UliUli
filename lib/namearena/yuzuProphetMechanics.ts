import {
  cloneJobDefinition,
  isWinningCombatant,
  setCurrentHp,
} from './combatState';
import { commitFormTransition } from './battlePresentation';
import { generateUniqueRuntimeId } from './core';
import {
  clearOriginiumInfection,
  getActiveOriginiumCrystals,
  getOriginiumInfectionStacks,
  getPuruisaishiBarrierTotal,
  ORIGINIUM_DISEASE_STATUS,
  trySpawnOriginiumCrystal,
  type PuruisaishiRuntime,
} from './puruisaishiMechanics';
import {
  SURTR_BASE_STATS,
  type SurtrLifecycleRuntime,
} from './surtrMechanics';
import {
  getEffectiveCombatStat,
} from './statusMechanics';
import {
  applyStatus,
  hasIdentity,
  initializeEffectState,
  removeBarriers,
  removeEffects,
  withPersistentStatusShapesSuspended,
} from './statusSystem';
import type {
  BattleEngineCore,
  BattleLogMetadata,
  Fighter,
  JobDefinition,
  SkillDefinition,
  SkillTag,
  SurtrState,
} from './types';

export const YUZU_PROPHET_EVENT_TEAM = 'YUZU_PROPHET_EVENT';
export const YUZU_PROPHET_SPAWN_CHANCE = 0.5;

export const YUZU_PROPHET_PHASE_ONE_STATS = {
  hp: 5600,
  atk: 120,
  def: 180,
  spd: 125,
  agl: 105,
  mag: 210,
  res: 190,
  wis: 210,
  critRate: 0.08,
  headsChance: 0.8,
} as const;

export const YUZU_PROPHET_PHASE_TWO_STATS = {
  hp: 6800,
  hpFloor: 3740,
  atk: 150,
  def: 220,
  spd: 135,
  agl: 115,
  mag: 260,
  res: 230,
  wis: 250,
  critRate: 0.1,
  headsChance: 0.85,
} as const;

export const YUZU_PROPHET_SKILLS = {
  phaseOneTime: 'yuzu_prophet_wrong_time',
  phaseOnePlace: 'yuzu_prophet_wrong_place',
  phaseOneBreak: 'yuzu_prophet_shatter',
  originiumLand: 'yuzu_prophet_originium_land',
  understandPuruisaishi: 'yuzu_prophet_understand_puruisaishi',
  executeOriginiumPlan: 'yuzu_prophet_execute_originium_plan',
} as const;

const ELIGIBLE_OWL_SUMMON_KINDS = new Set([
  'swire',
  'linlang_swire',
  'specter',
  'spalter',
]);

const PROPHET_LONG_RETREAT_QUOTE =
  '“博士，我相信我们的联系会超越时间，还有空间。就算海洋沸腾，大气也不复存在，卫星接连坠入重力的漩涡里，膨胀的太阳无情的吞噬它的孩子，直至万籁俱寂的时候，我们也一样能再见。在那个用黑暗与星点光芒装饰过的文明尽头，我们一样会再见面。无论发生什么，我都会等到那一天，所以你也要等我，我不准你忘记我。”';

export interface YuzuProphetRuntime {
  fighters: Fighter[];
  jobs: Partial<Record<string, JobDefinition>>;
  skills: Record<string, SkillDefinition>;
  core: BattleEngineCore;
  turnCount: number;
  largeRound?: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  syncHpPct: (fighter: Fighter) => void;
  discardDeferredDamageEvents: (fighter: Fighter) => void;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  applyStatus: (target: Fighter, application: import('./types').StatusApplication) => boolean;
  ensureYuzuMarkedTarget?: (yuzu: Fighter) => Fighter | undefined;
  createPuruisaishiRuntime: () => PuruisaishiRuntime;
}

export interface YuzuProphetClashProfile {
  basePower: number;
  coinPower: number;
  coinCount: number;
}

export interface YuzuProphetClashResult {
  winner: Fighter;
  loser: Fighter;
  winnerSkillId: string | null;
  loserSkillId: string | null;
  rounds: number;
}

function uniqueNpcId(runtime: Pick<YuzuProphetRuntime, 'fighters' | 'core'>): string {
  return generateUniqueRuntimeId(
    runtime.fighters.map((fighter) => fighter.id),
    () => runtime.core.generateUUID?.() ?? `yuzu-prophet-${Math.random().toString(36).slice(2)}`,
    'yuzu-prophet',
  );
}

function activePuruisaishi(runtime: YuzuProphetRuntime): Fighter | undefined {
  return runtime.fighters.find((fighter) =>
    fighter.isPuruisaishi && runtime.isActiveCombatant(fighter),
  );
}

function originiumParentId(runtime: YuzuProphetRuntime): string {
  return runtime.fighters.find((fighter) =>
    fighter.isOriginiumCore && runtime.isActiveCombatant(fighter),
  )?.id ?? activePuruisaishi(runtime)?.id ?? 'yuzu-prophet-event';
}

export function findActiveYuzuProphet(
  fighters: readonly Fighter[],
  isActive: (fighter: Fighter) => boolean,
): Fighter | undefined {
  return fighters.find((fighter) => fighter.isYuzuProphet && isActive(fighter));
}

export function getYuzuProphetBoundYuzu(
  fighters: readonly Fighter[],
  prophet: Fighter,
): Fighter | undefined {
  const boundId = prophet.yuzuProphetState?.boundYuzuId;
  return boundId ? fighters.find((fighter) => fighter.id === boundId && fighter.isYuzu) : undefined;
}

export function isYuzuProphetControlledSummon(fighter: Fighter, prophetId?: string): boolean {
  const control = fighter.yuzuProphetControlState;
  return !!control &&
    control.disposition === 'controlled' &&
    (!prophetId || control.prophetId === prophetId);
}

export function isYuzuProphetEligibleSummon(fighter: Fighter): boolean {
  return !!fighter.isSummon && (
    !!fighter.isSurtr ||
    (!!fighter.owlSummonState && ELIGIBLE_OWL_SUMMON_KINDS.has(fighter.owlSummonState.kind))
  );
}

export function getActiveYuzuProphetControlledSummons(
  runtime: Pick<YuzuProphetRuntime, 'fighters' | 'isActiveCombatant'>,
  prophet: Fighter,
): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    isYuzuProphetControlledSummon(fighter, prophet.id) &&
    runtime.isActiveCombatant(fighter),
  );
}

function sourceOwnerChainIncludes(
  fighters: readonly Fighter[],
  source: Fighter,
  wantedId: string,
): boolean {
  const visited = new Set<string>();
  let current: Fighter | undefined = source;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.id === wantedId) return true;
    if (isYuzuProphetControlledSummon(current)) return false;
    current = current.summonerId
      ? fighters.find((fighter) => fighter.id === current?.summonerId)
      : undefined;
  }
  return false;
}

export function yuzuProphetSourceBelongsToBoundYuzu(
  fighters: readonly Fighter[],
  prophet: Fighter,
  source?: Fighter,
  attribution?: Partial<import('./types').StatusAttribution>,
): boolean {
  const boundId = prophet.yuzuProphetState?.boundYuzuId;
  if (!boundId) return false;
  if (
    attribution?.creditOwnerId === boundId ||
    attribution?.creditActorId === boundId ||
    attribution?.applierId === boundId
  ) return true;
  if (!source) return false;
  return sourceOwnerChainIncludes(fighters, source, boundId);
}

export function isYuzuProphetSourceImmunityActive(
  runtime: Pick<YuzuProphetRuntime, 'fighters' | 'isActiveCombatant'>,
  prophet: Fighter,
): boolean {
  if (!prophet.isYuzuProphet || prophet.yuzuProphetState?.retreatCompleted) return false;
  const bound = getYuzuProphetBoundYuzu(runtime.fighters, prophet);
  return !!bound && runtime.isActiveCombatant(bound) && !hasIdentity(bound, 'SYNERGY_SLACKING');
}

export function shouldYuzuProphetRejectSource(
  runtime: Pick<YuzuProphetRuntime, 'fighters' | 'isActiveCombatant'>,
  prophet: Fighter,
  source?: Fighter,
  attribution?: Partial<import('./types').StatusAttribution>,
): boolean {
  return isYuzuProphetSourceImmunityActive(runtime, prophet) &&
    !yuzuProphetSourceBelongsToBoundYuzu(runtime.fighters, prophet, source, attribution);
}

export function getYuzuProphetPriorityTarget(
  runtime: Pick<YuzuProphetRuntime, 'fighters' | 'isActiveCombatant'>,
  user: Fighter,
  availableTargets: readonly Fighter[],
): Fighter | undefined {
  const prophet = findActiveYuzuProphet(runtime.fighters, runtime.isActiveCombatant);
  if (!prophet) return undefined;
  const bound = getYuzuProphetBoundYuzu(runtime.fighters, prophet);
  if (!bound) return undefined;

  if (
    (user.id === prophet.id || isYuzuProphetControlledSummon(user, prophet.id)) &&
    runtime.isActiveCombatant(bound)
  ) {
    return availableTargets.find((target) => target.id === bound.id);
  }
  if (user.id === bound.id && runtime.isActiveCombatant(prophet)) {
    return availableTargets.find((target) => target.id === prophet.id);
  }
  return undefined;
}

function setProphetStats(prophet: Fighter, phase: 1 | 2): void {
  const stats = phase === 1 ? YUZU_PROPHET_PHASE_ONE_STATS : YUZU_PROPHET_PHASE_TWO_STATS;
  prophet.maxHp = stats.hp;
  prophet.atk = stats.atk;
  prophet.def = stats.def;
  prophet.spd = stats.spd;
  prophet.agl = stats.agl;
  prophet.mag = stats.mag;
  prophet.res = stats.res;
  prophet.wis = stats.wis;
  prophet.critRate = stats.critRate;
}

function createYuzuProphet(
  runtime: YuzuProphetRuntime,
  boundYuzu: Fighter,
): Fighter {
  const job = runtime.jobs.YUZU_PROPHET_PHASE_ONE ?? {
    name: '巴别塔的恶灵',
    icon: '🜲',
    hp: 1,
    atk: 1,
    def: 1,
    spd: 1,
    agl: 1,
    mag: 1,
    res: 1,
    wis: 1,
    skills: [
      YUZU_PROPHET_SKILLS.phaseOneTime,
      YUZU_PROPHET_SKILLS.phaseOnePlace,
      YUZU_PROPHET_SKILLS.phaseOneBreak,
    ],
  };
  const prophet: Fighter = {
    id: uniqueNpcId(runtime),
    name: '柚子·预言家',
    displayName: '柚子·预言家',
    job: 'YUZU_PROPHET_PHASE_ONE',
    jobData: cloneJobDefinition(job),
    maxHp: YUZU_PROPHET_PHASE_ONE_STATS.hp,
    currentHp: YUZU_PROPHET_PHASE_ONE_STATS.hp,
    hpPct: 1,
    atk: YUZU_PROPHET_PHASE_ONE_STATS.atk,
    def: YUZU_PROPHET_PHASE_ONE_STATS.def,
    spd: YUZU_PROPHET_PHASE_ONE_STATS.spd,
    agl: YUZU_PROPHET_PHASE_ONE_STATS.agl,
    mag: YUZU_PROPHET_PHASE_ONE_STATS.mag,
    res: YUZU_PROPHET_PHASE_ONE_STATS.res,
    wis: YUZU_PROPHET_PHASE_ONE_STATS.wis,
    critRate: YUZU_PROPHET_PHASE_ONE_STATS.critRate,
    color: 'from-rose-500 to-stone-700',
    isDead: false,
    isDeadAnnounced: false,
    statuses: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    teamId: YUZU_PROPHET_EVENT_TEAM,
    isNpc: true,
    cannotWin: true,
    cannotAct: false,
    isYuzuProphet: true,
    yuzuProphetState: {
      phase: 1,
      boundYuzuId: boundYuzu.id,
      appearedTurn: runtime.turnCount,
      clashCount: 0,
    },
  };
  initializeEffectState(prophet);
  return prophet;
}

function markBoundYuzu(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  yuzu: Fighter,
): void {
  const oldTarget = yuzu.yuzuMarkedTargetId
    ? runtime.fighters.find((fighter) => fighter.id === yuzu.yuzuMarkedTargetId)
    : undefined;
  runtime.fighters.forEach((fighter) => {
    removeEffects(fighter, {
      identityIds: ['YUZU_MARKED'],
      effectSourceIds: [yuzu.id],
      reason: 'scripted',
    });
  });
  yuzu.yuzuMarkedTargetId = prophet.id;
  yuzu.yuzuMarkedHitCount = 0;
  delete yuzu.yuzuFuriosoCountedTurn;
  applyStatus(prophet, {
    identityId: 'YUZU_MARKED',
    attribution: {
      effectSourceId: yuzu.id,
      applierId: yuzu.id,
      applierName: yuzu.name,
    },
  });
  runtime.log(
    'debuff',
    oldTarget && oldTarget.id !== prophet.id
      ? `🎯 【预言家标记覆盖】${yuzu.name} 原本标记的 ${oldTarget.name} 被解除；${prophet.name} 成为新的唯一目标。`
      : `🎯 【预言家标记覆盖】${prophet.name} 成为 ${yuzu.name} 的唯一目标。`,
    {
      actorId: yuzu.id,
      actorName: yuzu.name,
      targetIds: [prophet.id],
    },
  );
}

function ownerLabel(runtime: YuzuProphetRuntime, ownerId?: string): string {
  if (!ownerId) return '无原主人';
  return runtime.fighters.find((fighter) => fighter.id === ownerId)?.name ?? '已离场的原主人';
}

function getSurtrOwnerIds(summon: Fighter): string[] {
  if (!summon.surtrState) return [];
  return [...new Set([
    summon.surtrState.primaryOwnerId,
    summon.surtrState.owlOwnerId,
  ].filter((ownerId): ownerId is string => !!ownerId))];
}

export function takeYuzuProphetControl(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  summon: Fighter,
  reason: string,
): boolean {
  if (
    prophet.yuzuProphetState?.phase !== 1 ||
    !runtime.isActiveCombatant(prophet) ||
    !runtime.isActiveCombatant(summon) ||
    !isYuzuProphetEligibleSummon(summon) ||
    isYuzuProphetControlledSummon(summon)
  ) return false;

  const originalSummonerId = summon.summonerId;
  const originalTeamId = summon.teamId;
  const originalSurtrOwnerIds = getSurtrOwnerIds(summon);
  const originalOwnerDescription = originalSurtrOwnerIds.length >= 2
    ? `共同主人 ${originalSurtrOwnerIds.map((ownerId) => ownerLabel(runtime, ownerId)).join('、')}`
    : ownerLabel(runtime, originalSummonerId);
  summon.yuzuProphetControlState = {
    prophetId: prophet.id,
    originalSummonerId,
    originalTeamId,
    originalCannotWin: summon.cannotWin,
    originalSurtrOwnershipSuspended: summon.surtrState?.ownershipSuspended,
    originalSurtrAffiliationMode: summon.surtrState?.lastAffiliationMode,
    disposition: 'controlled',
  };
  summon.summonerId = prophet.id;
  summon.teamId = YUZU_PROPHET_EVENT_TEAM;
  summon.cannotWin = true;
  if (summon.surtrState) {
    summon.surtrState.ownershipSuspended = true;
    summon.surtrState.lastAffiliationMode = 'suspended';
  }
  runtime.log(
    'crit',
    `🜲 【预言家接管】${reason}：${summon.name} 从 ${originalOwnerDescription} 手中被夺走控制权；当前生命、状态与技能资源全部保留，暂归源石事件阵营。`,
    {
      actorId: prophet.id,
      actorName: prophet.name,
      targetIds: [summon.id, ...originalSurtrOwnerIds],
    },
  );
  return true;
}

function createSyntheticSurtr(runtime: YuzuProphetRuntime, prophet: Fighter): Fighter {
  const job = runtime.jobs.ARKNIGHTS_OP ?? runtime.jobs.WARRIOR;
  if (!job) throw new Error('Missing ARKNIGHTS_OP/WARRIOR job for Yuzu Prophet fallback Surtr');
  const existing = runtime.fighters.filter((fighter) =>
    fighter.isSummon && (fighter.summonBaseName ?? fighter.name) === '史尔特尔',
  ).length;
  const name = existing === 0 ? '史尔特尔' : `史尔特尔#${existing + 1}`;
  const state: SurtrState = {
    primaryOwnerId: prophet.id,
    primaryOwnerTeamId: YUZU_PROPHET_EVENT_TEAM,
    twilightUsed: false,
    twilightDrainOpportunities: 0,
    afterglowActive: false,
    afterglowOpportunities: 0,
    actualKills: 0,
    ownershipSuspended: true,
    lastAffiliationMode: 'suspended',
  };
  const summon: Fighter = {
    id: generateUniqueRuntimeId(
      runtime.fighters.map((fighter) => fighter.id),
      () => runtime.core.generateUUID?.() ?? `prophet-surtr-${Math.random().toString(36).slice(2)}`,
      'prophet-surtr',
    ),
    name,
    displayName: name,
    job: 'ARKNIGHTS_OP',
    jobData: cloneJobDefinition(job),
    maxHp: SURTR_BASE_STATS.hp,
    currentHp: SURTR_BASE_STATS.hp,
    hpPct: 1,
    atk: SURTR_BASE_STATS.atk,
    def: SURTR_BASE_STATS.def,
    spd: SURTR_BASE_STATS.spd,
    agl: SURTR_BASE_STATS.agl,
    mag: SURTR_BASE_STATS.mag,
    res: SURTR_BASE_STATS.res,
    wis: SURTR_BASE_STATS.wis,
    critRate: 0.1,
    color: prophet.color,
    isDead: false,
    isDeadAnnounced: false,
    statuses: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    teamId: YUZU_PROPHET_EVENT_TEAM,
    isSummon: true,
    isAdvancedSummon: true,
    isSurtr: true,
    summonerId: prophet.id,
    summonBaseName: '史尔特尔',
    cannotWin: true,
    surtrState: state,
    yuzuProphetControlState: {
      prophetId: prophet.id,
      synthetic: true,
      disposition: 'controlled',
    },
  };
  initializeEffectState(summon);
  runtime.fighters.push(summon);
  prophet.yuzuProphetState!.syntheticSurtrId = summon.id;
  runtime.log(
    'crit',
    `🔥 【预言家保底召唤】场上没有可接管的明日方舟召唤物，${prophet.name} 直接唤出 ${summon.name}；她不需要祭品、没有牢鳄或鸮主人，只受预言家控制。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [summon.id] },
  );
  return summon;
}

export function captureNewYuzuProphetSummons(
  runtime: YuzuProphetRuntime,
  reason = '新的明日方舟召唤物进入战场',
): Fighter[] {
  const prophet = findActiveYuzuProphet(runtime.fighters, runtime.isActiveCombatant);
  if (!prophet || prophet.yuzuProphetState?.phase !== 1) return [];
  const captured: Fighter[] = [];
  for (const summon of runtime.fighters) {
    if (takeYuzuProphetControl(runtime, prophet, summon, reason)) captured.push(summon);
  }
  return captured;
}

export function trySpawnYuzuProphet(
  runtime: YuzuProphetRuntime,
  puruisaishi: Fighter,
  options: { force?: boolean; roll?: number } = {},
): Fighter | undefined {
  if (
    !puruisaishi.isPuruisaishi ||
    (puruisaishi.puruisaishiPhase ?? 1) < 2 ||
    puruisaishi.yuzuProphetSpawnChecked
  ) return undefined;

  puruisaishi.yuzuProphetSpawnChecked = true;
  const candidates = runtime.fighters.filter((fighter) =>
    fighter.isYuzu &&
    runtime.isActiveCombatant(fighter) &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING'),
  );
  if (candidates.length === 0) {
    runtime.log('system', '🜲 【预言家登场判定】普瑞赛斯进入二阶段时场上没有仍在场的柚子，本局判定结束且不会重试。');
    return undefined;
  }

  const roll = options.roll ?? Math.random();
  if (!options.force && roll >= YUZU_PROPHET_SPAWN_CHANCE) {
    runtime.log(
      'system',
      `🜲 【预言家登场判定失败】本次判定值 ${(roll * 100).toFixed(2)}%，未进入 50% 登场区间；本局不会重试。`,
    );
    return undefined;
  }

  const boundYuzu = candidates[Math.floor(Math.random() * candidates.length)]!;
  const prophet = createYuzuProphet(runtime, boundYuzu);
  runtime.fighters.push(prophet);
  puruisaishi.yuzuProphetAppeared = true;
  runtime.log(
    'crit',
    `🜲 【柚子·预言家登场】“源石，终将开满大地。”登场判定成功，${prophet.name} 以【巴别塔的恶灵】形态进入行动队列；她是不能获胜的战场 NPC。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [boundYuzu.id] },
  );
  runtime.log(
    'system',
    `🜲 【绑定柚子】${prophet.name} 从 ${candidates.length} 名合法柚子中绑定 ${boundYuzu.name}；本局只绑定一次，不会改认其他柚子。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [boundYuzu.id] },
  );
  markBoundYuzu(runtime, prophet, boundYuzu);

  const captured = captureNewYuzuProphetSummons(runtime, '预言家登场时清点全场');
  if (captured.length === 0) {
    createSyntheticSurtr(runtime, prophet);
  } else {
    runtime.log(
      'system',
      `🜲 【接管清单】${prophet.name} 共接管 ${captured.length} 名召唤物：${captured.map((fighter) => fighter.name).join('、')}。`,
      { actorId: prophet.id, actorName: prophet.name, targetIds: captured.map((fighter) => fighter.id) },
    );
  }
  return prophet;
}

function restoreControlledSummon(
  runtime: YuzuProphetRuntime,
  summon: Fighter,
): void {
  const control = summon.yuzuProphetControlState;
  if (!control || control.disposition !== 'controlled') return;
  if (control.synthetic) {
    if (summon.surtrState) {
      summon.surtrState.afterglowActive = false;
    }
    runtime.discardDeferredDamageEvents(summon);
    removeEffects(summon, { reason: 'scripted' });
    removeBarriers(summon);
    setCurrentHp(summon, 0);
    summon.isDead = true;
    summon.isDeadAnnounced = true;
    control.disposition = 'withdrawn';
    runtime.log('system', `🔥 【保底召唤退场】${summon.name} 没有原主人，随预言家事件一同退场；不视为死亡。`);
    return;
  }

  summon.summonerId = control.originalSummonerId;
  summon.teamId = control.originalTeamId;
  summon.cannotWin = control.originalCannotWin;
  if (summon.surtrState) {
    summon.surtrState.ownershipSuspended = control.originalSurtrOwnershipSuspended;
    summon.surtrState.lastAffiliationMode = control.originalSurtrAffiliationMode;
  }
  control.disposition = 'returned';
  const surtrOwnerIds = getSurtrOwnerIds(summon);
  const returnDescription = surtrOwnerIds.length >= 2
    ? `返还给共同主人 ${surtrOwnerIds.map((ownerId) => ownerLabel(runtime, ownerId)).join('、')}，恢复接管前的共同控制与阵营关系`
    : `返还给 ${ownerLabel(runtime, control.originalSummonerId)}，恢复接管前的原阵营`;
  runtime.log(
    'system',
    `↩️ 【控制权返还】${summon.name} ${returnDescription}；接管期间的生命、状态和资源消耗全部保留。`,
    {
      targetIds: [
        summon.id,
        ...new Set([
          control.originalSummonerId,
          ...surtrOwnerIds,
        ].filter((ownerId): ownerId is string => !!ownerId)),
      ],
    },
  );
}

function eraseControlledSummon(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  summon: Fighter,
): void {
  const control = summon.yuzuProphetControlState;
  if (!control || control.disposition !== 'controlled') return;
  if (summon.surtrState) {
    summon.surtrState.afterglowActive = false;
  }
  runtime.discardDeferredDamageEvents(summon);
  removeEffects(summon, { reason: 'scripted' });
  removeBarriers(summon);
  setCurrentHp(summon, 0);
  summon.isDead = true;
  summon.isDeadAnnounced = true;
  summon.defeatHooksResolved = true;
  control.disposition = 'erased';
  runtime.log(
    'death',
    `🜲 【阶段抹杀】${prophet.name} 直接撤除 ${summon.name}；锁血、无敌、护盾、黄昏余命、复活、击杀与全部死亡钩子均不结算。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [summon.id] },
  );
  trySpawnOriginiumCrystal(
    runtime.createPuruisaishiRuntime(),
    originiumParentId(runtime),
    `${summon.name} 被预言家阶段抹杀后析出`,
    { logType: 'death', logAtCapacity: true },
  );
}

export function settleYuzuProphetControlledSummonDeath(
  runtime: YuzuProphetRuntime,
  summon: Fighter,
): boolean {
  const control = summon.yuzuProphetControlState;
  if (!control || control.disposition !== 'controlled') return false;
  const prophet = runtime.fighters.find((fighter) => fighter.id === control.prophetId);
  if (!prophet || prophet.yuzuProphetState?.phase !== 1 || prophet.yuzuProphetState.retreatCompleted) return false;
  control.disposition = 'withdrawn';
  runtime.log(
    'death',
    `◆ 【接管召唤物死亡转化】${summon.name} 已完成真实死亡、击杀与全局死亡钩子结算，随后退出预言家控制并尝试转化为普通源石结晶。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [summon.id] },
  );
  trySpawnOriginiumCrystal(
    runtime.createPuruisaishiRuntime(),
    originiumParentId(runtime),
    `${summon.name} 的真实死亡完成转化`,
    { logType: 'death', logAtCapacity: true },
  );
  if (getActiveYuzuProphetControlledSummons(runtime, prophet).length === 0) {
    requestYuzuProphetPhaseTwo(prophet, '全部被接管召唤物均已死亡或离场');
  }
  return true;
}

export function requestYuzuProphetPhaseTwo(prophet: Fighter, reason: string): void {
  const state = prophet.yuzuProphetState;
  if (!state || state.phase >= 2 || state.retreating || state.retreatCompleted) return;
  state.phaseTransitionPending = true;
  state.phaseTransitionReason = state.phaseTransitionReason ?? reason;
}

export function shouldYuzuProphetEnterPhaseTwo(
  runtime: Pick<YuzuProphetRuntime, 'fighters' | 'isActiveCombatant'>,
  prophet: Fighter,
): string | undefined {
  const state = prophet.yuzuProphetState;
  if (!state || state.phase >= 2 || state.retreatCompleted) return undefined;
  const bound = getYuzuProphetBoundYuzu(runtime.fighters, prophet);
  if (!bound || !runtime.isActiveCombatant(bound)) return '绑定柚子已经死亡或离场';
  if (getActiveYuzuProphetControlledSummons(runtime, prophet).length === 0) {
    return '全部被接管召唤物均已死亡或离场';
  }
  return state.phaseTransitionPending ? state.phaseTransitionReason : undefined;
}

export function enterYuzuProphetPhaseTwo(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  reason: string,
): boolean {
  const state = prophet.yuzuProphetState;
  if (
    !state ||
    state.phase >= 2 ||
    state.retreatCompleted ||
    !runtime.isActiveCombatant(prophet)
  ) return false;

  const controlled = getActiveYuzuProphetControlledSummons(runtime, prophet);
  runtime.log(
    'crit',
    `🜲 【我，始终如一】${reason}，${prophet.name} 开始进入二阶段；先抹杀 ${controlled.length} 名仍受控制的召唤物。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: controlled.map((fighter) => fighter.id) },
  );
  controlled.forEach((summon) => eraseControlledSummon(runtime, prophet, summon));

  const beforeHp = prophet.currentHp;
  const phaseTwoJob = runtime.jobs.YUZU_PROPHET_PHASE_TWO;
  const changed = commitFormTransition({
    fighter: prophet,
    log: runtime.log,
    message: () =>
      `🜲 【预言家二阶段】${prophet.name} 完成生命重构：最大生命 ${YUZU_PROPHET_PHASE_TWO_STATS.hp}，生命 ${beforeHp} -> ${prophet.currentHp}；其余合法状态保留。`,
    mutate: () => {
      state.phase = 2;
      state.phaseTransitionPending = false;
      delete state.phaseTransitionReason;
      prophet.job = 'YUZU_PROPHET_PHASE_TWO';
      if (phaseTwoJob) prophet.jobData = cloneJobDefinition(phaseTwoJob);
      withPersistentStatusShapesSuspended(prophet, () => {
        setProphetStats(prophet, 2);
        prophet.currentHp = Math.min(
          prophet.maxHp,
          Math.max(YUZU_PROPHET_PHASE_TWO_STATS.hpFloor, beforeHp),
        );
      });
      runtime.syncHpPct(prophet);
    },
  });
  return changed;
}

function clearProphetMark(runtime: YuzuProphetRuntime, prophet: Fighter): void {
  const bound = getYuzuProphetBoundYuzu(runtime.fighters, prophet);
  if (!bound) return;
  removeEffects(prophet, {
    identityIds: ['YUZU_MARKED'],
    effectSourceIds: [bound.id],
    reason: 'scripted',
  });
  if (bound.yuzuMarkedTargetId === prophet.id) {
    bound.yuzuMarkedTargetId = undefined;
    bound.yuzuMarkedHitCount = 0;
    delete bound.yuzuFuriosoCountedTurn;
  }
  runtime.log('system', `🎯 【预言家标记解除】${prophet.name} 已退场，${bound.name} 的预言家专属唯一目标被清除。`);
  if (runtime.isActiveCombatant(bound)) runtime.ensureYuzuMarkedTarget?.(bound);
}

export function retreatYuzuProphetEvent(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  reason: string,
): boolean {
  const state = prophet.yuzuProphetState;
  if (!state || state.retreatCompleted || state.retreating) return false;
  const retreatPhase = state.phase;
  let returnedSummonCount = 0;
  let withdrawnSummonCount = 0;
  state.retreating = true;
  runtime.log(
    'system',
    `🜲 【预言家共同退场启动】${reason}。这次退场不是死亡，不产生击杀、遗产、复仇、复活或死亡转化。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [prophet.id] },
  );

  if (state.phase === 1) {
    getActiveYuzuProphetControlledSummons(runtime, prophet)
      .forEach((summon) => {
        restoreControlledSummon(runtime, summon);
        if (summon.yuzuProphetControlState?.disposition === 'returned') returnedSummonCount += 1;
        if (summon.yuzuProphetControlState?.disposition === 'withdrawn') withdrawnSummonCount += 1;
      });
  }

  const infected = runtime.fighters.filter((fighter) => getOriginiumInfectionStacks(fighter) > 0);
  infected.forEach(clearOriginiumInfection);
  runtime.log(
    'system',
    infected.length > 0
      ? `🦠 【矿石病清除】共同退场清除了 ${infected.map((fighter) => fighter.name).join('、')} 身上的全部矿石病。`
      : '🦠 【矿石病清除】共同退场完成检查，场上没有残留矿石病。',
  );

  const eventUnits = runtime.fighters.filter((fighter) =>
    fighter.id === prophet.id ||
    fighter.isPuruisaishi ||
    fighter.isOriginiumCore ||
    fighter.isOriginiumCrystal,
  );
  eventUnits.forEach((fighter) => {
    runtime.discardDeferredDamageEvents(fighter);
    removeEffects(fighter, { reason: 'scripted' });
    removeBarriers(fighter);
    setCurrentHp(fighter, 0);
    fighter.isDead = true;
    fighter.isDeadAnnounced = true;
    fighter.defeatHooksResolved = true;
  });
  clearProphetMark(runtime, prophet);

  if (!state.retreatQuotePlayed) {
    state.retreatQuotePlayed = true;
    runtime.log('crit', `🜲 【文明尽头的约定】${PROPHET_LONG_RETREAT_QUOTE}`);
  }
  state.retreatCompleted = true;
  state.retreating = false;
  runtime.log(
    'system',
    retreatPhase === 1
      ? `🜲 【共同退场完成】${prophet.name}、普瑞赛斯、阿喃那与全部源石结晶已经离场；一阶段仍在场召唤物已结算：${returnedSummonCount} 名返还原主人，${withdrawnSummonCount} 名无原主保底召唤物随事件退场；胜负将按结算后的阵营重新计算。`
      : `🜲 【共同退场完成】${prophet.name}、普瑞赛斯、阿喃那与全部源石结晶已经离场；二阶段开始时被接管的召唤物均已抹杀，不存在待返还的控制权，胜负将按当前阵营重新计算。`,
  );
  return true;
}

export function countYuzuProphetCompetingTeams(runtime: Pick<YuzuProphetRuntime, 'fighters' | 'getTeamId'>): number {
  return new Set(
    runtime.fighters
      .filter(isWinningCombatant)
      .map((fighter) => runtime.getTeamId(fighter)),
  ).size;
}

function genericClashProfile(skill: SkillDefinition | undefined): YuzuProphetClashProfile {
  if (!skill) return { basePower: 6, coinPower: 4, coinCount: 1 };
  const noDamage = !!skill.noDamage || skill.tag === 'heal' || skill.tag === 'buff';
  if (noDamage) return { basePower: 7 + (skill.presentation === 'finisher' ? 3 : 0), coinPower: 4, coinCount: 1 };
  const hits = Math.max(1, Math.floor(skill.hits ?? 1));
  let profile: YuzuProphetClashProfile;
  if (hits === 1) profile = { basePower: 7, coinPower: 5, coinCount: 1 };
  else if (hits === 2) profile = { basePower: 5, coinPower: 4, coinCount: 2 };
  else if (hits === 3) profile = { basePower: 4, coinPower: 3, coinCount: 3 };
  else if (hits === 4) profile = { basePower: 5, coinPower: 2, coinCount: 4 };
  else if (hits === 5) profile = { basePower: 4, coinPower: 2, coinCount: 5 };
  else profile = { basePower: 5, coinPower: 1, coinCount: hits };
  if (skill.presentation === 'finisher') profile.basePower += 3;
  return profile;
}

export function getYuzuProphetClashProfile(
  fighter: Fighter,
  skillId: string | null,
  skills: Record<string, SkillDefinition>,
): YuzuProphetClashProfile {
  if (skillId === YUZU_PROPHET_SKILLS.originiumLand) return { basePower: 6, coinPower: 4, coinCount: 2 };
  if (skillId === YUZU_PROPHET_SKILLS.understandPuruisaishi) return { basePower: 5, coinPower: 3, coinCount: 3 };
  if (skillId === 'surtr_flame_sword') return { basePower: 7, coinPower: 5, coinCount: 1 };
  if (skillId === 'surtr_molten_shadow') return { basePower: 5, coinPower: 4, coinCount: 2 };
  if (skillId === 'surtr_twilight') return { basePower: 8, coinPower: 2, coinCount: 4 };
  return genericClashProfile(skillId ? skills[skillId] : undefined);
}

function clashHeadsChance(fighter: Fighter): number {
  if (fighter.isYuzuProphet) {
    return fighter.yuzuProphetState?.phase === 2
      ? YUZU_PROPHET_PHASE_TWO_STATS.headsChance
      : YUZU_PROPHET_PHASE_ONE_STATS.headsChance;
  }
  if (fighter.morale !== undefined && fighter.maxMorale !== undefined) {
    return Math.max(0.05, Math.min(0.95, fighter.morale / Math.max(1, fighter.maxMorale)));
  }
  if (fighter.isSummon) return 0.7;
  return 0.7;
}

function skillOffenseLevel(
  fighter: Fighter,
  skillId: string | null,
  skills: Record<string, SkillDefinition>,
): number {
  const skill = skillId ? skills[skillId] : undefined;
  const tag: SkillTag = skill?.tag ?? 'physical';
  const physical = Math.floor((
    getEffectiveCombatStat(fighter, 'atk') +
    getEffectiveCombatStat(fighter, 'spd') +
    getEffectiveCombatStat(fighter, 'wis') * 0.5
  ) / 25);
  const magical = Math.floor((
    getEffectiveCombatStat(fighter, 'mag') +
    getEffectiveCombatStat(fighter, 'spd') +
    getEffectiveCombatStat(fighter, 'wis') * 0.5
  ) / 25);
  if (tag === 'special') return Math.max(physical, magical);
  if (tag === 'magical' || tag === 'debuff') return magical;
  if (tag === 'heal' || tag === 'buff') {
    return Math.floor((
      getEffectiveCombatStat(fighter, 'wis') +
      getEffectiveCombatStat(fighter, 'spd')
    ) / 20);
  }
  return physical;
}

function rollHeads(coins: number, chance: number): number {
  let heads = 0;
  for (let index = 0; index < coins; index += 1) {
    if (Math.random() < chance) heads += 1;
  }
  return heads;
}

function clashSkillName(
  fighter: Fighter,
  skillId: string | null,
  skills: Record<string, SkillDefinition>,
): string {
  if (!skillId) return '普通攻击';
  return skills[skillId]?.name ?? (fighter.isYuzuProphet ? '预言家技能' : skillId);
}

export function resolveYuzuProphetClash(
  runtime: Pick<YuzuProphetRuntime, 'skills' | 'log'>,
  left: Fighter,
  leftSkillId: string | null,
  right: Fighter,
  rightSkillId: string | null,
  reason: string,
): YuzuProphetClashResult {
  const leftProfile = getYuzuProphetClashProfile(left, leftSkillId, runtime.skills);
  const rightProfile = getYuzuProphetClashProfile(right, rightSkillId, runtime.skills);
  const leftName = clashSkillName(left, leftSkillId, runtime.skills);
  const rightName = clashSkillName(right, rightSkillId, runtime.skills);
  const leftLevel = skillOffenseLevel(left, leftSkillId, runtime.skills);
  const rightLevel = skillOffenseLevel(right, rightSkillId, runtime.skills);
  const levelGap = leftLevel - rightLevel;
  const leftBonus = levelGap > 0 ? Math.min(3, Math.floor(levelGap / 3)) : 0;
  const rightBonus = levelGap < 0 ? Math.min(3, Math.floor(-levelGap / 3)) : 0;
  const leftChance = clashHeadsChance(left);
  const rightChance = clashHeadsChance(right);
  let leftCoins = leftProfile.coinCount;
  let rightCoins = rightProfile.coinCount;
  let rounds = 0;
  let tieRerolls = 0;

  runtime.log(
    'skill',
    `⚖️ 【预言家拼点】${reason}：${left.name} 以【${leftName}】（${leftProfile.basePower}+${leftProfile.coinPower}×${leftCoins}，正面率 ${(leftChance * 100).toFixed(0)}%，进攻等级 ${leftLevel}，等级差加成 +${leftBonus}）对阵 ${right.name} 的【${rightName}】（${rightProfile.basePower}+${rightProfile.coinPower}×${rightCoins}，正面率 ${(rightChance * 100).toFixed(0)}%，进攻等级 ${rightLevel}，等级差加成 +${rightBonus}）。`,
    { actorId: left.id, actorName: left.name, targetIds: [right.id] },
  );

  while (leftCoins > 0 && rightCoins > 0) {
    rounds += 1;
    const leftHeads = rollHeads(leftCoins, leftChance);
    const rightHeads = rollHeads(rightCoins, rightChance);
    const leftScore = leftProfile.basePower + leftHeads * leftProfile.coinPower + leftBonus;
    const rightScore = rightProfile.basePower + rightHeads * rightProfile.coinPower + rightBonus;
    runtime.log(
      'info',
      `⚖️ 【拼点第 ${rounds} 轮】${left.name}：${leftHeads}/${leftCoins} 正面，${leftProfile.basePower}+${leftHeads}×${leftProfile.coinPower}+${leftBonus}=${leftScore}；${right.name}：${rightHeads}/${rightCoins} 正面，${rightProfile.basePower}+${rightHeads}×${rightProfile.coinPower}+${rightBonus}=${rightScore}。`,
      { actorId: left.id, actorName: left.name, targetIds: [right.id] },
    );

    if (leftScore === rightScore) {
      tieRerolls += 1;
      runtime.log('info', `⚖️ 【拼点平局】双方本轮均为 ${leftScore} 点，不碎硬币，立即重投。`);
      if (tieRerolls < 200) continue;
      const leftStability = leftChance + leftLevel / 1000;
      const rightStability = rightChance + rightLevel / 1000;
      if (leftStability >= rightStability) {
        rightCoins -= 1;
        runtime.log('info', `⚖️ 【持续平局裁定】连续 200 次平局后由正面率与进攻等级较高的 ${left.name} 打碎 ${right.name} 1 枚硬币（剩余 ${rightCoins}）。`);
      } else {
        leftCoins -= 1;
        runtime.log('info', `⚖️ 【持续平局裁定】连续 200 次平局后由正面率与进攻等级较高的 ${right.name} 打碎 ${left.name} 1 枚硬币（剩余 ${leftCoins}）。`);
      }
      tieRerolls = 0;
      continue;
    }

    tieRerolls = 0;
    if (leftScore > rightScore) {
      rightCoins -= 1;
      runtime.log('info', `⚖️ 【拼点碎币】${left.name} 以 ${leftScore}:${rightScore} 赢下本轮，${right.name} 失去 1 枚硬币（剩余 ${rightCoins}）。`);
    } else {
      leftCoins -= 1;
      runtime.log('info', `⚖️ 【拼点碎币】${right.name} 以 ${rightScore}:${leftScore} 赢下本轮，${left.name} 失去 1 枚硬币（剩余 ${leftCoins}）。`);
    }
  }

  const leftWon = leftCoins > 0;
  const winner = leftWon ? left : right;
  const loser = leftWon ? right : left;
  const winnerSkillId = leftWon ? leftSkillId : rightSkillId;
  const loserSkillId = leftWon ? rightSkillId : leftSkillId;
  const winnerSkillName = clashSkillName(winner, winnerSkillId, runtime.skills);
  const loserSkillName = clashSkillName(loser, loserSkillId, runtime.skills);
  runtime.log(
    'crit',
    `⚖️ 【拼点结束】${winner.name} 赢得整次拼点并完整释放【${winnerSkillName}】；${loser.name} 的【${loserSkillName}】被取消，未消耗仅在成功释放时才会消耗的一次性资源。`,
    { actorId: winner.id, actorName: winner.name, targetIds: [loser.id] },
  );
  if (left.yuzuProphetState) left.yuzuProphetState.clashCount = (left.yuzuProphetState.clashCount ?? 0) + 1;
  if (right.yuzuProphetState) right.yuzuProphetState.clashCount = (right.yuzuProphetState.clashCount ?? 0) + 1;
  return { winner, loser, winnerSkillId, loserSkillId, rounds };
}

export function chooseYuzuProphetPhaseOneSkill(): string {
  const roll = Math.random();
  if (roll < 0.45) return YUZU_PROPHET_SKILLS.phaseOneTime;
  if (roll < 0.8) return YUZU_PROPHET_SKILLS.phaseOnePlace;
  return YUZU_PROPHET_SKILLS.phaseOneBreak;
}

export function chooseYuzuProphetPhaseTwoClashSkill(hasCrystal: boolean): string {
  if (!hasCrystal) return YUZU_PROPHET_SKILLS.understandPuruisaishi;
  return Math.random() < 0.45
    ? YUZU_PROPHET_SKILLS.originiumLand
    : YUZU_PROPHET_SKILLS.understandPuruisaishi;
}

export function hasOrdinaryOriginiumCrystal(runtime: Pick<YuzuProphetRuntime, 'createPuruisaishiRuntime'>): boolean {
  return getActiveOriginiumCrystals(runtime.createPuruisaishiRuntime()).length > 0;
}

export function eraseLowestOriginiumCrystalForProphet(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
): Fighter | undefined {
  const crystals = getActiveOriginiumCrystals(runtime.createPuruisaishiRuntime())
    .sort((a, b) =>
      a.currentHp - b.currentHp ||
      (a.originiumSpawnTurn ?? 0) - (b.originiumSpawnTurn ?? 0) ||
      a.id.localeCompare(b.id),
    );
  const crystal = crystals[0];
  if (!crystal) return undefined;
  setCurrentHp(crystal, 0);
  crystal.isDead = true;
  crystal.isDeadAnnounced = true;
  crystal.defeatHooksResolved = true;
  runtime.log(
    'death',
    `◆ 【源石，开满大地·前置代价】${prophet.name} 抹除生命最低且最早生成的 ${crystal.name}；这不是死亡，不触发击杀、破拆奖励、矿石病清除或死亡钩子，拼点失败也不会返还。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [crystal.id] },
  );
  return crystal;
}

export function describePuruisaishiBarrierGain(
  runtime: YuzuProphetRuntime,
  prophet: Fighter,
  gained: number,
): void {
  const puruisaishi = activePuruisaishi(runtime);
  if (!puruisaishi || gained <= 0) return;
  runtime.log(
    'buff',
    `🜲 【普瑞赛斯，我理解你·前置效果】${prophet.name} 在拼点前为 ${puruisaishi.name} 增加 ${gained} 点源石护盾（当前 ${getPuruisaishiBarrierTotal(puruisaishi)}）；即使拼点失败也不会撤回。`,
    { actorId: prophet.id, actorName: prophet.name, targetIds: [puruisaishi.id] },
  );
}

export function getYuzuProphetSurtrRuntime(
  runtime: YuzuProphetRuntime,
): Pick<SurtrLifecycleRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant'> {
  return {
    fighters: runtime.fighters,
    getTeamId: runtime.getTeamId,
    isActiveCombatant: runtime.isActiveCombatant,
  };
}

export function isYuzuProphetSettlementSuppressed(fighters: readonly Fighter[]): boolean {
  return fighters.some((fighter) =>
    fighter.isYuzuProphet ||
    (fighter.isPuruisaishi && fighter.yuzuProphetAppeared),
  );
}

export function isProphetOriginiumStatus(identityId: string): boolean {
  return identityId === ORIGINIUM_DISEASE_STATUS;
}
