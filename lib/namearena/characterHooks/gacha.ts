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

    const actorTeam = runtime.getTeamId(actor);
    const ownSummons = runtime.fighters.filter((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === actor.id &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === actorTeam,
    );
    const ordinarySummonCount = ownSummons.filter((fighter) => !fighter.isAdvancedSummon).length;
    const luck = actor.gachaLuck ?? 0;
    if (luck >= 3) return 'destiny_draw';
    if (ownSummons.length === 0 && Math.random() < 0.68) return 'destiny_draw';
    if (ordinarySummonCount >= 2 && Math.random() < 0.4) return 'destiny_draw';
    if (actor.hpPct <= 0.45 && Math.random() < 0.6) return 'destiny_draw';

    const hasSummonLifesteal = actor.status.some((status) => status.type === GACHA_SUMMON_LIFESTEAL_STATUS);
    if (ownSummons.length > 0 && !hasSummonLifesteal && Math.random() < 0.46) return 'destiny_draw';

    return null;
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const LUCK_EMPEROR = runtime.jobs.LUCK_EMPEROR;
    if (!fighter.isGacha || !LUCK_EMPEROR) return false;

    transform('LUCK_EMPEROR', `👑 ${fighter.name} 怒了！觉醒欧皇血统！变身——【${LUCK_EMPEROR.name}】！`, () => {
      fighter.maxHp = Math.max(2600, Math.min(3100, Math.floor(fighter.maxHp * 1.88)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk *= 2.0;
      fighter.mag *= 3.0;
      fighter.spd = 100;
      fighter.wis = 120;
      fighter.gachaLuck = Math.max(2, fighter.gachaLuck ?? 0);
      fighter.gachaPityPower = 0;
      fighter.hasUsedGachaDeathSave = false;
      fighter.gachaSummonLifestealPct = 0;
      fighter.exodiaPieces = fighter.exodiaPieces ?? [];
    });
    return true;
  },
};
