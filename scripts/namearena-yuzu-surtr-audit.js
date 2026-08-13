/* eslint-disable @typescript-eslint/no-require-imports */
require('./namearena/shared/register');

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  buildDeepCoveragePlan,
} = require('./namearena/audit/yuzuSurtrDeepCoverage.ts');

const root = path.resolve(__dirname, '..');
const outputRoot = process.env.NAMEARENA_FOCUSED_AUDIT_ROOT
  ?? path.join(root, '.tmp', 'namearena-yuzu-surtr-audit');
const profileArg = process.argv.find((argument) => argument.startsWith('--profile='));
const profile = profileArg?.split('=')[1]
  ?? process.env.NAMEARENA_FOCUSED_AUDIT_PROFILE
  ?? 'smoke';
const validProfiles = new Set(['smoke', 'targeted', 'full', 'deep', 'exhaustive', 'all']);
if (!validProfiles.has(profile)) {
  throw new Error(`Unknown profile ${profile}; expected smoke, targeted, full, deep, exhaustive, or all`);
}

const requestedWorkers = Number.parseInt(process.env.NAMEARENA_FOCUSED_AUDIT_WORKERS ?? '4', 10);
const workerLimit = Math.max(
  1,
  Math.min(4, requestedWorkers, os.availableParallelism?.() ?? os.cpus().length),
);
const ffaShardSize = Math.max(
  1,
  Number.parseInt(process.env.NAMEARENA_FOCUSED_FFA_SHARD_SIZE ?? '1000', 10),
);
const teamShardSize = Math.max(
  1,
  Number.parseInt(process.env.NAMEARENA_FOCUSED_TEAM_SHARD_SIZE ?? '5000', 10),
);
const deepBatchSize = Math.max(
  100,
  Number.parseInt(process.env.NAMEARENA_DEEP_BATCH_SIZE ?? '1000', 10),
);
const deepMinBatches = Math.max(
  1,
  Number.parseInt(process.env.NAMEARENA_DEEP_MIN_BATCHES ?? '12', 10),
);
const deepMaxBatches = Math.max(
  deepMinBatches,
  Number.parseInt(process.env.NAMEARENA_DEEP_MAX_BATCHES ?? '30', 10),
);
const deepRuntimeMs = Math.max(
  60_000,
  Number.parseInt(process.env.NAMEARENA_DEEP_RUNTIME_MS ?? String(4 * 60 * 60 * 1000), 10),
);
const deepSmoke = process.env.NAMEARENA_DEEP_SMOKE === '1';

const ffaJobs = [
  ['prophet-no-water', 15000],
  ['prophet-with-water', 3000],
  ['surtr-no-water', 15000],
  ['surtr-with-water', 3000],
  ['surtr-prophet', 3000],
  ['surtr-herobrine', 3000],
];
const teamCounts = {
  prophet: { 2: 1716, 3: 25740, 4: 120120, 5: 180180 },
  surtr: { 2: 396, 3: 9900, 4: 64680, 5: 124740 },
};
const activeChildren = new Set();
let abortRequested = false;
const runLockPath = `${outputRoot}.lock`;
let ownsRunLock = false;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireRunLock() {
  fs.mkdirSync(path.dirname(runLockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(runLockPath, 'wx');
      fs.writeFileSync(descriptor, `${JSON.stringify({
        pid: process.pid,
        profile,
        startedAt: new Date().toISOString(),
        outputRoot,
      }, null, 2)}\n`, 'utf8');
      fs.closeSync(descriptor);
      ownsRunLock = true;
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner;
      try {
        owner = JSON.parse(fs.readFileSync(runLockPath, 'utf8'));
      } catch {
        owner = undefined;
      }
      if (processIsAlive(Number(owner?.pid))) {
        throw new Error(
          `Focused audit output is already owned by PID ${owner.pid} (${owner.profile ?? 'unknown profile'}): ${outputRoot}`,
        );
      }
      fs.rmSync(runLockPath, { force: true });
    }
  }
  throw new Error(`Unable to acquire focused audit lock: ${outputRoot}`);
}

function releaseRunLock() {
  if (!ownsRunLock) return;
  ownsRunLock = false;
  fs.rmSync(runLockPath, { force: true });
}

function stopForSignal(signal, exitCode) {
  abortRequested = true;
  activeChildren.forEach((child) => {
    if (!child.killed) child.kill(signal);
  });
  releaseRunLock();
  process.exit(exitCode);
}

acquireRunLock();
process.on('exit', releaseRunLock);
process.once('SIGINT', () => stopForSignal('SIGINT', 130));
process.once('SIGTERM', () => stopForSignal('SIGTERM', 143));
if (process.env.NAMEARENA_FOCUSED_AUDIT_RESET === '1') {
  fs.rmSync(outputRoot, { recursive: true, force: true });
}

function scaledCount(fullCount, kind) {
  if (profile === 'smoke') return kind === 'team' ? 2 : 3;
  if (profile === 'targeted') return kind === 'team' ? Math.min(50, fullCount) : Math.min(100, fullCount);
  return fullCount;
}

function splitJob(baseJob, count, shardSize, shouldShard) {
  if (!shouldShard || count <= shardSize) {
    return [{ ...baseJob, count, startOrdinal: 0 }];
  }
  const shardCount = Math.ceil(count / shardSize);
  return Array.from({ length: shardCount }, (_, index) => {
    const startOrdinal = index * shardSize;
    return {
      ...baseJob,
      id: `${baseJob.id}-part-${String(index + 1).padStart(3, '0')}-of-${String(shardCount).padStart(3, '0')}`,
      count: Math.min(shardSize, count - startOrdinal),
      startOrdinal,
    };
  });
}

function buildStandardJobs() {
  const jobs = [];
  if (profile !== 'exhaustive') {
    ffaJobs.forEach(([mode, fullCount], index) => {
      const count = scaledCount(fullCount, 'ffa');
      jobs.push(...splitJob({
        id: mode,
        mode,
        baseSeed: 3_100_000 + index * 100_000,
      }, count, ffaShardSize, profile === 'full' || profile === 'all'));
    });
  }
  if (['smoke', 'targeted', 'exhaustive', 'all'].includes(profile)) {
    for (const focus of ['prophet', 'surtr']) {
      for (let teamSize = 2; teamSize <= 5; teamSize += 1) {
        const count = scaledCount(teamCounts[focus][teamSize], 'team');
        jobs.push(...splitJob({
          id: `${focus}-teams-${teamSize}v${teamSize}`,
          mode: `${focus}-teams`,
          teamSize,
          teamStrategy: 'exhaustive',
          baseSeed: focus === 'prophet' ? 4_000_000 : 9_000_000,
        }, count, teamShardSize, profile === 'exhaustive' || profile === 'all'));
      }
    }
  }
  return jobs;
}

function buildDeepStaticJobs() {
  const plans = [];
  for (const focus of ['prophet', 'surtr']) {
    for (let teamSize = 3; teamSize <= 5; teamSize += 1) {
      plans.push(buildDeepCoveragePlan(focus, teamSize));
    }
  }
  const selectedLineups = plans.reduce((sum, plan) => sum + plan.selectedCount, 0);
  if (plans.some((plan) => plan.uncovered.length > 0)) {
    throw new Error('Deep greedy coverage left one or more obligations uncovered');
  }
  if (selectedLineups > 6000) {
    throw new Error(`Deep coverage selected ${selectedLineups} 3v3-5v5 lineups, above the 6000 cap`);
  }
  const jobs = [];
  for (const focus of ['prophet', 'surtr']) {
    const count = deepSmoke ? Math.min(12, teamCounts[focus][2]) : teamCounts[focus][2];
    jobs.push(...splitJob({
      id: `deep-${focus}-teams-2v2`,
      mode: `${focus}-teams`,
      teamSize: 2,
      teamStrategy: 'exhaustive',
      baseSeed: focus === 'prophet' ? 14_000_000 : 19_000_000,
      maxTurns: 10000,
    }, count, 500, !deepSmoke));
  }
  plans.forEach((plan) => {
    jobs.push({
      id: `deep-${plan.focus}-coverage-${plan.teamSize}v${plan.teamSize}`,
      mode: `${plan.focus}-teams`,
      teamSize: plan.teamSize,
      teamStrategy: 'coverage',
      baseSeed: plan.focus === 'prophet' ? 24_000_000 : 29_000_000,
      maxTurns: 10000,
      count: deepSmoke ? Math.min(12, plan.selectedCount) : plan.selectedCount,
      startOrdinal: 0,
    });
  });
  return {
    jobs,
    plans,
    fullTwoVsTwo: 2112,
    selectedLineups,
    fullStaticBattles: 2112 + selectedLineups,
  };
}

function summaryPath(job) {
  return path.join(outputRoot, job.id, 'summary.json');
}

function runJob(job) {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(outputRoot, job.id);
    const env = {
      ...process.env,
      NAMEARENA_FOCUSED_AUDIT_RESET: '0',
      NAMEARENA_FOCUSED_AUDIT_MODE: job.mode,
      NAMEARENA_FOCUSED_AUDIT_COUNT: String(job.count),
      NAMEARENA_FOCUSED_START_ORDINAL: String(job.startOrdinal ?? 0),
      NAMEARENA_FOCUSED_BASE_SEED: String(job.baseSeed),
      NAMEARENA_FOCUSED_AUDIT_OUT_DIR: outputDir,
      NAMEARENA_FOCUSED_CHECKPOINT_EVERY: job.count >= 10000 ? '1000' : '250',
      NAMEARENA_FOCUSED_TEAM_STRATEGY: job.teamStrategy ?? 'exhaustive',
      ...(job.teamSize ? { NAMEARENA_FOCUSED_TEAM_SIZE: String(job.teamSize) } : {}),
      ...(job.maxTurns ? { NAMEARENA_MAX_TURNS: String(job.maxTurns) } : {}),
    };
    const child = spawn(process.execPath, ['scripts/namearena-yuzu-surtr-audit-worker.js'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let stdoutBuffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      lines
        .filter((line) => /:\s+\d+\/\d+$/.test(line))
        .forEach((line) => console.log(`${job.id}: ${line}`));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      activeChildren.delete(child);
      let summary;
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath(job), 'utf8'));
      } catch (error) {
        reject(new Error(
          `${job.id} produced no readable summary (${signal ?? code}): ${error}\n${stderr.slice(-8000)}\n${stdoutBuffer.slice(-8000)}`,
        ));
        return;
      }
      if (code !== 0 || !summary.ok) {
        reject(new Error(
          `${job.id} failed (${signal ?? code}); issues=${summary.issueCount}, timeouts=${summary.timedOut}, summary=${summaryPath(job)}\n${stderr.slice(-8000)}`,
        ));
        return;
      }
      console.log(
        `${job.id}: complete (${summary.battles} battles, ${summary.uniqueSemanticTraces} structures, ${summary.reviewCategoryCount ?? 0} review categories)`,
      );
      resolve({ job, summary });
    });
  });
}

async function runJobs(jobs) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (!abortRequested && cursor < jobs.length) {
      const job = jobs[cursor++];
      results.push(await runJob(job));
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(workerLimit, Math.max(1, jobs.length)) }, () => worker()),
    );
  } catch (error) {
    abortRequested = true;
    activeChildren.forEach((child) => {
      if (!child.killed) child.kill('SIGTERM');
    });
    throw error;
  }
  return results;
}

function addNumericRecord(target, source) {
  Object.entries(source ?? {}).forEach(([key, value]) => {
    target[key] = (target[key] ?? 0) + Number(value ?? 0);
  });
}

function hasTable(database, name) {
  return !!database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(name);
}

function readBehaviorSets(results) {
  const structures = new Set();
  const presentations = new Set();
  const categories = new Set();
  results.forEach(({ summary }) => {
    const database = new DatabaseSync(summary.traceDatabase, { readOnly: true });
    try {
      for (const row of database.prepare('SELECT signature FROM semantic_traces').iterate()) {
        structures.add(String(row.signature));
      }
      if (hasTable(database, 'semantic_trace_presentations')) {
        for (const row of database.prepare(`
          SELECT structure_signature, presentation_signature
          FROM semantic_trace_presentations
        `).iterate()) {
          presentations.add(`${row.structure_signature}:${row.presentation_signature}`);
        }
      }
      if (hasTable(database, 'semantic_trace_review_categories')) {
        for (const row of database.prepare(`
          SELECT review_category FROM semantic_trace_review_categories
        `).iterate()) {
          categories.add(String(row.review_category));
        }
      }
    } finally {
      database.close();
    }
  });
  return { structures, presentations, categories };
}

function addSet(target, source) {
  let added = 0;
  source.forEach((value) => {
    if (target.has(value)) return;
    target.add(value);
    added += 1;
  });
  return added;
}

function readCriticalBranches(results) {
  const branches = new Set();
  results.forEach(({ summary }) => {
    for (const namespace of ['prophetMetrics', 'surtrCoverage', 'interactionCoverage']) {
      Object.entries(summary[namespace] ?? {}).forEach(([key, value]) => {
        if (Number(value) > 0) branches.add(`${namespace}:${key}`);
      });
    }
  });
  return branches;
}

function mergeTraceDatabases(results, suffix = profile) {
  const databasePath = path.join(outputRoot, `semantic-traces-${suffix}.sqlite`);
  fs.rmSync(databasePath, { force: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE semantic_trace_index (
      signature TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_job TEXT NOT NULL
    );
    CREATE TABLE presentation_trace_index (
      structure_signature TEXT NOT NULL,
      presentation_signature TEXT NOT NULL,
      count INTEGER NOT NULL,
      first_job TEXT NOT NULL,
      PRIMARY KEY (structure_signature, presentation_signature)
    );
    CREATE TABLE review_category_index (
      review_category TEXT PRIMARY KEY,
      first_job TEXT NOT NULL
    );
  `);
  const insertStructure = database.prepare(`
    INSERT INTO semantic_trace_index(signature, count, first_job)
    VALUES (?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET count = count + excluded.count
  `);
  const insertPresentation = database.prepare(`
    INSERT INTO presentation_trace_index(
      structure_signature, presentation_signature, count, first_job
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(structure_signature, presentation_signature)
    DO UPDATE SET count = count + excluded.count
  `);
  const insertCategory = database.prepare(`
    INSERT OR IGNORE INTO review_category_index(review_category, first_job)
    VALUES (?, ?)
  `);
  try {
    for (const { job, summary } of results) {
      const source = new DatabaseSync(summary.traceDatabase, { readOnly: true });
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const row of source.prepare('SELECT signature, count FROM semantic_traces').iterate()) {
          insertStructure.run(row.signature, row.count, job.id);
        }
        if (hasTable(source, 'semantic_trace_presentations')) {
          for (const row of source.prepare(`
            SELECT structure_signature, presentation_signature, count
            FROM semantic_trace_presentations
          `).iterate()) {
            insertPresentation.run(
              row.structure_signature,
              row.presentation_signature,
              row.count,
              job.id,
            );
          }
        }
        if (hasTable(source, 'semantic_trace_review_categories')) {
          for (const row of source.prepare(`
            SELECT review_category FROM semantic_trace_review_categories
          `).iterate()) insertCategory.run(row.review_category, job.id);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        source.close();
      }
    }
    const count = (table) => Number(
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0,
    );
    return {
      databasePath,
      uniqueSemanticTraces: count('semantic_trace_index'),
      uniquePresentationTraces: count('presentation_trace_index'),
      reviewCategoryCount: count('review_category_index'),
    };
  } finally {
    database.close();
  }
}

function mergeResults(results, startedAt, suffix = profile, extra = {}) {
  const aggregate = {
    ok: results.every(({ summary }) => summary.ok),
    profile: suffix,
    workerLimit,
    elapsedMs: Date.now() - startedAt,
    jobs: [],
    battles: 0,
    ended: 0,
    timedOut: 0,
    totalTurns: 0,
    totalLogs: 0,
    issueCount: 0,
    eventCounts: {},
    prophetMetrics: {},
    surtrCoverage: {},
    rosterCoverage: {},
    interactionCoverage: {},
    ...extra,
  };
  results
    .sort((left, right) => left.job.id.localeCompare(right.job.id))
    .forEach(({ job, summary }) => {
      aggregate.jobs.push({
        id: job.id,
        mode: job.mode,
        teamSize: job.teamSize,
        teamStrategy: job.teamStrategy,
        startOrdinal: job.startOrdinal,
        battles: summary.battles,
        uniqueSemanticTraces: summary.uniqueSemanticTraces,
        uniquePresentationTraces: summary.uniquePresentationTraces,
        reviewCategoryCount: summary.reviewCategoryCount,
        traceDatabase: summary.traceDatabase,
        summaryPath: summaryPath(job),
      });
      for (const key of ['battles', 'ended', 'timedOut', 'totalTurns', 'totalLogs', 'issueCount']) {
        aggregate[key] += summary[key] ?? 0;
      }
      addNumericRecord(aggregate.eventCounts, summary.eventCounts);
      addNumericRecord(aggregate.prophetMetrics, summary.prophetMetrics);
      addNumericRecord(aggregate.surtrCoverage, summary.surtrCoverage);
      addNumericRecord(aggregate.rosterCoverage, summary.rosterCoverage);
      addNumericRecord(aggregate.interactionCoverage, summary.interactionCoverage);
    });
  fs.mkdirSync(outputRoot, { recursive: true });
  Object.assign(aggregate, mergeTraceDatabases(results, suffix));
  fs.writeFileSync(
    path.join(outputRoot, `summary-${suffix}.json`),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    'utf8',
  );
  return aggregate;
}

function assertPositiveMetrics(report, namespace, names) {
  const values = report[namespace] ?? {};
  const missing = names.filter((name) => !(Number(values[name] ?? 0) > 0));
  if (missing.length > 0) {
    throw new Error(`Deep audit did not exercise ${namespace}: ${missing.join(', ')}`);
  }
}

function validateDeepReport(report, staticPlan) {
  if (deepSmoke) return;
  if (!report.ok || report.issueCount !== 0 || report.timedOut !== 0 || report.battles !== report.ended) {
    throw new Error('Deep audit contains a runtime, timeout, or semantic audit failure');
  }
  if (staticPlan.plans.some((plan) => plan.uncovered.length > 0)) {
    throw new Error('Deep team coverage has uncovered obligations');
  }
  assertPositiveMetrics(report, 'prophetMetrics', [
    'spawns',
    'bindings',
    'takeovers',
    'fallbackSurtrs',
    'clashes',
    'defenseWins',
    'defenseLosses',
    'controlledDeaths',
    'erasures',
    'returns',
    'phaseTwos',
    'executionPredictions',
    'executionCasts',
    'retreatStarts',
    'retreatEnds',
  ]);
  assertPositiveMetrics(report, 'surtrCoverage', [
    'summons',
    'twilightActivations',
    'afterglowStarts',
    'afterglowHits',
    'afterglowCompletions',
    'jointKillSplits',
  ]);
}

function adaptiveJobs(batchIndex, batchSize) {
  const partCount = Math.min(workerLimit, batchSize);
  const baseSize = Math.floor(batchSize / partCount);
  let remainder = batchSize % partCount;
  let offset = batchIndex * batchSize;
  return Array.from({ length: partCount }, (_, partIndex) => {
    const count = baseSize + (remainder-- > 0 ? 1 : 0);
    const job = {
      id: `deep-adaptive-batch-${String(batchIndex + 1).padStart(2, '0')}-part-${partIndex + 1}`,
      mode: 'deep-adaptive',
      count,
      startOrdinal: offset,
      baseSeed: 34_000_000,
      maxTurns: 10000,
      teamStrategy: 'exhaustive',
    };
    offset += count;
    return job;
  });
}

async function runDeep(startedAt) {
  const staticPlan = buildDeepStaticJobs();
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, 'deep-coverage-plan.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      fullTwoVsTwo: staticPlan.fullTwoVsTwo,
      selectedThreeToFive: staticPlan.selectedLineups,
      fullStaticBattles: staticPlan.fullStaticBattles,
      plans: staticPlan.plans,
    }, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `deep static coverage: ${staticPlan.fullTwoVsTwo} exact 2v2 + ${staticPlan.selectedLineups} greedy 3v3-5v5`,
  );
  const results = await runJobs(staticPlan.jobs);
  const globalBehaviors = readBehaviorSets(results);
  const globalCriticalBranches = readCriticalBranches(results);
  const convergence = [];
  let convergenceStreak = 0;
  const adaptiveStartedAt = Date.now();
  const minimum = deepSmoke ? 1 : deepMinBatches;
  const maximum = deepSmoke ? 2 : deepMaxBatches;
  const batchSize = deepSmoke ? Math.min(40, deepBatchSize) : deepBatchSize;
  for (let batchIndex = 0; batchIndex < maximum; batchIndex += 1) {
    if (Date.now() - adaptiveStartedAt >= deepRuntimeMs) {
      throw new Error(`Deep audit reached its ${Math.round(deepRuntimeMs / 60000)} minute limit before convergence`);
    }
    const batchResults = await runJobs(adaptiveJobs(batchIndex, batchSize));
    results.push(...batchResults);
    const next = readBehaviorSets(batchResults);
    const newStructures = addSet(globalBehaviors.structures, next.structures);
    const newPresentations = addSet(globalBehaviors.presentations, next.presentations);
    const newCategories = addSet(globalBehaviors.categories, next.categories);
    const newCriticalBranches = addSet(
      globalCriticalBranches,
      readCriticalBranches(batchResults),
    );
    const structureGrowthRate = newStructures / Math.max(1, globalBehaviors.structures.size);
    const eligible = batchIndex + 1 >= minimum;
    const convergedBatch = eligible && structureGrowthRate < 0.005 && newCriticalBranches === 0;
    convergenceStreak = convergedBatch ? convergenceStreak + 1 : 0;
    const batchRecord = {
      batch: batchIndex + 1,
      battles: batchSize,
      newStructures,
      newPresentations,
      newReviewCategories: newCategories,
      newCriticalBranches,
      totalStructures: globalBehaviors.structures.size,
      totalPresentations: globalBehaviors.presentations.size,
      totalReviewCategories: globalBehaviors.categories.size,
      structureGrowthRate,
      convergenceStreak,
    };
    convergence.push(batchRecord);
    console.log(`deep adaptive: ${JSON.stringify(batchRecord)}`);
    if (deepSmoke || convergenceStreak >= 3) break;
  }
  if (!deepSmoke && convergenceStreak < 3) {
    throw new Error(`Deep audit did not converge after ${maximum * batchSize} adaptive battles`);
  }
  const report = mergeResults(results, startedAt, 'deep', {
    deep: {
      smoke: deepSmoke,
      fullTwoVsTwo: staticPlan.fullTwoVsTwo,
      selectedThreeToFive: staticPlan.selectedLineups,
      staticBattlesExpected: deepSmoke
        ? staticPlan.jobs.reduce((sum, job) => sum + job.count, 0)
        : staticPlan.fullStaticBattles,
      adaptiveBattles: convergence.reduce((sum, batch) => sum + batch.battles, 0),
      adaptiveElapsedMs: Date.now() - adaptiveStartedAt,
      converged: deepSmoke || convergenceStreak >= 3,
      convergence,
      coverageFingerprints: staticPlan.plans.map((plan) => ({
        focus: plan.focus,
        teamSize: plan.teamSize,
        selectedCount: plan.selectedCount,
        obligationCount: plan.obligationCount,
        uncovered: plan.uncovered,
        fingerprint: plan.fingerprint,
      })),
    },
  });
  validateDeepReport(report, staticPlan);
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const startedAt = Date.now();
  if (profile === 'deep') {
    await runDeep(startedAt);
    return;
  }
  const results = await runJobs(buildStandardJobs());
  const report = mergeResults(results, startedAt);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
