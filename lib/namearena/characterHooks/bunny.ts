import type { CharacterHook } from './types';

export const bunnyHook: CharacterHook = {
  id: 'bunny',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const VERSATILE_RABBIT = runtime.jobs.VERSATILE_RABBIT;
    if (!fighter.isTuJuanJuan || !VERSATILE_RABBIT) return false;

    transform('VERSATILE_RABBIT', `🐰 ${fighter.name} 被打急了！"我不装了！" 掏出巨大的发声计算器，转职为【${VERSATILE_RABBIT.name}】！全属性调整为 170，化身为六边形战士！`, () => {
      fighter.maxHp = 3250;
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 170;
      fighter.def = 170;
      fighter.spd = 170;
      fighter.agl = 170;
      fighter.mag = 170;
      fighter.res = 170;
      fighter.wis = 170;
      fighter.styleTurnCounter = 0;
      if (fighter.baseStatsForStyle) {
        fighter.baseStatsForStyle = { atk: 170, def: 170, res: 170, mag: 170, spd: 170, wis: 170, agl: 170 };
      }
    });
    return true;
  },
};
