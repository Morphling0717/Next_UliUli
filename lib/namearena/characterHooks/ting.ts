import type { CharacterHook } from './types';
import { isSelectableTargetFor } from '../targeting';

const TING_TRANSFORM_SKILL_RATE = 0.92;

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

export const tingHook: CharacterHook = {
  id: 'ting',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || !actor.isTing || !actor.transformed) return null;
    if (Math.random() > TING_TRANSFORM_SKILL_RATE) return null;

    const enemies = runtime.fighters.filter((fighter) =>
      isSelectableTargetFor(runtime, actor, fighter),
    );

    if (actor.job === 'EXPLOSIVE_ANTI_CROC') {
      const hasActiveCroc = enemies.some((enemy) => enemy.isGacha);
      if (actor.hpPct < 0.445 && Math.random() < 0.522) return 'grudge_blood_feast';
      if (hasActiveCroc && actor.hpPct > 0.5 && Math.random() < 0.372) return 'suicide_bomb';
      const pool = ['grudge_rend', 'grudge_blood_feast', 'suicide_rng', 'spinal_slash'];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    if (actor.hpPct < 0.5 && Math.random() < 0.65) return 'grudge_blood_feast';
    if (enemies.some((enemy) => !enemy.status.some((status) => status.type === 'WEAK')) && Math.random() < 0.35) {
      return 'grudge_wail';
    }

    const pool = ['grudge_rend', 'grudge_blood_feast', 'bone_guard', 'suicide_rng', 'spinal_slash'];
    return pool[Math.floor(Math.random() * pool.length)];
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isTing) return false;

    const EXPLOSIVE_ANTI_CROC = runtime.jobs.EXPLOSIVE_ANTI_CROC;
    const GRUDGE_SUICIDER = runtime.jobs.GRUDGE_SUICIDER;
    const crocExists = runtime.fighters.some((candidate) => candidate.isGacha && runtime.isActiveCombatant(candidate));
    if (crocExists && EXPLOSIVE_ANTI_CROC) {
      transform('EXPLOSIVE_ANTI_CROC', `💥 ${fighter.name} 看到了牢鳄，彻底疯狂！转职为【${EXPLOSIVE_ANTI_CROC.name}】！"牢鳄！我和你爆了！！！"`, () => {
        fighter.maxHp = Math.max(3700, Math.min(4525, Math.floor(fighter.maxHp * 3.67)));
        fighter.currentHp = fighter.maxHp;
        fighter.atk = scaleStat(fighter.atk, 6.0, 340);
        fighter.mag = scaleStat(fighter.mag, 8.0, 260);
        fighter.def = scaleStat(fighter.def, 6.12, 207);
        fighter.res = scaleStat(fighter.res, 6.12, 207);
        fighter.agl = scaleStat(fighter.agl, 5.0, 150);
        fighter.spd = Math.max(203, Math.floor(fighter.spd * 6.08));
        fighter.wis = Math.max(160, Math.floor(fighter.wis * 8.0));
        fighter.hasTriggeredTingDefiance = false;
      });
      return true;
    }

    if (!GRUDGE_SUICIDER) return false;
    transform('GRUDGE_SUICIDER', `🩸 ${fighter.name} 怨气爆发！转职为【${GRUDGE_SUICIDER.name}】！"都别活了..."`, () => {
      fighter.maxHp = Math.max(3600, Math.min(4380, Math.floor(fighter.maxHp * 3.34)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = scaleStat(fighter.atk, 4.2, 240);
      fighter.mag = scaleStat(fighter.mag, 6.0, 220);
      fighter.def = scaleStat(fighter.def, 5.23, 189);
      fighter.res = scaleStat(fighter.res, 5.23, 189);
      fighter.agl = scaleStat(fighter.agl, 4.0, 140);
      fighter.spd = Math.max(185, Math.floor(fighter.spd * 5.28));
      fighter.wis = Math.max(180, Math.floor(fighter.wis * 10.0));
      fighter.hasTriggeredTingDefiance = false;
    });
    return true;
  },

  onDefeated: ({ fighter, runtime, spinalSwordRef }) => {
    if (!fighter.isTing || fighter.hasDroppedSword) return;

    fighter.hasDroppedSword = true;
    spinalSwordRef.current = true;
    runtime.log('death', `🦴 【脊髓剑遗留】${fighter.name} 退场前拔出自己的脊髓剑插在了地上，等待后来者拾起！`);
  },
};
