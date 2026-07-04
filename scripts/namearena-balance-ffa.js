/* eslint-disable @typescript-eslint/no-require-imports */
require('./namearena/shared/register');

const {
  DEFAULT_STRESS_MAX_TURNS,
  NO_WATER,
  checkInvariants,
  localProject,
  makeProjectEngine,
  makeProjectFighter,
  withProjectSeed,
} = require('./namearena/shared/harness.ts');

const battleCount = Number.parseInt(process.env.NAMEARENA_BALANCE_BATTLES ?? process.argv[2] ?? '15000', 10);
const baseSeed = Number.parseInt(process.env.NAMEARENA_BALANCE_BASE_SEED ?? process.argv[3] ?? '710000', 10);
const maxTurns = Number.parseInt(process.env.NAMEARENA_BALANCE_MAX_TURNS ?? String(DEFAULT_STRESS_MAX_TURNS), 10);
const targetLow = Number.parseFloat(process.env.NAMEARENA_BALANCE_LOW ?? '10.5');
const targetHigh = Number.parseFloat(process.env.NAMEARENA_BALANCE_HIGH ?? '11.5');
const progressEvery = Number.parseInt(process.env.NAMEARENA_BALANCE_PROGRESS ?? '500', 10);

function createCounter() {
  return Object.fromEntries(NO_WATER.map((name) => [name, 0]));
}

function findWinner(result) {
  if (!result.winText || result.winText.includes('无（同归于尽）')) return null;

  const summonOwnerMatches = [...result.winText.matchAll(/（(.+?)召唤）/g)]
    .map((match) => match[1])
    .filter((name) => NO_WATER.includes(name));
  if (summonOwnerMatches.length > 0) return summonOwnerMatches[0];

  const matchedNames = NO_WATER
    .filter((name) => result.winText.includes(name))
    .sort((a, b) => result.winText.indexOf(a) - result.winText.indexOf(b));
  return matchedNames[0] ?? null;
}

function percent(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function runFastNoWaterBattle(seed, index) {
  return withProjectSeed(localProject, seed, () => {
    let fighters = NO_WATER.map((name) => makeProjectFighter(localProject, name));
    const spinalSwordRef = { current: false };
    const lastLogs = [];
    let turnCount = 0;
    let ended = false;
    let error = null;
    let winText = null;

    const appendLog = (entry) => {
      if (entry.type === 'win') winText = entry.text;
      lastLogs.push(entry);
      if (lastLogs.length > 5) lastLogs.shift();
    };

    for (let turn = 0; turn < maxTurns; turn += 1) {
      const engine = makeProjectEngine(localProject, localProject.cloneFighters(fighters), [], turnCount);
      engine.addLogCallback = appendLog;
      try {
        ended = engine.step(spinalSwordRef);
        turnCount = engine.turnCount;
        fighters = engine.fighters;
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.stack || err.message}` : String(err);
        break;
      }
      if (ended) break;
    }

    const invariantErrors = checkInvariants(fighters, `balance-no-water-ffa-${index}`, { includeLabel: true });
    const survivors = fighters
      .filter((fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0)
      .map((fighter) => `${fighter.name}:${fighter.job}:${fighter.currentHp}`);

    return {
      label: `balance-no-water-ffa-${index}`,
      seed,
      ended,
      timedOut: !ended && !error,
      error,
      invariantErrors,
      survivors,
      lastLogs,
      winText,
    };
  });
}

function main() {
  const wins = createCounter();
  const issueCounts = {
    drawOrUnknown: 0,
    timedOut: 0,
    error: 0,
    invariant: 0,
  };
  const examples = [];
  const startedAt = Date.now();

  for (let i = 0; i < battleCount; i += 1) {
    const seed = baseSeed + i;
    const result = runFastNoWaterBattle(seed, i);

    if (result.timedOut) issueCounts.timedOut += 1;
    if (result.error) issueCounts.error += 1;
    if (result.invariantErrors.length > 0) issueCounts.invariant += result.invariantErrors.length;

    const winner = findWinner(result);
    if (winner) {
      wins[winner] += 1;
    } else {
      issueCounts.drawOrUnknown += 1;
      if (examples.length < 20) {
        examples.push({
          seed,
          label: result.label,
          survivors: result.survivors,
          lastLogs: result.lastLogs,
          error: result.error,
          timedOut: result.timedOut,
          invariantErrors: result.invariantErrors,
        });
      }
    }

    if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
      console.log(`progress ${i + 1}/${battleCount}`);
    }
  }

  const standings = NO_WATER.map((name) => ({
    name,
    wins: wins[name],
    winRate: Number(percent(wins[name], battleCount).toFixed(3)),
    inTarget: percent(wins[name], battleCount) >= targetLow && percent(wins[name], battleCount) <= targetHigh,
  })).sort((a, b) => b.winRate - a.winRate);

  const summary = {
    ok: standings.every((entry) => entry.inTarget) &&
      issueCounts.timedOut === 0 &&
      issueCounts.error === 0 &&
      issueCounts.invariant === 0,
    battleCount,
    baseSeed,
    maxTurns,
    target: [targetLow, targetHigh],
    elapsedMs: Date.now() - startedAt,
    standings,
    issueCounts,
    examples,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main();
