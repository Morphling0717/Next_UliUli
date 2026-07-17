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
const { createBattleState } = require('../lib/namearena/battleState.ts');

const battleCount = Number.parseInt(process.env.NAMEARENA_BALANCE_BATTLES ?? process.argv[2] ?? '15000', 10);
const baseSeed = Number.parseInt(process.env.NAMEARENA_BALANCE_BASE_SEED ?? process.argv[3] ?? '710000', 10);
const maxTurns = Number.parseInt(process.env.NAMEARENA_BALANCE_MAX_TURNS ?? String(DEFAULT_STRESS_MAX_TURNS), 10);
const fairShare = 100 / NO_WATER.length;
const targetLow = Number.parseFloat(process.env.NAMEARENA_BALANCE_LOW ?? String(fairShare - 0.5));
const targetHigh = Number.parseFloat(process.env.NAMEARENA_BALANCE_HIGH ?? String(fairShare + 0.5));
const progressEvery = Number.parseInt(process.env.NAMEARENA_BALANCE_PROGRESS ?? '500', 10);

function createCounter() {
  return Object.fromEntries(NO_WATER.map((name) => [name, 0]));
}

function createJobCounter() {
  return Object.fromEntries(NO_WATER.map((name) => [name, {}]));
}

function mixSampleSeed(seed) {
  let mixed = (seed + 0x9e3779b9) | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  mixed ^= mixed >>> 15;
  return ((mixed >>> 0) % 2147483646) + 1;
}

function findWinners(result) {
  if (!result.winText || result.winText.includes('无（同归于尽）')) return [];

  const summonOwnerMatches = [...result.winText.matchAll(/（(.+?)召唤）/g)]
    .map((match) => match[1])
    .filter((name) => NO_WATER.includes(name));
  const matchedNames = NO_WATER
    .filter((name) => result.winText.includes(name))
    .sort((a, b) => result.winText.indexOf(a) - result.winText.indexOf(b));
  return [...new Set([...matchedNames, ...summonOwnerMatches])];
}

function percent(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function runFastNoWaterBattle(seed, index) {
  return withProjectSeed(localProject, seed, () => {
    let fighters = NO_WATER.map((name) => makeProjectFighter(localProject, name));
    let battleState = createBattleState(seed, 0);
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
      const engine = makeProjectEngine(localProject, localProject.cloneFighters(fighters), [], turnCount, battleState);
      engine.addLogCallback = appendLog;
      try {
        ended = engine.step(spinalSwordRef);
        turnCount = engine.turnCount;
        battleState = engine.battleState;
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
    const playerStats = NO_WATER.map((name) => fighters.find((fighter) => fighter.name === name))
      .filter(Boolean)
      .map((fighter) => ({
        name: fighter.name,
        job: fighter.job,
        transformed: !!fighter.transformed,
        alive: !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
        currentHp: Math.max(0, fighter.currentHp),
        maxHp: fighter.maxHp,
        kills: fighter.stats.kills,
        dmgDealt: fighter.stats.dmgDealt,
        dmgTaken: fighter.stats.dmgTaken,
      }));

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
      playerStats,
    };
  });
}

function main() {
  const winCredits = createCounter();
  const coWins = createCounter();
  const soleWins = createCounter();
  const jointWins = createCounter();
  const transforms = createCounter();
  const aliveFinishes = createCounter();
  const totalCurrentHp = createCounter();
  const totalMaxHp = createCounter();
  const totalKills = createCounter();
  const totalDmgDealt = createCounter();
  const totalDmgTaken = createCounter();
  const finalJobs = createJobCounter();
  const issueCounts = {
    drawOrUnknown: 0,
    timedOut: 0,
    error: 0,
    invariant: 0,
  };
  const examples = [];
  const startedAt = Date.now();

  for (let i = 0; i < battleCount; i += 1) {
    const seed = mixSampleSeed(baseSeed + i);
    const result = runFastNoWaterBattle(seed, i);

    result.playerStats.forEach((fighter) => {
      if (fighter.transformed) transforms[fighter.name] += 1;
      if (fighter.alive) aliveFinishes[fighter.name] += 1;
      totalCurrentHp[fighter.name] += fighter.currentHp;
      totalMaxHp[fighter.name] += fighter.maxHp;
      totalKills[fighter.name] += fighter.kills;
      totalDmgDealt[fighter.name] += fighter.dmgDealt;
      totalDmgTaken[fighter.name] += fighter.dmgTaken;
      finalJobs[fighter.name][fighter.job] = (finalJobs[fighter.name][fighter.job] ?? 0) + 1;
    });

    if (result.timedOut) issueCounts.timedOut += 1;
    if (result.error) issueCounts.error += 1;
    if (result.invariantErrors.length > 0) issueCounts.invariant += result.invariantErrors.length;

    const winners = findWinners(result);
    if (winners.length > 0) {
      const credit = 1 / winners.length;
      winners.forEach((winner) => {
        winCredits[winner] += credit;
        coWins[winner] += 1;
        if (winners.length === 1) soleWins[winner] += 1;
        else jointWins[winner] += 1;
      });
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
    winCredits: Number(winCredits[name].toFixed(3)),
    creditRate: Number(percent(winCredits[name], battleCount).toFixed(3)),
    coWins: coWins[name],
    coWinRate: Number(percent(coWins[name], battleCount).toFixed(3)),
    soleWins: soleWins[name],
    soleWinRate: Number(percent(soleWins[name], battleCount).toFixed(3)),
    jointWins: jointWins[name],
    jointWinRate: Number(percent(jointWins[name], battleCount).toFixed(3)),
    transformRate: Number(percent(transforms[name], battleCount).toFixed(3)),
    aliveFinishRate: Number(percent(aliveFinishes[name], battleCount).toFixed(3)),
    avgCurrentHp: Number((totalCurrentHp[name] / battleCount).toFixed(1)),
    avgMaxHp: Number((totalMaxHp[name] / battleCount).toFixed(1)),
    avgKills: Number((totalKills[name] / battleCount).toFixed(3)),
    avgDmgDealt: Number((totalDmgDealt[name] / battleCount).toFixed(1)),
    avgDmgTaken: Number((totalDmgTaken[name] / battleCount).toFixed(1)),
    finalJobs: Object.fromEntries(Object.entries(finalJobs[name]).sort((a, b) => b[1] - a[1])),
    inTarget: percent(winCredits[name], battleCount) >= targetLow && percent(winCredits[name], battleCount) <= targetHigh,
  })).sort((a, b) => b.creditRate - a.creditRate);

  const summary = {
    ok: standings.every((entry) => entry.inTarget) &&
      issueCounts.timedOut === 0 &&
      issueCounts.error === 0 &&
      issueCounts.invariant === 0,
    battleCount,
    baseSeed,
    seedStrategy: '32-bit avalanche mix of baseSeed + battle index',
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
