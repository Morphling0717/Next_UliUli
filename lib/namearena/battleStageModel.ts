import type { BattleEvent, Fighter } from './types';
import { getSummonCardArt } from './summonCardArt';

export type StagePosition = { x: number; y: number };

export type StageLogEntry = Pick<BattleEvent, 'type' | 'text'> &
  Partial<Omit<BattleEvent, 'type' | 'text'>>;

export type StageLogGroup = {
  key: string;
  actionId?: string;
  actorId?: string;
  skillName?: string;
  turn?: number;
  largeRound?: number;
  part: number;
  partCount: number;
  logs: StageLogEntry[];
};

export type StageManualFocus = {
  fighterId: string;
  focusCycleKey: string;
};

export function getStageFocusCycleKey(
  log: StageLogEntry | undefined,
  battleRunId: number,
  battleTurn: number,
  actorId?: string,
): string {
  const actionKey = log?.actionId ?? `turn-${log?.turn ?? battleTurn}`;
  return `run-${battleRunId}:${actionKey}:actor-${actorId ?? log?.actorId ?? 'global'}`;
}

export function resolveStageManualFocusId(
  manualFocus: StageManualFocus | null,
  focusCycleKey: string,
): string | null {
  return manualFocus?.focusCycleKey === focusCycleKey ? manualFocus.fighterId : null;
}

export function shouldRenderFighterOnStage(fighter: Fighter): boolean {
  const defeated = fighter.isDead || fighter.isDeadAnnounced || fighter.currentHp <= 0;
  return !defeated || (!fighter.isNpc && !fighter.isSummon);
}

export function getStageFighterImage(fighter?: Fighter): string | undefined {
  if (fighter?.isSigua) return '/Model.webp';
  if (fighter?.isSummon && fighter.isAdvancedSummon) {
    return getSummonCardArt(fighter.summonBaseName ?? fighter.name).avatarPath;
  }
  return undefined;
}

export function getStageFinisherImage(fighter?: Fighter): string | undefined {
  if (fighter?.isSummon && fighter.isAdvancedSummon) {
    const art = getSummonCardArt(fighter.summonBaseName ?? fighter.name);
    return art.cutinPath ?? art.avatarPath;
  }
  return getStageFighterImage(fighter);
}

function ringPositions(total: number): StagePosition[] {
  const ringSizes = total <= 8
    ? [total]
    : total <= 16
      ? [Math.min(9, Math.ceil(total * 0.6)), total - Math.min(9, Math.ceil(total * 0.6))]
      : [10, Math.min(8, total - 10), Math.max(0, total - 18)];
  const radii = [
    { x: 39, y: 27 },
    { x: 24, y: 16 },
    { x: 11, y: 8 },
  ];
  const positions: StagePosition[] = [];

  ringSizes.forEach((count, ringIndex) => {
    if (count <= 0) return;
    const radius = radii[ringIndex] ?? radii[radii.length - 1];
    const offset = -Math.PI / 2 + (ringIndex % 2 === 0 ? Math.PI / Math.max(4, count) : 0);
    for (let index = 0; index < count; index += 1) {
      const angle = offset + (Math.PI * 2 * index) / count;
      positions.push({
        x: 50 + Math.cos(angle) * radius.x,
        y: 49 + Math.sin(angle) * radius.y,
      });
    }
  });
  return positions;
}

export function createStagePositions(total: number, width: number, height: number): StagePosition[] {
  if (total <= 0) return [];
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(260, height);
  const hasDesktopStage = safeHeight >= 500 || safeWidth >= 900;
  if (total <= 26 && hasDesktopStage && safeWidth / safeHeight >= 1.05) return ringPositions(total);

  const crowded = total > 18;
  const lowStage = safeHeight < 500;
  const nominalCardWidth = crowded
    ? 78
    : lowStage && total > 12 && safeWidth < 420
      ? 78
      : lowStage
        ? 108
        : safeWidth < 500
          ? 126
          : 138;
  const maxColumns = Math.max(2, Math.floor((safeWidth - 24) / nominalCardWidth));
  const portraitLimit = safeWidth < safeHeight ? 3 : maxColumns;
  const columns = Math.max(2, Math.min(total, portraitLimit, maxColumns));
  const rows = Math.ceil(total / columns);
  const top = lowStage ? 28 : 18;
  const bottom = lowStage ? 84 : 78;

  return Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const countInRow = Math.min(columns, total - row * columns);
    return {
      x: countInRow === 1 ? 50 : 8 + (84 * column) / (countInRow - 1),
      y: rows === 1 ? (top + bottom) / 2 : top + ((bottom - top) * row) / (rows - 1),
    };
  });
}

export function createVisibleStagePositionMap(
  fighters: readonly Fighter[],
  width: number,
  height: number,
): Map<string, StagePosition> {
  const visibleFighters = fighters.filter(shouldRenderFighterOnStage);
  const positions = createStagePositions(visibleFighters.length, width, height);
  return new Map(visibleFighters.map((fighter, index) => [fighter.id, positions[index] ?? { x: 50, y: 47 }]));
}

export function buildStageLogGroups(
  logs: StageLogEntry[],
  maxGroups = 16,
  maxLogsPerGroup = 5,
): StageLogGroup[] {
  const actions: Array<Omit<StageLogGroup, 'part' | 'partCount'>> = [];
  logs.forEach((log, index) => {
    const actionKey = log.actionId ?? `event-${log.id ?? index}-${log.sequence ?? index}`;
    const previous = actions[actions.length - 1];
    if (log.actionId && previous?.actionId === log.actionId) {
      previous.logs.push(log);
      previous.skillName = log.skillName ?? previous.skillName;
      previous.actorId = log.actorId ?? previous.actorId;
      previous.turn = log.turn ?? previous.turn;
      previous.largeRound = log.largeRound ?? previous.largeRound;
      return;
    }
    actions.push({
      key: `${actionKey}-group-${log.id ?? log.sequence ?? index}`,
      actionId: log.actionId,
      actorId: log.actorId,
      skillName: log.skillName ?? undefined,
      turn: log.turn,
      largeRound: log.largeRound,
      logs: [log],
    });
  });

  const chunks = actions.flatMap((action) => {
    const partCount = Math.ceil(action.logs.length / maxLogsPerGroup);
    return Array.from({ length: partCount }, (_, part) => ({
      ...action,
      key: `${action.key}-part-${part + 1}`,
      part: part + 1,
      partCount,
      logs: action.logs.slice(part * maxLogsPerGroup, (part + 1) * maxLogsPerGroup),
    }));
  });
  return chunks.slice(-maxGroups);
}
