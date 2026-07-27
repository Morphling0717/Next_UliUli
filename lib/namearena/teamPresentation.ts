import type { Fighter } from './types';
import { getSurtrResolvedTeamId } from './surtrMechanics';

const INTERNAL_TEAM_ID = /^(?:id-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function formatTeamDisplayLabel(teamId: string | undefined): string | undefined {
  if (
    !teamId ||
    teamId.startsWith('MOMO_SOLO:') ||
    teamId.startsWith('SURTR_CONFLICT:') ||
    teamId.startsWith('SURTR_LEGACY:') ||
    teamId === 'PURUISAISHI_EVENT'
  ) return undefined;
  if (teamId === 'WATER_TEAM') return '水人阵营';
  if (INTERNAL_TEAM_ID.test(teamId)) return undefined;
  return teamId;
}

function getPresentationTeamId(
  fighter: Fighter,
  fighters: readonly Fighter[],
  resolving: Set<string>,
): string {
  if (fighter.isMorphling || fighter.isSon) return fighter.teamId ?? 'WATER_TEAM';

  const fallback = fighter.teamId ?? fighter.summonerId ?? fighter.id;
  if (resolving.has(fighter.id)) return fallback;

  resolving.add(fighter.id);
  try {
    if (fighter.isSurtr && fighter.surtrState) {
      return getSurtrResolvedTeamId({
        fighters: [...fighters],
        getTeamId: (candidate) => candidate.id === fighter.id
          ? fallback
          : getPresentationTeamId(candidate, fighters, resolving),
        isActiveCombatant: (candidate) =>
          !candidate.isDead &&
          !candidate.isDeadAnnounced &&
          candidate.currentHp > 0,
      }, fighter);
    }
    if (fighter.isSummon && fighter.summonerId) {
      const summoner = fighters.find((candidate) => candidate.id === fighter.summonerId);
      return summoner
        ? getPresentationTeamId(summoner, fighters, resolving)
        : fighter.summonerId;
    }
    return fighter.teamId ?? fighter.id;
  } finally {
    resolving.delete(fighter.id);
  }
}

export function formatFighterTeamDisplayLabel(
  fighter: Fighter,
  fighters: readonly Fighter[],
): string | undefined {
  return formatTeamDisplayLabel(getPresentationTeamId(fighter, fighters, new Set()));
}
