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

const OUT_DIR = process.env.NAMEARENA_YUZU_PROPHET_OUT_DIR ??
  path.join(os.tmpdir(), 'namearena-yuzu-prophet-stress');
const INTERACTION_SEEDS = Number.parseInt(process.env.NAMEARENA_YUZU_PROPHET_INTERACTION_SEEDS ?? '3', 10);
const CHAOS_SEEDS = Number.parseInt(process.env.NAMEARENA_YUZU_PROPHET_CHAOS_SEEDS ?? '60', 10);
const NO_WATER_SEEDS = Number.parseInt(process.env.NAMEARENA_YUZU_PROPHET_NO_WATER_SEEDS ?? '40', 10);
const TEAM_SEEDS = Number.parseInt(process.env.NAMEARENA_YUZU_PROPHET_TEAM_SEEDS ?? '40', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);

type ProphetStressSpec = BattleSpec & {
  focusCharacter?: string;
  manualReview: boolean;
  prophetMode: 'phase-one' | 'phase-two-bound' | 'phase-two-unbound';
};

type ProphetMetrics = {
  spawns: number;
  bindings: number;
  takeovers: number;
  fallbackSurtrs: number;
  clashes: number;
  clashEnds: number;
  defenseWins: number;
  defenseLosses: number;
  sourceImmunities: number;
  controlledDeaths: number;
  erasures: number;
  returns: number;
  phaseTwos: number;
  executionPredictions: number;
  executionCasts: number;
  retreatStarts: number;
  retreatEnds: number;
  retreatQuotes: number;
};

type StressIssue = {
  label: string;
  seed: number;
  kind: string;
  detail: string;
  logPath: string;
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
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function buildSpecs(): ProphetStressSpec[] {
  const specs: ProphetStressSpec[] = [];
  const interactionCharacters = SPECIALS.filter((name) => name !== '柚子');
  interactionCharacters.forEach((focusCharacter, characterIndex) => {
    for (let index = 0; index < INTERACTION_SEEDS; index += 1) {
      const supportPool = SPECIALS.filter((name) =>
        name !== '柚子' && name !== focusCharacter,
      );
      const supports = shuffled(supportPool, 910000 + characterIndex * 100 + index).slice(0, 3);
      specs.push({
        phase: 'interaction',
        label: `prophet-interaction-${characterIndex}-${focusCharacter}-${index}`,
        names: [
          '柚子@YUZU',
          `${focusCharacter}@FOCUS`,
          ...supports.map((name, supportIndex) => `${name}@SUPPORT_${supportIndex}`),
        ],
        seed: 910000 + characterIndex * 100 + index,
        focusCharacter,
        manualReview: true,
        prophetMode: 'phase-one',
      });
    }
  });
  for (let index = 0; index < CHAOS_SEEDS; index += 1) {
    specs.push({
      phase: 'all-special',
      label: `prophet-all-special-${index}`,
      names: SPECIALS,
      seed: 920000 + index,
      manualReview: false,
      prophetMode: index % 2 === 0 ? 'phase-two-bound' : 'phase-two-unbound',
    });
  }
  for (let index = 0; index < NO_WATER_SEEDS; index += 1) {
    specs.push({
      phase: 'no-water',
      label: `prophet-no-water-${index}`,
      names: NO_WATER,
      seed: 930000 + index,
      manualReview: false,
      prophetMode: index % 2 === 0 ? 'phase-two-bound' : 'phase-two-unbound',
    });
  }
  for (let index = 0; index < TEAM_SEEDS; index += 1) {
    const roster = shuffled(SPECIALS, 940000 + index);
    const teamA = roster.slice(0, 5);
    const teamB = roster.slice(5, 10);
    if (!teamA.includes('柚子') && !teamB.includes('柚子')) {
      teamA[0] = '柚子';
    }
    specs.push({
      phase: 'team-5v5',
      label: `prophet-team-5v5-${index}`,
      names: [
        ...teamA.map((name) => `${name}@TEAM_A`),
        ...teamB.map((name) => `${name}@TEAM_B`),
      ],
      seed: 940000 + index,
      manualReview: false,
      prophetMode: index % 2 === 0 ? 'phase-two-bound' : 'phase-two-unbound',
    });
  }
  return specs;
}

function countText(result: BattleResult, text: string): number {
  return result.logs.filter((entry) => entry.text.includes(text)).length;
}

function collectMetrics(result: BattleResult): ProphetMetrics {
  return {
    spawns: countText(result, '【柚子·预言家登场】'),
    bindings: countText(result, '【绑定柚子】'),
    takeovers: countText(result, '【预言家接管】'),
    fallbackSurtrs: countText(result, '【预言家保底召唤】'),
    clashes: countText(result, '【预言家拼点】'),
    clashEnds: countText(result, '【拼点结束】'),
    defenseWins: countText(result, '【拼点裁定·整枝闪避】'),
    defenseLosses: countText(result, '【拼点裁定·减伤】'),
    sourceImmunities: countText(result, '【绑定来源免疫】'),
    controlledDeaths: countText(result, '【接管召唤物死亡转化】'),
    erasures: countText(result, '【阶段抹杀】'),
    returns: countText(result, '【控制权返还】'),
    phaseTwos: countText(result, '【预言家二阶段】'),
    executionPredictions: countText(result, '【斩杀预判成立】'),
    executionCasts: countText(result, '随机确定正式结算顺序'),
    retreatStarts: countText(result, '【预言家共同退场启动】'),
    retreatEnds: countText(result, '【共同退场完成】'),
    retreatQuotes: countText(result, '【文明尽头的约定】'),
  };
}

function addMetrics(total: ProphetMetrics, next: ProphetMetrics): void {
  (Object.keys(total) as Array<keyof ProphetMetrics>).forEach((key) => {
    total[key] += next[key];
  });
}

function emptyMetrics(): ProphetMetrics {
  return {
    spawns: 0,
    bindings: 0,
    takeovers: 0,
    fallbackSurtrs: 0,
    clashes: 0,
    clashEnds: 0,
    defenseWins: 0,
    defenseLosses: 0,
    sourceImmunities: 0,
    controlledDeaths: 0,
    erasures: 0,
    returns: 0,
    phaseTwos: 0,
    executionPredictions: 0,
    executionCasts: 0,
    retreatStarts: 0,
    retreatEnds: 0,
    retreatQuotes: 0,
  };
}

function semanticIssues(result: BattleResult, metrics: ProphetMetrics): Array<{ kind: string; detail: string }> {
  const issues: Array<{ kind: string; detail: string }> = [];
  if (metrics.spawns !== 1) issues.push({ kind: 'spawn-count', detail: `expected 1 spawn, got ${metrics.spawns}` });
  if (metrics.bindings !== 1) issues.push({ kind: 'binding-count', detail: `expected 1 binding, got ${metrics.bindings}` });
  if (metrics.clashes !== metrics.clashEnds) {
    issues.push({ kind: 'clash-not-closed', detail: `starts=${metrics.clashes}, ends=${metrics.clashEnds}` });
  }
  if (metrics.retreatStarts !== 1 || metrics.retreatEnds !== 1 || metrics.retreatQuotes !== 1) {
    issues.push({
      kind: 'retreat-not-closed',
      detail: `starts=${metrics.retreatStarts}, ends=${metrics.retreatEnds}, quotes=${metrics.retreatQuotes}`,
    });
  }
  const causeLessRetreat = result.logs.find((entry) =>
    entry.text.includes('【预言家共同退场启动】') &&
    (entry.text.includes('无归属效果') || entry.text.includes('未知效果')),
  );
  if (causeLessRetreat) {
    issues.push({
      kind: 'retreat-cause-missing',
      detail: `common retreat lost its cause: ${causeLessRetreat.text}`,
    });
  }
  const prophetInfection = result.logs.find((entry) =>
    /【状态(?:施加|叠加)】柚子·预言家 的【矿石病】/.test(entry.text) ||
    entry.text.includes('【矿石病】柚子·预言家 因') ||
    /柚子·预言家 (?:实际损失|生命未减少|本体生命未减少).*\(\d+\/80 层\)/.test(entry.text) ||
    /本轮感染：.*柚子·预言家 \+\d+/.test(entry.text),
  );
  if (prophetInfection) {
    issues.push({
      kind: 'prophet-originium-infection',
      detail: `Prophet must never receive or settle Originium infection: ${prophetInfection.text}`,
    });
  }
  if (metrics.phaseTwos > 1) issues.push({ kind: 'duplicate-phase-two', detail: `phaseTwos=${metrics.phaseTwos}` });
  const retreatEndIndex = result.logs.findIndex((entry) => entry.text.includes('【共同退场完成】'));
  if (retreatEndIndex >= 0) {
    const postRetreat = result.logs.slice(retreatEndIndex + 1);
    const eventGhost = postRetreat.find((entry) =>
      entry.text.includes('柚子·预言家') ||
      entry.text.includes('普瑞赛斯的源石映像') ||
      entry.text.includes('阿喃那'),
    );
    if (eventGhost) {
      issues.push({
        kind: 'post-retreat-event-unit-log',
        detail: `retired event unit appeared after common retreat: ${eventGhost.text}`,
      });
    }
    const retreatTurn = result.logs[retreatEndIndex]?.turn;
    const fallbackSurtrGhost = result.logs.some((entry) => entry.text.includes('【保底召唤退场】'))
      ? postRetreat.find((entry) =>
        entry.turn === retreatTurn &&
        entry.text.includes('史尔特尔') &&
        !entry.text.includes('【史尔特尔上级召唤】'),
      )
      : undefined;
    if (fallbackSurtrGhost) {
      issues.push({
        kind: 'post-retreat-fallback-surtr-log',
        detail: `withdrawn fallback Surtr emitted another same-turn log: ${fallbackSurtrGhost.text}`,
      });
    }
  }
  if (result.logs.some((entry) =>
    entry.text.includes('受击分支成功命中并击败') &&
    entry.text.includes('受击分支被完全取消'),
  )) {
    issues.push({ kind: 'lethal-branch-contradiction', detail: 'same log claims lethal hit and full cancellation' });
  }
  const surtrOwnershipLogs = result.logs.filter((entry) =>
    entry.text.includes('史尔特尔') &&
    (entry.text.includes('【预言家接管】') || entry.text.includes('【控制权返还】')),
  );
  if (surtrOwnershipLogs.some((entry) => !entry.text.includes('共同主人'))) {
    issues.push({
      kind: 'surtr-owner-context',
      detail: 'real Surtr takeover/return log omitted the joint-owner relationship',
    });
  }
  if (surtrOwnershipLogs.some((entry) =>
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(entry.text),
  )) {
    issues.push({
      kind: 'surtr-owner-id-leak',
      detail: 'real Surtr takeover/return log exposed an internal ID',
    });
  }
  const controlledEntries = metrics.takeovers + metrics.fallbackSurtrs;
  const controlledTerminals =
    metrics.controlledDeaths +
    metrics.erasures +
    metrics.returns +
    countText(result, '【保底召唤退场】');
  if (controlledEntries !== controlledTerminals) {
    issues.push({
      kind: 'controlled-summon-terminal',
      detail: `entries=${controlledEntries}, terminals=${controlledTerminals}`,
    });
  }
  return issues;
}

function writeLog(result: BattleResult): string {
  const phaseDir = path.join(OUT_DIR, 'logs', result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const logPath = path.join(phaseDir, `${sanitizeFileName(result.label)}.log`);
  const body = result.logs
    .map((entry, index) =>
      `${String(index + 1).padStart(5, '0')} [T${entry.turn ?? '?'}] [${entry.type}] ${entry.text}`,
    )
    .join('\n');
  fs.writeFileSync(logPath, `${body}${body ? '\n' : ''}`, 'utf8');
  return logPath;
}

export function main(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const specs = buildSpecs();
  const totals = emptyMetrics();
  const issues: StressIssue[] = [];
  const manualReviewManifest: Array<Record<string, unknown>> = [];
  const phaseCounts: Record<string, number> = {};
  let ended = 0;
  let timedOut = 0;
  let totalLogs = 0;
  const startedAt = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      checkInvariantsEachStep: true,
      includeInvariantLabel: true,
      maxTurns: MAX_TURNS,
      scanRosterNames: true,
      forceYuzuProphet: spec.prophetMode === 'phase-one',
      forceYuzuProphetPhaseTwo: spec.prophetMode === 'phase-two-bound',
      forceYuzuProphetUnboundPhaseTwo: spec.prophetMode === 'phase-two-unbound',
    });
    const logPath = writeLog(result);
    const metrics = collectMetrics(result);
    addMetrics(totals, metrics);
    phaseCounts[spec.phase] = (phaseCounts[spec.phase] ?? 0) + 1;
    totalLogs += result.logCount;
    if (result.ended) ended += 1;
    if (result.timedOut) timedOut += 1;

    if (result.error) {
      issues.push({ label: spec.label, seed: spec.seed, kind: 'runtime-error', detail: result.error, logPath });
    }
    result.invariantErrors.forEach((detail) => {
      issues.push({ label: spec.label, seed: spec.seed, kind: 'invariant', detail, logPath });
    });
    result.logIssues.forEach((issue) => {
      issues.push({
        label: spec.label,
        seed: spec.seed,
        kind: `generic-log:${issue.type}`,
        detail: `line ${issue.line}: ${issue.text}`,
        logPath,
      });
    });
    semanticIssues(result, metrics).forEach((issue) => {
      issues.push({ label: spec.label, seed: spec.seed, ...issue, logPath });
    });

    if (spec.manualReview) {
      manualReviewManifest.push({
        label: spec.label,
        seed: spec.seed,
        focusCharacter: spec.focusCharacter,
        prophetMode: spec.prophetMode,
        turns: result.turns,
        logCount: result.logCount,
        logPath,
        metrics,
      });
    }
    if ((index + 1) % 25 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  const summary = {
    ok: issues.length === 0,
    totalBattles: specs.length,
    ended,
    timedOut,
    maxTurns: MAX_TURNS,
    totalLogs,
    elapsedMs: Date.now() - startedAt,
    phaseCounts,
    metrics: totals,
    issueCount: issues.length,
    manualReviewCount: manualReviewManifest.length,
    outDir: OUT_DIR,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'issues.json'), `${JSON.stringify(issues, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(OUT_DIR, 'manual-review-manifest.json'),
    `${JSON.stringify(manualReviewManifest, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}
