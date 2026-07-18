import { cloneJobDefinition } from '../combatState';
import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { grantStatus } from '../defenseStatus';
import { isSelectableTargetFor } from '../targeting';

const WT_BACKUP_COST = 7;
const WT_CAS_COST = 5;
const WT_PRECISE_CAS_COST = 4;
const WT_SP_MAX = 8;
const WT_TOP_TIER_MAX_HP = 4580;
const WT_TOP_TIER_DEF = 261;
const WT_TOP_TIER_RES = 216;

const WT_REPAIR_STATUS_TYPES = new Set([
  'STUN',
  'FREEZE',
  'CONFUSED',
  'EMBARRASSED',
  'CHARMED',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'AIRBORNE',
  'VALO_AIM_PUNCH',
  'VALO_CYPHER_REVEALED',
  'NEURAL_THEFT_DEBUFF',
  'BABY_WEAKNESS_MARK',
  'WT_BREECH_DAMAGED',
  'WT_TRACK_DAMAGED',
  'WT_AMMO_EXPOSED',
  'ZEROED',
  'WEAK',
  'NO_HEAL',
  'BLEED',
]);

function refreshStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(fighter, type, duration, sourceId);
}

function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((status) => status.type === type);
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    isSelectableTargetFor(runtime, actor, fighter),
  );
}

function ownsSkill(actor: Fighter, skillId: string): boolean {
  return actor.jobData.skills.includes(skillId);
}

function hasRepairNeed(actor: Fighter): boolean {
  const hasBurnWithFpe = hasStatus(actor, 'BURN') && (actor.wtFpeCharges ?? 0) > 0;
  const hasPoisonWithNbcs = hasStatus(actor, 'POISON') && (actor.wtNbcsCharges ?? 0) > 0;
  return actor.hpPct < 0.42 || hasBurnWithFpe || hasPoisonWithNbcs || (actor.hpPct < 0.55 && actor.status.some((status) => WT_REPAIR_STATUS_TYPES.has(status.type)));
}

function hasMarkedLiveTarget(actor: Fighter, runtime: CharacterHookRuntime): boolean {
  return !!actor.wtMarkedTargetId && runtime.fighters.some((fighter) =>
    fighter.id === actor.wtMarkedTargetId &&
    isSelectableTargetFor(runtime, actor, fighter),
  );
}

function woundedEnemy(enemies: Fighter[]): Fighter | undefined {
  return enemies
    .filter((enemy) => enemy.hpPct < 0.38 || hasStatus(enemy, 'WT_AMMO_EXPOSED') || hasStatus(enemy, 'WT_SCOUTED'))
    .sort((a, b) => a.hpPct - b.hpPct)[0];
}

function weightedPick(items: Array<[string, number]>): string | null {
  const pool = items.filter(([, weight]) => weight > 0);
  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skill, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return skill;
  }
  return pool[pool.length - 1]?.[0] ?? null;
}

function selectTopTierSkill(actor: Fighter, runtime: CharacterHookRuntime): string | null {
  const enemies = activeEnemies(runtime, actor);
  if (enemies.length === 0) return null;

  const sp = actor.wtSpawnPoints ?? 0;
  const hasAim = hasStatus(actor, 'AIM');
  const marked = hasMarkedLiveTarget(actor, runtime);
  const wounded = woundedEnemy(enemies);
  const enemyHasCounter = enemies.some((enemy) =>
    hasStatus(enemy, 'COUNTER') ||
    hasStatus(enemy, 'WAIT_COUNTER') ||
    enemy.status.some((status) => status.type.startsWith('CTR_')),
  );

  if (ownsSkill(actor, 'wt_repair_premium') && hasRepairNeed(actor)) return 'wt_repair_premium';

  if (ownsSkill(actor, 'wt_magic_ricochet_premium') && actor.hpPct < 0.34 && Math.random() < 0.62) {
    return 'wt_magic_ricochet_premium';
  }

  if (ownsSkill(actor, 'wt_su30_cas') && sp >= (hasAim ? WT_PRECISE_CAS_COST : WT_CAS_COST)) {
    if ((hasAim || marked) && (wounded || enemies.length >= 3) && Math.random() < 0.55) return 'wt_su30_cas';
    if (enemies.length >= 5 && sp >= WT_CAS_COST && Math.random() < 0.22) return 'wt_su30_cas';
  }

  if (ownsSkill(actor, 'wt_t58_knockup') && wounded && Math.random() < (hasAim || marked ? 0.72 : 0.48)) {
    return 'wt_t58_knockup';
  }

  if (ownsSkill(actor, 'wt_laser_rangefinder') && (!hasAim || !marked)) {
    const shouldScout =
      sp < WT_CAS_COST ||
      !!wounded ||
      enemyHasCounter ||
      Math.random() < (enemies.length >= 4 ? 0.3 : 0.2);
    if (shouldScout) return 'wt_laser_rangefinder';
  }

  if (enemyHasCounter && ownsSkill(actor, 'wt_magic_ricochet_premium') && Math.random() < 0.36) {
    return 'wt_magic_ricochet_premium';
  }

  return weightedPick([
    ['wt_t58_knockup', wounded ? 22 : 13],
    ['wt_bmpt_suppress', enemies.length >= 3 ? 18 : 10],
    ['wt_apfsds', wounded ? 18 : 11],
    ['wt_laser_rangefinder', hasAim && marked ? 1 : 9],
    ['wt_magic_ricochet_premium', actor.hpPct < 0.7 ? 10 : 4],
    ['wt_su30_cas', sp >= WT_CAS_COST ? 5 : 0],
  ]);
}

export const warThunderHook: CharacterHook = {
  id: 'warThunder',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || !actor.isWT) return null;
    if (!actor.transformed) {
      if (actor.hpPct < 0.48 && ownsSkill(actor, 'wt_repair') && Math.random() < 0.6) return 'wt_repair';
      return null;
    }
    if (actor.job !== 'WT_TOP_TIER') return null;
    return selectTopTierSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const WT_TOP_TIER = runtime.jobs.WT_TOP_TIER;
    if (!fighter.isWT || !WT_TOP_TIER) return false;

    transform('WT_TOP_TIER', `🚨 【乘员昏迷 / 载具大破】\n${fighter.name} 原下载具被毁！气得一拳砸碎键盘："防空车呢？！我直接上顶级备用载具！"\n🚜 重装巨兽降临！转职为【${WT_TOP_TIER.name}】，满挂爆反装甲接管战区！`, () => {
      fighter.maxHp = WT_TOP_TIER_MAX_HP;
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 275;
      fighter.def = WT_TOP_TIER_DEF;
      fighter.res = WT_TOP_TIER_RES;
      fighter.spd = 120;
      fighter.agl = 90;
      fighter.wis = 180;
      fighter.mag = 50;
      fighter.wtSpawnPoints = Math.max(1, fighter.wtSpawnPoints ?? 0);
      fighter.wtFpeCharges = 2;
      fighter.wtNbcsCharges = 1;
      fighter.wtBackupUsed = false;
      fighter.wtKillStreak = 0;
      fighter.wtMarkedTargetId = undefined;
      refreshStatus(fighter, 'WT_ERA', 999);
      refreshStatus(fighter, 'SPELL_BLOCK', 1, 'war_thunder_top_tier_spawn');
    });
    return true;
  },

  onReviveCheck: ({ fighter, runtime }) => {
    if (!fighter.isWT || !fighter.isDead || !fighter.transformed || fighter.wtBackupUsed) return false;
    if ((fighter.wtSpawnPoints ?? 0) < WT_BACKUP_COST) return false;

    const WT_TOP_TIER = runtime.jobs.WT_TOP_TIER;
    fighter.wtSpawnPoints = Math.max(0, (fighter.wtSpawnPoints ?? 0) - WT_BACKUP_COST);
    fighter.wtBackupUsed = true;
    fighter.isDead = false;
    fighter.isDeadAnnounced = false;
    fighter.defeatHooksResolved = false;
    fighter.job = 'WT_TOP_TIER';
    if (WT_TOP_TIER) fighter.jobData = cloneJobDefinition(WT_TOP_TIER);
    fighter.maxHp = WT_TOP_TIER_MAX_HP;
    fighter.currentHp = Math.floor(fighter.maxHp * 0.45);
    fighter.atk = 275;
    fighter.def = WT_TOP_TIER_DEF;
    fighter.res = WT_TOP_TIER_RES;
    fighter.spd = 120;
    fighter.agl = 90;
    fighter.wis = 180;
    fighter.mag = 50;
    fighter.status = [];
    refreshStatus(fighter, 'WT_ERA', 999);
    refreshStatus(fighter, 'INVUL', 1, 'war_thunder_backup_vehicle');
    refreshStatus(fighter, 'BKB', 1, 'war_thunder_backup_vehicle');
    refreshStatus(fighter, 'SPELL_BLOCK', 1, 'war_thunder_backup_vehicle');
    refreshStatus(fighter, 'REGEN', 2);
    fighter.wtFpeCharges = Math.max(fighter.wtFpeCharges ?? 0, 1);
    fighter.wtNbcsCharges = Math.max(fighter.wtNbcsCharges ?? 0, 1);

    runtime.syncHpPct(fighter);
    runtime.log('buff', `🚜 【备用载具】${fighter.name} 消耗 ${WT_BACKUP_COST} SP 重新部署顶级备用载具，带着入场保护、烟幕与临时作战抗性回到战场！（当前 SP ${fighter.wtSpawnPoints ?? 0}/${WT_SP_MAX}）`);

    const revengeTarget = runtime.fighters.find((candidate) =>
      candidate.id === fighter.lastDamage?.attackerId &&
      isSelectableTargetFor(runtime, fighter, candidate),
    );
    if (revengeTarget) {
      fighter.wtMarkedTargetId = revengeTarget.id;
      refreshStatus(revengeTarget, 'WT_SCOUTED', 3);
      runtime.log('info', `🔭 【复仇标记】${fighter.name} 的新车刚出出生点就锁定了 ${revengeTarget.name} 的方位！`);
    }
    return true;
  },
};
