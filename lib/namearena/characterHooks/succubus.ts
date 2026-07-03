import type { CharacterHook } from './types';
import { grantStatus } from '../defenseStatus';
import { REVIVE_CLEAN_STATUS_TYPES, isStatusType } from '../statusRules';

export const succubusHook: CharacterHook = {
  id: 'succubus',

  selectSkill: ({ actor, phase }) => {
    if (phase !== 'postMechanics' || !actor.isSuccubus || !actor.transformed) return null;

    const hasInstall = actor.jobData.skills.includes('chimera_install');
    const plugCount = actor.status.filter((status) => status.type.startsWith('PLUG_')).length;
    if (!hasInstall || plugCount >= 8) return null;

    const pluginSkills = actor.jobData.skills.filter((skill) =>
      skill.startsWith('chimera_') &&
      skill !== 'chimera_install' &&
      skill !== 'chimera_strike',
    );
    const installChance = plugCount <= 2 ? 0.791 : (plugCount <= 5 ? 0.58 : 0.43);
    if (Math.random() >= installChance) {
      if (pluginSkills.length > 0 && Math.random() < 0.802) {
        return pluginSkills[Math.floor(Math.random() * pluginSkills.length)];
      }
      return 'chimera_strike';
    }
    return 'chimera_install';
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const CHIMERA = runtime.jobs.CHIMERA;
    if (!fighter.isSuccubus || !CHIMERA) return false;

    transform('CHIMERA', `🧬 ${fighter.name} 解除了限制，肉体开始重组... 变身为【${CHIMERA.name}】！各项数值巨幅提升！`, () => {
      fighter.maxHp = Math.max(2525, Math.min(3025, Math.floor(fighter.maxHp * 1.51)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = Math.floor(fighter.atk * 2.51);
      fighter.def = Math.floor(fighter.def * 2.02);
      fighter.mag = Math.floor(fighter.mag * 2.51);
      fighter.res = Math.floor(fighter.res * 2.02);
      fighter.wis = Math.floor(fighter.wis * 2.0);
      fighter.agl = Math.floor(fighter.agl * 1.5);
      fighter.spd = 121;
      fighter.hasUltimateEvolved = false;
      fighter.chimeraMilestoneLevel = 0;
      fighter.chimeraInstantActionQueued = false;
      fighter.status = fighter.status.filter((status) => !isStatusType(status.type, REVIVE_CLEAN_STATUS_TYPES));
      grantStatus(fighter, 'BKB', 1, 'chimera_startup_core');
      grantStatus(fighter, 'SPELL_BLOCK', 1, 'chimera_startup_core');
      grantStatus(fighter, 'REGEN', 2);
    });
    return true;
  },
};
