import type { Fighter, JobDefinition, StatusEntry } from './types';

export function cloneJobDefinition(job: JobDefinition): JobDefinition {
  return JSON.parse(JSON.stringify(job)) as JobDefinition;
}

export function cloneStatuses(status: StatusEntry[] = []): StatusEntry[] {
  return status.map((s) => ({ ...s }));
}

export function syncHpPct(fighter: Fighter): void {
  fighter.hpPct = fighter.maxHp > 0 ? Math.max(0, fighter.currentHp) / fighter.maxHp : 0;
}

export function setCurrentHp(fighter: Fighter, hp: number): void {
  fighter.currentHp = Math.max(0, Math.min(fighter.maxHp, hp));
  syncHpPct(fighter);
}

export function healFighter(fighter: Fighter, amount: number): number {
  if (amount <= 0 || fighter.currentHp >= fighter.maxHp) return 0;
  const before = fighter.currentHp;
  setCurrentHp(fighter, fighter.currentHp + amount);
  return fighter.currentHp - before;
}

export function isActiveCombatant(fighter: Fighter): boolean {
  return !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0;
}

export function hasStatus(fighter: Fighter, type: string): boolean {
  return fighter.status.some((s) => s.type === type);
}

export function addStatus(fighter: Fighter, type: string, duration: number, sourceId?: string): void {
  fighter.status.push({ type, duration, ...(sourceId ? { sourceId } : {}) });
}

export function removeStatuses(fighter: Fighter, shouldRemove: (status: StatusEntry) => boolean): void {
  fighter.status = fighter.status.filter((s) => !shouldRemove(s));
}

export function cloneFighter(fighter: Fighter): Fighter {
  return {
    ...fighter,
    jobData: fighter.jobData ? cloneJobDefinition(fighter.jobData) : fighter.jobData,
    status: cloneStatuses(fighter.status),
    stats: { ...fighter.stats },
    exodiaPieces: fighter.exodiaPieces ? [...fighter.exodiaPieces] : fighter.exodiaPieces,
  };
}

export function cloneFighters(fighters: Fighter[]): Fighter[] {
  return fighters.map(cloneFighter);
}
