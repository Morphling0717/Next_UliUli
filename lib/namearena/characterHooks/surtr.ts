import { isSurtrAfterglowActive } from '../surtrMechanics';
import type { CharacterHook } from './types';

function weightedPick(entries: Array<[string, number]>): string | null {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [skillId, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll <= 0) return skillId;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

export const surtrHook: CharacterHook = {
  id: 'surtr',

  selectSkill: ({ actor, phase }) => {
    if (phase !== 'preMechanics' || !actor.isSurtr || !actor.surtrState) return null;
    const twilightAvailable = !actor.surtrState.twilightUsed && !isSurtrAfterglowActive(actor);
    return weightedPick([
      ['surtr_flame_sword', 45],
      ['surtr_molten_shadow', 35],
      ['surtr_twilight', twilightAvailable ? 20 : 0],
    ]);
  },
};
