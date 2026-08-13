import type {
  BattleState,
  DispelOptions,
  DispelResolution,
  Fighter,
  SkillDispelSpec,
  SkillDefinition,
} from './types';
import { canProvideHerobrineSupport } from './npcCombat';

export type SkillDispelTiming = NonNullable<SkillDispelSpec['timing']>;

export interface SkillDispelRuntime {
  fighters: Fighter[];
  battleState?: BattleState;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
}

export interface SkillDispelResult {
  target: Fighter;
  resolution: DispelResolution;
}

function uniqueFighters(fighters: Fighter[]): Fighter[] {
  return [...new Map(fighters.map((fighter) => [fighter.id, fighter])).values()];
}

function resolveTargets(
  runtime: SkillDispelRuntime,
  spec: SkillDispelSpec,
  user: Fighter,
  fallbackTarget: Fighter,
): Fighter[] {
  const targetMode = spec.target ?? 'target';
  if (targetMode === 'user') return [user];
  if (targetMode === 'allies') {
    const teamId = runtime.getTeamId(user);
    return uniqueFighters(runtime.fighters.filter((fighter) =>
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === teamId &&
      canProvideHerobrineSupport(runtime.battleState, user, fighter),
    ));
  }
  return canProvideHerobrineSupport(runtime.battleState, user, fallbackTarget)
    ? [fallbackTarget]
    : [];
}

export function resolveDeclarativeSkillDispel(
  runtime: SkillDispelRuntime,
  skill: SkillDefinition,
  user: Fighter,
  fallbackTarget: Fighter,
  timing: SkillDispelTiming,
  defaultTiming: SkillDispelTiming,
): SkillDispelResult[] {
  return (skill.dispelSpecs ?? []).flatMap((spec) => {
    if ((spec.timing ?? defaultTiming) !== timing) return [];
    const options: DispelOptions = {
      strength: spec.strength,
      direction: spec.direction,
      includeNeutral: spec.includeNeutral,
      includeIndependent: spec.includeIndependent,
      identityIds: spec.identityIds,
      excludeIdentityIds: spec.excludeIdentityIds,
    };
    return resolveTargets(runtime, spec, user, fallbackTarget).map((target) => ({
      target,
      resolution: runtime.dispelStatusEffects(target, options),
    }));
  });
}
