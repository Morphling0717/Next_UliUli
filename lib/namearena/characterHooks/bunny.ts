import type { CharacterHook } from './types';

export const bunnyHook: CharacterHook = {
  id: 'bunny',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const VERSATILE_RABBIT = runtime.jobs.VERSATILE_RABBIT;
    if (!fighter.isTuJuanJuan || !VERSATILE_RABBIT) return false;

    transform('VERSATILE_RABBIT', `🐰 ${fighter.name} 被打急了！"我不装了！" 掏出巨大的发声计算器，转职为【${VERSATILE_RABBIT.name}】！全属性调整为 150，化身为六边形战士！`, () => {
      fighter.maxHp = 2750;
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 150;
      fighter.def = 150;
      fighter.spd = 150;
      fighter.agl = 150;
      fighter.mag = 150;
      fighter.res = 150;
      fighter.wis = 150;
      fighter.styleTurnCounter = 0;
      if (fighter.baseStatsForStyle) {
        fighter.baseStatsForStyle = { atk: 150, def: 150, res: 150, mag: 150, spd: 150, wis: 150, agl: 150 };
      }
    });
    return true;
  },
};
