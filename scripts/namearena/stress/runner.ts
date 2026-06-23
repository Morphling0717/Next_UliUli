import fs from 'fs';
import path from 'path';
import {
  DEFAULT_CHAOS_SEEDS,
  DEFAULT_STRESS_MAX_TURNS,
  buildMegaStressSpecs,
  os,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
  type LogEntry,
  type LogIssue,
} from '../shared/harness';

const OUT_DIR = process.env.NAMEARENA_STRESS_OUT_DIR ?? path.join(os.tmpdir(), 'namearena-mega-stress');
const LOG_DIR = path.join(OUT_DIR, 'logs');

type PhaseStats = Record<string, {
  battles: number;
  ended: number;
  timedOut: number;
  errors: number;
  issues: number;
  logCount: number;
  maxTurns: number;
}>;

type StressIssue = LogIssue & {
  phase?: string;
  seed?: number;
  logPath?: string;
  context?: Array<{
    line: number;
    type: string;
    text: string;
  }>;
};

type BattleSummary = {
  phase: string;
  label: string;
  seed: number;
  names: string[];
  turns: number;
  ended: boolean;
  timedOut: boolean;
  error: string | null;
  invariantErrorCount: number;
  logIssueCount: number;
  issueCount: number;
  logCount: number;
  survivors: string[];
  logPath: string;
};

type StressSummary = {
  ok: boolean;
  totalBattles: number;
  maxTurns: number;
  chaosSeeds: number;
  elapsedMs: number;
  phaseStats: PhaseStats;
  issueTypeCounts: Record<string, number>;
  issueContextCount: number;
  outDir: string;
};

function writeLogFile(result: BattleResult, index: number): string {
  const phaseDir = path.join(LOG_DIR, result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const logPath = path.join(phaseDir, `${String(index).padStart(5, '0')}-${sanitizeFileName(result.label)}.log`);
  const text = result.logs.map((entry, lineIndex) => `${String(lineIndex + 1).padStart(3, '0')} [${entry.type}] ${entry.text}`).join('\n');
  fs.writeFileSync(logPath, text + (text ? '\n' : ''), 'utf8');
  return logPath;
}

function issueContext(logs: LogEntry[], line: number, radius = 3): StressIssue['context'] {
  const start = Math.max(1, line - radius);
  const end = Math.min(logs.length, line + radius);
  return logs.slice(start - 1, end).map((entry, index) => ({
    line: start + index,
    type: entry.type,
    text: entry.text,
  }));
}

function initializeOutputDir(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendPhaseStats(phaseStats: PhaseStats, spec: BattleSpec, result: BattleResult, issueCount: number): void {
  const stat = phaseStats[spec.phase] ?? {
    battles: 0,
    ended: 0,
    timedOut: 0,
    errors: 0,
    issues: 0,
    logCount: 0,
    maxTurns: 0,
  };
  stat.battles += 1;
  if (result.ended) stat.ended += 1;
  if (result.timedOut) stat.timedOut += 1;
  if (result.error) stat.errors += 1;
  stat.issues += issueCount;
  stat.logCount += result.logCount;
  stat.maxTurns = Math.max(stat.maxTurns, result.turns);
  phaseStats[spec.phase] = stat;
}

export function main(): void {
  initializeOutputDir();

  const specs = buildMegaStressSpecs(DEFAULT_CHAOS_SEEDS);
  const phaseStats: PhaseStats = {};
  const issueContexts: StressIssue[] = [];
  const summaries: BattleSummary[] = [];
  const issueTypeCounts: Record<string, number> = {};
  const startMs = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      includeInvariantLabel: true,
      maxTurns: DEFAULT_STRESS_MAX_TURNS,
      scanRosterNames: true,
    });
    const logPath = writeLogFile(result, index);
    const allIssues: LogIssue[] = [
      ...result.logIssues,
      ...result.invariantErrors.map((text) => ({ label: spec.label, line: 0, type: 'invariant-error', text })),
    ];
    if (result.error) allIssues.push({ label: spec.label, line: 0, type: 'runtime-error', text: result.error });
    if (result.timedOut) allIssues.push({ label: spec.label, line: 0, type: 'timeout', text: `Battle did not end within ${DEFAULT_STRESS_MAX_TURNS} turns` });

    appendPhaseStats(phaseStats, spec, result, allIssues.length);

    allIssues.forEach((issue) => {
      issueTypeCounts[issue.type] = (issueTypeCounts[issue.type] ?? 0) + 1;
      if (issueContexts.length < 500) {
        issueContexts.push({
          ...issue,
          phase: spec.phase,
          seed: spec.seed,
          logPath,
          context: issue.line > 0 ? issueContext(result.logs, issue.line) : [],
        });
      }
    });

    summaries.push({
      phase: spec.phase,
      label: spec.label,
      seed: spec.seed,
      names: spec.names,
      turns: result.turns,
      ended: result.ended,
      timedOut: result.timedOut,
      error: result.error ? String(result.error).split('\n')[0] ?? null : null,
      invariantErrorCount: result.invariantErrors.length,
      logIssueCount: result.logIssues.length,
      issueCount: allIssues.length,
      logCount: result.logCount,
      survivors: result.survivors,
      logPath,
    });

    if ((index + 1) % 100 === 0) {
      console.log(`progress ${index + 1}/${specs.length}`);
    }
  });

  const elapsedMs = Date.now() - startMs;
  const summary: StressSummary = {
    ok: Object.values(phaseStats).every((stats) => stats.timedOut === 0 && stats.errors === 0 && stats.issues === 0),
    totalBattles: specs.length,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    chaosSeeds: DEFAULT_CHAOS_SEEDS,
    elapsedMs,
    phaseStats,
    issueTypeCounts,
    issueContextCount: issueContexts.length,
    outDir: OUT_DIR,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'battle-summaries.json'), `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'issue-contexts.json'), `${JSON.stringify(issueContexts, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}
