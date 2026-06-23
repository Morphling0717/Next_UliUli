import type { CharacterHook } from './types';

export const warThunderHook: CharacterHook = {
  id: 'warThunder',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const WT_TOP_TIER = runtime.jobs.WT_TOP_TIER;
    if (!fighter.isWT || !WT_TOP_TIER) return false;

    transform('WT_TOP_TIER', `🚨 【乘员昏迷 / 载具大破】\n${fighter.name} 原下载具被毁！气得一拳砸碎键盘："防空车呢？！我直接上顶级备用载具！"\n🚜 重装巨兽降临！转职为【${WT_TOP_TIER.name}】，满挂爆反装甲接管战区！`, () => {
      fighter.maxHp = 4500;
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 280;
      fighter.def = 250;
      fighter.res = 200;
      fighter.spd = 120;
      fighter.agl = 90;
      fighter.wis = 180;
      fighter.mag = 50;
      fighter.status.push({ type: 'WT_ERA', duration: 999 });
      fighter.status.push({ type: 'SPELL_BLOCK', duration: 999 });
    });
    return true;
  },
};
