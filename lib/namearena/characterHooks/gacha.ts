import type { CharacterHook } from './types';
import {
  GACHA_SUMMON_LIFESTEAL_STATUS,
  isLuckEmperor,
} from '../gachaMechanics';

export const gachaHook: CharacterHook = {
  id: 'gacha',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'postMechanics' || !isLuckEmperor(actor)) return null;
    if (!actor.jobData.skills.includes('destiny_draw')) return null;

    const luck = actor.gachaLuck ?? 0;
    if (luck >= 3) return 'destiny_draw';
    if (actor.hpPct <= 0.45 && Math.random() < 0.75) return 'destiny_draw';

    const actorTeam = runtime.getTeamId(actor);
    const hasOwnSummon = runtime.fighters.some((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === actor.id &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === actorTeam,
    );
    const hasSummonLifesteal = actor.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);
    if (hasOwnSummon && !hasSummonLifesteal && Math.random() < 0.5) return 'destiny_draw';

    return null;
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const LUCK_EMPEROR = runtime.jobs.LUCK_EMPEROR;
    if (!fighter.isGacha || !LUCK_EMPEROR) return false;

    transform('LUCK_EMPEROR', `👑 ${fighter.name} 怒了！觉醒欧皇血统！变身——【${LUCK_EMPEROR.name}】！`, () => {
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 1.8)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk *= 2.0;
      fighter.mag *= 3.0;
      fighter.spd = 100;
      fighter.wis = 120;
      fighter.gachaLuck = Math.max(0, fighter.gachaLuck ?? 0);
      fighter.gachaPityPower = 0;
      fighter.hasUsedGachaDeathSave = false;
      fighter.gachaSummonLifestealPct = 0;
    });
    return true;
  },
};
