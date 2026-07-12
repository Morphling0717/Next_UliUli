import type { Fighter, StatKey } from './types';

export const EMOTE_STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];
export const EMOTE_DEATH_GAIN_KEYS = ['maxHp', ...EMOTE_STAT_KEYS] as const;

export type EmoteStatKey = typeof EMOTE_DEATH_GAIN_KEYS[number];
export type EmoteStatMap = Record<EmoteStatKey, number>;

const STAT_LABELS: Record<EmoteStatKey, string> = {
  maxHp: '血',
  atk: '攻',
  def: '防',
  spd: '速',
  agl: '闪',
  mag: '魔',
  res: '抗',
  wis: '智',
};

export function emptyEmoteStats(): EmoteStatMap {
  return { maxHp: 0, atk: 0, def: 0, spd: 0, agl: 0, mag: 0, res: 0, wis: 0 };
}

function syncHpPct(fighter: Fighter): void {
  fighter.hpPct = fighter.maxHp > 0 ? Math.max(0, fighter.currentHp) / fighter.maxHp : 0;
}

export function normalizeEmoteStats(stats?: Partial<Record<EmoteStatKey, number>>): EmoteStatMap {
  const normalized = emptyEmoteStats();
  EMOTE_DEATH_GAIN_KEYS.forEach((key) => {
    normalized[key] = Math.max(0, Math.floor(stats?.[key] ?? 0));
  });
  return normalized;
}

export function ensureEmoteAdaptStats(fighter: Fighter): EmoteStatMap {
  const normalized = normalizeEmoteStats(fighter.emoteAdaptStats);
  fighter.emoteAdaptStats = normalized;
  return normalized;
}

export function totalEmoteStats(stats?: Partial<Record<EmoteStatKey, number>>): number {
  const normalized = normalizeEmoteStats(stats);
  return EMOTE_DEATH_GAIN_KEYS.reduce((sum, key) => sum + normalized[key], 0);
}

export function getEmoteAdaptTotal(fighter: Fighter): number {
  return totalEmoteStats(fighter.emoteAdaptStats);
}

export function getEmoteClaimableKills(fighter: Fighter): number {
  return Math.max(0, Math.floor(fighter.stats.kills) - Math.floor(fighter.emoteClaimedKills ?? 0));
}

export function consumeEmoteClaimableKills(fighter: Fighter, amount = 1): number {
  const before = getEmoteClaimableKills(fighter);
  const consumed = Math.min(before, Math.max(0, Math.floor(amount)));
  if (consumed > 0) fighter.emoteClaimedKills = (fighter.emoteClaimedKills ?? 0) + consumed;
  return consumed;
}

export function addStatsToFighter(
  fighter: Fighter,
  gain: Partial<Record<EmoteStatKey, number>>,
  options: { healAddedMaxHp?: boolean } = {},
): void {
  const maxHpGain = Math.floor(gain.maxHp ?? 0);
  if (maxHpGain > 0) {
    fighter.maxHp += maxHpGain;
    if (options.healAddedMaxHp ?? true) fighter.currentHp += maxHpGain;
    syncHpPct(fighter);
  }
  EMOTE_STAT_KEYS.forEach((key) => {
    const amount = Math.floor(gain[key] ?? 0);
    if (amount > 0) fighter[key] += amount;
  });
}

export function removeStatsFromFighter(fighter: Fighter, bonus: Partial<Record<EmoteStatKey, number>>): void {
  const maxHpBonus = Math.floor(bonus.maxHp ?? 0);
  if (maxHpBonus > 0) {
    fighter.maxHp = Math.max(1, fighter.maxHp - maxHpBonus);
    fighter.currentHp = Math.min(fighter.currentHp, fighter.maxHp);
    syncHpPct(fighter);
  }
  EMOTE_STAT_KEYS.forEach((key) => {
    const amount = Math.floor(bonus[key] ?? 0);
    if (amount > 0) fighter[key] = Math.max(1, fighter[key] - amount);
  });
}

export function buildEmoteStatGain(
  source: Fighter,
  ratio: number,
  keys: EmoteStatKey[] = EMOTE_STAT_KEYS,
  minPositiveGain = 1,
): EmoteStatMap {
  const gain = emptyEmoteStats();
  keys.forEach((key) => {
    const raw = Math.floor(source[key] * ratio);
    gain[key] = Math.max(minPositiveGain, raw);
  });
  return gain;
}

export function grantEmoteAdaptStats(
  emote: Fighter,
  source: Fighter,
  ratio: number,
  keys: EmoteStatKey[] = EMOTE_STAT_KEYS,
  minPositiveGain = 1,
  options: { healAddedMaxHp?: boolean } = {},
): EmoteStatMap {
  const gain = buildEmoteStatGain(source, ratio, keys, minPositiveGain);
  addStatsToFighter(emote, gain, options);
  const adaptStats = ensureEmoteAdaptStats(emote);
  EMOTE_DEATH_GAIN_KEYS.forEach((key) => {
    adaptStats[key] += gain[key];
  });
  return gain;
}

export function formatEmoteStats(stats: Partial<Record<EmoteStatKey, number>>): string {
  const parts = EMOTE_DEATH_GAIN_KEYS
    .map((key) => [key, Math.floor(stats[key] ?? 0)] as const)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${STAT_LABELS[key]}+${value}`);
  return parts.length > 0 ? parts.join(' / ') : '无属性增长';
}

export function randomEmoteStatKeys(count: number): StatKey[] {
  const pool = [...EMOTE_STAT_KEYS];
  const selected: StatKey[] = [];
  while (selected.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    const [key] = pool.splice(index, 1);
    if (key) selected.push(key);
  }
  return selected;
}
