import fs from 'fs';
import {
  DEFAULT_CHAOS_SEEDS,
  DEFAULT_STRESS_MAX_TURNS,
  buildMegaStressSpecs,
  loadProject,
  runProjectBattle,
  type BattleResult,
  type BattleSpec,
  type LogEntry,
  type RunBattleOptions,
} from '../shared/harness';

const MAX_EXAMPLES = Number.parseInt(process.env.NAMEARENA_DIFF_EXAMPLES ?? '60', 10);

type ComparableMetaKey = 'turns' | 'ended' | 'timedOut' | 'error';

type ComparisonExample =
  | {
      kind: 'meta';
      key: ComparableMetaKey;
      spec: BattleSpec;
      baseline: BattleResult[ComparableMetaKey];
      current: BattleResult[ComparableMetaKey];
    }
  | {
      kind: 'survivors';
      spec: BattleSpec;
      baseline: string[];
      current: string[];
    }
  | {
      kind: 'logLine';
      spec: BattleSpec;
      line: number;
      baseline: LogEntry | null;
      current: LogEntry | null;
    };

type DiffCounts = {
  meta: number;
  survivor: number;
  logLine: number;
  comparedLogLines: number;
  baselineLogCount: number;
  currentLogCount: number;
};

type PhaseDiffStats = Record<string, {
  battles: number;
  battlesWithDiffs: number;
  comparedLogLines: number;
  metaDiffs: number;
  survivorDiffs: number;
  logLineDiffs: number;
}>;

type ComparisonSummary = {
  ok: boolean;
  baselineRoot: string;
  currentRoot: string;
  maxTurns: number;
  chaosSeeds: number;
  totalBattles: number;
  comparedLogLines: number;
  battlesWithDiffs: number;
  metaDiffs: number;
  survivorDiffs: number;
  logLineDiffs: number;
  phaseStats: PhaseDiffStats;
  examples: ComparisonExample[];
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function compareResults(
  spec: BattleSpec,
  baseResult: BattleResult,
  currentResult: BattleResult,
  examples: ComparisonExample[],
): DiffCounts {
  const diff = {
    meta: 0,
    survivor: 0,
    logLine: 0,
  };

  const metaKeys: ComparableMetaKey[] = ['turns', 'ended', 'timedOut', 'error'];
  metaKeys.forEach((key) => {
    if (stableJson(baseResult[key]) !== stableJson(currentResult[key])) {
      diff.meta += 1;
      if (examples.length < MAX_EXAMPLES) {
        examples.push({ kind: 'meta', key, spec, baseline: baseResult[key], current: currentResult[key] });
      }
    }
  });

  if (stableJson(baseResult.survivors) !== stableJson(currentResult.survivors)) {
    diff.survivor += 1;
    if (examples.length < MAX_EXAMPLES) {
      examples.push({ kind: 'survivors', spec, baseline: baseResult.survivors, current: currentResult.survivors });
    }
  }

  const maxLogs = Math.max(baseResult.logs.length, currentResult.logs.length);
  for (let i = 0; i < maxLogs; i += 1) {
    const baseEntry = baseResult.logs[i] ?? null;
    const currentEntry = currentResult.logs[i] ?? null;
    if (stableJson(baseEntry) !== stableJson(currentEntry)) {
      diff.logLine += 1;
      if (examples.length < MAX_EXAMPLES) {
        examples.push({
          kind: 'logLine',
          spec,
          line: i + 1,
          baseline: baseEntry,
          current: currentEntry,
        });
      }
    }
  }

  return {
    ...diff,
    comparedLogLines: maxLogs,
    baselineLogCount: baseResult.logs.length,
    currentLogCount: currentResult.logs.length,
  };
}

function appendPhaseStats(phaseStats: PhaseDiffStats, spec: BattleSpec, diff: DiffCounts, hasDiff: boolean): void {
  const stat = phaseStats[spec.phase] ?? {
    battles: 0,
    battlesWithDiffs: 0,
    comparedLogLines: 0,
    metaDiffs: 0,
    survivorDiffs: 0,
    logLineDiffs: 0,
  };
  stat.battles += 1;
  if (hasDiff) stat.battlesWithDiffs += 1;
  stat.comparedLogLines += diff.comparedLogLines;
  stat.metaDiffs += diff.meta;
  stat.survivorDiffs += diff.survivor;
  stat.logLineDiffs += diff.logLine;
  phaseStats[spec.phase] = stat;
}

export function main(argv = process.argv.slice(2)): void {
  const [baselineRoot, currentRoot, reportPath] = argv;

  if (!baselineRoot || !currentRoot || !reportPath) {
    console.error('Usage: node scripts/namearena-compare-logs.js <baselineRoot> <currentRoot> <reportPath>');
    process.exit(2);
  }

  const baseline = loadProject(baselineRoot, { purge: true });
  const current = loadProject(currentRoot, { purge: true });
  const specs = buildMegaStressSpecs(DEFAULT_CHAOS_SEEDS);
  const examples: ComparisonExample[] = [];
  const phaseStats: PhaseDiffStats = {};
  const summary: ComparisonSummary = {
    ok: true,
    baselineRoot,
    currentRoot,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    chaosSeeds: DEFAULT_CHAOS_SEEDS,
    totalBattles: specs.length,
    comparedLogLines: 0,
    battlesWithDiffs: 0,
    metaDiffs: 0,
    survivorDiffs: 0,
    logLineDiffs: 0,
    phaseStats,
    examples,
  };

  const runOptions: RunBattleOptions = {
    checkInvariants: false,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    scanLogs: false,
  };

  specs.forEach((spec, index) => {
    const baseResult = runProjectBattle(baseline, spec, runOptions);
    const currentResult = runProjectBattle(current, spec, runOptions);
    const diff = compareResults(spec, baseResult, currentResult, examples);

    const hasDiff = diff.meta > 0 || diff.survivor > 0 || diff.logLine > 0;
    if (hasDiff) {
      summary.ok = false;
      summary.battlesWithDiffs += 1;
    }

    summary.comparedLogLines += diff.comparedLogLines;
    summary.metaDiffs += diff.meta;
    summary.survivorDiffs += diff.survivor;
    summary.logLineDiffs += diff.logLine;
    appendPhaseStats(phaseStats, spec, diff, hasDiff);

    if ((index + 1) % 100 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: summary.ok,
    totalBattles: summary.totalBattles,
    comparedLogLines: summary.comparedLogLines,
    battlesWithDiffs: summary.battlesWithDiffs,
    metaDiffs: summary.metaDiffs,
    survivorDiffs: summary.survivorDiffs,
    logLineDiffs: summary.logLineDiffs,
    reportPath,
  }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}
