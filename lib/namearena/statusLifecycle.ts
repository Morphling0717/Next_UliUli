import type { Fighter, StatusEntry, StatusExpiryPoint, StatusTickMode } from './types';
import { getStatusTickMode } from './statusRules';

const CHARGE_ONLY_STATUS_TYPES = new Set([
  'AIM',
  'SPELL_BLOCK',
  'WAIT_COUNTER',
]);

const HYBRID_TRIGGER_STATUS_TYPES = new Set([
  'COUNTER',
  'VALO_HOLDING_ANGLE',
]);

function lifecycleFor(type: string): { tickMode: StatusTickMode; expiresOn: StatusExpiryPoint } {
  if (CHARGE_ONLY_STATUS_TYPES.has(type)) return { tickMode: 'trigger', expiresOn: 'trigger' };
  if (HYBRID_TRIGGER_STATUS_TYPES.has(type) || type.startsWith('CTR_')) {
    return { tickMode: 'self', expiresOn: 'self_turn_end' };
  }
  const tickMode = getStatusTickMode(type);
  if (tickMode === 'global') return { tickMode, expiresOn: 'global_action_end' };
  if (tickMode === 'self') return { tickMode, expiresOn: 'self_turn_end' };
  if (tickMode === 'trigger') return { tickMode, expiresOn: 'trigger' };
  return { tickMode, expiresOn: 'never' };
}

export function normalizeStatusEntry(status: StatusEntry): StatusEntry {
  const lifecycle = lifecycleFor(status.type);
  status.tickMode = status.tickMode ?? lifecycle.tickMode;
  status.expiresOn = status.expiresOn ?? lifecycle.expiresOn;

  if (status.expiresOn === 'trigger') {
    status.charges = status.type === 'WAIT_COUNTER' || status.type === 'AIM'
      ? 1
      : status.duration >= 999
      ? 999
      : Math.max(1, Math.floor(status.charges ?? status.duration ?? 1));
    status.duration = status.charges;
    delete status.remainingTurns;
    return status;
  }

  if (HYBRID_TRIGGER_STATUS_TYPES.has(status.type) || status.type.startsWith('CTR_')) {
    status.charges = Math.max(1, Math.floor(status.charges ?? 1));
  }

  if (status.duration >= 999) {
    status.tickMode = 'permanent';
    status.expiresOn = 'never';
  }
  if (status.expiresOn === 'never') {
    status.duration = 999;
    delete status.remainingTurns;
    return status;
  }

  status.remainingTurns = Math.max(0, Math.floor(status.remainingTurns ?? status.duration));
  status.duration = status.remainingTurns;
  return status;
}

export function createLifecycleStatus(
  type: string,
  duration: number,
  sourceId?: string,
  extras: Partial<StatusEntry> = {},
): StatusEntry {
  return normalizeStatusEntry({
    type,
    duration,
    ...(sourceId ? { sourceId } : {}),
    ...extras,
  });
}

export function refreshLifecycleStatus(status: StatusEntry, duration: number): StatusEntry {
  normalizeStatusEntry(status);
  if (status.expiresOn === 'trigger') {
    status.charges = Math.max(status.charges ?? 1, Math.floor(duration));
    status.duration = status.charges;
  } else if (duration >= 999) {
    status.tickMode = 'permanent';
    status.expiresOn = 'never';
    status.duration = 999;
    delete status.remainingTurns;
  } else if (status.expiresOn !== 'never') {
    status.remainingTurns = Math.max(status.remainingTurns ?? status.duration, Math.floor(duration));
    status.duration = status.remainingTurns;
  }
  delete status.appliedTurn;
  return status;
}

export function consumeStatusCharge(fighter: Fighter, status: StatusEntry): boolean {
  normalizeStatusEntry(status);
  const charges = Math.max(1, status.charges ?? 1);
  if (charges >= 999) return false;
  if (charges > 1) {
    status.charges = charges - 1;
    if (status.expiresOn === 'trigger') status.duration = status.charges;
    return false;
  }
  fighter.status = fighter.status.filter((entry) => entry !== status);
  return true;
}

export function tickStatusTurn(status: StatusEntry): boolean {
  normalizeStatusEntry(status);
  if (status.expiresOn === 'never' || status.expiresOn === 'trigger') return false;
  const remaining = Math.max(0, status.remainingTurns ?? status.duration);
  if (remaining <= 1) {
    status.remainingTurns = 0;
    status.duration = 0;
    return true;
  }
  status.remainingTurns = remaining - 1;
  status.duration = status.remainingTurns;
  return false;
}

export function statusDurationText(status: StatusEntry): string | undefined {
  normalizeStatusEntry(status);
  const parts: string[] = [];
  if (status.expiresOn !== 'never' && status.expiresOn !== 'trigger' && (status.remainingTurns ?? 0) > 0) {
    parts.push(`${status.remainingTurns}回合`);
  }
  if ((status.charges ?? 0) > 0 && (status.charges ?? 0) < 999) parts.push(`${status.charges}次`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
