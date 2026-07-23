const INTERNAL_TEAM_ID = /^(?:id-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function formatTeamDisplayLabel(teamId: string | undefined): string | undefined {
  if (!teamId || teamId.startsWith('MOMO_SOLO:') || teamId === 'PURUISAISHI_EVENT') return undefined;
  if (teamId === 'WATER_TEAM') return '水人阵营';
  if (INTERNAL_TEAM_ID.test(teamId)) return undefined;
  return teamId;
}
