import type { StatusEffectsMap, StatusEntry } from './types';
import { getDefenseStatusDisplayName } from './defenseStatus';

const IMPORTANT_REMOVED_STATUS_TYPES = new Set([
  'BKB',
  'COUNTER',
  'DIVA_FINAL_CHORUS',
  'DIVA_HEADPHONE_GUARD',
  'DIVA_SONG',
  'INVUL',
  'LIQUID_BODY',
  'RAGE',
  'SPELL_BLOCK',
  'SYNERGY_SLACKING',
  'TING_DEFIANCE',
  'TOKUSATSU_DEFIANCE',
  'VALO_HARBOR_WALL',
  'VALO_ULT_EMPRESS',
  'VALO_ULT_RUN_IT_BACK',
  'WAIT_COUNTER',
]);

function statusKey(status: StatusEntry): string {
  return `${status.type}\u0000${status.sourceId ?? ''}`;
}

function shouldReportRemovedStatus(status: StatusEntry): boolean {
  return IMPORTANT_REMOVED_STATUS_TYPES.has(status.type) ||
    status.type.startsWith('CTR_') ||
    status.type.startsWith('PLUG_') ||
    status.type.startsWith('STYLE_');
}

export function getImportantRemovedStatuses(before: StatusEntry[], after: StatusEntry[]): StatusEntry[] {
  const remainingCounts = new Map<string, number>();
  after.forEach((status) => {
    const key = statusKey(status);
    remainingCounts.set(key, (remainingCounts.get(key) ?? 0) + 1);
  });

  const removed: StatusEntry[] = [];
  before.forEach((status) => {
    if (!shouldReportRemovedStatus(status)) return;
    const key = statusKey(status);
    const remaining = remainingCounts.get(key) ?? 0;
    if (remaining > 0) {
      remainingCounts.set(key, remaining - 1);
      return;
    }
    removed.push(status);
  });
  return removed;
}

function statusDisplayName(status: StatusEntry, statusEffects: StatusEffectsMap): string {
  const defenseName = getDefenseStatusDisplayName(status);
  if (defenseName) return defenseName;
  return statusEffects[status.type]?.name ?? status.type;
}

export function formatRemovedStatusList(statuses: StatusEntry[], statusEffects: StatusEffectsMap): string {
  const names = [...new Set(statuses.map((status) => statusDisplayName(status, statusEffects)))];
  return names.map((name) => `【${name}】`).join('、');
}
