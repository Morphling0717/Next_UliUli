import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { grantStatus } from '../defenseStatus';
import { isCompetitiveTarget, isSelectableTargetFor } from '../targeting';

const VALO_ULT_THRESHOLD = 5;
const VALO_CLUTCH_ULT_THRESHOLD = 5;
const VALO_OPERATOR_ECONOMY = 6;
const VALO_FOCUS_MAX = 10;

const VALO_ULTS = [
  'valo_ult_showstopper', 'valo_ult_blade_storm', 'valo_ult_cosmic_divide',
  'valo_ult_resurrection', 'valo_ult_lockdown', 'valo_ult_vipers_pit',
  'valo_ult_empress', 'valo_ult_hunters_fury', 'valo_ult_null_cmd',
  'valo_ult_run_it_back', 'valo_ult_orbital_strike', 'valo_ult_neural_theft',
];

const VALO_ULT_DISPLAY_NAMES: Record<string, string> = {
  valo_ult_showstopper: '晚安火炮',
  valo_ult_blade_storm: '飓刃',
  valo_ult_cosmic_divide: '宇宙分裂',
  valo_ult_resurrection: '复活',
  valo_ult_lockdown: '全面封锁',
  valo_ult_vipers_pit: '蝰蛇神殿',
  valo_ult_empress: '女皇神威',
  valo_ult_hunters_fury: '狂猎之怒',
  valo_ult_null_cmd: '全面压制',
  valo_ult_run_it_back: '再火一回',
  valo_ult_orbital_strike: '天降以此',
  valo_ult_neural_theft: '神经取缔',
};

type ValorantRuntime = Pick<CharacterHookRuntime, 'fighters' | 'turnCount' | 'getTeamId' | 'isActiveCombatant' | 'log'>;

function hasStatus(actor: Fighter, type: string): boolean {
  return actor.status.some((status) => status.type === type);
}

function refreshStatus(actor: Fighter, type: string, duration: number, sourceId?: string): void {
  grantStatus(actor, type, duration, sourceId);
}

function activeEnemies(actor: Fighter, runtime: ValorantRuntime): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    isSelectableTargetFor(runtime, actor, fighter),
  );
}

function gainFocus(actor: Fighter, amount: number): void {
  actor.crosshairFocus = Math.min(VALO_FOCUS_MAX, Math.max(0, (actor.crosshairFocus ?? 0) + amount));
}

function spendFocus(actor: Fighter, amount: number, runtime: ValorantRuntime, reason: string): boolean {
  if ((actor.crosshairFocus ?? 0) < amount) return false;
  actor.crosshairFocus = Math.max(0, (actor.crosshairFocus ?? 0) - amount);
  runtime.log('buff', `🎯 【准星专注】${actor.name} 消耗 ${amount} 层专注${reason}！（剩余 ${actor.crosshairFocus}/${VALO_FOCUS_MAX}）`);
  return true;
}

function restoreOperatorMobility(actor: Fighter, runtime: ValorantRuntime, reason: string): void {
  if (!actor.savedSpd) return;
  actor.spd = actor.savedSpd;
  actor.agl = actor.savedAgl ?? actor.agl;
  delete actor.savedSpd;
  delete actor.savedAgl;
  actor.status = actor.status.filter((status) => status.type !== 'VALO_OPERATOR_PENALTY');
  runtime.log('info', `🧭 【身位重置】${actor.name} ${reason}，摆脱冥驹笨重，速度与闪避恢复！`);
}

function restoreExpiredOperatorPenalty(actor: Fighter, runtime: ValorantRuntime): void {
  if (!actor.savedSpd) return;
  if (hasStatus(actor, 'VALO_OPERATOR_PENALTY')) return;
  restoreOperatorMobility(actor, runtime, '完成转点');
}

function enterClutch(actor: Fighter, runtime: ValorantRuntime, reason: string, protectedEntry = false): void {
  const wasClutching = hasStatus(actor, 'VALO_CLUTCH');
  refreshStatus(actor, 'VALO_CLUTCH', 3);
  if (protectedEntry && !wasClutching) refreshStatus(actor, 'SPELL_BLOCK', 1, 'valo_reposition');
  restoreOperatorMobility(actor, runtime, '进入残局重新拉枪线');
  if (!wasClutching) {
    runtime.log('buff', `🎯 【残局模式】${actor.name} ${reason}，进入 clutch 状态，准星专注与战术选择全面收紧！`);
  }
}

function hasDangerousStatus(actor: Fighter): boolean {
  return actor.status.some((status) =>
    ['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_AIM_PUNCH', 'VALO_CYPHER_REVEALED', 'NEURAL_THEFT_DEBUFF', 'BABY_WEAKNESS_MARK', 'NO_HEAL'].includes(status.type),
  );
}

function highEvasionEnemy(actor: Fighter, enemies: Fighter[]): Fighter | undefined {
  return enemies.find((enemy) => enemy.agl >= Math.max(160, actor.agl * 0.75));
}

function lowHealthEnemy(enemies: Fighter[]): Fighter | undefined {
  return enemies
    .filter((enemy) => enemy.hpPct <= 0.42 || enemy.currentHp <= Math.max(900, enemy.maxHp * 0.35))
    .sort((a, b) => a.currentHp - b.currentHp)[0];
}

function hasDeadTeammate(actor: Fighter, runtime: ValorantRuntime): boolean {
  return runtime.fighters.some((fighter) =>
    fighter.isDead &&
    runtime.getTeamId(fighter) === runtime.getTeamId(actor) &&
    fighter.id !== actor.id,
  );
}

function pickWeighted(items: Array<[string, number]>): string {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [skillId, weight] of items) {
    roll -= weight;
    if (roll <= 0) return skillId;
  }
  return items[items.length - 1]?.[0] ?? 'valo_vandal_shot';
}

function chooseTacticalUltimate(actor: Fighter, runtime: ValorantRuntime, enemies: Fighter[], isClutching: boolean): string {
  let validUlts = [...VALO_ULTS];
  if (!hasDeadTeammate(actor, runtime)) validUlts = validUlts.filter((ult) => ult !== 'valo_ult_resurrection');

  const woundedEnemy = lowHealthEnemy(enemies);
  const evasiveEnemy = highEvasionEnemy(actor, enemies);
  const needEmergency = actor.hpPct <= 0.25;

  if (needEmergency && validUlts.includes('valo_ult_run_it_back') && !actor.hasUsedValoRunItBack && !hasStatus(actor, 'VALO_ULT_RUN_IT_BACK')) return 'valo_ult_run_it_back';
  if (actor.hpPct <= 0.4 && validUlts.includes('valo_ult_empress') && !hasStatus(actor, 'VALO_ULT_EMPRESS')) return 'valo_ult_empress';
  if (hasDangerousStatus(actor) && validUlts.includes('valo_ult_cosmic_divide')) return 'valo_ult_cosmic_divide';
  if (woundedEnemy && isClutching && validUlts.includes('valo_ult_blade_storm')) return 'valo_ult_blade_storm';
  if (evasiveEnemy && validUlts.includes('valo_ult_neural_theft')) return 'valo_ult_neural_theft';

  if (enemies.length >= 5) {
    const manyEnemyUlts: Array<[string, number]> = [
      ['valo_ult_lockdown', 3],
      ['valo_ult_vipers_pit', 3],
      ['valo_ult_showstopper', 2],
      ['valo_ult_orbital_strike', 2],
      ['valo_ult_null_cmd', 1],
    ];
    return pickWeighted(manyEnemyUlts.filter(([skillId]) => validUlts.includes(skillId)));
  }

  if (enemies.length >= 3) {
    const midEnemyUlts: Array<[string, number]> = [
      ['valo_ult_lockdown', 2],
      ['valo_ult_vipers_pit', 2],
      ['valo_ult_null_cmd', 2],
      ['valo_ult_showstopper', 1],
      ['valo_ult_hunters_fury', 1],
      ['valo_ult_orbital_strike', 1],
    ];
    return pickWeighted(midEnemyUlts.filter(([skillId]) => validUlts.includes(skillId)));
  }

  const clutchUlts: Array<[string, number]> = [
    ['valo_ult_empress', hasStatus(actor, 'VALO_ULT_EMPRESS') ? 1 : 4],
    ['valo_ult_run_it_back', (actor.hasUsedValoRunItBack || hasStatus(actor, 'VALO_ULT_RUN_IT_BACK')) ? 1 : 3],
    ['valo_ult_blade_storm', 3],
    ['valo_ult_hunters_fury', 2],
    ['valo_ult_neural_theft', 2],
    ['valo_ult_orbital_strike', 1],
  ];
  return pickWeighted(clutchUlts.filter(([skillId]) => validUlts.includes(skillId)));
}

function applyOperatorPenalty(actor: Fighter, runtime: ValorantRuntime): void {
  if (!actor.savedSpd) {
    actor.savedSpd = actor.spd;
    actor.savedAgl = actor.agl;
    actor.spd = Math.max(80, Math.floor(actor.spd * 0.78));
    actor.agl = Math.max(90, Math.floor(actor.agl * 0.68));
    runtime.log('skill', `🔭 资金充足！${actor.name} 起了一把【冥驹 (Operator)】！本轮架枪暴露身位，速度与闪避短暂下降。`);
  }
  refreshStatus(actor, 'VALO_OPERATOR_PENALTY', 1);
}

function chooseGunRound(actor: Fighter, runtime: ValorantRuntime, enemies: Fighter[], isClutching: boolean): string {
  const woundedEnemy = lowHealthEnemy(enemies);
  const evasiveEnemy = highEvasionEnemy(actor, enemies);

  if (woundedEnemy && (actor.crosshairFocus ?? 0) >= 9 && spendFocus(actor, 9, runtime, '发动残局处决')) {
    return 'valo_clutch_execute';
  }

  if ((actor.crosshairFocus ?? 0) >= 6 && (isClutching || !!woundedEnemy || Math.random() < 0.28)) {
    spendFocus(actor, 6, runtime, '校准爆头线');
    return 'valo_clutch_headshot';
  }

  if (evasiveEnemy && (actor.crosshairFocus ?? 0) >= 3 && spendFocus(actor, 3, runtime, '锁定高机动目标')) {
    grantStatus(actor, 'AIM', 1);
    return (actor.economy ?? 0) >= VALO_OPERATOR_ECONOMY ? 'valo_operator_shot' : 'valo_vandal_shot';
  }

  if ((actor.economy ?? 0) >= VALO_OPERATOR_ECONOMY && (isClutching || !!woundedEnemy || (actor.crosshairFocus ?? 0) >= 3 || Math.random() < 0.28)) {
    applyOperatorPenalty(actor, runtime);
    return 'valo_operator_shot';
  }

  if (Math.random() < (isClutching ? 0.18 : 0.28)) return 'valo_holding_angle';
  return (actor.economy ?? 0) >= 3 ? 'valo_vandal_shot' : 'valo_classic_shot';
}

export function selectValorantSkill(actor: Fighter, runtime: ValorantRuntime): string {
  restoreExpiredOperatorPenalty(actor, runtime);

  actor.ultPoints = (actor.ultPoints ?? 0) + 1;
  actor.economy = Math.min(12, (actor.economy ?? 0) + 1);
  gainFocus(actor, 1);

  const enemies = activeEnemies(actor, runtime);
  const competitiveEnemies = enemies.filter(isCompetitiveTarget);
  const isLowHpClutch = actor.hpPct <= 0.35;
  const isLateClutch = competitiveEnemies.length <= 3;
  if (isLowHpClutch) enterClutch(actor, runtime, '残血仍然没有退路', true);
  else if (isLateClutch) enterClutch(actor, runtime, '残局人数进入可控范围');

  const isClutching = hasStatus(actor, 'VALO_CLUTCH') || isLowHpClutch || isLateClutch;
  if (isClutching) gainFocus(actor, 1);

  const ultThreshold = isClutching ? VALO_CLUTCH_ULT_THRESHOLD : VALO_ULT_THRESHOLD;
  if ((actor.ultPoints ?? 0) >= ultThreshold) {
    const ult = chooseTacticalUltimate(actor, runtime, enemies, isClutching);
    actor.ultPoints = 0;
    if (ult === 'valo_ult_run_it_back') actor.hasUsedValoRunItBack = true;
    runtime.log('buff', `✨ 【战术终局】${actor.name} 大招充能完毕，按当前战况选择了【${VALO_ULT_DISPLAY_NAMES[ult] ?? ult}】！（经济 ${actor.economy ?? 0}，专注 ${actor.crosshairFocus ?? 0}/${VALO_FOCUS_MAX}）`);
    return ult;
  }

  if (actor.hpPct <= 0.18 && !actor.hasUsedValoRunItBack && !hasStatus(actor, 'VALO_ULT_RUN_IT_BACK') && (actor.ultPoints ?? 0) >= 3) {
    actor.ultPoints = 0;
    actor.hasUsedValoRunItBack = true;
    runtime.log('buff', `🔥 【保枪保命】${actor.name} 被逼入死角，提前启动【再火一回】！`);
    return 'valo_ult_run_it_back';
  }

  return chooseGunRound(actor, runtime, enemies, isClutching);
}

export const valoJuniorHook: CharacterHook = {
  id: 'valoJunior',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || actor.job !== 'VALO_JUNIOR') return null;
    return selectValorantSkill(actor, runtime);
  },
};
