import type { CharacterHook } from './types';

export const siguaHook: CharacterHook = {
  id: 'sigua',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isSigua) return false;

    const MY_BABY = runtime.jobs.MY_BABY;
    const VALO_JUNIOR = runtime.jobs.VALO_JUNIOR;
    const claire = runtime.fighters.find((candidate) =>
      candidate.isSuccubus &&
      runtime.isActiveCombatant(candidate) &&
      runtime.getTeamId(candidate) === runtime.getTeamId(fighter),
    );

    if (claire && MY_BABY) {
      transform('MY_BABY', `👶 ${fighter.name} 看到同队的克蕾儿陷入苦战！羁绊爆发！转职为专属辅助【${MY_BABY.name}】！`, () => {
        fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 1.8)));
        fighter.currentHp = fighter.maxHp;
        fighter.wis = 250;
        fighter.spd = 100;
        fighter.mag = 300;
      });
      return true;
    }

    if (!VALO_JUNIOR) return false;
    transform('VALO_JUNIOR', `🔫 ${fighter.name} 眼神变了！拿起了步枪！转职为【${VALO_JUNIOR.name}】！全场特工技能准备就绪！`, () => {
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 2.0)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 300;
      fighter.spd = 100;
      fighter.agl = 200;
      fighter.ultPoints = 0;
      fighter.economy = 0;
    });
    return true;
  },
};
