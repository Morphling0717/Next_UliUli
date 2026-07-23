/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coverageRoot = path.join(root, '.tmp', 'namearena-deep-audit', 'coverage');
const requestedWorkers = Number.parseInt(process.env.NAMEARENA_COVERAGE_WORKERS ?? '4', 10);
const workerLimit = Math.max(1, Math.min(requestedWorkers, os.availableParallelism?.() ?? os.cpus().length));
const teamBattles = process.env.NAMEARENA_TEAM_SAMPLE_BATTLES ?? '2000';
const waterBattles = process.env.NAMEARENA_WITH_WATER_BATTLES ?? '3000';
const puruBattles = process.env.NAMEARENA_PURUISAISHI_BATTLES ?? '500';

const jobs = [2, 3, 4, 5].map((teamSize) => ({
  id: `teams-${teamSize}v${teamSize}`,
  env: {
    NAMEARENA_DEEP_PHASE: 'teams',
    NAMEARENA_TEAM_SIZE: String(teamSize),
    NAMEARENA_TEAM_SAMPLE_BATTLES: teamBattles,
  },
  summaryPath: path.join(coverageRoot, `teams-${teamSize}v${teamSize}`, 'summary-teams.json'),
}));
jobs.push({
  id: 'with-water',
  env: { NAMEARENA_DEEP_PHASE: 'with-water', NAMEARENA_WITH_WATER_BATTLES: waterBattles },
  summaryPath: path.join(coverageRoot, 'with-water', 'summary-with-water.json'),
});
jobs.push({
  id: 'puruisaishi',
  env: { NAMEARENA_DEEP_PHASE: 'puruisaishi', NAMEARENA_PURUISAISHI_BATTLES: puruBattles },
  summaryPath: path.join(coverageRoot, 'puruisaishi', 'summary-puruisaishi.json'),
});

function runJob(job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/namearena-deep-coverage.js'], {
      cwd: root,
      env: { ...process.env, ...job.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      lines.filter((line) => /:\s+\d+\/\d+$/.test(line)).forEach((line) => console.log(`${job.id}: ${line}`));
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${job.id} failed (${signal ?? code}):\n${stderr.slice(-8000)}\n${stdout.slice(-8000)}`));
        return;
      }
      const summary = JSON.parse(fs.readFileSync(job.summaryPath, 'utf8'));
      console.log(`${job.id}: complete (${Object.values(summary.phaseSummaries).reduce((sum, phase) => sum + phase.battles, 0)} battles)`);
      resolve({ id: job.id, summaryPath: job.summaryPath, summary });
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      results.push(await runJob(job));
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerLimit, jobs.length) }, () => worker()));
  results.sort((left, right) => left.id.localeCompare(right.id));
  const report = {
    ok: results.every((result) => result.summary.ok),
    workerLimit,
    elapsedMs: Date.now() - startedAt,
    jobs: results.map((result) => ({
      id: result.id,
      summaryPath: result.summaryPath,
      ok: result.summary.ok,
      hardFailureCount: result.summary.hardFailureCount,
      phaseSummaries: result.summary.phaseSummaries,
    })),
  };
  fs.mkdirSync(coverageRoot, { recursive: true });
  const outputPath = path.join(coverageRoot, 'summary-all.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
