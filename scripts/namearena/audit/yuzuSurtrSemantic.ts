import { createHash } from 'node:crypto';
import type { BattleEvent } from '../../../lib/namearena/types';
import type {
  BattleResult,
  FighterTraceDescriptor,
} from '../shared/harness';
import {
  auditBattleEvents,
  type CausalAuditIssue,
} from './causalEventRunner';
import {
  auditYuzuProphetResult,
  collectProphetMetrics,
  type ProphetMetrics,
} from '../stress/yuzuProphetRunner';
import {
  scanSurtrLogs,
  type SurtrCoverage,
} from '../stress/surtrRunner';

export type FocusedAuditExpectation = {
  prophet?: boolean;
  surtr?: boolean;
};

export type FocusedAuditIssue = {
  type: string;
  detail: string;
  line?: number;
  eventId?: string;
  rootEventId?: string;
  actionId?: string;
};

export type SemanticTrace = {
  signature: string;
  presentationSignature: string;
  reviewCategory: string;
  context: string;
  rootEventId: string;
  actorKinds: string[];
  skillIds: string[];
  labels: string[];
  tokenCount: number;
  sample: string[];
};

export type FocusedAuditResult = {
  issues: FocusedAuditIssue[];
  eventCounts: Record<string, number>;
  prophetMetrics?: ProphetMetrics;
  surtrCoverage?: SurtrCoverage;
  traces: SemanticTrace[];
};

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INTERNAL_ID_PATTERN = /\b(?:action|event|scope|summon|npc|prophet|surtr)-[a-z0-9:_-]+\b/gi;
const INTERNAL_ACTION_ID_PATTERN = /\b(?:summon_ra_phoenix_reaction|chimera_install_reaction|joker_hell_return)\b/gi;
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?%?/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function descriptorMap(result: BattleResult): Map<string, FighterTraceDescriptor> {
  return new Map(result.fighterDirectory.map((fighter) => [fighter.id, fighter]));
}

function kindFor(
  fighters: ReadonlyMap<string, FighterTraceDescriptor>,
  fighterId: string | undefined,
): string {
  if (!fighterId) return 'none';
  return fighters.get(fighterId)?.kind ?? 'unknown';
}

function structureKind(
  fighters: ReadonlyMap<string, FighterTraceDescriptor>,
  fighterId: string | undefined,
): string {
  const kind = kindFor(fighters, fighterId);
  if (kind === 'npc:yuzu_prophet') return 'prophet';
  if (kind === 'summon:surtr') return 'surtr';
  if (kind.startsWith('summon:owl:')) return 'controlled-summon';
  if (kind.startsWith('summon:')) return 'summon';
  if (kind.startsWith('player:')) return 'player';
  if (kind.startsWith('npc:')) return 'npc';
  return kind;
}

function countBucket(count: number): string {
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 3) return '2-3';
  return '4+';
}

function relationFor(
  fighters: ReadonlyMap<string, FighterTraceDescriptor>,
  actorId: string | undefined,
  targetId: string,
  event?: BattleEvent,
): string {
  if (!actorId) return 'unattributed';
  if (actorId === targetId) return 'self';
  const actor = fighters.get(actorId);
  const target = fighters.get(targetId);
  if (!actor || !target) return 'unknown';
  if (target.summonerId === actorId) return 'owned-summon';
  if (actor.summonerId === targetId) return 'summoner';
  if (actor.summonerId && actor.summonerId === target.summonerId) return 'sibling-summon';
  if (actor.surtrOwnerIds?.includes(targetId)) return 'surtr-owner';
  if (target.surtrOwnerIds?.includes(actorId)) return 'owned-surtr';
  if (event?.actorId === actorId) {
    const actorTeamId = event.actorTeamId;
    const targetTeamId = event.targetTeamIds?.[targetId];
    if (actorTeamId && targetTeamId) return actorTeamId === targetTeamId ? 'ally' : 'enemy';
  }
  if (actor.teamId && target.teamId) return actor.teamId === target.teamId ? 'ally' : 'enemy';
  return 'unrelated';
}

function normalizeVisibleText(
  text: string,
  fighterDirectory: readonly FighterTraceDescriptor[],
): string {
  let normalized = text;
  [...fighterDirectory]
    .sort((left, right) => right.name.length - left.name.length)
    .forEach((fighter) => {
      normalized = normalized.replace(
        new RegExp(escapeRegExp(fighter.name), 'g'),
        `<${fighter.kind}>`,
      );
    });
  return normalized
    .replace(UUID_PATTERN, '<uuid>')
    .replace(INTERNAL_ID_PATTERN, '<internal-id>')
    .replace(INTERNAL_ACTION_ID_PATTERN, '<internal-action-id>')
    .replace(NUMBER_PATTERN, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function eventLabels(text: string): string[] {
  return [...text.matchAll(/【([^】]+)】/g)]
    .map((match) => match[1]?.replace(NUMBER_PATTERN, '#').trim())
    .filter((label): label is string => !!label);
}

function structuralEventToken(
  event: BattleEvent,
  fighters: ReadonlyMap<string, FighterTraceDescriptor>,
): string {
  const actor = structureKind(fighters, event.actorId);
  const targetIds = event.targetIds ?? [];
  const targetRelations = [...new Set(targetIds.map((id) => (
    relationFor(fighters, event.actorId, id, event)
  )))].sort().join(',');
  const targets = `${countBucket(targetIds.length)}:${targetRelations}`;
  const damage = event.damage
    ? [
      event.damage.sourceKind ?? 'none',
      event.damage.originSourceKind ?? 'none',
      event.damage.outcome,
      event.damage.damageScope ?? 'none',
      event.damage.hpDamage > 0 ? 'hp' : 'no-hp',
      event.damage.shieldDamage > 0 ? 'shield' : 'no-shield',
      event.damage.overkillDamage > 0 ? 'overkill' : 'no-overkill',
      event.damage.phaseTransition ? 'transition' : 'no-transition',
      event.damage.defeated ? 'defeat' : 'no-defeat',
      event.damage.originalTargetId && event.damage.originalTargetId !== event.damage.targetId
        ? `redirect:${relationFor(fighters, event.actorId, event.damage.originalTargetId, event)}`
        : 'direct-target',
    ].join(':')
    : 'none';
  const mechanicLabels = event.kind === 'status'
    ? eventLabels(event.text).join(',')
    : 'none';
  return [
    event.kind,
    event.type,
    actor,
    targets,
    event.skillId ?? 'none',
    damage,
    mechanicLabels,
  ].join('|');
}

function presentationEventToken(
  event: BattleEvent,
  directory: readonly FighterTraceDescriptor[],
): string {
  return [
    event.kind,
    event.type,
    event.visible && event.displayInFeed !== false ? 'visible' : 'hidden',
    eventLabels(event.text).join(','),
    event.visible && event.displayInFeed !== false
      ? normalizeVisibleText(event.text, directory)
      : 'hidden',
  ].join('|');
}

function categoryFor(
  events: readonly BattleEvent[],
  fighters: ReadonlyMap<string, FighterTraceDescriptor>,
): string {
  const primary = events.find((event) => event.kind === 'action_start')
    ?? events.find((event) => !!event.skillId)
    ?? events.find((event) => !!event.actorId);
  const primaryActorId = primary?.actorId;
  const exactActorKind = kindFor(fighters, primaryActorId);
  const primaryActorKind = exactActorKind === 'npc:yuzu_prophet'
    ? 'prophet'
    : exactActorKind === 'summon:surtr'
      ? 'surtr'
      : exactActorKind.startsWith('summon:owl:')
        ? 'controlled-summon'
        : exactActorKind.startsWith('summon:')
          ? 'summon'
          : exactActorKind.startsWith('player:')
            ? 'player'
            : exactActorKind.startsWith('npc:')
              ? 'npc'
              : exactActorKind;
  const primarySkill = primary?.skillId ?? 'no-skill';
  const targetRelations = [...new Set(events.flatMap((event) =>
    (event.targetIds ?? []).map((targetId) => relationFor(fighters, primaryActorId, targetId, event)),
  ))].sort();
  const flags = new Set<string>();
  events.forEach((event) => {
    if (event.kind === 'status') flags.add('status');
    if (event.kind === 'defeat') flags.add('defeat-event');
    if (!event.damage) return;
    flags.add(event.damage.outcome);
    if (event.damage.sourceKind === 'counter') flags.add('counter');
    if (event.damage.shieldDamage > 0) flags.add('shield');
    if (
      event.damage.originalTargetId &&
      event.damage.originalTargetId !== event.damage.targetId
    ) flags.add('redirect');
    if (event.damage.phaseTransition) flags.add('phase-transition');
    if (event.damage.defeated) flags.add('defeat');
  });
  const primaryRelation = targetRelations.some((relation) => (
    relation === 'surtr-owner' ||
    relation === 'owned-surtr' ||
    relation === 'summoner' ||
    relation === 'owned-summon'
  ))
    ? 'owner'
    : targetRelations.includes('ally')
      ? 'ally'
      : targetRelations.includes('enemy')
        ? 'enemy'
        : targetRelations.includes('self')
          ? 'self'
          : targetRelations.length > 0
            ? 'other'
            : 'none';
  const primaryPath = flags.has('defeat')
    ? 'defeat'
    : flags.has('phase-transition')
      ? 'phase-transition'
      : flags.has('redirect')
        ? 'redirect'
        : flags.has('counter')
          ? 'counter'
          : flags.has('shield') || flags.has('prevented') || flags.has('spell_blocked')
            ? 'blocked'
            : flags.has('hp_damage')
              ? 'damage'
              : flags.has('status')
                ? 'status'
                : 'plain';
  return [
    `actor=${primarySkill === 'no-skill' ? primaryActorKind : 'skill-actor'}`,
    `skill=${primarySkill}`,
    `target=${primaryRelation}`,
    `path=${primaryPath}`,
  ].join('|');
}

const FOCUSED_TRACE_TEXT = /(?:柚子·预言家|预言家接管|预言家保底召唤|绑定柚子|接管召唤物|接管指令|共同退场|源石开满大地|理解普瑞赛斯|必须执行源石计划|史尔特尔|莱万汀|黄昏余命|共同主人|熔核巨影|烈焰魔剑)/;

function rootTouchesFocusedMechanic(
  events: readonly BattleEvent[],
  focusIds: ReadonlySet<string>,
): boolean {
  return events.some((event) => (
    (!!event.actorId && focusIds.has(event.actorId)) ||
    (event.targetIds ?? []).some((targetId) => focusIds.has(targetId)) ||
    (!!event.damage?.attackerId && focusIds.has(event.damage.attackerId)) ||
    (!!event.damage?.targetId && focusIds.has(event.damage.targetId)) ||
    (!!event.damage?.originalTargetId && focusIds.has(event.damage.originalTargetId)) ||
    FOCUSED_TRACE_TEXT.test(event.text)
  ));
}

export function collectSemanticTraces(
  result: BattleResult,
  context: string,
  expectation: FocusedAuditExpectation = { prophet: true, surtr: true },
): SemanticTrace[] {
  const fighters = descriptorMap(result);
  const focusIds = new Set(
    result.fighterDirectory
      .filter((fighter) => (
        (expectation.prophet && (
          fighter.isYuzuProphet ||
          fighter.isYuzu ||
          fighter.prophetControlDisposition !== undefined
        )) ||
        (expectation.surtr && fighter.isSurtr)
      ))
      .map((fighter) => fighter.id),
  );
  const roots = new Map<string, BattleEvent[]>();
  result.events.forEach((event) => {
    const bucket = roots.get(event.rootEventId) ?? [];
    bucket.push(event);
    roots.set(event.rootEventId, bucket);
  });
  return [...roots.entries()]
    .filter(([, events]) => (
      rootTouchesFocusedMechanic(events, focusIds) &&
      events.some((event) => event.visible && event.displayInFeed !== false)
    ))
    .flatMap(([rootEventId, events]) => {
    const tokens = events.map((event) => structuralEventToken(event, fighters));
    const presentationTokens = events.map((event) =>
      presentationEventToken(event, result.fighterDirectory),
    );
    const presentationSignature = createHash('sha256')
      .update(presentationTokens.join('\n'))
      .digest('hex')
      .slice(0, 24);
    const sample = events
      .filter((event) => event.visible && event.displayInFeed !== false)
      .map((event) =>
        `[${event.sequence}] [T${event.turn} R${event.rootEventId} A${event.actionId ?? '-'}] [${event.type}] ${event.text}`,
      );
    const uniqueEvents = new Map<string, BattleEvent>();
    tokens.forEach((token, index) => {
      if (!uniqueEvents.has(token)) uniqueEvents.set(token, events[index]!);
    });
    return [...uniqueEvents.entries()].map(([token, event]) => ({
      signature: createHash('sha256').update(token).digest('hex').slice(0, 24),
      presentationSignature,
      reviewCategory: categoryFor([event], fighters),
      context,
      rootEventId,
      actorKinds: event.actorId ? [kindFor(fighters, event.actorId)] : [],
      skillIds: event.skillId ? [event.skillId] : [],
      labels: [...new Set(eventLabels(event.text))].sort(),
      tokenCount: events.length,
      sample,
    }));
  });
}

function causalIssues(result: BattleResult): {
  issues: FocusedAuditIssue[];
  counts: Record<string, number>;
} {
  const raw: CausalAuditIssue[] = [];
  let counts: Record<string, number> = {};
  try {
    counts = auditBattleEvents(
      result.events,
      0,
      result.seed,
      result.label,
      raw,
    );
  } catch (error) {
    raw.push({
      battle: 0,
      seed: result.seed,
      label: result.label,
      type: 'causal-auditor-crash',
      detail: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
  return {
    counts,
    issues: raw.map((issue) => ({
      type: issue.type,
      detail: issue.detail,
      eventId: issue.eventId,
      rootEventId: issue.rootEventId,
      actionId: issue.actionId,
    })),
  };
}

function genericIssues(result: BattleResult): FocusedAuditIssue[] {
  const issues: FocusedAuditIssue[] = [];
  if (result.error) issues.push({ type: 'runtime-error', detail: result.error });
  if (result.timedOut) {
    issues.push({
      type: 'timeout',
      detail: `Battle did not finish after ${result.turns} global actions`,
    });
  }
  result.invariantErrors.forEach((detail) => {
    issues.push({ type: 'invariant-error', detail });
  });
  result.logIssues.forEach((issue) => {
    issues.push({
      type: `log:${issue.type}`,
      detail: issue.text,
      line: issue.line,
    });
  });
  result.logs.forEach((entry, index) => {
    if (entry.displayInFeed === false) return;
    const hasUuid = UUID_PATTERN.test(entry.text);
    const hasInternalId = INTERNAL_ID_PATTERN.test(entry.text) || INTERNAL_ACTION_ID_PATTERN.test(entry.text);
    if (hasUuid) {
      issues.push({
        type: 'user-facing-uuid',
        detail: entry.text,
        line: index + 1,
      });
    }
    if (hasInternalId) {
      issues.push({
        type: 'user-facing-internal-id',
        detail: entry.text,
        line: index + 1,
      });
    }
    UUID_PATTERN.lastIndex = 0;
    INTERNAL_ID_PATTERN.lastIndex = 0;
    INTERNAL_ACTION_ID_PATTERN.lastIndex = 0;
  });
  return issues;
}

function majorEventIssues(result: BattleResult): FocusedAuditIssue[] {
  const prophetAppeared = result.logs.some((entry) =>
    entry.text.includes('【柚子·预言家登场】'),
  );
  const herobrineAppeared = result.logs.some((entry) =>
    entry.text.includes('Herobrine') || entry.text.includes('【异常目击】'),
  );
  return prophetAppeared && herobrineAppeared
    ? [{
      type: 'mutually-exclusive-major-events-coexisted',
      detail: 'Yuzu Prophet/Puruisaishi and Herobrine appeared in the same battle',
    }]
    : [];
}

export function auditFocusedBattle(
  result: BattleResult,
  expectation: FocusedAuditExpectation,
  context = result.phase,
): FocusedAuditResult {
  const causal = causalIssues(result);
  const issues = [
    ...genericIssues(result),
    ...causal.issues,
    ...majorEventIssues(result),
  ];
  let prophetMetrics: ProphetMetrics | undefined;
  let surtrCoverage: SurtrCoverage | undefined;
  if (expectation.prophet) {
    prophetMetrics = collectProphetMetrics(result);
    auditYuzuProphetResult(result, prophetMetrics).forEach((issue) => {
      issues.push({ type: `prophet:${issue.kind}`, detail: issue.detail });
    });
  }
  if (expectation.surtr) {
    const scan = scanSurtrLogs(result);
    surtrCoverage = scan.coverage;
    scan.issues.forEach((issue) => {
      issues.push({
        type: `surtr:${issue.type}`,
        detail: issue.text,
        line: issue.line,
      });
    });
  }
  return {
    issues,
    eventCounts: causal.counts,
    prophetMetrics,
    surtrCoverage,
    traces: collectSemanticTraces(result, context, expectation),
  };
}
