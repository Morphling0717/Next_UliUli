import fs from 'fs';
import path from 'path';
import {
  DEFAULT_STRESS_MAX_TURNS,
  SPECIALS,
  os,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
  type LogEntry,
  type LogIssue,
} from '../shared/harness';
import { scanEmoteSpecificLogs } from './emoteRunner';

const OUT_DIR = process.env.NAMEARENA_EMOTE_INTERACTION_STRESS_OUT_DIR ?? path.join(os.tmpdir(), 'namearena-emote-interaction-stress');
const LOG_DIR = path.join(OUT_DIR, 'logs');
const INTERACTION_SEEDS = Number.parseInt(process.env.NAMEARENA_EMOTE_INTERACTION_SEEDS ?? '10', 10);
const OTHER_SPECIALS = SPECIALS.filter((name) => name !== '表情');

type BattleSummary = {
  phase: string;
  label: string;
  seed: number;
  names: string[];
  turns: number;
  ended: boolean;
  timedOut: boolean;
  error: string | null;
  issueCount: number;
  logCount: number;
  survivors: string[];
  logPath: string;
};

type Summary = {
  ok: boolean;
  totalBattles: number;
  maxTurns: number;
  interactionSeeds: number;
  focusSpecials: string[];
  elapsedMs: number;
  issueTypeCounts: Record<string, number>;
  issueContextCount: number;
  outDir: string;
};

type StressIssue = LogIssue & {
  phase?: string;
  seed?: number;
  logPath?: string;
  context?: Array<{ line: number; type: string; text: string }>;
};

function initializeOutputDir(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLogFile(result: BattleResult, index: number): string {
  const phaseDir = path.join(LOG_DIR, result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const logPath = path.join(phaseDir, `${String(index).padStart(4, '0')}-${sanitizeFileName(result.label)}.log`);
  const text = result.logs.map((entry, lineIndex) => `${String(lineIndex + 1).padStart(3, '0')} [${entry.type}] ${entry.text}`).join('\n');
  fs.writeFileSync(logPath, text + (text ? '\n' : ''), 'utf8');
  return logPath;
}

function issueContext(logs: LogEntry[], line: number, radius = 4): StressIssue['context'] {
  const start = Math.max(1, line - radius);
  const end = Math.min(logs.length, line + radius);
  return logs.slice(start - 1, end).map((entry, index) => ({
    line: start + index,
    type: entry.type,
    text: entry.text,
  }));
}

function pickPartner(exclude: string[], offset: number): string {
  const pool = OTHER_SPECIALS.filter((name) => !exclude.includes(name));
  return pool[offset % pool.length] ?? '玄凝';
}

function buildEmoteInteractionSpecs(): BattleSpec[] {
  const specs: BattleSpec[] = [];

  OTHER_SPECIALS.forEach((special, specialIndex) => {
    for (let i = 0; i < INTERACTION_SEEDS; i += 1) {
      const partnerA = pickPartner([special], specialIndex + i);
      const partnerB = pickPartner([special, partnerA], specialIndex * 2 + i + 3);
      const partnerC = pickPartner([special, partnerA, partnerB], specialIndex * 3 + i + 5);
      const seedBase = 840000 + specialIndex * 10000 + i * 37;

      specs.push({
        phase: `emote-interaction-${specialIndex + 1}-duel`,
        label: `emote-vs-${special}-${i}`,
        names: ['表情', special],
        seed: seedBase,
      });
      specs.push({
        phase: `emote-interaction-${specialIndex + 1}-ffa`,
        label: `emote-ffa-${special}-${i}`,
        names: ['表情', special, partnerA, partnerB, `交互锚点${specialIndex}-${i}`],
        seed: seedBase + 1,
      });
      specs.push({
        phase: `emote-interaction-${specialIndex + 1}-ally`,
        label: `emote-ally-${special}-${i}`,
        names: [`表情@A`, `${special}@A`, `${partnerA}@B`, `${partnerB}@B`, `${partnerC}@C`],
        seed: seedBase + 2,
      });
      specs.push({
        phase: `emote-interaction-${specialIndex + 1}-enemy`,
        label: `emote-enemy-${special}-${i}`,
        names: [`表情@A`, `${partnerA}@A`, `${special}@B`, `${partnerB}@B`, `${partnerC}@C`],
        seed: seedBase + 3,
      });
    }
  });

  return specs;
}

export function main(): void {
  initializeOutputDir();
  const specs = buildEmoteInteractionSpecs();
  const summaries: BattleSummary[] = [];
  const issueContexts: StressIssue[] = [];
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
      ...scanEmoteSpecificLogs(result),
      ...result.invariantErrors.map((text) => ({ label: spec.label, line: 0, type: 'invariant-error', text })),
    ];
    if (result.error) allIssues.push({ label: spec.label, line: 0, type: 'runtime-error', text: result.error });
    if (result.timedOut) allIssues.push({ label: spec.label, line: 0, type: 'timeout', text: `Battle did not end within ${DEFAULT_STRESS_MAX_TURNS} turns` });

    allIssues.forEach((issue) => {
      issueTypeCounts[issue.type] = (issueTypeCounts[issue.type] ?? 0) + 1;
      if (issueContexts.length < 600) {
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
      issueCount: allIssues.length,
      logCount: result.logCount,
      survivors: result.survivors,
      logPath,
    });

    if ((index + 1) % 40 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  const summary: Summary = {
    ok: summaries.every((item) => item.ended && !item.timedOut && !item.error && item.issueCount === 0),
    totalBattles: specs.length,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    interactionSeeds: INTERACTION_SEEDS,
    focusSpecials: OTHER_SPECIALS,
    elapsedMs: Date.now() - startMs,
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
