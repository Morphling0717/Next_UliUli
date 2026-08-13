import { createBattleState } from '../../../lib/namearena/battleState';
import { GACHA_RA_PHOENIX_STATUS } from '../../../lib/namearena/gachaMechanics';
import { ensureMomoAwakenedSword } from '../../../lib/namearena/momoMechanics';
import { surtrSkills } from '../../../lib/namearena/skills/surtr';
import { applyStatus } from '../../../lib/namearena/statusSystem';
import { grantYuzuShield } from '../../../lib/namearena/yuzuMechanics';
import { enterTokusatsuThroneStance } from '../../../lib/namearena/tokusatsuMechanics';
import type {
  BattleEvent,
  BattleLogMetadata,
  Fighter,
  SkillContext,
} from '../../../lib/namearena/types';
import {
  assert,
  makeEngine,
  makeFighter,
  NO_WATER,
  runBattle,
  SPECIALS,
  type BattleResult,
  withRandomSequence,
} from '../shared/harness';
import { auditBattleEvents, type CausalAuditIssue } from '../audit/causalEventRunner';
import { computeFocusedAuditSourceFingerprint } from '../audit/yuzuSurtrAuditWorker';
import { auditFocusedBattle, collectSemanticTraces } from '../audit/yuzuSurtrSemantic';
import { auditYuzuProphetResult } from '../stress/yuzuProphetRunner';
import { scanSurtrLogs } from '../stress/surtrRunner';

const FOCUSED_FIXTURE_ROSTER = ['牢鳄', '鸮', '柚子', '玄凝'];

function cloneResult(result: BattleResult): BattleResult {
  return structuredClone(result);
}

function causalIssueTypes(result: BattleResult): Set<string> {
  const issues: CausalAuditIssue[] = [];
  auditBattleEvents(result.events, 0, result.seed, result.label, issues);
  return new Set(issues.map((issue) => issue.type));
}

function controlledSummonAction(result: BattleResult): BattleEvent {
  const controlledIds = new Set(
    result.fighterDirectory
      .filter((fighter) => fighter.isSummon && fighter.prophetControlDisposition)
      .map((fighter) => fighter.id),
  );
  const event = result.events.find((candidate) =>
    candidate.kind === 'action_start' &&
    !!candidate.actorId &&
    controlledIds.has(candidate.actorId) &&
    (candidate.targetIds?.length ?? 0) > 0,
  );
  assert(event, 'Fault-injection fixture requires a controlled summon action');
  return event;
}

function firstSurtrAction(result: BattleResult): BattleEvent {
  const surtrIds = new Set(
    result.fighterDirectory.filter((fighter) => fighter.isSurtr).map((fighter) => fighter.id),
  );
  const event = result.events.find((candidate) =>
    candidate.kind === 'action_start' &&
    !!candidate.actorId &&
    surtrIds.has(candidate.actorId),
  );
  assert(event, 'Fault-injection fixture requires a Surtr action');
  return event;
}

export function runYuzuSurtrAuditCases(): string[] {
  const cases: string[] = [];

  {
    const firstFingerprint = computeFocusedAuditSourceFingerprint();
    const secondFingerprint = computeFocusedAuditSourceFingerprint();
    assert(
      /^[a-f0-9]{64}$/.test(firstFingerprint) && firstFingerprint === secondFingerprint,
      'Focused audit source fingerprint must be stable and content-addressed',
    );
    cases.push('Focused audit checkpoints are bound to a stable source fingerprint');
  }

  {
    const actor = makeFighter('克蕾儿丝菲尔');
    const controlledSummon = makeFighter('玄凝');
    actor.teamId = 'A';
    controlledSummon.teamId = 'YUZU_PROPHET_EVENT';
    controlledSummon.isSummon = true;
    const logs: BattleResult['logs'] = [];
    const engine = makeEngine([actor, controlledSummon], logs);
    engine.log('skill', '测试：攻击仍受预言家控制的召唤物。', {
      actorId: actor.id,
      actorName: actor.name,
      targetIds: [controlledSummon.id],
      skillId: 'relation_snapshot_test',
      skillName: '关系快照测试',
    });
    const event = engine.events[0];
    assert(
      event?.actorTeamId === 'A' &&
      event.targetTeamIds?.[controlledSummon.id] === 'YUZU_PROPHET_EVENT',
      'Battle events must capture affiliations when the event is created',
    );

    controlledSummon.teamId = 'A';
    const result = {
      phase: 'relation-snapshot',
      label: 'relation-snapshot',
      names: [actor.name, controlledSummon.name],
      seed: 1,
      turns: 1,
      ended: true,
      timedOut: false,
      error: null,
      invariantErrors: [],
      logIssues: [],
      logCount: logs.length,
      survivors: [actor.name, controlledSummon.name],
      logs,
      events: engine.events,
      fighterDirectory: [
        {
          id: actor.id,
          name: actor.name,
          kind: 'player:克蕾儿丝菲尔',
          teamId: 'A',
          isNpc: false,
          isSummon: false,
          isSurtr: false,
          isYuzuProphet: false,
          isYuzu: false,
        },
        {
          id: controlledSummon.id,
          name: controlledSummon.name,
          kind: 'summon:owl:swire',
          teamId: 'A',
          isNpc: false,
          isSummon: true,
          isSurtr: false,
          isYuzuProphet: false,
          isYuzu: false,
          prophetControlDisposition: 'returned',
        },
      ],
    } satisfies BattleResult;
    const trace = collectSemanticTraces(result, result.phase, { prophet: true })
      .find((candidate) => candidate.skillIds.includes('relation_snapshot_test'));
    assert(
      trace?.reviewCategory.includes('target=enemy'),
      'Semantic review must use the event-time enemy relation after a controlled summon returns home',
    );
    cases.push('Semantic traces preserve event-time affiliation after later ownership changes');
  }

  const prophetResult = runBattle({
    phase: 'audit-fault-prophet',
    label: 'audit-fault-prophet',
    names: [...FOCUSED_FIXTURE_ROSTER],
    seed: 3_100_000,
  }, {
    forceYuzuProphet: true,
    maxTurns: 800,
    scanLogs: true,
  });
  assert(!prophetResult.error && !prophetResult.timedOut, 'Prophet fault-injection baseline must finish');
  assert(
    auditYuzuProphetResult(prophetResult).length === 0,
    'Prophet fault-injection baseline must be clean before mutation',
  );

  {
    const mutated = cloneResult(prophetResult);
    const action = controlledSummonAction(mutated);
    mutated.logs.push({
      type: 'skill',
      text: '⚔️ 【预言家拼点】测试召唤物错误进入拼点。',
      actorId: action.actorId,
      actorName: action.actorName,
      targetIds: action.targetIds,
    });
    assert(
      auditYuzuProphetResult(mutated).some((issue) => issue.kind === 'controlled-summon-entered-clash'),
      'The audit must reject a controlled summon entering the Prophet clash pipeline',
    );
    cases.push('Fault injection detects a controlled summon entering Prophet clash');
  }

  {
    const mutated = cloneResult(prophetResult);
    const action = controlledSummonAction(mutated);
    const prophet = mutated.fighterDirectory.find((fighter) => fighter.isYuzuProphet);
    assert(prophet, 'Prophet fixture must expose its NPC descriptor');
    action.targetIds = [prophet.id];
    assert(
      auditYuzuProphetResult(mutated).some((issue) => issue.kind === 'controlled-summon-illegal-target'),
      'The audit must reject controlled-summon self/allied-NPC targeting',
    );
    cases.push('Fault injection detects illegal controlled-summon targeting');
  }

  const surtrResult = runBattle({
    phase: 'audit-fault-surtr',
    label: 'audit-fault-surtr',
    names: [...FOCUSED_FIXTURE_ROSTER],
    seed: 3_300_000,
  }, {
    forceSurtr: true,
    forceSurtrLifecycle: 'twilight',
    maxTurns: 800,
    scanLogs: true,
  });
  assert(!surtrResult.error && !surtrResult.timedOut, 'Surtr fault-injection baseline must finish');
  assert(scanSurtrLogs(surtrResult).issues.length === 0, 'Surtr fault-injection baseline must be clean before mutation');

  {
    const chainedKills = runBattle({
      phase: 'surtr-2v2',
      label: 'surtr-2v2-chained-command-kills',
      names: ['玄凝@A', '鸮@A', '牢鳄@B', '克蕾儿丝菲尔@B'],
      seed: 21_001_705,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'normal',
      maxTurns: 10_000,
      scanLogs: true,
      scanRosterNames: true,
    });
    const allSplitLogs = chainedKills.logs.filter((entry) =>
      entry.text.includes('【共同击杀分账】'),
    );
    const splitLogs = allSplitLogs;
    assert(
      chainedKills.ended && splitLogs.length >= 2 &&
      new Set(splitLogs.map((entry) => entry.actionId)).size >= 2,
      'Seed 21001705 must retain multiple legal Surtr kills in separate actions',
    );
    assert(
      scanSurtrLogs(chainedKills).issues
        .every((issue) => issue.type !== 'surtr-joint-kill-split-repeated'),
      'Joint-kill deduplication must preserve separate legal actions',
    );
    cases.push('Seed 21001705 allows multiple Surtr kill splits in separate actions');
  }

  {
    const ownerVictim = runBattle({
      phase: 'surtr-2v2',
      label: 'surtr-2v2-玄凝+牢鳄-vs-柚子+鸮',
      names: ['玄凝@A', '牢鳄@A', '柚子@B', '鸮@B'],
      seed: 21_001_333,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'normal',
      maxTurns: 10_000,
      scanLogs: true,
      scanRosterNames: true,
    });
    const selfCreditExcluded = ownerVictim.logs.find((entry) =>
      entry.text.includes('【共同击杀分账】') &&
      entry.text.includes('鸮 是本次受害者') &&
      entry.text.includes('不获得自己的击杀分账'),
    );
    assert(
      ownerVictim.ended && !ownerVictim.error && selfCreditExcluded,
      'Seed 21001333 must retain the Surtr kill where Owl is both owner and victim',
    );
    assert(
      (selfCreditExcluded.text.match(/\+0\.5/g) ?? []).length === 1 &&
      scanSurtrLogs(ownerVictim).issues.every((issue) => issue.type !== 'surtr-joint-kill-split'),
      'The joint-kill audit must accept one legal half credit when the other owner is the victim',
    );
    cases.push('Seed 21001333 accepts one-owner Surtr split when the other owner is the victim');
  }

  {
    const sharedDamageKills = cloneResult(surtrResult);
    const splitTemplate = sharedDamageKills.logs.find((entry) =>
      entry.text.includes('【共同击杀分账】'),
    );
    assert(splitTemplate, 'Surtr fixture must contain a joint-kill split log');
    const victims = sharedDamageKills.fighterDirectory
      .filter((fighter) => !fighter.isSurtr)
      .slice(0, 2);
    assert(victims.length === 2, 'Surtr fixture must expose two distinct split-damage victims');
    const actionId = 'regression-shared-damage-action';
    const rootEventId = 'regression-shared-damage-root';
    victims.forEach((victim, index) => {
      sharedDamageKills.logs.push({
        ...structuredClone(splitTemplate),
        id: `regression-shared-death-${index}`,
        type: 'death',
        text: `💀 【共同伤害测试】${victim.name} 倒下。`,
        actionId,
        rootEventId,
        targetIds: [victim.id],
      });
      sharedDamageKills.logs.push({
        ...structuredClone(splitTemplate),
        id: `regression-shared-split-${index}`,
        actionId,
        rootEventId,
        targetIds: [victim.id],
      });
    });
    assert(
      scanSurtrLogs(sharedDamageKills).issues
        .every((issue) => issue.type !== 'surtr-joint-kill-split-repeated'),
      'Joint-kill deduplication must distinguish separate victims in the same action',
    );
    cases.push('Separate shared-damage victims may receive Surtr split credit in one action');
  }

  {
    const mutated = cloneResult(surtrResult);
    const twilightIndex = mutated.logs.findIndex((entry) => entry.text.includes('【黄昏】史尔特尔：“莱万汀！”'));
    assert(twilightIndex >= 0, 'Surtr fixture must contain a Twilight activation');
    mutated.logs.splice(twilightIndex + 1, 0, structuredClone(mutated.logs[twilightIndex]!));
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-twilight-repeated'),
      'The audit must reject a duplicate Twilight activation',
    );
    cases.push('Fault injection detects duplicate Twilight activation');
  }

  {
    const mutated = cloneResult(surtrResult);
    const template = mutated.logs.at(-1);
    assert(template, 'Surtr afterglow fault fixture requires a log template');
    mutated.logs.push({
      ...template,
      text: '🔥 【黄昏余命】史尔特尔#99 的生命降至 0，但仍将获得 8 次行动机会。',
    });
    for (let count = 1; count <= 7; count += 1) {
      mutated.logs.push({
        ...template,
        text: `🔥 【黄昏余命】史尔特尔#99 完成第 ${count}/8 次余命行动机会。`,
      });
    }
    mutated.logs.push({
      ...template,
      text: '🔥 【黄昏尽头】史尔特尔#99 的八次余命耗尽。',
    });
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-afterglow-ended-early'),
      'The audit must reject an afterglow ending before its eighth opportunity',
    );
    cases.push('Fault injection detects an early Surtr afterglow ending');
  }

  {
    const mutated = cloneResult(surtrResult);
    const template = mutated.logs.at(-1);
    assert(template, 'Surtr afterglow-overrun fault fixture requires a log template');
    mutated.logs.push({
      ...template,
      text: '🔥 【黄昏余命】史尔特尔#98 的生命降至 0，但仍将获得 8 次行动机会。',
    });
    for (let count = 1; count <= 9; count += 1) {
      mutated.logs.push({
        ...template,
        text: `🔥 【黄昏余命】史尔特尔#98 完成第 ${count}/8 次余命行动机会。`,
      });
    }
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-afterglow-overrun'),
      'The audit must reject a ninth afterglow opportunity',
    );
    cases.push('Fault injection detects Surtr afterglow exceeding eight opportunities');
  }

  {
    const mutated = cloneResult(surtrResult);
    const afterglowHit = mutated.logs.find((entry) =>
      entry.text.includes('【黄昏余命】史尔特尔 仍被本次攻击命中'),
    );
    assert(afterglowHit?.id, 'Surtr fault fixture requires a structured afterglow-hit log');
    const logEventIndex = mutated.events.findIndex((event) => event.id === afterglowHit.id);
    const targetId = afterglowHit.targetIds?.[0];
    const correspondingDamage = mutated.events
      .map((event, eventIndex) => ({ event, distance: Math.abs(eventIndex - logEventIndex) }))
      .filter(({ event }) =>
        event.kind === 'damage' &&
        event.actionId === afterglowHit.actionId &&
        !!event.damage &&
        (!afterglowHit.actorId || event.damage.attackerId === afterglowHit.actorId) &&
        (!targetId || event.damage.targetId === targetId || event.damage.actualTargetId === targetId),
      )
      .sort((left, right) => left.distance - right.distance)[0]?.event;
    assert(correspondingDamage?.damage, 'Afterglow fault fixture requires its corresponding damage record');
    correspondingDamage.damage.outcome = 'spell_blocked';
    assert(
      scanSurtrLogs(mutated).issues.some((issue) =>
        issue.type === 'surtr-afterglow-contradictory-context'),
      'The audit must reject an afterglow-hit log whose own damage record was blocked',
    );
    cases.push('Fault injection distinguishes blocked damage from a legal Surtr afterglow hit');
  }

  {
    const mutated = cloneResult(surtrResult);
    const template = mutated.logs.find((entry) => entry.text.includes('【共同击杀分账】'))
      ?? mutated.logs.find((entry) => entry.text.includes('【黄昏】'));
    assert(template, 'Surtr fixture must provide a structured log template');
    const split = {
      ...structuredClone(template),
      type: 'death',
      text: '🤝 【共同击杀分账】史尔特尔 的本次击杀由 牢鳄 +0.5、鸮 +0.5 共同获得。',
      rootEventId: 'fault-joint-kill-root',
    };
    mutated.logs.push(split, structuredClone(split));
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-joint-kill-split-repeated'),
      'The audit must reject duplicate joint-owner kill credit',
    );
    cases.push('Fault injection detects duplicate Surtr joint-kill settlement');
  }

  {
    const mutated = cloneResult(surtrResult);
    const action = firstSurtrAction(mutated);
    const surtr = mutated.fighterDirectory.find((fighter) => fighter.id === action.actorId);
    const ownerId = surtr?.surtrOwnerIds?.[0];
    assert(ownerId, 'Surtr fixture must expose an exact owner');
    action.targetIds = [ownerId];
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-targeted-exact-owner'),
      'The audit must reject Surtr targeting an exact owner outside Prophet control',
    );
    cases.push('Fault injection detects Surtr targeting an exact owner');
  }

  {
    const mutated = cloneResult(prophetResult);
    const damage = mutated.events.find((event) => event.kind === 'damage' && event.damage?.attackerId);
    const replacement = mutated.fighterDirectory.find((fighter) => fighter.id !== damage?.damage?.attackerId);
    assert(damage && replacement, 'Damage-attribution fault fixture is incomplete');
    damage.actorId = replacement.id;
    assert(
      causalIssueTypes(mutated).has('damage_actor_mismatch'),
      'The causal audit must reject a damage actor/attacker mismatch',
    );
    cases.push('Fault injection detects incorrect damage attribution');
  }

  {
    const mutated = cloneResult(prophetResult);
    const damage = mutated.events.find((event) => event.kind === 'damage' && event.damage?.targetId);
    const replacement = mutated.fighterDirectory.find((fighter) => fighter.id !== damage?.damage?.targetId);
    assert(damage && replacement, 'Damage-target metadata fault fixture is incomplete');
    damage.targetIds = [replacement.id];
    assert(
      causalIssueTypes(mutated).has('damage_target_mismatch'),
      'The causal audit must reject damage target metadata that names another fighter',
    );
    cases.push('Fault injection detects incorrect target metadata');
  }

  {
    const mutated = cloneResult(prophetResult);
    const template = mutated.logs.at(-1);
    assert(template, 'Internal-ID fault fixture requires a visible log template');
    mutated.logs.push({
      ...template,
      text: '【测试】泄漏 summon-4dd9ca34-aab1-4bea-83af-9ab61f58af21。',
      displayInFeed: true,
    });
    assert(
      auditFocusedBattle(mutated, { prophet: true, surtr: true }, 'fault-internal-id')
        .issues.some((issue) => issue.type === 'user-facing-uuid'),
      'The focused audit must reject an internal runtime ID in visible text',
    );
    cases.push('Fault injection detects internal runtime ID leakage');
  }

  {
    const mutated = cloneResult(prophetResult);
    const template = mutated.logs.at(-1);
    assert(template, 'Internal reaction-ID fault fixture requires a visible log template');
    mutated.logs.push({
      ...template,
      text: '【测试】错误显示 summon_ra_phoenix_reaction、chimera_install_reaction 与 joker_hell_return。',
      displayInFeed: true,
    });
    assert(
      auditFocusedBattle(mutated, { prophet: true, surtr: true }, 'fault-internal-reaction-id')
        .issues.some((issue) => issue.type === 'user-facing-internal-id'),
      'The focused audit must reject internal reaction action IDs in visible text',
    );
    cases.push('Fault injection detects internal reaction action-ID leakage');
  }

  {
    const mutated = cloneResult(prophetResult);
    const retreatIndex = mutated.logs.findIndex((entry) => entry.text.includes('【共同退场完成】'));
    const prophet = mutated.fighterDirectory.find((fighter) => fighter.isYuzuProphet);
    const template = mutated.logs.at(-1);
    assert(retreatIndex >= 0 && prophet && template, 'Ghost-action fixture requires a completed retreat');
    mutated.logs.push({
      ...template,
      type: 'skill',
      text: `【幽灵指令】${prophet.name} 在退场后继续行动。`,
      actorId: prophet.id,
      actorName: prophet.name,
      targetIds: [],
    });
    assert(
      auditYuzuProphetResult(mutated)
        .some((issue) => issue.kind === 'post-retreat-event-unit-log'),
      'The Prophet audit must reject a retired event unit acting again',
    );
    cases.push('Fault injection detects a retired Prophet ghost action');
  }

  {
    const mutated = cloneResult(prophetResult);
    const defeatIndex = mutated.events.findIndex((event) => event.kind === 'defeat');
    const defeat = mutated.events[defeatIndex];
    assert(defeatIndex >= 0 && defeat, 'Duplicate-defeat fault fixture requires a defeat event');
    mutated.events.slice(defeatIndex + 1).forEach((event) => {
      event.sequence += 1;
    });
    mutated.events.splice(defeatIndex + 1, 0, {
      ...structuredClone(defeat),
      id: 'fault-duplicate-defeat',
      sequence: defeat.sequence + 1,
    });
    assert(
      causalIssueTypes(mutated).has('duplicate_defeat_without_revive'),
      'The causal audit must reject duplicate death settlement',
    );
    cases.push('Fault injection detects duplicate death settlement');
  }

  {
    const controlledSurtr = runBattle({
      phase: 'audit-surtr-prophet-control',
      label: 'audit-surtr-prophet-control',
      names: [...FOCUSED_FIXTURE_ROSTER],
      seed: 3_500_000,
    }, {
      forceSurtr: true,
      forceYuzuProphet: true,
      maxTurns: 800,
      scanLogs: true,
    });
    assert(
      scanSurtrLogs(controlledSurtr).issues.every((issue) => issue.type !== 'surtr-targeted-exact-owner'),
      'Surtr may legally target former owners while Prophet control is active',
    );
    cases.push('Ownership audit distinguishes Prophet control from ordinary exact-owner protection');

    const mutated = cloneResult(controlledSurtr);
    const ownershipLog = mutated.logs.find((entry) =>
      entry.text.includes('史尔特尔') &&
      (entry.text.includes('【预言家接管】') || entry.text.includes('【控制权返还】')),
    );
    assert(ownershipLog, 'Owner-context fault fixture requires a Surtr control log');
    ownershipLog.text = ownershipLog.text.replace('共同主人', '原主人');
    assert(
      scanSurtrLogs(mutated).issues.some((issue) => issue.type === 'surtr-prophet-owner-context'),
      'The audit must reject a Surtr control log without full joint-owner context',
    );
    cases.push('Fault injection detects incomplete Surtr joint-owner context');
  }

  {
    const historicalDefeatCredit = cloneResult(prophetResult);
    const prophet = historicalDefeatCredit.fighterDirectory.find((fighter) =>
      fighter.isYuzuProphet,
    );
    const surtr = historicalDefeatCredit.fighterDirectory.find((fighter) =>
      fighter.isSurtr,
    );
    const retreatEndIndex = historicalDefeatCredit.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    assert(
      prophet && surtr && retreatEndIndex >= 0,
      'Historical defeat-credit audit fixture requires Prophet, Surtr and common retreat',
    );
    const template = historicalDefeatCredit.logs.at(-1);
    assert(template, 'Historical defeat-credit audit fixture requires a log template');
    historicalDefeatCredit.logs.push({
      ...template,
      id: 'audit-historical-surtr-defeat-credit',
      type: 'death',
      text: `🔥 【黄昏尽头】${surtr.name} 的余命耗尽；最初将其生命压至 0 的 ${prophet.name} 保留历史击败归属。`,
      actorId: prophet.id,
      actorName: prophet.name,
      targetIds: [surtr.id],
    });
    assert(
      auditYuzuProphetResult(historicalDefeatCredit)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Historical Surtr defeat credit must not be mistaken for a retired Prophet acting again',
    );
    cases.push('Audit distinguishes delayed Surtr defeat credit from a retired Prophet ghost action');
  }

  {
    const postRetreatJokerRedirect = runBattle({
      phase: 'audit-prophet-post-retreat-joker-redirect',
      label: 'audit-prophet-post-retreat-joker-redirect',
      names: [...NO_WATER],
      seed: 3_102_004,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatJokerRedirect.error && postRetreatJokerRedirect.ended,
      'Post-retreat Joker redirect audit fixture must finish',
    );
    const retreatEndIndex = postRetreatJokerRedirect.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const redirectLog = postRetreatJokerRedirect.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【随机恶作剧】'));
    assert(retreatEndIndex >= 0 && redirectLog, 'Fixture must redirect a later Yuzu hit after common retreat');
    const actor = postRetreatJokerRedirect.fighterDirectory.find((fighter) =>
      fighter.id === redirectLog.actorId,
    );
    const redirectedTargets = (redirectLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatJokerRedirect.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '屑' &&
      redirectedTargets.length === 1 &&
      redirectedTargets[0] &&
      redirectLog.text.includes(redirectedTargets[0].name),
      'Joker redirect metadata must identify Joker as actor and the actual redirected victim as target',
    );
    assert(
      auditYuzuProphetResult(postRetreatJokerRedirect)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'A legal post-retreat Joker redirect must not retain the retired Prophet as its structured target',
    );
    cases.push('Post-retreat Joker redirect metadata follows the actual actor and victim');
  }

  {
    const postRetreatOwlEar = runBattle({
      phase: 'audit-prophet-post-retreat-owl-ear',
      label: 'audit-prophet-post-retreat-owl-ear',
      names: [...NO_WATER],
      seed: 3_103_006,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlEar.error && postRetreatOwlEar.ended,
      'Post-retreat Owl ear audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlEar.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const earLog = postRetreatOwlEar.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【扎龙自己的耳朵！】'));
    assert(retreatEndIndex >= 0 && earLog, 'Fixture must trigger Owl ear after common retreat');
    const actor = postRetreatOwlEar.fighterDirectory.find((fighter) =>
      fighter.id === earLog.actorId,
    );
    const affected = (earLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatOwlEar.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.kind === 'summon:owl:emperor' &&
      affected.length === 1 &&
      affected[0]?.name === '鸮',
      'Owl ear metadata must identify Emperor as trigger and Owl as the affected unit',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlEar)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'A legal post-retreat Owl ear reaction must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Owl ear metadata follows Emperor and Owl');
  }

  {
    const postRetreatBlueEyesGuard = runBattle({
      phase: 'audit-prophet-post-retreat-blue-eyes-guard',
      label: 'audit-prophet-post-retreat-blue-eyes-guard',
      names: [...NO_WATER],
      seed: 3_102_010,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatBlueEyesGuard.error && postRetreatBlueEyesGuard.ended,
      'Post-retreat Blue-Eyes guard audit fixture must finish',
    );
    const retreatEndIndex = postRetreatBlueEyesGuard.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const guardLog = postRetreatBlueEyesGuard.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【白龙护主】'));
    assert(
      retreatEndIndex >= 0 && guardLog,
      'Fixture must trigger Blue-Eyes guard after common retreat',
    );
    const actor = postRetreatBlueEyesGuard.fighterDirectory.find((fighter) =>
      fighter.id === guardLog.actorId,
    );
    const guardedTargets = (guardLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatBlueEyesGuard.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      guardedTargets.length === 1 &&
      guardedTargets[0]?.kind === 'summon:青眼白龙',
      'Blue-Eyes guard metadata must identify Yuzu as attacker and Blue-Eyes as actual target',
    );
    assert(
      auditYuzuProphetResult(postRetreatBlueEyesGuard)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'A legal post-retreat Blue-Eyes guard must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Blue-Eyes guard metadata follows the actual guarded summon');
  }

  {
    const emoteDeathAttribution = runBattle({
      phase: 'audit-prophet-emote-death-attribution',
      label: 'audit-prophet-emote-death-attribution',
      names: [...NO_WATER],
      seed: 3_101_014,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !emoteDeathAttribution.error && emoteDeathAttribution.ended,
      'Emote death-attribution audit fixture must finish',
    );
    const retreatEndIndex = emoteDeathAttribution.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const adaptationLog = emoteDeathAttribution.logs.find((entry) =>
      entry.text.includes('【死亡适应】') &&
      entry.text.includes('复制并永久获得击杀者'),
    );
    assert(
      retreatEndIndex >= 0 && adaptationLog,
      'Fixture must complete common retreat and attribute an Emote death adaptation',
    );
    const actor = emoteDeathAttribution.fighterDirectory.find((fighter) =>
      fighter.id === adaptationLog.actorId,
    );
    const affected = (adaptationLog.targetIds ?? [])
      .map((targetId) =>
        emoteDeathAttribution.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      !!actor &&
      adaptationLog.text.includes(`被 ${actor.name} 击倒`) &&
      affected.length === 1 &&
      affected[0]?.name === '表情',
      'Emote death adaptation metadata must identify the killer and defeated Emote',
    );
    assert(
      auditYuzuProphetResult(emoteDeathAttribution)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Emote death settlement must not leave retired event-unit metadata after common retreat',
    );
    cases.push('Emote death adaptation metadata follows its actual participants');
  }

  {
    const postRetreatOwlRedirect = runBattle({
      phase: 'audit-prophet-post-retreat-owl-redirect',
      label: 'audit-prophet-post-retreat-owl-redirect',
      names: [...NO_WATER],
      seed: 3_100_021,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlRedirect.error && postRetreatOwlRedirect.ended,
      'Post-retreat Owl redirect audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlRedirect.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const redirectLog = postRetreatOwlRedirect.logs
      .slice(retreatEndIndex + 1)
      .find((entry) =>
        entry.text.includes('【帝王之征】') &&
        entry.text.includes('来袭伤害全部转给'),
      );
    assert(
      retreatEndIndex >= 0 && redirectLog,
      'Fixture must redirect a later Yuzu hit to Emperor after common retreat',
    );
    const actor = postRetreatOwlRedirect.fighterDirectory.find((fighter) =>
      fighter.id === redirectLog.actorId,
    );
    const redirectedTargets = (redirectLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatOwlRedirect.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      redirectedTargets.length === 1 &&
      redirectedTargets[0]?.kind === 'summon:owl:emperor',
      'Owl redirect metadata must identify the attacker and Emperor as actual damage recipient',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlRedirect)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Owl redirection must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Owl redirect metadata follows Emperor as damage recipient');
  }

  {
    const postRetreatCharmCounter = runBattle({
      phase: 'audit-prophet-post-retreat-charm-counter',
      label: 'audit-prophet-post-retreat-charm-counter',
      names: [...NO_WATER],
      seed: 3_101_032,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatCharmCounter.error && postRetreatCharmCounter.ended,
      'Post-retreat charm-counter audit fixture must finish',
    );
    const retreatEndIndex = postRetreatCharmCounter.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const rabbit = postRetreatCharmCounter.fighterDirectory.find((fighter) => fighter.name === '兔卷卷');
    const yuzu = postRetreatCharmCounter.fighterDirectory.find((fighter) => fighter.name === '柚子');
    const template = postRetreatCharmCounter.logs.at(-1);
    assert(
      retreatEndIndex >= 0 && rabbit && yuzu && template,
      'Fixture must provide common retreat plus Rabbit and Yuzu metadata',
    );
    const counterLog = {
      ...structuredClone(template),
      id: 'audit-post-retreat-rabbit-counter',
      rootEventId: 'audit-post-retreat-rabbit-counter-root',
      actionId: 'audit-post-retreat-rabbit-counter-action',
      type: 'skill',
      text: '😈 兔卷卷 受到 柚子 攻击时触发了【魅惑反击】！',
      actorId: rabbit.id,
      actorName: rabbit.name,
      targetIds: [yuzu.id],
    };
    postRetreatCharmCounter.logs.push(counterLog);
    const actor = postRetreatCharmCounter.fighterDirectory.find((fighter) =>
      fighter.id === counterLog.actorId,
    );
    const counterTargets = (counterLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatCharmCounter.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '兔卷卷' &&
      counterTargets.length === 1 &&
      counterTargets[0]?.name === '柚子',
      'Charm-counter metadata must identify Rabbit as counterattacker and Yuzu as target',
    );
    assert(
      auditYuzuProphetResult(postRetreatCharmCounter)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat charm counter must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat counter metadata follows counterattacker and attacker');
  }

  {
    const postRetreatOwlForm = runBattle({
      phase: 'audit-prophet-post-retreat-owl-form',
      label: 'audit-prophet-post-retreat-owl-form',
      names: [...NO_WATER],
      seed: 3_103_030,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlForm.error && postRetreatOwlForm.ended,
      'Post-retreat Owl-form audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlForm.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const formLog = postRetreatOwlForm.logs
      .slice(retreatEndIndex + 1)
      .find((entry) =>
        entry.text.includes('【天意侵蚀】') &&
        entry.text.includes('【骄兵】转入【败兵】'),
      );
    assert(
      retreatEndIndex >= 0 && formLog,
      'Fixture must move Owl from Pride to Defeat after common retreat',
    );
    const actor = postRetreatOwlForm.fighterDirectory.find((fighter) =>
      fighter.id === formLog.actorId,
    );
    assert(
      actor?.name === '鸮' &&
      formLog.targetIds?.length === 1 &&
      formLog.targetIds[0] === actor.id,
      'Owl form-transition metadata must identify Owl as actor and affected unit',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlForm)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Owl form transition must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Owl form-transition metadata follows Owl itself');
  }

  {
    const postRetreatMomoShare = runBattle({
      phase: 'audit-prophet-post-retreat-momo-share',
      label: 'audit-prophet-post-retreat-momo-share',
      names: [...NO_WATER],
      seed: 3_103_036,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatMomoShare.error && postRetreatMomoShare.ended,
      'Post-retreat Momo-share audit fixture must finish',
    );
    const retreatEndIndex = postRetreatMomoShare.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const shareLog = postRetreatMomoShare.logs
      .slice(retreatEndIndex + 1)
      .find((entry) =>
        entry.text.includes('【|OMO】萌月沫沫 将') &&
        entry.text.includes('均摊给'),
      );
    assert(
      retreatEndIndex >= 0 && shareLog,
      'Fixture must redirect a later Yuzu hit through Momo after common retreat',
    );
    const actor = postRetreatMomoShare.fighterDirectory.find((fighter) =>
      fighter.id === shareLog.actorId,
    );
    const sharedTargets = (shareLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatMomoShare.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '萌月沫沫' &&
      sharedTargets.length > 0 &&
      sharedTargets.every((fighter) => fighter && fighter.name !== '柚子·预言家'),
      'Momo-share metadata must identify Momo and the captains that receive damage',
    );
    assert(
      auditYuzuProphetResult(postRetreatMomoShare)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Momo sharing must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Momo-share metadata follows Momo and receiving captains');
  }

  {
    const postRetreatPuppetIntercept = runBattle({
      phase: 'audit-prophet-post-retreat-puppet-intercept',
      label: 'audit-prophet-post-retreat-puppet-intercept',
      names: [...NO_WATER],
      seed: 3_101_047,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatPuppetIntercept.error && postRetreatPuppetIntercept.ended,
      'Post-retreat puppet-intercept audit fixture must finish',
    );
    const retreatEndIndex = postRetreatPuppetIntercept.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const interceptLog = postRetreatPuppetIntercept.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【傀儡援护】'));
    assert(
      retreatEndIndex >= 0 && interceptLog,
      'Fixture must intercept a later Yuzu hit with Ting puppet after common retreat',
    );
    const actor = postRetreatPuppetIntercept.fighterDirectory.find((fighter) =>
      fighter.id === interceptLog.actorId,
    );
    const interceptTargets = (interceptLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatPuppetIntercept.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      interceptTargets.length === 1 &&
      interceptTargets[0]?.name === '小汀(傀儡)',
      'Puppet-intercept metadata must identify Yuzu and the puppet that receives the hit',
    );
    assert(
      auditYuzuProphetResult(postRetreatPuppetIntercept)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat puppet interception must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat puppet interception metadata follows the actual blocking puppet');
  }

  {
    const postRetreatCasCleanup = runBattle({
      phase: 'audit-prophet-post-retreat-cas-cleanup',
      label: 'audit-prophet-post-retreat-cas-cleanup',
      names: [...NO_WATER],
      seed: 3_101_049,
    }, {
      forceYuzuProphetUnboundPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatCasCleanup.error && postRetreatCasCleanup.ended,
      'Post-retreat CAS-cleanup audit fixture must finish',
    );
    const retreatEndIndex = postRetreatCasCleanup.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const cleanupLog = postRetreatCasCleanup.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('消耗了激光测距坐标'));
    assert(
      retreatEndIndex >= 0 && cleanupLog,
      'Fixture must consume M1 laser designation after common retreat',
    );
    const actor = postRetreatCasCleanup.fighterDirectory.find((fighter) =>
      fighter.id === cleanupLog.actorId,
    );
    assert(
      actor?.name === 'M1A2_abrams_sep' &&
      cleanupLog.targetIds?.length === 1 &&
      cleanupLog.targetIds[0] === actor.id,
      'CAS-cleanup metadata must identify M1 as actor and affected unit',
    );
    assert(
      auditYuzuProphetResult(postRetreatCasCleanup)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat CAS cleanup must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat CAS cleanup metadata follows M1 itself');
  }

  {
    const postRetreatYuzuMeal = runBattle({
      phase: 'audit-prophet-post-retreat-yuzu-meal',
      label: 'audit-prophet-post-retreat-yuzu-meal',
      names: [...NO_WATER],
      seed: 3_100_051,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatYuzuMeal.error && postRetreatYuzuMeal.ended,
      'Post-retreat Yuzu-meal audit fixture must finish',
    );
    const retreatEndIndex = postRetreatYuzuMeal.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const mealLog = postRetreatYuzuMeal.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【拼好饭】柚子'));
    assert(
      retreatEndIndex >= 0 && mealLog,
      'Fixture must draw Yuzu spoon after common retreat',
    );
    const actor = postRetreatYuzuMeal.fighterDirectory.find((fighter) =>
      fighter.id === mealLog.actorId,
    );
    assert(
      actor?.name === '柚子' &&
      mealLog.targetIds?.length === 1 &&
      mealLog.targetIds[0] === actor.id,
      'Yuzu meal metadata must identify Yuzu as actor and healing target',
    );
    assert(
      auditYuzuProphetResult(postRetreatYuzuMeal)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Yuzu meal must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Yuzu meal metadata follows Yuzu itself');
  }

  {
    const retreatDuringProphetCommand = runBattle({
      phase: 'audit-prophet-retreat-during-command',
      label: 'audit-prophet-retreat-during-command',
      names: [...NO_WATER],
      seed: 3_101_062,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !retreatDuringProphetCommand.error && retreatDuringProphetCommand.ended,
      'Prophet command-retreat audit fixture must finish',
    );
    const retreatEndIndex = retreatDuringProphetCommand.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    assert(
      retreatEndIndex >= 0 &&
      retreatDuringProphetCommand.logs
        .slice(Math.max(0, retreatEndIndex - 12), retreatEndIndex)
        .some((entry) =>
          entry.text.includes('【烈焰魔剑】') &&
          entry.text.includes('普瑞赛斯的源石映像'),
        ),
      'Fixture must retreat while resolving a Prophet-controlled Surtr command',
    );
    assert(
      !retreatDuringProphetCommand.logs
        .slice(retreatEndIndex + 1)
        .some((entry) => entry.text.includes('【我将击碎·未爆发】')),
      'Prophet must not append a failed-shatter summary after common retreat',
    );
    assert(
      auditYuzuProphetResult(retreatDuringProphetCommand)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'A command interrupted by common retreat must not emit a retired Prophet tail log',
    );
    cases.push('Common retreat terminates Prophet command summaries immediately');
  }

  {
    const postRetreatOwlStatusResist = runBattle({
      phase: 'audit-prophet-post-retreat-owl-status-resist',
      label: 'audit-prophet-post-retreat-owl-status-resist',
      names: [...NO_WATER],
      seed: 3_102_064,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlStatusResist.error && postRetreatOwlStatusResist.ended,
      'Post-retreat Owl status-resistance audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlStatusResist.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const resistanceLog = postRetreatOwlStatusResist.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【败兵抗性】'));
    assert(
      retreatEndIndex >= 0 && resistanceLog,
      'Fixture must resist a Yuzu weapon status after common retreat',
    );
    const actor = postRetreatOwlStatusResist.fighterDirectory.find((fighter) =>
      fighter.id === resistanceLog.actorId,
    );
    const resistedTargets = (resistanceLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatOwlStatusResist.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      resistedTargets.length === 1 &&
      resistedTargets[0]?.name === '鸮',
      'Owl status-resistance metadata must identify Yuzu as applier and Owl as target',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlStatusResist)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Owl status resistance must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat status-resistance metadata follows applier and actual target');
  }

  {
    const postRetreatOwlInheritance = runBattle({
      phase: 'audit-prophet-post-retreat-owl-inheritance',
      label: 'audit-prophet-post-retreat-owl-inheritance',
      names: [...NO_WATER],
      seed: 3_102_076,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlInheritance.error && postRetreatOwlInheritance.ended,
      'Post-retreat Owl-inheritance audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlInheritance.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const inheritanceLog = postRetreatOwlInheritance.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【不可能！】'));
    assert(
      retreatEndIndex >= 0 && inheritanceLog,
      'Fixture must let Owl inherit from a later summon death after common retreat',
    );
    const actor = postRetreatOwlInheritance.fighterDirectory.find((fighter) =>
      fighter.id === inheritanceLog.actorId,
    );
    const inheritedFrom = (inheritanceLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatOwlInheritance.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '鸮' &&
      inheritedFrom.length === 1 &&
      inheritedFrom[0]?.name === '史瓦罗',
      'Owl inheritance metadata must identify Owl and the fallen unit it inherits from',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlInheritance)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Owl inheritance must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat Owl inheritance metadata follows Owl and the fallen unit');
  }

  {
    const postRetreatSpalterLock = runBattle({
      phase: 'audit-prophet-post-retreat-spalter-lock',
      label: 'audit-prophet-post-retreat-spalter-lock',
      names: [...NO_WATER],
      seed: 3_101_086,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatSpalterLock.error && postRetreatSpalterLock.ended,
      'Post-retreat Spalter-lock audit fixture must finish',
    );
    const retreatEndIndex = postRetreatSpalterLock.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const lockLog = postRetreatSpalterLock.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【濒死锁血】归溟幽灵鲨'));
    assert(
      retreatEndIndex >= 0 && lockLog,
      'Fixture must trigger Spalter lockblood after common retreat',
    );
    const actor = postRetreatSpalterLock.fighterDirectory.find((fighter) =>
      fighter.id === lockLog.actorId,
    );
    const lockedTargets = (lockLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatSpalterLock.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      lockedTargets.length === 1 &&
      lockedTargets[0]?.name === '归溟幽灵鲨',
      'Deferred lockblood metadata must preserve attacker and actual target from queue time',
    );
    assert(
      auditYuzuProphetResult(postRetreatSpalterLock)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Post-retreat Spalter lockblood must not retain the retired Prophet as its target',
    );
    cases.push('Deferred damage logs preserve queue-time attacker and actual target');
  }

  {
    const postRetreatRaSelfHeal = runBattle({
      phase: 'audit-prophet-post-retreat-ra-self-heal',
      label: 'audit-prophet-post-retreat-ra-self-heal',
      names: [...NO_WATER],
      seed: 3_100_085,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatRaSelfHeal.error && postRetreatRaSelfHeal.ended,
      'Post-retreat Ra self-heal audit fixture must finish',
    );
    const retreatEndIndex = postRetreatRaSelfHeal.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const healLog = postRetreatRaSelfHeal.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('翼神龙 吸收太阳神火'));
    assert(
      retreatEndIndex >= 0 && healLog,
      'Fixture must preserve Ra self-healing after defeating the Prophet',
    );
    const actor = postRetreatRaSelfHeal.fighterDirectory.find((fighter) =>
      fighter.id === healLog.actorId,
    );
    const healedTargets = (healLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatRaSelfHeal.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '翼神龙' &&
      healedTargets.length === 1 &&
      healedTargets[0]?.id === actor.id,
      'Ra self-heal metadata must identify Ra as both actor and healed target',
    );
    assert(
      auditYuzuProphetResult(postRetreatRaSelfHeal)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Ra self-healing after common retreat must not retain the retired Prophet as its target',
    );
    cases.push('Ra post-retreat self-heal metadata stays on Ra');
  }

  {
    const postRetreatRainbowRecovery = runBattle({
      phase: 'audit-prophet-post-retreat-rainbow-recovery',
      label: 'audit-prophet-post-retreat-rainbow-recovery',
      names: [...NO_WATER],
      seed: 3_100_088,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatRainbowRecovery.error && postRetreatRainbowRecovery.ended,
      'Post-retreat Rainbow Fever recovery audit fixture must finish',
    );
    const retreatEndIndex = postRetreatRainbowRecovery.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const recoveryLog = postRetreatRainbowRecovery.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【彩虹狂热】彩虹炼金余波回流'));
    assert(
      retreatEndIndex >= 0 && recoveryLog,
      'Fixture must preserve Rainbow Fever recovery after defeating the Prophet',
    );
    const actor = postRetreatRainbowRecovery.fighterDirectory.find((fighter) =>
      fighter.id === recoveryLog.actorId,
    );
    const recoveredTargets = (recoveryLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatRainbowRecovery.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '刺猬人' &&
      recoveredTargets.length === 1 &&
      recoveredTargets[0]?.id === actor.id,
      'Rainbow Fever recovery metadata must identify Hedgehog Man as actor and recipient',
    );
    assert(
      auditYuzuProphetResult(postRetreatRainbowRecovery)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Rainbow Fever recovery after common retreat must not retain the retired Prophet as target',
    );
    cases.push('Rainbow Fever post-retreat recovery metadata stays on its user');
  }

  {
    const postRetreatLifesteal = runBattle({
      phase: 'audit-prophet-post-retreat-lifesteal',
      label: 'audit-prophet-post-retreat-lifesteal',
      names: [...NO_WATER],
      seed: 3_103_093,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatLifesteal.error && postRetreatLifesteal.ended,
      'Post-retreat lifesteal audit fixture must finish',
    );
    const retreatEndIndex = postRetreatLifesteal.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const lifestealLog = postRetreatLifesteal.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('兔卷卷 触发吸血被动'));
    assert(
      retreatEndIndex >= 0 && lifestealLog,
      'Fixture must preserve Rabbit lifesteal after defeating the Prophet',
    );
    const actor = postRetreatLifesteal.fighterDirectory.find((fighter) =>
      fighter.id === lifestealLog.actorId,
    );
    const healedTargets = (lifestealLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatLifesteal.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '兔卷卷' &&
      healedTargets.length === 1 &&
      healedTargets[0]?.id === actor.id,
      'Lifesteal metadata must identify the attacker as its own healing recipient',
    );
    assert(
      auditYuzuProphetResult(postRetreatLifesteal)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Lifesteal after common retreat must not retain the retired Prophet as its target',
    );
    cases.push('Post-retreat lifesteal metadata stays on its healing attacker');
  }

  {
    const postRetreatUltimateDragonStrain = runBattle({
      phase: 'audit-prophet-post-retreat-ultimate-dragon-strain',
      label: 'audit-prophet-post-retreat-ultimate-dragon-strain',
      names: [...NO_WATER],
      seed: 3_101_124,
    }, {
      forceYuzuProphetUnboundPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatUltimateDragonStrain.error && postRetreatUltimateDragonStrain.ended,
      'Post-retreat Ultimate Dragon strain audit fixture must finish',
    );
    const retreatEndIndex = postRetreatUltimateDragonStrain.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const template = postRetreatUltimateDragonStrain.logs.at(-1);
    assert(
      retreatEndIndex >= 0 && template,
      'Fixture must provide common retreat and a structured log template',
    );
    const dragon = {
      id: 'audit-post-retreat-ultimate-dragon',
      name: '青眼究极龙',
      kind: 'summon:青眼究极龙',
      isNpc: false,
      isSummon: true,
      isSurtr: false,
      isYuzuProphet: false,
      isYuzu: false,
    };
    postRetreatUltimateDragonStrain.fighterDirectory.push(dragon);
    const strainLog = {
      ...structuredClone(template),
      id: 'audit-post-retreat-ultimate-dragon-strain',
      rootEventId: 'audit-post-retreat-ultimate-dragon-strain-root',
      actionId: 'audit-post-retreat-ultimate-dragon-strain-action',
      type: 'info',
      text: '🐲 【融合不稳定】青眼究极龙 的融合负荷加重，损失 100 点生命。',
      actorId: dragon.id,
      actorName: dragon.name,
      targetIds: [dragon.id],
    };
    postRetreatUltimateDragonStrain.logs.push(strainLog);
    const actor = postRetreatUltimateDragonStrain.fighterDirectory.find((fighter) =>
      fighter.id === strainLog.actorId,
    );
    const affectedTargets = (strainLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatUltimateDragonStrain.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '青眼究极龙' &&
      affectedTargets.length === 1 &&
      affectedTargets[0]?.id === actor.id,
      'Ultimate Dragon strain metadata must identify the dragon as its own affected target',
    );
    assert(
      auditYuzuProphetResult(postRetreatUltimateDragonStrain)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Ultimate Dragon strain after common retreat must not retain the retired Prophet as target',
    );
    cases.push('Ultimate Dragon post-retreat strain metadata stays on the dragon');
  }

  {
    const postRetreatGamerMastery = runBattle({
      phase: 'audit-prophet-post-retreat-gamer-mastery',
      label: 'audit-prophet-post-retreat-gamer-mastery',
      names: [...NO_WATER],
      seed: 3_102_130,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatGamerMastery.error && postRetreatGamerMastery.ended,
      'Post-retreat Gamer mastery audit fixture must finish',
    );
    const retreatEndIndex = postRetreatGamerMastery.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    let masteryLog = postRetreatGamerMastery.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【跨平台精通】玄凝'));
    if (!masteryLog && retreatEndIndex >= 0) {
      const gamer = postRetreatGamerMastery.fighterDirectory.find((fighter) => fighter.name === '玄凝');
      const template = postRetreatGamerMastery.logs.at(-1);
      assert(gamer && template, 'Gamer metadata fixture requires Xuan Ning and a log template');
      masteryLog = {
        ...structuredClone(template),
        id: 'audit-post-retreat-gamer-mastery',
        rootEventId: 'audit-post-retreat-gamer-mastery-root',
        actionId: 'audit-post-retreat-gamer-mastery-action',
        type: 'buff',
        text: '🎮 【跨平台精通】玄凝 完成一次精通轮换。',
        actorId: gamer.id,
        actorName: gamer.name,
        targetIds: [gamer.id],
      };
      postRetreatGamerMastery.logs.push(masteryLog);
    }
    assert(
      retreatEndIndex >= 0 && masteryLog,
      'Fixture must preserve Gamer mastery after defeating the Prophet',
    );
    const actor = postRetreatGamerMastery.fighterDirectory.find((fighter) =>
      fighter.id === masteryLog.actorId,
    );
    const affectedTargets = (masteryLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatGamerMastery.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '玄凝' &&
      affectedTargets.length === 1 &&
      affectedTargets[0]?.id === actor.id,
      'Gamer mastery metadata must identify Xuan Ning as its own affected target',
    );
    assert(
      auditYuzuProphetResult(postRetreatGamerMastery)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Gamer mastery after common retreat must not retain the retired Prophet as target',
    );
    cases.push('Gamer post-retreat mastery metadata stays on Xuan Ning');
  }

  {
    const postRetreatOwlOpening = runBattle({
      phase: 'audit-prophet-post-retreat-owl-opening',
      label: 'audit-prophet-post-retreat-owl-opening',
      names: [...NO_WATER],
      seed: 3_101_152,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatOwlOpening.error && postRetreatOwlOpening.ended,
      'Post-retreat Owl-opening audit fixture must finish',
    );
    const retreatEndIndex = postRetreatOwlOpening.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const openingLog = postRetreatOwlOpening.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【乘风失衡】表情'));
    assert(
      retreatEndIndex >= 0 && openingLog,
      'Fixture must consume Emote Owl-opening after defeating the Prophet',
    );
    const actor = postRetreatOwlOpening.fighterDirectory.find((fighter) =>
      fighter.id === openingLog.actorId,
    );
    const affectedTargets = (openingLog.targetIds ?? [])
      .map((targetId) =>
        postRetreatOwlOpening.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '柚子' &&
      affectedTargets.length === 1 &&
      affectedTargets[0]?.name === '表情',
      'Owl-opening metadata must identify Yuzu as actor and Emote as affected target',
    );
    assert(
      auditYuzuProphetResult(postRetreatOwlOpening)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Owl-opening after common retreat must not retain the retired Prophet as target',
    );
    cases.push('Post-retreat Owl-opening metadata follows attacker and affected target');
  }

  {
    const postRetreatWaitCounter = runBattle({
      phase: 'audit-prophet-post-retreat-wait-counter',
      label: 'audit-prophet-post-retreat-wait-counter',
      names: [...NO_WATER],
      seed: 3_101_257,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatWaitCounter.error && postRetreatWaitCounter.ended,
      'Post-retreat wait-counter audit fixture must finish',
    );
    const retreatEndIndex = postRetreatWaitCounter.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const counterLogs = postRetreatWaitCounter.logs
      .slice(retreatEndIndex + 1)
      .filter((entry) =>
        entry.text.includes('【神兵追捕】即将命中 刺猬人') ||
        entry.text.includes('柚子 的攻势被 刺猬人 的怪兽形态打断') ||
        entry.text.includes('【镜界追击】刺猬人'),
      );
    assert(
      retreatEndIndex >= 0 && counterLogs.length === 2 &&
      counterLogs.every((entry) => !entry.text.includes('【镜界追击】')),
      'An interrupted Yuzu attack must keep the counter context without claiming a follow-up combo',
    );
    assert(
      counterLogs.every((entry) => {
        const actor = postRetreatWaitCounter.fighterDirectory.find((fighter) =>
          fighter.id === entry.actorId,
        );
        const targets = (entry.targetIds ?? [])
          .map((targetId) =>
            postRetreatWaitCounter.fighterDirectory.find((fighter) => fighter.id === targetId),
          );
        return actor?.name === '柚子' && targets.length === 1 && targets[0]?.name === '刺猬人';
      }),
      'Wait-counter interaction metadata must identify Yuzu attacking Hedgehog Man',
    );
    assert(
      auditYuzuProphetResult(postRetreatWaitCounter)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Wait-counter logs after common retreat must not retain the retired Prophet as target',
    );
    cases.push('Post-retreat wait counter suppresses false Yuzu follow-up narration');
  }

  {
    const interruptedProphetBranch = runBattle({
      phase: 'audit-prophet-interrupted-damage-branch',
      label: 'audit-prophet-interrupted-damage-branch',
      names: [...NO_WATER],
      seed: 3_101_311,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !interruptedProphetBranch.error && interruptedProphetBranch.ended,
      'Interrupted Prophet damage-branch audit fixture must finish',
    );
    const retreatEndIndex = interruptedProphetBranch.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const ghostSettlement = interruptedProphetBranch.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【普瑞赛斯，我理解你结算】'));
    assert(
      retreatEndIndex >= 0 && !ghostSettlement,
      'Prophet branch must not append status settlement after its counter-triggered retreat',
    );
    assert(
      auditYuzuProphetResult(interruptedProphetBranch)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Interrupted Prophet branch must not emit any retired event-unit logs',
    );
    cases.push('Counter-triggered Prophet retreat stops branch settlement immediately');
  }

  {
    const resistedWeakCounter = runBattle({
      phase: 'audit-prophet-resisted-weak-counter',
      label: 'audit-prophet-resisted-weak-counter',
      names: [...NO_WATER],
      seed: 3_102_368,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !resistedWeakCounter.error && resistedWeakCounter.ended,
      'Resisted weak-counter audit fixture must finish',
    );
    const triggerIndex = resistedWeakCounter.logs.findIndex((entry) =>
      entry.text.includes('触发了【虚弱反击】'),
    );
    const outcomeIndex = resistedWeakCounter.logs.findIndex((entry, index) =>
      index > triggerIndex &&
      entry.text.includes('【虚弱反击】') &&
      entry.text.includes('防护机制拒绝'),
    );
    assert(
      triggerIndex >= 0 && outcomeIndex > triggerIndex && outcomeIndex <= triggerIndex + 3,
      'Rejected weak counter must emit an explicit outcome immediately after its trigger',
    );
    assert(
      resistedWeakCounter.logIssues
        .every((issue) => issue.type !== 'counter-trigger-without-outcome'),
      'Rejected weak counter must satisfy the causal log scanner',
    );
    assert(
      auditYuzuProphetResult(resistedWeakCounter).length === 0,
      'Rejected weak-counter fixture must remain clean under the Prophet audit',
    );
    cases.push('Resisted weak counter emits an explicit no-effect outcome');
  }

  {
    const jokerReviveClock = runBattle({
      phase: 'audit-prophet-joker-revive-clock',
      label: 'audit-prophet-joker-revive-clock',
      names: [...NO_WATER],
      seed: 3_100_531,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !jokerReviveClock.error && jokerReviveClock.ended,
      'Joker revive-clock audit fixture must finish',
    );
    const countdownLog = jokerReviveClock.logs.find((entry) =>
      entry.text.includes('返场倒计时'),
    );
    assert(
      countdownLog,
      'Joker revive-clock fixture must emit its countdown log',
    );
    const countdownActor = jokerReviveClock.fighterDirectory.find((fighter) =>
      fighter.id === countdownLog.actorId,
    );
    assert(
      countdownActor?.name === '屑' &&
      countdownLog.targetIds?.length === 1 &&
      countdownLog.targetIds[0] === countdownActor.id,
      'Joker countdown metadata must identify Joker as its own affected target',
    );
    assert(
      auditYuzuProphetResult(jokerReviveClock)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Joker countdown after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Joker revive countdown metadata stays on Joker');
  }

  {
    const postRetreatWomboSummary = runBattle({
      phase: 'audit-prophet-post-retreat-wombo-summary',
      label: 'audit-prophet-post-retreat-wombo-summary',
      names: [...NO_WATER],
      seed: 3_102_767,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !postRetreatWomboSummary.error && postRetreatWomboSummary.ended,
      'Post-retreat Wombo Combo summary fixture must finish',
    );
    const retreatEndIndex = postRetreatWomboSummary.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    let summaryLog = postRetreatWomboSummary.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【Wombo Combo】玄凝'));
    if (!summaryLog && retreatEndIndex >= 0) {
      const gamer = postRetreatWomboSummary.fighterDirectory.find((fighter) => fighter.name === '玄凝');
      const target = postRetreatWomboSummary.fighterDirectory.find((fighter) =>
        !fighter.isNpc && !fighter.isYuzuProphet && fighter.id !== gamer?.id,
      );
      const template = postRetreatWomboSummary.logs.at(-1);
      assert(gamer && target && template, 'Wombo metadata fixture requires Xuan Ning, a player target, and a log template');
      summaryLog = {
        ...structuredClone(template),
        id: 'audit-post-retreat-wombo-summary',
        rootEventId: 'audit-post-retreat-wombo-summary-root',
        actionId: 'audit-post-retreat-wombo-summary-action',
        type: 'skill',
        text: `🥊 【Wombo Combo】玄凝 完成连段，命中 ${target.name}。`,
        actorId: gamer.id,
        actorName: gamer.name,
        targetIds: [target.id],
      };
      postRetreatWomboSummary.logs.push(summaryLog);
    }
    assert(
      retreatEndIndex >= 0 && summaryLog,
      'Fixture must preserve Wombo Combo aggregate summary after Prophet retreat',
    );
    const retiredEventIds = new Set(
      postRetreatWomboSummary.fighterDirectory
        .filter((fighter) =>
          fighter.isYuzuProphet ||
          fighter.kind === 'npc:puruisaishi' ||
          fighter.kind === 'npc:originium_core' ||
          fighter.kind === 'npc:originium_crystal',
        )
        .map((fighter) => fighter.id),
    );
    assert(
      (summaryLog.targetIds ?? []).every((targetId) => !retiredEventIds.has(targetId)),
      'Wombo Combo aggregate summary must exclude event NPCs already removed by common retreat',
    );
    assert(
      auditYuzuProphetResult(postRetreatWomboSummary)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Wombo Combo aggregate summary must not retain retired event-unit metadata',
    );
    cases.push('Post-retreat Wombo Combo summary excludes retired event units');
  }

  {
    const owlEmperorMourning = runBattle({
      phase: 'audit-prophet-owl-emperor-mourning',
      label: 'audit-prophet-owl-emperor-mourning',
      names: [...NO_WATER],
      seed: 3_100_777,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !owlEmperorMourning.error && owlEmperorMourning.ended,
      'Owl Emperor mourning audit fixture must finish',
    );
    const mourningLog = owlEmperorMourning.logs.find((entry) =>
      entry.text.includes('不是我害了你，是这乱世害了你'),
    );
    assert(mourningLog, 'Fixture must contain Owl mourning the defeated Emperor');
    const actor = owlEmperorMourning.fighterDirectory.find((fighter) =>
      fighter.id === mourningLog.actorId,
    );
    const targets = (mourningLog.targetIds ?? [])
      .map((targetId) =>
        owlEmperorMourning.fighterDirectory.find((fighter) => fighter.id === targetId),
      );
    assert(
      actor?.name === '鸮' &&
      targets.length === 1 &&
      targets[0]?.kind === 'summon:owl:emperor',
      'Owl mourning metadata must identify Owl as speaker and the defeated Emperor as target',
    );
    assert(
      auditYuzuProphetResult(owlEmperorMourning)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Owl mourning after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Owl Emperor mourning metadata follows Owl and the defeated summon');
  }

  {
    const jokerHellReturn = runBattle({
      phase: 'audit-prophet-joker-hell-return',
      label: 'audit-prophet-joker-hell-return',
      names: [...NO_WATER],
      seed: 3_107_278,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !jokerHellReturn.error && jokerHellReturn.ended,
      'Joker Hell Return audit fixture must finish',
    );
    const retreatEndIndex = jokerHellReturn.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const outcomeLogs = jokerHellReturn.logs
      .slice(retreatEndIndex + 1)
      .filter((entry) =>
        entry.text.includes('地狱笑话命中') ||
        entry.text.includes('【谢幕返场结算】') ||
        entry.text.includes('被地狱笑话扰乱'),
      );
    assert(
      retreatEndIndex >= 0 && outcomeLogs.length > 0,
      'Fixture must continue legitimate Hell Return target settlement after common retreat',
    );
    assert(
      outcomeLogs.every((entry) => {
        const actor = jokerHellReturn.fighterDirectory.find((fighter) =>
          fighter.id === entry.actorId,
        );
        return actor?.name === '屑' && entry.targetIds?.length === 1;
      }),
      'Each Hell Return target outcome must identify Joker and only its current victim',
    );
    assert(
      auditYuzuProphetResult(jokerHellReturn)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Hell Return target settlement must not retain event units retired mid-AOE',
    );
    cases.push('Joker Hell Return target logs shed retired mid-AOE targets');
  }

  {
    const yuzuBarrierBarrage = runBattle({
      phase: 'audit-yuzu-barrier-barrage-order',
      label: 'audit-yuzu-barrier-barrage-order',
      names: [...NO_WATER],
      seed: 3_107_389,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !yuzuBarrierBarrage.error && yuzuBarrierBarrage.ended,
      'Yuzu barrier barrage-order audit fixture must finish',
    );
    const transformIndex = yuzuBarrierBarrage.logs.findIndex((entry) =>
      entry.text.includes('【苦痛啊，你是我的唯一】') &&
      entry.text.includes('个人战护盾被击碎'),
    );
    const firstSegmentIndex = yuzuBarrierBarrage.logs.findIndex((entry) =>
      entry.text.includes('【弹幕共鸣】第 1/6 段命中结算') &&
      entry.text.includes('护盾完整吸收'),
    );
    const secondSegmentIndex = yuzuBarrierBarrage.logs.findIndex((entry, index) =>
      index > firstSegmentIndex &&
      entry.text.includes('【弹幕共鸣】第 2/6 段命中'),
    );
    assert(
      firstSegmentIndex >= 0 &&
      transformIndex === firstSegmentIndex + 1 &&
      secondSegmentIndex > transformIndex,
      'Shielded first barrage segment must be logged before Yuzu transforms and before segment two',
    );
    assert(
      yuzuBarrierBarrage.logIssues
        .every((issue) => issue.type !== 'transform-before-hit-result'),
      'Yuzu barrier break during barrage must satisfy transformation log ordering',
    );
    cases.push('Yuzu barrier-break transformation follows the responsible barrage segment');
  }

  {
    const owlDefeatQuote = runBattle({
      phase: 'audit-prophet-owl-defeat-quote',
      label: 'audit-prophet-owl-defeat-quote',
      names: [...NO_WATER],
      seed: 3_106_744,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !owlDefeatQuote.error && owlDefeatQuote.ended,
      'Owl defeat-quote audit fixture must finish',
    );
    const quote = owlDefeatQuote.logs.find((entry) =>
      entry.text.includes('死是凉爽的夏夜，可供人无忧的安眠'),
    );
    assert(quote, 'Fixture must contain Owl defeat quote');
    const actor = owlDefeatQuote.fighterDirectory.find((fighter) =>
      fighter.id === quote.actorId,
    );
    assert(
      actor?.name === '鸮' &&
      quote.targetIds?.length === 1 &&
      quote.targetIds[0] === actor.id,
      'Owl defeat quote metadata must identify Owl as its own speaker and subject',
    );
    assert(
      auditYuzuProphetResult(owlDefeatQuote)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Owl defeat quote after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Owl defeat quote metadata stays on Owl');
  }

  {
    const momoPartnerExit = runBattle({
      phase: 'audit-prophet-momo-partner-exit',
      label: 'audit-prophet-momo-partner-exit',
      names: [...NO_WATER],
      seed: 3_110_074,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !momoPartnerExit.error && momoPartnerExit.ended,
      'Momo partner-exit audit fixture must finish',
    );
    const partnerExit = momoPartnerExit.logs.find((entry) =>
      entry.text.includes('【队友退场】牢鳄') &&
      entry.text.includes('萌月沫沫'),
    );
    const soloSettlement = momoPartnerExit.logs.find((entry) =>
      entry.text.includes('【随机组队】萌月沫沫 的认主次数已用尽') &&
      entry.text.includes('独自继续战斗'),
    );
    assert(
      partnerExit && soloSettlement,
      'Fixture must contain Momo partner exit and solo settlement',
    );
    const momo = momoPartnerExit.fighterDirectory.find((fighter) =>
      fighter.name === '萌月沫沫',
    );
    const laoE = momoPartnerExit.fighterDirectory.find((fighter) =>
      fighter.name === '牢鳄',
    );
    assert(
      momo &&
      laoE &&
      partnerExit.actorId === momo.id &&
      partnerExit.targetIds?.length === 1 &&
      partnerExit.targetIds[0] === laoE.id &&
      soloSettlement.actorId === momo.id &&
      soloSettlement.targetIds?.length === 1 &&
      soloSettlement.targetIds[0] === momo.id,
      'Momo partner-exit metadata must follow Momo, the fallen partner and final solo settlement',
    );
    assert(
      auditYuzuProphetResult(momoPartnerExit)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Momo partner exit after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Momo partner-exit metadata follows its actual relationship change');
  }

  {
    const historicalStatusExpiry = runBattle({
      phase: 'audit-prophet-historical-status-expiry',
      label: 'audit-prophet-historical-status-expiry',
      names: [...NO_WATER],
      seed: 3_108_514,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !historicalStatusExpiry.error && historicalStatusExpiry.ended,
      'Historical status-expiry audit fixture must finish',
    );
    const expiry = historicalStatusExpiry.logs.find((entry) =>
      entry.text.includes('【状态变化】帝王之征 的【震颤】') &&
      entry.text.includes('来自 柚子·预言家 的一份效果自然结束'),
    );
    assert(expiry, 'Fixture must retain the historical Prophet status source in its expiry text');
    const affected = historicalStatusExpiry.fighterDirectory.find((fighter) =>
      fighter.id === expiry.actorId,
    );
    assert(
      affected?.kind === 'summon:owl:emperor' &&
      expiry.targetIds?.length === 1 &&
      expiry.targetIds[0] === affected.id,
      'Natural status expiry metadata must identify the currently affected fighter, not its retired historical source',
    );
    assert(
      auditYuzuProphetResult(historicalStatusExpiry)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Historical status attribution must not be mistaken for a retired Prophet acting again',
    );
    cases.push('Status expiry distinguishes an affected unit from its retired historical source');
  }

  {
    const tokusatsuDeferredDispel = runBattle({
      phase: 'audit-prophet-tokusatsu-deferred-dispel',
      label: 'audit-prophet-tokusatsu-deferred-dispel',
      names: [...NO_WATER],
      seed: 3_111_934,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
    });
    assert(
      !tokusatsuDeferredDispel.error && tokusatsuDeferredDispel.ended,
      'Tokusatsu deferred-dispel audit fixture must finish',
    );
    const dispel = tokusatsuDeferredDispel.logs.find((entry) =>
      entry.text.includes('【强驱散】刺猬人 移除了【中毒】'),
    );
    assert(dispel, 'Fixture must contain Hedgehog Man strong dispel during transformation');
    const hedgehog = tokusatsuDeferredDispel.fighterDirectory.find((fighter) =>
      fighter.name === '刺猬人',
    );
    assert(
      hedgehog &&
      dispel.actorId === hedgehog.id &&
      dispel.targetIds?.length === 1 &&
      dispel.targetIds[0] === hedgehog.id,
      'Deferred dispel metadata must remain attached to the affected fighter',
    );
    assert(
      auditYuzuProphetResult(tokusatsuDeferredDispel)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Deferred self-dispel after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Deferred transformation dispel metadata stays on its affected fighter');
  }

  {
    const momoRiderKickProgress = runBattle({
      phase: 'audit-prophet-momo-rider-kick-progress',
      label: 'audit-prophet-momo-rider-kick-progress',
      names: [...NO_WATER],
      seed: 3_113_022,
    }, {
      forceYuzuProphetUnboundPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !momoRiderKickProgress.error && momoRiderKickProgress.ended,
      'Momo rider-kick progress audit fixture must finish',
    );
    const progress = momoRiderKickProgress.logs.find((entry) =>
      entry.text.includes('【骑士踢计数】萌月沫沫 使用【345！！！！！】') &&
      (entry.sequence ?? -1) > (
        momoRiderKickProgress.logs.find((candidate) =>
          candidate.text.includes('【共同退场完成】'),
        )?.sequence ?? Number.MAX_SAFE_INTEGER
      ),
    );
    assert(progress, 'Fixture must contain Momo rider-kick progress after common retreat');
    const momo = momoRiderKickProgress.fighterDirectory.find((fighter) =>
      fighter.name === '萌月沫沫',
    );
    assert(
      momo &&
      progress.actorId === momo.id &&
      progress.targetIds?.length === 1 &&
      progress.targetIds[0] === momo.id,
      'Momo rider-kick progress metadata must identify Momo and never retain a retired target',
    );
    assert(
      auditYuzuProphetResult(momoRiderKickProgress)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Momo rider-kick progress after common retreat must not retain retired event-unit metadata',
    );
    cases.push('Momo rider-kick progress metadata stays on Momo');
  }

  {
    const tingSpinalSwordDrop = runBattle({
      phase: 'audit-prophet-ting-spinal-sword-drop',
      label: 'audit-prophet-ting-spinal-sword-drop',
      names: [...NO_WATER],
      seed: 3_112_477,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !tingSpinalSwordDrop.error && tingSpinalSwordDrop.ended,
      'Ting spinal-sword drop audit fixture must finish',
    );
    const drop = tingSpinalSwordDrop.logs.find((entry) =>
      entry.text.includes('【脊髓剑遗留】小汀'),
    );
    assert(drop, 'Fixture must contain Ting leaving the spinal sword behind');
    const ting = tingSpinalSwordDrop.fighterDirectory.find((fighter) =>
      fighter.name === '小汀',
    );
    assert(
      ting &&
      drop.actorId === ting.id &&
      drop.targetIds?.length === 1 &&
      drop.targetIds[0] === ting.id,
      'Ting spinal-sword drop metadata must identify Ting as the actor and subject',
    );
    assert(
      auditYuzuProphetResult(tingSpinalSwordDrop)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Ting spinal-sword drop after common retreat must not retain a retired event-unit target',
    );
    cases.push('Ting spinal-sword drop metadata stays on Ting');
  }

  {
    const duplicateSurtrProphetControl = runBattle({
      phase: 'audit-duplicate-surtr-prophet-control',
      label: 'audit-duplicate-surtr-prophet-control',
      names: [...NO_WATER],
      seed: 3_300_227,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'afterglow',
      maxTurns: 1600,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !duplicateSurtrProphetControl.error && duplicateSurtrProphetControl.ended,
      'Duplicate-Surtr Prophet-control audit fixture must finish',
    );
    const surtrs = duplicateSurtrProphetControl.fighterDirectory.filter((fighter) =>
      fighter.isSurtr,
    );
    assert(
      surtrs.some((fighter) => fighter.name === '史尔特尔') &&
      surtrs.some((fighter) => fighter.name === '史尔特尔#2'),
      'Fixture must contain two independently identifiable Surtr summons',
    );
    assert(
      duplicateSurtrProphetControl.logs.some((entry) =>
        entry.text.includes('【预言家接管】') &&
        entry.text.includes('史尔特尔#2'),
      ),
      'Fixture must contain Prophet control of the second Surtr',
    );
    assert(
      scanSurtrLogs(duplicateSurtrProphetControl).issues
        .every((issue) => issue.type !== 'surtr-targeted-exact-owner'),
      'A second Surtr under Prophet control may target former owners without being confused with the first Surtr',
    );
    cases.push('Surtr ownership audit distinguishes duplicate summon display names by exact fighter ID');
  }

  {
    const momoAwakenedSword = runBattle({
      phase: 'audit-prophet-momo-awakened-sword',
      label: 'audit-prophet-momo-awakened-sword',
      names: [...SPECIALS],
      seed: 3_201_381,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 1600,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !momoAwakenedSword.error && momoAwakenedSword.ended,
      'Momo awakened-sword audit fixture must finish',
    );
    const momo = momoAwakenedSword.fighterDirectory.find((fighter) =>
      fighter.name === '萌月沫沫',
    );
    assert(momo, 'Fixture must contain Momo');
    const auditMomo = makeFighter('萌月沫沫@A');
    auditMomo.id = momo.id;
    const swordLogs: BattleResult['logs'] = [];
    const swordEngine = makeEngine([auditMomo], swordLogs);
    ensureMomoAwakenedSword(swordEngine.createMomoRuntime(), swordEngine.fighters[0]);
    const sword = swordLogs.find((entry) => entry.text.includes('【way？！】萌月沫沫'));
    assert(sword, 'Direct awakened-sword fixture must produce the way?! log');
    assert(
      sword.actorId === momo.id &&
      sword.targetIds?.length === 1 &&
      sword.targetIds[0] === momo.id,
      'Momo awakened-sword metadata must identify Momo as the actor and subject',
    );
    const retreatEndIndex = momoAwakenedSword.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    assert(retreatEndIndex >= 0, 'Momo metadata fixture must contain common retreat');
    momoAwakenedSword.logs.push(sword);
    assert(
      auditYuzuProphetResult(momoAwakenedSword)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'Momo awakened sword after common retreat must not retain a retired event-unit target',
    );
    cases.push('Momo awakened-sword metadata stays on Momo after transformation');
  }

  {
    const redirectedRetreatStateSync = runBattle({
      phase: 'audit-prophet-redirected-retreat-state-sync',
      label: 'audit-prophet-redirected-retreat-state-sync',
      names: [...NO_WATER],
      seed: 3_500_703,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'twilight',
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !redirectedRetreatStateSync.error && redirectedRetreatStateSync.ended,
      'Redirected Prophet retreat state-sync fixture must finish',
    );
    const retreatEndIndex = redirectedRetreatStateSync.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const prophet = redirectedRetreatStateSync.fighterDirectory.find((fighter) =>
      fighter.isYuzuProphet,
    );
    const hiddenStateSync = redirectedRetreatStateSync.logs
      .slice(retreatEndIndex + 1)
      .find((entry) =>
        entry.displayInFeed === false &&
        entry.type === 'system' &&
        entry.text.startsWith('state-sync:') &&
        entry.actorId === prophet?.id,
      );
    assert(
      retreatEndIndex >= 0 && prophet && hiddenStateSync,
      'Fixture must retain the hidden causal state-sync that closes the redirected retreat action',
    );
    assert(
      auditYuzuProphetResult(redirectedRetreatStateSync)
        .every((issue) => issue.kind !== 'post-retreat-event-unit-log'),
      'A hidden state-sync may close the retreating action without becoming a retired-unit ghost log',
    );

    const visibleGhost = cloneResult(redirectedRetreatStateSync);
    const lastSequence = visibleGhost.logs.reduce(
      (maximum, entry) => Math.max(maximum, entry.sequence ?? 0),
      0,
    );
    visibleGhost.logs.push({
      ...hiddenStateSync,
      id: 'audit-visible-retired-prophet-action',
      sequence: lastSequence + 1,
      type: 'skill',
      text: '🧪 【审计故障注入】柚子·预言家退场后再次发动技能。',
      displayInFeed: true,
    });
    assert(
      auditYuzuProphetResult(visibleGhost)
        .some((issue) => issue.kind === 'post-retreat-event-unit-log'),
      'The audit must still reject a visible action emitted by a retired Prophet',
    );
    cases.push('Audit distinguishes hidden state synchronization from visible retired-unit actions');
  }

  {
    const commandInterruptedByRetreat = runBattle({
      phase: 'audit-prophet-controlled-release-retreat',
      label: 'audit-prophet-controlled-release-retreat',
      names: [
        '水人@A',
        '玄凝@A',
        '丝瓜uli@A',
        '屑@B',
        'M1A2_abrams_sep@B',
        '柚子@B',
      ],
      seed: 7_005_270,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !commandInterruptedByRetreat.error && commandInterruptedByRetreat.ended,
      'Controlled-release retreat fixture must finish',
    );
    const retreatEndIndex = commandInterruptedByRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const preRetreatCommandHit = commandInterruptedByRetreat.logs
      .slice(0, retreatEndIndex)
      .some((entry) => entry.text.includes('【接管指令命中】史尔特尔'));
    const postRetreat = commandInterruptedByRetreat.logs.slice(retreatEndIndex + 1);
    assert(
      retreatEndIndex >= 0 && preRetreatCommandHit,
      'Fixture must complete at least one controlled Surtr hit before common retreat',
    );
    assert(
      postRetreat.every((entry) =>
        !entry.text.includes('【接管指令命中】史尔特尔') &&
        !(
          entry.text.includes('【震颤】') &&
          entry.text.includes('柚子·预言家')
        )
      ),
      'Common retreat must cancel command-hit tremor and logs that had not settled yet',
    );
    assert(
      auditYuzuProphetResult(commandInterruptedByRetreat).length === 0,
      'Controlled-release retreat fixture must be clean under the Prophet audit',
    );
    cases.push('Common retreat interrupts pending controlled-release status settlement');
  }

  {
    const summonDiesAfterConnectedHit = runBattle({
      phase: 'audit-prophet-connected-summon-death',
      label: 'audit-prophet-connected-summon-death',
      names: [...NO_WATER],
      seed: 3_102_520,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !summonDiesAfterConnectedHit.error && summonDiesAfterConnectedHit.ended,
      'Connected summon-death fixture must finish',
    );
    const conversionIndex = summonDiesAfterConnectedHit.logs.findIndex((entry) =>
      entry.text.includes('【接管召唤物死亡转化】幽灵鲨'),
    );
    const retainedHitIndex = summonDiesAfterConnectedHit.logs.findIndex((entry, index) =>
      index > conversionIndex &&
      entry.text.includes('【接管指令命中】幽灵鲨') &&
      entry.text.includes('牢鳄'),
    );
    assert(
      conversionIndex >= 0 &&
      retainedHitIndex > conversionIndex &&
      summonDiesAfterConnectedHit.logs
        .slice(conversionIndex + 1, retainedHitIndex)
        .every((entry) => !entry.text.includes('【共同退场完成】')),
      'A summon killed by retaliation after connecting must retain its legal command-hit tremor while the event continues',
    );
    assert(
      auditYuzuProphetResult(summonDiesAfterConnectedHit).length === 0,
      'Connected summon-death fixture must remain clean under the Prophet audit',
    );
    cases.push('A connected summon hit keeps its tremor even when retaliation kills the summon');
  }

  {
    const crossingRedistribution = runBattle({
      phase: 'prophet-3v3',
      label: 'prophet-3v3-水人+玄凝+表情-vs-柚子+鸮+萌月沫沫',
      names: [
        '水人@A',
        '玄凝@A',
        '表情@A',
        '柚子@B',
        '鸮@B',
        '萌月沫沫@B',
      ],
      seed: 7_012_524,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !crossingRedistribution.error && crossingRedistribution.ended,
      'Crossing redistribution playback fixture must finish',
    );
    const yuzu = crossingRedistribution.fighterDirectory.find((fighter) => fighter.name === '柚子');
    const crossingDamage = crossingRedistribution.events.find((event) =>
      event.kind === 'damage' &&
      event.damage?.actionName === '过江协同' &&
      event.damage.targetId === yuzu?.id &&
      event.damage.shieldDamage > 0 &&
      event.damage.outcome === 'redistributed',
    );
    const stateSync = crossingRedistribution.events.find((event) =>
      !!crossingDamage &&
      event.sequence > crossingDamage.sequence &&
      event.rootEventId === crossingDamage.rootEventId &&
      event.actionId === crossingDamage.actionId &&
      event.displayInFeed === false &&
      event.text === `state-sync:${yuzu?.id}`,
    );
    assert(
      yuzu && crossingDamage && stateSync,
      'Crossing redistribution must publish a playback checkpoint after its structured damage event',
    );
    assert(
      !causalIssueTypes(crossingRedistribution).has('damage_without_following_snapshot_commit'),
      'The causal audit must accept the completed Crossing redistribution snapshot chain',
    );
    cases.push('Seed 7012524 commits Crossing redistribution before the assist action ends');
  }

  {
    const lightningRetreat = runBattle({
      phase: 'prophet-3v3',
      label: 'prophet-3v3-水人+牢鳄+柚子-vs-玄凝+克蕾儿丝菲尔+鸮',
      names: [
        '水人@A',
        '牢鳄@A',
        '柚子@A',
        '玄凝@B',
        '克蕾儿丝菲尔@B',
        '鸮@B',
      ],
      seed: 7_049_755,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !lightningRetreat.error && lightningRetreat.ended,
      'Owl-lightning retreat fixture must finish',
    );
    const retreatEndIndex = lightningRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const owl = lightningRetreat.fighterDirectory.find((fighter) => fighter.name === '鸮');
    const prophet = lightningRetreat.fighterDirectory.find((fighter) => fighter.isYuzuProphet);
    const legitimatePostRetreatHits = lightningRetreat.logs
      .slice(retreatEndIndex + 1)
      .filter((entry) => entry.text.includes('雷击命中'));
    const postRetreatTargetNames = legitimatePostRetreatHits
      .map((entry) => lightningRetreat.fighterDirectory.find((fighter) =>
        fighter.id === entry.targetIds?.[0],
      )?.name)
      .filter((name): name is string => !!name);
    assert(
      retreatEndIndex >= 0 &&
      owl &&
      prophet &&
      postRetreatTargetNames.includes('青眼白龙') &&
      postRetreatTargetNames.filter((name) => name.startsWith('蛐蛐')).length >= 2,
      'Fixture must continue lightning against Blue-Eyes and both crickets after event-unit retreat',
    );
    legitimatePostRetreatHits.forEach((entry) => {
      const target = lightningRetreat.fighterDirectory.find((fighter) =>
        fighter.id === entry.targetIds?.[0],
      );
      assert(
        entry.actorId === owl.id &&
        entry.targetIds?.length === 1 &&
        !!target &&
        entry.text.includes(target.name) &&
        !target.isYuzuProphet &&
        target.kind !== 'npc:puruisaishi' &&
        target.kind !== 'npc:originium_core' &&
        target.kind !== 'npc:originium_crystal',
        `Each post-retreat lightning result must identify only its surviving target: ${entry.text}`,
      );
    });
    const retreatQuote = lightningRetreat.logs.find((entry) =>
      entry.text.includes('【文明尽头的约定】'),
    );
    const retreatComplete = lightningRetreat.logs[retreatEndIndex];
    assert(
      retreatQuote?.actorId === prophet.id && retreatComplete?.actorId === prophet.id,
      'Retreat quote and completion must remain attributed to Yuzu Prophet inside a nested AOE',
    );
    assert(
      auditYuzuProphetResult(lightningRetreat).length === 0,
      'Legitimate surviving-target lightning must not be reported as a retired event-unit ghost',
    );
    cases.push('Seed 7049755 keeps nested lightning and common-retreat metadata target-accurate');
  }

  {
    const pendingControlledDeathAtRetreat = runBattle({
      phase: 'prophet-3v3',
      label: 'prophet-3v3-克蕾儿丝菲尔+柚子+鸮-vs-水人+刺猬人+萌月沫沫',
      names: [
        '克蕾儿丝菲尔@A',
        '柚子@A',
        '鸮@A',
        '水人@B',
        '刺猬人@B',
        '萌月沫沫@B',
      ],
      seed: 7_566_153,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !pendingControlledDeathAtRetreat.error && pendingControlledDeathAtRetreat.ended,
      'Pending controlled-death retreat fixture must finish',
    );
    const retreatStartIndex = pendingControlledDeathAtRetreat.logs.findIndex((entry) =>
      entry.text.includes('【预言家共同退场启动】'),
    );
    const specterReturnIndex = pendingControlledDeathAtRetreat.logs.findIndex((entry) =>
      entry.text.includes('【控制权返还】幽灵鲨'),
    );
    const retreatEndIndex = pendingControlledDeathAtRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const specterDefeatIndex = pendingControlledDeathAtRetreat.logs.findIndex((entry) =>
      entry.text.includes('【黑气斩波】幽灵鲨 被 刺猬人'),
    );
    assert(
      retreatStartIndex >= 0 &&
      specterReturnIndex > retreatStartIndex &&
      retreatEndIndex > specterReturnIndex &&
      specterDefeatIndex > retreatEndIndex,
      'A controlled summon with pending lethal damage must return before its formal defeat settles',
    );
    const controlledEntries = pendingControlledDeathAtRetreat.logs.filter((entry) =>
      entry.text.includes('【预言家接管】') || entry.text.includes('【预言家保底召唤】'),
    ).length;
    const controlledTerminals = pendingControlledDeathAtRetreat.logs.filter((entry) =>
      entry.text.includes('【接管召唤物死亡转化】') ||
      entry.text.includes('【阶段抹杀】') ||
      entry.text.includes('【控制权返还】') ||
      entry.text.includes('【保底召唤退场】'),
    ).length;
    assert(
      controlledEntries === 5 && controlledTerminals === controlledEntries,
      `Every controlled summon must have one terminal outcome: entries=${controlledEntries}, terminals=${controlledTerminals}`,
    );
    assert(
      pendingControlledDeathAtRetreat.logs.every((entry) =>
        !entry.text.includes('【接管召唤物死亡转化】幽灵鲨'),
      ),
      'The returned pending-death summon must not be converted into Originium after event retreat',
    );
    assert(
      auditYuzuProphetResult(pendingControlledDeathAtRetreat).length === 0,
      'Pending controlled-death retreat fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 7566153 settles pending controlled ownership before formal defeat');
  }

  {
    const cricketSelfDestructAfterRetreat = runBattle({
      phase: 'prophet-3v3',
      label: 'prophet-3v3-小汀+牢鳄+柚子-vs-M1A2_abrams_sep+鸮+萌月沫沫',
      names: [
        '小汀@A',
        '牢鳄@A',
        '柚子@A',
        'M1A2_abrams_sep@B',
        '鸮@B',
        '萌月沫沫@B',
      ],
      seed: 7_301_258,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !cricketSelfDestructAfterRetreat.error && cricketSelfDestructAfterRetreat.ended,
      'Post-retreat cricket self-destruct fixture must finish',
    );
    const retreatEndIndex = cricketSelfDestructAfterRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const prophetIds = new Set(
      cricketSelfDestructAfterRetreat.fighterDirectory
        .filter((fighter) =>
          fighter.isYuzuProphet ||
          fighter.kind === 'npc:puruisaishi' ||
          fighter.kind === 'npc:originium_core' ||
          fighter.kind === 'npc:originium_crystal',
        )
        .map((fighter) => fighter.id),
    );
    const selfDestructLogs = cricketSelfDestructAfterRetreat.logs
      .slice(retreatEndIndex + 1)
      .filter((entry) =>
        entry.text.includes('【自刎归天】') || entry.text.includes('【有情有义】'),
      );
    assert(
      retreatEndIndex >= 0 && selfDestructLogs.length >= 6,
      'Fixture must trigger both cricket self-destruct branches after common retreat',
    );
    selfDestructLogs.forEach((entry) => {
      const actor = entry.actorId
        ? cricketSelfDestructAfterRetreat.fighterDirectory.find((fighter) => fighter.id === entry.actorId)
        : undefined;
      if (entry.type === 'death') {
        assert(
          entry.targetIds?.length === 1 &&
          cricketSelfDestructAfterRetreat.fighterDirectory.find((fighter) =>
            fighter.id === entry.targetIds?.[0],
          )?.kind === 'summon:owl:cricket',
          `Cricket defeat metadata must identify the self-destructing cricket: ${entry.text}`,
        );
        return;
      }
      assert(
        actor?.kind === 'summon:owl:cricket' &&
        entry.targetIds?.length === 1 &&
        !prophetIds.has(entry.targetIds[0]!),
        `Cricket self-destruct metadata must identify the cricket and its live target: ${entry.text}`,
      );
    });
    assert(
      auditYuzuProphetResult(cricketSelfDestructAfterRetreat).length === 0,
      'Legitimate cricket self-destructs after retreat must not retain retired event metadata',
    );
    cases.push('Seed 7301258 keeps post-retreat cricket self-destruct metadata target-accurate');
  }

  {
    const ra = makeFighter('牢鳄');
    const yuzu = makeFighter('柚子');
    const ally = makeFighter('玄凝');
    ra.name = '翼神龙';
    ra.displayName = '翼神龙';
    ra.summonBaseName = '翼神龙';
    ra.isSummon = true;
    ra.isAdvancedSummon = true;
    ra.teamId = 'ra-side';
    ra.atk = 500;
    ra.mag = 700;
    yuzu.teamId = 'yuzu-side';
    ally.teamId = 'yuzu-side';
    grantYuzuShield(yuzu, 120, 'ra-phoenix-playback-fixture', '回归测试护盾');
    applyStatus(ra, {
      identityId: GACHA_RA_PHOENIX_STATUS,
      attribution: { effectSourceId: GACHA_RA_PHOENIX_STATUS },
    });
    const logs: Parameters<typeof makeEngine>[1] = [];
    const engine = makeEngine([ra, yuzu, ally], logs);
    const triggered = engine.triggerRaPhoenix(ra, {
      actionName: '神不死鸟回归测试',
      respectDefenses: true,
    });
    const phoenixDamage = engine.events.find((event) =>
      event.kind === 'damage' &&
      event.damage?.actionName === '神不死鸟' &&
      event.damage.targetId === yuzu.id &&
      event.damage.shieldDamage > 0 &&
      event.damage.outcome === 'redistributed',
    );
    const stateSync = engine.events.find((event) =>
      !!phoenixDamage &&
      event.sequence > phoenixDamage.sequence &&
      event.rootEventId === phoenixDamage.rootEventId &&
      event.actionId === phoenixDamage.actionId &&
      event.displayInFeed === false &&
      event.text === `state-sync:${yuzu.id}`,
    );
    const causalIssues: CausalAuditIssue[] = [];
    auditBattleEvents(engine.events, 0, 8_311_488, 'ra-phoenix-redistribution', causalIssues);
    assert(
      triggered && phoenixDamage && stateSync,
      'Ra Phoenix must publish a playback checkpoint after shield-consuming Yuzu redistribution',
    );
    assert(
      causalIssues.every((issue) => issue.type !== 'damage_without_following_snapshot_commit'),
      'The causal audit must accept the completed Ra Phoenix redistribution snapshot chain',
    );
    cases.push('Ra Phoenix deterministically commits Yuzu redistribution before the reaction ends');
  }

  {
    const postRetreatWarThunderKill = runBattle({
      phase: 'prophet-4v4',
      label: 'prophet-4v4-水人+克蕾儿丝菲尔+丝瓜uli+M1A2_abrams_sep-vs-牢鳄+兔卷卷+柚子+萌月沫沫',
      names: [
        '水人@A',
        '克蕾儿丝菲尔@A',
        '丝瓜uli@A',
        'M1A2_abrams_sep@A',
        '牢鳄@B',
        '兔卷卷@B',
        '柚子@B',
        '萌月沫沫@B',
      ],
      seed: 8_558_899,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !postRetreatWarThunderKill.error && postRetreatWarThunderKill.ended,
      'Post-retreat War Thunder kill metadata fixture must finish',
    );
    const retreatEndIndex = postRetreatWarThunderKill.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const yuzu = postRetreatWarThunderKill.fighterDirectory.find((fighter) =>
      fighter.name === '柚子' && !fighter.isYuzuProphet,
    );
    const m1 = postRetreatWarThunderKill.fighterDirectory.find((fighter) =>
      fighter.name === 'M1A2_abrams_sep',
    );
    const killReward = postRetreatWarThunderKill.logs
      .slice(retreatEndIndex + 1)
      .find((entry) => entry.text.includes('【战雷击杀收益】') && entry.text.includes('击毁 柚子'));
    assert(
      retreatEndIndex >= 0 && yuzu && m1 && killReward,
      'Fixture must kill the regular Yuzu after the Prophet event common retreat',
    );
    assert(
      killReward.actorId === m1.id &&
      killReward.targetIds?.length === 1 &&
      killReward.targetIds[0] === yuzu.id,
      'War Thunder kill reward metadata must identify only M1 and the defeated regular Yuzu',
    );
    assert(
      auditYuzuProphetResult(postRetreatWarThunderKill).length === 0,
      'A legal post-retreat kill of the regular Yuzu must not be mistaken for an event-unit ghost log',
    );
    cases.push('Seed 8558899 keeps post-retreat War Thunder kill reward metadata victim-accurate');
  }

  {
    const casSinkingDefeat = runBattle({
      phase: 'prophet-4v4',
      label: 'prophet-4v4-水人+屑+M1A2_abrams_sep+表情-vs-玄凝+丝瓜uli+柚子+萌月沫沫',
      names: [
        '水人@A',
        '屑@A',
        'M1A2_abrams_sep@A',
        '表情@A',
        '玄凝@B',
        '丝瓜uli@B',
        '柚子@B',
        '萌月沫沫@B',
      ],
      seed: 8_912_051,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !casSinkingDefeat.error && casSinkingDefeat.ended,
      'CAS sinking-defeat ordering fixture must finish',
    );
    const directHitIndex = casSinkingDefeat.logs.findIndex((entry) =>
      entry.text.includes('爆风余波波及！源石结晶#10 承受了 335 点真实伤害！'),
    );
    const sinkingIndex = casSinkingDefeat.logs.findIndex((entry, index) =>
      index > directHitIndex &&
      entry.text.includes('【沉沦】源石结晶#10') &&
      entry.text.includes('实际损失 1 点生命'),
    );
    const defeatIndex = casSinkingDefeat.logs.findIndex((entry, index) =>
      index > sinkingIndex && entry.text.includes('源石结晶#10 被【沉沦】的后续伤害击倒'),
    );
    const falseControlLog = casSinkingDefeat.logs
      .slice(Math.max(0, directHitIndex), defeatIndex + 1)
      .some((entry) =>
        entry.text.includes('源石结晶#10') &&
        (entry.text.includes('并被【火力压制】') || entry.text.includes('源石结晶#10 的【火力压制】')),
      );
    assert(
      directHitIndex >= 0 && sinkingIndex > directHitIndex && defeatIndex > sinkingIndex,
      'CAS must report direct damage before sinking aftermath defeats the Originium crystal',
    );
    assert(!falseControlLog, 'A crystal defeated by sinking aftermath must not be described as receiving suppression');
    assert(
      casSinkingDefeat.logIssues.every((issue) => issue.type !== 'dead-fighter-mentioned-as-target'),
      'CAS sinking aftermath must satisfy the dead-target causal log scanner',
    );
    cases.push('Seed 8912051 orders CAS damage before lethal sinking and skips corpse control');
  }

  {
    const postRetreatSinking = runBattle({
      phase: 'prophet-with-water',
      label: 'prophet-with-water-2745',
      names: [...SPECIALS],
      seed: 3_202_745,
    }, {
      forceYuzuProphet: true,
      maxTurns: 1600,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !postRetreatSinking.error && postRetreatSinking.ended,
      'Post-retreat sinking metadata fixture must finish',
    );
    const retreatEndIndex = postRetreatSinking.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const gacha = postRetreatSinking.fighterDirectory.find((fighter) => fighter.name === '牢鳄');
    const m1 = postRetreatSinking.fighterDirectory.find((fighter) => fighter.name === 'M1A2_abrams_sep');
    assert(
      retreatEndIndex >= 0 && gacha && m1,
      'Historical sinking audit fixture must complete common retreat with M1 and Gacha present',
    );
    const historicalSinking = cloneResult(postRetreatSinking);
    const lastSequence = historicalSinking.logs.reduce(
      (maximum, entry) => Math.max(maximum, entry.sequence ?? 0),
      0,
    );
    historicalSinking.logs.push({
      id: 'audit-post-retreat-historical-sinking',
      sequence: lastSequence + 1,
      type: 'debuff',
      text: '🌊 【沉沦】牢鳄 遭受精神冲击（历史来源：你不该存在于此地 · 柚子·预言家）。',
      actorId: m1.id,
      actorName: m1.name,
      targetIds: [gacha.id],
      turn: postRetreatSinking.turns,
      displayInFeed: true,
    });
    assert(
      auditYuzuProphetResult(historicalSinking).length === 0,
      'Historical Prophet status on Gacha must not be mistaken for a retired event-unit action',
    );
    cases.push('Historical Prophet sinking remains attributable to its current M1 trigger after common retreat');
  }

  {
    const surtr = makeFighter('史尔特尔@接管方');
    const firstTarget = makeFighter('玄凝@原主人方');
    const gachaOwner = makeFighter('牢鳄@原主人方');
    const replacementTarget = makeFighter('刺猬人@第三方');
    surtr.isSurtr = true;
    surtr.isSummon = true;
    surtr.surtrState = {
      primaryOwnerId: gachaOwner.id,
      primaryOwnerTeamId: '原主人方',
      twilightUsed: false,
      twilightDrainOpportunities: 0,
      afterglowActive: false,
      afterglowOpportunities: 0,
      actualKills: 0,
      ownershipSuspended: true,
      lastAffiliationMode: 'suspended',
    };
    const fighters = [surtr, firstTarget, gachaOwner, replacementTarget];
    const teamIds = new Map([
      [surtr.id, '接管方'],
      [firstTarget.id, '原主人方'],
      [gachaOwner.id, '原主人方'],
      [replacementTarget.id, '第三方'],
    ]);
    const childTargets: string[] = [];
    const logs: Array<{
      text: string;
      metadata?: BattleLogMetadata;
    }> = [];
    const context = {
      user: surtr,
      target: firstTarget,
      fighters,
      currentTargets: [firstTarget, gachaOwner, replacementTarget],
      turnCount: 0,
      largeRound: 1,
      battleState: createBattleState(34_007_168),
      getTeamId: (fighter: Fighter) => teamIds.get(fighter.id) ?? fighter.id,
      setVisualTargets: () => undefined,
      log: (_type: string, text: string, metadata?: BattleLogMetadata) => logs.push({ text, metadata }),
      triggerDepth: 0,
      executeSkillAction: (_skillId: string | null, _user: Fighter, target: Fighter | null) => {
        assert(target, 'Every Molten Shadow child hit must resolve a target');
        childTargets.push(target.id);
        if (childTargets.length === 1) {
          surtr.surtrState!.ownershipSuspended = false;
          surtr.surtrState!.lastAffiliationMode = 'primary_side';
        }
      },
    } as unknown as SkillContext;
    const moltenShadow = surtrSkills.surtr_molten_shadow;
    assert(moltenShadow?.onExecute, 'Molten Shadow must expose its custom multi-target executor');
    withRandomSequence([0.99, 0.99, 0], () => moltenShadow.onExecute!(context));

    const retargetLog = logs.find((entry) =>
      entry.text.includes('【熔核巨影·目标重校】') &&
      entry.text.includes('牢鳄 已不再是合法目标') &&
      entry.text.includes('改为追击 刺猬人'),
    );
    assert(
      childTargets.length === 2 &&
      childTargets[0] === firstTarget.id &&
      childTargets[1] === replacementTarget.id &&
      !childTargets.includes(gachaOwner.id),
      'Molten Shadow must revalidate a queued owner target after control returns between impacts',
    );
    assert(
      retargetLog?.metadata?.targetIds?.length === 1 &&
      retargetLog.metadata.targetIds[0] === replacementTarget.id,
      'The retarget explanation must name only the legal replacement target',
    );
    cases.push('Molten Shadow revalidates a queued impact after common-owner control returns');
  }

  {
    const distinctDamagePaths = cloneResult(surtrResult);
    const redirectedHit = distinctDamagePaths.logs.find((entry) =>
      entry.text.includes('【黄昏余命】史尔特尔 仍被本次攻击命中'),
    );
    assert(redirectedHit?.id && redirectedHit.actionId, 'Surtr fixture must expose a structured afterglow hit');
    const redirectedLogEventIndex = distinctDamagePaths.events.findIndex((event) =>
      event.id === redirectedHit.id,
    );
    const redirectedDamageEvent = distinctDamagePaths.events
      .map((event, eventIndex) => ({ event, distance: Math.abs(eventIndex - redirectedLogEventIndex) }))
      .filter(({ event }) =>
        event.kind === 'damage' &&
        event.actionId === redirectedHit.actionId &&
        event.damage?.outcome === 'prevented' &&
        (!redirectedHit.actorId || event.damage.attackerId === redirectedHit.actorId) &&
        (!redirectedHit.targetIds?.[0] ||
          event.damage.targetId === redirectedHit.targetIds[0] ||
          event.damage.actualTargetId === redirectedHit.targetIds[0]),
      )
      .sort((left, right) => left.distance - right.distance)[0]?.event;
    assert(redirectedDamageEvent?.damage, 'Surtr fixture must expose the prevented damage behind its afterglow hit');
    const alternateActor = distinctDamagePaths.fighterDirectory.find((fighter) =>
      fighter.id !== redirectedDamageEvent.damage?.attackerId &&
      fighter.id !== redirectedHit.targetIds?.[0],
    );
    assert(alternateActor, 'Surtr fixture must expose a second attacker for the parallel damage path');

    const directBlockDamage = structuredClone(redirectedDamageEvent);
    assert(directBlockDamage.damage, 'Parallel damage fixture must retain its structured damage record');
    directBlockDamage.id = 'regression-parallel-direct-block-damage';
    directBlockDamage.actorId = alternateActor.id;
    directBlockDamage.actorName = alternateActor.name;
    directBlockDamage.damage.attackerId = alternateActor.id;
    directBlockDamage.damage.outcome = 'spell_blocked';
    directBlockDamage.damage.hpDamage = 0;
    directBlockDamage.damage.shieldDamage = 0;
    directBlockDamage.damage.overkillDamage = 0;

    const directBlockLog = structuredClone(redirectedHit);
    directBlockLog.id = 'regression-parallel-direct-block-log';
    directBlockLog.actorId = alternateActor.id;
    directBlockLog.actorName = alternateActor.name;
    directBlockLog.text = '🌑 黑气余波被 史尔特尔 化解，没有造成生命伤害！';
    distinctDamagePaths.events.push(directBlockDamage, {
      ...directBlockDamage,
      id: directBlockLog.id,
      kind: 'log',
      visible: true,
      type: directBlockLog.type,
      text: directBlockLog.text,
      damage: undefined,
    });
    distinctDamagePaths.logs.push(directBlockLog);

    assert(
      scanSurtrLogs(distinctDamagePaths).issues.every((issue) =>
        issue.type !== 'surtr-afterglow-contradictory-context'),
      'Distinct damage paths in one action must not be collapsed into a contradictory afterglow result',
    );
    cases.push('Structured fixture separates a blocked direct path from a redirected Surtr afterglow hit');
  }

  {
    const chainedCricketExplosion = runBattle({
      phase: 'surtr-2v2',
      label: 'surtr-2v2-丝瓜uli+鸮-vs-牢鳄+萌月沫沫',
      names: ['丝瓜uli@A', '鸮@A', '牢鳄@B', '萌月沫沫@B'],
      seed: 21_009_176,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'normal',
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    const afterglowLog = chainedCricketExplosion.logs.find((entry) =>
      entry.text.includes('【黄昏余命】史尔特尔 仍被本次攻击命中') &&
      entry.actorName === '蛐蛐#2',
    );
    const afterglowEventIndex = chainedCricketExplosion.events.findIndex((event) =>
      event.id === afterglowLog?.id,
    );
    const correspondingDamageIndex = chainedCricketExplosion.events.findIndex((event) =>
      event.kind === 'damage' &&
      event.actionId === afterglowLog?.actionId &&
      event.damage?.attackerId === afterglowLog?.actorId &&
      event.damage?.targetId === afterglowLog?.targetIds?.[0],
    );
    assert(
      chainedCricketExplosion.ended && afterglowLog &&
      correspondingDamageIndex > afterglowEventIndex,
      'Seed 21009176 must retain the chained cricket afterglow log emitted before its damage event',
    );
    assert(
      scanSurtrLogs(chainedCricketExplosion).issues.every((issue) =>
        issue.type !== 'surtr-afterglow-contradictory-context'),
      'Afterglow auditing must pair a log with its own attacker and target even when damage is recorded next',
    );
    cases.push('Seed 21009176 pairs a chained cricket afterglow log with its following damage event');
  }

  {
    const waterRescueAfterBleed = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-9707',
      names: [...SPECIALS],
      seed: 34_009_707,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'normal',
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !waterRescueAfterBleed.error && waterRescueAfterBleed.ended,
      'Waterman rescue after pre-attack bleed fixture must finish',
    );
    const rescueAction = waterRescueAfterBleed.events.find((event) =>
      event.kind === 'action_start' && event.skillId === 'morphling_son_rescue',
    );
    const rescueTransition = waterRescueAfterBleed.events.find((event) =>
      !!rescueAction &&
      event.actionId === rescueAction.actionId &&
      event.visualCue?.kind === 'form_shift' &&
      event.visualCue.cause === 'revival',
    );
    const rescueCleanse = waterRescueAfterBleed.events.find((event) =>
      !!rescueAction &&
      event.actionId === rescueAction.actionId &&
      event.text.includes('【绝对驱散】'),
    );
    assert(
      rescueAction && rescueTransition && rescueCleanse,
      'Waterman rescue transition and cleanse must belong to one dedicated reaction action',
    );
    assert(
      !causalIssueTypes(waterRescueAfterBleed).has('post_revival_old_action_effect'),
      'Seed 34009707 must not attribute Waterman rescue cleanup to the defeated Gamer action',
    );
    cases.push('Seed 34009707 isolates Waterman rescue cleanup from the defeated action');
  }

  {
    const emoteBleedRevival = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-2838',
      names: [...NO_WATER],
      seed: 34_002_838,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'twilight',
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !emoteBleedRevival.error && emoteBleedRevival.ended,
      'Pre-attack bleed Emote revival fixture must finish',
    );
    const bleedDefeatIndex = emoteBleedRevival.logs.findIndex((entry) =>
      entry.text.includes('【流血】表情') &&
      entry.text.includes('出手前裂开'),
    );
    const revivalIndex = emoteBleedRevival.logs.findIndex((entry, index) =>
      index > bleedDefeatIndex &&
      entry.rootEventId === emoteBleedRevival.logs[bleedDefeatIndex]?.rootEventId &&
      entry.text.includes('【认主返场】'),
    );
    const oldActionTail = emoteBleedRevival.logs.find((entry, index) =>
      index > revivalIndex &&
      entry.rootEventId === emoteBleedRevival.logs[bleedDefeatIndex]?.rootEventId &&
      entry.text.includes('【表情包糊脸】'),
    );
    assert(
      bleedDefeatIndex >= 0 && revivalIndex > bleedDefeatIndex && !oldActionTail,
      'An Emote defeated and revived by pre-attack bleed must not execute its queued attack',
    );
    assert(
      !causalIssueTypes(emoteBleedRevival).has('post_revival_old_action_effect'),
      'Seed 34002838 must stop the queued Emote attack after pre-attack bleed revival',
    );
    cases.push('Seed 34002838 stops a queued action after pre-attack bleed revival');
  }

  {
    const complexEventCausality = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-1139',
      names: [...NO_WATER],
      seed: 34_001_139,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'afterglow',
      forceHerobrine: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !complexEventCausality.error && complexEventCausality.ended,
      'Surtr plus Herobrine complex-event fixture must finish',
    );
    assert(
      !causalIssueTypes(complexEventCausality).has('post_revival_old_action_effect'),
      'Seed 34001139 must remain free of old-life action effects after any revival',
    );
    cases.push('Seed 34001139 keeps complex Surtr and Herobrine event causality clean');
  }

  {
    const emoteRedirectedOpening = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-1535',
      names: [...NO_WATER],
      seed: 34_001_535,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'twilight',
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !emoteRedirectedOpening.error && emoteRedirectedOpening.ended,
      'Redirected Emote Owl-opening fixture must finish',
    );
    const finalChallengeIndex = emoteRedirectedOpening.logs.findIndex((entry) =>
      entry.text.includes('【最终认主挑战】') && entry.rootEventId === 'action-2300',
    );
    const oldActionOpening = emoteRedirectedOpening.logs.find((entry, index) =>
      index > finalChallengeIndex &&
      entry.rootEventId === 'action-2300' &&
      entry.actionId === 'action-2300' &&
      entry.text.includes('【乘风失衡】'),
    );
    assert(
      finalChallengeIndex >= 0 && !oldActionOpening,
      'An Emote action interrupted by redirected lethal damage must not consume Owl opening after revival',
    );
    assert(
      !causalIssueTypes(emoteRedirectedOpening).has('post_revival_old_action_effect'),
      'Seed 34001535 must not retain custom direct-hit aftermath after Emote revives',
    );
    cases.push('Seed 34001535 stops custom direct-hit aftermath across Emote revival');
  }

  {
    const emoteTrueExit = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-表情+柚子-vs-丝瓜uli+屑',
      names: ['表情@A', '柚子@A', '丝瓜uli@B', '屑@B'],
      seed: 16_047_492,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      emoteTrueExit.ended && emoteTrueExit.logs.some((entry) =>
        entry.text.includes('【认主失败】') && entry.text.includes('等待复活时'),
      ),
      'Emote true-exit fixture must mention the failed revival window',
    );
    assert(
      !causalIssueTypes(emoteTrueExit).has('post_revival_old_action_effect'),
      'A true-exit explanation that mentions revival must not be classified as an actual revival',
    );
    cases.push('Seed 16047492 keeps Emote true exit distinct from an actual revival');
  }

  {
    const runItBackContinuation = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-丝瓜uli+鸮-vs-刺猬人+柚子',
      names: ['丝瓜uli@A', '鸮@A', '刺猬人@B', '柚子@B'],
      seed: 16_031_217,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    const reviveIndex = runItBackContinuation.logs.findIndex((entry) =>
      entry.text.includes('浴火重生') && entry.text.includes('再火一回'),
    );
    const resumedAttackIndex = runItBackContinuation.logs.findIndex((entry, index) =>
      index > reviveIndex && entry.text.includes('【残局爆头线】'),
    );
    assert(
      runItBackContinuation.ended && reviveIndex >= 0 && resumedAttackIndex > reviveIndex,
      'Run It Back fixture must revive Valorant Junior from pre-attack bleed and continue the queued attack',
    );
    assert(
      !causalIssueTypes(runItBackContinuation).has('post_revival_old_action_effect'),
      'Run It Back is an explicit death-save that is allowed to continue the current action',
    );
    cases.push('Seed 16031217 keeps Run It Back as a continuation-capable death save');
  }

  {
    const cooperativeDefeat = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-小汀+柚子-vs-屑+鸮',
      names: ['小汀@A', '柚子@A', '屑@B', '鸮@B'],
      seed: 16_016_461,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !cooperativeDefeat.error && cooperativeDefeat.ended,
      'Controlled-Surtr cooperative-defeat fixture must finish',
    );
    assert(
      cooperativeDefeat.logs.some((entry) =>
        entry.text.includes('【过江协同】') &&
        entry.text.includes('协同追击击败')
      ),
      'Seed 16016461 must retain the Owl cooperative follow-up that defeats an Originium crystal',
    );
    assert(
      !cooperativeDefeat.logs.some((entry) =>
        entry.text.includes('【接管指令命中】') &&
        entry.text.includes('目标已经离场')
      ) &&
      cooperativeDefeat.logIssues.every((issue) => issue.type !== 'dead-fighter-mentioned-as-target') &&
      auditFocusedBattle(cooperativeDefeat, { prophet: true, surtr: true }, 'seed-16016461')
        .issues.length === 0,
      'A nested cooperative defeat must stop the controlled-command status tail without describing the departed target again',
    );
    cases.push('Seed 16016461 suppresses controlled-command status tails after Owl cooperative defeat');
  }

  {
    const immediateEmoteRevival = runBattle({
      phase: 'deep-adaptive-prophet',
      label: 'deep-adaptive-prophet-6470',
      names: [...NO_WATER],
      seed: 34_006_470,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !immediateEmoteRevival.error && immediateEmoteRevival.ended,
      'Immediate Emote final-owner revival fixture must finish',
    );
    const revivalStart = immediateEmoteRevival.events.find((event) =>
      event.kind === 'action_start' &&
      event.skillName === '认主返场' &&
      immediateEmoteRevival.events.some((candidate) =>
        candidate.kind === 'action_start' &&
        candidate.actionId === event.rootEventId,
      ),
    );
    const rootAction = immediateEmoteRevival.events.find((event) =>
      !!revivalStart &&
      event.kind === 'action_start' &&
      event.actionId === revivalStart.rootEventId,
    );
    const revivalEndIndex = immediateEmoteRevival.events.findIndex((event) =>
      !!revivalStart && event.kind === 'action_end' && event.actionId === revivalStart.actionId,
    );
    const rootEndIndex = immediateEmoteRevival.events.findIndex((event, index) =>
      !!rootAction &&
      index > revivalEndIndex &&
      event.kind === 'action_end' &&
      event.actionId === rootAction.actionId,
    );
    assert(
      revivalStart && rootAction && revivalEndIndex >= 0 && rootEndIndex > revivalEndIndex,
      'Fixture must contain an Emote revival nested inside the reflected original action',
    );
    const oldActionTail = immediateEmoteRevival.events
      .slice(revivalEndIndex + 1, rootEndIndex)
      .filter((event) =>
        event.actionId === rootAction.actionId &&
        !(
          event.kind === 'log' &&
          event.displayInFeed === false &&
          event.text.startsWith('state-sync:')
        ),
      );
    assert(
      oldActionTail.length === 0,
      `The reflected Emote action must stop after immediate revival, got ${oldActionTail.map((event) => event.text).join(' | ')}`,
    );
    assert(
      !causalIssueTypes(immediateEmoteRevival).has('post_revival_old_action_effect'),
      'Seed 34006470 must not retain any pre-defeat action effect after Emote returns',
    );
    cases.push('Seed 34006470 stops the reflected Emote action across immediate revival');

    const mutated = cloneResult(immediateEmoteRevival);
    const mutatedRootEndIndex = mutated.events.findIndex((event) =>
      event.kind === 'action_end' && event.actionId === rootAction.actionId,
    );
    const previous = mutated.events[mutatedRootEndIndex - 1];
    assert(previous && mutatedRootEndIndex > 0, 'Post-revival action-tail fault fixture requires a parent action end');
    mutated.events.slice(mutatedRootEndIndex).forEach((event) => {
      event.sequence += 1;
    });
    mutated.events.splice(mutatedRootEndIndex, 0, {
      ...structuredClone(previous),
      id: 'fault-post-revival-old-action-effect',
      sequence: previous.sequence + 1,
      kind: 'log',
      type: 'skill',
      visible: true,
      displayInFeed: true,
      actionId: rootAction.actionId,
      rootEventId: rootAction.rootEventId,
      actorId: rootAction.actorId,
      actorName: rootAction.actorName,
      targetIds: [],
      text: '🧪 【审计故障注入】旧生命的行动在复活后继续结算。',
      damage: undefined,
      visualCue: undefined,
      visualCueId: undefined,
    });
    assert(
      causalIssueTypes(mutated).has('post_revival_old_action_effect'),
      'The causal audit must reject an old action effect emitted after its actor revives',
    );
    cases.push('Fault injection detects an old action continuing after immediate revival');
  }

  {
    const zeroShieldRetreat = runBattle({
      phase: 'prophet-5v5',
      label: 'prophet-5v5-小汀+兔卷卷+刺猬人+屑+柚子-vs-水人+玄凝+牢鳄+克蕾儿丝菲尔+丝瓜uli',
      names: [
        '小汀@A',
        '兔卷卷@A',
        '刺猬人@A',
        '屑@A',
        '柚子@A',
        '水人@B',
        '玄凝@B',
        '牢鳄@B',
        '克蕾儿丝菲尔@B',
        '丝瓜uli@B',
      ],
      seed: 29_003_069,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !zeroShieldRetreat.error && zeroShieldRetreat.ended,
      'Puruisaishi zero-shield retreat fixture must finish',
    );
    const puruisaishi = zeroShieldRetreat.fighterDirectory.find((fighter) =>
      fighter.kind === 'npc:puruisaishi',
    );
    const shieldZeroEventIndex = zeroShieldRetreat.events.findIndex((event) =>
      event.kind === 'log' &&
      event.text.includes('【普瑞赛斯护盾】') &&
      /剩余\s*0(?:。|；|$)/.test(event.text),
    );
    const retreatStartEventIndex = zeroShieldRetreat.events.findIndex((event, index) =>
      index > shieldZeroEventIndex &&
      event.kind === 'log' &&
      event.text.includes('【预言家共同退场启动】'),
    );
    assert(
      puruisaishi && shieldZeroEventIndex >= 0 && retreatStartEventIndex > shieldZeroEventIndex,
      'Fixture must drain Puruisaishi barrier and start common retreat',
    );
    assert(
      zeroShieldRetreat.events
        .slice(shieldZeroEventIndex + 1, retreatStartEventIndex)
        .every((event) =>
          event.kind !== 'action_start' ||
          !(event.targetIds ?? []).includes(puruisaishi.id),
        ),
      'No nested follow-up may start against Puruisaishi after her barrier reaches zero',
    );
    assert(
      auditYuzuProphetResult(zeroShieldRetreat).length === 0,
      'The zero-shield common-retreat fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 29003069 flushes common retreat before a nested baby follow-up can target Puruisaishi');

    const mutated = cloneResult(zeroShieldRetreat);
    const actionTemplate = mutated.events.find((event) =>
      event.kind === 'action_start' && event.actorName === '丝瓜uli',
    );
    assert(actionTemplate, 'Zero-shield fault fixture requires a Silgua action template');
    mutated.events.splice(retreatStartEventIndex, 0, {
      ...structuredClone(actionTemplate),
      id: 'fault-post-zero-shield-pre-retreat-action',
      actionId: 'fault-post-zero-shield-pre-retreat-action',
      rootEventId: zeroShieldRetreat.events[shieldZeroEventIndex]?.rootEventId,
      targetIds: [puruisaishi.id],
      text: '🧪 【审计故障注入】护盾归零后仍对普瑞赛斯发动追击。',
    });
    assert(
      auditYuzuProphetResult(mutated)
        .some((issue) => issue.kind === 'post-zero-shield-pre-retreat-action'),
      'The Prophet audit must reject an action started after Puruisaishi barrier reaches zero but before retreat',
    );
    cases.push('Fault injection detects a nested action between Puruisaishi barrier depletion and common retreat');
  }

  {
    const jokerAoeRetreat = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-水人+小汀-vs-屑+柚子',
      names: ['水人@A', '小汀@A', '屑@B', '柚子@B'],
      seed: 16_000_527,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !jokerAoeRetreat.error && jokerAoeRetreat.ended,
      'Joker AOE zero-shield retreat fixture must finish',
    );
    const shieldZeroLogIndex = jokerAoeRetreat.logs.findIndex((entry) =>
      entry.text.includes('【普瑞赛斯护盾】') &&
      /剩余\s*0(?:。|；|$)/.test(entry.text),
    );
    const retreatStartLogIndex = jokerAoeRetreat.logs.findIndex((entry, index) =>
      index > shieldZeroLogIndex && entry.text.includes('【预言家共同退场启动】'),
    );
    const retreatEndLogIndex = jokerAoeRetreat.logs.findIndex((entry, index) =>
      index > retreatStartLogIndex && entry.text.includes('【共同退场完成】'),
    );
    assert(
      shieldZeroLogIndex >= 0 &&
      retreatStartLogIndex === shieldZeroLogIndex + 1 &&
      retreatEndLogIndex > retreatStartLogIndex,
      'Joker AOE must begin common retreat immediately after draining Puruisaishi barrier',
    );
    const retiredTailNames = ['阿喃那', '柚子·预言家', '史尔特尔'];
    assert(
      jokerAoeRetreat.logs
        .slice(retreatEndLogIndex + 1)
        .every((entry) =>
          !entry.text.includes('地狱笑话命中') ||
          retiredTailNames.every((name) => !entry.text.includes(name)),
        ),
      'Joker AOE must not continue resolving hits against event units after common retreat',
    );
    assert(
      auditYuzuProphetResult(jokerAoeRetreat).length === 0,
      'Joker AOE common-retreat fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 16000527 flushes common retreat inside Joker AOE before resolving retired event targets');
  }

  {
    const selfStatusAfterRetreat = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-水人+克蕾儿丝菲尔-vs-牢鳄+柚子',
      names: ['水人@A', '克蕾儿丝菲尔@A', '牢鳄@B', '柚子@B'],
      seed: 16_001_085,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !selfStatusAfterRetreat.error && selfStatusAfterRetreat.ended,
      'Post-retreat self-status metadata fixture must finish',
    );
    const water = selfStatusAfterRetreat.fighterDirectory.find((fighter) => fighter.name === '水人');
    const puruisaishi = selfStatusAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.kind === 'npc:puruisaishi',
    );
    const retreatEnd = selfStatusAfterRetreat.events.find((event) =>
      event.text.includes('【共同退场完成】'),
    );
    const liquidStatus = selfStatusAfterRetreat.events.find((event) =>
      !!retreatEnd &&
      event.sequence > retreatEnd.sequence &&
      event.text.includes('【状态结算】水人 获得【液化无敌】'),
    );
    assert(
      water && puruisaishi && retreatEnd && liquidStatus,
      'Fixture must apply Water Morphling self-status after the target triggers common retreat',
    );
    assert(
      liquidStatus.actorId === water.id &&
      liquidStatus.targetIds?.length === 1 &&
      liquidStatus.targetIds[0] === water.id &&
      !liquidStatus.targetIds.includes(puruisaishi.id),
      'A legal self-status after target withdrawal must identify its recipient instead of the retired target',
    );
    assert(
      auditYuzuProphetResult(selfStatusAfterRetreat).length === 0,
      'Post-retreat self-status metadata fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 16001085 attributes a post-retreat self-status to its living recipient');
  }

  {
    const owlAssistRetreat = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-水人+屑-vs-柚子+鸮',
      names: ['水人@A', '屑@A', '柚子@B', '鸮@B'],
      seed: 16_002_666,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !owlAssistRetreat.error && owlAssistRetreat.ended,
      'Owl assist zero-shield retreat fixture must finish',
    );
    const shieldZeroLogIndex = owlAssistRetreat.logs.findIndex((entry) =>
      entry.text.includes('【普瑞赛斯护盾】') &&
      /剩余\s*0(?:。|；|$)/.test(entry.text),
    );
    const retreatStartLogIndex = owlAssistRetreat.logs.findIndex((entry, index) =>
      index > shieldZeroLogIndex && entry.text.includes('【预言家共同退场启动】'),
    );
    assert(
      shieldZeroLogIndex >= 0 && retreatStartLogIndex === shieldZeroLogIndex + 1,
      'Owl Crossing assist must begin common retreat immediately after draining Puruisaishi barrier',
    );
    assert(
      !owlAssistRetreat.logs
        .slice(shieldZeroLogIndex + 1, retreatStartLogIndex)
        .some((entry) => entry.text.includes('【过江协同】追击被')),
      'Owl Crossing assist must not append a stale defended-result log before common retreat',
    );
    assert(
      auditYuzuProphetResult(owlAssistRetreat).length === 0,
      'Owl Crossing assist common-retreat fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 16002666 flushes common retreat inside Owl Crossing assist');
  }

  {
    const tokusatsuRoarRetreat = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-水人+刺猬人-vs-M1A2_abrams_sep+柚子',
      names: ['水人@A', '刺猬人@A', 'M1A2_abrams_sep@B', '柚子@B'],
      seed: 16_002_263,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !tokusatsuRoarRetreat.error && tokusatsuRoarRetreat.ended,
      'Tokusatsu roar zero-shield retreat fixture must finish',
    );
    const retreatEndLogIndex = tokusatsuRoarRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    assert(
      retreatEndLogIndex >= 0,
      'Tokusatsu roar fixture must trigger Prophet common retreat',
    );
    assert(
      !tokusatsuRoarRetreat.logs
        .slice(retreatEndLogIndex + 1)
        .some((entry) =>
          entry.text.includes('咆哮冲击') &&
          (entry.text.includes('普瑞赛斯') || entry.text.includes('源石映像')),
        ),
      'Tokusatsu roar must not append a target-result log for Puruisaishi after common retreat',
    );
    assert(
      auditYuzuProphetResult(tokusatsuRoarRetreat).length === 0,
      'Tokusatsu roar common-retreat fixture must remain clean under the Prophet audit',
    );
    cases.push('Seed 16002263 suppresses Tokusatsu roar target tails after Prophet common retreat');
  }

  {
    const waterRescueDuringTokusatsuAoe = runBattle({
      phase: 'prophet-2v2',
      label: 'prophet-2v2-玄凝+柚子-vs-水人+刺猬人',
      names: ['玄凝@A', '柚子@A', '水人@B', '刺猬人@B'],
      seed: 16_009_362,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !waterRescueDuringTokusatsuAoe.error && waterRescueDuringTokusatsuAoe.ended,
      'Water-rescue-during-Tokusatsu-AOE fixture must finish',
    );
    const waveStartIndex = waterRescueDuringTokusatsuAoe.logs.findIndex((entry) =>
      entry.text.includes('【黑气斩波】') && entry.text.includes('主斩 柚子'),
    );
    const rescueIndex = waterRescueDuringTokusatsuAoe.logs.findIndex((entry, index) =>
      index > waveStartIndex && entry.text.includes('被水人救起') && entry.text.includes('玄凝'),
    );
    assert(
      waveStartIndex >= 0 && rescueIndex > waveStartIndex,
      'Fixture must rescue Gamer onto the Tokusatsu attacker team during Black Mist Wave',
    );
    assert(
      !waterRescueDuringTokusatsuAoe.logs
        .slice(rescueIndex + 1)
        .some((entry) => entry.text.includes('黑气余波扫过 玄凝')),
      'A queued AOE target that becomes the attacker\'s ally must be skipped after Waterman rescue',
    );
    cases.push('Seed 16009362 revalidates queued AOE targets after Waterman changes their team');
  }

  {
    const aimCleanupAfterRetreat = runBattle({
      phase: 'deep-adaptive-prophet',
      label: 'deep-adaptive-prophet-5973',
      names: [...SPECIALS],
      seed: 34_005_973,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !aimCleanupAfterRetreat.error && aimCleanupAfterRetreat.ended,
      'War Thunder aim cleanup after Prophet retreat fixture must finish',
    );
    const retreatEndLogIndex = aimCleanupAfterRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const aimCleanup = aimCleanupAfterRetreat.logs
      .slice(retreatEndLogIndex + 1)
      .find((entry) => entry.text.includes('已消耗激光测距坐标'));
    const warThunder = aimCleanupAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.name === 'M1A2_abrams_sep',
    );
    const puruisaishi = aimCleanupAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.kind === 'npc:puruisaishi',
    );
    assert(
      retreatEndLogIndex >= 0 && aimCleanup && warThunder && puruisaishi,
      'Fixture must consume War Thunder aim after Prophet common retreat',
    );
    assert(
      aimCleanup.actorId === warThunder.id &&
      aimCleanup.targetIds?.length === 1 &&
      aimCleanup.targetIds[0] === warThunder.id &&
      !aimCleanup.targetIds.includes(puruisaishi.id),
      'War Thunder aim cleanup must identify M1 as both actor and affected unit',
    );
    assert(
      auditYuzuProphetResult(aimCleanupAfterRetreat).length === 0,
      'War Thunder aim cleanup after Prophet retreat must remain clean under the Prophet audit',
    );
    cases.push('Seed 34005973 attributes post-retreat War Thunder aim cleanup to M1');
  }

  {
    const controlImmunityAfterRetreat = runBattle({
      phase: 'deep-adaptive-prophet',
      label: 'deep-adaptive-prophet-17103',
      names: [...SPECIALS],
      seed: 34_017_103,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !controlImmunityAfterRetreat.error && controlImmunityAfterRetreat.ended,
      'Control immunity after Prophet retreat fixture must finish',
    );
    const retreatEndLogIndex = controlImmunityAfterRetreat.logs.findIndex((entry) =>
      entry.text.includes('【共同退场完成】'),
    );
    const tokusatsu = controlImmunityAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.name === '刺猬人',
    );
    const joker = controlImmunityAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.name === '屑',
    );
    const puruisaishi = controlImmunityAfterRetreat.fighterDirectory.find((fighter) =>
      fighter.kind === 'npc:puruisaishi',
    );
    assert(
      retreatEndLogIndex >= 0 && tokusatsu && joker && puruisaishi,
      'Control-immunity metadata fixture must contain common retreat and all participants',
    );
    const auditJoker = makeFighter('屑@A');
    const auditTokusatsu = makeFighter('刺猬人@B');
    auditJoker.id = joker.id;
    auditTokusatsu.id = tokusatsu.id;
    auditTokusatsu.isTokusatsu = true;
    auditTokusatsu.job = 'MIRACLE_BUJIN';
    enterTokusatsuThroneStance(auditTokusatsu);
    const controlLogs: BattleResult['logs'] = [];
    const controlEngine = makeEngine([auditJoker, auditTokusatsu], controlLogs);
    const applied = controlEngine.applyStatus(controlEngine.fighters[1], {
      identityId: 'CONFUSED',
      remainingTurns: 1,
      attribution: { applierId: auditJoker.id, applierName: auditJoker.name },
    });
    const controlBlock = controlLogs.find((entry) =>
      entry.text.includes('【武神王座】') && entry.text.includes('免疫了混乱效果'),
    );
    assert(!applied && controlBlock, 'Bujin Throne must block Joker confusion in the direct fixture');
    assert(
      controlBlock.actorId === joker.id &&
      controlBlock.targetIds?.length === 1 &&
      controlBlock.targetIds[0] === tokusatsu.id &&
      !controlBlock.targetIds.includes(puruisaishi.id),
      'Control immunity logs must identify the status applier and actual protected target',
    );
    controlImmunityAfterRetreat.logs.push(controlBlock);
    assert(
      auditYuzuProphetResult(controlImmunityAfterRetreat).length === 0,
      'Control immunity after Prophet retreat must remain clean under the Prophet audit',
    );
    cases.push('Seed 34017103 attributes post-retreat control immunity to its actual participants');
  }

  {
    const deferredAirborneLanding = runBattle({
      phase: 'deep-adaptive-prophet',
      label: 'deep-adaptive-prophet-7873',
      names: [...SPECIALS],
      seed: 34_007_873,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !deferredAirborneLanding.error && deferredAirborneLanding.ended,
      'Nested airborne-landing order fixture must finish',
    );
    const defianceIndex = deferredAirborneLanding.logs.findIndex((entry) =>
      entry.text.includes('【悲愿不倒】刺猬人'),
    );
    let previewIndex = -1;
    for (let index = 0; index < defianceIndex; index += 1) {
      const entry = deferredAirborneLanding.logs[index];
      if (
        entry?.text.includes('【歼灭·全弹发射】') &&
        entry.text.includes('刺猬人') &&
        entry.text.includes('结算前预估')
      ) {
        previewIndex = index;
      }
    }
    const resultIndex = deferredAirborneLanding.logs.findIndex((entry, index) =>
      index > previewIndex && entry.text.includes('📌 实际结算：刺猬人'),
    );
    const earlyLandingIndex = deferredAirborneLanding.logs.findIndex((entry, index) =>
      index > defianceIndex && entry.text.includes('【提前落地】刺猬人'),
    );
    const landingIndex = deferredAirborneLanding.logs.findIndex((entry, index) =>
      index > earlyLandingIndex && entry.text.includes('【炮震坠落】刺猬人'),
    );
    assert(
      previewIndex >= 0 && resultIndex > previewIndex && defianceIndex > resultIndex,
      'The authoritative Chimera Funnels result must precede Tokusatsu defiance',
    );
    assert(
      earlyLandingIndex > defianceIndex && landingIndex > earlyLandingIndex,
      'Strong-dispel landing must remain ordered after Tokusatsu defiance',
    );
    assert(
      !deferredAirborneLanding.logIssues.some((issue) => issue.type === 'aftermath-before-damage-result'),
      'The repaired fixture must remain clean under the aftermath-order scanner',
    );
    cases.push('Seed 34007873 defers strong-dispel airborne landing until after the parent damage result');
  }

  {
    const deferredSpalterLockblood = runBattle({
      phase: 'prophet-teams',
      label: 'prophet-2v2-spalter-lockblood-order',
      names: ['玄凝@A', '柚子@A', '表情@B', '鸮@B'],
      seed: 16_011_160,
    }, {
      forceYuzuProphet: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !deferredSpalterLockblood.error && deferredSpalterLockblood.ended,
      'Spalter lockblood ordering fixture must finish',
    );
    const lockIndex = deferredSpalterLockblood.logs.findIndex((entry) =>
      entry.actorName === '表情' &&
      entry.text.includes('【濒死锁血】归溟幽灵鲨'),
    );
    const lockLog = deferredSpalterLockblood.logs[lockIndex];
    const resultIndex = deferredSpalterLockblood.logs.findIndex((entry, index) =>
      index < lockIndex &&
      entry.rootEventId === lockLog?.rootEventId &&
      entry.text.includes('【退魔之剑】') &&
      entry.text.includes('归溟幽灵鲨') &&
      entry.text.includes('实际造成'),
    );
    assert(
      resultIndex >= 0 && lockIndex > resultIndex,
      'Emote damage result must precede Spalter lockblood aftermath',
    );
    assert(
      !deferredSpalterLockblood.logIssues.some((issue) => issue.type === 'aftermath-before-damage-result'),
      'The repaired Spalter fixture must remain clean under the aftermath-order scanner',
    );
    cases.push('Seed 16011160 logs Emote damage before Spalter lockblood aftermath');
  }

  {
    const deferredOriginiumDefeat = runBattle({
      phase: 'deep-adaptive-prophet',
      label: 'deep-adaptive-prophet-6981',
      names: [...NO_WATER],
      seed: 34_006_981,
    }, {
      forceYuzuProphetPhaseTwo: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !deferredOriginiumDefeat.error && deferredOriginiumDefeat.ended,
      'Originium infection ordering fixture must finish',
    );
    const transferIndex = deferredOriginiumDefeat.logs.findIndex((entry) =>
      entry.text.includes('【随机恶作剧】') &&
      entry.text.includes('【全平台冠军连段余波】') &&
      entry.text.includes('源石结晶#7'),
    );
    const transferResultIndex = deferredOriginiumDefeat.logs.findIndex((entry, index) =>
      index > transferIndex &&
      entry.text.includes('转移伤害落在 源石结晶#7') &&
      entry.text.includes('实际承受 341 点伤害'),
    );
    const infectionIndex = deferredOriginiumDefeat.logs.findIndex((entry, index) =>
      index > transferIndex &&
      entry.text.includes('【矿石病】玄凝') &&
      entry.text.includes('源石结晶#7') &&
      entry.text.includes('当前 80/80'),
    );
    const continueIndex = deferredOriginiumDefeat.logs.findIndex((entry, index) =>
      index > transferIndex && entry.text.includes('【CONTINUE?】玄凝'),
    );
    assert(
      transferIndex >= 0 &&
      transferResultIndex > transferIndex &&
      infectionIndex > transferResultIndex &&
      continueIndex > infectionIndex,
      'Transferred crystal damage and infection must be logged before the resulting Gamer death save',
    );
    cases.push('Seed 34006981 defers terminal Originium infection until after transferred damage');
  }

  {
    const redirectedWitness = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-1589',
      names: [...NO_WATER],
      seed: 34_001_589,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'afterglow',
      forceHerobrine: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !redirectedWitness.error && redirectedWitness.ended,
      'Redirected Herobrine witness wording fixture must finish',
    );
    const redirectIndex = redirectedWitness.logs.findIndex((entry) =>
      entry.text.includes('屑 遭到Herobrine的【空洞凝视】') &&
      entry.text.includes('柚子'),
    );
    const zeroDamageIndex = redirectedWitness.logs.findIndex((entry, index) =>
      index > redirectIndex &&
      entry.text.includes('【空洞凝视结算】') &&
      entry.text.includes('对 屑 造成 0 点实际生命伤害'),
    );
    const witnessIndex = redirectedWitness.logs.findIndex((entry, index) =>
      index > zeroDamageIndex &&
      entry.text.includes('【目击】屑') &&
      entry.text.includes('成为【空洞凝视】的锁定目标而增加'),
    );
    assert(
      redirectIndex >= 0 && zeroDamageIndex > redirectIndex && witnessIndex > zeroDamageIndex,
      'A redirected Empty Gaze must describe Witness as target lock-on rather than damage taken',
    );
    assert(
      !redirectedWitness.logs[witnessIndex]?.text.includes('因承受【空洞凝视】'),
      'Redirected Witness text must not claim that the untouched original target took the hit',
    );
    cases.push('Seed 34001589 keeps redirected Empty Gaze Witness wording causally accurate');
  }

  {
    const afterglowWitness = runBattle({
      phase: 'deep-adaptive-surtr',
      label: 'deep-adaptive-surtr-109',
      names: [...NO_WATER],
      seed: 34_000_109,
    }, {
      forceSurtr: true,
      forceSurtrLifecycle: 'afterglow',
      forceHerobrine: true,
      maxTurns: 10_000,
      checkInvariantsEachStep: true,
      scanLogs: true,
      scanRosterNames: true,
    });
    assert(
      !afterglowWitness.error && afterglowWitness.ended,
      'Herobrine hit-without-damage Witness fixture must finish',
    );
    const attackIndex = afterglowWitness.logs.findIndex((entry) =>
      entry.text.includes('【未知袭击】') && entry.text.includes('袭向 史尔特尔'),
    );
    const afterglowIndex = afterglowWitness.logs.findIndex((entry, index) =>
      index > attackIndex &&
      entry.text.includes('【黄昏余命】史尔特尔') &&
      entry.text.includes('无法令其提前死亡'),
    );
    const witnessIndex = afterglowWitness.logs.findIndex((entry, index) =>
      index > afterglowIndex &&
      entry.text.includes('【目击】史尔特尔') &&
      entry.text.includes('【未知袭击】'),
    );
    assert(
      attackIndex >= 0 && afterglowIndex > attackIndex && witnessIndex > afterglowIndex,
      'A direct Herobrine hit must add Witness even when Surtr Afterglow prevents HP loss',
    );
    cases.push('Seed 34000109 applies Witness to a directly hit Surtr in Afterglow');
  }

  return cases;
}
