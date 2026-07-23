import type { Fighter, StatusApplication } from '../types';
import {
  findDefenseStatus,
  formatControlBlocked,
} from '../defenseStatus';
import { applyStatus } from '../statusSystem';
import { getStatusIdentityDefinition, identityHasTag } from '../statusRegistry';
import type { ActionResolutionRuntime } from './types';

export type HostileStatusOptions = StatusApplication;

export function tryApplyHostileStatus(
  runtime: Pick<ActionResolutionRuntime, 'log'>,
  target: Fighter,
  application: HostileStatusOptions,
): boolean {
  const type = application.identityId;
  const controlImmune = findDefenseStatus(target, 'BKB');
  if (controlImmune && identityHasTag(type, 'spell_immunity_blocked')) {
    if (application.logBlocked ?? true) {
      const statusName = getStatusIdentityDefinition(type).displayName;
      const effectSource = application.effectName;
      const effectName = effectSource
        ? effectSource.includes(statusName) ? effectSource : `${effectSource}的${statusName}效果`
        : `${statusName}效果`;
      runtime.log('info', formatControlBlocked(controlImmune, target.name, effectName));
    }
    return false;
  }

  applyStatus(target, application);
  return true;
}
