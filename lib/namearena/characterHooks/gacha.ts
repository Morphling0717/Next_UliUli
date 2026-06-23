import type { CharacterHook } from './types';

export const gachaHook: CharacterHook = {
  id: 'gacha',

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
    });
    return true;
  },
};
