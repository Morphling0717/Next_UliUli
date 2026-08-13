import type { BattleEvent, Fighter } from './types';
import { getSummonCardArt } from './summonCardArt';
import { getTokusatsuFullBodyForJob, getTokusatsuStageAvatar } from './tokusatsuArt';
import { shouldRenderNpcUnit } from './npcCombat';
import { getHerobrineArtSlot } from './herobrineArt';

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
  battleRunId: number;
};

export function toggleStageManualFocus(
  current: StageManualFocus | null,
  fighterId: string,
  battleRunId: number,
): StageManualFocus | null {
  if (current?.battleRunId === battleRunId && current.fighterId === fighterId) return null;
  return { fighterId, battleRunId };
}

export function resolveStageManualFocusId(
  manualFocus: StageManualFocus | null,
  battleRunId: number,
): string | null {
  return manualFocus?.battleRunId === battleRunId ? manualFocus.fighterId : null;
}

export function shouldRenderFighterOnStage(fighter: Fighter): boolean {
  if (fighter.isNpc && !shouldRenderNpcUnit(fighter)) return false;
  const defeated = fighter.isDead || fighter.isDeadAnnounced || fighter.currentHp <= 0;
  return !defeated || (!fighter.isNpc && !fighter.isSummon);
}

export function getStageFighterImage(fighter?: Fighter): string | undefined {
  const herobrineArt = getHerobrineArtSlot(fighter);
  if (herobrineArt?.imagePath) return herobrineArt.imagePath;
  if (fighter?.isSigua) return '/Model.webp';
  const tokusatsuAvatar = getTokusatsuStageAvatar(fighter);
  if (tokusatsuAvatar) return tokusatsuAvatar;
  if (fighter?.isSummon) {
    return getSummonCardArt(fighter.summonBaseName ?? fighter.name).avatarPath;
  }
  return undefined;
}

export function getStageFinisherImage(fighter?: Fighter): string | undefined {
  if (fighter?.isTokusatsu) {
    return getTokusatsuFullBodyForJob(fighter.job) ?? getTokusatsuStageAvatar(fighter);
  }
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
  if (total <= 18 && hasDesktopStage && safeWidth / safeHeight >= 1.05) return ringPositions(total);

  const crowded = total > 18;
  const lowStage = safeHeight < 500;
  const nominalCardWidth = crowded
    ? lowStage
      ? safeWidth < 420 ? 80 : 90
      : safeWidth < 500 ? 110 : 120
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
  return createStagePositionMap(
    fighters.filter(shouldRenderFighterOnStage).map((fighter) => fighter.id),
    width,
    height,
  );
}

export function createStagePositionMap(
  fighterIds: readonly string[],
  width: number,
  height: number,
): Map<string, StagePosition> {
  const positions = createStagePositions(fighterIds.length, width, height);
  return new Map(fighterIds.map((fighterId, index) => [fighterId, positions[index] ?? { x: 50, y: 47 }]));
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

export function appendStageLogGroup(
  groups: readonly StageLogGroup[],
  log: StageLogEntry,
  maxGroups = 16,
  maxLogsPerGroup = 5,
): StageLogGroup[] {
  const previous = groups[groups.length - 1];
  if (log.actionId && previous?.actionId === log.actionId) {
    const sharedMetadata = {
      actorId: log.actorId ?? previous.actorId,
      skillName: log.skillName ?? previous.skillName,
      turn: log.turn ?? previous.turn,
      largeRound: log.largeRound ?? previous.largeRound,
    };
    if (previous.logs.length < maxLogsPerGroup) {
      return [
        ...groups.slice(0, -1),
        { ...previous, ...sharedMetadata, logs: [...previous.logs, log] },
      ];
    }

    const nextPart = previous.part + 1;
    const continued = groups.map((group) =>
      group.actionId === log.actionId && group.partCount !== nextPart
        ? { ...group, partCount: nextPart }
        : group,
    );
    const baseKey = previous.key.replace(/-part-\d+$/, '');
    continued.push({
      key: `${baseKey}-part-${nextPart}`,
      actionId: log.actionId,
      ...sharedMetadata,
      part: nextPart,
      partCount: nextPart,
      logs: [log],
    });
    return continued.slice(-maxGroups);
  }

  const eventKey = log.id ?? log.sequence ?? `${log.turn ?? 0}-${groups.length}`;
  const actionKey = log.actionId ?? `event-${eventKey}`;
  return [
    ...groups,
    {
      key: `${actionKey}-group-${eventKey}-part-1`,
      actionId: log.actionId,
      actorId: log.actorId,
      skillName: log.skillName ?? undefined,
      turn: log.turn,
      largeRound: log.largeRound,
      part: 1,
      partCount: 1,
      logs: [log],
    },
  ].slice(-maxGroups);
}
