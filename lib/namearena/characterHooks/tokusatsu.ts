import { cloneJobDefinition } from '../combatState';
import { REVIVE_CLEAN_STATUS_TYPES, isStatusType } from '../statusRules';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { grantStatus } from '../defenseStatus';
import { isSelectableTargetFor } from '../targeting';
import {
  addTokusatsuThroneResonance,
  clearTokusatsuThroneResonance,
  getTokusatsuThroneChance,
} from '../tokusatsuMechanics';

function refreshStatus(target: Parameters<CharacterHookRuntime['syncHpPct']>[0], type: string, duration: number, sourceId?: string): void {
  grantStatus(target, type, duration, sourceId);
}

function hasNegativeStatus(target: Parameters<CharacterHookRuntime['syncHpPct']>[0]): boolean {
  return target.status.some((status) => isStatusType(status.type, REVIVE_CLEAN_STATUS_TYPES));
}

function activeEnemies(runtime: CharacterHookRuntime, actor: Parameters<CharacterHookRuntime['syncHpPct']>[0]) {
  return runtime.fighters.filter((fighter) =>
    isSelectableTargetFor(runtime, actor, fighter),
  );
}

function ownsSkill(actor: Parameters<CharacterHookRuntime['syncHpPct']>[0], skillId: string): boolean {
  return actor.jobData.skills.includes(skillId);
}

function pickSkill(skills: string[]): string | null {
  if (skills.length === 0) return null;
  return skills[Math.floor(Math.random() * skills.length)] ?? null;
}

export function enterTokusatsuMonsterForm(
  target: Parameters<CharacterHookRuntime['syncHpPct']>[0],
  runtime: CharacterHookRuntime,
  user: Parameters<CharacterHookRuntime['syncHpPct']>[0] | null,
  triggerDepth: number,
): boolean {
  if (!target.isTokusatsu || target.job === 'MIRACLE_MONSTER_BUJIN') return false;

  const MIRACLE_MONSTER = runtime.jobs.MIRACLE_MONSTER_BUJIN;
  target.counterUsed = true;
  target.status = target.status.filter((status) =>
    status.type !== 'WAIT_COUNTER' && !isStatusType(status.type, REVIVE_CLEAN_STATUS_TYPES),
  );

  const previousMaxHp = target.maxHp;
  const monsterMaxHp = Math.max(3025, Math.min(4400, Math.floor(previousMaxHp * 1.27)));
  target.maxHp = monsterMaxHp;
  target.currentHp = Math.min(monsterMaxHp, Math.max(target.currentHp, Math.floor(monsterMaxHp * 0.7)));
  target.atk = Math.max(190, Math.floor(target.atk * 1.56));
  target.def = Math.max(108, Math.floor(target.def * 1.44));
  target.res = Math.max(128, Math.floor(target.res * 1.55));
  target.mag = Math.max(108, Math.floor(target.mag * 1.65));
  target.spd = Math.max(128, Math.floor(target.spd * 1.15));
  target.agl = Math.max(104, Math.floor(target.agl * 1.18));
  target.wis = Math.max(220, Math.floor(target.wis * 1.15));
  target.critRate = Math.min(0.41, target.critRate + 0.035);
  if (MIRACLE_MONSTER) target.jobData = cloneJobDefinition(MIRACLE_MONSTER);
  target.job = 'MIRACLE_MONSTER_BUJIN';
  target.monsterTurns = 0;
  delete target.savedStats;
  target.hasUsedRainbowFever = false;
  clearTokusatsuThroneResonance(target);
  refreshStatus(target, 'BKB', 2, 'tokusatsu_bujin_throne');
  refreshStatus(target, 'SPELL_BLOCK', 2, 'tokusatsu_bujin_throne');
  refreshStatus(target, 'REGEN', 3);
  runtime.syncHpPct(target);

  runtime.log('buff', `🦖 ${target.name} 受到攻击，触发【武神王座】反击！"DUAL ON！GREAT！MONSTER！Ready Fight." ${target.name} 永久进化为【奇迹怪兽武刃】，生命提升至 ${target.currentHp}/${target.maxHp}，抗性与怪兽力量全部重构！`);
  if (user) {
    runtime.log('info', `🚫 ${user.name} 的攻势被 ${target.name} 的怪兽形态打断，王座余波会被大幅削弱！`);
    runtime.executeSkillAction('great_monster_victory', target, user, triggerDepth + 1);
  }
  return true;
}

export const tokusatsuHook: CharacterHook = {
  id: 'tokusatsu',

  selectSkill: ({ actor, runtime, phase }) => {
    if (!actor.isTokusatsu || phase !== 'preMechanics') return null;

    const enemies = activeEnemies(runtime, actor);
    if (enemies.length === 0) return null;

    if (!actor.transformed) {
      if ((actor.hpPct <= 0.72 || hasNegativeStatus(actor)) && ownsSkill(actor, 'tokusatsu_soul') && Math.random() < 0.65) {
        return 'tokusatsu_soul';
      }
      if (ownsSkill(actor, 'henshin_rehearsal') && Math.random() < 0.38) {
        return 'henshin_rehearsal';
      }
      return null;
    }

    if (actor.job === 'MIRACLE_BUJIN') {
      if (!actor.counterUsed && !actor.status.some((status) => status.type === 'WAIT_COUNTER') && ownsSkill(actor, 'bujin_chair')) {
        const chairChance = getTokusatsuThroneChance(actor);
        if (Math.random() < chairChance) return 'bujin_chair';
        addTokusatsuThroneResonance(actor, 1);
      }
      if ((hasNegativeStatus(actor) || actor.hpPct <= 0.44) && ownsSkill(actor, 'miracle_alchemy')) {
        return 'miracle_alchemy';
      }
      if (actor.hpPct <= 0.62 && ownsSkill(actor, 'alchemy_armor') && Math.random() < 0.58) {
        return 'alchemy_armor';
      }
      if (enemies.length >= 3 && ownsSkill(actor, 'black_mist_wave') && Math.random() < 0.52) {
        return 'black_mist_wave';
      }
      if (actor.hpPct <= 0.68 && ownsSkill(actor, 'adversity_flash') && Math.random() < 0.55) {
        return 'adversity_flash';
      }
      return pickSkill(actor.jobData.skills.filter((skillId) => skillId !== 'bujin_chair'));
    }

    if (actor.job === 'MIRACLE_MONSTER_BUJIN') {
      actor.monsterTurns = (actor.monsterTurns ?? 0) + 1;
      if (!actor.hasUsedRainbowFever && ownsSkill(actor, 'rainbow_fever') && (enemies.length >= 2 || actor.hpPct <= 0.6) && Math.random() < 0.4) {
        return 'rainbow_fever';
      }
      if ((hasNegativeStatus(actor) || actor.hpPct <= 0.45) && ownsSkill(actor, 'miracle_armor')) {
        return 'miracle_armor';
      }
      if (enemies.length >= 3 && ownsSkill(actor, 'monster_roar') && Math.random() < 0.46) {
        return 'monster_roar';
      }
      const highBuffEnemy = enemies.some((enemy) =>
        enemy.status.some((status) => status.type === 'INVUL' || status.type === 'BKB' || status.type === 'SPELL_BLOCK' || status.type.startsWith('CTR_') || status.type.startsWith('STYLE_')),
      );
      if (highBuffEnemy && ownsSkill(actor, 'energy_crush') && Math.random() < 0.58) {
        return 'energy_crush';
      }
      if (ownsSkill(actor, 'bujin_monster_combo') && Math.random() < 0.5) {
        return 'bujin_monster_combo';
      }
      return pickSkill(actor.jobData.skills);
    }

    return null;
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const MIRACLE_BUJIN = runtime.jobs.MIRACLE_BUJIN;
    if (!fighter.isTokusatsu || !MIRACLE_BUJIN) return false;

    transform('MIRACLE_BUJIN', `🦗 KABOOM！${fighter.name} 绝境爆发！左手武神之刃，右手奇迹炼金！变身——【${MIRACLE_BUJIN.name}】！`, () => {
      fighter.maxHp = Math.max(3200, Math.min(4300, Math.floor(fighter.maxHp * 4.2)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = Math.max(145, Math.floor(fighter.atk * 4.6));
      fighter.def = Math.max(82, Math.floor(fighter.def * 4.4));
      fighter.res = Math.max(120, Math.floor(fighter.res * 4.25));
      fighter.spd = Math.max(120, Math.floor(fighter.spd * 3.6));
      fighter.agl = Math.max(88, Math.floor(fighter.agl * 3.7));
      fighter.mag = Math.max(90, Math.floor(fighter.mag * 4.3));
      fighter.wis = Math.max(220, Math.floor(fighter.wis * 4.0));
      fighter.counterUsed = false;
      fighter.hasUsedGreatMonsterVictory = false;
      fighter.hasUsedRainbowFever = false;
      fighter.hasUsedTokusatsuDefiance = false;
      fighter.tokusatsuInstantActionQueued = false;
      clearTokusatsuThroneResonance(fighter);
      fighter.status = fighter.status.filter((status) => !isStatusType(status.type, REVIVE_CLEAN_STATUS_TYPES));
      refreshStatus(fighter, 'BKB', 1, 'tokusatsu_miracle_alchemy');
      refreshStatus(fighter, 'SPELL_BLOCK', 1, 'tokusatsu_miracle_alchemy');
      refreshStatus(fighter, 'REGEN', 3);
    });
    return true;
  },

  onWaitCounter: ({ target, user, runtime, triggerDepth }) => {
    if (!target.isTokusatsu) return false;
    return enterTokusatsuMonsterForm(target, runtime, user, triggerDepth);
  },
};
