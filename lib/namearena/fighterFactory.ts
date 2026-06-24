import { namerenaCore } from './core';
import { namerenaData } from './data';
import { namerenaJobs } from './jobs';
import { cloneJobDefinition } from './combatState';
import type { Fighter, JobDefinition, StatKey } from './types';

const STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];

function resolveSpecialJobKey(cleanName: string): string | null {
  const lower = cleanName.toLowerCase();
  if (cleanName === '水人' || cleanName === '水人Morphling') return 'SLIME';
  if (cleanName === '玄凝') return 'HIGH_END_GAMER';
  if (cleanName === '屑' || cleanName === '屯硬币的屑') return 'JOKE_KING';
  if (lower === 'm1a2_abrams_sep' || lower === 'm1' || lower === 'arams_sep') return 'WT_GRINDER';
  if (cleanName === '刺猬人' || cleanName === '刺猬人chiray') return 'TOKU_FAN';
  if (cleanName === '牢鳄' || cleanName === '鳄霸') return 'GACHA_ADDICT';
  if (cleanName === '小汀' || cleanName === '小汀公本') return 'RED_FURY_SAMURAI';
  if (cleanName === '克蕾儿丝菲尔') return 'SUCCUBUS';
  if (cleanName === '丝瓜uli' || cleanName === '丝瓜') return 'VIRTUAL_DIVA';
  if (cleanName === '兔卷卷' || cleanName === '兔卷卷curly') return 'Q_BUNNY';
  return null;
}

function resolveRandomJobKey(
  rng: InstanceType<typeof namerenaCore.SeededRNG>,
  jobRng: InstanceType<typeof namerenaCore.SeededRNG>,
): string {
  if (rng.next() < 0.02) return 'ONE_PUNCH';
  if (rng.next() < 0.05) return 'HERO';
  return jobRng.pick(['WARRIOR', 'MAGE', 'ARCHER', 'PRIEST']) ?? 'WARRIOR';
}

export function generateNameArenaFighter(rawInputName: string): Fighter | null {
  const trimmedInput = rawInputName.trim();
  if (!trimmedInput) return null;

  const parts = trimmedInput.split('@');
  const cleanName = parts[0]?.trim() ?? '';
  const teamName = parts.length > 1 ? parts[1]?.trim() || undefined : undefined;
  if (!cleanName) return null;

  const seed = namerenaCore.stringToSeed(trimmedInput);
  const rng = new namerenaCore.SeededRNG(seed);
  const jobRng = teamName ? new namerenaCore.SeededRNG(namerenaCore.stringToSeed(teamName)) : rng;
  const resolvedJobKey = resolveSpecialJobKey(cleanName) ?? resolveRandomJobKey(rng, jobRng);
  const jobMap = namerenaJobs as Partial<Record<string, JobDefinition>>;
  const job = jobMap[resolvedJobKey] ?? jobMap.WARRIOR;
  if (!job) return null;

  const isMorphling = resolvedJobKey === 'SLIME';
  const baseHp = rng.nextInt(200, 300);
  const hp = Math.floor(baseHp * job.hp * (isMorphling ? 0.8 : 1.0));
  const stats = STAT_KEYS.reduce((acc, key) => {
    acc[key] = Math.floor(rng.nextInt(10, 30) * job[key] * (isMorphling ? 0.8 : 1.0));
    return acc;
  }, {} as Record<StatKey, number>);
  const colors = namerenaData.COLORS ?? [];

  return {
    id: namerenaCore.generateUUID ? namerenaCore.generateUUID() : `id-${Math.random()}`,
    name: cleanName,
    displayName: trimmedInput,
    teamId: teamName,
    job: resolvedJobKey,
    jobData: cloneJobDefinition(job),
    maxHp: hp,
    currentHp: hp,
    hpPct: 1.0,
    ...stats,
    critRate: rng.next() * 0.1 + 0.05,
    color: colors.length > 0 ? (teamName ? jobRng.pick(colors) ?? 'text-gray-500' : rng.pick(colors) ?? 'text-gray-500') : 'text-gray-500',
    isDead: false,
    isDeadAnnounced: false,
    status: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    isMorphling,
    isGamer: resolvedJobKey === 'HIGH_END_GAMER',
    isJoker: resolvedJobKey === 'JOKE_KING',
    isTokusatsu: resolvedJobKey === 'TOKU_FAN',
    isGacha: resolvedJobKey === 'GACHA_ADDICT',
    isTing: resolvedJobKey === 'RED_FURY_SAMURAI',
    isSuccubus: resolvedJobKey === 'SUCCUBUS',
    isSigua: resolvedJobKey === 'VIRTUAL_DIVA',
    isTuJuanJuan: resolvedJobKey === 'Q_BUNNY',
    isWT: resolvedJobKey === 'WT_GRINDER',
    transformed: false,
    resurrected: false,
    apm: 0,
    gachaLuck: 0,
    gachaPityPower: 0,
    hasUsedGachaDeathSave: false,
    gachaSummonLifestealPct: 0,
    hasUsedExodiaObliterate: false,
    isSon: false,
    isSummon: false,
    counterUsed: false,
    hasUsedGreatMonsterVictory: false,
    hasUsedRainbowFever: false,
    monsterTurns: 0,
    reviveTurns: 0,
    hasResurrected: false,
    hasDroppedSword: false,
    spinalSwordTurns: 0,
    hasSpinalSword: false,
    ultPoints: 0,
    economy: 0,
    hasTriggeredSlacking: false,
    isActing: false,
    isHit: false,
    defeatHooksResolved: false,
  };
}
