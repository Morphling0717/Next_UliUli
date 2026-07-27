import type { DamageApplicationOptions } from './types';

export type DamageRedirectKind = 'joker' | 'originium' | 'owl_emperor' | 'momo' | 'yuzu' | null;

export function getDamageRedirectKind(options: DamageApplicationOptions): DamageRedirectKind {
  if (options.redirectedByJoker) return 'joker';
  if (options.redirectedByOriginiumCore) return 'originium';
  if (options.redirectedByOwlEmperor) return 'owl_emperor';
  if (options.redirectedByMomo) return 'momo';
  if (options.redirectedByYuzu) return 'yuzu';
  return null;
}

export function isDamageRedirected(options: DamageApplicationOptions): boolean {
  return getDamageRedirectKind(options) !== null;
}

/** The intended target was hit even if a scripted active state prevented HP loss. */
export function didDamageConnect(actualTargetDamage: number, options: DamageApplicationOptions): boolean {
  return actualTargetDamage > 0 || options.hitWithoutHpDamage === true;
}

/** Total HP damage caused by this hit, including any share/redirect recipient. */
export function getResolvedDamageTotal(actualTargetDamage: number, options: DamageApplicationOptions): number {
  switch (getDamageRedirectKind(options)) {
    case 'joker':
      return options.redirectedJokerDamage ?? actualTargetDamage;
    case 'originium':
      return options.redirectedOriginiumDamage ?? actualTargetDamage;
    case 'owl_emperor':
      return options.redirectedOwlEmperorDamage ?? actualTargetDamage;
    case 'momo':
      return options.redirectedMomoDamage ?? actualTargetDamage;
    case 'yuzu':
      return actualTargetDamage + (options.redirectedYuzuDamage ?? 0);
    default:
      return actualTargetDamage;
  }
}
