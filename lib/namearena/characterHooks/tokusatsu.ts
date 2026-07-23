import { cloneJobDefinition } from '../combatState';
import { commitFormTransition } from '../battlePresentation';
import { getStatusIdentityIdsByTag } from '../statusRegistry';
import type { CharacterHook, CharacterHookRuntime } from './types';

import { isSelectableTargetFor } from '../targeting';
import { applyStatus, hasIdentity, hasMechanic, queryDispellableStatuses, removeEffects, withPersistentStatusShapesSuspended } from '../statusSystem';
import {
  addTokusatsuThroneResonance,
  clearTokusatsuThroneResonance,
  getTokusatsuThroneChance,
} from '../tokusatsuMechanics';

const TOKUSATSU_MONSTER_ATK_MULTIPLIER = 1.445;
const TOKUSATSU_MONSTER_MAG_MULTIPLIER = 1.495;

function hasDispellableNegativeStatus(
  target: Parameters<CharacterHookRuntime['syncHpPct']>[0],
  strength: 'normal' | 'strong',
): boolean {
  return queryDispellableStatuses(target, { strength, direction: 'negative' }).length > 0;
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
  removeEffects(target, { identityIds: ['WAIT_COUNTER'], reason: 'consumed' });
  const deferredDispelLogs: Array<{ type: string; text: string }> = [];
  runtime.dispelStatusEffects(target, {
    strength: 'strong',
    direction: 'negative',
    emitLog: (type, text) => deferredDispelLogs.push({ type, text }),
  });
  const changed = commitFormTransition({
    fighter: target,
    log: runtime.log,
    logType: 'buff',
    message: () => `🦖 ${target.name} 受到攻击，触发【武神王座】反击！"DUAL ON！GREAT！MONSTER！Ready Fight." ${target.name} 永久进化为【奇迹怪兽武刃】，生命提升至 ${target.currentHp}/${target.maxHp}，抗性与怪兽力量全部重构！`,
    mutate: () => {
      withPersistentStatusShapesSuspended(target, () => {
        const previousMaxHp = target.maxHp;
        const monsterMaxHp = Math.max(3000, Math.min(4100, Math.floor(previousMaxHp * 1.2)));
        target.maxHp = monsterMaxHp;
        target.currentHp = Math.min(monsterMaxHp, Math.max(target.currentHp, Math.floor(monsterMaxHp * 0.67)));
        target.atk = Math.max(180, Math.floor(target.atk * TOKUSATSU_MONSTER_ATK_MULTIPLIER));
        target.def = Math.max(108, Math.floor(target.def * 1.44));
        target.res = Math.max(128, Math.floor(target.res * 1.55));
        target.mag = Math.max(100, Math.floor(target.mag * TOKUSATSU_MONSTER_MAG_MULTIPLIER));
        target.spd = Math.max(128, Math.floor(target.spd * 1.15));
        target.agl = Math.max(104, Math.floor(target.agl * 1.18));
        target.wis = Math.max(220, Math.floor(target.wis * 1.15));
        target.critRate = Math.min(0.41, target.critRate + 0.035);
        if (MIRACLE_MONSTER) target.jobData = cloneJobDefinition(MIRACLE_MONSTER);
        target.job = 'MIRACLE_MONSTER_BUJIN';
        target.monsterTurns = 0;
        target.hasUsedRainbowFever = false;
      });
      clearTokusatsuThroneResonance(target);
      applyStatus(target, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_bujin_throne' } });
      applyStatus(target, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'tokusatsu_bujin_throne' } });
      applyStatus(target, { identityId: 'REGEN', remainingTurns: 2 });
      runtime.syncHpPct(target);
    },
  });
  if (!changed) return false;
  deferredDispelLogs.forEach((entry) => runtime.log(entry.type, entry.text));
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
      if ((actor.hpPct <= 0.72 || hasDispellableNegativeStatus(actor, 'normal')) && ownsSkill(actor, 'tokusatsu_soul') && Math.random() < 0.65) {
        return 'tokusatsu_soul';
      }
      if (ownsSkill(actor, 'henshin_rehearsal') && Math.random() < 0.38) {
        return 'henshin_rehearsal';
      }
      return null;
    }

    if (actor.job === 'MIRACLE_BUJIN') {
      if (!actor.counterUsed && !hasMechanic(actor, 'WAIT_COUNTER') && ownsSkill(actor, 'bujin_chair')) {
        const chairChance = getTokusatsuThroneChance(actor);
        if (Math.random() < chairChance) return 'bujin_chair';
        addTokusatsuThroneResonance(actor, 1);
      }
      if ((hasDispellableNegativeStatus(actor, 'strong') || actor.hpPct <= 0.44) && ownsSkill(actor, 'miracle_alchemy')) {
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
      if ((hasDispellableNegativeStatus(actor, 'strong') || actor.hpPct <= 0.45) && ownsSkill(actor, 'miracle_armor')) {
        return 'miracle_armor';
      }
      if (enemies.length >= 3 && ownsSkill(actor, 'monster_roar') && Math.random() < 0.32) {
        return 'monster_roar';
      }
      const highBuffEnemy = enemies.some((enemy) =>
        hasMechanic(enemy, 'INVUL') ||
        hasMechanic(enemy, 'BKB') ||
        hasMechanic(enemy, 'SPELL_BLOCK') ||
        [...getStatusIdentityIdsByTag('counter_stance'), ...getStatusIdentityIdsByTag('rabbit_style')]
          .some((identityId) => hasIdentity(enemy, identityId)),
      );
      if (highBuffEnemy && ownsSkill(actor, 'energy_crush') && Math.random() < 0.58) {
        return 'energy_crush';
      }
      if (ownsSkill(actor, 'bujin_monster_combo') && Math.random() < 0.4) {
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
      applyStatus(fighter, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'tokusatsu_miracle_alchemy' } });
      applyStatus(fighter, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'tokusatsu_miracle_alchemy' } });
      applyStatus(fighter, { identityId: 'REGEN', remainingTurns: 3 });
    }, () => {
      runtime.dispelStatusEffects(fighter, { strength: 'strong', direction: 'negative' });
    });
    return true;
  },

  onWaitCounter: ({ target, user, runtime, triggerDepth }) => {
    if (!target.isTokusatsu) return false;
    return enterTokusatsuMonsterForm(target, runtime, user, triggerDepth);
  },
};
