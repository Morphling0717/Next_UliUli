import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BattleEvent } from '../../../lib/namearena/types';
import {
  NO_WATER,
  runBattle,
} from '../shared/harness';

type VisualAuditIssue = {
  battle: number;
  seed: number;
  label: string;
  type: string;
  eventId?: string;
  actionId?: string;
  text?: string;
  detail: string;
};

const BATTLE_COUNT = Number.parseInt(process.env.NAMEARENA_VISUAL_AUDIT_BATTLES ?? '1000', 10);
const BASE_SEED = Number.parseInt(process.env.NAMEARENA_VISUAL_AUDIT_SEED ?? '990000', 10);
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);
const OUT_DIR = path.join(process.cwd(), '.tmp', 'namearena-deep-audit');

function addIssue(
  issues: VisualAuditIssue[],
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
    text: event?.text,
  });
}

function auditBattleEvents(
  events: BattleEvent[],
  battle: number,
  seed: number,
  label: string,
  issues: VisualAuditIssue[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  const visualIds = new Set<string>();
  const transformationEdges = new Set<string>();
  const combatCueCountByAction = new Map<string, number>();
  const combatCueTargetsByAction = new Map<string, Set<string>>();
  const actionStarts = new Map<string, BattleEvent>();
  const directDamageTargetsByAction = new Map<string, Set<string>>();

  events.forEach((event) => {
    if (event.kind === 'action_start' && event.actionId) actionStarts.set(event.actionId, event);
  });

  events.forEach((event) => {
    if (event.kind !== 'damage' || !event.actionId || !event.damage) return;
    const actionStart = actionStarts.get(event.actionId);
    if (!actionStart?.actorId || event.damage.attackerId !== actionStart.actorId) return;
    if (!['standard', 'custom', 'manual'].includes(event.damage.sourceKind ?? '')) return;
    if (event.damage.actionName?.includes('护主')) return;
    // Animation follows the unit that physically receives this settlement. The
    // original target remains causal metadata for intercept/share diagnostics.
    const targetId = event.damage.targetId;
    if (!targetId || targetId === actionStart.actorId) return;
    const targets = directDamageTargetsByAction.get(event.actionId) ?? new Set<string>();
    targets.add(targetId);
    directDamageTargetsByAction.set(event.actionId, targets);
  });

  events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      addIssue(issues, battle, seed, label, 'non_contiguous_event_sequence', `expected ${index + 1}, got ${event.sequence}`, event);
    }

    const cue = event.visualCue;
    if (!cue) return;
    counts[cue.kind] = (counts[cue.kind] ?? 0) + 1;

    if (!event.visualCueId) {
      addIssue(issues, battle, seed, label, 'missing_visual_cue_id', 'visual event has no stable playback key', event);
    } else if (visualIds.has(event.visualCueId)) {
      addIssue(issues, battle, seed, label, 'duplicate_visual_cue_id', event.visualCueId, event);
    } else {
      visualIds.add(event.visualCueId);
    }

    if (!event.visible || event.displayInFeed === false) {
      addIssue(issues, battle, seed, label, 'hidden_visual_event', 'a visual cue was attached to a hidden event', event);
    }

    if (cue.kind === 'transformation' || cue.kind === 'form_shift') {
      if (event.actorId !== cue.fighterId || !event.targetIds?.includes(cue.fighterId)) {
        addIssue(issues, battle, seed, label, 'form_actor_target_mismatch', 'form cue actor/target metadata does not point at the transformed fighter', event);
      }
      if (!event.text.includes(cue.fighterName)) {
        addIssue(issues, battle, seed, label, 'form_cue_on_unrelated_log', `log does not name ${cue.fighterName}`, event);
      }
      if (cue.kind === 'transformation' && cue.from.jobKey === cue.to.jobKey && cue.from.phase === cue.to.phase) {
        addIssue(issues, battle, seed, label, 'empty_form_transition', 'before and after form snapshots are identical', event);
      }
      if (cue.kind === 'transformation') {
        if (cue.cause !== 'phase_advance') {
          addIssue(issues, battle, seed, label, 'transformation_wrong_cause', cue.cause, event);
        }
        if (cue.to.phase <= cue.from.phase) {
          addIssue(issues, battle, seed, label, 'same_or_reverse_phase_transformation', `${cue.from.phase} -> ${cue.to.phase}`, event);
        }
        const edge = `${cue.fighterId}:${cue.from.phase}->${cue.to.phase}`;
        if (transformationEdges.has(edge)) {
          addIssue(issues, battle, seed, label, 'duplicate_phase_edge', edge, event);
        }
        transformationEdges.add(edge);
      } else {
        if (cue.cause === 'phase_advance') {
          addIssue(issues, battle, seed, label, 'phase_advance_mislabeled_as_form_shift', `${cue.from.phase} -> ${cue.to.phase}`, event);
        }
        if (cue.to.phase > cue.from.phase && cue.cause !== 'revival') {
          addIssue(issues, battle, seed, label, 'unexplained_phase_up_form_shift', `${cue.from.phase} -> ${cue.to.phase} (${cue.cause})`, event);
        }
      }
    }

    if (cue.kind === 'combat_action' || cue.kind === 'combat_fx') {
      if (!event.actionId) {
        addIssue(issues, battle, seed, label, 'combat_visual_without_action', 'combat cue is not attached to a causal action', event);
      } else {
        if (cue.kind === 'combat_action') {
          combatCueCountByAction.set(event.actionId, (combatCueCountByAction.get(event.actionId) ?? 0) + 1);
        }
        const actionTargets = combatCueTargetsByAction.get(event.actionId) ?? new Set<string>();
        cue.targetIds.forEach((targetId) => actionTargets.add(targetId));
        combatCueTargetsByAction.set(event.actionId, actionTargets);
      }
      if (event.actorId !== cue.sourceId) {
        addIssue(issues, battle, seed, label, 'combat_actor_mismatch', `${event.actorId ?? 'none'} != ${cue.sourceId}`, event);
      }
      if (cue.targetIds.length === 0) {
        addIssue(issues, battle, seed, label, 'combat_visual_without_target', 'combat cue has no structured target', event);
      }
      const eventTargets = new Set(event.targetIds ?? []);
      if (cue.targetIds.some((targetId) => !eventTargets.has(targetId))) {
        addIssue(issues, battle, seed, label, 'combat_target_mismatch', 'cue targets and event targets disagree', event);
      }
    }

    if (cue.kind === 'reaction_fx') {
      if (event.actorId !== cue.sourceId) {
        addIssue(issues, battle, seed, label, 'reaction_actor_mismatch', `${event.actorId ?? 'none'} != ${cue.sourceId}`, event);
      }
      if (cue.targetIds.length === 0) {
        addIssue(issues, battle, seed, label, 'reaction_visual_without_target', 'reaction cue has no structured target', event);
      }
      const eventTargets = new Set(event.targetIds ?? []);
      if (cue.targetIds.some((targetId) => !eventTargets.has(targetId))) {
        addIssue(issues, battle, seed, label, 'reaction_target_mismatch', 'reaction cue targets and event targets disagree', event);
      }
    }

    if (cue.kind === 'summon_card') {
      if (event.actorId !== cue.summonerId || !event.targetIds?.includes(cue.summonId)) {
        addIssue(issues, battle, seed, label, 'summon_actor_target_mismatch', 'summon cue does not identify its summoner and summoned unit', event);
      }
    }
  });

  combatCueCountByAction.forEach((count, actionId) => {
    if (count > 1) {
      addIssue(issues, battle, seed, label, 'duplicate_combat_visual_in_action', `${actionId} published ${count} combat cues`);
    }
  });

  directDamageTargetsByAction.forEach((directTargets, actionId) => {
    const cueTargets = combatCueTargetsByAction.get(actionId);
    const actionStart = actionStarts.get(actionId);
    const actionLabel = `${actionStart?.actorName ?? 'unknown actor'} / ${actionStart?.skillId ?? 'basic'} / ${actionStart?.skillName ?? 'unknown skill'}`;
    if (!cueTargets) {
      addIssue(issues, battle, seed, label, 'direct_damage_action_without_visual_cue', `${actionId} (${actionLabel}) directly damaged ${[...directTargets].join(', ')}`, actionStart);
      return;
    }
    const missingTargets = [...directTargets].filter((targetId) => !cueTargets.has(targetId));
    if (missingTargets.length > 0) {
      addIssue(
        issues,
        battle,
        seed,
        label,
        'combat_visual_missing_direct_targets',
        `${actionId} (${actionLabel}) omitted ${missingTargets.join(', ')} from its structured cue`,
        actionStart,
      );
    }
  });

  return counts;
}

export function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const issues: VisualAuditIssue[] = [];
  const cueCounts: Record<string, number> = {};
  let timedOut = 0;
  const timeoutExamples: Array<{ seed: number; label: string; survivors: string[] }> = [];
  let runtimeErrors = 0;
  let invariantErrors = 0;
  let logIssues = 0;
  let eventCount = 0;

  const startedAt = Date.now();
  for (let index = 0; index < BATTLE_COUNT; index += 1) {
    const seed = BASE_SEED + index;
    const label = `visual-no-water-${index}`;
    const result = runBattle({ phase: 'visual-no-water', label, names: NO_WATER, seed }, {
      checkInvariantsEachStep: true,
      maxTurns: MAX_TURNS,
      scanLogs: true,
    });
    if (result.timedOut) {
      timedOut += 1;
      if (timeoutExamples.length < 30) timeoutExamples.push({ seed, label, survivors: result.survivors });
    }
    if (result.error) {
      runtimeErrors += 1;
      addIssue(issues, index, seed, label, 'runtime_error', result.error);
    }
    if (result.invariantErrors.length > 0) {
      invariantErrors += result.invariantErrors.length;
      result.invariantErrors.forEach((detail) => addIssue(issues, index, seed, label, 'invariant_error', detail));
    }
    if (result.logIssues.length > 0) {
      logIssues += result.logIssues.length;
      result.logIssues.forEach((issue) => addIssue(issues, index, seed, label, `log_${issue.type}`, issue.text));
    }
    eventCount += result.events.length;
    const battleCueCounts = auditBattleEvents(result.events, index, seed, label, issues);
    Object.entries(battleCueCounts).forEach(([kind, count]) => {
      cueCounts[kind] = (cueCounts[kind] ?? 0) + count;
    });
    if ((index + 1) % 100 === 0 || index + 1 === BATTLE_COUNT) {
      console.log(`visual audit ${index + 1}/${BATTLE_COUNT}`);
    }
  }

  const report = {
    ok: issues.length === 0,
    battleCount: BATTLE_COUNT,
    baseSeed: BASE_SEED,
    maxTurns: MAX_TURNS,
    elapsedMs: Date.now() - startedAt,
    eventCount,
    cueCounts,
    timedOut,
    timeoutExamples,
    runtimeErrors,
    invariantErrors,
    logIssues,
    issueCount: issues.length,
    issuesByAction: issues.reduce<Record<string, number>>((counts, issue) => {
      const match = issue.detail.match(/\(([^)]+)\)/);
      const key = match?.[1] ?? issue.type;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    issues,
  };
  const outputPath = path.join(OUT_DIR, `visual-events-${BATTLE_COUNT}.json`);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, issues: issues.slice(0, 20), outputPath }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
