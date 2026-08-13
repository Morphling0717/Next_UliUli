import fs from 'node:fs';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  iterateStoredPresentationTraces,
  iterateStoredSemanticTraces,
  type StoredPresentationTrace,
  type StoredSemanticTrace,
} from './yuzuSurtrTraceStore';

type ReviewIssue = {
  type: string;
  signature: string;
  sampleLabel: string;
  sampleSeed: number;
  detail: string;
};

type ReviewCategory = {
  category: string;
  count: number;
  structureCount: number;
  contexts: string[];
  actorKinds: string[];
  skillIds: string[];
  labels: string[];
  representativeSignature: string;
  sampleLabel: string;
  sampleSeed: number;
  sample: string[];
  rare: boolean;
  reviewed: boolean;
  reviewNotes: string;
};

type ReviewSample = {
  sampleId: string;
  ordinal: number;
  categoryIndexes: number[];
  categories: string[];
  contexts: string[];
  actorKinds: string[];
  skillIds: string[];
  labels: string[];
  sampleLabel: string;
  sampleSeed: number;
  sample: string[];
  rare: boolean;
  reviewed: boolean;
  reviewNotes: string;
};

type ReviewSummary = {
  generatedAt: string;
  root: string;
  databaseCount: number;
  uniqueSemanticTraces: number;
  uniquePresentationTraces: number;
  reviewCategoryCount: number;
  rareCategoryCount: number;
  visibleLines: number;
  autoIssueCount: number;
  autoIssueTypeCounts: Record<string, number>;
  actorKindCoverage: Record<string, number>;
  skillCoverage: Record<string, number>;
  labelCoverage: Record<string, number>;
  traceArchive: string;
  presentationArchive: string;
  categoryChecklist: string;
  sampleChecklist: string;
  categoryMarkdown: string;
  autoIssuesFile: string;
};

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const INTERNAL_TOKEN_PATTERN = /(?:state-sync:|\b(?:action|event|scope|summon|npc|prophet|surtr)-[a-z0-9:_-]+\b|\b(?:summon_ra_phoenix_reaction|chimera_install_reaction|joker_hell_return)\b)/i;
const BROKEN_VALUE_PATTERN = /(?:\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\])/;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numericArgument(name: string, fallback: number): number {
  const parsed = Number.parseInt(argument(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sampleId(sample: readonly string[]): string {
  return createHash('sha256').update(sample.join('\n')).digest('hex');
}

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed as T[] : [];
}

function databasePaths(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((entry) => path.join(root, entry, 'semantic-traces.sqlite'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort();
}

function addCoverage(target: Record<string, number>, values: readonly string[]): void {
  values.forEach((value) => {
    target[value] = (target[value] ?? 0) + 1;
  });
}

function visibleText(line: string): string {
  return line.replace(
    /^\[\d+\]\s+\[T\d+\s+R[^\]]+\s+A[^\]]+\]\s+\[[^\]]+\]\s*/,
    '',
  );
}

function automaticIssues(
  signature: string,
  sample: readonly string[],
  sampleLabel: string,
  sampleSeed: number,
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const add = (type: string, detail: string) => {
    issues.push({ type, signature, sampleLabel, sampleSeed, detail });
  };
  if (sample.length === 0) {
    add('focused-root-without-visible-context', 'Focused semantic root contains no player-visible line');
  }
  sample.forEach((line, index) => {
    const text = visibleText(line);
    if (UUID_PATTERN.test(text) || INTERNAL_TOKEN_PATTERN.test(text)) {
      add('internal-id-in-visible-trace', `line ${index + 1}: ${line}`);
    }
    if (BROKEN_VALUE_PATTERN.test(text)) {
      add('broken-value-in-visible-trace', `line ${index + 1}: ${line}`);
    }
  });
  return issues;
}

function formatTrace(trace: StoredSemanticTrace, ordinal: number): string {
  return [
    `## ${ordinal}. ${trace.signature}`,
    `出现次数：${trace.count}`,
    `审阅类别：${trace.reviewCategories.join('、') || 'legacy'}`,
    `场景：${trace.contexts.join('、') || '未标记'}`,
    `角色：${trace.actorKinds.join('、') || '无结构化角色'}`,
    `技能：${trace.skillIds.join('、') || '无技能 ID'}`,
    `标签：${trace.labels.join('、') || '无标签'}`,
    `样本：${trace.sampleLabel} · seed ${trace.sampleSeed}`,
    '',
    ...trace.sample,
    '',
  ].join('\n');
}

function* uniqueTraces(databases: readonly string[]): Generator<StoredSemanticTrace> {
  const seen = new Set<string>();
  for (const databasePath of databases) {
    for (const trace of iterateStoredSemanticTraces(databasePath)) {
      if (seen.has(trace.signature)) continue;
      seen.add(trace.signature);
      yield trace;
    }
  }
}

function* uniquePresentations(
  databases: readonly string[],
): Generator<StoredPresentationTrace> {
  const seen = new Set<string>();
  for (const databasePath of databases) {
    for (const trace of iterateStoredPresentationTraces(databasePath)) {
      const key = `${trace.structureSignature}:${trace.presentationSignature}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield trace;
    }
  }
}

function printPage(databases: readonly string[], start: number, count: number): void {
  let ordinal = 0;
  let printed = 0;
  for (const trace of uniqueTraces(databases)) {
    if (ordinal >= start && printed < count) {
      process.stdout.write(`${formatTrace(trace, ordinal + 1)}\n`);
      printed += 1;
    }
    ordinal += 1;
    if (printed >= count) break;
  }
  process.stderr.write(`review page: start=${start}, requested=${count}, printed=${printed}\n`);
}

function mergeValues(target: string[], values: readonly string[]): void {
  const seen = new Set(target);
  values.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      target.push(value);
    }
  });
  target.sort();
}

function addCategory(
  categories: Map<string, ReviewCategory>,
  category: string,
  trace: StoredSemanticTrace,
): void {
  const existing = categories.get(category);
  if (existing) {
    existing.count += trace.count;
    existing.structureCount += 1;
    mergeValues(existing.contexts, trace.contexts);
    mergeValues(existing.actorKinds, trace.actorKinds);
    mergeValues(existing.skillIds, trace.skillIds);
    mergeValues(existing.labels, trace.labels);
    return;
  }
  categories.set(category, {
    category,
    count: trace.count,
    structureCount: 1,
    contexts: [...trace.contexts],
    actorKinds: [...trace.actorKinds],
    skillIds: [...trace.skillIds],
    labels: [...trace.labels],
    representativeSignature: trace.signature,
    sampleLabel: trace.sampleLabel,
    sampleSeed: trace.sampleSeed,
    sample: [...trace.sample],
    rare: false,
    reviewed: false,
    reviewNotes: '',
  });
}

function categoryMarkdown(categories: readonly ReviewCategory[]): string {
  const lines = [
    '# 柚子·预言家与史尔特尔语义行为人工审阅',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '> 每一项都必须逐行阅读代表日志后，将检查清单中的 `reviewed` 改为 `true` 并记录结论。',
    '',
  ];
  categories.forEach((category, index) => {
    lines.push(
      `## ${index + 1}. ${category.rare ? '[罕见] ' : ''}${category.category}`,
      '',
      `出现次数：${category.count}；结构变体：${category.structureCount}`,
      '',
      `场景：${category.contexts.join('、') || '未标记'}`,
      '',
      `技能：${category.skillIds.join('、') || '无技能 ID'}`,
      '',
      `样本：${category.sampleLabel} · seed ${category.sampleSeed}`,
      '',
      '```text',
      ...category.sample,
      '```',
      '',
      '审阅结论：待审阅',
      '',
    );
  });
  return `${lines.join('\n')}\n`;
}

function buildReviewSamples(
  categories: readonly ReviewCategory[],
  previous: readonly ReviewSample[],
): ReviewSample[] {
  const previousById = new Map(previous.map((entry) => [entry.sampleId, entry]));
  const samples = new Map<string, ReviewSample>();
  categories.forEach((category, categoryIndex) => {
    const id = sampleId(category.sample);
    const existing = samples.get(id);
    if (existing) {
      existing.categoryIndexes.push(categoryIndex + 1);
      existing.categories.push(category.category);
      mergeValues(existing.contexts, category.contexts);
      mergeValues(existing.actorKinds, category.actorKinds);
      mergeValues(existing.skillIds, category.skillIds);
      mergeValues(existing.labels, category.labels);
      existing.rare ||= category.rare;
      return;
    }
    const prior = previousById.get(id);
    samples.set(id, {
      sampleId: id,
      ordinal: samples.size + 1,
      categoryIndexes: [categoryIndex + 1],
      categories: [category.category],
      contexts: [...category.contexts],
      actorKinds: [...category.actorKinds],
      skillIds: [...category.skillIds],
      labels: [...category.labels],
      sampleLabel: category.sampleLabel,
      sampleSeed: category.sampleSeed,
      sample: [...category.sample],
      rare: category.rare,
      reviewed: prior?.reviewed ?? false,
      reviewNotes: prior?.reviewNotes ?? '',
    });
  });
  return [...samples.values()];
}

function printSamplePage(samples: readonly ReviewSample[], start: number, count: number): void {
  const page = samples.slice(start, start + count);
  page.forEach((entry) => {
    process.stdout.write(`\n===== SAMPLE ${entry.ordinal}/${samples.length} =====\n`);
    process.stdout.write(`categories=${entry.categoryIndexes.join(',')} rare=${entry.rare} seed=${entry.sampleSeed} label=${entry.sampleLabel}\n`);
    process.stdout.write(`contexts=${entry.contexts.join(',')} actors=${entry.actorKinds.join(',')} skills=${entry.skillIds.join(',')} labels=${entry.labels.join(',')}\n`);
    entry.categories.forEach((category) => process.stdout.write(`category: ${category}\n`));
    entry.sample.forEach((line, lineIndex) => {
      process.stdout.write(`${String(lineIndex + 1).padStart(3, '0')} ${visibleText(line)}\n`);
    });
  });
  process.stderr.write(`sample review page: start=${start}, requested=${count}, printed=${page.length}\n`);
}

function markSamplePage(
  sampleChecklist: string,
  categoryChecklist: string,
  start: number,
  count: number,
  note: string,
): void {
  const samples = readJsonArray<ReviewSample>(sampleChecklist);
  const categories = readJsonArray<ReviewCategory>(categoryChecklist);
  const page = samples.slice(start, start + count);
  if (page.length === 0) throw new Error(`No review samples in range ${start}..${start + count - 1}`);
  const categoryIndexes = new Set(page.flatMap((entry) => entry.categoryIndexes));
  page.forEach((entry) => {
    entry.reviewed = true;
    entry.reviewNotes = note;
  });
  categories.forEach((category, index) => {
    if (!categoryIndexes.has(index + 1)) return;
    category.reviewed = true;
    category.reviewNotes = note;
  });
  fs.writeFileSync(sampleChecklist, `${JSON.stringify(samples, null, 2)}\n`, 'utf8');
  fs.writeFileSync(categoryChecklist, `${JSON.stringify(categories, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify({
    markedSamples: page.length,
    markedCategories: categoryIndexes.size,
    start,
    end: start + page.length - 1,
    note,
  }, null, 2));
  process.stdout.write('\n');
}

async function generateReview(root: string, databases: readonly string[]): Promise<ReviewSummary> {
  const outputDir = path.join(root, 'manual-review');
  fs.mkdirSync(outputDir, { recursive: true });
  const traceArchive = path.join(outputDir, 'semantic-traces.ndjson.gz');
  const presentationArchive = path.join(outputDir, 'presentation-traces.ndjson.gz');
  const categoryChecklist = path.join(outputDir, 'behavior-review-checklist.json');
  const sampleChecklist = path.join(outputDir, 'sample-review-checklist.json');
  const categoryMarkdownPath = path.join(outputDir, 'behavior-review.md');
  const autoIssuesFile = path.join(outputDir, 'automatic-review-issues.json');
  const traceOutput = fs.createWriteStream(traceArchive);
  const traceGzip = createGzip({ level: 9 });
  traceGzip.pipe(traceOutput);
  const presentationOutput = fs.createWriteStream(presentationArchive);
  const presentationGzip = createGzip({ level: 9 });
  presentationGzip.pipe(presentationOutput);
  const autoIssues: ReviewIssue[] = [];
  const actorKindCoverage: Record<string, number> = {};
  const skillCoverage: Record<string, number> = {};
  const labelCoverage: Record<string, number> = {};
  const categories = new Map<string, ReviewCategory>();
  let uniqueSemanticTraces = 0;
  let uniquePresentationTraces = 0;
  let visibleLines = 0;
  for (const trace of uniqueTraces(databases)) {
    uniqueSemanticTraces += 1;
    addCoverage(actorKindCoverage, trace.actorKinds);
    addCoverage(skillCoverage, trace.skillIds);
    addCoverage(labelCoverage, trace.labels);
    const traceCategories = trace.reviewCategories.length > 0
      ? trace.reviewCategories
      : ['legacy'];
    traceCategories.forEach((category) => addCategory(categories, category, trace));
    if (!traceGzip.write(`${JSON.stringify(trace)}\n`)) await once(traceGzip, 'drain');
  }
  for (const trace of uniquePresentations(databases)) {
    uniquePresentationTraces += 1;
    visibleLines += trace.sample.length;
    autoIssues.push(...automaticIssues(
      `${trace.structureSignature}:${trace.presentationSignature}`,
      trace.sample,
      trace.sampleLabel,
      trace.sampleSeed,
    ));
    if (!presentationGzip.write(`${JSON.stringify(trace)}\n`)) {
      await once(presentationGzip, 'drain');
    }
  }
  traceGzip.end();
  presentationGzip.end();
  await Promise.all([finished(traceOutput), finished(presentationOutput)]);
  const previousCategories = readJsonArray<ReviewCategory>(categoryChecklist);
  const previousCategoryByKey = new Map(previousCategories.map((category) => [
    `${category.category}:${category.representativeSignature}`,
    category,
  ]));
  const categoryList = [...categories.values()]
    .map((category) => ({ ...category, rare: category.count <= 3 }))
    .sort((left, right) => (
      Number(right.rare) - Number(left.rare) ||
      left.category.localeCompare(right.category)
    ))
    .map((category) => {
      const prior = previousCategoryByKey.get(
        `${category.category}:${category.representativeSignature}`,
      );
      return {
        ...category,
        reviewed: prior?.reviewed ?? false,
        reviewNotes: prior?.reviewNotes ?? '',
      };
    });
  const reviewSamples = buildReviewSamples(
    categoryList,
    readJsonArray<ReviewSample>(sampleChecklist),
  );
  fs.writeFileSync(categoryChecklist, `${JSON.stringify(categoryList, null, 2)}\n`, 'utf8');
  fs.writeFileSync(sampleChecklist, `${JSON.stringify(reviewSamples, null, 2)}\n`, 'utf8');
  fs.writeFileSync(categoryMarkdownPath, categoryMarkdown(categoryList), 'utf8');
  fs.writeFileSync(autoIssuesFile, `${JSON.stringify(autoIssues, null, 2)}\n`, 'utf8');
  const autoIssueTypeCounts: Record<string, number> = {};
  autoIssues.forEach((issue) => {
    autoIssueTypeCounts[issue.type] = (autoIssueTypeCounts[issue.type] ?? 0) + 1;
  });
  const summary: ReviewSummary = {
    generatedAt: new Date().toISOString(),
    root,
    databaseCount: databases.length,
    uniqueSemanticTraces,
    uniquePresentationTraces,
    reviewCategoryCount: categoryList.length,
    rareCategoryCount: categoryList.filter((category) => category.rare).length,
    visibleLines,
    autoIssueCount: autoIssues.length,
    autoIssueTypeCounts,
    actorKindCoverage,
    skillCoverage,
    labelCoverage,
    traceArchive,
    presentationArchive,
    categoryChecklist,
    sampleChecklist,
    categoryMarkdown: categoryMarkdownPath,
    autoIssuesFile,
  };
  fs.writeFileSync(
    path.join(outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  return summary;
}

export async function main(): Promise<void> {
  const root = path.resolve(
    argument('root') ?? path.join(process.cwd(), '.tmp', 'namearena-yuzu-surtr-audit'),
  );
  const databases = databasePaths(root);
  if (databases.length === 0) throw new Error(`No focused audit trace databases found in ${root}`);
  const outputDir = path.join(root, 'manual-review');
  const sampleChecklist = path.join(outputDir, 'sample-review-checklist.json');
  const categoryChecklist = path.join(outputDir, 'behavior-review-checklist.json');
  const samplePage = argument('sample-page');
  if (samplePage !== undefined) {
    const pageSize = numericArgument('page-size', 20);
    printSamplePage(
      readJsonArray<ReviewSample>(sampleChecklist),
      numericArgument('sample-page', 0) * pageSize,
      pageSize,
    );
    return;
  }
  const markPage = argument('mark-page');
  if (markPage !== undefined) {
    const pageSize = numericArgument('page-size', 20);
    markSamplePage(
      sampleChecklist,
      categoryChecklist,
      numericArgument('mark-page', 0) * pageSize,
      pageSize,
      argument('review-note') ?? '逐行人工审阅通过',
    );
    return;
  }
  const page = argument('page');
  if (page !== undefined) {
    printPage(
      databases,
      numericArgument('page', 0) * numericArgument('page-size', 50),
      numericArgument('page-size', 50),
    );
    return;
  }
  const summary = await generateReview(root, databases);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.autoIssueCount > 0) process.exitCode = 1;
}
