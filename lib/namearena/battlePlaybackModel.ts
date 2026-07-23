import { appendStageLogGroup, type StageLogEntry, type StageLogGroup } from "./battleStageModel";
import type { BattleState, Fighter } from "./types";

export type BattleFeedSnapshot<TLog extends StageLogEntry = StageLogEntry> = {
  logs: TLog[];
  groups: StageLogGroup[];
};

export type BattlePlaybackView<TLog extends StageLogEntry = StageLogEntry> = {
  fighters: Fighter[];
  battleTurn: number;
  battleState: BattleState;
  feed: BattleFeedSnapshot<TLog>;
};

export type BattlePlaybackCommit<TLog extends StageLogEntry = StageLogEntry> = {
  fighters: Fighter[];
  battleTurn: number;
  battleState: BattleState;
  log?: TLog;
};

/**
 * Queues an atomic playback frame. Hidden state checkpoints belonging to the
 * preceding visible action are folded into that frame so the stage mutation
 * and the log that explains it are presented together.
 */
export function enqueueBattlePlaybackCommit<TLog extends StageLogEntry>(
  queue: BattlePlaybackCommit<TLog>[],
  commit: BattlePlaybackCommit<TLog>,
): void {
  const log = commit.log;
  if (log?.displayInFeed === false) {
    const previous = queue[queue.length - 1];
    const checkpointKey = log.actionId ?? log.rootEventId;
    const previousKey = previous?.log?.actionId ?? previous?.log?.rootEventId;
    if (previous && checkpointKey && previousKey === checkpointKey) {
      queue[queue.length - 1] = {
        ...previous,
        fighters: commit.fighters,
        battleTurn: commit.battleTurn,
        battleState: commit.battleState,
      };
      return;
    }
  }
  queue.push(commit);
}

export function createBattleFeedSnapshot<TLog extends StageLogEntry>(): BattleFeedSnapshot<TLog> {
  return { logs: [], groups: [] };
}

export function appendBattleFeedEntry<TLog extends StageLogEntry>(
  feed: BattleFeedSnapshot<TLog>,
  log: TLog,
  displayLogLimit = 240,
): BattleFeedSnapshot<TLog> {
  const appendedLogs = [...feed.logs, log];
  return {
    logs: appendedLogs.length > displayLogLimit
      ? appendedLogs.slice(-displayLogLimit)
      : appendedLogs,
    groups: appendStageLogGroup(feed.groups, log),
  };
}

export function createBattlePlaybackView<TLog extends StageLogEntry>(
  battleState: BattleState,
): BattlePlaybackView<TLog> {
  return {
    fighters: [],
    battleTurn: 0,
    battleState,
    feed: createBattleFeedSnapshot<TLog>(),
  };
}

export function clearBattlePlaybackFeed<TLog extends StageLogEntry>(
  view: BattlePlaybackView<TLog>,
): BattlePlaybackView<TLog> {
  return { ...view, feed: createBattleFeedSnapshot<TLog>() };
}

export function commitBattlePlaybackView<TLog extends StageLogEntry>(
  current: BattlePlaybackView<TLog>,
  commit: BattlePlaybackCommit<TLog>,
): BattlePlaybackView<TLog> {
  return {
    fighters: commit.fighters,
    battleTurn: commit.battleTurn,
    battleState: commit.battleState,
    feed: commit.log && commit.log.displayInFeed !== false
      ? appendBattleFeedEntry(current.feed, commit.log)
      : current.feed,
  };
}
