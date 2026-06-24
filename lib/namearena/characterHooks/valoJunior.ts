import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';

const VALO_ULT_THRESHOLD = 4;
const VALO_OPERATOR_ECONOMY = 6;

const VALO_ULTS = [
  'valo_ult_showstopper', 'valo_ult_blade_storm', 'valo_ult_cosmic_divide',
  'valo_ult_resurrection', 'valo_ult_lockdown', 'valo_ult_vipers_pit',
  'valo_ult_empress', 'valo_ult_hunters_fury', 'valo_ult_null_cmd',
  'valo_ult_run_it_back', 'valo_ult_orbital_strike', 'valo_ult_neural_theft',
];

export function selectValorantSkill(actor: Fighter, runtime: Pick<CharacterHookRuntime, 'fighters' | 'getTeamId' | 'isActiveCombatant' | 'log'>): string {
  actor.ultPoints = (actor.ultPoints ?? 0) + 1;
  actor.economy = (actor.economy ?? 0) + 1;
  if (actor.ultPoints >= VALO_ULT_THRESHOLD) {
    let validUlts = [...VALO_ULTS];
    if (!runtime.fighters.some((fighter) =>
      fighter.isDead &&
      runtime.getTeamId(fighter) === runtime.getTeamId(actor) &&
      fighter.id !== actor.id,
    )) {
      validUlts = validUlts.filter((ult) => ult !== 'valo_ult_resurrection');
    }
    actor.ultPoints = 0;
    runtime.log('buff', `✨ 大招充能完毕！${actor.name} 准备释放终极技能！`);
    return validUlts[Math.floor(Math.random() * validUlts.length)];
  }

  if (Math.random() < 0.3) return 'valo_holding_angle';
  if ((actor.economy ?? 0) >= VALO_OPERATOR_ECONOMY) {
    if (!actor.savedSpd) {
      actor.savedSpd = actor.spd;
      actor.savedAgl = actor.agl;
      actor.spd = Math.floor(actor.spd * 0.65);
      actor.agl = Math.floor(actor.agl * 0.5);
      runtime.log('skill', `🔭 资金充足！${actor.name} 起了一把【冥驹 (Operator)】！进入架枪姿态，速度和闪避大幅降低！`);
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
}

export const valoJuniorHook: CharacterHook = {
  id: 'valoJunior',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || actor.job !== 'VALO_JUNIOR') return null;
    return selectValorantSkill(actor, runtime);
  },
};
