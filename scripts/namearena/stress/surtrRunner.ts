import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_STRESS_MAX_TURNS,
  NO_WATER,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
  type LogEntry,
  type LogIssue,
} from '../shared/harness';

const OUT_DIR = process.env.NAMEARENA_SURTR_STRESS_OUT_DIR
  ?? path.join(process.cwd(), '.tmp', 'namearena-surtr-stress');
const LOG_DIR = path.join(OUT_DIR, 'logs');
const STRESS_SEEDS = Number.parseInt(process.env.NAMEARENA_SURTR_STRESS_SEEDS ?? '300', 10);
const BASE_SEED = Number.parseInt(process.env.NAMEARENA_SURTR_STRESS_BASE_SEED ?? '2762000', 10);
const SURTR_NAME = '史尔特尔(?:#\\d+)?';

type SurtrCoverage = {
  summons: number;
  twilightActivations: number;
  afterglowStarts: number;
  afterglowHits: number;
  afterglowCompletions: number;
  jointKillSplits: number;
};

type BattleSummary = {
  label: string;
  seed: number;
  turns: number;
  ended: boolean;
  timedOut: boolean;
  error: string | null;
  issueCount: number;
  logCount: number;
  coverage: SurtrCoverage;
  logPath: string | null;
};

type Summary = SurtrCoverage & {
  ok: boolean;
  totalBattles: number;
  maxTurns: number;
  elapsedMs: number;
  issueTypeCounts: Record<string, number>;
  reviewedLogFiles: number;
  outDir: string;
};

type ScanResult = {
  issues: LogIssue[];
  coverage: SurtrCoverage;
};

type TrackedSurtr = {
  twilightActivations: number;
  lastDrain: number;
  afterglowActive: boolean;
  afterglowProgress: number;
};

function emptyCoverage(): SurtrCoverage {
  return {
    summons: 0,
    twilightActivations: 0,
    afterglowStarts: 0,
    afterglowHits: 0,
    afterglowCompletions: 0,
    jointKillSplits: 0,
  };
}

function addCoverage(total: SurtrCoverage, next: SurtrCoverage): void {
  total.summons += next.summons;
  total.twilightActivations += next.twilightActivations;
  total.afterglowStarts += next.afterglowStarts;
  total.afterglowHits += next.afterglowHits;
  total.afterglowCompletions += next.afterglowCompletions;
  total.jointKillSplits += next.jointKillSplits;
}

function trackedState(states: Map<string, TrackedSurtr>, name: string): TrackedSurtr {
  const existing = states.get(name);
  if (existing) return existing;
  const created: TrackedSurtr = {
    twilightActivations: 0,
    lastDrain: 0,
    afterglowActive: false,
    afterglowProgress: 0,
  };
  states.set(name, created);
  return created;
}

function issue(result: BattleResult, line: number, type: string, text: string): LogIssue {
  return { label: result.label, line, type, text };
}

function scanSurtrLogs(result: BattleResult): ScanResult {
  const issues: LogIssue[] = [];
  const coverage = emptyCoverage();
  const states = new Map<string, TrackedSurtr>();
  const ownerNames = new Map<string, [string, string]>();

  result.logs.forEach((entry, index) => {
    const line = index + 1;
    const text = entry.text;
    const summon = text.match(new RegExp(`【共同主人确立】(${SURTR_NAME}) 同时认 (.+?) 与 (.+?) 为主人`));
    if (summon?.[1] && summon[2] && summon[3]) {
      coverage.summons += 1;
      trackedState(states, summon[1]);
      ownerNames.set(summon[1], [summon[2], summon[3]]);
    }

    const twilight = text.match(new RegExp(`【黄昏】(${SURTR_NAME})：“莱万汀！”`));
    if (twilight?.[1]) {
      const state = trackedState(states, twilight[1]);
      state.twilightActivations += 1;
      coverage.twilightActivations += 1;
      if (state.twilightActivations > 1) {
        issues.push(issue(
          result,
          line,
          'surtr-twilight-repeated',
          `${twilight[1]} 在同一场战斗第 ${state.twilightActivations} 次发动黄昏：${text}`,
        ));
      }
      if (!text.includes('本局唯一一次黄昏已经消耗')) {
        issues.push(issue(result, line, 'surtr-twilight-missing-consumption', text));
      }
      const targetCount = Number.parseInt(text.match(/锁定 (\d+) 名目标/)?.[1] ?? '-1', 10);
      if (targetCount < 0 || targetCount > 4) {
        issues.push(issue(result, line, 'surtr-twilight-target-count', text));
      }
    }

    if (new RegExp(`(${SURTR_NAME}).*已经燃尽，本局不能再次发动`).test(text)) {
      issues.push(issue(result, line, 'surtr-twilight-reselected', text));
    }

    const drain = text.match(new RegExp(`【黄昏流失 (\\d+)】(${SURTR_NAME}).*最大生命的 (\\d+)%`));
    if (drain?.[1] && drain[2] && drain[3]) {
      const count = Number.parseInt(drain[1], 10);
      const pct = Number.parseInt(drain[3], 10);
      const state = trackedState(states, drain[2]);
      if (count !== state.lastDrain + 1) {
        issues.push(issue(
          result,
          line,
          'surtr-drain-sequence',
          `${drain[2]} 的黄昏流失应为第 ${state.lastDrain + 1} 次，日志却是第 ${count} 次：${text}`,
        ));
      }
      if (pct !== Math.min(20, count)) {
        issues.push(issue(result, line, 'surtr-drain-percentage', text));
      }
      state.lastDrain = count;
    }

    const afterglowStart = text.match(new RegExp(`【黄昏余命】(${SURTR_NAME}) 的生命降至 0`));
    if (afterglowStart?.[1]) {
      const state = trackedState(states, afterglowStart[1]);
      if (state.afterglowActive) {
        issues.push(issue(result, line, 'surtr-afterglow-restarted', text));
      }
      state.afterglowActive = true;
      state.afterglowProgress = 0;
      coverage.afterglowStarts += 1;
    }

    const afterglowHit = text.match(new RegExp(`【黄昏余命】(${SURTR_NAME}) 仍被本次攻击命中`));
    if (afterglowHit?.[1]) {
      coverage.afterglowHits += 1;
      const name = afterglowHit[1];
      const contradictory = /擦身而过|(?:被|完全)化解|没有承受实际伤害|没有造成实际伤害|没有造成生命伤害|未受到生命伤害|伤害被完全化解|本次没有穿透防护|没有被(?:眩晕|击飞|控制|沉默)/;
      for (let priorIndex = index - 1; priorIndex >= Math.max(0, index - 8); priorIndex -= 1) {
        const prior = result.logs[priorIndex];
        if (!prior) continue;
        const sameAction = entry.actionId && prior.actionId
          ? entry.actionId === prior.actionId
          : entry.rootEventId === prior.rootEventId;
        if (!sameAction) break;
        if (
          prior.text.includes(name) &&
          contradictory.test(prior.text) &&
          !prior.text.includes('黄昏余命')
        ) {
          issues.push(issue(
            result,
            priorIndex + 1,
            'surtr-afterglow-contradictory-context',
            `${prior.text} -> ${text}`,
          ));
          break;
        }
      }
    }

    const afterglowProgress = text.match(new RegExp(`【黄昏余命】(${SURTR_NAME}) 完成第 (\\d+)\\/8 次余命行动机会`));
    if (afterglowProgress?.[1] && afterglowProgress[2]) {
      const count = Number.parseInt(afterglowProgress[2], 10);
      const state = trackedState(states, afterglowProgress[1]);
      if (!state.afterglowActive || count !== state.afterglowProgress + 1) {
        issues.push(issue(
          result,
          line,
          'surtr-afterglow-sequence',
          `${afterglowProgress[1]} 的余命计数前后不连续：${text}`,
        ));
      }
      state.afterglowActive = true;
      state.afterglowProgress = count;
    }

    const afterglowEnd = text.match(new RegExp(`【黄昏尽头】(${SURTR_NAME}) 的八次余命耗尽`));
    if (afterglowEnd?.[1]) {
      const state = trackedState(states, afterglowEnd[1]);
      if (!state.afterglowActive || state.afterglowProgress !== 8) {
        issues.push(issue(result, line, 'surtr-afterglow-ended-early', text));
      }
      state.afterglowActive = false;
      coverage.afterglowCompletions += 1;
    }

    states.forEach((state, name) => {
      if (
        state.afterglowActive
        && entry.type === 'heal'
        && (
          text.includes(`【再生】${name} 自动回复`)
          || text.includes(`为 ${name} 恢复`)
          || new RegExp(`${name} (?:恢复|回复)了 \\d+ 点生命`).test(text)
        )
      ) {
        issues.push(issue(result, line, 'surtr-afterglow-healed', text));
      }
    });

    if (new RegExp(`【共同击杀分账】${SURTR_NAME} 的本次击杀`).test(text)) {
      coverage.jointKillSplits += 1;
      if ((text.match(/\+0\.5/g) ?? []).length !== 2) {
        issues.push(issue(result, line, 'surtr-joint-kill-split', text));
      }
    }
    if (text.includes('预计预计')) {
      issues.push(issue(result, line, 'surtr-duplicate-estimate-wording', text));
    }
    if (text.includes('【预言家接管】') || text.includes('【控制权返还】')) {
      ownerNames.forEach((owners, surtrName) => {
        if (!text.includes(`${surtrName} `)) return;
        if (!text.includes('共同主人') || owners.some((owner) => !text.includes(owner))) {
          issues.push(issue(
            result,
            line,
            'surtr-prophet-owner-context',
            `${surtrName} 的预言家接管/返还日志没有完整写出两名共同主人：${text}`,
          ));
        }
      });
    }
    if (
      text.includes('史尔特尔')
      && /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text)
    ) {
      issues.push(issue(result, line, 'surtr-user-facing-uuid', text));
    }
  });

  const actorIdsByName = new Map<string, Set<string>>();
  result.events.forEach((event) => {
    if (!event.actorId || !event.actorName) return;
    const ids = actorIdsByName.get(event.actorName) ?? new Set<string>();
    ids.add(event.actorId);
    actorIdsByName.set(event.actorName, ids);
  });
  const surtrIdsByName = new Map<string, string>();
  result.events.forEach((event) => {
    const cue = event.visualCue;
    if (cue?.kind === 'summon_card' && new RegExp(`^${SURTR_NAME}$`).test(cue.summonName)) {
      surtrIdsByName.set(cue.summonName, cue.summonId);
    }
  });
  ownerNames.forEach((owners, surtrName) => {
    const surtrId = surtrIdsByName.get(surtrName)
      ?? [...(actorIdsByName.get(surtrName) ?? [])][0];
    if (!surtrId) return;
    const protectedIds = new Set(owners.flatMap((name) => [...(actorIdsByName.get(name) ?? [])]));
    result.events.forEach((event) => {
      if (
        event.kind === 'action_start'
        && event.actorId === surtrId
        && event.targetIds?.some((targetId) => protectedIds.has(targetId))
      ) {
        issues.push(issue(
          result,
          result.logs.findIndex((entry) => entry.rootEventId === event.rootEventId) + 1,
          'surtr-targeted-exact-owner',
          `${surtrName} 的行动 ${event.skillName ?? '普通攻击'} 锁定了共同主人之一。`,
        ));
      }
    });
  });

  return { issues, coverage };
}

function writeRelevantLog(result: BattleResult, index: number): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `${String(index).padStart(4, '0')}-${sanitizeFileName(result.label)}.log`);
  const lines = result.logs.map((entry: LogEntry, lineIndex) => (
    `${String(lineIndex + 1).padStart(4, '0')} [T${entry.turn ?? '?'} R${entry.rootEventId ?? '-'} A${entry.actionId ?? '-'}] [${entry.type}] ${entry.text}`
  ));
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
  return logPath;
}

function buildSpecs(): BattleSpec[] {
  return Array.from({ length: STRESS_SEEDS }, (_, index) => ({
    phase: 'surtr-no-water-ffa',
    label: `surtr-no-water-ffa-${index}`,
    names: NO_WATER,
    seed: BASE_SEED + index,
  }));
}

export function main(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const specs = buildSpecs();
  const summaries: BattleSummary[] = [];
  const allIssues: LogIssue[] = [];
  const totalCoverage = emptyCoverage();
  const issueTypeCounts: Record<string, number> = {};
  const startMs = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      checkInvariantsEachStep: true,
      includeInvariantLabel: true,
      maxTurns: DEFAULT_STRESS_MAX_TURNS,
      scanLogs: true,
      scanRosterNames: true,
    });
    const scan = scanSurtrLogs(result);
    addCoverage(totalCoverage, scan.coverage);
    const issues: LogIssue[] = [
      ...result.logIssues,
      ...scan.issues,
      ...result.invariantErrors.map((text) => issue(result, 0, 'invariant-error', text)),
    ];
    if (result.error) issues.push(issue(result, 0, 'runtime-error', result.error));
    if (result.timedOut) {
      issues.push(issue(result, 0, 'timeout', `Battle did not end within ${DEFAULT_STRESS_MAX_TURNS} turns`));
    }
    issues.forEach((entry) => {
      issueTypeCounts[entry.type] = (issueTypeCounts[entry.type] ?? 0) + 1;
      allIssues.push(entry);
    });

    const hasSurtrCoverage = Object.values(scan.coverage).some((count) => count > 0);
    const logPath = hasSurtrCoverage || issues.length > 0
      ? writeRelevantLog(result, index)
      : null;
    summaries.push({
      label: spec.label,
      seed: spec.seed,
      turns: result.turns,
      ended: result.ended,
      timedOut: result.timedOut,
      error: result.error ? result.error.split('\n')[0] ?? null : null,
      issueCount: issues.length,
      logCount: result.logCount,
      coverage: scan.coverage,
      logPath,
    });
    if ((index + 1) % 25 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  if (totalCoverage.summons === 0) {
    allIssues.push({ label: 'coverage', line: 0, type: 'surtr-not-summoned', text: '专项压测没有召唤出史尔特尔。' });
  }
  if (totalCoverage.twilightActivations === 0) {
    allIssues.push({ label: 'coverage', line: 0, type: 'surtr-twilight-not-covered', text: '专项压测没有覆盖黄昏发动。' });
  }
  if (totalCoverage.afterglowStarts === 0) {
    allIssues.push({ label: 'coverage', line: 0, type: 'surtr-afterglow-not-covered', text: '专项压测没有覆盖黄昏余命。' });
  }
  allIssues.forEach((entry) => {
    if (!(entry.type in issueTypeCounts)) issueTypeCounts[entry.type] = 1;
  });

  const summary: Summary = {
    ok: allIssues.length === 0
      && summaries.every((entry) => entry.ended && !entry.timedOut && !entry.error),
    totalBattles: specs.length,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    elapsedMs: Date.now() - startMs,
    ...totalCoverage,
    issueTypeCounts,
    reviewedLogFiles: summaries.filter((entry) => entry.logPath).length,
    outDir: OUT_DIR,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'battle-summaries.json'), `${JSON.stringify(summaries, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'issues.json'), `${JSON.stringify(allIssues, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}
