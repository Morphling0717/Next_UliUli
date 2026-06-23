import type { CharacterHook } from './types';

export const tingHook: CharacterHook = {
  id: 'ting',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isTing) return false;

    const EXPLOSIVE_ANTI_CROC = runtime.jobs.EXPLOSIVE_ANTI_CROC;
    const GRUDGE_SUICIDER = runtime.jobs.GRUDGE_SUICIDER;
    const crocExists = runtime.fighters.some((candidate) => candidate.isGacha && runtime.isActiveCombatant(candidate));
    if (crocExists && EXPLOSIVE_ANTI_CROC) {
      transform('EXPLOSIVE_ANTI_CROC', `💥 ${fighter.name} 看到了牢鳄，彻底疯狂！转职为【${EXPLOSIVE_ANTI_CROC.name}】！"牢鳄！我和你爆了！！！"`, () => {
        fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 2.5)));
        fighter.currentHp = fighter.maxHp;
        fighter.atk *= 4.0;
        fighter.mag *= 6.0;
        fighter.spd *= 5.0;
      });
      return true;
    }

    if (!GRUDGE_SUICIDER) return false;
    transform('GRUDGE_SUICIDER', `🩸 ${fighter.name} 怨气爆发！转职为【${GRUDGE_SUICIDER.name}】！"都别活了..."`, () => {
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 2.0)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk *= 2.5;
      fighter.mag *= 4.0;
      fighter.spd = 100;
    });
    return true;
  },

  onDefeated: ({ fighter, runtime, spinalSwordRef }) => {
    if (!fighter.isTing || fighter.hasDroppedSword) return;

    fighter.hasDroppedSword = true;
    spinalSwordRef.current = true;
    runtime.log('win', `🦴 ${fighter.name} 倒下了，但他拔出了自己的脊髓剑插在了地上！`);
  },
};
