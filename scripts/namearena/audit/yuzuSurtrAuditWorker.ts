import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_STRESS_MAX_TURNS,
  NO_WATER,
  SPECIALS,
  combinations,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
  type RunBattleOptions,
} from '../shared/harness';
import {
  auditFocusedBattle,
  type FocusedAuditExpectation,
} from './yuzuSurtrSemantic';
import {
  YuzuSurtrTraceStore,
  type StoredFocusedIssue,
} from './yuzuSurtrTraceStore';
import { buildDeepCoveragePlan } from './yuzuSurtrDeepCoverage';

export type FocusedAuditMode =
  | 'prophet-no-water'
  | 'prophet-with-water'
  | 'surtr-no-water'
  | 'surtr-with-water'
  | 'surtr-prophet'
  | 'surtr-herobrine'
  | 'deep-adaptive'
  | 'prophet-teams'
  | 'surtr-teams';

type TeamStrategy = 'exhaustive' | 'coverage';

type WorkerConfig = {
  mode: FocusedAuditMode;
  count: number;
  startOrdinal: number;
  teamSize?: number;
  teamStrategy: TeamStrategy;
  baseSeed: number;
  maxTurns: number;
  outputDir: string;
  checkpointEvery: number;
  failFastIssueBattles: number;
  sourceFingerprint: string;
};

type GeneratedAuditSpec = {
  ordinal: number;
  context: string;
  spec: BattleSpec;
  options: RunBattleOptions;
  expectation: FocusedAuditExpectation;
};

type IssueExample = StoredFocusedIssue;

type WorkerState = {
  schemaVersion: 4;
  configHash: string;
  nextIndex: number;
  completed: boolean;
  stoppedForIssues: boolean;
  startedAt: string;
  elapsedMs: number;
  battles: number;
  ended: number;
  timedOut: number;
  totalTurns: number;
  totalLogs: number;
  issueBattles: number;
  issueCount: number;
  issueTypeCounts: Record<string, number>;
  issueExamples: IssueExample[];
  eventCounts: Record<string, number>;
  prophetMetrics: Record<string, number>;
  surtrCoverage: Record<string, number>;
  rosterCoverage: Record<string, number>;
  interactionCoverage: Record<string, number>;
  uniqueSemanticTraces: number;
  uniquePresentationTraces: number;
  reviewCategoryCount: number;
};

const TEAM_COUNTS: Record<'prophet' | 'surtr', Record<number, number>> = {
  prophet: { 2: 1716, 3: 25740, 4: 120120, 5: 180180 },
  surtr: { 2: 396, 3: 9900, 4: 64680, 5: 124740 },
};

function collectAuditSourceFiles(entryPath: string): string[] {
  if (!fs.existsSync(entryPath)) return [];
  const stat = fs.statSync(entryPath);
  if (stat.isFile()) return [entryPath];
  return fs.readdirSync(entryPath, { withFileTypes: true })
    .flatMap((entry) => collectAuditSourceFiles(path.join(entryPath, entry.name)));
}

export function computeFocusedAuditSourceFingerprint(root = process.cwd()): string {
  const sourcePaths = [
    path.join(root, 'lib', 'namearena'),
    path.join(root, 'scripts', 'namearena', 'audit'),
    path.join(root, 'scripts', 'namearena', 'shared'),
    path.join(root, 'scripts', 'namearena', 'stress'),
    path.join(root, 'scripts', 'namearena-yuzu-surtr-audit.js'),
    path.join(root, 'scripts', 'namearena-yuzu-surtr-audit-worker.js'),
    path.join(root, 'package.json'),
    path.join(root, 'package-lock.json'),
  ];
  const files = sourcePaths
    .flatMap(collectAuditSourceFiles)
    .filter((filePath) => /\.(?:js|json|ts)$/.test(filePath))
    .sort();
  const fingerprint = createHash('sha256');
  files.forEach((filePath) => {
    fingerprint.update(path.relative(root, filePath));
    fingerprint.update('\0');
    fingerprint.update(fs.readFileSync(filePath));
    fingerprint.update('\0');
  });
  return fingerprint.digest('hex');
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultCount(mode: FocusedAuditMode, teamSize?: number): number {
  if (mode === 'prophet-no-water' || mode === 'surtr-no-water') return 15000;
  if (
    mode === 'prophet-with-water' ||
    mode === 'surtr-with-water' ||
    mode === 'surtr-prophet' ||
    mode === 'surtr-herobrine' ||
    mode === 'deep-adaptive'
  ) return 3000;
  if (!teamSize) throw new Error(`${mode} requires NAMEARENA_FOCUSED_TEAM_SIZE`);
  return TEAM_COUNTS[mode === 'prophet-teams' ? 'prophet' : 'surtr'][teamSize]
    ?? 0;
}

function readConfig(): WorkerConfig {
  const mode = (process.env.NAMEARENA_FOCUSED_AUDIT_MODE ?? 'prophet-no-water') as FocusedAuditMode;
  const validModes: FocusedAuditMode[] = [
    'prophet-no-water',
    'prophet-with-water',
    'surtr-no-water',
    'surtr-with-water',
    'surtr-prophet',
    'surtr-herobrine',
    'deep-adaptive',
    'prophet-teams',
    'surtr-teams',
  ];
  if (!validModes.includes(mode)) throw new Error(`Unknown focused audit mode: ${mode}`);
  const teamSize = process.env.NAMEARENA_FOCUSED_TEAM_SIZE
    ? Number.parseInt(process.env.NAMEARENA_FOCUSED_TEAM_SIZE, 10)
    : undefined;
  if (
    (mode === 'prophet-teams' || mode === 'surtr-teams') &&
    (!teamSize || teamSize < 2 || teamSize > 5)
  ) {
    throw new Error(`${mode} requires a team size from 2 through 5`);
  }
  const count = parsePositiveInteger(
    process.env.NAMEARENA_FOCUSED_AUDIT_COUNT,
    defaultCount(mode, teamSize),
  );
  const startOrdinal = parseNonNegativeInteger(
    process.env.NAMEARENA_FOCUSED_START_ORDINAL,
    0,
  );
  const suffix = teamSize ? `${mode}-${teamSize}v${teamSize}` : mode;
  const teamStrategy = (process.env.NAMEARENA_FOCUSED_TEAM_STRATEGY ?? 'exhaustive') as TeamStrategy;
  if (teamStrategy !== 'exhaustive' && teamStrategy !== 'coverage') {
    throw new Error(`Unknown focused team strategy: ${teamStrategy}`);
  }
  return {
    mode,
    count,
    startOrdinal,
    teamSize,
    teamStrategy,
    baseSeed: parsePositiveInteger(process.env.NAMEARENA_FOCUSED_BASE_SEED, 3_100_000),
    maxTurns: parsePositiveInteger(process.env.NAMEARENA_MAX_TURNS, DEFAULT_STRESS_MAX_TURNS),
    outputDir: process.env.NAMEARENA_FOCUSED_AUDIT_OUT_DIR
      ?? path.join(
        process.cwd(),
        '.tmp',
        'namearena-yuzu-surtr-audit',
        startOrdinal > 0 ? `${suffix}-${startOrdinal}-${count}` : suffix,
      ),
    checkpointEvery: parsePositiveInteger(process.env.NAMEARENA_FOCUSED_CHECKPOINT_EVERY, 250),
    failFastIssueBattles: parsePositiveInteger(process.env.NAMEARENA_FOCUSED_FAIL_FAST, 1),
    sourceFingerprint: computeFocusedAuditSourceFingerprint(),
  };
}

function configHash(config: WorkerConfig): string {
  return createHash('sha256')
    .update(JSON.stringify({
      schemaVersion: 4,
      mode: config.mode,
      count: config.count,
      startOrdinal: config.startOrdinal,
      teamSize: config.teamSize,
      teamStrategy: config.teamStrategy,
      baseSeed: config.baseSeed,
      maxTurns: config.maxTurns,
      sourceFingerprint: config.sourceFingerprint,
    }))
    .digest('hex');
}

function stateFromStore(
  store: YuzuSurtrTraceStore,
  config: WorkerConfig,
  hash: string,
  completed: boolean,
  stoppedForIssues: boolean,
): WorkerState {
  const aggregate = store.aggregate();
  return {
    schemaVersion: 4,
    configHash: hash,
    nextIndex: Math.max(config.startOrdinal, aggregate.nextIndex),
    completed,
    stoppedForIssues,
    startedAt: store.startedAt(),
    elapsedMs: store.elapsedMs(),
    battles: aggregate.battles,
    ended: aggregate.ended,
    timedOut: aggregate.timedOut,
    totalTurns: aggregate.totalTurns,
    totalLogs: aggregate.totalLogs,
    issueBattles: aggregate.issueBattles,
    issueCount: aggregate.issueCount,
    issueTypeCounts: aggregate.issueTypeCounts,
    issueExamples: aggregate.issueExamples,
    eventCounts: aggregate.eventCounts,
    prophetMetrics: aggregate.prophetMetrics,
    surtrCoverage: aggregate.surtrCoverage,
    rosterCoverage: aggregate.rosterCoverage,
    interactionCoverage: aggregate.interactionCoverage,
    uniqueSemanticTraces: aggregate.uniqueSemanticTraces,
    uniquePresentationTraces: aggregate.uniquePresentationTraces,
    reviewCategoryCount: aggregate.reviewCategoryCount,
  };
}

function statePath(config: WorkerConfig): string {
  return path.join(config.outputDir, 'checkpoint.json');
}

function summaryPath(config: WorkerConfig): string {
  return path.join(config.outputDir, 'summary.json');
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function writeState(config: WorkerConfig, state: WorkerState): void {
  const output = {
    ...state,
    ok: state.completed && state.issueCount === 0 && state.timedOut === 0,
    mode: config.mode,
    requestedBattles: config.count,
    startOrdinal: config.startOrdinal,
    endOrdinal: config.startOrdinal + config.count,
    teamSize: config.teamSize,
    teamStrategy: config.teamStrategy,
    baseSeed: config.baseSeed,
    maxTurns: config.maxTurns,
    outputDir: config.outputDir,
    traceDatabase: path.join(config.outputDir, 'semantic-traces.sqlite'),
  };
  writeJsonAtomic(statePath(config), state);
  writeJsonAtomic(summaryPath(config), output);
}

function writeFailureLog(
  config: WorkerConfig,
  result: BattleResult,
  ordinal: number,
): string {
  const directory = path.join(config.outputDir, 'failures');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(
    directory,
    `${String(ordinal).padStart(7, '0')}-${sanitizeFileName(result.label)}.log`,
  );
  const lines = result.logs.map((entry, index) =>
    `${String(index + 1).padStart(5, '0')} [T${entry.turn ?? '?'} R${entry.rootEventId ?? '-'} A${entry.actionId ?? '-'}] [${entry.type}] ${entry.text}`,
  );
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function explicitTeamNames(team: readonly string[], label: string): string[] {
  return team.map((name) => `${name}@${label}`);
}

function* focusedTeamSpecs(
  mode: 'prophet-teams' | 'surtr-teams',
  teamSize: number,
  baseSeed: number,
  strategy: TeamStrategy,
): Generator<GeneratedAuditSpec> {
  if (strategy === 'coverage' && teamSize >= 3) {
    const focus = mode === 'prophet-teams' ? 'prophet' : 'surtr';
    const plan = buildDeepCoveragePlan(focus, teamSize);
    for (let ordinal = 0; ordinal < plan.lineups.length; ordinal += 1) {
      const lineup = plan.lineups[ordinal]!;
      const seed = baseSeed + teamSize * 1_000_000 + ordinal * 31;
      const lifecycle = surtrLifecycle(ordinal);
      const prophet = prophetOptions(ordinal);
      yield {
        ordinal,
        context: focus === 'prophet'
          ? `${focus}-${teamSize}v${teamSize}:${prophet.context}`
          : `${focus}-${teamSize}v${teamSize}:${lifecycle}`,
        spec: {
          phase: `${focus}-${teamSize}v${teamSize}-coverage`,
          label: `${focus}-${teamSize}v${teamSize}-${lineup.teamA.join('+')}-vs-${lineup.teamB.join('+')}`,
          names: [
            ...explicitTeamNames(lineup.teamA, 'A'),
            ...explicitTeamNames(lineup.teamB, 'B'),
          ],
          seed,
        },
        options: focus === 'prophet'
          ? prophet.options
          : { forceSurtr: true, forceSurtrLifecycle: lifecycle },
        expectation: focus === 'prophet'
          ? { prophet: true, surtr: true }
          : { surtr: true },
      };
    }
    return;
  }
  let ordinal = 0;
  const teamAs = combinations(SPECIALS, teamSize);
  for (const teamA of teamAs) {
    const teamASet = new Set(teamA);
    const remaining = SPECIALS.filter((name) => !teamASet.has(name));
    for (const teamB of combinations(remaining, teamSize)) {
      const relevant = mode === 'prophet-teams'
        ? teamA.includes('柚子') || teamB.includes('柚子')
        : (
          (teamA.includes('牢鳄') || teamB.includes('牢鳄')) &&
          (teamA.includes('鸮') || teamB.includes('鸮'))
        );
      if (!relevant) continue;
      const seed = baseSeed + teamSize * 1_000_000 + ordinal * 31;
      const focus = mode === 'prophet-teams' ? 'prophet' : 'surtr';
      yield {
        ordinal,
        context: `${focus}-${teamSize}v${teamSize}`,
        spec: {
          phase: `${focus}-${teamSize}v${teamSize}`,
          label: `${focus}-${teamSize}v${teamSize}-${teamA.join('+')}-vs-${teamB.join('+')}`,
          names: [
            ...explicitTeamNames(teamA, 'A'),
            ...explicitTeamNames(teamB, 'B'),
          ],
          seed,
        },
        options: mode === 'prophet-teams'
          ? { forceYuzuProphet: true }
          : { forceSurtr: true, forceSurtrLifecycle: 'normal' },
        expectation: mode === 'prophet-teams'
          ? { prophet: true, surtr: true }
          : { surtr: true },
      };
      ordinal += 1;
    }
  }
}

function prophetOptions(index: number): {
  context: string;
  options: RunBattleOptions;
} {
  const mode = index % 3;
  if (mode === 0) return { context: 'phase-one', options: { forceYuzuProphet: true } };
  if (mode === 1) {
    return {
      context: 'phase-two-bound',
      options: { forceYuzuProphetPhaseTwo: true },
    };
  }
  return {
    context: 'phase-two-unbound',
    options: { forceYuzuProphetUnboundPhaseTwo: true },
  };
}

function surtrLifecycle(index: number): NonNullable<RunBattleOptions['forceSurtrLifecycle']> {
  return (['normal', 'twilight', 'afterglow'] as const)[index % 3]!;
}

function generatedFfaSpec(
  config: WorkerConfig,
  ordinal: number,
): GeneratedAuditSpec {
  const seed = config.baseSeed + ordinal;
  if (config.mode === 'deep-adaptive') {
    const variant = ordinal % 10;
    const names = variant === 3 || variant === 7 ? SPECIALS : NO_WATER;
    if (variant <= 3) {
      const phase = prophetOptions(variant === 3 ? 0 : variant);
      return {
        ordinal,
        context: `deep-adaptive:prophet:${names === SPECIALS ? 'with-water' : 'no-water'}:${phase.context}`,
        spec: {
          phase: 'deep-adaptive-prophet',
          label: `deep-adaptive-prophet-${ordinal}`,
          names: [...names],
          seed,
        },
        options: phase.options,
        expectation: { prophet: true, surtr: true },
      };
    }
    const lifecycle = surtrLifecycle(variant - 4);
    const options: RunBattleOptions = {
      forceSurtr: true,
      forceSurtrLifecycle: lifecycle,
    };
    let contextSuffix = names === SPECIALS ? 'with-water' : 'no-water';
    if (variant === 8) {
      options.forceYuzuProphet = true;
      contextSuffix = 'prophet-control';
    } else if (variant === 9) {
      options.forceHerobrine = true;
      contextSuffix = 'herobrine';
    }
    return {
      ordinal,
      context: `deep-adaptive:surtr:${contextSuffix}:${lifecycle}`,
      spec: {
        phase: 'deep-adaptive-surtr',
        label: `deep-adaptive-surtr-${ordinal}`,
        names: [...names],
        seed,
      },
      options,
      expectation: { prophet: variant === 8, surtr: true },
    };
  }
  const isProphet = config.mode.startsWith('prophet-');
  const names = (
    config.mode === 'prophet-with-water' ||
    config.mode === 'surtr-with-water'
  ) ? SPECIALS : NO_WATER;
  if (isProphet) {
    const forced = prophetOptions(ordinal);
    return {
      ordinal,
      context: `${config.mode}:${forced.context}`,
      spec: {
        phase: config.mode,
        label: `${config.mode}-${ordinal}`,
        names: [...names],
        seed,
      },
      options: forced.options,
      expectation: { prophet: true, surtr: true },
    };
  }
  const lifecycle = surtrLifecycle(ordinal);
  const options: RunBattleOptions = {
    forceSurtr: true,
    forceSurtrLifecycle: lifecycle,
  };
  if (config.mode === 'surtr-prophet') options.forceYuzuProphet = true;
  if (config.mode === 'surtr-herobrine') options.forceHerobrine = true;
  return {
    ordinal,
    context: `${config.mode}:${lifecycle}`,
    spec: {
      phase: config.mode,
      label: `${config.mode}-${ordinal}`,
      names: [...names],
      seed,
    },
    options,
    expectation: {
      prophet: config.mode === 'surtr-prophet',
      surtr: true,
    },
  };
}

function specsForConfig(config: WorkerConfig): Iterable<GeneratedAuditSpec> {
  if (config.mode === 'prophet-teams' || config.mode === 'surtr-teams') {
    return focusedTeamSpecs(
      config.mode,
      config.teamSize!,
      config.baseSeed,
      config.teamStrategy,
    );
  }
  return {
    *[Symbol.iterator]() {
      const endOrdinal = config.startOrdinal + config.count;
      for (let ordinal = config.startOrdinal; ordinal < endOrdinal; ordinal += 1) {
        yield generatedFfaSpec(config, ordinal);
      }
    },
  };
}

function rosterCoverage(spec: BattleSpec): Record<string, number> {
  const coverage: Record<string, number> = {};
  const present = new Set(spec.names.map((name) => name.split('@')[0] ?? name));
  present.forEach((name) => {
    coverage[name] = 1;
  });
  return coverage;
}

function focusedInteractionCoverage(
  result: BattleResult,
  expectation: FocusedAuditExpectation,
): Record<string, number> {
  const coverage: Record<string, number> = {};
  const add = (key: string, amount = 1) => {
    coverage[key] = (coverage[key] ?? 0) + amount;
  };
  const fighters = new Map(result.fighterDirectory.map((fighter) => [fighter.id, fighter]));
  const players = result.fighterDirectory.filter((fighter) =>
    SPECIALS.includes(fighter.name.replace(/#\d+$/, '')),
  );
  const prophetIds = new Set(
    result.fighterDirectory
      .filter((fighter) => fighter.isYuzuProphet)
      .map((fighter) => fighter.id),
  );
  const controlledIds = new Set(
    result.fighterDirectory
      .filter((fighter) => fighter.prophetControlDisposition !== undefined)
      .map((fighter) => fighter.id),
  );
  result.fighterDirectory
    .filter((fighter) => fighter.prophetControlDisposition !== undefined)
    .forEach((fighter) => {
      add(`prophet:controlled-kind:${fighter.kind}`);
      add(`prophet:controlled-disposition:${fighter.prophetControlDisposition}`);
    });
  const prophetFocusIds = new Set([...prophetIds, ...controlledIds]);
  const surtrIds = new Set(
    result.fighterDirectory
      .filter((fighter) => fighter.isSurtr)
      .map((fighter) => fighter.id),
  );
  players.forEach((player) => {
    const name = player.name.replace(/#\d+$/, '');
    if (expectation.prophet) {
      add(`prophet:co-present:${name}`);
      add(player.isYuzu ? `prophet:bound-role:${name}` : `prophet:third-party-role:${name}`);
    }
    if (expectation.surtr) {
      add(`surtr:co-present:${name}`);
      const ownedSurtr = result.fighterDirectory.some((fighter) =>
        fighter.isSurtr && fighter.surtrOwnerIds?.includes(player.id),
      );
      if (ownedSurtr) {
        add(`surtr:owner-role:${name}`);
      } else {
        const sameTeam = result.fighterDirectory.some((fighter) =>
          fighter.isSurtr &&
          !!fighter.teamId &&
          fighter.teamId === player.teamId,
        );
        add(`surtr:${sameTeam ? 'teammate' : 'third-party'}-role:${name}`);
      }
    }
  });
  result.events.forEach((event) => {
    if (event.kind !== 'action_start' && event.kind !== 'damage') return;
    const actorId = event.damage?.attackerId ?? event.actorId;
    const targetIds = event.kind === 'damage'
      ? [event.damage?.targetId].filter((id): id is string => !!id)
      : event.targetIds ?? [];
    const actor = actorId ? fighters.get(actorId) : undefined;
    const actorName = actor?.name.replace(/#\d+$/, '');
    const playerActor = actorName && SPECIALS.includes(actorName) ? actorName : undefined;
    targetIds.forEach((targetId) => {
      const target = fighters.get(targetId);
      const targetName = target?.name.replace(/#\d+$/, '');
      const playerTarget = targetName && SPECIALS.includes(targetName) ? targetName : undefined;
      if (expectation.prophet) {
        if (playerActor && prophetFocusIds.has(targetId)) add(`prophet:attacked-by:${playerActor}`);
        if (prophetFocusIds.has(actorId ?? '') && playerTarget) add(`prophet:targeted:${playerTarget}`);
      }
      if (expectation.surtr) {
        if (playerActor && surtrIds.has(targetId)) add(`surtr:attacked-by:${playerActor}`);
        if (surtrIds.has(actorId ?? '') && playerTarget) add(`surtr:targeted:${playerTarget}`);
      }
    });
  });
  return coverage;
}

function appendBattle(
  config: WorkerConfig,
  store: YuzuSurtrTraceStore,
  generated: GeneratedAuditSpec,
): boolean {
  const result = runBattle(generated.spec, {
    ...generated.options,
    checkInvariantsEachStep: true,
    includeInvariantLabel: true,
    maxTurns: config.maxTurns,
    scanLogs: true,
    scanRosterNames: true,
  });
  const audit = auditFocusedBattle(
    result,
    generated.expectation,
    generated.context,
  );
  const logPath = audit.issues.length > 0
    ? writeFailureLog(config, result, generated.ordinal)
    : '';
  const issues: StoredFocusedIssue[] = audit.issues.map((issue) => ({
    ...issue,
    label: result.label,
    seed: result.seed,
    context: generated.context,
    logPath,
  }));
  store.appendBattle({
    ordinal: generated.ordinal,
    label: result.label,
    seed: result.seed,
    context: generated.context,
    ended: result.ended,
    timedOut: result.timedOut,
    turns: result.turns,
    logs: result.logCount,
    issues,
    eventCounts: audit.eventCounts,
    prophetMetrics: audit.prophetMetrics as unknown as Record<string, number> | undefined,
    surtrCoverage: audit.surtrCoverage as unknown as Record<string, number> | undefined,
    rosterCoverage: rosterCoverage(generated.spec),
    interactionCoverage: focusedInteractionCoverage(result, generated.expectation),
  }, audit.traces);
  return issues.length > 0;
}

export function main(): void {
  const config = readConfig();
  const hash = configHash(config);
  const store = new YuzuSurtrTraceStore(config.outputDir, hash, {
    reset: process.env.NAMEARENA_FOCUSED_AUDIT_RESET === '1',
  });
  try {
    let state = stateFromStore(store, config, hash, store.isCompleted(), false);
    if (state.completed) {
      writeState(config, state);
      console.log(JSON.stringify(JSON.parse(fs.readFileSync(summaryPath(config), 'utf8')), null, 2));
      return;
    }
    let lastCheckpointAt = Date.now();
    let processedSinceCheckpoint = 0;
    let nextIndex = state.nextIndex;
    let issueBattles = state.issueBattles;
    let stoppedForIssues = false;
    const endOrdinal = config.startOrdinal + config.count;
    for (const generated of specsForConfig(config)) {
      if (generated.ordinal < nextIndex) continue;
      if (generated.ordinal >= endOrdinal) break;
      if (appendBattle(config, store, generated)) issueBattles += 1;
      nextIndex = generated.ordinal + 1;
      processedSinceCheckpoint += 1;
      if (
        processedSinceCheckpoint >= config.checkpointEvery ||
        issueBattles >= config.failFastIssueBattles
      ) {
        store.addElapsedMs(Date.now() - lastCheckpointAt);
        lastCheckpointAt = Date.now();
        stoppedForIssues = issueBattles >= config.failFastIssueBattles;
        state = stateFromStore(store, config, hash, false, stoppedForIssues);
        writeState(config, state);
        if (stoppedForIssues) break;
        processedSinceCheckpoint = 0;
      }
      const completedInShard = nextIndex - config.startOrdinal;
      if (completedInShard % 100 === 0 || nextIndex === endOrdinal) {
        console.log(`${config.mode}${config.teamSize ? `-${config.teamSize}v${config.teamSize}` : ''}: ${completedInShard}/${config.count}`);
      }
    }
    if (!stoppedForIssues && nextIndex >= endOrdinal) store.setCompleted(true);
    store.addElapsedMs(Date.now() - lastCheckpointAt);
    state = stateFromStore(store, config, hash, store.isCompleted(), stoppedForIssues);
    writeState(config, state);
    const summary = JSON.parse(fs.readFileSync(summaryPath(config), 'utf8')) as Record<string, unknown>;
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 1;
  } finally {
    store.close();
  }
}
