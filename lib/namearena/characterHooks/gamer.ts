import { COMMON_NEGATIVE_STATUS_TYPES, isStatusType } from '../statusRules';
import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { grantStatus } from '../defenseStatus';
import { isSelectableTargetFor } from '../targeting';

type GamerRuntime = Pick<CharacterHookRuntime, 'fighters' | 'turnCount' | 'getTeamId' | 'isActiveCombatant' | 'jobs' | 'log'>;

const MAX_APM = 12;
const WORLD_STAGE_THRESHOLD = 11;
const WORLD_STAGE_DURATION = 2;

const CHAMPION_SKILL_COST: Record<string, number> = {
  gamer_headshot_line: 2,
  gamer_perfect_parry: 2,
  gamer_estus_cancel: 2,
  gamer_tactical_pause: 3,
  gamer_wombo_combo: 3,
  gamer_crack_confirm: 3,
  gamer_qte_execute: 3,
  gamer_speedrun_route: 1,
  gamer_resource_macro: 0,
  gamer_read_inputs: 2,
  gamer_clutch_ace: 4,
  gamer_world_combo: 6,
};

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

function isOriginalGamer(actor: Fighter): boolean {
  return Boolean(actor.isGamer && !actor.isSon && (actor.job === 'HIGH_END_GAMER' || actor.job === 'ALL_PLATFORM_CHAMPION'));
}

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(fighter, type, duration, sourceId);
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function enterWorldStage(actor: Fighter, runtime: Pick<GamerRuntime, 'log'>, reason: string): void {
  if (actor.job !== 'ALL_PLATFORM_CHAMPION' || actor.hasUsedGamerWorldStage) return;
  actor.hasUsedGamerWorldStage = true;
  actor.gamerBoostReady = true;
  refreshStatus(actor, 'GAMER_WORLD_STAGE', WORLD_STAGE_DURATION);
  refreshStatus(actor, 'BKB', 1, 'gamer_world_stage');
  runtime.log('crit', `🏆 【世界赛舞台】${actor.name} APM 拉到 ${actor.apm ?? 0}/${MAX_APM}，${reason}，所有冠军技能短暂进入强化版！`);
}

function gainApm(actor: Fighter, amount = 1, runtime?: Pick<GamerRuntime, 'log'>, reason?: string): void {
  const before = actor.apm ?? 0;
  actor.apm = Math.min(MAX_APM, before + amount);
  if (runtime && reason && actor.apm > before && actor.job === 'ALL_PLATFORM_CHAMPION') {
    const crossedWorldStage = before < WORLD_STAGE_THRESHOLD && actor.apm >= WORLD_STAGE_THRESHOLD;
    if (crossedWorldStage) {
      enterWorldStage(actor, runtime, reason);
    }
  }
}

function getEnemies(actor: Fighter, runtime: Pick<GamerRuntime, 'fighters' | 'turnCount' | 'getTeamId' | 'isActiveCombatant'>): Fighter[] {
  return runtime.fighters.filter((candidate) =>
    isSelectableTargetFor(runtime, actor, candidate),
  );
}

function getAllies(actor: Fighter, runtime: Pick<GamerRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant'>): Fighter[] {
  const actorTeamId = runtime.getTeamId(actor);
  return runtime.fighters.filter((candidate) =>
    candidate.id !== actor.id &&
    runtime.isActiveCombatant(candidate) &&
    runtime.getTeamId(candidate) === actorTeamId,
  );
}

function hasCommonNegativeStatus(fighter: Fighter): boolean {
  return fighter.status.some((status) => isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
}

function effectiveCost(actor: Fighter, skillId: string): number {
  const baseCost = CHAMPION_SKILL_COST[skillId] ?? 0;
  if (baseCost <= 0) return 0;
  const worldDiscount = hasStatus(actor, 'GAMER_WORLD_STAGE') ? 1 : 0;
  const bufferDiscount = Math.min(actor.gamerInputBuffer ?? 0, 1);
  return Math.max(1, baseCost - worldDiscount - bufferDiscount);
}

function canAfford(actor: Fighter, skillId: string): boolean {
  return (actor.apm ?? 0) >= effectiveCost(actor, skillId);
}

function lowHealthEnemy(enemies: Fighter[]): Fighter | undefined {
  return enemies
    .filter((enemy) => enemy.hpPct <= 0.42 || enemy.currentHp <= Math.max(900, enemy.maxHp * 0.34))
    .sort((a, b) => a.currentHp - b.currentHp)[0];
}

function markedEnemy(actor: Fighter, enemies: Fighter[]): Fighter | undefined {
  const markedId = actor.gamerMarkedTargetId;
  if (!markedId) return undefined;
  return enemies.find((enemy) => enemy.id === markedId);
}

function pickWeighted(items: Array<[string, number]>): string {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [skillId, weight] of items) {
    roll -= weight;
    if (roll <= 0) return skillId;
  }
  return items[items.length - 1]?.[0] ?? 'gamer_resource_macro';
}

function affordableWeightedPool(actor: Fighter, items: Array<[string, number]>): Array<[string, number]> {
  return items.filter(([skillId]) => canAfford(actor, skillId));
}

function selectChampionSkill(actor: Fighter, runtime: GamerRuntime): string {
  const enemies = getEnemies(actor, runtime);
  const allies = getAllies(actor, runtime);
  const apm = actor.apm ?? 0;
  const isWorldStage = hasStatus(actor, 'GAMER_WORLD_STAGE');
  const isClutch =
    actor.hpPct <= 0.45 ||
    enemies.length <= 3 ||
    (actor.gamerClutchWindow ?? 0) > 0 ||
    allies.length === 0 && enemies.length <= 4 && actor.hpPct <= 0.62;
  const hasMarkedEnemy = Boolean(markedEnemy(actor, enemies));
  const woundedEnemy = lowHealthEnemy(enemies);

  if (apm >= WORLD_STAGE_THRESHOLD) {
    enterWorldStage(actor, runtime, '终于抓到接管比赛的窗口');
  }

  if (isWorldStage && !actor.hasUsedGamerChampionCombo && canAfford(actor, 'gamer_world_combo') && Math.random() < 0.45) {
    return 'gamer_world_combo';
  }

  if (hasCommonNegativeStatus(actor) && canAfford(actor, 'gamer_estus_cancel') && !hasStatus(actor, 'NO_HEAL')) return 'gamer_estus_cancel';
  if (actor.hpPct < 0.34 && canAfford(actor, 'gamer_estus_cancel') && !hasStatus(actor, 'NO_HEAL')) return 'gamer_estus_cancel';

  if (apm <= 1 && !isWorldStage) return 'gamer_resource_macro';
  if (apm <= 2 && Math.random() < 0.7 && !isWorldStage) return 'gamer_resource_macro';

  if (isClutch && canAfford(actor, 'gamer_clutch_ace') && Math.random() < (isWorldStage ? 0.53 : 0.355)) {
    return 'gamer_clutch_ace';
  }

  if (hasMarkedEnemy && canAfford(actor, 'gamer_crack_confirm') && Math.random() < 0.72) return 'gamer_crack_confirm';
  if (woundedEnemy && canAfford(actor, 'gamer_headshot_line') && Math.random() < 0.68) return 'gamer_headshot_line';
  if (woundedEnemy && canAfford(actor, 'gamer_crack_confirm') && Math.random() < 0.55) return 'gamer_crack_confirm';

  if (enemies.length >= 3 && canAfford(actor, 'gamer_wombo_combo') && Math.random() < (isWorldStage ? 0.67 : 0.515)) {
    return 'gamer_wombo_combo';
  }
  if (enemies.some((enemy) => !hasStatus(enemy, 'STUN')) && canAfford(actor, 'gamer_tactical_pause') && Math.random() < 0.34) {
    return 'gamer_tactical_pause';
  }
  if (canAfford(actor, 'gamer_perfect_parry') && actor.hpPct < 0.68 && Math.random() < 0.38) return 'gamer_perfect_parry';
  if (canAfford(actor, 'gamer_read_inputs') && Math.random() < 0.32) return 'gamer_read_inputs';
  if (canAfford(actor, 'gamer_speedrun_route') && Math.random() < 0.32) return 'gamer_speedrun_route';

  const weightedPool = affordableWeightedPool(actor, [
    ['gamer_headshot_line', woundedEnemy ? 22 : 12],
    ['gamer_wombo_combo', enemies.length >= 3 ? 20 : 8],
    ['gamer_tactical_pause', 12],
    ['gamer_read_inputs', 11],
    ['gamer_perfect_parry', actor.hpPct < 0.7 ? 12 : 6],
    ['gamer_speedrun_route', 10],
    ['gamer_resource_macro', apm <= 3 ? 15 : 4],
  ]);

  if (weightedPool.length > 0) return pickWeighted(weightedPool);

  return 'gamer_resource_macro';
}

function transformBonusText(apm: number): string {
  if (apm >= 10) return `APM ${apm} 已经拉满，直接进入世界赛模式！`;
  if (apm >= 7) return `APM ${apm} 积累到高光区间，锁定关键操作！`;
  if (apm >= 4) return `APM ${apm} 进入竞技状态，启动更长的防打断窗口！`;
  return `APM ${apm} 被迫启动，先用开局无敌帧稳住血线！`;
}

export const gamerHook: CharacterHook = {
  id: 'gamer',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || !isOriginalGamer(actor)) return null;

    gainApm(actor, 1, runtime, '通过自身行动把节奏拉满');
    if (actor.job !== 'ALL_PLATFORM_CHAMPION') return null;

    return selectChampionSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const ALL_PLATFORM_CHAMPION = runtime.jobs.ALL_PLATFORM_CHAMPION;
    if (!isOriginalGamer(fighter) || fighter.job !== 'HIGH_END_GAMER' || !ALL_PLATFORM_CHAMPION) return false;

    const apmBeforeTransform = fighter.apm ?? 0;
    transform('ALL_PLATFORM_CHAMPION', `🎮 ${fighter.name} 血线跌破半场线，但操作没有断！${transformBonusText(apmBeforeTransform)}转职为【${ALL_PLATFORM_CHAMPION.name}】！`, () => {
      fighter.maxHp = Math.max(3650, Math.min(4125, Math.floor(fighter.maxHp * 3.38)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = scaleStat(fighter.atk, 4.64, 262);
      fighter.mag = scaleStat(fighter.mag, 4.64, 262);
      fighter.def = scaleStat(fighter.def, 4.26, 203);
      fighter.res = scaleStat(fighter.res, 4.26, 203);
      fighter.spd = scaleStat(fighter.spd, 4.38, 203);
      fighter.agl = scaleStat(fighter.agl, 4.38, 203);
      fighter.wis = scaleStat(fighter.wis, 3.9, 230);
      fighter.apm = Math.min(MAX_APM, Math.max(7, apmBeforeTransform + 3));
      fighter.gamerMastery = Math.max(fighter.gamerMastery ?? 0, 1);
      fighter.gamerInputBuffer = Math.max(fighter.gamerInputBuffer ?? 0, 1);
      fighter.gamerBoostReady = true;
      fighter.gamerClutchWindow = Math.max(fighter.gamerClutchWindow ?? 0, 2);
      fighter.gamerInstantActionQueued = true;
      fighter.hasUsedGamerTransformAction = true;

      fighter.status = fighter.status.filter((status) => !isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
      refreshStatus(fighter, 'BKB', 1, 'gamer_clutch_focus');
      refreshStatus(fighter, 'REGEN', 2);
      refreshStatus(fighter, 'SPELL_BLOCK', 1, 'gamer_clutch_focus');
      if (apmBeforeTransform >= 5) refreshStatus(fighter, 'AIM', 2);
      if ((fighter.apm ?? 0) >= WORLD_STAGE_THRESHOLD) {
        enterWorldStage(fighter, runtime, '半血变身时已经完成手感预热');
      }
    });
    return true;
  },
};
