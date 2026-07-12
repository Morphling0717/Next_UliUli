import type { Fighter } from '../types';
import {
  findDefenseStatus,
  formatControlBlocked,
  grantStatus,
} from '../defenseStatus';
import { BKB_BLOCKED_STATUS_TYPES, isStatusType } from '../statusRules';
import type { ActionResolutionRuntime } from './types';

export type HostileStatusOptions = {
  sourceId?: string;
  effectName?: string;
  logBlocked?: boolean;
};

export function tryApplyHostileStatus(
  runtime: Pick<ActionResolutionRuntime, 'statusEffects' | 'log'>,
  target: Fighter,
  type: string,
  duration: number,
  options: HostileStatusOptions = {},
): boolean {
  const controlImmune = findDefenseStatus(target, 'BKB');
  if (controlImmune && isStatusType(type, BKB_BLOCKED_STATUS_TYPES)) {
    if (options.logBlocked ?? true) {
      const effectName = options.effectName ?? `${runtime.statusEffects[type]?.name ?? type}效果`;
      runtime.log('info', formatControlBlocked(controlImmune, target.name, effectName));
    }
    return false;
  }

  grantStatus(target, type, duration, options.sourceId);
  return true;
}
