import type { Fighter, StatusApplicationOptions } from '../types';
import {
  findDefenseStatus,
  formatControlBlocked,
  grantStatus,
} from '../defenseStatus';
import { BKB_BLOCKED_STATUS_TYPES, isStatusType, shouldTrackStatusApplier } from '../statusRules';
import type { ActionResolutionRuntime } from './types';

export type HostileStatusOptions = StatusApplicationOptions;

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
  const appliedStatus = target.status.find((status) =>
    status.type === type && (!options.sourceId || status.sourceId === options.sourceId),
  );
  if (appliedStatus && shouldTrackStatusApplier(type)) {
    if (options.applierId) appliedStatus.applierId = options.applierId;
    if (options.applierName) appliedStatus.applierName = options.applierName;
  }
  return true;
}
