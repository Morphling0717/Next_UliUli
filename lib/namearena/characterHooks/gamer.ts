import { COMMON_NEGATIVE_STATUS_TYPES, isStatusType } from '../statusRules';
import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';

type GamerRuntime = Pick<CharacterHookRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant' | 'jobs' | 'log'>;

const MAX_APM = 12;

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

function isOriginalGamer(actor: Fighter): boolean {
  return Boolean(actor.isGamer && !actor.isSon && (actor.job === 'HIGH_END_GAMER' || actor.job === 'ALL_PLATFORM_CHAMPION'));
}

function gainApm(actor: Fighter, amount = 1): void {
  actor.apm = Math.min(MAX_APM, (actor.apm ?? 0) + amount);
}

function getEnemies(actor: Fighter, runtime: Pick<GamerRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant'>): Fighter[] {
  const actorTeamId = runtime.getTeamId(actor);
  return runtime.fighters.filter((candidate) =>
    candidate.id !== actor.id &&
    runtime.isActiveCombatant(candidate) &&
    runtime.getTeamId(candidate) !== actorTeamId,
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

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function hasCommonNegativeStatus(fighter: Fighter): boolean {
  return fighter.status.some((status) => isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
}

function selectChampionSkill(actor: Fighter, runtime: GamerRuntime): string {
  const enemies = getEnemies(actor, runtime);
  const allies = getAllies(actor, runtime);
  const apm = actor.apm ?? 0;

  if (apm >= 5 && hasStatus(actor, 'GAMER_WORLD_STAGE') && Math.random() < 0.4) return 'gamer_world_combo';
  if (allies.length === 0 && enemies.length >= 2 && actor.hpPct < 0.8 && apm >= 3 && Math.random() < 0.8) {
    return 'gamer_clutch_ace';
  }
  if (hasCommonNegativeStatus(actor) && apm >= 2 && !hasStatus(actor, 'NO_HEAL')) return 'gamer_estus_cancel';
  if (actor.hpPct < 0.55 && apm >= 2 && !hasStatus(actor, 'NO_HEAL')) return 'gamer_estus_cancel';
  if (enemies.some((enemy) => enemy.currentHp / enemy.maxHp < 0.45) && apm >= 4 && Math.random() < 0.65) {
    return 'gamer_qte_execute';
  }
  if (enemies.length >= 2 && apm >= 3 && Math.random() < 0.5) return 'gamer_wombo_combo';
  if (enemies.some((enemy) => !hasStatus(enemy, 'STUN')) && apm >= 2 && Math.random() < 0.35) return 'gamer_tactical_pause';
  if (apm >= 3 && Math.random() < 0.3) return 'gamer_read_inputs';
  if (apm >= 2 && Math.random() < 0.3) return 'gamer_speedrun_route';

  const basicPool = ['gamer_headshot_line', 'gamer_perfect_parry', 'awp_shot', 'waterfowl', 'judgment_cut'];
  return basicPool[Math.floor(Math.random() * basicPool.length)] ?? 'gamer_headshot_line';
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

    gainApm(actor);
    if (actor.job !== 'ALL_PLATFORM_CHAMPION') return null;

    return selectChampionSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const ALL_PLATFORM_CHAMPION = runtime.jobs.ALL_PLATFORM_CHAMPION;
    if (!isOriginalGamer(fighter) || fighter.job !== 'HIGH_END_GAMER' || !ALL_PLATFORM_CHAMPION) return false;

    const apmBeforeTransform = fighter.apm ?? 0;
    transform('ALL_PLATFORM_CHAMPION', `🎮 ${fighter.name} 血线跌破半场线，但操作没有断！${transformBonusText(apmBeforeTransform)}转职为【${ALL_PLATFORM_CHAMPION.name}】！`, () => {
      fighter.maxHp = Math.max(3200, Math.min(3700, Math.floor(fighter.maxHp * 3.15)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = scaleStat(fighter.atk, 4.5, 240);
      fighter.mag = scaleStat(fighter.mag, 4.5, 240);
      fighter.def = scaleStat(fighter.def, 3.8, 165);
      fighter.res = scaleStat(fighter.res, 3.8, 165);
      fighter.spd = scaleStat(fighter.spd, 4.2, 175);
      fighter.agl = scaleStat(fighter.agl, 4.2, 175);
      fighter.wis = scaleStat(fighter.wis, 3.6, 200);
      fighter.apm = Math.min(MAX_APM, apmBeforeTransform + 2);

      fighter.status = fighter.status.filter((status) => !isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
      fighter.status.push({ type: 'BKB', duration: apmBeforeTransform >= 4 ? 2 : 1 });
      if (apmBeforeTransform >= 7) fighter.status.push({ type: 'AIM', duration: 2 });
      if (apmBeforeTransform >= 10) fighter.status.push({ type: 'GAMER_WORLD_STAGE', duration: 4 });
    });
    return true;
  },
};
