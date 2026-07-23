export type BattleVisualEventLedger = {
  runId: number;
  keys: Set<string>;
};

export function createBattleVisualEventLedger(): BattleVisualEventLedger {
  return {
    runId: 0,
    keys: new Set(),
  };
}

export function claimBattleVisualEvent(
  ledger: BattleVisualEventLedger,
  runId: number,
  eventKey: string,
): boolean {
  if (ledger.runId !== runId) {
    ledger.runId = runId;
    ledger.keys.clear();
  }
  if (ledger.keys.has(eventKey)) return false;

  ledger.keys.add(eventKey);
  return true;
}

export function resetBattleVisualEventLedger(
  ledger: BattleVisualEventLedger,
  runId = ledger.runId,
): void {
  ledger.runId = runId;
  ledger.keys.clear();
}
