/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = process.env.NAMEARENA_HEROBRINE_OUT_DIR ??
  path.join(root, '.tmp', 'namearena-herobrine-stress');
const requestedWorkers = Number.parseInt(process.env.NAMEARENA_HEROBRINE_WORKERS ?? '4', 10);
const availableWorkers = Math.max(1, Math.min(requestedWorkers, os.availableParallelism?.() ?? os.cpus().length));
const quickCount = process.env.NAMEARENA_HEROBRINE_QUICK_COUNT
  ? Number.parseInt(process.env.NAMEARENA_HEROBRINE_QUICK_COUNT, 10)
  : undefined;
const allCategories = [
  { mode: 'no-water', count: quickCount ?? 15000, baseSeed: 2718000 },
  { mode: 'with-water', count: quickCount ?? 3000, baseSeed: 2818000 },
  { mode: 'team-2v2', count: quickCount ?? 2000, baseSeed: 2918000 },
  { mode: 'team-3v3', count: quickCount ?? 2000, baseSeed: 3018000 },
  { mode: 'team-4v4', count: quickCount ?? 2000, baseSeed: 3118000 },
  { mode: 'team-5v5', count: quickCount ?? 2000, baseSeed: 3218000 },
];
const requestedModes = new Set(
  (process.env.NAMEARENA_HEROBRINE_MODES ?? '')
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean),
);
const categories = requestedModes.size > 0
  ? allCategories.filter((category) => requestedModes.has(category.mode))
  : allCategories;

if (categories.length === 0) {
  throw new Error(`No valid Herobrine stress modes selected: ${[...requestedModes].join(', ')}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'shards'), { recursive: true });

function shardBounds(total, workerCount, index) {
  const start = Math.floor((total * index) / workerCount);
  const end = Math.floor((total * (index + 1)) / workerCount);
  return { start, count: end - start };
}

function runShard(category, workerCount, index) {
  const bounds = shardBounds(category.count, workerCount, index);
  const outputPath = path.join(outDir, 'shards', `${category.mode}-${index}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/namearena-herobrine-stress-worker.js'], {
      cwd: root,
      env: {
        ...process.env,
        NAMEARENA_HEROBRINE_MODE: category.mode,
        NAMEARENA_HEROBRINE_COUNT: String(bounds.count),
        NAMEARENA_HEROBRINE_START_INDEX: String(bounds.start),
        NAMEARENA_HEROBRINE_BASE_SEED: String(category.baseSeed),
        NAMEARENA_HEROBRINE_OUTPUT_PATH: outputPath,
        NAMEARENA_HEROBRINE_ARTIFACT_DIR: path.join(outDir, 'artifacts'),
        NAMEARENA_HEROBRINE_MANUAL_LIMIT: process.env.NAMEARENA_HEROBRINE_MANUAL_LIMIT ?? '2',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        reject(new Error(`${category.mode} shard ${index} failed (${signal ?? code}): ${stderr.slice(-5000)}`));
        return;
      }
      const summary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      console.log(`${category.mode} shard ${index + 1}/${workerCount}: ${bounds.count} battles complete`);
      resolve(summary);
    });
  });
}

function sumObject(summaries, field) {
  const merged = {};
  for (const summary of summaries) {
    for (const [key, value] of Object.entries(summary[field] ?? {})) {
      if (typeof value === 'number') merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function mergePairCoverage(summaries, field) {
  return sumObject(summaries, field);
}

function average(total, samples) {
  return samples > 0 ? Number((total / samples).toFixed(2)) : null;
}

function mergeCategory(category, summaries) {
  const metrics = sumObject(summaries, 'metrics');
  const issueCounts = sumObject(summaries, 'issueCounts');
  const teammatePairs = mergePairCoverage(summaries, 'teammatePairs');
  const enemyPairs = mergePairCoverage(summaries, 'enemyPairs');
  const teammateCoverage = Object.values(teammatePairs);
  const enemyCoverage = Object.values(enemyPairs);
  const coverage = category.mode.startsWith('team-')
    ? {
        teammatePairCount: teammateCoverage.length,
        enemyPairCount: enemyCoverage.length,
        minimumTeammateAppearances: teammateCoverage.length > 0 ? Math.min(...teammateCoverage) : 0,
        minimumEnemyAppearances: enemyCoverage.length > 0 ? Math.min(...enemyCoverage) : 0,
      }
    : undefined;
  return {
    mode: category.mode,
    battleCount: category.count,
    ended: summaries.reduce((sum, summary) => sum + summary.ended, 0),
    timedOut: summaries.reduce((sum, summary) => sum + summary.timedOut, 0),
    runtimeErrors: summaries.reduce((sum, summary) => sum + summary.runtimeErrors, 0),
    invariantErrors: summaries.reduce((sum, summary) => sum + summary.invariantErrors, 0),
    genericLogIssues: summaries.reduce((sum, summary) => sum + summary.genericLogIssues, 0),
    clearRate: Number((((metrics.trueRemovals ?? 0) / category.count) * 100).toFixed(3)),
    contestantWipeRate: Number((((metrics.contestantWipes ?? 0) / category.count) * 100).toFixed(3)),
    averageRevivals: Number(((metrics.revivals ?? 0) / category.count).toFixed(3)),
    averageFormalRevealTurn: average(metrics.formalRevealTurnTotal ?? 0, metrics.formalRevealTurnSamples ?? 0),
    averagePhaseTwoTurn: average(metrics.phaseTwoTurnTotal ?? 0, metrics.phaseTwoTurnSamples ?? 0),
    averageCompletionTurn: average(metrics.completionTurnTotal ?? 0, metrics.completionTurnSamples ?? 0),
    metrics,
    issueCounts,
    coverage,
    teammatePairs,
    enemyPairs,
    manualLogs: summaries.flatMap((summary) => summary.manualLogs ?? []),
    issues: summaries.flatMap((summary) => summary.issues ?? []).slice(0, 1000),
    elapsedMs: Math.max(...summaries.map((summary) => summary.elapsedMs)),
  };
}

async function main() {
  const startedAt = Date.now();
  const categorySummaries = [];
  for (const category of categories) {
    const workerCount = Math.min(availableWorkers, category.count);
    const shards = await Promise.all(
      Array.from({ length: workerCount }, (_, index) => runShard(category, workerCount, index)),
    );
    categorySummaries.push(mergeCategory(category, shards));
  }
  const totalBattles = categorySummaries.reduce((sum, summary) => sum + summary.battleCount, 0);
  const noWater = categorySummaries.find((summary) => summary.mode === 'no-water');
  const issueCount = categorySummaries.reduce(
    (sum, summary) => sum + Object.values(summary.issueCounts).reduce((inner, value) => inner + value, 0),
    0,
  );
  const coverageFailures = categorySummaries.filter((summary) =>
    summary.coverage &&
    (
      summary.coverage.minimumTeammateAppearances < 20 ||
      summary.coverage.minimumEnemyAppearances < 20
    ),
  );
  const summary = {
    ok:
      issueCount === 0 &&
      categorySummaries.every((entry) => entry.timedOut === 0) &&
      coverageFailures.length === 0 &&
      (
        !noWater ||
        (noWater.clearRate >= 45 && noWater.clearRate <= 60)
      ),
    totalBattles,
    workers: availableWorkers,
    quickCount: quickCount ?? null,
    targetClearRate: [45, 60],
    noWaterClearRate: noWater?.clearRate ?? null,
    issueCount,
    coverageFailures: coverageFailures.map((entry) => entry.mode),
    categories: categorySummaries,
    manualReviewLogs: categorySummaries.flatMap((entry) => entry.manualLogs),
    elapsedMs: Date.now() - startedAt,
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: summary.ok,
    totalBattles,
    noWaterClearRate: summary.noWaterClearRate,
    issueCount,
    coverageFailures: summary.coverageFailures,
    elapsedMs: summary.elapsedMs,
    outDir,
  }, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
