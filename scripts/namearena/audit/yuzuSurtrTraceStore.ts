import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SemanticTrace } from './yuzuSurtrSemantic';

type SqliteStatement = {
  run: (...values: unknown[]) => unknown;
  get: (...values: unknown[]) => Record<string, unknown> | undefined;
  all: (...values: unknown[]) => Record<string, unknown>[];
  iterate: (...values: unknown[]) => IterableIterator<Record<string, unknown>>;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type DatabaseSyncConstructor = new (
  location: string,
  options?: { readOnly?: boolean },
) => SqliteDatabase;

const runtimeRequire = createRequire(__filename);
const { DatabaseSync } = runtimeRequire('node:sqlite') as {
  DatabaseSync: DatabaseSyncConstructor;
};

export type StoredFocusedIssue = {
  type: string;
  detail: string;
  line?: number;
  eventId?: string;
  rootEventId?: string;
  actionId?: string;
  label: string;
  seed: number;
  context: string;
  logPath: string;
};

export type StoredBattleAudit = {
  ordinal: number;
  label: string;
  seed: number;
  context: string;
  ended: boolean;
  timedOut: boolean;
  turns: number;
  logs: number;
  issues: StoredFocusedIssue[];
  eventCounts: Record<string, number>;
  prophetMetrics?: Record<string, number>;
  surtrCoverage?: Record<string, number>;
  rosterCoverage: Record<string, number>;
  interactionCoverage: Record<string, number>;
};

export type StoredAuditAggregate = {
  nextIndex: number;
  battles: number;
  ended: number;
  timedOut: number;
  totalTurns: number;
  totalLogs: number;
  issueBattles: number;
  issueCount: number;
  issueTypeCounts: Record<string, number>;
  issueExamples: StoredFocusedIssue[];
  eventCounts: Record<string, number>;
  prophetMetrics: Record<string, number>;
  surtrCoverage: Record<string, number>;
  rosterCoverage: Record<string, number>;
  interactionCoverage: Record<string, number>;
  uniqueSemanticTraces: number;
  uniquePresentationTraces: number;
  reviewCategoryCount: number;
};

export type StoredSemanticTrace = {
  signature: string;
  reviewCategories: string[];
  count: number;
  contexts: string[];
  actorKinds: string[];
  skillIds: string[];
  labels: string[];
  tokenCount: number;
  sample: string[];
  sampleLabel: string;
  sampleSeed: number;
};

export type StoredPresentationTrace = {
  structureSignature: string;
  presentationSignature: string;
  count: number;
  sample: string[];
  sampleLabel: string;
  sampleSeed: number;
};

const DATABASE_FILE = 'semantic-traces.sqlite';

function storedTraceFromRow(row: Record<string, unknown>): StoredSemanticTrace {
  return {
    signature: String(row.signature),
    reviewCategories: String(row.review_categories ?? row.review_category ?? 'legacy')
      .split('\u001f')
      .filter(Boolean),
    count: numeric(row.count),
    contexts: String(row.contexts ?? '')
      .split('\u001f')
      .filter(Boolean),
    actorKinds: JSON.parse(String(row.actor_kinds)) as string[],
    skillIds: JSON.parse(String(row.skill_ids)) as string[],
    labels: JSON.parse(String(row.labels)) as string[],
    tokenCount: numeric(row.token_count),
    sample: JSON.parse(
      gunzipSync(row.sample_gzip as Uint8Array).toString('utf8'),
    ) as string[],
    sampleLabel: String(row.sample_label),
    sampleSeed: numeric(row.sample_seed),
  };
}

function storedPresentationFromRow(row: Record<string, unknown>): StoredPresentationTrace {
  return {
    structureSignature: String(row.structure_signature),
    presentationSignature: String(row.presentation_signature),
    count: numeric(row.count),
    sample: JSON.parse(
      gunzipSync(row.sample_gzip as Uint8Array).toString('utf8'),
    ) as string[],
    sampleLabel: String(row.sample_label),
    sampleSeed: numeric(row.sample_seed),
  };
}

export function* iterateStoredSemanticTraces(
  databasePath: string,
): Generator<StoredSemanticTrace> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database.prepare('SELECT * FROM semantic_traces ORDER BY signature');
    const contexts = database.prepare(`
      SELECT context FROM semantic_trace_contexts WHERE signature = ? ORDER BY context
    `);
    const hasCategoryTable = !!database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'semantic_trace_review_categories'
    `).get();
    const categories = hasCategoryTable
      ? database.prepare(`
        SELECT review_category
        FROM semantic_trace_review_categories
        WHERE signature = ?
        ORDER BY review_category
      `)
      : undefined;
    for (const raw of rows.iterate()) {
      const signature = String(raw.signature);
      const row = {
        ...raw,
        contexts: contexts.all(signature).map((entry) => String(entry.context)).join('\u001f'),
        review_categories: categories
          ? categories.all(signature).map((entry) => String(entry.review_category)).join('\u001f')
          : String(raw.review_category ?? 'legacy'),
      };
      yield storedTraceFromRow(row);
    }
  } finally {
    database.close();
  }
}

export function* iterateStoredPresentationTraces(
  databasePath: string,
): Generator<StoredPresentationTrace> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'semantic_trace_presentations'
    `).get();
    if (!table) return;
    const rows = database.prepare(`
      SELECT *
      FROM semantic_trace_presentations
      ORDER BY structure_signature, presentation_signature
    `);
    for (const row of rows.iterate()) yield storedPresentationFromRow(row);
  } finally {
    database.close();
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number'
    ? value
    : typeof value === 'bigint'
      ? Number(value)
      : Number(value ?? 0);
}

function parseRecord(rows: unknown[]): Record<string, number> {
  const output: Record<string, number> = {};
  rows.forEach((raw) => {
    const row = raw as { key?: unknown; value?: unknown };
    if (typeof row.key === 'string') output[row.key] = numeric(row.value);
  });
  return output;
}

export class YuzuSurtrTraceStore {
  readonly databasePath: string;
  private readonly database: SqliteDatabase;
  private readonly insertMetric: SqliteStatement;
  private readonly insertTrace: SqliteStatement;
  private readonly insertTraceContext: SqliteStatement;
  private readonly insertTraceCategory: SqliteStatement;
  private readonly insertPresentationTrace: SqliteStatement;
  private readonly insertBattle: SqliteStatement;
  private readonly insertIssue: SqliteStatement;
  private readonly findBattle: SqliteStatement;

  constructor(
    outputDir: string,
    configHash: string,
    options: { reset?: boolean } = {},
  ) {
    if (options.reset) fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    this.databasePath = path.join(outputDir, DATABASE_FILE);
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_battles (
        ordinal INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        seed INTEGER NOT NULL,
        context TEXT NOT NULL,
        ended INTEGER NOT NULL,
        timed_out INTEGER NOT NULL,
        turns INTEGER NOT NULL,
        logs INTEGER NOT NULL,
        issue_count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_metrics (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
      CREATE TABLE IF NOT EXISTS audit_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ordinal INTEGER NOT NULL,
        payload TEXT NOT NULL,
        FOREIGN KEY (ordinal) REFERENCES audit_battles(ordinal)
      );
      CREATE TABLE IF NOT EXISTS semantic_traces (
        signature TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        review_category TEXT NOT NULL DEFAULT 'legacy',
        actor_kinds TEXT NOT NULL,
        skill_ids TEXT NOT NULL,
        labels TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        sample_gzip BLOB NOT NULL,
        sample_label TEXT NOT NULL,
        sample_seed INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS semantic_trace_contexts (
        signature TEXT NOT NULL,
        context TEXT NOT NULL,
        PRIMARY KEY (signature, context),
        FOREIGN KEY (signature) REFERENCES semantic_traces(signature)
      );
      CREATE TABLE IF NOT EXISTS semantic_trace_review_categories (
        signature TEXT NOT NULL,
        review_category TEXT NOT NULL,
        PRIMARY KEY (signature, review_category),
        FOREIGN KEY (signature) REFERENCES semantic_traces(signature)
      );
      CREATE TABLE IF NOT EXISTS semantic_trace_presentations (
        structure_signature TEXT NOT NULL,
        presentation_signature TEXT NOT NULL,
        count INTEGER NOT NULL,
        sample_gzip BLOB NOT NULL,
        sample_label TEXT NOT NULL,
        sample_seed INTEGER NOT NULL,
        PRIMARY KEY (structure_signature, presentation_signature),
        FOREIGN KEY (structure_signature) REFERENCES semantic_traces(signature)
      );
    `);
    const traceColumns = this.database.prepare('PRAGMA table_info(semantic_traces)').all();
    if (!traceColumns.some((row) => row.name === 'review_category')) {
      this.database.exec("ALTER TABLE semantic_traces ADD COLUMN review_category TEXT NOT NULL DEFAULT 'legacy'");
    }
    const existingHash = this.readMetadata('config_hash');
    if (existingHash && existingHash !== configHash) {
      this.database.close();
      throw new Error(`Audit checkpoint configuration mismatch in ${this.databasePath}`);
    }
    if (!existingHash) {
      this.writeMetadata('config_hash', configHash);
      this.writeMetadata('started_at', new Date().toISOString());
      this.writeMetadata('elapsed_ms', '0');
      this.writeMetadata('completed', '0');
    }
    this.insertMetric = this.database.prepare(`
      INSERT INTO audit_metrics(namespace, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = value + excluded.value
    `);
    this.insertTrace = this.database.prepare(`
      INSERT INTO semantic_traces(
        signature,
        count,
        review_category,
        actor_kinds,
        skill_ids,
        labels,
        token_count,
        sample_gzip,
        sample_label,
        sample_seed
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET count = count + excluded.count
    `);
    this.insertTraceContext = this.database.prepare(`
      INSERT OR IGNORE INTO semantic_trace_contexts(signature, context)
      VALUES (?, ?)
    `);
    this.insertTraceCategory = this.database.prepare(`
      INSERT OR IGNORE INTO semantic_trace_review_categories(signature, review_category)
      VALUES (?, ?)
    `);
    this.insertPresentationTrace = this.database.prepare(`
      INSERT INTO semantic_trace_presentations(
        structure_signature,
        presentation_signature,
        count,
        sample_gzip,
        sample_label,
        sample_seed
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(structure_signature, presentation_signature)
      DO UPDATE SET count = count + excluded.count
    `);
    this.insertBattle = this.database.prepare(`
      INSERT INTO audit_battles(
        ordinal,
        label,
        seed,
        context,
        ended,
        timed_out,
        turns,
        logs,
        issue_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertIssue = this.database.prepare(`
      INSERT INTO audit_issues(ordinal, payload)
      VALUES (?, ?)
    `);
    this.findBattle = this.database.prepare(`
      SELECT ordinal
      FROM audit_battles
      WHERE ordinal = ?
    `);
  }

  private readMetadata(key: string): string | undefined {
    const row = this.database
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(key) as { value?: unknown } | undefined;
    return typeof row?.value === 'string' ? row.value : undefined;
  }

  private writeMetadata(key: string, value: string): void {
    this.database
      .prepare(`
        INSERT INTO metadata(key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, value);
  }

  private addMetrics(namespace: string, values: Record<string, number> | undefined): void {
    if (!values) return;
    Object.entries(values).forEach(([key, value]) => {
      if (Number.isFinite(value) && value !== 0) this.insertMetric.run(namespace, key, value);
    });
  }

  hasBattle(ordinal: number): boolean {
    return !!this.findBattle.get(ordinal);
  }

  appendBattle(record: StoredBattleAudit, traces: readonly SemanticTrace[]): boolean {
    if (this.hasBattle(record.ordinal)) return false;
    const traceCounts = new Map<string, { trace: SemanticTrace; count: number }>();
    const presentationCounts = new Map<string, { trace: SemanticTrace; count: number }>();
    traces.forEach((trace) => {
      const current = traceCounts.get(trace.signature);
      if (current) {
        current.count += 1;
      } else {
        traceCounts.set(trace.signature, { trace, count: 1 });
      }
      const presentationKey = trace.presentationSignature;
      const presentation = presentationCounts.get(presentationKey);
      if (presentation) presentation.count += 1;
      else presentationCounts.set(presentationKey, { trace, count: 1 });
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insertBattle.run(
        record.ordinal,
        record.label,
        record.seed,
        record.context,
        record.ended ? 1 : 0,
        record.timedOut ? 1 : 0,
        record.turns,
        record.logs,
        record.issues.length,
      );
      this.addMetrics('summary', {
        battles: 1,
        ended: record.ended ? 1 : 0,
        timedOut: record.timedOut ? 1 : 0,
        totalTurns: record.turns,
        totalLogs: record.logs,
        issueBattles: record.issues.length > 0 ? 1 : 0,
        issueCount: record.issues.length,
      });
      this.addMetrics('events', record.eventCounts);
      this.addMetrics('prophet', record.prophetMetrics);
      this.addMetrics('surtr', record.surtrCoverage);
      this.addMetrics('roster', record.rosterCoverage);
      this.addMetrics('interactions', record.interactionCoverage);
      record.issues.forEach((issue) => {
        this.insertMetric.run('issue_types', issue.type, 1);
        this.insertIssue.run(record.ordinal, JSON.stringify(issue));
      });
      traceCounts.forEach(({ trace, count }) => {
        this.insertTrace.run(
          trace.signature,
          count,
          trace.reviewCategory,
          JSON.stringify(trace.actorKinds),
          JSON.stringify(trace.skillIds),
          JSON.stringify(trace.labels),
          trace.tokenCount,
          gzipSync(JSON.stringify(trace.sample)),
          record.label,
          record.seed,
        );
        this.insertTraceContext.run(trace.signature, trace.context);
        this.insertTraceCategory.run(trace.signature, trace.reviewCategory);
      });
      presentationCounts.forEach(({ trace, count }) => {
        this.insertPresentationTrace.run(
          trace.signature,
          trace.presentationSignature,
          count,
          gzipSync(JSON.stringify(trace.sample)),
          record.label,
          record.seed,
        );
      });
      this.database.exec('COMMIT');
      return true;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  aggregate(): StoredAuditAggregate {
    const summary = parseRecord(
      this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('summary'),
    );
    const maxOrdinal = this.database
      .prepare('SELECT MAX(ordinal) AS ordinal FROM audit_battles')
      .get() as { ordinal?: unknown } | undefined;
    const traceCount = this.database
      .prepare('SELECT COUNT(*) AS count FROM semantic_traces')
      .get() as { count?: unknown } | undefined;
    const presentationCount = this.database
      .prepare('SELECT COUNT(*) AS count FROM semantic_trace_presentations')
      .get() as { count?: unknown } | undefined;
    const reviewCategoryCount = this.database
      .prepare('SELECT COUNT(DISTINCT review_category) AS count FROM semantic_trace_review_categories')
      .get() as { count?: unknown } | undefined;
    const issues = this.database
      .prepare('SELECT payload FROM audit_issues ORDER BY id')
      .all()
      .map((raw) => {
        const row = raw as { payload?: unknown };
        return JSON.parse(String(row.payload ?? '{}')) as StoredFocusedIssue;
      });
    return {
      nextIndex: maxOrdinal?.ordinal === null || maxOrdinal?.ordinal === undefined
        ? 0
        : numeric(maxOrdinal.ordinal) + 1,
      battles: summary.battles ?? 0,
      ended: summary.ended ?? 0,
      timedOut: summary.timedOut ?? 0,
      totalTurns: summary.totalTurns ?? 0,
      totalLogs: summary.totalLogs ?? 0,
      issueBattles: summary.issueBattles ?? 0,
      issueCount: summary.issueCount ?? 0,
      issueTypeCounts: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('issue_types'),
      ),
      issueExamples: issues,
      eventCounts: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('events'),
      ),
      prophetMetrics: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('prophet'),
      ),
      surtrCoverage: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('surtr'),
      ),
      rosterCoverage: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('roster'),
      ),
      interactionCoverage: parseRecord(
        this.database.prepare('SELECT key, value FROM audit_metrics WHERE namespace = ?').all('interactions'),
      ),
      uniqueSemanticTraces: numeric(traceCount?.count),
      uniquePresentationTraces: numeric(presentationCount?.count),
      reviewCategoryCount: numeric(reviewCategoryCount?.count),
    };
  }

  semanticTraces(): StoredSemanticTrace[] {
    return [...iterateStoredSemanticTraces(this.databasePath)];
  }

  startedAt(): string {
    return this.readMetadata('started_at') ?? new Date().toISOString();
  }

  elapsedMs(): number {
    return numeric(this.readMetadata('elapsed_ms'));
  }

  addElapsedMs(elapsedMs: number): void {
    this.writeMetadata('elapsed_ms', String(this.elapsedMs() + Math.max(0, elapsedMs)));
  }

  isCompleted(): boolean {
    return this.readMetadata('completed') === '1';
  }

  setCompleted(completed: boolean): void {
    this.writeMetadata('completed', completed ? '1' : '0');
  }

  close(): void {
    this.database.close();
  }
}
