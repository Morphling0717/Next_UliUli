export const CONTROL_STATUS_TYPES: string[] = [
  'STUN',
  'FREEZE',
  'CONFUSED',
  'CHARMED',
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'WT_REPAIRING',
];

export const BKB_BLOCKED_STATUS_TYPES: string[] = [
  ...CONTROL_STATUS_TYPES,
  'SILENCE',
];

export const COMMON_NEGATIVE_STATUS_TYPES: string[] = [
  'STUN',
  'FREEZE',
  'BURN',
  'POISON',
  'BLIND',
  'SILENCE',
  'CONFUSED',
  'CHARMED',
  'VALO_FLASH',
  'VALO_AIM_PUNCH',
  'NEURAL_THEFT_DEBUFF',
];

export const DOT_STATUS_TYPES: string[] = [
  'POISON',
  'BURN',
  'WATER_PRISON',
];

export const GLOBAL_TIMED_STATUS_TYPES: string[] = [
  'INVUL',
  'BKB',
  'ETHEREAL',
  'SYNERGY_SLACKING',
  'TING_DEFIANCE',
];

export const TRIGGER_TIMED_STATUS_TYPES: string[] = [
  'AIM',
  'COUNTER',
  'SPELL_BLOCK',
  'VALO_HOLDING_ANGLE',
  'WAIT_COUNTER',
];

export const PERMANENT_STATUS_TYPES: string[] = [
  'LIQUID_BODY',
  'PUPPET_MASTER',
  'WT_ERA',
];

export const PERMANENT_STATUS_PREFIXES: string[] = [
  'PLUG_',
  'STYLE_',
];

export const SLACKING_AWAY_STATUS_TYPES: string[] = [
  'SYNERGY_SLACKING',
  'INVUL',
  'STUN',
  'BKB',
  'SPELL_BLOCK',
];

export const SLACKING_RETURN_PROTECTION_STATUS_TYPES: string[] = [
  'INVUL',
  'STUN',
  'BKB',
  'SPELL_BLOCK',
];

export const REVIVE_CLEAN_STATUS_TYPES: string[] = [
  ...COMMON_NEGATIVE_STATUS_TYPES,
  'WATER_PRISON',
  'WT_SUPPRESS',
  'WT_AIRBORNE',
  'WT_REPAIRING',
  'NO_HEAL',
  'WEAK',
  'ZEROED',
];

export function isStatusType(type: string, statusTypes: readonly string[]): boolean {
  return statusTypes.includes(type);
}

export type StatusTickMode = 'self' | 'global' | 'trigger' | 'permanent';

export function getStatusTickMode(type: string): StatusTickMode {
  if (PERMANENT_STATUS_PREFIXES.some((prefix) => type.startsWith(prefix))) return 'permanent';
  if (isStatusType(type, PERMANENT_STATUS_TYPES)) return 'permanent';
  if (isStatusType(type, TRIGGER_TIMED_STATUS_TYPES)) return 'trigger';
  if (isStatusType(type, GLOBAL_TIMED_STATUS_TYPES)) return 'global';
  return 'self';
}
