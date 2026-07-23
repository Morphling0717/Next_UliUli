import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BattleEvent } from '../../../lib/namearena/types';
import { NO_WATER, SPECIALS, runBattle } from '../shared/harness';

type CausalAuditIssue = {
  battle: number;
  seed: number;
  label: string;
  type: string;
  detail: string;
  eventId?: string;
  actionId?: string;
  rootEventId?: string;
  text?: string;
};

type ActionSpan = {
  start: BattleEvent;
  end?: BattleEvent;
};

const BATTLE_COUNT = Number.parseInt(process.env.NAMEARENA_CAUSAL_AUDIT_BATTLES ?? '100', 10);
const BASE_SEED = Number.parseInt(process.env.NAMEARENA_CAUSAL_AUDIT_SEED ?? '995000', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);
const MODE = process.env.NAMEARENA_CAUSAL_AUDIT_MODE ?? 'no-water';
const OUT_DIR = path.join(process.cwd(), '.tmp', 'namearena-deep-audit');

function addIssue(
  issues: CausalAuditIssue[],
  battle: number,
  seed: number,
  label: string,
  type: string,
  detail: string,
  event?: BattleEvent,
): void {
  issues.push({
    battle,
    seed,
    label,
    type,
    detail,
    eventId: event?.id,
    actionId: event?.actionId,
    rootEventId: event?.rootEventId,
    text: event?.text,
  });
}

function auditBattleEvents(
  events: BattleEvent[],
  battle: number,
  seed: number,
  label: string,
  issues: CausalAuditIssue[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  const actionStack: string[] = [];
  const actions = new Map<string, ActionSpan>();
  const eventIds = new Set<string>();
  const defeated = new Set<string>();
  const recentVisibleByRoot = new Map<string, BattleEvent[]>();

  events.forEach((event, index) => {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    if (event.sequence !== index + 1) {
      addIssue(issues, battle, seed, label, 'non_contiguous_sequence', `expected ${index + 1}, got ${event.sequence}`, event);
    }
    if (eventIds.has(event.id)) {
      addIssue(issues, battle, seed, label, 'duplicate_event_id', event.id, event);
    }
    eventIds.add(event.id);

    if (event.kind === 'action_start') {
      if (!event.actionId || !event.actorId || !event.skillName) {
        addIssue(issues, battle, seed, label, 'incomplete_action_start', 'action start lacks action, actor, or skill identity', event);
      } else if (actions.has(event.actionId)) {
        addIssue(issues, battle, seed, label, 'duplicate_action_start', event.actionId, event);
      } else {
        actions.set(event.actionId, { start: event });
        actionStack.push(event.actionId);
      }
    }

    const activeActionId = actionStack.at(-1);
    const causalRootId = actionStack[0]
      ? actions.get(actionStack[0])?.start.rootEventId
      : undefined;
    if (activeActionId && event.actionId !== activeActionId) {
      addIssue(issues, battle, seed, label, 'event_outside_active_action', `active ${activeActionId}, event uses ${event.actionId ?? 'none'}`, event);
    }
    const expectedRoot = causalRootId ?? (event.rootEventId.startsWith('scope-') ? event.rootEventId : event.id);
    if (event.rootEventId !== expectedRoot) {
      addIssue(issues, battle, seed, label, 'root_event_mismatch', `expected ${expectedRoot}, got ${event.rootEventId}`, event);
    }

    if (event.kind === 'damage' && event.damage) {
      const damage = event.damage;
      if (event.actorId !== damage.attackerId) {
        addIssue(issues, battle, seed, label, 'damage_actor_mismatch', `${event.actorId ?? 'none'} != ${damage.attackerId ?? 'none'}`, event);
      }
      if (event.targetIds?.length !== 1 || event.targetIds[0] !== damage.targetId || damage.actualTargetId !== damage.targetId) {
        addIssue(issues, battle, seed, label, 'damage_target_mismatch', `${event.targetIds?.join(',') ?? 'none'} != ${damage.targetId}/${damage.actualTargetId}`, event);
      }
      if (damage.rootEventId !== event.rootEventId) {
        addIssue(issues, battle, seed, label, 'damage_root_mismatch', `${damage.rootEventId ?? 'none'} != ${event.rootEventId}`, event);
      }
      const numericValues = [damage.attempted, damage.hpDamage, damage.shieldDamage, damage.overkillDamage];
      if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
        addIssue(issues, battle, seed, label, 'invalid_damage_numbers', numericValues.join('/'), event);
      }
      if (
        ['invulnerable', 'spell_blocked', 'redirected', 'prevented'].includes(damage.outcome) &&
        damage.hpDamage !== 0
      ) {
        addIssue(issues, battle, seed, label, 'prevented_damage_has_hp_loss', `${damage.outcome} recorded ${damage.hpDamage} HP damage`, event);
      }
      if (damage.outcome === 'hp_damage' && damage.hpDamage <= 0) {
        addIssue(issues, battle, seed, label, 'hp_damage_outcome_without_hp_loss', `recorded ${damage.hpDamage}`, event);
      }
      const action = event.actionId ? actions.get(event.actionId)?.start : undefined;
      if (
        action?.actorId &&
        damage.attackerId &&
        damage.attackerId !== action.actorId &&
        ['standard', 'custom', 'manual'].includes(damage.sourceKind ?? '')
      ) {
        addIssue(
          issues,
          battle,
          seed,
          label,
          'foreign_direct_damage_in_action',
          `${damage.attackerId} dealt ${damage.sourceKind} damage inside ${action.actorId}/${action.skillName}`,
          event,
        );
      }
    }

    if (event.visible) {
      const window = recentVisibleByRoot.get(event.rootEventId) ?? [];
      window.push(event);
      if (window.length > 8) window.shift();
      recentVisibleByRoot.set(event.rootEventId, window);
    }

    if (event.kind === 'defeat') {
      const targetId = event.targetIds?.[0];
      if (!targetId || event.targetIds?.length !== 1) {
        addIssue(issues, battle, seed, label, 'defeat_without_single_target', event.targetIds?.join(',') ?? 'none', event);
      } else {
        if (defeated.has(targetId)) {
          addIssue(issues, battle, seed, label, 'duplicate_defeat_without_revive', targetId, event);
        }
        defeated.add(targetId);
        const rootWindow = recentVisibleByRoot.get(event.rootEventId) ?? [];
        const hasVisibleCause = rootWindow.some((candidate) =>
          candidate.type === 'death' ||
          /击败|击倒|倒下|阵亡|死亡|处决|献祭|退场|淘汰|摧毁|击溃|回收|溺毙|死了/.test(candidate.text),
        );
        if (!hasVisibleCause) {
          addIssue(issues, battle, seed, label, 'defeat_without_visible_cause', targetId, event);
        }
      }
    }

    const cue = event.visualCue;
    if ((cue?.kind === 'form_shift' && (cue.cause === 'revival' || cue.cause === 'redeploy'))) {
      defeated.delete(cue.fighterId);
    }
    if (event.visible && /复活|重新部署|浴火重生|死者苏生|拉回战场|被水人救起/.test(event.text)) {
      event.targetIds?.forEach((targetId) => defeated.delete(targetId));
      if (event.actorId) defeated.delete(event.actorId);
    }

    if (event.kind === 'action_end') {
      if (!event.actionId || activeActionId !== event.actionId) {
        addIssue(issues, battle, seed, label, 'unbalanced_action_end', `active ${activeActionId ?? 'none'}, ending ${event.actionId ?? 'none'}`, event);
      } else {
        const span = actions.get(event.actionId);
        if (!span) {
          addIssue(issues, battle, seed, label, 'action_end_without_start', event.actionId, event);
        } else if (span.end) {
          addIssue(issues, battle, seed, label, 'duplicate_action_end', event.actionId, event);
        } else {
          span.end = event;
        }
        actionStack.pop();
      }
    }
  });

  events.forEach((event, index) => {
    if (event.kind !== 'damage' || !event.damage) return;
    if (event.damage.hpDamage <= 0 && event.damage.shieldDamage <= 0) return;
    const snapshotSettlement = events.slice(index + 1).find((candidate) => (
      candidate.rootEventId === event.rootEventId && candidate.visible
    ));
    if (!snapshotSettlement) {
      addIssue(
        issues,
        battle,
        seed,
        label,
        'damage_without_following_snapshot_commit',
        `${event.damage.actionName ?? event.damage.source} changed ${event.damage.targetId} by HP ${event.damage.hpDamage} / shield ${event.damage.shieldDamage} without a later playback snapshot event in root ${event.rootEventId}`,
        event,
      );
    }
  });

  actionStack.forEach((actionId) => {
    addIssue(issues, battle, seed, label, 'unclosed_action', actionId, actions.get(actionId)?.start);
  });
  actions.forEach((span, actionId) => {
    if (!span.end) addIssue(issues, battle, seed, label, 'action_without_end', actionId, span.start);
  });
  return counts;
}

function rosterForMode(): { names: string[]; forcePuruisaishi: boolean } {
  if (MODE === 'water') return { names: SPECIALS, forcePuruisaishi: false };
  if (MODE === 'puru') return { names: NO_WATER, forcePuruisaishi: true };
  return { names: NO_WATER, forcePuruisaishi: false };
}

export function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const roster = rosterForMode();
  const issues: CausalAuditIssue[] = [];
  const eventCounts: Record<string, number> = {};
  let timedOut = 0;
  const timeoutExamples: Array<{ seed: number; label: string; survivors: string[] }> = [];
  let runtimeErrors = 0;
  let invariantErrors = 0;
  let logIssues = 0;
  const startedAt = Date.now();

  for (let index = 0; index < BATTLE_COUNT; index += 1) {
    const seed = BASE_SEED + index;
    const label = `causal-${MODE}-${index}`;
    const result = runBattle({ phase: `causal-${MODE}`, label, names: roster.names, seed }, {
      checkInvariantsEachStep: true,
      maxTurns: MAX_TURNS,
      scanLogs: true,
      forcePuruisaishi: roster.forcePuruisaishi,
    });
    if (result.timedOut) {
      timedOut += 1;
      if (timeoutExamples.length < 30) timeoutExamples.push({ seed, label, survivors: result.survivors });
    }
    if (result.error) {
      runtimeErrors += 1;
      addIssue(issues, index, seed, label, 'runtime_error', result.error);
    }
    invariantErrors += result.invariantErrors.length;
    result.invariantErrors.forEach((detail) => addIssue(issues, index, seed, label, 'invariant_error', detail));
    logIssues += result.logIssues.length;
    result.logIssues.forEach((issue) => addIssue(issues, index, seed, label, `log_${issue.type}`, issue.text));
    const battleCounts = auditBattleEvents(result.events, index, seed, label, issues);
    Object.entries(battleCounts).forEach(([kind, count]) => {
      eventCounts[kind] = (eventCounts[kind] ?? 0) + count;
    });
    if ((index + 1) % 25 === 0 || index + 1 === BATTLE_COUNT) {
      console.log(`causal audit ${MODE} ${index + 1}/${BATTLE_COUNT}`);
    }
  }

  const report = {
    ok: issues.length === 0,
    mode: MODE,
    battleCount: BATTLE_COUNT,
    baseSeed: BASE_SEED,
    maxTurns: MAX_TURNS,
    elapsedMs: Date.now() - startedAt,
    eventCounts,
    timedOut,
    timeoutExamples,
    runtimeErrors,
    invariantErrors,
    logIssues,
    issueCount: issues.length,
    issuesByType: issues.reduce<Record<string, number>>((counts, issue) => {
      counts[issue.type] = (counts[issue.type] ?? 0) + 1;
      return counts;
    }, {}),
    issues,
  };
  const outputPath = path.join(OUT_DIR, `causal-${MODE}-${BATTLE_COUNT}.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, issues: issues.slice(0, 30), outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
