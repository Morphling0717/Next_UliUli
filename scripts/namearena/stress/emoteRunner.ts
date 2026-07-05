import fs from 'fs';
import path from 'path';
import {
  DEFAULT_STRESS_MAX_TURNS,
  os,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type BattleSpec,
  type LogEntry,
  type LogIssue,
} from '../shared/harness';

const OUT_DIR = process.env.NAMEARENA_EMOTE_STRESS_OUT_DIR ?? path.join(os.tmpdir(), 'namearena-emote-stress');
const LOG_DIR = path.join(OUT_DIR, 'logs');
const EMOTE_SEEDS = Number.parseInt(process.env.NAMEARENA_EMOTE_STRESS_SEEDS ?? '36', 10);

type BattleSummary = {
  phase: string;
  label: string;
  seed: number;
  names: string[];
  turns: number;
  ended: boolean;
  timedOut: boolean;
  error: string | null;
  issueCount: number;
  logCount: number;
  survivors: string[];
  logPath: string;
};

type Summary = {
  ok: boolean;
  totalBattles: number;
  maxTurns: number;
  emoteSeeds: number;
  elapsedMs: number;
  issueTypeCounts: Record<string, number>;
  issueContextCount: number;
  outDir: string;
};

type StressIssue = LogIssue & {
  phase?: string;
  seed?: number;
  logPath?: string;
  context?: Array<{ line: number; type: string; text: string }>;
};

function initializeOutputDir(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeLogFile(result: BattleResult, index: number): string {
  const phaseDir = path.join(LOG_DIR, result.phase);
  fs.mkdirSync(phaseDir, { recursive: true });
  const logPath = path.join(phaseDir, `${String(index).padStart(4, '0')}-${sanitizeFileName(result.label)}.log`);
  const text = result.logs.map((entry, lineIndex) => `${String(lineIndex + 1).padStart(3, '0')} [${entry.type}] ${entry.text}`).join('\n');
  fs.writeFileSync(logPath, text + (text ? '\n' : ''), 'utf8');
  return logPath;
}

function issueContext(logs: LogEntry[], line: number, radius = 3): StressIssue['context'] {
  const start = Math.max(1, line - radius);
  const end = Math.min(logs.length, line + radius);
  return logs.slice(start - 1, end).map((entry, index) => ({
    line: start + index,
    type: entry.type,
    text: entry.text,
  }));
}

function buildEmoteSpecs(): BattleSpec[] {
  const specs: BattleSpec[] = [];
  const rosters = [
    ['表情', '玄凝', '小汀', '牢鳄', '克蕾儿丝菲尔', '兔卷卷', '屑', 'M1A2_abrams_sep'],
    ['表情', '水人', '玄凝', '丝瓜uli', '兔卷卷', '刺猬人', '牢鳄', '屑'],
    ['表情', '小汀', '牢鳄', '刺猬人', 'M1A2_abrams_sep', '克蕾儿丝菲尔'],
  ];

  rosters.forEach((names, rosterIndex) => {
    for (let i = 0; i < EMOTE_SEEDS; i += 1) {
      specs.push({
        phase: `emote-ffa-${rosterIndex + 1}`,
        label: `emote-ffa-${rosterIndex + 1}-${i}`,
        names,
        seed: 710000 + rosterIndex * 10000 + i,
      });
    }
  });

  const teamTemplates = [
    ['表情@A', '玄凝@A', '兔卷卷@A', '小汀@B', '牢鳄@B', '屑@B'],
    ['表情@A', '丝瓜uli@A', '克蕾儿丝菲尔@A', '刺猬人@B', 'M1A2_abrams_sep@B', '玄凝@B'],
    ['表情@B', '牢鳄@B', '屑@B', '水人@A', '玄凝@A', '小汀@A'],
  ];
  teamTemplates.forEach((names, index) => {
    for (let i = 0; i < Math.ceil(EMOTE_SEEDS / 2); i += 1) {
      specs.push({
        phase: `emote-team-${index + 1}`,
        label: `emote-team-${index + 1}-${i}`,
        names,
        seed: 760000 + index * 10000 + i,
      });
    }
  });

  const endgameTemplates = [
    ['表情', '终局甲', '终局乙', '终局丙'],
    ['表情@E', '残局甲@A', '残局乙@B', '残局丙@C', '残局丁@D'],
  ];
  endgameTemplates.forEach((names, index) => {
    for (let i = 0; i < Math.ceil(EMOTE_SEEDS / 3); i += 1) {
      specs.push({
        phase: `emote-endgame-${index + 1}`,
        label: `emote-endgame-${index + 1}-${i}`,
        names,
        seed: 790000 + index * 10000 + i,
      });
    }
  });

  return specs;
}

export function scanEmoteSpecificLogs(result: BattleResult): LogIssue[] {
  const issues: LogIssue[] = [];
  let hasDeathAdapt = false;
  let hasOwner = false;
  let hasReviveOrTrueDeath = false;
  let emotePendingDeath = false;
  let emoteDeathLine = 0;
  let allMastersLine = 0;
  const redirectedAllMastersTargets = new Set<string>();
  let redirectedFaceLine = 0;
  let redirectedFaceTarget = '';
  let redirectedTenthLine = 0;
  let redirectedTenthTarget = '';

  const isEmoteDeathLine = (entry: LogEntry): boolean =>
    entry.type === 'death' && /^(?:💀|☠️|🧿) (?:【[^】]+】)?表情(?:\s|被|因|承受|生命|终局|倒下|等待)/.test(entry.text);
  const isEmoteResolutionLine = (text: string): boolean =>
    /【四处认主型魔虚罗】表情|【认主失败】表情/.test(text);
  const isEmoteActorLine = (entry: LogEntry): boolean =>
    ['attack', 'skill', 'crit'].includes(entry.type) &&
    /^(?:\S+\s+)?(?:【[^】]+】)?表情\s/.test(entry.text);

  result.logs.forEach((entry, index) => {
    const line = index + 1;
    const text = entry.text;
    if (allMastersLine && line - allMastersLine > 20) {
      allMastersLine = 0;
      redirectedAllMastersTargets.clear();
    }
    if (redirectedFaceLine && line - redirectedFaceLine > 8) {
      redirectedFaceLine = 0;
      redirectedFaceTarget = '';
    }
    if (redirectedTenthLine && line - redirectedTenthLine > 8) {
      redirectedTenthLine = 0;
      redirectedTenthTarget = '';
    }
    if (emotePendingDeath && isEmoteActorLine(entry)) {
      issues.push({
        label: result.label,
        line,
        type: 'emote-dead-pending-action',
        text: `表情在第 ${emoteDeathLine} 行死亡且未复活/真死前作为行动者出手：${text}`,
      });
    }
    if (/表情|四处认主|认主|适应转轮|万主归一|十分之一索赔|退魔之剑/.test(text) && /偷属性|偷取属性|属性被偷/.test(text)) {
      issues.push({ label: result.label, line, type: 'emote-log-implies-steal', text });
    }
    if (/【死亡适应】表情/.test(text)) hasDeathAdapt = true;
    if (/【四处认主】表情/.test(text)) hasOwner = true;
    if (/【四处认主型魔虚罗】表情|【认主失败】表情/.test(text)) hasReviveOrTrueDeath = true;
    if (/【万主归一】表情 把认主账本摊开/.test(text)) {
      allMastersLine = line;
      redirectedAllMastersTargets.clear();
    }
    const redirectedAllMastersMatch = text.match(/【随机恶作剧】(.+?) 遭到表情的【万主归一】/);
    if (allMastersLine && redirectedAllMastersMatch?.[1]) {
      redirectedAllMastersTargets.add(redirectedAllMastersMatch[1]);
    }
    const rewindMatch = text.match(/【击杀数回拨】(.+?) 被 表情 的账本/);
    if (allMastersLine && rewindMatch?.[1] && redirectedAllMastersTargets.has(rewindMatch[1])) {
      issues.push({
        label: result.label,
        line,
        type: 'emote-redirected-all-masters-rewind',
        text: `${rewindMatch[1]} 已用随机恶作剧转移表情的【万主归一】，但仍被账本回拨击杀数：${text}`,
      });
    }
    const redirectedFaceMatch = text.match(/【随机恶作剧】(.+?) 遭到表情的【先认个脸熟】/);
    if (redirectedFaceMatch?.[1]) {
      redirectedFaceLine = line;
      redirectedFaceTarget = redirectedFaceMatch[1];
    }
    if (
      redirectedFaceTarget &&
      /【先认个脸熟】表情/.test(text) &&
      !/随机恶作剧带偏/.test(text) &&
      line > redirectedFaceLine
    ) {
      redirectedFaceLine = 0;
      redirectedFaceTarget = '';
    }
    if (redirectedFaceTarget && /【先认个脸熟】.*防护把视线挡开/.test(text)) {
      issues.push({
        label: result.label,
        line,
        type: 'emote-redirected-face-log-calls-defense',
        text: `${redirectedFaceTarget} 已用随机恶作剧转移【先认个脸熟】，后续日志却写成防护挡开：${text}`,
      });
    }
    if (redirectedFaceTarget && /【脸熟】/.test(text)) {
      issues.push({
        label: result.label,
        line,
        type: 'emote-redirected-face-marked',
        text: `${redirectedFaceTarget} 已用随机恶作剧转移【先认个脸熟】，但仍被表情记住：${text}`,
      });
    }
    const redirectedTenthMatch = text.match(/【随机恶作剧】(.+?) 遭到表情的【十分之一索赔】/);
    if (redirectedTenthMatch?.[1]) {
      redirectedTenthLine = line;
      redirectedTenthTarget = redirectedTenthMatch[1];
    }
    if (
      redirectedTenthTarget &&
      /【十分之一索赔】表情/.test(text) &&
      !/随机恶作剧带偏/.test(text) &&
      line > redirectedTenthLine
    ) {
      redirectedTenthLine = 0;
      redirectedTenthTarget = '';
    }
    if (
      redirectedTenthTarget &&
      text.includes('【适应记录】表情 复制') &&
      text.includes(redirectedTenthTarget)
    ) {
      issues.push({
        label: result.label,
        line,
        type: 'emote-redirected-tenth-claim-copied',
        text: `${redirectedTenthTarget} 已用随机恶作剧转移【十分之一索赔】，但表情仍复制了其属性：${text}`,
      });
    }
    if (isEmoteDeathLine(entry)) {
      emotePendingDeath = true;
      emoteDeathLine = line;
    }
    if (isEmoteResolutionLine(text)) {
      emotePendingDeath = false;
      emoteDeathLine = 0;
    }
  });

  if (result.logs.some((entry) => entry.text.includes('表情'))) {
    if (!hasDeathAdapt && result.logs.some((entry) => /💀 .*表情|表情 .*倒下/.test(entry.text))) {
      issues.push({ label: result.label, line: 0, type: 'emote-death-without-adaptation-log', text: '表情死亡但未看到死亡适应日志' });
    }
    if (hasDeathAdapt && !hasOwner) {
      issues.push({ label: result.label, line: 0, type: 'emote-adaptation-without-owner-log', text: '表情死亡适应后未看到认主日志' });
    }
    if (hasOwner && !hasReviveOrTrueDeath && result.ended) {
      issues.push({ label: result.label, line: 0, type: 'emote-owner-without-resolution', text: '战斗结束时认主倒计时没有复活或真死收束日志' });
    }
  }

  return issues;
}

export function main(): void {
  initializeOutputDir();
  const specs = buildEmoteSpecs();
  const summaries: BattleSummary[] = [];
  const issueContexts: StressIssue[] = [];
  const issueTypeCounts: Record<string, number> = {};
  const startMs = Date.now();

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      includeInvariantLabel: true,
      maxTurns: DEFAULT_STRESS_MAX_TURNS,
      scanRosterNames: true,
    });
    const logPath = writeLogFile(result, index);
    const allIssues: LogIssue[] = [
      ...result.logIssues,
      ...scanEmoteSpecificLogs(result),
      ...result.invariantErrors.map((text) => ({ label: spec.label, line: 0, type: 'invariant-error', text })),
    ];
    if (result.error) allIssues.push({ label: spec.label, line: 0, type: 'runtime-error', text: result.error });
    if (result.timedOut) allIssues.push({ label: spec.label, line: 0, type: 'timeout', text: `Battle did not end within ${DEFAULT_STRESS_MAX_TURNS} turns` });

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
      error: result.error ? String(result.error).split('\n')[0] ?? null : null,
      issueCount: allIssues.length,
      logCount: result.logCount,
      survivors: result.survivors,
      logPath,
    });

    if ((index + 1) % 25 === 0) console.log(`progress ${index + 1}/${specs.length}`);
  });

  const summary: Summary = {
    ok: summaries.every((item) => item.ended && !item.timedOut && !item.error && item.issueCount === 0),
    totalBattles: specs.length,
    maxTurns: DEFAULT_STRESS_MAX_TURNS,
    emoteSeeds: EMOTE_SEEDS,
    elapsedMs: Date.now() - startMs,
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
