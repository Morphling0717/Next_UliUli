/* eslint-disable @typescript-eslint/no-require-imports */
require('./namearena/shared/register');

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_STRESS_MAX_TURNS,
  NO_WATER,
  checkInvariants,
  localProject,
  makeProjectEngine,
  makeProjectFighter,
  scanLogs,
  withProjectSeed,
} = require('./namearena/shared/harness.ts');
const { createBattleState } = require('../lib/namearena/battleState.ts');
const { getPuruisaishiBarrierTotal } = require('../lib/namearena/puruisaishiMechanics.ts');

const battleCount = Number.parseInt(process.env.NAMEARENA_BALANCE_BATTLES ?? process.argv[2] ?? '15000', 10);
const baseSeed = Number.parseInt(process.env.NAMEARENA_BALANCE_BASE_SEED ?? process.argv[3] ?? '710000', 10);
const startIndex = Number.parseInt(process.env.NAMEARENA_BALANCE_START_INDEX ?? '0', 10);
const maxTurns = Number.parseInt(process.env.NAMEARENA_BALANCE_MAX_TURNS ?? String(DEFAULT_STRESS_MAX_TURNS), 10);
const fairShare = 100 / NO_WATER.length;
const targetLow = Number.parseFloat(process.env.NAMEARENA_BALANCE_LOW ?? String(fairShare - 0.5));
const targetHigh = Number.parseFloat(process.env.NAMEARENA_BALANCE_HIGH ?? String(fairShare + 0.5));
const progressEvery = Number.parseInt(process.env.NAMEARENA_BALANCE_PROGRESS ?? '500', 10);
const puruisaishiMinRetreatRate = Number.parseFloat(process.env.NAMEARENA_PURUISAISHI_MIN_RETREAT_RATE ?? '50');
const puruisaishiMaxRetreatRate = Number.parseFloat(process.env.NAMEARENA_PURUISAISHI_MAX_RETREAT_RATE ?? '55');
const evaluateBalance = process.env.NAMEARENA_BALANCE_EVALUATE !== 'false';
const scanBattleLogs = process.env.NAMEARENA_BALANCE_SCAN_LOGS === 'true';
const outputPath = process.env.NAMEARENA_BALANCE_OUTPUT_PATH;
const quiet = process.env.NAMEARENA_BALANCE_QUIET === 'true';

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

function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (total <= 0) return { low: 0, high: 0 };
  const rate = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (rate + zSquared / (2 * total)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * total)) / total) / denominator;
  return {
    low: Math.max(0, center - margin) * 100,
    high: Math.min(1, center + margin) * 100,
  };
}

function getPuruisaishiOutcome(fighters, battleEndTurn) {
  const puruisaishi = fighters.find((fighter) => fighter.isPuruisaishi);
  if (!puruisaishi) {
    return {
      appeared: false,
      phaseTwoReached: false,
      retreated: false,
      activeAtEnd: false,
      remainingShield: 0,
      remainingCrystals: 0,
      enteredTurn: 0,
      battleEndTurn,
    };
  }
  const remainingShield = getPuruisaishiBarrierTotal(puruisaishi);

  return {
    appeared: true,
    phaseTwoReached: (puruisaishi.puruisaishiPhase ?? 1) >= 2,
    retreated: !!puruisaishi.isDead && remainingShield <= 0,
    activeAtEnd: !puruisaishi.isDead && !puruisaishi.isDeadAnnounced && puruisaishi.currentHp > 0,
    remainingShield,
    remainingCrystals: fighters.filter((fighter) =>
      fighter.isOriginiumCrystal && !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
    ).length,
    enteredTurn: puruisaishi.puruisaishiEnteredTurn ?? 0,
    battleEndTurn,
  };
}

function runFastNoWaterBattle(seed, index) {
  return withProjectSeed(localProject, seed, () => {
    let fighters = NO_WATER.map((name) => makeProjectFighter(localProject, name));
    let battleState = createBattleState(seed, 0);
    const spinalSwordRef = { current: false };
    const lastLogs = [];
    const logs = scanBattleLogs ? [] : null;
    let turnCount = 0;
    let ended = false;
    let error = null;
    let winText = null;

    const appendLog = (entry) => {
      if (entry.type === 'win') winText = entry.text;
      logs?.push(entry);
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
    const logIssues = logs ? scanLogs(logs, `balance-no-water-ffa-${index}`, NO_WATER) : [];
    const logIssueContexts = logs
      ? logIssues.map((issue) => ({
          issue,
          logs: logs.slice(Math.max(0, issue.line - 7), issue.line + 6),
        }))
      : [];
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
    const momo = fighters.find((fighter) => fighter.isMomo);
    const yuzu = fighters.find((fighter) => fighter.isYuzu);
    const momoYuzuTeamed = !!momo && !!yuzu && !!yuzu.yuzuKnownTeammateIds?.includes(momo.id);

    return {
      label: `balance-no-water-ffa-${index}`,
      seed,
      ended,
      timedOut: !ended && !error,
      error,
      invariantErrors,
      logIssues,
      logIssueContexts,
      survivors,
      lastLogs,
      winText,
      playerStats,
      momoYuzuTeamed,
      puruisaishi: getPuruisaishiOutcome(fighters, turnCount),
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
    log: 0,
  };
  const puruisaishiCounts = {
    appeared: 0,
    phaseTwoReached: 0,
    retreated: 0,
    activeAtEnd: 0,
    activePhaseTwoAtEnd: 0,
    remainingShield: 0,
    remainingCrystals: 0,
    enteredTurn: 0,
    battleEndTurn: 0,
  };
  const momoYuzuCounts = {
    teamedBattles: 0,
    yuzuWinCreditsWhenTeamed: 0,
    yuzuWinCreditsWithoutTeaming: 0,
    momoWinCreditsWhenTeamed: 0,
    momoWinCreditsWithoutTeaming: 0,
  };
  const examples = [];
  const logIssueExamples = [];
  const startedAt = Date.now();

  for (let i = 0; i < battleCount; i += 1) {
    const sampleIndex = startIndex + i;
    const seed = mixSampleSeed(baseSeed + sampleIndex);
    const result = runFastNoWaterBattle(seed, sampleIndex);

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
    if (result.logIssues.length > 0) issueCounts.log += result.logIssues.length;

    if (result.puruisaishi.appeared) {
      puruisaishiCounts.appeared += 1;
      if (result.puruisaishi.phaseTwoReached) puruisaishiCounts.phaseTwoReached += 1;
      if (result.puruisaishi.retreated) puruisaishiCounts.retreated += 1;
      if (result.puruisaishi.activeAtEnd) {
        puruisaishiCounts.activeAtEnd += 1;
        if (result.puruisaishi.phaseTwoReached) {
          puruisaishiCounts.activePhaseTwoAtEnd += 1;
          puruisaishiCounts.remainingShield += result.puruisaishi.remainingShield;
          puruisaishiCounts.remainingCrystals += result.puruisaishi.remainingCrystals;
        }
      }
      puruisaishiCounts.enteredTurn += result.puruisaishi.enteredTurn;
      puruisaishiCounts.battleEndTurn += result.puruisaishi.battleEndTurn;
    }

    const winners = findWinners(result);
    const winnerCredit = winners.length > 0 ? 1 / winners.length : 0;
    const yuzuCredit = winners.includes('柚子') ? winnerCredit : 0;
    const momoCredit = winners.includes('萌月沫沫') ? winnerCredit : 0;
    if (result.momoYuzuTeamed) {
      momoYuzuCounts.teamedBattles += 1;
      momoYuzuCounts.yuzuWinCreditsWhenTeamed += yuzuCredit;
      momoYuzuCounts.momoWinCreditsWhenTeamed += momoCredit;
    } else {
      momoYuzuCounts.yuzuWinCreditsWithoutTeaming += yuzuCredit;
      momoYuzuCounts.momoWinCreditsWithoutTeaming += momoCredit;
    }
    if (winners.length > 0) {
      const credit = winnerCredit;
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
          logIssues: result.logIssues,
        });
      }
    }
    if (result.logIssues.length > 0 && logIssueExamples.length < 20) {
      logIssueExamples.push({
        seed,
        label: result.label,
        survivors: result.survivors,
        lastLogs: result.lastLogs,
        logIssues: result.logIssues,
        logIssueContexts: result.logIssueContexts,
      });
    }

    if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
      if (!quiet) console.log(`progress ${i + 1}/${battleCount} (sample ${sampleIndex})`);
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

  const retreatConfidence = wilsonInterval(puruisaishiCounts.retreated, puruisaishiCounts.appeared);
  const observedRetreatRate = percent(puruisaishiCounts.retreated, puruisaishiCounts.appeared);
  const puruisaishi = {
    appearedBattles: puruisaishiCounts.appeared,
    appearanceRate: Number(percent(puruisaishiCounts.appeared, battleCount).toFixed(3)),
    phaseTwoBattles: puruisaishiCounts.phaseTwoReached,
    phaseTwoRateOfAppeared: Number(percent(puruisaishiCounts.phaseTwoReached, puruisaishiCounts.appeared).toFixed(3)),
    retreatedBattles: puruisaishiCounts.retreated,
    retreatRateOfAppeared: Number(observedRetreatRate.toFixed(3)),
    retreatRateWilson95: [
      Number(retreatConfidence.low.toFixed(3)),
      Number(retreatConfidence.high.toFixed(3)),
    ],
    retreatRateOfPhaseTwo: Number(percent(puruisaishiCounts.retreated, puruisaishiCounts.phaseTwoReached).toFixed(3)),
    activeAtEndBattles: puruisaishiCounts.activeAtEnd,
    activePhaseTwoAtEndBattles: puruisaishiCounts.activePhaseTwoAtEnd,
    averageRemainingShieldWhenPhaseTwoSurvives: Number((puruisaishiCounts.remainingShield / Math.max(1, puruisaishiCounts.activePhaseTwoAtEnd)).toFixed(1)),
    averageRemainingCrystalsWhenPhaseTwoSurvives: Number((puruisaishiCounts.remainingCrystals / Math.max(1, puruisaishiCounts.activePhaseTwoAtEnd)).toFixed(2)),
    averageAppearanceTurn: Number((puruisaishiCounts.enteredTurn / Math.max(1, puruisaishiCounts.appeared)).toFixed(1)),
    averageBattleEndTurnOfAppeared: Number((puruisaishiCounts.battleEndTurn / Math.max(1, puruisaishiCounts.appeared)).toFixed(1)),
    minimumRetreatRate: puruisaishiMinRetreatRate,
    maximumRetreatRate: puruisaishiMaxRetreatRate,
    observedTargetMet: puruisaishiCounts.appeared > 0 &&
      observedRetreatRate >= puruisaishiMinRetreatRate &&
      observedRetreatRate <= puruisaishiMaxRetreatRate,
    confidenceAboveMinimum: puruisaishiCounts.appeared > 0 && retreatConfidence.low >= puruisaishiMinRetreatRate,
    targetMet: puruisaishiCounts.appeared > 0 &&
      observedRetreatRate >= puruisaishiMinRetreatRate &&
      observedRetreatRate <= puruisaishiMaxRetreatRate,
  };

  const mechanismOk =
      issueCounts.timedOut === 0 &&
      issueCounts.error === 0 &&
      issueCounts.invariant === 0 &&
      issueCounts.log === 0;
  const balanceOk = standings.every((entry) => entry.inTarget) && puruisaishi.targetMet;
  const summary = {
    ok: mechanismOk && (!evaluateBalance || balanceOk),
    mechanismOk,
    balanceEvaluated: evaluateBalance,
    balanceOk: evaluateBalance ? balanceOk : null,
    logScanEnabled: scanBattleLogs,
    battleCount,
    baseSeed,
    startIndex,
    seedStrategy: '32-bit avalanche mix of baseSeed + battle index',
    maxTurns,
    target: [targetLow, targetHigh],
    elapsedMs: Date.now() - startedAt,
    standings,
    momoYuzuInteraction: {
      teamedBattles: momoYuzuCounts.teamedBattles,
      teamedRate: Number(percent(momoYuzuCounts.teamedBattles, battleCount).toFixed(3)),
      yuzuWinRateWhenTeamed: Number(percent(momoYuzuCounts.yuzuWinCreditsWhenTeamed, momoYuzuCounts.teamedBattles).toFixed(3)),
      yuzuWinRateWithoutTeaming: Number(percent(momoYuzuCounts.yuzuWinCreditsWithoutTeaming, battleCount - momoYuzuCounts.teamedBattles).toFixed(3)),
      momoWinRateWhenTeamed: Number(percent(momoYuzuCounts.momoWinCreditsWhenTeamed, momoYuzuCounts.teamedBattles).toFixed(3)),
      momoWinRateWithoutTeaming: Number(percent(momoYuzuCounts.momoWinCreditsWithoutTeaming, battleCount - momoYuzuCounts.teamedBattles).toFixed(3)),
    },
    puruisaishi,
    issueCounts,
    examples,
    logIssueExamples,
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }
  if (!quiet) console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main();
