import type { Fighter } from './types';

export function selectSpinalSwordSpecialSkill(
  actor: Fighter,
  fighters: Fighter[],
  isActive: (fighter: Fighter) => boolean,
): string | null {
  if (!actor.hasSpinalSword) return null;

  if (Math.random() < 0.15) return 'blood_mist';
  if (actor.jobData?.skills?.includes('summon_puppet_ting')) {
    const hasPuppet = fighters.some((fighter) =>
      fighter.name === '小汀(傀儡)' &&
      isActive(fighter) &&
      fighter.summonerId === actor.id,
    );
    if (!hasPuppet && Math.random() < (actor.isGacha ? 0.3 : 0.1)) return 'summon_puppet_ting';
  }

  return null;
}

export function selectSpinalSwordRouteSkill(
  actor: Fighter,
  fighters: Fighter[],
  isActive: (fighter: Fighter) => boolean,
): string | null {
  if (!actor.hasSpinalSword) return null;
  return selectSpinalSwordSpecialSkill(actor, fighters, isActive) ?? 'spinal_slash';
}

export function shouldUseSpinalSwordRoute(actor: Fighter): boolean {
  return !!actor.hasSpinalSword && !actor.isGacha && Math.random() < 0.5;
}
