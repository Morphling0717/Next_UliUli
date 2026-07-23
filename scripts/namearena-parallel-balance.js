/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const battleCount = Number.parseInt(process.env.NAMEARENA_BALANCE_BATTLES ?? '15000', 10);
const baseSeed = Number.parseInt(process.env.NAMEARENA_BALANCE_BASE_SEED ?? '1910000', 10);
const requestedWorkers = Number.parseInt(process.env.NAMEARENA_BALANCE_WORKERS ?? '4', 10);
const workers = Math.max(1, Math.min(requestedWorkers, os.availableParallelism?.() ?? os.cpus().length, battleCount));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '.tmp', 'namearena-deep-audit', 'balance-shards');
const aggregatePath = process.env.NAMEARENA_BALANCE_OUTPUT_PATH ?? path.join(root, '.tmp', 'namearena-deep-audit', 'no-water-15000.json');
const mergeOnly = process.env.NAMEARENA_BALANCE_MERGE_ONLY === 'true';

if (!mergeOnly) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function shardBounds(index) {
  const start = Math.floor((battleCount * index) / workers);
  const end = Math.floor((battleCount * (index + 1)) / workers);
  return { start, count: end - start };
}

function runShard(index) {
  const { start, count } = shardBounds(index);
  const outputPath = path.join(outDir, `shard-${index}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/namearena-balance-ffa.js'], {
      cwd: root,
      env: {
        ...process.env,
        NAMEARENA_BALANCE_BATTLES: String(count),
        NAMEARENA_BALANCE_START_INDEX: String(start),
        NAMEARENA_BALANCE_BASE_SEED: String(baseSeed),
        NAMEARENA_BALANCE_EVALUATE: 'false',
        NAMEARENA_BALANCE_SCAN_LOGS: process.env.NAMEARENA_BALANCE_SCAN_LOGS ?? 'false',
        NAMEARENA_BALANCE_PROGRESS: '0',
        NAMEARENA_BALANCE_QUIET: 'true',
        NAMEARENA_BALANCE_OUTPUT_PATH: outputPath,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0 && !fs.existsSync(outputPath)) {
        reject(new Error(`balance shard ${index} failed (${signal ?? code}): ${stderr.slice(-4000)}`));
        return;
      }
      const summary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      console.log(`balance shard ${index + 1}/${workers} complete: ${count} battles from sample ${start}${code === 0 ? '' : ' (reported audit findings)'}`);
      resolve(summary);
    });
  });
}

function sumObjectFields(summaries, key) {
  const merged = {};
  for (const summary of summaries) {
    for (const [field, value] of Object.entries(summary[key] ?? {})) {
      if (typeof value === 'number') merged[field] = (merged[field] ?? 0) + value;
    }
  }
  return merged;
}

async function main() {
  const startedAt = Date.now();
  const summaries = mergeOnly
    ? Array.from({ length: workers }, (_, index) => {
        const outputPath = path.join(outDir, `shard-${index}.json`);
        if (!fs.existsSync(outputPath)) throw new Error(`missing completed balance shard: ${outputPath}`);
        return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      })
    : await Promise.all(Array.from({ length: workers }, (_, index) => runShard(index)));
  const issueCounts = sumObjectFields(summaries, 'issueCounts');
  const standings = summaries[0].standings.map((first) => {
    const entries = summaries.map((summary) => summary.standings.find((entry) => entry.name === first.name));
    const winCredits = entries.reduce((sum, entry) => sum + (entry?.winCredits ?? 0), 0);
    const coWins = entries.reduce((sum, entry) => sum + (entry?.coWins ?? 0), 0);
    const soleWins = entries.reduce((sum, entry) => sum + (entry?.soleWins ?? 0), 0);
    const jointWins = entries.reduce((sum, entry) => sum + (entry?.jointWins ?? 0), 0);
    return {
      name: first.name,
      winCredits: Number(winCredits.toFixed(3)),
      creditRate: Number(((winCredits / battleCount) * 100).toFixed(3)),
      coWins,
      coWinRate: Number(((coWins / battleCount) * 100).toFixed(3)),
      soleWins,
      soleWinRate: Number(((soleWins / battleCount) * 100).toFixed(3)),
      jointWins,
      jointWinRate: Number(((jointWins / battleCount) * 100).toFixed(3)),
    };
  }).sort((left, right) => right.creditRate - left.creditRate);
  const mechanismOk = (issueCounts.error ?? 0) === 0 &&
    (issueCounts.invariant ?? 0) === 0 &&
    (issueCounts.log ?? 0) === 0;
  const aggregate = {
    ok: mechanismOk,
    mechanismOk,
    balanceEvaluated: false,
    battleCount,
    baseSeed,
    workers,
    mergeOnly,
    elapsedMs: Date.now() - startedAt,
    summedWorkerElapsedMs: summaries.reduce((sum, summary) => sum + summary.elapsedMs, 0),
    issueCounts,
    standings,
    puruisaishi: {
      appearedBattles: summaries.reduce((sum, summary) => sum + summary.puruisaishi.appearedBattles, 0),
      phaseTwoBattles: summaries.reduce((sum, summary) => sum + summary.puruisaishi.phaseTwoBattles, 0),
      retreatedBattles: summaries.reduce((sum, summary) => sum + summary.puruisaishi.retreatedBattles, 0),
    },
    shards: summaries.map((summary) => ({
      battleCount: summary.battleCount,
      startIndex: summary.startIndex,
      elapsedMs: summary.elapsedMs,
      issueCounts: summary.issueCounts,
    })),
  };
  fs.mkdirSync(path.dirname(aggregatePath), { recursive: true });
  fs.writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...aggregate, outputPath: aggregatePath }, null, 2));
  if (!aggregate.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
