import type {
  Fighter,
  JobDefinition,
  OwlSummonKind,
  OwlWarForm,
  StatKey,
  StatusApplicationOptions,
} from './types';
import { cloneJobDefinition, healFighter, setCurrentHp } from './combatState';
import { grantStatus } from './defenseStatus';
import { REVIVE_CLEAN_STATUS_TYPES } from './statusRules';
import {
  applyPermanentStatBuff,
  applyTimedStatModifier,
  makeTimedStatModifier,
  removeTimedStatModifier,
  withTimedStatModifiersSuspended,
} from './statModifiers';

export interface OwlRuntime {
  fighters: Fighter[];
  jobs: Partial<Record<string, JobDefinition>>;
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  log: (type: string, text: string) => void;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage?: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: import('./types').DamageApplicationOptions,
  ) => number;
  applyStatus?: (target: Fighter, type: string, duration: number, options?: StatusApplicationOptions) => boolean;
  markDefeated?: (target: Fighter, options?: import('./types').DefeatOptions) => boolean;
  flushDeferredDamageEvents?: (fighter: Fighter) => void;
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

const OWL_FORM_MODIFIER_ID = 'owl-war-form';
const OWL_FORM_STAT_BUFFS: Partial<Record<OwlWarForm, Partial<Record<StatKey, number>>>> = {
  victory: { atk: 1.08, def: 1.08, spd: 1.08, agl: 1.08, mag: 1.08, res: 1.08, wis: 1.08 },
  pride: { def: 0.55, res: 0.55 },
};

export const OWL_HEAVEN_MAX = 7;
export const OWL_WILD_MAX = 5;

function uniqueSummonName(runtime: Pick<OwlRuntime, 'fighters'>, baseName: string): string {
  const count = runtime.fighters.filter((fighter) =>
    fighter.isSummon && (fighter.summonBaseName ?? fighter.name) === baseName,
  ).length;
  return count === 0 ? baseName : `${baseName}#${count + 1}`;
}

function createId(kind: OwlSummonKind, runtime: Pick<OwlRuntime, 'turnCount' | 'fighters'>): string {
  return `owl-${kind}-${runtime.turnCount}-${runtime.fighters.length}-${Math.random().toString(36).slice(2, 9)}`;
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
    status: [],
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
  runtime.fighters.push(summon);
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
  if (!owl.status.some((status) => status.type === formStatus)) {
    const duration = warForm === 'defeat' || warForm === 'sorrow' ? 10 : 999;
    grantStatus(owl, formStatus, duration, owl.id);
  }
  const statBuff = OWL_FORM_STAT_BUFFS[warForm];
  if (statBuff && !owl.timedStatModifiers?.some((modifier) => modifier.id === OWL_FORM_MODIFIER_ID)) {
    applyTimedStatModifier(owl, makeTimedStatModifier(OWL_FORM_MODIFIER_ID, formStatus, statBuff, owl.id));
  }
  return owl.owlState;
}

function clearOwlForm(owl: Fighter): void {
  owl.status = owl.status.filter((status) => !Object.values(OWL_FORM_STATUS).includes(status.type));
  removeTimedStatModifier(owl, OWL_FORM_MODIFIER_ID);
}

export function switchOwlWarForm(runtime: OwlRuntime, owl: Fighter, next: OwlWarForm, reason: string): boolean {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.warForm === next) return false;
  const previous = state.warForm;
  clearOwlForm(owl);
  state.warForm = next;
  state.warFormStartedTurn = runtime.turnCount;
  const statusType = OWL_FORM_STATUS[next];
  grantStatus(owl, statusType, next === 'defeat' || next === 'sorrow' ? 10 : 999, owl.id);
  const statBuff = OWL_FORM_STAT_BUFFS[next];
  if (statBuff) {
    applyTimedStatModifier(owl, makeTimedStatModifier(OWL_FORM_MODIFIER_ID, statusType, statBuff, owl.id));
  }
  if (next === 'sorrow') {
    owl.status = owl.status.filter((status) =>
      status.type === statusType || !REVIVE_CLEAN_STATUS_TYPES.includes(status.type),
    );
    const healed = healFighter(owl, Math.floor(owl.maxHp * 0.3), runtime.log);
    runtime.log('heal', healed > 0
      ? `🕯️ 【哀兵】${owl.name} 清除全部异常与减益，恢复 ${healed} 点生命！`
      : `🕯️ 【哀兵】${owl.name} 清除全部异常与减益；生命已经全满。`);
  }
  runtime.log('buff', `🦉 【天意侵蚀】${owl.name} 由【${OWL_FORM_NAMES[previous]}】转入【${OWL_FORM_NAMES[next]}】：${reason}。`);
  return true;
}

export function getOwlOutgoingMultiplier(attacker?: Fighter): number {
  if (!attacker?.isOwl) return 1;
  const form = ensureOwlState(attacker).warForm;
  if (form === 'victory') return 1.35;
  if (form === 'sorrow') return 1.2;
  return 1;
}

export function getOwlIncomingMultiplier(target: Fighter): number {
  if (!target.isOwl) return 1;
  const state = ensureOwlState(target);
  let multiplier = state.warForm === 'defeat' ? 0.15 : state.phase === 2 ? 0.75 : 1;
  if (target.status.some((status) => status.type === 'OWL_EAR_GUARD')) multiplier *= 0.75;
  return multiplier;
}

export function owlResistsHostileStatus(target: Fighter): boolean {
  return !!target.isOwl && ensureOwlState(target).warForm === 'defeat' && Math.random() < 0.85;
}

export function enterOwlPrideAfterKill(runtime: OwlRuntime, killer?: Fighter): void {
  if (!killer) return;
  const owl = killer.isOwl
    ? killer
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
  owl.maxHp = Math.max(3100, Math.min(3700, Math.floor(owl.maxHp * 6.3)));
  owl.currentHp = owl.maxHp;
  withTimedStatModifiersSuspended(owl, () => {
    owl.atk = scaleStat(owl.atk, 4.4, 190);
    owl.def = scaleStat(owl.def, 5.5, 165);
    owl.spd = scaleStat(owl.spd, 5.8, 135);
    owl.agl = scaleStat(owl.agl, 5.0, 120);
    owl.mag = scaleStat(owl.mag, 5.0, 210);
    owl.res = scaleStat(owl.res, 5.5, 180) + 10;
    owl.wis = scaleStat(owl.wis, 5.0, 195);
  });
  ensureOwlState(owl).phase = 2;
  grantStatus(owl, 'OWL_ACID_FEARLESS', 999, owl.id);
}

export function releaseOwlPhaseTwoLightning(runtime: OwlRuntime, owl: Fighter): void {
  if (!runtime.applyDamage) return;
  const targets = runtime.fighters.filter((target) =>
    target.id !== owl.id &&
    runtime.isActiveCombatant(target) &&
    !target.status.some((status) => status.type === 'SYNERGY_SLACKING') &&
    !(target.isPuruisaishi && (target.puruisaishiPhase ?? 1) <= 1) &&
    (target.untargetableUntilTurn ?? -1) < runtime.turnCount,
  );
  const raw = Math.max(80, Math.floor(owl.mag * 0.72 + owl.wis * 0.28));
  runtime.log('skill', `⚡ 【煮酒惊雷】${owl.name}：“这雷把我吓死了！”雷光席卷全场！`);
  targets.forEach((target) => {
    const damageOptions: import('./types').DamageApplicationOptions = {
      actionName: '煮酒惊雷',
      respectDefenses: true,
      suppressOwlCooperation: true,
      deferTransform: true,
    };
    const actual = runtime.applyDamage?.(target, raw, 'skill', false, owl, damageOptions) ?? 0;
    const redirected = !!(
      damageOptions.redirectedByJoker ||
      damageOptions.redirectedByOriginiumCore ||
      damageOptions.redirectedByOwlEmperor
    );
    if (!redirected) {
      runtime.log(
        actual > 0 ? 'skill' : 'info',
        actual > 0
          ? `⚡ 雷击命中 ${target.name}，实际造成 ${actual} 点伤害。`
          : `⚡ ${target.name} 挡下或化解了雷击，未受到生命伤害。`,
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
    hp: 3600, atk: 260, def: 145, spd: 135, agl: 100, mag: 260, res: 145, wis: 150,
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
  grantStatus(emperor, 'OWL_WILD', 999, owl.id);
  const wildStatus = emperor.status.find((status) => status.type === 'OWL_WILD' && status.sourceId === owl.id);
  if (wildStatus) wildStatus.displayDesc = `撒野 ${next}/${OWL_WILD_MAX} 层：攻击与速度提高`;
  return next;
}

export function enterOwlPhaseThree(runtime: OwlRuntime, owl: Fighter): boolean {
  const state = ensureOwlState(owl, runtime.turnCount);
  if (state.phase >= 3 || !runtime.isActiveCombatant(owl)) return false;
  const nextJob = runtime.jobs.OWL_DRAGON_SOVEREIGN;
  if (!nextJob) return false;
  const hpRatio = owl.maxHp > 0 ? owl.currentHp / owl.maxHp : 1;
  withTimedStatModifiersSuspended(owl, () => {
    owl.maxHp = Math.max(3900, Math.min(4700, Math.floor(owl.maxHp * 1.25)));
    owl.currentHp = Math.max(1, Math.floor(owl.maxHp * Math.max(0.5, hpRatio)));
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
    if (marked) marked.status = marked.status.filter((status) => !(status.type === 'OWL_RIVER_MARK' && status.sourceId === owl.id));
  }
  delete state.riverMarkedTargetId;
  delete state.riverMarkExpiresTurn;
  applyPermanentStatBuff(owl, { atk: 1.18 });
  grantStatus(owl, 'OWL_IMPERIAL_SEAL', 999, owl.id);
  const emperor = spawnOwlEmperor(runtime, owl);
  runtime.syncHpPct(owl);
  runtime.log('transform', `🐉 【天意七重】${owl.name}：“恭喜爹可以撑地了！”转入第三阶段【${nextJob.name}】，玉玺入手并召唤 ${emperor.name}！`);
  return true;
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
    withTimedStatModifiersSuspended(owl, () => {
      const hpGain = Math.max(1, Math.floor(fallen.maxHp * 0.1));
      owl.maxHp += hpGain;
      owl.currentHp += hpGain;
      gains.push(`血+${hpGain}`);
      INHERITED_STATS.forEach((key) => {
        const gain = Math.max(1, Math.floor(fallen[key] * 0.1));
        owl[key] += gain;
        gains.push(`${key}+${gain}`);
      });
    });
    state.heavenStacks = Math.min(OWL_HEAVEN_MAX, state.heavenStacks + 1);
    runtime.syncHpPct(owl);
    runtime.log('buff', `🦉 【不可能！】${owl.name}：“我二弟天下无敌！”继承 ${fallen.name} 10% 数值（${gains.join(' / ')}），天意 ${state.heavenStacks}/${OWL_HEAVEN_MAX}。`);
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
  const healed = healFighter(yuzu, Math.floor(yuzu.maxHp * 0.1), log);
  const index = fighters.findIndex((fighter) => fighter.id === food.id);
  if (index >= 0) fighters.splice(index, 1);
  log('heal', healed > 0
    ? `🥄 【顺手加餐】${yuzu.name} 又吃掉 ${kindName}，额外恢复 ${healed} 点生命；这次消耗退场不计死亡。`
    : `🥄 【顺手加餐】${yuzu.name} 又吃掉 ${kindName}；生命已满，这次消耗退场不计死亡。`);
  return healed;
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
      const healed = healFighter(owl, Math.floor(owl.maxHp * 0.1), runtime.log);
      runtime.log('heal', healed > 0
        ? `🍚 【开饭】${owl.name} 吃掉 ${summon.name}，恢复 ${healed} 点生命；米饭作为消耗品退场。`
        : `🍚 【开饭】${owl.name} 吃掉 ${summon.name}；生命已满，米饭作为消耗品退场。`);
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
    summon.status = summon.status.filter((status) => status.type !== 'OWL_SPALTER_LOCK');
    delete state.lockUntilTurn;
    state.dollUntilTurn = runtime.turnCount + 3;
    summon.cannotAct = true;
    const healed = healFighter(summon, Math.floor(summon.maxHp * 0.3), runtime.log);
    grantStatus(summon, 'OWL_SPALTER_DOLL', 3, summon.summonerId);
    runtime.log('heal', healed > 0
      ? `🌊 【替身切换】${summon.name} 转入替身形态，恢复 ${healed} 点生命，三回合内无法行动。`
      : `🌊 【替身切换】${summon.name} 转入替身形态；生命已满，三回合内无法行动。`);
    return;
  }
  if (state.kind === 'spalter' && state.dollUntilTurn !== undefined && runtime.turnCount >= state.dollUntilTurn) {
    delete state.dollUntilTurn;
    summon.cannotAct = false;
    summon.status = summon.status.filter((status) => status.type !== 'OWL_SPALTER_DOLL');
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
        if (marked) marked.status = marked.status.filter((status) => !(status.type === 'OWL_RIVER_MARK' && status.sourceId === fighter.id));
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
    if (previous) previous.status = previous.status.filter((status) => !(status.type === 'OWL_RIVER_MARK' && status.sourceId === owl.id));
  }
  state.riverMarkedTargetId = target.id;
  state.riverMarkExpiresTurn = runtime.turnCount + 5;
  grantStatus(target, 'OWL_RIVER_MARK', 5, owl.id);
}

export function markOwlSummonDeathSave(summon: Fighter, turnCount: number): 'specter' | 'spalter' | null {
  const state = summon.owlSummonState;
  if (!state || state.deathSaveUsed) return null;
  if (state.kind !== 'specter' && state.kind !== 'spalter') return null;
  state.deathSaveUsed = true;
  state.lockUntilTurn = turnCount + 1;
  grantStatus(summon, state.kind === 'specter' ? 'OWL_SPECTER_LOCK' : 'OWL_SPALTER_LOCK', 1, summon.summonerId);
  setCurrentHp(summon, 1);
  return state.kind;
}
