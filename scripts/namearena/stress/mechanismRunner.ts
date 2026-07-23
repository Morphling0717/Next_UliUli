import fs from 'fs';
import path from 'path';
import {
  NO_WATER,
  SPECIALS,
  os,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
} from '../shared/harness';

const OUT_DIR = process.env.NAMEARENA_MECHANISM_OUT_DIR ?? path.join(os.tmpdir(), 'namearena-mechanism-stress');
const CHAOS_SEEDS = Number.parseInt(process.env.NAMEARENA_MECHANISM_CHAOS_SEEDS ?? '40', 10);
const TEAM_SAMPLES = Number.parseInt(process.env.NAMEARENA_MECHANISM_TEAM_SAMPLES ?? '40', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);

type PhaseSummary = {
  battles: number;
  ended: number;
  timedOut: number;
  runtimeErrors: number;
  invariantErrors: number;
  logIssues: number;
};

type MechanismSpec = BattleSpec & {
  forcePuruisaishi?: boolean;
};

function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }
  return result;
}

function buildSpecs(): MechanismSpec[] {
  const specs: MechanismSpec[] = [];
  for (let index = 0; index < CHAOS_SEEDS; index += 1) {
    specs.push({ phase: 'all-special', label: `all-special-${index}`, names: SPECIALS, seed: 810000 + index });
    specs.push({ phase: 'no-water', label: `no-water-${index}`, names: NO_WATER, seed: 820000 + index });
  }
  for (let teamSize = 2; teamSize <= 5; teamSize += 1) {
    for (let index = 0; index < TEAM_SAMPLES; index += 1) {
      const roster = shuffled(SPECIALS, 830000 + teamSize * 10000 + index);
      const teamA = roster.slice(0, teamSize);
      const teamB = roster.slice(teamSize, teamSize * 2);
      specs.push({
        phase: `${teamSize}v${teamSize}`,
        label: `${teamSize}v${teamSize}-sample-${index}`,
        names: [
          ...teamA.map((name) => `${name}@A`),
          ...teamB.map((name) => `${name}@B`),
        ],
        seed: 840000 + teamSize * 10000 + index,
      });
    }
  }
  for (let index = 0; index < 4; index += 1) {
    specs.push({
      phase: 'puruisaishi-all-special',
      label: `puruisaishi-all-special-${index}`,
      names: SPECIALS,
      seed: 890000 + index,
      forcePuruisaishi: true,
    });
    specs.push({
      phase: 'puruisaishi-no-water',
      label: `puruisaishi-no-water-${index}`,
      names: NO_WATER,
      seed: 891000 + index,
      forcePuruisaishi: true,
    });
  }
  return specs;
}

function writeLog(result: BattleResult): string {
  const phaseDir = path.join(OUT_DIR, 'logs', result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const file = path.join(phaseDir, `${sanitizeFileName(result.label)}.log`);
  const body = result.logs
    .map((entry, index) => `${String(index + 1).padStart(4, '0')} [${entry.type}] ${entry.text}`)
    .join('\n');
  fs.writeFileSync(file, `${body}${body ? '\n' : ''}`, 'utf8');
  return file;
}

function phaseSummary(): PhaseSummary {
  return { battles: 0, ended: 0, timedOut: 0, runtimeErrors: 0, invariantErrors: 0, logIssues: 0 };
}

export function main(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const specs = buildSpecs();
  const phases: Record<string, PhaseSummary> = {};
  const failures: Array<Record<string, unknown>> = [];
  const timeouts: Array<Record<string, unknown>> = [];
  const start = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      checkInvariantsEachStep: true,
      includeInvariantLabel: true,
      maxTurns: MAX_TURNS,
      scanRosterNames: true,
      forcePuruisaishi: spec.forcePuruisaishi,
    });
    const phase = phases[spec.phase] ?? phaseSummary();
    phase.battles += 1;
    if (result.ended) phase.ended += 1;
    if (result.timedOut) phase.timedOut += 1;
    if (result.error) phase.runtimeErrors += 1;
    phase.invariantErrors += result.invariantErrors.length;
    phase.logIssues += result.logIssues.length;
    phases[spec.phase] = phase;

    const mechanismFailed = !!result.error || result.invariantErrors.length > 0 || result.logIssues.length > 0;
    const keepRepresentative =
      spec.label === 'all-special-0' ||
      spec.label === 'no-water-0' ||
      spec.label === 'puruisaishi-all-special-0' ||
      spec.label === 'puruisaishi-no-water-0';
    const logPath = mechanismFailed || result.timedOut || keepRepresentative ? writeLog(result) : '';
    if (mechanismFailed) {
      failures.push({
        phase: spec.phase,
        label: spec.label,
        seed: spec.seed,
        error: result.error,
        invariantErrors: result.invariantErrors,
        logIssues: result.logIssues,
        logPath,
      });
    }
    if (result.timedOut) {
      timeouts.push({
        phase: spec.phase,
        label: spec.label,
        seed: spec.seed,
        survivors: result.survivors,
        logCount: result.logCount,
        logPath,
      });
    }
    if ((index + 1) % 50 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  const summary = {
    mechanismOk: failures.length === 0,
    balanceEvaluated: false,
    totalBattles: specs.length,
    chaosSeeds: CHAOS_SEEDS,
    teamSamplesPerSize: TEAM_SAMPLES,
    maxTurns: MAX_TURNS,
    elapsedMs: Date.now() - start,
    phases,
    failureCount: failures.length,
    timeoutCount: timeouts.length,
    outDir: OUT_DIR,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'failures.json'), `${JSON.stringify(failures, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'timeouts.json'), `${JSON.stringify(timeouts, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.mechanismOk) process.exitCode = 1;
}
