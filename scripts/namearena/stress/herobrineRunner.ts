import fs from 'fs';
import path from 'path';
import {
  NO_WATER,
  SPECIALS,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
} from '../shared/harness';

type StressMode = 'no-water' | 'with-water' | 'team-2v2' | 'team-3v3' | 'team-4v4' | 'team-5v5';

type HerobrineMetrics = {
  appearances: number;
  formalReveals: number;
  phaseTwos: number;
  fogBehindUses: number;
  strippedLeavesUses: number;
  noFootstepsUses: number;
  cloneSummons: number;
  singleWorldUses: number;
  worldSeedUses: number;
  dontLookBackUses: number;
  removedCount: number;
  revivals: number;
  trueRemovals: number;
  contestantWipes: number;
  finalPursuits: number;
  finalPursuitPlayerWins: number;
  finalPursuitHerobrineWins: number;
  pyramidCollapses: number;
  pyramidEarlyBreaks: number;
  tunnelBreaks: number;
  treeResolutions: number;
  cloneDefeats: number;
  witnessApplications: number;
  maxWitnessReached: number;
  formalRevealTurnTotal: number;
  formalRevealTurnSamples: number;
  phaseTwoTurnTotal: number;
  phaseTwoTurnSamples: number;
  completionTurnTotal: number;
  completionTurnSamples: number;
};

type StressIssue = {
  label: string;
  seed: number;
  kind: string;
  detail: string;
  logPath?: string;
};

const MODE = (process.env.NAMEARENA_HEROBRINE_MODE ?? 'no-water') as StressMode;
const COUNT = Number.parseInt(process.env.NAMEARENA_HEROBRINE_COUNT ?? '100', 10);
const START_INDEX = Number.parseInt(process.env.NAMEARENA_HEROBRINE_START_INDEX ?? '0', 10);
const BASE_SEED = Number.parseInt(process.env.NAMEARENA_HEROBRINE_BASE_SEED ?? '2718000', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '2200', 10);
const OUT_PATH = process.env.NAMEARENA_HEROBRINE_OUTPUT_PATH ??
  path.join(process.cwd(), '.tmp', 'namearena-herobrine-stress', `${MODE}-${START_INDEX}.json`);
const ARTIFACT_DIR = process.env.NAMEARENA_HEROBRINE_ARTIFACT_DIR ??
  path.join(process.cwd(), '.tmp', 'namearena-herobrine-stress', 'artifacts');
const MANUAL_LIMIT = Number.parseInt(process.env.NAMEARENA_HEROBRINE_MANUAL_LIMIT ?? '2', 10);
const SAVE_ISSUE_LOG_LIMIT = Number.parseInt(process.env.NAMEARENA_HEROBRINE_ISSUE_LOG_LIMIT ?? '40', 10);

function emptyMetrics(): HerobrineMetrics {
  return {
    appearances: 0,
    formalReveals: 0,
    phaseTwos: 0,
    fogBehindUses: 0,
    strippedLeavesUses: 0,
    noFootstepsUses: 0,
    cloneSummons: 0,
    singleWorldUses: 0,
    worldSeedUses: 0,
    dontLookBackUses: 0,
    removedCount: 0,
    revivals: 0,
    trueRemovals: 0,
    contestantWipes: 0,
    finalPursuits: 0,
    finalPursuitPlayerWins: 0,
    finalPursuitHerobrineWins: 0,
    pyramidCollapses: 0,
    pyramidEarlyBreaks: 0,
    tunnelBreaks: 0,
    treeResolutions: 0,
    cloneDefeats: 0,
    witnessApplications: 0,
    maxWitnessReached: 0,
    formalRevealTurnTotal: 0,
    formalRevealTurnSamples: 0,
    phaseTwoTurnTotal: 0,
    phaseTwoTurnSamples: 0,
    completionTurnTotal: 0,
    completionTurnSamples: 0,
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function teamSizeForMode(mode: StressMode): number | undefined {
  const match = /^team-(\d)v\d$/.exec(mode);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function buildSpec(globalIndex: number): BattleSpec {
  const seed = BASE_SEED + globalIndex;
  if (MODE === 'no-water') {
    return { phase: MODE, label: `herobrine-${MODE}-${globalIndex}`, names: NO_WATER, seed };
  }
  if (MODE === 'with-water') {
    return { phase: MODE, label: `herobrine-${MODE}-${globalIndex}`, names: SPECIALS, seed };
  }
  const teamSize = teamSizeForMode(MODE);
  if (!teamSize) throw new Error(`Unsupported Herobrine stress mode: ${MODE}`);
  const roster = seededShuffle(SPECIALS, seed).slice(0, teamSize * 2);
  return {
    phase: MODE,
    label: `herobrine-${MODE}-${globalIndex}`,
    names: [
      ...roster.slice(0, teamSize).map((name) => `${name}@A`),
      ...roster.slice(teamSize).map((name) => `${name}@B`),
    ],
    seed,
  };
}

function countText(result: BattleResult, text: string): number {
  return result.logs.filter((entry) => entry.text.includes(text)).length;
}

function firstTurn(result: BattleResult, text: string): number | undefined {
  return result.logs.find((entry) => entry.text.includes(text))?.turn;
}

function countMatchingLogs(
  result: BattleResult,
  predicate: (entry: BattleResult['logs'][number]) => boolean,
): number {
  return result.logs.filter(predicate).length;
}

function countSpawnedClones(result: BattleResult): number {
  return result.logs.reduce((sum, entry) => {
    if (
      entry.skillId !== 'herobrine_wrong_player' ||
      !entry.text.includes('在雾中留下')
    ) return sum;
    const match = /留下\s+(\d+)\s+个/.exec(entry.text);
    return sum + (match ? Number.parseInt(match[1]!, 10) : 0);
  }, 0);
}

function collectMetrics(result: BattleResult): HerobrineMetrics {
  const metrics = emptyMetrics();
  metrics.appearances = countText(result, '【异常目击】');
  metrics.formalReveals = countText(result, '【远处的白眼】');
  metrics.phaseTwos = countText(result, '【你不是一个人在玩】');
  metrics.fogBehindUses = countMatchingLogs(result, (entry) =>
    entry.text.startsWith('⬛ 【雾后之人】') &&
    entry.text.includes('退入二乘二隧道'),
  );
  metrics.strippedLeavesUses = countMatchingLogs(result, (entry) =>
    entry.skillId === 'herobrine_stripped_leaves' &&
    entry.text.startsWith('🌳 【被剥去的树叶】') &&
    entry.text.includes('令枯枝掠过'),
  );
  metrics.noFootstepsUses = countText(result, '【没有脚步声】');
  metrics.cloneSummons = countSpawnedClones(result);
  metrics.singleWorldUses = countMatchingLogs(result, (entry) =>
    entry.skillId === 'herobrine_single_world' &&
    entry.text.startsWith('⬜ 【单人世界】'),
  );
  metrics.worldSeedUses = countMatchingLogs(result, (entry) =>
    entry.skillId === 'herobrine_world_seed_error' &&
    entry.text.startsWith('🧩 【世界种子错误】') &&
    entry.text.includes('读取'),
  );
  metrics.dontLookBackUses = countMatchingLogs(result, (entry) =>
    entry.skillId === 'herobrine_dont_look_back' &&
    entry.text.startsWith('👁️ 【不要回头】') &&
    entry.text.includes('被白色眼睛标记'),
  );
  metrics.removedCount = countText(result, '【Removed Herobrine.】');
  metrics.revivals = countText(result, '【你确定吗？】');
  metrics.trueRemovals = countText(result, '【真正退场】');
  metrics.contestantWipes = countText(result, '【猎杀结束】');
  metrics.finalPursuits = result.logs.filter((entry) =>
    entry.text.startsWith('👁️ 【最终追猎】战场只剩')
  ).length;
  metrics.finalPursuitPlayerWins = result.logs.some((entry) =>
    entry.text.includes('【最终追猎】')
  ) && result.logs.some((entry) => entry.text.includes('【真正退场】')) ? 1 : 0;
  metrics.finalPursuitHerobrineWins = result.logs.some((entry) =>
    entry.text.includes('【最终追猎】')
  ) && result.logs.some((entry) => entry.text.includes('【猎杀结束】')) ? 1 : 0;
  metrics.pyramidCollapses = countText(result, '【沙土金字塔坍塌】');
  metrics.pyramidEarlyBreaks = result.logs.filter((entry) =>
    entry.text.includes('【异常痕迹摧毁】') && entry.text.includes('沙土金字塔')
  ).length;
  metrics.tunnelBreaks = result.logs.filter((entry) =>
    entry.text.includes('【异常痕迹摧毁】') && entry.text.includes('二乘二隧道')
  ).length;
  metrics.treeResolutions = countMatchingLogs(result, (entry) =>
    entry.text.startsWith('🌳 【无叶之树】第'),
  );
  metrics.cloneDefeats = countText(result, '【分身识破】');
  metrics.witnessApplications = countMatchingLogs(result, (entry) =>
    entry.text.startsWith('◻️ 【目击】'),
  );
  metrics.maxWitnessReached = result.logs.some((entry) => /当前 5\/5/.test(entry.text)) ? 1 : 0;

  const revealTurn = firstTurn(result, '【远处的白眼】');
  if (revealTurn !== undefined) {
    metrics.formalRevealTurnTotal = revealTurn;
    metrics.formalRevealTurnSamples = 1;
  }
  const phaseTwoTurn = firstTurn(result, '【你不是一个人在玩】');
  if (phaseTwoTurn !== undefined) {
    metrics.phaseTwoTurnTotal = phaseTwoTurn;
    metrics.phaseTwoTurnSamples = 1;
  }
  const completion = result.logs.find((entry) =>
    entry.text.includes('【真正退场】') || entry.text.includes('【猎杀结束】'),
  );
  if (completion?.turn !== undefined) {
    metrics.completionTurnTotal = completion.turn;
    metrics.completionTurnSamples = 1;
  }
  return metrics;
}

function addMetrics(total: HerobrineMetrics, next: HerobrineMetrics): void {
  (Object.keys(total) as Array<keyof HerobrineMetrics>).forEach((key) => {
    total[key] += next[key];
  });
}

function semanticIssues(result: BattleResult, metrics: HerobrineMetrics): Array<{ kind: string; detail: string }> {
  const issues: Array<{ kind: string; detail: string }> = [];
  if (metrics.appearances !== 1) {
    issues.push({ kind: 'appearance-count', detail: `expected 1 appearance, got ${metrics.appearances}` });
  }
  if (metrics.formalReveals > 1) {
    issues.push({ kind: 'duplicate-formal-reveal', detail: `formal reveals=${metrics.formalReveals}` });
  }
  if (metrics.phaseTwos > 1) {
    issues.push({ kind: 'duplicate-phase-two', detail: `phase twos=${metrics.phaseTwos}` });
  }
  if (metrics.trueRemovals + metrics.contestantWipes > 1) {
    issues.push({
      kind: 'contradictory-event-outcome',
      detail: `true removals=${metrics.trueRemovals}, contestant wipes=${metrics.contestantWipes}`,
    });
  }
  if (result.ended && metrics.trueRemovals + metrics.contestantWipes !== 1) {
    issues.push({
      kind: 'missing-event-outcome',
      detail: `ended battle has true removals=${metrics.trueRemovals}, contestant wipes=${metrics.contestantWipes}`,
    });
  }
  const winnerLog = result.logs.find((entry) => entry.text.includes('最终胜者'));
  if (winnerLog && /最终胜者：[^！]*(?:Herobrine|白眼分身|二乘二隧道|无叶之树|沙土金字塔)/.test(winnerLog.text)) {
    issues.push({ kind: 'npc-ranked-as-winner', detail: winnerLog.text });
  }
  const internalId = result.logs.find((entry) =>
    !(entry.type === 'system' && entry.text.startsWith('state-sync:')) &&
    (
      /\bHEROBRINE_[A-Z0-9_]+\b/.test(entry.text) ||
      /\bherobrine:[a-z0-9_:.-]+\b/i.test(entry.text) ||
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(entry.text)
    ),
  );
  if (internalId) issues.push({ kind: 'internal-id-leak', detail: internalId.text });
  const herobrineId = result.logs.find((entry) =>
    entry.text.includes('【远处的白眼】') &&
    entry.actorId
  )?.actorId;
  let identityHidden = false;
  let initialFog = false;
  let canonicalIdentityExpected = false;
  for (const entry of result.logs) {
    if (entry.text.includes('【异常目击】')) {
      initialFog = true;
      canonicalIdentityExpected = false;
      continue;
    }
    const revealsIdentity =
      entry.text.includes('【远处的白眼】') ||
      entry.text.includes('【雾中归来】') ||
      entry.text.includes('【你确定吗？】') ||
      entry.text.startsWith('👁️ 【最终追猎】战场只剩') ||
      entry.text.includes('【真正退场】');
    if (revealsIdentity) {
      initialFog = false;
      identityHidden = false;
      canonicalIdentityExpected = !entry.text.includes('【真正退场】');
      continue;
    }
    if (entry.text.includes('【Removed Herobrine.】') || entry.text.includes('【猎杀结束】')) {
      initialFog = false;
      identityHidden = false;
      canonicalIdentityExpected = false;
      continue;
    }
    if (entry.text.startsWith('⬛ 【雾后之人】') && entry.text.includes('退入二乘二隧道')) {
      identityHidden = true;
      canonicalIdentityExpected = false;
      continue;
    }
    const canonicalActorLeak =
      herobrineId !== undefined &&
      entry.actorId === herobrineId &&
      entry.actorName === 'Herobrine';
    const canonicalTargetLeak =
      herobrineId !== undefined &&
      entry.targetIds?.includes(herobrineId) === true &&
      entry.text.includes('Herobrine');
    if (
      (initialFog || identityHidden) &&
      !(entry.type === 'system' && entry.text.startsWith('state-sync:')) &&
      // Unrevealed clones intentionally keep the public name Herobrine. Only
      // metadata tied to the authoritative body proves that the hidden identity leaked.
      (canonicalActorLeak || canonicalTargetLeak)
    ) {
      issues.push({
        kind: 'hidden-identity-leak',
        detail: `${initialFog ? 'initial fog' : 'Fog Behind'}: ${entry.text}`,
      });
      break;
    }
    if (
      canonicalIdentityExpected &&
      herobrineId !== undefined &&
      entry.actorId === herobrineId &&
      entry.actorName === '【未知】'
    ) {
      issues.push({
        kind: 'visible-identity-stuck-anonymous',
        detail: entry.text,
      });
      break;
    }
  }
  const missingRoot = result.events.find((event) => !event.id || !event.rootEventId);
  if (missingRoot) issues.push({ kind: 'event-root-missing', detail: `${missingRoot.kind}:${missingRoot.id}` });
  const orphanHerobrineAction = result.logs.find((entry) =>
    /【(?:空洞凝视|空洞袭击|未知玩家|未知袭击|雾后袭击|被剥去的树叶|世界种子错误结算|身后追击|白眼分身)】/.test(entry.text) &&
    (!entry.rootEventId || !entry.actionId),
  );
  if (orphanHerobrineAction) {
    issues.push({ kind: 'herobrine-action-root-missing', detail: orphanHerobrineAction.text });
  }
  const completionIndex = result.logs.findIndex((entry) =>
    entry.text.includes('【真正退场】') || entry.text.includes('【猎杀结束】'),
  );
  if (completionIndex >= 0) {
    const ghost = result.logs.slice(completionIndex + 1).find((entry) =>
      /【(?:空洞凝视|空洞袭击|未知玩家|未知袭击|雾后袭击|被剥去的树叶|错误的玩家|单人世界|世界种子错误|世界残留|不要回头|白眼分身|目击|沙土金字塔坍塌|坍塌结算|坍塌结束|无叶之树)】/.test(entry.text),
    );
    if (ghost) issues.push({ kind: 'post-completion-event-action', detail: ghost.text });
  }
  return issues;
}

function formatLog(result: BattleResult): string {
  return result.logs.map((entry, index) =>
    `${String(index + 1).padStart(5, '0')} [T${entry.turn ?? '?'}] [${entry.type}] [root=${entry.rootEventId ?? '-'} action=${entry.actionId ?? '-'}] ${entry.text}`,
  ).join('\n');
}

function saveBattleLog(result: BattleResult, bucket: 'manual' | 'issues'): string {
  const directory = path.join(ARTIFACT_DIR, bucket, MODE);
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${sanitizeFileName(result.label)}.log`);
  fs.writeFileSync(filePath, `${formatLog(result)}\n`, 'utf8');
  return filePath;
}

function addTeamCoverage(spec: BattleSpec, teammatePairs: Record<string, number>, enemyPairs: Record<string, number>): void {
  const teams = new Map<string, string[]>();
  for (const rawName of spec.names) {
    const [name, team = name] = rawName.split('@');
    const members = teams.get(team) ?? [];
    members.push(name!);
    teams.set(team, members);
  }
  const teamLists = [...teams.values()];
  for (const members of teamLists) {
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        const key = [members[left]!, members[right]!].sort().join('::');
        teammatePairs[key] = (teammatePairs[key] ?? 0) + 1;
      }
    }
  }
  if (teamLists.length !== 2) return;
  for (const left of teamLists[0]!) {
    for (const right of teamLists[1]!) {
      const key = [left, right].sort().join('::');
      enemyPairs[key] = (enemyPairs[key] ?? 0) + 1;
    }
  }
}

export function main(): void {
  const metrics = emptyMetrics();
  const issues: StressIssue[] = [];
  const issueCounts: Record<string, number> = {};
  const teammatePairs: Record<string, number> = {};
  const enemyPairs: Record<string, number> = {};
  const manualLogs: string[] = [];
  let issueLogsSaved = 0;
  let ended = 0;
  let timedOut = 0;
  let runtimeErrors = 0;
  let invariantErrors = 0;
  let genericLogIssues = 0;
  const startedAt = Date.now();

  for (let localIndex = 0; localIndex < COUNT; localIndex += 1) {
    const globalIndex = START_INDEX + localIndex;
    const spec = buildSpec(globalIndex);
    if (MODE.startsWith('team-')) addTeamCoverage(spec, teammatePairs, enemyPairs);
    const result = runBattle(spec, {
      maxTurns: MAX_TURNS,
      forceHerobrine: true,
      checkInvariants: true,
      checkInvariantsEachStep: false,
      scanLogs: true,
      scanRosterNames: true,
    });
    const battleMetrics = collectMetrics(result);
    addMetrics(metrics, battleMetrics);
    if (result.ended) ended += 1;
    if (result.timedOut) timedOut += 1;
    if (result.error) runtimeErrors += 1;
    invariantErrors += result.invariantErrors.length;
    genericLogIssues += result.logIssues.length;

    const battleIssues: Array<{ kind: string; detail: string }> = [];
    if (result.error) battleIssues.push({ kind: 'runtime-error', detail: result.error });
    result.invariantErrors.forEach((detail) => battleIssues.push({ kind: 'invariant', detail }));
    result.logIssues.forEach((issue) => {
      battleIssues.push({ kind: `generic-log:${issue.type}`, detail: `line ${issue.line}: ${issue.text}` });
    });
    semanticIssues(result, battleMetrics).forEach((issue) => battleIssues.push(issue));

    let issueLogPath: string | undefined;
    if (battleIssues.length > 0 && issueLogsSaved < SAVE_ISSUE_LOG_LIMIT) {
      issueLogPath = saveBattleLog(result, 'issues');
      issueLogsSaved += 1;
    }
    for (const issue of battleIssues) {
      issueCounts[issue.kind] = (issueCounts[issue.kind] ?? 0) + 1;
      if (issues.length < 500) {
        issues.push({ label: spec.label, seed: spec.seed, ...issue, logPath: issueLogPath });
      }
    }

    if (manualLogs.length < MANUAL_LIMIT) {
      manualLogs.push(saveBattleLog(result, 'manual'));
    }
  }

  const summary = {
    mode: MODE,
    count: COUNT,
    startIndex: START_INDEX,
    baseSeed: BASE_SEED,
    maxTurns: MAX_TURNS,
    ended,
    timedOut,
    runtimeErrors,
    invariantErrors,
    genericLogIssues,
    metrics,
    issueCounts,
    issues,
    teammatePairs,
    enemyPairs,
    manualLogs,
    elapsedMs: Date.now() - startedAt,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    mode: MODE,
    count: COUNT,
    ended,
    timedOut,
    issueCounts,
    metrics,
    elapsedMs: summary.elapsedMs,
    outputPath: OUT_PATH,
  }, null, 2));
}
