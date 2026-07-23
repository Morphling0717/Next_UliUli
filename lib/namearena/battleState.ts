import type { BattleState, Fighter, LargeRoundState } from './types';
import { hasIdentity } from './statusSystem';

const RNG_MODULUS = 2147483647;
const RNG_MULTIPLIER = 16807;
const LARGE_ROUND_ACTION_MULTIPLIER = 2;

function normalizeSeed(seed: number): number {
  const finiteSeed = Number.isFinite(seed) ? Math.floor(seed) : Date.now();
  let normalized = finiteSeed % RNG_MODULUS;
  if (normalized <= 0) normalized += RNG_MODULUS - 1;
  return normalized;
}

export function createBattleState(seed = Date.now(), turnCount = 0): BattleState {
  const normalizedSeed = normalizeSeed(seed);
  return {
    schemaVersion: 1,
    seed: normalizedSeed,
    rngState: normalizedSeed,
    turnCount,
    eventSequence: 0,
    actionSequence: 0,
    largeRound: {
      number: 1,
      startedTurn: turnCount,
      participantIds: [],
      actedIds: [],
      actionCount: 0,
    },
  };
}

export function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    largeRound: {
      ...state.largeRound,
      participantIds: [...state.largeRound.participantIds],
      actedIds: [...state.largeRound.actedIds],
    },
  };
}

export function nextBattleRandom(state: BattleState): number {
  state.rngState = (normalizeSeed(state.rngState) * RNG_MULTIPLIER) % RNG_MODULUS;
  return (state.rngState - 1) / (RNG_MODULUS - 1);
}

export function withBattleRandom<T>(state: BattleState, callback: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => nextBattleRandom(state);
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

export function isLargeRoundParticipant(fighter: Fighter): boolean {
  return (
    !fighter.isDead &&
    !fighter.isDeadAnnounced &&
    fighter.currentHp > 0 &&
    !fighter.isNpc &&
    !fighter.isSummon &&
    !fighter.cannotAct &&
    !fighter.cannotWin &&
    !hasIdentity(fighter, 'SYNERGY_SLACKING')
  );
}

function activeParticipantIds(fighters: Fighter[]): string[] {
  return fighters.filter(isLargeRoundParticipant).map((fighter) => fighter.id);
}

function startRound(number: number, turnCount: number, participantIds: string[]): LargeRoundState {
  return {
    number,
    startedTurn: turnCount,
    participantIds,
    actedIds: [],
    actionCount: 0,
  };
}

/**
 * Keeps the current round roster stable while removing fighters that can no
 * longer act. Newly returned/revived players join on the next large round so a
 * round cannot be extended indefinitely by mid-round entity changes.
 */
export function syncLargeRoundState(state: BattleState, fighters: Fighter[]): number | undefined {
  const currentlyActive = new Set(activeParticipantIds(fighters));
  const hadRoster = state.largeRound.participantIds.length > 0;
  if (state.largeRound.participantIds.length === 0) {
    state.largeRound = startRound(state.largeRound.number, state.turnCount, [...currentlyActive]);
    return undefined;
  }

  state.largeRound.participantIds = state.largeRound.participantIds.filter((id) => currentlyActive.has(id));
  state.largeRound.actedIds = state.largeRound.actedIds.filter((id) => currentlyActive.has(id));

  const allRemainingActed = state.largeRound.participantIds.every((id) => state.largeRound.actedIds.includes(id));
  if (hadRoster && allRemainingActed && state.completedLargeRound === undefined) {
    state.completedLargeRound = state.largeRound.number;
    return state.largeRound.number;
  }
  return undefined;
}

export function getLargeRoundProgress(state: BattleState): {
  number: number;
  acted: number;
  total: number;
  actionCount: number;
  maxActions: number;
} {
  const total = state.largeRound.participantIds.length;
  return {
    number: state.largeRound.number,
    acted: state.largeRound.actedIds.length,
    total,
    actionCount: state.largeRound.actionCount,
    maxActions: Math.max(total, total * LARGE_ROUND_ACTION_MULTIPLIER),
  };
}

/**
 * Speed-weighted scheduling is preserved for the first part of a large round.
 * Near the 2x-roster hard cap, only players who have not yet received a turn
 * remain eligible, guaranteeing that the round finishes in bounded time.
 */
export function getLargeRoundPriorityActorIds(state: BattleState, fighters: Fighter[]): string[] {
  syncLargeRoundState(state, fighters);
  const participantIds = new Set(state.largeRound.participantIds);
  const actedIds = new Set(state.largeRound.actedIds);
  const remaining = fighters
    .filter((fighter) => participantIds.has(fighter.id) && !actedIds.has(fighter.id) && isLargeRoundParticipant(fighter))
    .map((fighter) => fighter.id);
  if (remaining.length === 0) return [];

  const maximumActions = Math.max(
    state.largeRound.participantIds.length,
    state.largeRound.participantIds.length * LARGE_ROUND_ACTION_MULTIPLIER,
  );
  const slotsLeft = maximumActions - state.largeRound.actionCount;
  return slotsLeft <= remaining.length ? remaining : [];
}

export function noteLargeRoundActor(state: BattleState, fighters: Fighter[], actor: Fighter): number | undefined {
  const completedByRosterChange = syncLargeRoundState(state, fighters);
  if (completedByRosterChange !== undefined || state.completedLargeRound === state.largeRound.number) {
    return completedByRosterChange;
  }
  state.largeRound.actionCount += 1;
  if (state.largeRound.participantIds.includes(actor.id) && !state.largeRound.actedIds.includes(actor.id)) {
    state.largeRound.actedIds.push(actor.id);
  }

  const participantIds = state.largeRound.participantIds;
  const completed = participantIds.length > 0 && participantIds.every((id) => state.largeRound.actedIds.includes(id));
  if (!completed) return undefined;

  const completedRound = state.largeRound.number;
  state.completedLargeRound = completedRound;
  return completedRound;
}

export function consumeCompletedLargeRound(state: BattleState, fighters?: Fighter[]): number | undefined {
  const completed = state.completedLargeRound;
  if (completed === undefined) return undefined;
  const nextParticipants = fighters
    ? activeParticipantIds(fighters)
    : state.largeRound.participantIds;
  state.largeRound = startRound(completed + 1, state.turnCount, nextParticipants);
  delete state.completedLargeRound;
  return completed;
}
