import type { DamageResolutionRecord, Fighter, FighterStats } from './types';

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? value ?? 0 : 0;
}

export function normalizeFighterStats(stats: FighterStats): FighterStats {
  stats.kills = finite(stats.kills);
  stats.dmgDealt = finite(stats.dmgDealt);
  stats.dmgTaken = finite(stats.dmgTaken);
  stats.hpDmgDealt = finite(stats.hpDmgDealt);
  stats.shieldDmgDealt = finite(stats.shieldDmgDealt);
  stats.hpDmgTaken = finite(stats.hpDmgTaken);
  stats.shieldDmgTaken = finite(stats.shieldDmgTaken);
  stats.overkillDmg = finite(stats.overkillDmg);
  stats.damageInstances = finite(stats.damageInstances);
  return stats;
}

export function recordDamageSettlement(
  target: Fighter,
  attacker: Fighter | undefined,
  record: DamageResolutionRecord,
  creditAttacker = true,
): void {
  const targetStats = normalizeFighterStats(target.stats);
  targetStats.dmgTaken += record.hpDamage;
  targetStats.hpDmgTaken = finite(targetStats.hpDmgTaken) + record.hpDamage;
  targetStats.shieldDmgTaken = finite(targetStats.shieldDmgTaken) + record.shieldDamage;

  if (!attacker || !creditAttacker || attacker.id === target.id) return;
  const attackerStats = normalizeFighterStats(attacker.stats);
  const effectiveDamage = record.hpDamage + record.shieldDamage;
  attackerStats.dmgDealt += effectiveDamage;
  attackerStats.hpDmgDealt = finite(attackerStats.hpDmgDealt) + record.hpDamage;
  attackerStats.shieldDmgDealt = finite(attackerStats.shieldDmgDealt) + record.shieldDamage;
  attackerStats.overkillDmg = finite(attackerStats.overkillDmg) + record.overkillDamage;
  if (effectiveDamage > 0) attackerStats.damageInstances = finite(attackerStats.damageInstances) + 1;
}
