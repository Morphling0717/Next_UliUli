import type { CharacterHook } from './types';
import { grantStatus } from '../defenseStatus';

export const morphlingHook: CharacterHook = {
  id: 'morphling',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const GOD_SLIME = runtime.jobs.GOD_SLIME;
    if (!fighter.isMorphling || !GOD_SLIME) return false;

    transform('GOD_SLIME', `🌊 警告：${fighter.name} 显露出【${GOD_SLIME.name}】真身！各项数值发生恐怖膨胀！`, () => {
      fighter.maxHp = 5000;
      fighter.currentHp = fighter.maxHp;
      fighter.atk = fighter.mag = fighter.def = fighter.res = fighter.wis = fighter.spd = fighter.agl = 300;
      grantStatus(fighter, 'LIQUID_BODY', 999);
    });
    return true;
  },
};
