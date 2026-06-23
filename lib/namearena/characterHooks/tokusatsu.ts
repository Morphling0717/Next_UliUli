import { cloneJobDefinition } from '../combatState';
import type { CharacterHook } from './types';

export const tokusatsuHook: CharacterHook = {
  id: 'tokusatsu',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const MIRACLE_BUJIN = runtime.jobs.MIRACLE_BUJIN;
    if (!fighter.isTokusatsu || !MIRACLE_BUJIN) return false;

    transform('MIRACLE_BUJIN', `🦗 KABOOM！${fighter.name} 绝境爆发！左手武神之刃，右手奇迹炼金！变身——【${MIRACLE_BUJIN.name}】！`, () => {
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 3.0)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk *= 4.0;
      fighter.def *= 3.5;
      fighter.spd = 100;
      fighter.agl *= 3.5;
      fighter.mag *= 3.0;
      fighter.wis = 180;
    });
    return true;
  },

  onWaitCounter: ({ target, user, runtime, triggerDepth }) => {
    if (!target.isTokusatsu) return false;

    const MIRACLE_MONSTER = runtime.jobs.MIRACLE_MONSTER_BUJIN;
    target.atk = Math.floor(target.atk * 2.5);
    target.def = Math.floor(target.def * 2.0);
    target.mag = Math.floor(target.mag * 2.0);
    target.spd = Math.floor(target.spd * 1.5);
    if (MIRACLE_MONSTER) target.jobData = cloneJobDefinition(MIRACLE_MONSTER);
    target.job = 'MIRACLE_MONSTER_BUJIN';
    target.monsterTurns = 0;
    delete target.savedStats;
    target.hasUsedRainbowFever = false;
    runtime.log('win', `🦖 ${target.name} 受到攻击，触发反击！\n"DUAL ON！GREAT！MONSTER！Ready Fight."\n数值暴涨！永久进化为【奇迹怪兽武刃】！`);
    runtime.log('info', `🚫 ${user.name} 的攻击被 ${target.name} 的怪兽形态打断了！`);
    runtime.executeSkillAction('great_monster_victory', target, user, triggerDepth + 1);
    return true;
  },
};
