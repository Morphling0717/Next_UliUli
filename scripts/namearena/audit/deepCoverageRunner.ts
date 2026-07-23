import fs from 'node:fs';
import path from 'node:path';
import {
  NO_WATER,
  SPECIALS,
  runBattle,
  type BattleResult,
  type BattleSpec,
} from '../shared/harness';

type CoveragePhase = 'teams' | 'with-water' | 'puruisaishi' | 'all';

type PairCoverage = {
  teammate: Record<string, number>;
  enemy: Record<string, number>;
  minimumTeammate: number;
  minimumEnemy: number;
};

type PhaseSummary = {
  battles: number;
  ended: number;
  timedOut: number;
  runtimeErrors: number;
  invariantErrors: number;
  logIssues: number;
  turns: number;
  logs: number;
  winners: Record<string, number>;
  timeoutExamples: Array<{ label: string; seed: number; survivors: string[] }>;
  failureExamples: Array<{ label: string; seed: number; details: string[]; logPath?: string }>;
};

const MODE = (process.env.NAMEARENA_DEEP_PHASE ?? 'all') as CoveragePhase;
const TEAM_BATTLES = Number.parseInt(process.env.NAMEARENA_TEAM_SAMPLE_BATTLES ?? '2000', 10);
const WITH_WATER_BATTLES = Number.parseInt(process.env.NAMEARENA_WITH_WATER_BATTLES ?? '3000', 10);
const PURUISAISHI_BATTLES = Number.parseInt(process.env.NAMEARENA_PURUISAISHI_BATTLES ?? '500', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);
const REQUIRED_PAIR_COVERAGE = Number.parseInt(process.env.NAMEARENA_TEAM_PAIR_COVERAGE ?? '20', 10);
const OUT_DIR = path.join(process.cwd(), '.tmp', 'namearena-deep-audit', 'coverage');
const TEAM_SIZE_FILTER = process.env.NAMEARENA_TEAM_SIZE
  ? Number.parseInt(process.env.NAMEARENA_TEAM_SIZE, 10)
  : null;

function getRunOutputDir(): string {
  if (MODE === 'teams' && TEAM_SIZE_FILTER !== null) {
    return path.join(OUT_DIR, `teams-${TEAM_SIZE_FILTER}v${TEAM_SIZE_FILTER}`);
  }
  return path.join(OUT_DIR, MODE);
}

const RUN_OUT_DIR = getRunOutputDir();

function pairKey(first: string, second: string): string {
  return [first, second].sort((left, right) => left.localeCompare(right, 'zh-CN')).join(' + ');
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function incrementPairs(counter: Record<string, number>, first: readonly string[], second?: readonly string[]): void {
  if (second) {
    first.forEach((left) => second.forEach((right) => {
      const key = pairKey(left, right);
      counter[key] = (counter[key] ?? 0) + 1;
    }));
    return;
  }
  for (let left = 0; left < first.length; left += 1) {
    for (let right = left + 1; right < first.length; right += 1) {
      const firstName = first[left];
      const secondName = first[right];
      if (!firstName || !secondName) continue;
      const key = pairKey(firstName, secondName);
      counter[key] = (counter[key] ?? 0) + 1;
    }
  }
}

function buildBalancedTeamSamples(teamSize: number, battleCount: number, baseSeed: number): { specs: BattleSpec[]; coverage: PairCoverage } {
  const random = createRng(baseSeed ^ (teamSize * 0x9e3779b9));
  const specs: BattleSpec[] = [];
  const teammate: Record<string, number> = {};
  const enemy: Record<string, number> = {};

  for (let index = 0; index < battleCount; index += 1) {
    const roster = shuffled(SPECIALS, random);
    const teamA = roster.slice(0, teamSize);
    const teamB = roster.slice(teamSize, teamSize * 2);
    incrementPairs(teammate, teamA);
    incrementPairs(teammate, teamB);
    incrementPairs(enemy, teamA, teamB);
    specs.push({
      phase: `coverage-${teamSize}v${teamSize}`,
      label: `coverage-${teamSize}v${teamSize}-${index}`,
      names: [
        ...teamA.map((name) => `${name}@A`),
        ...teamB.map((name) => `${name}@B`),
      ],
      seed: baseSeed + index * 37,
    });
  }

  const allPairs: string[] = [];
  for (let left = 0; left < SPECIALS.length; left += 1) {
    for (let right = left + 1; right < SPECIALS.length; right += 1) {
      allPairs.push(pairKey(SPECIALS[left]!, SPECIALS[right]!));
    }
  }
  const minimumTeammate = Math.min(...allPairs.map((key) => teammate[key] ?? 0));
  const minimumEnemy = Math.min(...allPairs.map((key) => enemy[key] ?? 0));
  if (minimumTeammate < REQUIRED_PAIR_COVERAGE || minimumEnemy < REQUIRED_PAIR_COVERAGE) {
    throw new Error(
      `${teamSize}v${teamSize} coverage is insufficient: teammate ${minimumTeammate}, enemy ${minimumEnemy}, required ${REQUIRED_PAIR_COVERAGE}`,
    );
  }
  return { specs, coverage: { teammate, enemy, minimumTeammate, minimumEnemy } };
}

function createPhaseSummary(): PhaseSummary {
  return {
    battles: 0,
    ended: 0,
    timedOut: 0,
    runtimeErrors: 0,
    invariantErrors: 0,
    logIssues: 0,
    turns: 0,
    logs: 0,
    winners: {},
    timeoutExamples: [],
    failureExamples: [],
  };
}

function winnerNames(result: BattleResult): string[] {
  const finalWin = [...result.logs].reverse().find((entry) => entry.type === 'win')?.text ?? '';
  return SPECIALS.filter((name) => finalWin.includes(name));
}

function writeFailureLog(result: BattleResult): string {
  const directory = path.join(RUN_OUT_DIR, 'failures');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${result.phase}-${result.seed}.log`);
  fs.writeFileSync(
    filePath,
    `${result.logs.map((entry, index) => `${String(index + 1).padStart(4, '0')} [${entry.type}] ${entry.text}`).join('\n')}\n`,
    'utf8',
  );
  return filePath;
}

function appendResult(summary: PhaseSummary, result: BattleResult): void {
  summary.battles += 1;
  summary.turns += result.turns;
  summary.logs += result.logCount;
  if (result.ended) summary.ended += 1;
  if (result.timedOut) {
    summary.timedOut += 1;
    if (summary.timeoutExamples.length < 20) {
      summary.timeoutExamples.push({ label: result.label, seed: result.seed, survivors: result.survivors });
    }
  }
  if (result.error) summary.runtimeErrors += 1;
  summary.invariantErrors += result.invariantErrors.length;
  summary.logIssues += result.logIssues.length;
  winnerNames(result).forEach((name) => {
    summary.winners[name] = (summary.winners[name] ?? 0) + 1;
  });
  const details = [
    ...(result.error ? [result.error] : []),
    ...result.invariantErrors,
    ...result.logIssues.map((issue) => `${issue.type}: ${issue.text}`),
  ];
  if (details.length > 0 && summary.failureExamples.length < 100) {
    summary.failureExamples.push({
      label: result.label,
      seed: result.seed,
      details,
      logPath: writeFailureLog(result),
    });
  }
}

function runSpecs(specs: readonly BattleSpec[], options: { forcePuruisaishi?: boolean } = {}): PhaseSummary {
  const summary = createPhaseSummary();
  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      checkInvariantsEachStep: true,
      maxTurns: MAX_TURNS,
      scanLogs: true,
      scanRosterNames: true,
      forcePuruisaishi: options.forcePuruisaishi,
    });
    appendResult(summary, result);
    if ((index + 1) % 100 === 0 || index + 1 === specs.length) {
      console.log(`${spec.phase}: ${index + 1}/${specs.length}`);
    }
  });
  return summary;
}

function chaosSpecs(names: readonly string[], phase: string, count: number, baseSeed: number): BattleSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    phase,
    label: `${phase}-${index}`,
    names: [...names],
    seed: baseSeed + index,
  }));
}

export function main(): void {
  if (TEAM_SIZE_FILTER !== null && (!Number.isInteger(TEAM_SIZE_FILTER) || TEAM_SIZE_FILTER < 2 || TEAM_SIZE_FILTER > 5)) {
    throw new Error(`NAMEARENA_TEAM_SIZE must be an integer from 2 through 5, received ${process.env.NAMEARENA_TEAM_SIZE}`);
  }
  fs.rmSync(RUN_OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(RUN_OUT_DIR, { recursive: true });
  const startedAt = Date.now();
  const phaseSummaries: Record<string, PhaseSummary> = {};
  const teamCoverage: Record<string, PairCoverage> = {};

  if (MODE === 'teams' || MODE === 'all') {
    for (let teamSize = 2; teamSize <= 5; teamSize += 1) {
      if (TEAM_SIZE_FILTER !== null && teamSize !== TEAM_SIZE_FILTER) continue;
      const { specs, coverage } = buildBalancedTeamSamples(teamSize, TEAM_BATTLES, 1_200_000 + teamSize * 100_000);
      teamCoverage[`${teamSize}v${teamSize}`] = coverage;
      phaseSummaries[`${teamSize}v${teamSize}`] = runSpecs(specs);
    }
  }
  if (MODE === 'with-water' || MODE === 'all') {
    phaseSummaries['with-water'] = runSpecs(chaosSpecs(SPECIALS, 'deep-with-water', WITH_WATER_BATTLES, 1_700_000));
  }
  if (MODE === 'puruisaishi' || MODE === 'all') {
    phaseSummaries.puruisaishi = runSpecs(
      chaosSpecs(NO_WATER, 'deep-forced-puruisaishi', PURUISAISHI_BATTLES, 1_800_000),
      { forcePuruisaishi: true },
    );
  }

  const hardFailureCount = Object.values(phaseSummaries).reduce((sum, summary) => (
    sum + summary.runtimeErrors + summary.invariantErrors + summary.logIssues
  ), 0);
  const report = {
    ok: hardFailureCount === 0,
    mode: MODE,
    maxTurns: MAX_TURNS,
    elapsedMs: Date.now() - startedAt,
    hardFailureCount,
    teamCoverage: Object.fromEntries(Object.entries(teamCoverage).map(([phase, coverage]) => [phase, {
      minimumTeammate: coverage.minimumTeammate,
      minimumEnemy: coverage.minimumEnemy,
    }])),
    phaseSummaries,
  };
  const outputPath = path.join(RUN_OUT_DIR, `summary-${MODE}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
