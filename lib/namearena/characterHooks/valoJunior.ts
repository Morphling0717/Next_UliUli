import type { CharacterHook } from './types';

export const valoJuniorHook: CharacterHook = {
  id: 'valoJunior',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || actor.job !== 'VALO_JUNIOR') return null;

    actor.ultPoints = (actor.ultPoints ?? 0) + 1;
    actor.economy = (actor.economy ?? 0) + 1;
    if (actor.ultPoints >= 5) {
      let validUlts = [
        'valo_ult_showstopper', 'valo_ult_blade_storm', 'valo_ult_cosmic_divide',
        'valo_ult_resurrection', 'valo_ult_lockdown', 'valo_ult_vipers_pit',
        'valo_ult_empress', 'valo_ult_hunters_fury', 'valo_ult_null_cmd',
        'valo_ult_run_it_back', 'valo_ult_orbital_strike', 'valo_ult_neural_theft',
      ];
      if (!runtime.fighters.some((fighter) =>
        fighter.isDead &&
        runtime.getTeamId(fighter) === runtime.getTeamId(actor) &&
        fighter.id !== actor.id,
      )) {
        validUlts = validUlts.filter((ult) => ult !== 'valo_ult_resurrection');
      }
      actor.ultPoints = 0;
      runtime.log('win', `✨ 大招充能完毕！${actor.name} 准备释放终极技能！`);
      return validUlts[Math.floor(Math.random() * validUlts.length)];
    }

    if (Math.random() < 0.3) return 'valo_holding_angle';
    if ((actor.economy ?? 0) >= 6) {
      if (!actor.savedSpd) {
        actor.savedSpd = actor.spd;
        actor.savedAgl = actor.agl;
        actor.spd = Math.floor(actor.spd * 0.5);
        actor.agl = 0;
        runtime.log('win', `🔭 资金充足！${actor.name} 起了一把【冥驹 (Operator)】！进入架枪姿态，速度和闪避大幅降低！`);
      }
      return 'valo_operator_shot';
    }

    if (actor.savedSpd) {
      actor.spd = actor.savedSpd;
      actor.agl = actor.savedAgl ?? 0;
      delete actor.savedSpd;
      delete actor.savedAgl;
    }
    return (actor.economy ?? 0) >= 2 ? 'valo_vandal_shot' : 'valo_classic_shot';
  },
};
