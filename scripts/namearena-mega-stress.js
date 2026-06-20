/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const ts = require(path.join(projectRoot, 'node_modules/typescript'));

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const { BattleEngine } = require(path.join(projectRoot, 'lib/namearena/battleEngine.ts'));
const { namerenaJobs } = require(path.join(projectRoot, 'lib/namearena/jobs.ts'));
const { namerenaSkills } = require(path.join(projectRoot, 'lib/namearena/skills.ts'));
const { namerenaData } = require(path.join(projectRoot, 'lib/namearena/data.ts'));
const coreModule = require(path.join(projectRoot, 'lib/namearena/core.ts'));
const { cloneFighters } = require(path.join(projectRoot, 'lib/namearena/combatState.ts'));
const { generateNameArenaFighter } = require(path.join(projectRoot, 'lib/namearena/fighterFactory.ts'));

const namerenaCore = coreModule.namerenaCore ?? coreModule;
const SPECIALS = ['水人', '玄凝', '小汀', '牢鳄', '克蕾儿丝菲尔', '丝瓜uli', '兔卷卷', '刺猬人', '屑', 'M1A2_abrams_sep'];
const NO_WATER = SPECIALS.filter((name) => name !== '水人');
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1200', 10);
const CHAOS_SEEDS = Number.parseInt(process.env.NAMEARENA_CHAOS_SEEDS ?? '300', 10);
const OUT_DIR = process.env.NAMEARENA_STRESS_OUT_DIR ?? path.join(os.tmpdir(), 'namearena-mega-stress');
const LOG_DIR = path.join(OUT_DIR, 'logs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFileName(s) {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 180);
}

function withSeed(seed, fn) {
  const rng = new namerenaCore.SeededRNG(seed);
  const originalRandom = Math.random;
  Math.random = () => rng.next();
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function makeFighter(name) {
  const fighter = generateNameArenaFighter(name);
  assert(fighter, `failed to generate fighter: ${name}`);
  return fighter;
}

function makeEngine(fighters, logs, turnCount = 0) {
  return new BattleEngine(
    fighters,
    (entry) => logs.push(entry),
    namerenaJobs,
    namerenaSkills,
    namerenaData,
    namerenaCore,
    turnCount,
  );
}

function combinations(items, size, start = 0, chosen = [], out = []) {
  if (chosen.length === size) {
    out.push([...chosen]);
    return out;
  }

  const remainingSlots = size - chosen.length;
  for (let i = start; i <= items.length - remainingSlots; i += 1) {
    chosen.push(items[i]);
    combinations(items, size, i + 1, chosen, out);
    chosen.pop();
  }
  return out;
}

function checkInvariants(fighters, label) {
  const errors = [];
  fighters.forEach((f) => {
    const hpPct = f.maxHp > 0 ? Math.max(0, f.currentHp) / f.maxHp : 0;
    const hpPctDelta = Math.abs((f.hpPct ?? 0) - hpPct);
    if (!Number.isFinite(f.currentHp) || !Number.isFinite(f.maxHp) || !Number.isFinite(f.hpPct)) errors.push(`${f.name} has non-finite HP in ${label}`);
    if (['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'].some((key) => !Number.isFinite(f[key]))) errors.push(`${f.name} has non-finite stat in ${label}`);
    if (f.currentHp > f.maxHp) errors.push(`${f.name} currentHp ${f.currentHp} > maxHp ${f.maxHp} in ${label}`);
    if (f.currentHp < 0) errors.push(`${f.name} currentHp negative: ${f.currentHp} in ${label}`);
    if (hpPctDelta > 0.0001) errors.push(`${f.name} hpPct mismatch in ${label}: ${f.hpPct} vs ${hpPct}`);
    if (f.isDead && f.currentHp > 0) errors.push(`${f.name} is dead but currentHp is ${f.currentHp} in ${label}`);
    if (!f.isDead && !f.isDeadAnnounced && f.currentHp <= 0) errors.push(`${f.name} is active but currentHp is ${f.currentHp} in ${label}`);
    if (f.status.some((s) => !Number.isFinite(s.duration))) errors.push(`${f.name} has non-finite status duration in ${label}`);
  });
  return errors;
}

function parseSlackingPair(text) {
  const match = text.match(/战斗进行到一半，(.+?) 和 (.+?) 突然对视/);
  return match ? [match[1], match[2]] : null;
}

function scanLogs(logs, label, rosterNames) {
  const issues = [];
  const activeSlacking = new Set();
  const names = [...new Set([...rosterNames, '小汀(傀儡)', '史瓦罗', '克拉拉', '钟离'])];
  const patterns = [
    ['nan-or-undefined', /\b(?:NaN|undefined|null)\b/],
    ['negative-number-log', /(?:造成|承受|恢复|损失)了? -\d/],
    ['zero-damage-control', /(?:承受了|造成了) 0 点.*(?:并被|并深度|并使其|眩晕|魅惑|击飞|中毒|灼烧|沉默)/],
    ['duplicate-damage-type', /物理\(物理\)|魔法\(魔法\)/],
  ];

  logs.forEach((entry, index) => {
    const line = index + 1;
    const text = entry.text;
    patterns.forEach(([type, regex]) => {
      if (regex.test(text)) issues.push({ label, line, type, text });
    });

    const pair = parseSlackingPair(text);
    if (pair) pair.forEach((name) => activeSlacking.add(name));

    [...activeSlacking].forEach((name) => {
      if (
        text.includes(`摸鱼时间结束！${name}`) ||
        text.includes(`看到搭子回去打工了，${name}`) ||
        (text.includes(`${name} 赶紧扔掉手里的奶茶`) && text.includes('满血跑回战场假装还在战斗')) ||
        text.includes(`${name} 满血跑回战场假装还在战斗`)
      ) {
        activeSlacking.delete(name);
      }
    });

    activeSlacking.forEach((name) => {
      const n = escapeRegExp(name);
      const suspicious = new RegExp(`(对 ${n}|攻击了 ${n}|${n} 承受|${n} 受到持续伤害|${n} 在深渊水牢|${n} 被(?:魔音|空袭|击中|冻结|眩晕|击飞|抹杀|魅惑|中毒|灼烧|沉默))`);
      const allowed =
        text.includes(`${name} 正在场外OB摸鱼`) ||
        text.includes('摸鱼伙伴羁绊') ||
        text.includes('场外OB状态') ||
        text.includes('摸鱼时间结束') ||
        text.includes('看到搭子回去打工') ||
        text.includes('满血跑回战场');
      if (!allowed && suspicious.test(text)) {
        issues.push({ label, line, type: 'slacking-hit-or-targeted', text, name });
      }
    });

    names.forEach((name) => {
      if (text.includes(`对 ${name} 造成了 0`) && /眩晕|魅惑|击飞|中毒|灼烧|沉默/.test(text)) {
        issues.push({ label, line, type: 'zero-damage-status-inline', text, name });
      }
    });
  });

  return issues;
}

function runBattle(spec) {
  return withSeed(spec.seed, () => {
    let fighters = spec.names.map(makeFighter);
    const logs = [];
    const spinalSwordRef = { current: false };
    let turnCount = 0;
    let ended = false;
    let error = null;

    for (let i = 0; i < MAX_TURNS; i += 1) {
      const engine = makeEngine(cloneFighters(fighters), logs, turnCount);
      try {
        ended = engine.step(spinalSwordRef);
        turnCount = engine.turnCount;
        fighters = engine.fighters;
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.stack || err.message}` : String(err);
        break;
      }
      if (ended) break;
    }

    const rosterNames = spec.names.map((n) => n.split('@')[0]);
    const survivors = fighters
      .filter((f) => !f.isDead && !f.isDeadAnnounced && f.currentHp > 0)
      .map((f) => `${f.name}:${f.job}:${f.currentHp}`);

    return {
      ...spec,
      turns: turnCount,
      ended,
      timedOut: !ended && !error,
      error,
      invariantErrors: checkInvariants(fighters, spec.label),
      logIssues: scanLogs(logs, spec.label, rosterNames),
      logCount: logs.length,
      survivors,
      logs,
    };
  });
}

function buildChaosSpecs(names, phase, baseSeed) {
  const specs = [];
  for (let i = 0; i < CHAOS_SEEDS; i += 1) {
    specs.push({
      phase,
      label: `${phase}-${i}`,
      names,
      seed: baseSeed + i,
    });
  }
  return specs;
}

function buildTeamSpecs(teamSize, baseSeed) {
  const specs = [];
  const teamAs = combinations(SPECIALS, teamSize);

  teamAs.forEach((teamA) => {
    const teamASet = new Set(teamA);
    const remaining = SPECIALS.filter((name) => !teamASet.has(name));
    combinations(remaining, teamSize).forEach((teamB) => {
      const label = `${teamSize}v${teamSize}-${teamA.join('+')}-vs-${teamB.join('+')}`;
      specs.push({
        phase: `special-${teamSize}v${teamSize}`,
        label,
        names: [
          ...teamA.map((name) => `${name}@A`),
          ...teamB.map((name) => `${name}@B`),
        ],
        seed: baseSeed + specs.length * 31,
      });
    });
  });

  return specs;
}

function buildSpecs() {
  return [
    ...buildChaosSpecs(SPECIALS, 'all-special-with-water', 8000),
    ...buildChaosSpecs(NO_WATER, 'all-special-no-water', 9000),
    ...buildTeamSpecs(2, 200000),
    ...buildTeamSpecs(3, 300000),
    ...buildTeamSpecs(4, 400000),
    ...buildTeamSpecs(5, 500000),
  ];
}

function writeLogFile(result, index) {
  const phaseDir = path.join(LOG_DIR, result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const logPath = path.join(phaseDir, `${String(index).padStart(5, '0')}-${sanitizeFileName(result.label)}.log`);
  const text = result.logs.map((entry, i) => `${String(i + 1).padStart(3, '0')} [${entry.type}] ${entry.text}`).join('\n');
  fs.writeFileSync(logPath, text + (text ? '\n' : ''), 'utf8');
  return logPath;
}

function issueContext(logs, line, radius = 3) {
  const start = Math.max(1, line - radius);
  const end = Math.min(logs.length, line + radius);
  return logs.slice(start - 1, end).map((entry, idx) => ({
    line: start + idx,
    type: entry.type,
    text: entry.text,
  }));
}

function initializeOutputDir() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function main() {
  initializeOutputDir();

  const specs = buildSpecs();
  const phaseStats = {};
  const issueContexts = [];
  const summaries = [];
  const issueTypeCounts = {};
  const startMs = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec);
    const logPath = writeLogFile(result, index);
    const allIssues = [
      ...result.logIssues,
      ...result.invariantErrors.map((text) => ({ label: spec.label, line: 0, type: 'invariant-error', text })),
    ];
    if (result.error) allIssues.push({ label: spec.label, line: 0, type: 'runtime-error', text: result.error });
    if (result.timedOut) allIssues.push({ label: spec.label, line: 0, type: 'timeout', text: `Battle did not end within ${MAX_TURNS} turns` });

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
    stat.issues += allIssues.length;
    stat.logCount += result.logCount;
    stat.maxTurns = Math.max(stat.maxTurns, result.turns);
    phaseStats[spec.phase] = stat;

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
      error: result.error ? String(result.error).split('\n')[0] : null,
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
  const summary = {
    ok: Object.values(phaseStats).every((s) => s.timedOut === 0 && s.errors === 0 && s.issues === 0),
    totalBattles: specs.length,
    maxTurns: MAX_TURNS,
    chaosSeeds: CHAOS_SEEDS,
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

main();
