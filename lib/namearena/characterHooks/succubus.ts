import type { CharacterHook } from './types';

export const succubusHook: CharacterHook = {
  id: 'succubus',

  selectSkill: ({ actor, phase }) => {
    if (phase !== 'postMechanics' || !actor.isSuccubus || !actor.transformed) return null;

    const hasInstall = actor.jobData.skills.includes('chimera_install');
    const plugCount = actor.status.filter((status) => status.type.startsWith('PLUG_')).length;
    if (!hasInstall || plugCount >= 8) return null;

    if (Math.random() < 0.15) {
      const pluginSkills = actor.jobData.skills.filter((skill) =>
        skill.startsWith('chimera_') &&
        skill !== 'chimera_install' &&
        skill !== 'chimera_strike',
      );
      if (pluginSkills.length > 0 && Math.random() < 0.75) {
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
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 1.5)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = Math.floor(fighter.atk * 2.5);
      fighter.def = Math.floor(fighter.def * 2.0);
      fighter.mag = Math.floor(fighter.mag * 2.5);
      fighter.res = Math.floor(fighter.res * 2.0);
      fighter.wis = Math.floor(fighter.wis * 2.0);
      fighter.agl = Math.floor(fighter.agl * 1.5);
      fighter.spd = 120;
    });
    return true;
  },
};
