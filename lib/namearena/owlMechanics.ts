import type {
  BattleState,
  Fighter,
  JobDefinition,
  OwlSummonKind,
  OwlWarForm,
  StatKey,
  StatusApplication,
  DispelOptions,
  DispelResolution,
  BattleLogMetadata,
} from './types';
import { applyPermanentStatBuff, cloneJobDefinition, resolveHealing, setCurrentHp } from './combatState';
import { commitFormTransition } from './battlePresentation';

import { hasIdentity, initializeEffectState, removeEffects, applyStatus, withPersistentStatusShapesSuspended } from './statusSystem';
import { getEffectiveCombatStat, getPanelCombatStat } from './statusMechanics';
import { generateUniqueRuntimeId } from './core';
import { didDamageConnect, isDamageRedirected } from './damageRedirects';
import {
  canTargetAcrossHerobrineBoundary,
  isNpcAoeVulnerable,
} from './npcCombat';

export interface OwlRuntime {
  fighters: Fighter[];
  battleState?: BattleState;
  jobs: Partial<Record<string, JobDefinition>>;
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage?: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: import('./types').DamageApplicationOptions,
  ) => number;
  applyStatus?: (target: Fighter, application: StatusApplication) => boolean;
  dispelStatusEffects?: (target: Fighter, options: DispelOptions) => DispelResolution;
  markDefeated?: (target: Fighter, options?: import('./types').DefeatOptions) => boolean;
  flushDeferredDamageEvents?: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  onSummonCreated?: (summon: Fighter) => void;
}

const OWL_FORM_STATUS: Record<OwlWarForm, string> = {
  victory: 'OWL_FORM_VICTORY',
  pride: 'OWL_FORM_PRIDE',
  defeat: 'OWL_FORM_DEFEAT',
  sorrow: 'OWL_FORM_SORROW',
};

const OWL_FORM_NAMES: Record<OwlWarForm, string> = {
  victory: '胜兵',
  pride: '骄兵',
  defeat: '败兵',
  sorrow: '哀兵',
};

export const OWL_HEAVEN_MAX = 7;
export const OWL_WILD_MAX = 5;
export const OWL_HEAVEN_INHERIT_RATIO = 0.085;

function uniqueSummonName(runtime: Pick<OwlRuntime, 'fighters'>, baseName: string): string {
  const count = runtime.fighters.filter((fighter) =>
    fighter.isSummon && (fighter.summonBaseName ?? fighter.name) === baseName,
  ).length;
  return count === 0 ? baseName : `${baseName}#${count + 1}`;
}

function createId(kind: OwlSummonKind, runtime: Pick<OwlRuntime, 'turnCount' | 'fighters'>): string {
  return generateUniqueRuntimeId(
    runtime.fighters.map((fighter) => fighter.id),
    () => `owl-${kind}-${runtime.turnCount}-${runtime.fighters.length}-${Math.random().toString(36).slice(2, 9)}`,
    `owl-${kind}`,
  );
}

type OwlSummonSpec = {
  kind: OwlSummonKind;
  baseName: string;
  job: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  agl: number;
  mag: number;
  res: number;
  wis: number;
  cannotAct?: boolean;
  cannotWin?: boolean;
  untargetable?: boolean;
  pairId?: string;
  transformAtTurn?: number;
  expiresAtTurn?: number;
};

export function spawnOwlSummon(runtime: OwlRuntime, owl: Fighter, spec: OwlSummonSpec): Fighter {
  const job = runtime.jobs[spec.job] ?? runtime.jobs.WARRIOR;
  if (!job) throw new Error(`Missing Owl summon job: ${spec.job}`);
  const name = uniqueSummonName(runtime, spec.baseName);
  const summon: Fighter = {
    id: createId(spec.kind, runtime),
    name,
    displayName: name,
    job: spec.job,
    jobData: cloneJobDefinition(job),
    maxHp: spec.hp,
    currentHp: spec.hp,
    hpPct: 1,
    atk: spec.atk,
    def: spec.def,
    spd: spec.spd,
    agl: spec.agl,
    mag: spec.mag,
    res: spec.res,
    wis: spec.wis,
    critRate: 0.1,
    color: owl.color,
    isDead: false,
    isDeadAnnounced: false,
    statuses: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    teamId: owl.teamId,
    isSummon: true,
    summonerId: owl.id,
    summonBaseName: spec.baseName,
    cannotAct: spec.cannotAct,
    cannotWin: spec.cannotWin,
    untargetableUntilTurn: spec.untargetable ? Number.MAX_SAFE_INTEGER : undefined,
    owlSummonState: {
      kind: spec.kind,
      spawnedTurn: runtime.turnCount,
      pairId: spec.pairId,
      transformAtTurn: spec.transformAtTurn,
      expiresAtTurn: spec.expiresAtTurn,
      wildStacks: spec.kind === 'emperor' ? 0 : undefined,
    },
  };
  initializeEffectState(summon);
  runtime.fighters.push(summon);
  runtime.onSummonCreated?.(summon);
  return summon;
}

export function retireOwlSummon(runtime: Pick<OwlRuntime, 'fighters'>, summon: Fighter): void {
  const index = runtime.fighters.findIndex((fighter) => fighter.id === summon.id);
  if (index >= 0) runtime.fighters.splice(index, 1);
}

export function activeOwlSummons(runtime: Pick<OwlRuntime, 'fighters' | 'isActiveCombatant'>, owl: Fighter, kind?: OwlSummonKind): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    fighter.isSummon &&
    fighter.summonerId === owl.id &&
    runtime.isActiveCombatant(fighter) &&
    (!kind || fighter.owlSummonState?.kind === kind),
  );
}

export function findOwlEmperor(runtime: Pick<OwlRuntime, 'fighters' | 'isActiveCombatant'>, owl: Fighter): Fighter | undefined {
  return activeOwlSummons(runtime, owl, 'emperor')[0];
}

export function ensureOwlState(owl: Fighter, turnCount = 0): NonNullable<Fighter['owlState']> {
  const previous = owl.owlState;
  const phase = Math.max(1, Math.min(3, Math.floor(previous?.phase ?? 1))) as 1 | 2 | 3;
  const warForm = previous?.warForm ?? 'victory';
  const normalized: NonNullable<Fighter['owlState']> = {
    phase,
    warForm,
    warFormStartedTurn: Math.max(0, Math.floor(previous?.warFormStartedTurn ?? turnCount)),
    heavenStacks: Math.max(0, Math.min(OWL_HEAVEN_MAX, Math.floor(previous?.heavenStacks ?? 0))),
    sweepUsed: !!previous?.sweepUsed,
    riverMarkedTargetId: previous?.riverMarkedTargetId,
    riverMarkExpiresTurn: previous?.riverMarkExpiresTurn,
  };
  if (previous) {
    Object.assign(previous, normalized);
    owl.owlState = previous;
  } else {
    owl.owlState = normalized;
  }
  const formStatus = OWL_FORM_STATUS[warForm];
  if (!hasIdentity(owl, formStatus)) {
    applyStatus(owl, {
      identityId: formStatus,
      ...(warForm === 'defeat' || warForm === 'sorrow' ? { remainingTurns: 10 } : {}),
      attribution: { effectSourceId: owl.id, applierId: owl.id, applierName: owl.name },
    });
  }
  return owl.owlState;
}

function clearOwlForm(owl: Fighter): void {
  removeEffects(owl, { identityIds: Object.values(OWL_FORM_STATUS), reason: 'replaced' });
}

export function switchOwlWarForm(runtime: OwlRuntime, owl: Fighter, next: OwlWarForm, reason: string): boolean {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.warForm === next) return false;
  const previous = state.warForm;
  clearOwlForm(owl);
  state.warForm = next;
  state.warFormStartedTurn = runtime.turnCount;
  const statusType = OWL_FORM_STATUS[next];
  applyStatus(owl, {
    identityId: statusType,
    ...(next === 'defeat' || next === 'sorrow' ? { remainingTurns: 10 } : {}),
    attribution: { effectSourceId: owl.id, applierId: owl.id, applierName: owl.name },
  });
  const selfMetadata: BattleLogMetadata = {
    actorId: owl.id,
    actorName: owl.name,
    targetIds: [owl.id],
  };
  runtime.log(
    'buff',
    `🦉 【天意侵蚀】${owl.name} 由【${OWL_FORM_NAMES[previous]}】转入【${OWL_FORM_NAMES[next]}】：${reason}。`,
    selfMetadata,
  );
  if (next === 'sorrow') {
    runtime.dispelStatusEffects?.(owl, { strength: 'strong', direction: 'negative' });
    // Strong-dispelling AIRBORNE settles landing damage immediately. If that
    // landing is lethal, Sorrow recovery must not revive the defeated Owl.
    if (!runtime.isActiveCombatant(owl)) return true;
    const healing = resolveHealing(owl, Math.floor(owl.maxHp * 0.3), {
      kind: 'direct',
      sourceId: '哀兵',
      healer: owl,
    }, (type, text) => runtime.log(type, text, selfMetadata));
    const recoveryText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已经全满';
    runtime.log(
      healing.outcome === 'blocked' ? 'info' : 'heal',
      `🕯️ 【哀兵】${owl.name} 清除所有可驱散的异常与减益（矿石病等不可驱散状态保留）；${recoveryText}！`,
      selfMetadata,
    );
  }
  return true;
}

export function getOwlOutgoingMultiplier(attacker?: Fighter): number {
  if (!attacker?.isOwl) return 1;
  const form = ensureOwlState(attacker).warForm;
  if (form === 'victory') return 1.35;
  if (form === 'sorrow') return 1.2;
  return 1;
}

export function getOwlWarFormDisplayName(attacker?: Fighter): string | undefined {
  if (!attacker?.isOwl) return undefined;
  return OWL_FORM_NAMES[ensureOwlState(attacker).warForm];
}

export function getOwlIncomingMultiplier(target: Fighter): number {
  if (!target.isOwl) return 1;
  const state = ensureOwlState(target);
  let multiplier = state.warForm === 'defeat' ? 0.15 : state.phase === 2 ? 0.75 : 1;
  if (hasIdentity(target, 'OWL_EAR_GUARD')) multiplier *= 0.75;
  return multiplier;
}

export function owlResistsHostileStatus(target: Fighter): boolean {
  return !!target.isOwl && ensureOwlState(target).warForm === 'defeat' && Math.random() < 0.85;
}

export function enterOwlPrideAfterKill(runtime: OwlRuntime, killer?: Fighter): void {
  if (!killer) return;
  const owl = killer.isOwl
    ? killer
    : killer.isSurtr && killer.surtrState?.owlOwnerId && !killer.surtrState.ownershipSuspended
      ? runtime.fighters.find((fighter) => fighter.id === killer.surtrState?.owlOwnerId && fighter.isOwl)
    : killer.isSummon && killer.summonerId
      ? runtime.fighters.find((fighter) => fighter.id === killer.summonerId && fighter.isOwl)
      : undefined;
  if (!owl || !runtime.isActiveCombatant(owl)) return;
  if (ensureOwlState(owl, runtime.turnCount).warForm === 'victory') {
    switchOwlWarForm(runtime, owl, 'pride', `${killer.name} 完成击杀，胜势化作骄气`);
  }
}

export function tryEnterOwlDefeat(runtime: OwlRuntime, owl: Fighter): boolean {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.warForm !== 'pride' || owl.currentHp > owl.maxHp * 0.5) return false;
  return switchOwlWarForm(runtime, owl, 'defeat', '骄兵血线跌至一半，阵势彻底崩乱');
}

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

export function rebuildOwlPhaseTwoStats(owl: Fighter): void {
  const state = ensureOwlState(owl);
  owl.maxHp = Math.max(3100, Math.min(3700, Math.floor(owl.maxHp * 6.3)));
  owl.currentHp = owl.maxHp;
  owl.atk = scaleStat(owl.atk, 4.4, 190);
  owl.def = scaleStat(owl.def, 5.5, 165);
  owl.spd = scaleStat(owl.spd, 5.8, 135);
  owl.agl = scaleStat(owl.agl, 5.0, 120);
  owl.mag = scaleStat(owl.mag, 5.0, 210);
  owl.res = scaleStat(owl.res, 5.5, 180) + 10;
  owl.wis = scaleStat(owl.wis, 5.0, 195);
  // The active war form also shapes the phase-two base once; the live form
  // status remains independently queryable and can still change later.
  if (state.warForm === 'victory') {
    applyPermanentStatBuff(owl, { atk: 1.08, def: 1.08, spd: 1.08, agl: 1.08, mag: 1.08, res: 1.08, wis: 1.08 });
  } else if (state.warForm === 'pride') {
    applyPermanentStatBuff(owl, { def: 0.55, res: 0.55 });
  }
  applyStatus(owl, { identityId: 'OWL_ACID_FEARLESS', attribution: { effectSourceId: owl.id } });
}

export function getOwlPhaseTwoLightningTargets(runtime: OwlRuntime, owl: Fighter): Fighter[] {
  return runtime.fighters.filter((target) =>
    target.id !== owl.id &&
    runtime.isActiveCombatant(target) &&
    !hasIdentity(target, 'SYNERGY_SLACKING') &&
    !(target.isPuruisaishi && (target.puruisaishiPhase ?? 1) <= 1) &&
    (!target.isNpc || isNpcAoeVulnerable(target)) &&
    canTargetAcrossHerobrineBoundary(runtime.battleState, owl, target) &&
    (target.untargetableUntilTurn ?? -1) < runtime.turnCount,
  );
}

export function releaseOwlPhaseTwoLightning(runtime: OwlRuntime, owl: Fighter): void {
  if (!runtime.applyDamage) return;
  const targets = getOwlPhaseTwoLightningTargets(runtime, owl);
  const effectiveMag = getEffectiveCombatStat(owl, 'mag', 'custom');
  const effectiveWis = getEffectiveCombatStat(owl, 'wis', 'custom');
  const raw = Math.max(80, Math.floor(effectiveMag * 0.72 + effectiveWis * 0.28));
  runtime.log('skill', `⚡ 【煮酒惊雷】${owl.name}：“这雷把我吓死了！”雷光席卷全场！`, {
    actorId: owl.id,
    actorName: owl.name,
    skillId: 'owl_phase_two_lightning',
    skillName: '煮酒惊雷',
    presentation: 'skill',
    targetIds: targets.map((target) => target.id),
    visualCue: {
      kind: 'combat_action',
      sourceId: owl.id,
      targetIds: targets.map((target) => target.id),
      presentation: 'skill',
    },
  });
  targets.forEach((target) => {
    if (!runtime.isActiveCombatant(target)) return;
    const damageOptions: import('./types').DamageApplicationOptions = {
      actionName: '煮酒惊雷',
      respectDefenses: true,
      suppressOwlCooperation: true,
      deferTransform: true,
      isAreaDamage: true,
    };
    const actual = runtime.applyDamage?.(target, raw, 'skill', false, owl, damageOptions) ?? 0;
    const redirected = isDamageRedirected(damageOptions);
    const connected = !redirected && didDamageConnect(actual, damageOptions);
    runtime.flushDeferredDamageEvents?.(target, 'mitigation');
    if (!redirected) {
      runtime.log(
        connected ? 'skill' : 'info',
        actual > 0
          ? `⚡ 雷击命中 ${target.name}，实际造成 ${actual} 点伤害。`
          : connected
            ? `⚡ 雷击命中 ${target.name}；但【黄昏余命】期间未再损失生命。`
            : `⚡ ${target.name} 挡下或化解了雷击，未受到生命伤害。`,
        {
          actorId: owl.id,
          actorName: owl.name,
          targetIds: [target.id],
          skillId: 'owl_phase_two_lightning',
          skillName: '煮酒惊雷',
          presentation: 'skill',
        },
      );
    }
    runtime.flushDeferredDamageEvents?.(target);
    if (!redirected && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated?.(target, {
        message: `💀 【煮酒惊雷】${target.name} 被 ${owl.name} 的转阶段雷击击败！`,
        killer: owl,
      });
    }
  });
}

export function spawnOwlMeal(runtime: OwlRuntime, owl: Fighter): Fighter {
  return spawnOwlSummon(runtime, owl, {
    kind: 'meal', baseName: '一碗盖饭', job: 'OWL_FOOD',
    hp: 10, atk: 1, def: 0, spd: 1, agl: 0, mag: 1, res: 0, wis: 1,
    cannotAct: true, cannotWin: true, untargetable: true,
    transformAtTurn: runtime.turnCount + 5,
  });
}

export function spawnOwlCrickets(runtime: OwlRuntime, owl: Fighter): Fighter[] {
  const active = activeOwlSummons(runtime, owl, 'cricket');
  const slots = Math.max(0, 2 - active.length);
  if (slots === 0) return [];
  const pairId = `owl-cricket-pair-${runtime.turnCount}-${Math.random().toString(36).slice(2, 7)}`;
  return Array.from({ length: slots }, () => spawnOwlSummon(runtime, owl, {
    kind: 'cricket', baseName: '蛐蛐', job: 'OWL_CRICKET', pairId,
    hp: 720, atk: 125, def: 72, spd: 128, agl: 96, mag: 45, res: 68, wis: 70,
  }));
}

export function spawnOwlZhao(runtime: OwlRuntime, owl: Fighter): Fighter | undefined {
  if (activeOwlSummons(runtime, owl, 'zhao_adou').length > 0) return undefined;
  return spawnOwlSummon(runtime, owl, {
    kind: 'zhao_adou', baseName: '赵云&阿斗', job: 'OWL_ZHAO_ADOU',
    hp: 1700, atk: 180, def: 115, spd: 180, agl: 160, mag: 70, res: 120, wis: 120,
    expiresAtTurn: runtime.turnCount + 7,
  });
}

export function spawnOwlFurrySquad(runtime: OwlRuntime, owl: Fighter): Fighter[] {
  if (ensureOwlState(owl, runtime.turnCount).sweepUsed) return [];
  ensureOwlState(owl, runtime.turnCount).sweepUsed = true;
  return [
    spawnOwlSummon(runtime, owl, { kind: 'swire', baseName: '诗怀雅', job: 'OWL_SWIRE', hp: 1650, atk: 235, def: 108, spd: 145, agl: 112, mag: 80, res: 108, wis: 112 }),
    spawnOwlSummon(runtime, owl, { kind: 'linlang_swire', baseName: '琳琅诗怀雅', job: 'OWL_LINLANG_SWIRE', hp: 1850, atk: 265, def: 122, spd: 150, agl: 118, mag: 95, res: 120, wis: 125 }),
    spawnOwlSummon(runtime, owl, { kind: 'specter', baseName: '幽灵鲨', job: 'OWL_SPECTER', hp: 2050, atk: 220, def: 125, spd: 138, agl: 102, mag: 70, res: 118, wis: 95 }),
    spawnOwlSummon(runtime, owl, { kind: 'spalter', baseName: '归溟幽灵鲨', job: 'OWL_SPALTER', hp: 2200, atk: 235, def: 132, spd: 142, agl: 110, mag: 105, res: 132, wis: 118 }),
  ];
}

export function spawnOwlEmperor(runtime: OwlRuntime, owl: Fighter): Fighter {
  const existing = findOwlEmperor(runtime, owl);
  if (existing) return existing;
  return spawnOwlSummon(runtime, owl, {
    kind: 'emperor', baseName: '帝王之征', job: 'OWL_EMPEROR_DRAGON',
    hp: 3650, atk: 260, def: 145, spd: 135, agl: 100, mag: 260, res: 145, wis: 150,
  });
}

export function addOwlWildStack(runtime: OwlRuntime, owl: Fighter): number {
  const emperor = findOwlEmperor(runtime, owl);
  if (!emperor) return 0;
  const before = Math.max(0, emperor.owlSummonState?.wildStacks ?? 0);
  if (before >= OWL_WILD_MAX) return before;
  const next = before + 1;
  if (emperor.owlSummonState) emperor.owlSummonState.wildStacks = next;
  applyPermanentStatBuff(emperor, { atk: 1.08, spd: 1.06 });
  applyStatus(emperor, { identityId: 'OWL_WILD', potency: 1, attribution: { effectSourceId: owl.id } });
  return next;
}

export function enterOwlPhaseThree(runtime: OwlRuntime, owl: Fighter): boolean {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.phase >= 3 || !runtime.isActiveCombatant(owl)) return false;
  const nextJob = runtime.jobs.OWL_DRAGON_SOVEREIGN;
  if (!nextJob) return false;
  const hpRatio = owl.maxHp > 0 ? owl.currentHp / owl.maxHp : 1;
  let emperor: Fighter | undefined;
  return commitFormTransition({
    fighter: owl,
    log: runtime.log,
    message: () => `🐉 【天意七重】${owl.name}：“恭喜爹可以撑地了！”转入第三阶段【${nextJob.name}】，玉玺入手并召唤 ${emperor?.name ?? '帝王之征'}！`,
    mutate: () => {
      withPersistentStatusShapesSuspended(owl, () => {
        owl.maxHp = Math.max(3950, Math.min(4750, Math.floor(owl.maxHp * 1.26)));
        owl.currentHp = Math.max(1, Math.floor(owl.maxHp * Math.max(0.57, hpRatio)));
        owl.atk = scaleStat(owl.atk, 1.35, 270);
        owl.def = scaleStat(owl.def, 1.25, 205);
        owl.spd = scaleStat(owl.spd, 1.2, 160);
        owl.agl = scaleStat(owl.agl, 1.15, 138);
        owl.mag = scaleStat(owl.mag, 1.3, 285);
        owl.res = scaleStat(owl.res, 1.25, 220);
        owl.wis = scaleStat(owl.wis, 1.3, 255);
      });
      owl.job = 'OWL_DRAGON_SOVEREIGN';
      owl.jobData = cloneJobDefinition(nextJob);
      owl.transformed = true;
      state.phase = 3;
      state.heavenStacks = OWL_HEAVEN_MAX;
      if (state.riverMarkedTargetId) {
        const marked = runtime.fighters.find((fighter) => fighter.id === state.riverMarkedTargetId);
        if (marked) removeEffects(marked, { identityIds: ['OWL_RIVER_MARK'], effectSourceIds: [owl.id], reason: 'scripted' });
      }
      delete state.riverMarkedTargetId;
      delete state.riverMarkExpiresTurn;
      applyPermanentStatBuff(owl, { atk: 1.18 });
      applyStatus(owl, { identityId: 'OWL_IMPERIAL_SEAL', attribution: { effectSourceId: owl.id } });
      emperor = spawnOwlEmperor(runtime, owl);
      runtime.syncHpPct(owl);
    },
  });
}

const INHERITED_STATS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];

export function isOwlHeavenEligibleDeath(fighter: Fighter): boolean {
  if (fighter.isPuruisaishi || fighter.isOriginiumCore || fighter.isOriginiumCrystal) return false;
  if (fighter.isNpc) return false;
  return !fighter.cannotWin || !!fighter.isSummon;
}

export function grantOwlHeavenFromDeath(runtime: OwlRuntime, fallen: Fighter): void {
  if (!isOwlHeavenEligibleDeath(fallen)) return;
  runtime.fighters.forEach((owl) => {
    if (!owl.isOwl || !runtime.isActiveCombatant(owl)) return;
    const state = ensureOwlState(owl, runtime.turnCount);
    if (state.phase !== 2) return;
    const gains: string[] = [];
    const hpGain = Math.max(1, Math.floor(fallen.maxHp * OWL_HEAVEN_INHERIT_RATIO));
    owl.maxHp += hpGain;
    owl.currentHp += hpGain;
    gains.push(`血+${hpGain}`);
    INHERITED_STATS.forEach((key) => {
      const inheritedValue = getPanelCombatStat(fallen, key);
      const gain = Math.max(1, Math.floor(inheritedValue * OWL_HEAVEN_INHERIT_RATIO));
      owl[key] += gain;
      gains.push(`${key}+${gain}`);
    });
    state.heavenStacks = Math.min(OWL_HEAVEN_MAX, state.heavenStacks + 1);
    runtime.syncHpPct(owl);
    runtime.log(
      'buff',
      `🦉 【不可能！】${owl.name}：“我二弟天下无敌！”继承 ${fallen.name} 8.5% 数值（${gains.join(' / ')}），天意 ${state.heavenStacks}/${OWL_HEAVEN_MAX}。`,
      {
        actorId: owl.id,
        actorName: owl.name,
        targetIds: [fallen.id],
      },
    );
    if (state.heavenStacks >= OWL_HEAVEN_MAX) enterOwlPhaseThree(runtime, owl);
  });
}

export function consumeOwlFoodForYuzu(
  fighters: Fighter[],
  yuzu: Fighter,
  log: (type: string, text: string) => void,
): number {
  const food = fighters
    .filter((fighter) =>
      fighter.isSummon &&
      (fighter.owlSummonState?.kind === 'meal' || fighter.owlSummonState?.kind === 'rice') &&
      !fighter.isDead && fighter.currentHp > 0,
    )
    .sort((a, b) => (a.owlSummonState?.spawnedTurn ?? 0) - (b.owlSummonState?.spawnedTurn ?? 0))[0];
  if (!food) return 0;
  const kindName = food.owlSummonState?.kind === 'rice' ? '被扒回碗里的米饭' : '一碗盖饭';
  const healing = resolveHealing(yuzu, Math.floor(yuzu.maxHp * 0.1), {
    kind: 'direct',
    sourceId: '顺手加餐',
    healer: yuzu,
  }, log);
  const index = fighters.findIndex((fighter) => fighter.id === food.id);
  if (index >= 0) fighters.splice(index, 1);
  const recoveryText = healing.actual > 0
    ? `额外恢复 ${healing.actual} 点生命`
    : healing.outcome === 'blocked'
      ? '治疗被完全阻止'
      : '生命已满';
  log(healing.outcome === 'blocked' ? 'info' : 'heal', `🥄 【顺手加餐】${yuzu.name} 又吃掉 ${kindName}；${recoveryText}，这次消耗退场不计死亡。`);
  return healing.actual;
}

function processOwlSummonLifecycle(runtime: OwlRuntime, summon: Fighter): void {
  const state = summon.owlSummonState;
  if (!state || summon.isDead || summon.isDeadAnnounced) return;
  if (state.kind === 'meal' && state.transformAtTurn !== undefined && runtime.turnCount >= state.transformAtTurn) {
    state.kind = 'rice';
    delete state.transformAtTurn;
    state.expiresAtTurn = runtime.turnCount + 2;
    summon.summonBaseName = '被扒回碗里的米饭';
    summon.name = uniqueSummonName(runtime, '被扒回碗里的米饭');
    summon.displayName = summon.name;
    runtime.log('info', `🍚 【盖饭变化】一碗盖饭放凉后变成了 ${summon.name}，再过 2 个全局行动回合就会被鸮吃掉。`);
    return;
  }
  if (state.kind === 'rice' && state.expiresAtTurn !== undefined && runtime.turnCount >= state.expiresAtTurn) {
    const owl = summon.summonerId ? runtime.fighters.find((fighter) => fighter.id === summon.summonerId) : undefined;
    if (owl && runtime.isActiveCombatant(owl)) {
      const healing = resolveHealing(owl, Math.floor(owl.maxHp * 0.1), {
        kind: 'direct',
        sourceId: '开饭',
        healer: owl,
      }, runtime.log);
      const recoveryText = healing.actual > 0
        ? `恢复 ${healing.actual} 点生命`
        : healing.outcome === 'blocked'
          ? '治疗被完全阻止'
          : '生命已满';
      runtime.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🍚 【开饭】${owl.name} 吃掉 ${summon.name}；${recoveryText}，米饭作为消耗品退场。`);
    }
    retireOwlSummon(runtime, summon);
    return;
  }
  if (state.kind === 'zhao_adou' && state.expiresAtTurn !== undefined && runtime.turnCount >= state.expiresAtTurn) {
    runtime.log('info', `🏇 【七进七出】${summon.name} 完成七回合冲阵，带着阿斗主动退场。`);
    retireOwlSummon(runtime, summon);
    return;
  }
  if (state.kind === 'spalter' && state.lockUntilTurn !== undefined && runtime.turnCount >= state.lockUntilTurn && state.dollUntilTurn === undefined) {
    removeEffects(summon, { identityIds: ['OWL_SPALTER_LOCK'], reason: 'expired' });
    delete state.lockUntilTurn;
    state.dollUntilTurn = runtime.turnCount + 3;
    summon.cannotAct = true;
    const healing = resolveHealing(summon, Math.floor(summon.maxHp * 0.3), {
      kind: 'direct',
      sourceId: '替身切换',
      healer: summon,
    }, runtime.log);
    applyStatus(summon, { identityId: 'OWL_SPALTER_DOLL', remainingTurns: 3, attribution: { effectSourceId: summon.summonerId } });
    const recoveryText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满';
    runtime.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🌊 【替身切换】${summon.name} 转入替身形态；${recoveryText}，三回合内无法行动。`);
    return;
  }
  if (state.kind === 'spalter' && state.dollUntilTurn !== undefined && runtime.turnCount >= state.dollUntilTurn) {
    delete state.dollUntilTurn;
    summon.cannotAct = false;
    removeEffects(summon, { identityIds: ['OWL_SPALTER_DOLL'], reason: 'expired' });
    runtime.log('buff', `🌊 【归溟回归】${summon.name} 从替身形态回到战场，重新开始攻击。`);
  }
}

export function processOwlGlobalTick(runtime: OwlRuntime): void {
  const snapshot = [...runtime.fighters];
  snapshot.forEach((fighter) => {
    if (fighter.isOwl && runtime.isActiveCombatant(fighter)) {
      const state = ensureOwlState(fighter, runtime.turnCount);
      tryEnterOwlDefeat(runtime, fighter);
      if (state.warForm === 'defeat' && runtime.turnCount - state.warFormStartedTurn >= 10) {
        switchOwlWarForm(runtime, fighter, 'sorrow', '败阵十回合后收拢残兵');
      } else if (state.warForm === 'sorrow' && runtime.turnCount - state.warFormStartedTurn >= 10) {
        switchOwlWarForm(runtime, fighter, 'victory', '哀兵十回合后重整旗鼓');
      }
      if (state.riverMarkExpiresTurn !== undefined && runtime.turnCount >= state.riverMarkExpiresTurn) {
        const marked = runtime.fighters.find((candidate) => candidate.id === state.riverMarkedTargetId);
        if (marked) removeEffects(marked, { identityIds: ['OWL_RIVER_MARK'], effectSourceIds: [fighter.id], reason: 'expired' });
        if (state.riverMarkedTargetId) runtime.log('info', `🌊 【过江】${fighter.name} 的协同标记到期。`);
        delete state.riverMarkedTargetId;
        delete state.riverMarkExpiresTurn;
      }
    }
    if (fighter.owlSummonState) processOwlSummonLifecycle(runtime, fighter);
  });
}

export function applyOwlRiverMark(runtime: OwlRuntime, owl: Fighter, target: Fighter): void {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.riverMarkedTargetId) {
    const previous = runtime.fighters.find((fighter) => fighter.id === state.riverMarkedTargetId);
    if (previous) removeEffects(previous, { identityIds: ['OWL_RIVER_MARK'], effectSourceIds: [owl.id], reason: 'replaced' });
  }
  state.riverMarkedTargetId = target.id;
  state.riverMarkExpiresTurn = runtime.turnCount + 5;
  applyStatus(target, { identityId: 'OWL_RIVER_MARK', remainingTurns: 5, attribution: { effectSourceId: owl.id } });
}

export function markOwlSummonDeathSave(summon: Fighter, turnCount: number): 'specter' | 'spalter' | null {
  const state = summon.owlSummonState;
  if (!state || state.deathSaveUsed) return null;
  if (state.kind !== 'specter' && state.kind !== 'spalter') return null;
  state.deathSaveUsed = true;
  state.lockUntilTurn = turnCount + 1;
  applyStatus(summon, {
    identityId: state.kind === 'specter' ? 'OWL_SPECTER_LOCK' : 'OWL_SPALTER_LOCK',
    remainingTurns: 1,
    attribution: { effectSourceId: summon.summonerId ?? summon.id, applierId: summon.summonerId },
  });
  setCurrentHp(summon, 1);
  return state.kind;
}
