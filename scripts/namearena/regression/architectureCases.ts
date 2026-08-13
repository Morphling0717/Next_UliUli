import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import {
  consumeCompletedLargeRound,
  createBattleState,
  getLargeRoundPriorityActorIds,
  noteLargeRoundActor,
  syncLargeRoundState,
  withBattleRandom,
} from '../../../lib/namearena/battleState';
import {
  applyPermanentStatBuff,
  cloneFighters,
  cloneJobDefinition,
  reconcileFighterSnapshots,
} from '../../../lib/namearena/combatState';
import { commitFormTransition } from '../../../lib/namearena/battlePresentation';
import {
  createCombatActorMotionPlan,
  TING_SELF_DESTRUCT_TIMELINE,
} from '../../../lib/namearena/combatActorMotion';
import {
  GACHA_COMBAT_EFFECT_IDS,
  resolveCombatEffect,
} from '../../../lib/namearena/combatEffects';
import {
  GACHA_NORMAL_POOL,
  GACHA_SSR_POOL,
  RED_FURY_POOL,
  SUICIDE_POOL,
} from '../../../lib/namearena/data/gachaPools';
import {
  GACHA_ORDINARY_SUMMON_NAMES,
  GACHA_SUMMON_LIFESTEAL_STATUS,
} from '../../../lib/namearena/gachaMechanics';
import { getEffectiveCombatStat } from '../../../lib/namearena/statusMechanics';
import { buildFighterStatusPresentation } from '../../../lib/namearena/statusPresentation';
import { BARRIER_IDENTITIES, STATUS_IDENTITIES, STATUS_MECHANICS } from '../../../lib/namearena/statusRegistry';
import {
  applyStatus,
  consumeStatusValue,
  formatStatusValue,
  grantBarrier,
  queryMechanic,
  removeEffects,
} from '../../../lib/namearena/statusSystem';
import {
  appendStageLogGroup,
  buildStageLogGroups,
  createStagePositions,
  createVisibleStagePositionMap,
  getStageFinisherImage,
  getStageFighterImage,
  resolveStageManualFocusId,
  shouldRenderFighterOnStage,
  toggleStageManualFocus,
  type StageLogEntry,
} from '../../../lib/namearena/battleStageModel';
import {
  appendBattleFeedEntry,
  commitBattlePlaybackView,
  createBattlePlaybackView,
  enqueueBattlePlaybackCommit,
} from '../../../lib/namearena/battlePlaybackModel';
import {
  claimBattleVisualEvent,
  createBattleVisualEventLedger,
  resetBattleVisualEventLedger,
} from '../../../lib/namearena/battleVisualLedger';
import {
  BATTLE_CINEMATIC_DURATION_MS,
  BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS,
  getVisualCueMinimumDisplayMs,
} from '../../../lib/namearena/battleVisualTiming';
import {
  StageAnimationScheduler,
  type StageAnimationHost,
} from '../../../lib/namearena/stageAnimationScheduler';
import { collectStageAssetManifest } from '../../../lib/namearena/stageAssetPreloader';
import {
  EXODIA_STAR_ORDER,
  SUMMON_CARD_ART_SLOTS,
  getSummonCardArt,
  orderExodiaMaterials,
} from '../../../lib/namearena/summonCardArt';
import type { BattleEvent, DamageApplicationOptions, Fighter, SpinalSwordRef } from '../../../lib/namearena/types';
import {
  assert,
  localProject,
  makeFighter,
  makeProjectEngine,
  scanLogs,
  type LogEntry,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function collectTypeScriptFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const FORM_MUTATION_PROPERTIES = new Set([
  'job',
  'jobData',
  'transformed',
  'yuzuPhase',
  'puruisaishiPhase',
  'phase',
]);

const FORM_INITIALIZER_FUNCTIONS = new Set([
  'createPuruisaishi',
  'ensureMomoState',
  'ensureYuzuState',
]);

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
}

function formMutationProperty(node: ts.Node): string | undefined {
  if (!ts.isBinaryExpression(node) || !isAssignmentOperator(node.operatorToken.kind)) return undefined;
  if (!ts.isPropertyAccessExpression(node.left)) return undefined;
  const property = node.left.name.text;
  if (!FORM_MUTATION_PROPERTIES.has(property)) return undefined;
  if (property === 'phase') {
    const owner = node.left.expression;
    if (!ts.isIdentifier(owner) || owner.text !== 'state') return undefined;
  }
  return property;
}

function isAuthorizedFormMutation(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      if (current.expression.text === 'commitFormTransition' || current.expression.text === 'transform') return true;
    }
    if (ts.isFunctionDeclaration(current) && current.name && FORM_INITIALIZER_FUNCTIONS.has(current.name.text)) {
      return true;
    }
  }
  return false;
}

function findUnauthorizedFormMutations(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const issues: string[] = [];
  const visit = (node: ts.Node): void => {
    const property = formMutationProperty(node);
    if (property && !isAuthorizedFormMutation(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      issues.push(`${relative(process.cwd(), path)}:${position.line + 1} writes ${property}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function isFullDeferredDamageFlush(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  const callee = call.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : '';
  if (name !== 'flushDeferredDamageEvents') return false;
  return !call.arguments.some((argument) =>
    ts.isStringLiteralLike(argument) && argument.text === 'mitigation',
  );
}

function isControlFlowBoundary(statement: ts.Statement): boolean {
  return ts.isReturnStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement) ||
    ts.isThrowStatement(statement);
}

function findDeferredFlushBeforeResultLogs(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const issues: string[] = [];
  const resultLogPattern = /\b(?:实际结算|实际造成|实际生命伤害|实际承受|没有造成实际伤害|没有造成生命伤害|未再损失生命)\b/;

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node)) {
      node.statements.forEach((statement, index) => {
        if (!isFullDeferredDamageFlush(statement)) return;
        for (let cursor = index + 1; cursor < Math.min(node.statements.length, index + 4); cursor += 1) {
          const candidate = node.statements[cursor]!;
          if (isControlFlowBoundary(candidate)) break;
          const candidateText = candidate.getText(sourceFile);
          if (/\bapplyDamage\s*\(/.test(candidateText)) break;
          if (/\blog\s*\(/.test(candidateText) && resultLogPattern.test(candidateText)) {
            const position = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
            issues.push(`${relative(process.cwd(), path)}:${position.line + 1}`);
            break;
          }
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function activePlayers(fighters: Fighter[]): Fighter[] {
  return fighters.filter((fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0 && !fighter.isNpc);
}

function seededTrace(seed: number): string {
  const state = createBattleState(seed);
  let fighters = withBattleRandom(state, () => [
    makeFighter('玄凝@回放甲'),
    makeFighter('克蕾儿丝菲尔@回放乙'),
    makeFighter('M1A2_abrams_sep@回放丙'),
  ]);
  const logs: LogEntry[] = [];
  const events: BattleEvent[] = [];
  const spinalSwordRef: SpinalSwordRef = { current: false };

  for (let index = 0; index < 40; index += 1) {
    const engine = makeProjectEngine(
      localProject,
      localProject.cloneFighters(fighters),
      logs,
      state.turnCount,
      state,
      events,
    );
    const ended = engine.step(spinalSwordRef);
    fighters = engine.fighters;
    if (ended) break;
  }

  events.forEach((event, index) => {
    assert(event.sequence === index + 1, `Structured event sequence should be contiguous, got ${event.sequence} at ${index + 1}`);
    assert(event.seed === state.seed, `Structured event should retain battle seed ${state.seed}, got ${event.seed}`);
  });
  assert(events.some((event) => event.kind === 'action_start'), 'Structured replay should contain action_start events');
  assert(events.filter((event) => event.kind === 'action_start').length === events.filter((event) => event.kind === 'action_end').length, 'Structured replay should pair action_start and action_end events');
  assert(events.some((event) => event.kind === 'damage'), 'Structured replay should contain authoritative damage events');

  return JSON.stringify({
    logs: logs.map(({ type, text }) => ({ type, text })),
    events,
    fighters: fighters.map((fighter) => ({
      id: fighter.id,
      name: fighter.name,
      hp: fighter.currentHp,
      dead: fighter.isDead,
      stats: fighter.stats,
      status: fighter.statuses,
    })),
    state,
  });
}

export function runArchitectureCases(): string[] {
  const cases: string[] = [];

  {
    const battleEngineSource = readFileSync(
      join(localProject.root, 'lib/namearena/battleEngine.ts'),
      'utf8',
    );
    assert(
      battleEngineSource.includes('turn-${this.turnCount}-major-npc-event'),
      'Major NPC post-round settlement should use a shared causal scope',
    );
    assert(
      !battleEngineSource.includes('turn-${this.turnCount}-puruisaishi'),
      'Herobrine and future major NPC events must not inherit the legacy Puruisaishi causal root',
    );
    cases.push('major NPC settlement uses a generic causal event root');
  }

  {
    const fighter = makeFighter('刺猬人@视觉时长');
    const target = makeFighter('玄凝@视觉时长目标');
    const transitionEvents: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [fighter, target], [], 0, undefined, transitionEvents);
    commitFormTransition({
      fighter,
      message: `${fighter.name} 进入下一阶段。`,
      log: (type, text, metadata) => engine.log(type, text, metadata),
      mutate: () => { fighter.transformed = true; },
    });
    const transition = transitionEvents.find((event) => event.visualCue?.kind === 'transformation');
    assert(Boolean(transition), 'Visual timing test should create a transformation event');
    assert(
      getVisualCueMinimumDisplayMs(transition ?? {}) >= BATTLE_CINEMATIC_DURATION_MS.tokusatsuTransformation + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS,
      'Transformation playback must not advance before the longest transformation cinematic finishes',
    );
    assert(
      getVisualCueMinimumDisplayMs({ presentation: 'finisher' }) >= BATTLE_CINEMATIC_DURATION_MS.tokusatsuFinisher + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS,
      'Finisher playback must not advance before the longest finisher cinematic finishes',
    );
    cases.push('log playback timing is derived from authoritative cinematic durations');
  }

  {
    const actor = makeFighter('刺猬人@视觉分类');
    const target = makeFighter('玄凝@视觉目标');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [actor, target], [], 0, undefined, events);

    const basic = engine.beginAction(null, actor, target, 0);
    engine.endAction(basic);
    const regular = engine.beginAction('tokusatsu_basic', actor, target, 0);
    engine.endAction(regular);
    const finisher = engine.beginAction('great_monster_victory', actor, target, 0);
    engine.endAction(finisher);
    actor.isSummon = true;
    actor.isAdvancedSummon = false;
    const protectedOrdinarySummon = engine.beginAction('great_monster_victory', actor, target, 0);
    engine.endAction(protectedOrdinarySummon);

    const starts = events.filter((event) => event.kind === 'action_start');
    assert(starts[0]?.presentation === 'basic', 'Null skill id should be classified as a basic attack');
    assert(starts[1]?.presentation === 'skill', 'Ordinary skills should use the regular skill presentation');
    assert(starts[2]?.presentation === 'finisher', 'Explicit finisher skills should carry finisher presentation metadata');
    assert(starts[3]?.presentation === 'skill', 'Ordinary summons must never inherit a finisher cinematic');
    cases.push('action presentation is explicit and ordinary summons cannot spoof finishers');
  }

  {
    const ting = makeFighter('小汀@角色特效');
    const inheritor = makeFighter('玄凝@脊髓剑继承者');
    const basic = resolveCombatEffect({
      skillId: null,
      skillName: '普通攻击',
      text: `${ting.name} 攻击了目标。`,
      presentation: 'basic',
      type: 'skill',
    }, ting);
    const spinal = resolveCombatEffect({
      skillId: 'spinal_slash',
      skillName: '脊髓剑·斩',
      text: `${inheritor.name} 挥舞脊髓剑。`,
      presentation: 'skill',
      type: 'skill',
    }, inheritor);
    const randomExplosion = resolveCombatEffect({
      skillId: 'suicide_rng',
      skillName: '以命换命',
      text: `${ting.name} 使用了完全不含动作关键词的新文案。`,
      presentation: 'skill',
      type: 'skill',
      visualCue: {
        kind: 'combat_action',
        sourceId: ting.id,
        targetIds: [inheritor.id],
        presentation: 'skill',
        effectId: 'ting_detonation_charge',
      },
    }, ting);
    const selfDestruct = resolveCombatEffect({
      skillId: 'suicide_bomb',
      skillName: '自爆',
      text: `${ting.name} 扑向目标并启动自毁程序。`,
      presentation: 'finisher',
      type: 'skill',
    }, ting);
    assert(basic?.motion === 'quick_slash', 'Ting basic attacks should use her short blood-slash language');
    assert(basic?.actorMotion === 'melee_lunge', 'Ting basic attacks should move her fighter card into melee range');
    assert(spinal?.motion === 'spinal_cleave', 'Spinal-sword inheritors should retain Ting spinal-cleave effects');
    assert(spinal?.actorMotion === 'melee_lunge', 'Spinal-sword inheritors should lunge before the cleave lands');
    assert(randomExplosion?.motion === 'detonation', 'Random sacrifice attacks should resolve their subtype from structured metadata');
    assert(randomExplosion?.actorMotion === 'melee_lunge', 'Structured charge attacks should move toward their target without reading log text');
    assert(selfDestruct?.actorMotion === 'self_destruct_cling', 'Ting self-destruction should cling to the target before charging');
    assert(localProject.skills.suicide_bomb?.presentation === 'finisher', 'Ting self-destruction should be explicitly classified as a finisher');
    assert([...RED_FURY_POOL, ...SUICIDE_POOL].every((entry) => entry.visualEffect), 'Every Ting random-pool entry must declare its visual subtype');
    cases.push('Ting combat effects are structured by skill and explicit random-pool subtype');
  }

  {
    const applications = localProject.skills.yasuo_q?.statusApplications ?? [];
    assert(
      applications.some((application) => application.identityId === 'AIRBORNE') &&
      !applications.some((application) => application.identityId === 'STUN'),
      'Yasuo tornado text says knock-up, so its declared control must use AIRBORNE rather than STUN',
    );
    cases.push('Yasuo tornado declaration matches its knock-up text and landing mechanics');
  }

  {
    const source = makeFighter('牢鳄@特效契约');
    const target = makeFighter('玄凝@特效目标');
    GACHA_COMBAT_EFFECT_IDS.forEach((effectId) => {
      const cue = resolveCombatEffect({
        skillId: 'gacha_visual_contract',
        skillName: '命运抽卡',
        text: `${source.name} 触发 ${effectId}。`,
        presentation: 'skill',
        type: 'skill',
        visualCue: {
          kind: 'combat_fx',
          effectId,
          sourceId: source.id,
          targetIds: [target.id],
        },
      }, source);
      assert(cue?.theme === 'gacha', `${effectId} should resolve to a playable gacha effect`);
      assert(cue?.stageImpact === false, `${effectId} should remain anchored to its fighters during regular skill playback`);
    });
    assert(
      GACHA_NORMAL_POOL.every((entry) => Boolean(entry.visualEffect)),
      'Every phase-one gacha result should own an explicit combat effect',
    );
    assert(
      new Set(GACHA_NORMAL_POOL.map((entry) => entry.visualEffect)).size === GACHA_NORMAL_POOL.length,
      'Every phase-one gacha result should have a distinct effect identity',
    );
    const fakeSealCard = GACHA_NORMAL_POOL.find((entry) => entry.text.includes('盗版封印卡'));
    assert(
      fakeSealCard?.statusApplications?.some((application) =>
        application.identityId === 'SPELL_BLOCK' && application.charges === 3,
      ),
      'The fake seal card should explicitly preserve its three spell-block charges',
    );
    const potShardCard = GACHA_NORMAL_POOL.find((entry) => entry.text.includes('强欲之壶的碎片'));
    assert(
      potShardCard?.text.includes('【反击】')
        && potShardCard.statusApplications?.some((application) => application.identityId === 'COUNTER'),
      'The Pot shard card must name the counter stance that it grants',
    );
    assert(
      GACHA_SSR_POOL.filter((entry) => !entry.isSummon).every((entry) => Boolean(entry.visualEffect)),
      'Every non-summon phase-two card should own an explicit combat effect',
    );

    const ordinaryMotions = GACHA_ORDINARY_SUMMON_NAMES.map((name) => {
      const summon = makeFighter(`${name}@召唤物特效`);
      summon.name = name;
      summon.summonBaseName = name;
      summon.isSummon = true;
      return resolveCombatEffect({
        skillId: null,
        skillName: '普通攻击',
        text: `${name} 发动攻击。`,
        presentation: 'basic',
        type: 'skill',
      }, summon)?.motion;
    });
    assert(ordinaryMotions.every(Boolean), 'Every ordinary summon should resolve its own attack effect');
    assert(
      new Set(ordinaryMotions).size === GACHA_ORDINARY_SUMMON_NAMES.length,
      'Every ordinary summon should use a distinct attack motion',
    );

    const advancedSkills = [
      'blue_eyes_burst_stream',
      'blue_eyes_sweeping_breath',
      'blue_eyes_dragon_roar',
      'ultimate_burst_stream',
      'triple_dragon_head',
      'ra_sun_flare',
      'ra_divine_pressure',
      'exodia_forbidden_blast',
      'exodia_seal_chains',
      'exodia_obliterate',
    ];
    const advancedSummon = makeFighter('黑暗大法师@高级特效');
    advancedSummon.isSummon = true;
    advancedSummon.isAdvancedSummon = true;
    advancedSkills.forEach((skillId) => {
      const presentation = skillId === 'exodia_obliterate' ? 'finisher' : 'skill';
      const cue = resolveCombatEffect({
        skillId,
        skillName: skillId,
        text: `${advancedSummon.name} 发动 ${skillId}。`,
        presentation,
        type: 'skill',
      }, advancedSummon);
      assert(cue?.theme === 'gacha', `${skillId} should resolve an advanced-summon effect`);
      assert(
        cue?.stageImpact === (presentation === 'finisher'),
        `${skillId} should only use a stage-wide impact when explicitly classified as a finisher`,
      );
    });

    const trueFinisherIds = [
      'blue_eyes_burst_stream',
      'ultimate_burst_stream',
      'ra_sun_flare',
      'exodia_obliterate',
    ];
    trueFinisherIds.forEach((skillId) => {
      const cue = resolveCombatEffect({
        skillId,
        skillName: skillId,
        text: `${advancedSummon.name} 发动 ${skillId}。`,
        presentation: 'finisher',
        type: 'skill',
      }, advancedSummon);
      assert(cue?.stageImpact === true, `${skillId} should retain its finisher-wide impact`);
    });
    cases.push('Laoe cards and every summon action have explicit playable effect identities');
  }

  {
    const laoe = makeFighter('牢鳄@延迟被动');
    const attacker = makeFighter('小汀@延迟伤害');
    laoe.transformed = true;
    laoe.jobData = { ...laoe.jobData, name: '欧皇' };
    laoe.hasUsedGachaDeathSave = false;
    localProject.setCurrentHp(laoe, 10);
    const deathEvents: BattleEvent[] = [];
    const deathEngine = makeProjectEngine(localProject, [laoe, attacker], [], 0, undefined, deathEvents);
    deathEngine.applyDamage(laoe, laoe.maxHp * 2, 'skill', true, attacker, {
      deferTransform: true,
      actionName: '延迟致死测试',
    });
    deathEngine.flushDeferredDamageEvents(laoe);
    assert(
      deathEvents.some((event) => event.visualCue?.kind === 'reaction_fx' && event.visualCue.effectId === 'gacha_death_save'),
      'Queued damage logs should preserve the Laoe death-save reaction metadata',
    );
    assert(
      !deathEvents.some((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'gacha_death_save'),
      'A passive Laoe death save must not masquerade as an active combat effect',
    );
    assert(
      !deathEvents.some((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'gacha_luck_gain'),
      'Passive luck gain must not masquerade as a combat action effect',
    );

    const lifestealOwner = makeFighter('牢鳄@吸血回流');
    lifestealOwner.transformed = true;
    lifestealOwner.jobData = { ...lifestealOwner.jobData, name: '欧皇' };
    localProject.setCurrentHp(lifestealOwner, Math.floor(lifestealOwner.maxHp * 0.4));
    lifestealOwner.gachaSummonLifestealPct = 0.35;
    applyStatus(lifestealOwner, {
      identityId: GACHA_SUMMON_LIFESTEAL_STATUS,
      remainingTurns: 4,
      attribution: { effectSourceId: GACHA_SUMMON_LIFESTEAL_STATUS },
    });
    const summon = makeFighter('史瓦罗@吸血攻击');
    summon.name = '史瓦罗';
    summon.isSummon = true;
    summon.summonerId = lifestealOwner.id;
    summon.summonBaseName = '史瓦罗';
    const enemy = makeFighter('玄凝@吸血目标');
    const lifestealEvents: BattleEvent[] = [];
    const lifestealEngine = makeProjectEngine(localProject, [lifestealOwner, summon, enemy], [], 0, undefined, lifestealEvents);
    lifestealEngine.applyDamage(enemy, 120, 'skill', true, summon, {
      deferTransform: true,
      actionName: '吸血回流测试',
    });
    lifestealEngine.flushDeferredDamageEvents(enemy);
    const lifestealEvent = lifestealEvents.find((event) => event.text.includes('吸血牌回流'));
    assert(!lifestealEvent?.visualCue, 'Deferred summon lifesteal must not replay the summon attack animation outside its action');
    assert(lifestealEvent?.actorId === summon.id, 'Summon lifesteal attribution should retain the summon that dealt damage');
    assert(lifestealEvent?.targetIds?.includes(lifestealOwner.id), 'Summon lifesteal attribution should retain Laoe as its target');
    cases.push('Laoe damage-triggered passives retain causal metadata without replaying combat animations');
  }

  {
    const laoe = makeFighter('牢鳄@神不死鸟归属');
    const ra = makeFighter('翼神龙@神不死鸟归属');
    const attacker = makeFighter('玄凝@神不死鸟攻击者');
    laoe.transformed = true;
    laoe.jobData = { ...laoe.jobData, name: '欧皇' };
    ra.name = '翼神龙';
    ra.isSummon = true;
    ra.isAdvancedSummon = true;
    ra.summonerId = laoe.id;
    ra.summonBaseName = '翼神龙';
    ra.maxHp = 3000;
    localProject.setCurrentHp(ra, 100);
    applyStatus(ra, { identityId: 'RA_PHOENIX', remainingTurns: 3 });
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [laoe, ra, attacker], [], 0, undefined, events);

    engine.applyDamage(engine.fighters[1], 5000, 'skill', true, engine.fighters[2], {
      actionName: '神不死鸟反应分类测试',
    });

    const phoenixEvent = events.find((event) => event.visualCue?.kind === 'reaction_fx' && event.visualCue.effectId === 'summon_ra_rebirth');
    assert(Boolean(phoenixEvent), 'Ra Phoenix should emit one passive reaction visual cue');
    assert(phoenixEvent?.actorId === engine.fighters[1].id, 'Ra Phoenix reaction should identify Ra as its actor');
    assert(phoenixEvent?.targetIds?.includes(engine.fighters[1].id), 'Ra Phoenix reaction should identify the revived Ra as its target');
    assert(
      !events.some((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'summon_ra_rebirth'),
      'Ra Phoenix revival must not masquerade as an active combat effect',
    );
    cases.push('passive revival effects use reaction cues with explicit actor and target attribution');
  }

  {
    const manualFocus = { fighterId: 'inspected-fighter', battleRunId: 7 };
    assert(
      resolveStageManualFocusId(manualFocus, 7) === 'inspected-fighter',
      'Manual inspection should persist across later actor actions in the same battle',
    );
    assert(
      resolveStageManualFocusId(manualFocus, 8) === null,
      'A new battle run must never restore a stale manual inspection',
    );
    assert(
      toggleStageManualFocus(manualFocus, 'inspected-fighter', 7) === null,
      'Selecting the focused fighter again should resume actor-following',
    );
    assert(
      toggleStageManualFocus(manualFocus, 'other-fighter', 7)?.fighterId === 'other-fighter',
      'Selecting another fighter should move the manual inspection lock',
    );
    cases.push('stage detail focus persists for a battle until the user explicitly resumes following');
  }

  {
    const actorRect = { left: 100, top: 120, width: 160, height: 64 };
    const targetRect = { left: 700, top: 360, width: 160, height: 64 };
    const lunge = createCombatActorMotionPlan('melee_lunge', actorRect, targetRect);
    const cling = createCombatActorMotionPlan('self_destruct_cling', actorRect, targetRect);
    assert(lunge && cling, 'Separated fighter cards should produce movement plans');
    if (lunge && cling) {
      const lungeDistance = Math.hypot(lunge.destination.x, lunge.destination.y);
      const clingDistance = Math.hypot(cling.destination.x, cling.destination.y);
      assert(clingDistance > lungeDistance, 'Self-destruction should move closer to the target than an ordinary slash');
      assert(cling.effectDelayMs > lunge.effectDelayMs, 'Self-destruction should reserve time for its cut-in before charging');
      const firstDestinationFrame = cling.frames.find((frame) => (
        Math.abs(frame.x - cling.destination.x) < 0.01 && Math.abs(frame.y - cling.destination.y) < 0.01
      ));
      const destinationFrames = cling.frames.filter((frame) => (
        Math.abs(frame.x - cling.destination.x) < 0.01 && Math.abs(frame.y - cling.destination.y) < 0.01
      ));
      const finalDestinationFrame = destinationFrames.at(-1);
      assert(
        Math.round((firstDestinationFrame?.offset ?? 0) * cling.durationMs) === TING_SELF_DESTRUCT_TIMELINE.actorArriveMs,
        'Ting must reach the target before self-destruction charging begins',
      );
      assert(
        cling.effectDelayMs >= TING_SELF_DESTRUCT_TIMELINE.actorArriveMs,
        'Self-destruction charging must not begin before Ting reaches the target',
      );
      assert(
        Math.round((finalDestinationFrame?.offset ?? 0) * cling.durationMs) >= cling.effectDelayMs + TING_SELF_DESTRUCT_TIMELINE.effectDurationMs,
        'Ting must stay attached until every detonation frame has finished',
      );
      assert(
        TING_SELF_DESTRUCT_TIMELINE.returnStartMs < cling.durationMs,
        'Self-destruction must reserve a final return-to-origin phase',
      );
      assert(lunge.frames.at(-1)?.x === 0 && lunge.frames.at(-1)?.y === 0, 'Melee movement must return to the layout origin');
      assert(cling.frames.at(-1)?.x === 0 && cling.frames.at(-1)?.y === 0, 'Self-destruction movement must return to the layout origin');
    }
    cases.push('fighter-card combat movement approaches safely and always returns to origin');
  }

  {
    const ledger = createBattleVisualEventLedger();
    assert(claimBattleVisualEvent(ledger, 1, 'cue-a'), 'the first visual claim in a run should succeed');
    assert(!claimBattleVisualEvent(ledger, 1, 'cue-a'), 'the same visual cue must not replay in one battle run');
    for (let index = 0; index < 4096; index += 1) {
      claimBattleVisualEvent(ledger, 1, `cue-${index}`);
    }
    assert(!claimBattleVisualEvent(ledger, 1, 'cue-a'), 'an early cue must remain claimed for the entire battle run');
    assert(ledger.keys.size === 4097, 'the visual ledger should retain every cue until the battle run changes');
    assert(claimBattleVisualEvent(ledger, 2, 'cue-a'), 'a new battle run should reset exact-once playback ownership');
    resetBattleVisualEventLedger(ledger, 2);
    assert(Number(ledger.keys.size) === 0, 'an explicit battle reset should clear visual playback ownership');
    cases.push('visual cue playback ledger is exact-once, bounded, and scoped to one battle run');
  }

  {
    const fighter = makeFighter('玄凝@形态快照');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [fighter], [], 0, undefined, events);
    const beforeJob = fighter.job;
    commitFormTransition({
      fighter,
      message: `${fighter.name} 完成职业重构。`,
      log: (type, text, metadata) => engine.log(type, text, metadata),
      mutate: () => {
        fighter.transformed = true;
        fighter.job = 'ALL_PLATFORM_CHAMPION';
        fighter.jobData = cloneJobDefinition(localProject.jobs.ALL_PLATFORM_CHAMPION!);
      },
    });
    const cue = events.find((event) => event.visible)?.visualCue;
    assert(cue?.kind === 'transformation', 'A real form mutation should emit a structured transformation cue');
    if (cue?.kind === 'transformation') {
      assert(cue.from.jobKey === beforeJob && cue.to.jobKey === 'ALL_PLATFORM_CHAMPION', 'Transformation cue should retain authoritative before/after jobs');
    }
    const firstVisible = events.find((event) => event.visible);
    assert(firstVisible?.visualCueId === `${firstVisible?.id}:visual`, 'Visual form events should receive a stable exact-once playback key');

    commitFormTransition({
      fighter,
      message: `${fighter.name} 在同阶段切换职业。`,
      log: (type, text, metadata) => engine.log(type, text, metadata),
      mutate: () => {
        fighter.job = 'HIGH_END_GAMER';
        fighter.jobData = cloneJobDefinition(localProject.jobs.HIGH_END_GAMER!);
      },
    });
    const shiftCue = events.filter((event) => event.visible)[1]?.visualCue;
    assert(shiftCue?.kind === 'form_shift', 'A same-phase job change should use the short form-shift cue');
    engine.log('transform', `${fighter.name} 只是重复播报当前职业。`);
    const visible = events.filter((event) => event.visible);
    assert(!visible[2]?.visualCue, 'A transform-like log without a form mutation must not replay a transformation');
    cases.push('form cinematics require one authoritative transition and distinguish same-phase shifts');
  }

  {
    const first = makeFighter('玄凝@范围转阶段甲');
    const second = makeFighter('克蕾儿丝菲尔@范围转阶段乙');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [first, second], [], 0, undefined, events);
    const action = engine.beginAction('form-transition-area-test', first, second, 0);
    [first, second].forEach((fighter, index) => {
      commitFormTransition({
        fighter,
        message: `${fighter.name} 在同一次范围攻击中进入第二阶段。`,
        log: (type, text, metadata) => engine.log(type, text, metadata),
        mutate: () => {
          fighter.transformed = true;
          fighter.job = index === 0 ? 'ALL_PLATFORM_CHAMPION' : 'SUCCUBUS';
          fighter.jobData = cloneJobDefinition(localProject.jobs[fighter.job]!);
        },
      });
    });
    engine.endAction(action);
    const transitions = events.filter((event) => event.actionId === action.id && event.visualCue?.kind === 'transformation');
    assert(transitions.length === 2, 'One area action must retain one transformation cue for every fighter that actually changes phase');
    assert(new Set(transitions.map((event) => event.visualCueId)).size === 2, 'Simultaneous transformations must own distinct playback keys');
    cases.push('one area action preserves independent transformation cues for every affected fighter');
  }

  {
    const fighter = makeFighter('柚子@连续升阶');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [fighter], [], 0, undefined, events);
    fighter.yuzuPhase = 1;
    const advanceTo = (phase: 2 | 3) => commitFormTransition({
      fighter,
      message: `${fighter.name} 进入第 ${phase} 阶段。`,
      log: (type, text, metadata) => engine.log(type, text, metadata),
      mutate: () => { fighter.yuzuPhase = phase; },
    });
    assert(advanceTo(2), 'The first phase edge should commit');
    assert(advanceTo(3), 'The second phase edge should commit');
    assert(!advanceTo(3), 'Re-announcing the current phase must not commit another transition');
    const transitions = events.filter((event) => event.visualCue?.kind === 'transformation');
    assert(
      transitions.length === 2 &&
      transitions[0]?.visualCue?.kind === 'transformation' && transitions[0].visualCue.from.phase === 1 && transitions[0].visualCue.to.phase === 2 &&
      transitions[1]?.visualCue?.kind === 'transformation' && transitions[1].visualCue.from.phase === 2 && transitions[1].visualCue.to.phase === 3,
      'A multi-stage fighter must publish exactly the authoritative 1->2 and 2->3 edges',
    );
    engine.log('info', `${fighter.name} 转阶段后的普通状态结算。`);
    assert(!events.at(-1)?.visualCue, 'A log following a phase transition must not inherit its visual cue');
    cases.push('multi-stage fighters publish each real phase edge once without leaking cues to later logs');
  }

  {
    const fighter = makeFighter('M1A2_abrams_sep@同形态复活');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [fighter], [], 0, undefined, events);
    const before = { job: fighter.job, phase: fighter.transformed };
    const changed = commitFormTransition({
      fighter,
      kind: 'form_shift',
      cause: 'redeploy',
      force: true,
      message: `${fighter.name} 驾驶同型号备用载具重新部署。`,
      log: (type, text, metadata) => engine.log(type, text, metadata),
      mutate: () => { fighter.currentHp = fighter.maxHp; },
    });
    const cue = events.find((event) => event.visible)?.visualCue;
    assert(changed && cue?.kind === 'form_shift', 'A forced same-form revival should publish the short form-shift cue');
    if (cue?.kind === 'form_shift') {
      assert(cue.from.jobKey === before.job && cue.to.jobKey === before.job && fighter.transformed === before.phase, 'A same-form revival must not invent a phase or job edge');
      assert(cue.cause === 'redeploy', 'A same-form backup vehicle should identify redeployment as the transition cause');
    }
    cases.push('same-form revival uses an explicit short form-shift without inventing a phase edge');
  }

  {
    const actor = makeFighter('鸮@动作视觉锚点');
    const target = makeFighter('小汀@动作视觉目标');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [actor, target], [], 0, undefined, events);
    const action = engine.beginAction('owl_shining_hopper', actor, target, 0);
    engine.log('skill', '第一条动作视觉日志', {
      targetIds: [target.id],
      visualCue: { kind: 'combat_action', sourceId: actor.id, targetIds: [target.id], presentation: 'skill' },
    });
    engine.log('skill', '同一动作的后续结果日志', {
      targetIds: [target.id],
      visualCue: { kind: 'combat_fx', effectId: 'toku_bujin_slash', sourceId: actor.id, targetIds: [target.id] },
    });
    engine.log('skill', '错误请求第二个主动作锚点', {
      targetIds: [target.id],
      visualCue: { kind: 'combat_action', sourceId: actor.id, targetIds: [target.id], presentation: 'skill' },
    });
    engine.endAction(action);
    const actionVisuals = events.filter((event) => event.actionId === action.id && (event.visualCue?.kind === 'combat_action' || event.visualCue?.kind === 'combat_fx'));
    assert(
      actionVisuals.filter((event) => event.visualCue?.kind === 'combat_action').length === 1,
      'one action may publish only one primary combat visual anchor',
    );
    assert(
      actionVisuals.filter((event) => event.visualCue?.kind === 'combat_fx').length === 1,
      'one action may retain an explicitly authored follow-up hit effect',
    );
    assert(new Set(actionVisuals.map((event) => event.visualCueId)).size === 2, 'primary and follow-up visuals must retain distinct exact-once keys');
    cases.push('one causal action deduplicates its primary anchor while retaining explicit follow-up hits');
  }

  {
    const summoner = makeFighter('牢鳄@卡片事件');
    summoner.exodiaPieces = ['右腕', '左腕', '右足', '左足', '头部'];
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [summoner], [], 0, undefined, events);
    const tag = localProject.skills.exodia_obliterate?.tag;
    assert(tag, 'Exodia skill tag fixture should exist');
    engine.executeSummonSkill({
      name: '黑暗大法师降临',
      tag,
      text: '{USER} 集齐封印组件。',
      isSummon: true,
      summonName: '黑暗大法师',
      summonJob: 'EXODIA_INCARNATE',
      advancedSummon: true,
      unique: true,
      stats: { hp: 2000, atk: 200, mag: 200 },
    }, summoner, engine.getTeamId(summoner));
    const summonCue = events.find((event) => event.visualCue?.kind === 'summon_card')?.visualCue;
    assert(summonCue?.kind === 'summon_card' && summonCue.summonKind === 'exodia', 'Exodia arrival should emit its dedicated card cinematic');
    if (summonCue?.kind === 'summon_card') {
      assert(summonCue.materials.length === 5, 'Exodia card cinematic should carry all five sealed components');
    }
    cases.push('advanced summon arrivals emit structured card cinematics');
  }

  {
    const summoner = makeFighter('牢鳄@召唤ID冲突');
    const engine = makeProjectEngine(localProject, [summoner], []);
    const originalGenerateUuid = localProject.core.generateUUID;
    let attempts = 0;
    localProject.core.generateUUID = () => {
      attempts += 1;
      return attempts === 1 ? summoner.id : 'summon-id-after-collision';
    };
    try {
      engine.executeSummonSkill({
        name: '召唤ID冲突回归',
        tag: 'special',
        text: '{USER} 召唤测试伙伴。',
        isSummon: true,
        summonName: 'ID测试伙伴',
        summonJob: 'WARRIOR',
      }, summoner, engine.getTeamId(summoner));
    } finally {
      localProject.core.generateUUID = originalGenerateUuid;
    }
    assert(attempts === 2, 'Dynamic summon IDs should retry after colliding with an existing fighter');
    assert(new Set(engine.fighters.map((fighter) => fighter.id)).size === engine.fighters.length, 'Dynamic summon IDs must remain unique across the roster');
    cases.push('dynamic summons retry UUID collisions instead of aliasing existing fighters');
  }

  {
    const summonTag = localProject.skills.exodia_obliterate?.tag;
    assert(summonTag, 'Advanced summon fixture should have a skill tag');
    const makeOwnedSummon = (owner: Fighter, name: string, advanced = false): Fighter => {
      const summon = makeFighter(`${name}@${owner.name}`);
      summon.name = name;
      summon.displayName = name;
      summon.isSummon = true;
      summon.isAdvancedSummon = advanced;
      summon.summonerId = owner.id;
      summon.summonBaseName = name;
      return summon;
    };
    const fixtures = [
      {
        name: '青眼白龙',
        kind: 'tribute',
        job: 'BLUE_EYES_WHITE_DRAGON',
        materials: ['栗子球', 'Saber'],
        tributes: 2,
      },
      {
        name: '翼神龙',
        kind: 'tribute',
        job: 'RA_WINGED_DRAGON',
        materials: ['栗子球', 'Saber', '海马'],
        tributes: 3,
      },
      {
        name: '青眼究极龙',
        kind: 'fusion',
        job: 'BLUE_EYES_ULTIMATE_DRAGON',
        materials: ['青眼白龙', '栗子球', 'Saber'],
        tributes: 0,
      },
    ] as const;

    fixtures.forEach((fixture) => {
      const owner = makeFighter(`牢鳄@${fixture.name}`);
      const materials = fixture.materials.map((name) => makeOwnedSummon(owner, name, name === '青眼白龙'));
      const events: BattleEvent[] = [];
      const engine = makeProjectEngine(localProject, [owner, ...materials], [], 0, undefined, events);
      engine.executeSummonSkill({
        name: `${fixture.name}降临`,
        tag: summonTag!,
        text: `{USER} 召唤 ${fixture.name}。`,
        isSummon: true,
        summonName: fixture.name,
        summonJob: fixture.job,
        advancedSummon: true,
        tributes: fixture.tributes,
        stats: { hp: 2000, atk: 200, mag: 200 },
      }, owner, engine.getTeamId(owner));
      const cue = events.find((event) => event.visualCue?.kind === 'summon_card')?.visualCue;
      assert(cue?.kind === 'summon_card' && cue.summonKind === fixture.kind, `${fixture.name} should emit a ${fixture.kind} card cinematic`);
      if (cue?.kind === 'summon_card') {
        assert(cue.materials.length === fixture.materials.length, `${fixture.name} should retain every tribute or fusion material`);
      }
    });

    const owner = makeFighter('牢鳄@普通召唤');
    const ordinaryEvents: BattleEvent[] = [];
    const ordinaryEngine = makeProjectEngine(localProject, [owner], [], 0, undefined, ordinaryEvents);
    ordinaryEngine.executeSummonSkill({
      name: '普通召唤',
      tag: summonTag!,
      text: '{USER} 召唤普通伙伴。',
      isSummon: true,
      summonName: '普通伙伴',
      summonJob: 'WARRIOR',
      stats: { hp: 500, atk: 50 },
    }, owner, ordinaryEngine.getTeamId(owner));
    assert(!ordinaryEvents.some((event) => event.visualCue?.kind === 'summon_card'), 'Ordinary summons must not emit a card cinematic');

    const knownOwner = makeFighter('牢鳄@钟离翻牌');
    const knownOrdinaryEvents: BattleEvent[] = [];
    const knownOrdinaryEngine = makeProjectEngine(localProject, [knownOwner], [], 0, undefined, knownOrdinaryEvents);
    knownOrdinaryEngine.executeSummonSkill({
      name: '命运召唤',
      tag: summonTag!,
      text: '{USER} 从卡组抽出钟离。',
      isSummon: true,
      summonName: '钟离',
      summonJob: 'GENSHIN_ARCHON',
      stats: { hp: 2500, atk: 30, def: 150 },
    }, knownOwner, knownOrdinaryEngine.getTeamId(knownOwner));
    const ordinaryCue = knownOrdinaryEvents.find((event) => event.visualCue?.kind === 'summon_card')?.visualCue;
    assert(
      ordinaryCue?.kind === 'summon_card' && ordinaryCue.summonKind === 'reveal',
      'Known ordinary summon cards should receive a short card-reveal cinematic',
    );
    cases.push('tribute, fusion, Exodia, known card reveals, and unknown summons stay separated');
  }

  {
    const player = makeFighter('牢鳄@舞台玩家');
    const npc = makeFighter('玄凝@舞台NPC');
    const summon = makeFighter('刺猬人@舞台召唤');
    player.isDead = true;
    npc.isNpc = true;
    npc.isDead = true;
    summon.isSummon = true;
    summon.isDead = true;
    assert(shouldRenderFighterOnStage(player), 'Defeated player characters should remain visible for battlefield context');
    assert(!shouldRenderFighterOnStage(npc) && !shouldRenderFighterOnStage(summon), 'Defeated NPCs and summons should leave the stage immediately');

    const grouped = buildStageLogGroups(Array.from({ length: 12 }, (_, index) => ({
      id: `log-${index}`,
      type: index === 0 ? 'skill' : 'info',
      text: `因果日志 ${index + 1}`,
      actionId: 'long-action',
      skillName: '长结算技能',
    })), 10, 5);
    assert(grouped.length === 3 && grouped[0]?.logs[0]?.text === '因果日志 1', 'Long actions should be chunked without dropping their opening cause');
    assert(grouped.every((group) => group.partCount === 3), 'Chunked logs should expose continuation numbering');

    const sourceLogs = Array.from({ length: 12 }, (_, index) => ({
      id: `incremental-log-${index}`,
      type: index === 0 ? 'skill' : 'info',
      text: `增量因果日志 ${index + 1}`,
      actionId: 'incremental-action',
      skillName: '增量结算技能',
    }));
    const incrementalGroups = sourceLogs.reduce(
      (groups, log) => appendStageLogGroup(groups, log, 10, 5),
      [] as ReturnType<typeof buildStageLogGroups>,
    );
    const rebuiltGroups = buildStageLogGroups(sourceLogs, 10, 5);
    assert(
      incrementalGroups.map((group) => group.logs.map((log) => log.text).join('|')).join('||') ===
        rebuiltGroups.map((group) => group.logs.map((log) => log.text).join('|')).join('||'),
      'Incremental feed grouping should preserve the same causal chunks as a full rebuild',
    );
    assert(incrementalGroups.every((group) => group.partCount === 3), 'Incremental feed groups should update continuation counts');

    const positions = createStagePositions(30, 900, 430);
    assert(positions.length === 30, 'Crowded stage layout should allocate every unit');
    assert(new Set(positions.map((position) => `${position.x.toFixed(3)}:${position.y.toFixed(3)}`)).size === positions.length, 'Crowded stage layout should not assign duplicate centers');

    const herobrineCrowdedPositions = createStagePositions(26, 1200, 720);
    assert(
      new Set(herobrineCrowdedPositions.map((position) => position.y.toFixed(2))).size === 3,
      'A 26-unit desktop event stage should use a three-row grid instead of compressing a third ring at center',
    );
    assert(
      new Set(herobrineCrowdedPositions.map((position) => position.x.toFixed(2))).size >= 8,
      'A 26-unit desktop event stage should preserve enough horizontal slots for crowded fighter cards',
    );

    const desktopPositions = createStagePositions(12, 900, 430);
    assert(new Set(desktopPositions.map((position) => position.y.toFixed(2))).size > 6, 'A 12-unit desktop stage should use multiple rings instead of collapsing into two packed rows');
    assert(desktopPositions.every((position) => position.y >= 20 && position.y <= 76), 'Desktop ring layouts should preserve top and bottom HUD safe zones');

    const narrowLandscapePositions = createStagePositions(12, 355, 340);
    assert(new Set(narrowLandscapePositions.map((position) => position.y.toFixed(2))).size === 4, 'A narrow landscape stage should arrange 12 compact units in four rows');
    const narrowDensePositions = createStagePositions(18, 355, 340);
    assert(new Set(narrowDensePositions.map((position) => position.y.toFixed(2))).size === 5, 'A narrow landscape stage should arrange 18 dense units in five rows');

    const visiblePlayers = Array.from({ length: 13 }, (_, index) => makeFighter(`可见玩家${index + 1}@站位`));
    const retiredSummons = Array.from({ length: 24 }, (_, index) => {
      const fighter = makeFighter(`退场召唤物${index + 1}@站位`);
      fighter.isSummon = true;
      fighter.isDead = true;
      fighter.currentHp = 0;
      return fighter;
    });
    const visiblePositionMap = createVisibleStagePositionMap([...visiblePlayers, ...retiredSummons], 1200, 720);
    assert(visiblePositionMap.size === visiblePlayers.length, 'Retired NPCs and summons must not reserve invisible battlefield slots');
    assert(retiredSummons.every((fighter) => !visiblePositionMap.has(fighter.id)), 'Every retired summon should be absent from the visible position map');
    assert(new Set([...visiblePositionMap.values()].map((position) => position.y.toFixed(2))).size > 6, 'Visible fighters should retain a full multi-ring layout even when battle history contains many retired summons');
    cases.push('stage retirement, log causality, and crowded layouts are deterministic');
  }

  {
    const requiredCards = [
      '护主栗子球', '钟离', 'Saber', '萨姆', '巴哈姆特', '伊莫库', '史尔特尔', '史瓦罗', '小汀(傀儡)',
      '青眼白龙', '青眼究极龙', '翼神龙', '黑暗大法师',
      ...EXODIA_STAR_ORDER,
    ];
    const isVersionedAsset = (actual: string | undefined, expected: string) =>
      actual?.startsWith(`${expected}?v=`) === true;
    const isVersionedWebp = (actual: string | undefined) =>
      actual?.split('?')[0].endsWith('.webp') === true && actual.includes('?v=');
    requiredCards.forEach((name) => {
      const art = getSummonCardArt(name);
      assert(art.key !== 'unassigned-card', `${name} should have a dedicated card-art slot`);
      assert(art.expectedPath.endsWith('.webp'), `${name} should expose its future card-art path`);
    });
    assert(new Set(SUMMON_CARD_ART_SLOTS.map((entry) => entry.expectedPath)).size === SUMMON_CARD_ART_SLOTS.length, 'Every summon and sealed component should own a distinct card-art path');
    ['护主栗子球', '钟离', 'Saber', '萨姆', '巴哈姆特', '伊莫库', '史瓦罗'].forEach((name) => {
      const art = getSummonCardArt(name);
      assert(isVersionedAsset(art.imagePath, art.expectedPath), `${name} should load its versioned ordinary summon card`);
      assert(isVersionedWebp(art.avatarPath), `${name} should load a versioned battlefield avatar`);
      assert(art.cutinPath === undefined, `${name} must not receive an advanced-summon cut-in`);
      const summon = makeFighter(`${name}@普通召唤头像测试`);
      summon.name = name;
      summon.summonBaseName = name;
      summon.isSummon = true;
      summon.isAdvancedSummon = false;
      assert(getStageFighterImage(summon) === art.avatarPath, `${name} should replace its battlefield emoji with the supplied avatar`);
    });
    ['史尔特尔', '青眼白龙', '青眼究极龙', '翼神龙', '黑暗大法师'].forEach((name) => {
      const art = getSummonCardArt(name);
      assert(isVersionedAsset(art.imagePath, art.expectedPath), `${name} should load its versioned card image`);
      assert(isVersionedWebp(art.cutinPath), `${name} should load a versioned transparent summon cut-in`);
      assert(isVersionedWebp(art.avatarPath), `${name} should load a versioned battlefield avatar`);
      const summon = makeFighter(`${name}@头像测试`);
      summon.name = name;
      summon.summonBaseName = name;
      summon.isSummon = true;
      summon.isAdvancedSummon = true;
      assert(getStageFighterImage(summon) === art.avatarPath, `${name} should replace its battlefield emoji with the supplied avatar`);
      assert(getStageFinisherImage(summon) === art.cutinPath, `${name} finishers should use the supplied transparent cut-in instead of the battlefield avatar`);
      assert(getStageFinisherImage(summon) !== getStageFighterImage(summon), `${name} battlefield and finisher art must stay as separate assets`);
    });
    EXODIA_STAR_ORDER.forEach((name) => {
      const art = getSummonCardArt(name);
      assert(isVersionedAsset(art.imagePath, art.expectedPath), `${name} should load its versioned component card`);
    });
    const shuffled = ['被封印者的右足', '被封印者本体', '被封印者的右腕', '被封印者的左足', '被封印者的左腕'];
    assert(orderExodiaMaterials(shuffled).join('|') === EXODIA_STAR_ORDER.join('|'), 'Exodia components should always occupy their fixed pentagram vertices');
    cases.push('summons and Exodia components have complete, deterministic card-art slots');
  }

  {
    const source = [makeFighter('快照未变化者@A'), makeFighter('快照变化者@B')];
    const first = reconcileFighterSnapshots(source);
    const semanticallyEqual = reconcileFighterSnapshots(cloneFighters(source), first);
    assert(semanticallyEqual === first, 'An unchanged playback frame should reuse the roster array');
    assert(semanticallyEqual[0] === first[0] && semanticallyEqual[1] === first[1], 'Unchanged fighters should retain stable object identities');

    const changedSource = cloneFighters(source);
    changedSource[1].currentHp -= 123;
    changedSource[1].hpPct = changedSource[1].currentHp / changedSource[1].maxHp;
    applyStatus(changedSource[1], {
      identityId: 'BURN',
      potency: 1,
      count: 2,
      attribution: { effectSourceId: 'architecture-snapshot' },
    });
    const second = reconcileFighterSnapshots(changedSource, first);
    assert(second !== first, 'A changed playback frame should receive a new roster array');
    assert(second[0] === first[0], 'Unchanged fighters should be structurally shared across log snapshots');
    assert(second[1] !== first[1] && first[1].statuses.length === 0, 'Changed fighter state should be cloned without mutating the previous log snapshot');

    changedSource[0].jobData.skills.push('snapshot_test_skill');
    const third = reconcileFighterSnapshots(changedSource, second);
    assert(third[0] !== second[0] && !second[0].jobData.skills.includes('snapshot_test_skill'), 'In-place job skill changes should invalidate only the affected fighter snapshot');
    cases.push('playback snapshots structurally share unchanged fighters without losing state isolation');
  }

  {
    const attacker = makeFighter('伤害同步攻击者@A');
    const target = makeFighter('伤害同步目标@B');
    attacker.atk = 160;
    target.def = 0;
    const roster = localProject.cloneFighters([attacker, target]);
    const snapshots: Array<{ event: BattleEvent; targetHp: number }> = [];
    const events: BattleEvent[] = [];
    const engine = new localProject.BattleEngine(
      roster,
      (event) => snapshots.push({ event, targetHp: roster[1].currentHp }),
      localProject.jobs,
      localProject.skills,
      localProject.data,
      localProject.core,
      0,
      createBattleState(20260714),
      (event) => events.push(event),
    );
    const hpBefore = roster[1].currentHp;
    engine.executeSkillAction(null, roster[0], roster[1]);
    const checkpoint = snapshots.find(({ event }) => event.displayInFeed === false);
    assert(checkpoint, 'A damaging action should emit a hidden post-settlement state checkpoint');
    assert(checkpoint!.targetHp < hpBefore, 'The hidden checkpoint should capture target HP after damage has settled');
    assert(checkpoint!.event.actionId && checkpoint!.event.targetIds?.includes(roster[1].id), 'The state checkpoint should stay attached to the causing action and target');
    assert(events.some((event) => event.id === checkpoint!.event.id), 'State checkpoints should remain available in deterministic replay data');
    cases.push('damage logs receive a post-settlement HP checkpoint in the same action');
  }

  {
    const fighters = [
      makeFighter('大回合极速者@A'),
      makeFighter('大回合慢速者甲@B'),
      makeFighter('大回合慢速者乙@C'),
      makeFighter('大回合慢速者丙@D'),
    ];
    fighters[0].spd = 100000;
    fighters.slice(1).forEach((fighter) => { fighter.spd = 1; });
    const state = createBattleState(17);
    const engine = makeProjectEngine(localProject, fighters, [], 0, state);
    const participantCount = state.largeRound.participantIds.length;
    let completedRound: number | undefined;
    let actions = 0;

    while (completedRound === undefined && actions <= participantCount * 2) {
      const priorityIds = getLargeRoundPriorityActorIds(state, engine.fighters);
      const actor = withBattleRandom(state, () => engine.determineActor(activePlayers(engine.fighters), priorityIds));
      assert(actor, 'Large-round scheduler should always find an active participant');
      completedRound = noteLargeRoundActor(state, engine.fighters, actor);
      actions += 1;
    }

    assert(completedRound === 1, 'Large round should complete under an extreme speed skew');
    assert(actions <= participantCount * 2, `Large round exceeded its ${participantCount * 2}-action hard cap with ${actions} actions`);
    assert(state.largeRound.actedIds.length === participantCount, 'Every snapshotted participant should act before round completion');
    assert(state.largeRound.number === 1, 'Completed round should remain visible until its final action settles');
    consumeCompletedLargeRound(state, engine.fighters);
    assert(Number(state.largeRound.number) === 2 && state.largeRound.actedIds.length === 0, 'Next large round should start only after completion is consumed');
    cases.push('large rounds are bounded and advance after final-action settlement');
  }

  {
    const playerA = makeFighter('轮次快照甲@A');
    const playerB = makeFighter('轮次快照乙@B');
    const slacker = makeFighter('轮次场外者@C');
    const summon = makeFighter('轮次召唤物@D');
    const npc = makeFighter('轮次NPC@E');
    applyStatus(slacker, {
      identityId: 'SYNERGY_SLACKING',
      remainingTurns: 5,
      attribution: { effectSourceId: 'architecture-large-round' },
    });
    summon.isSummon = true;
    npc.isNpc = true;
    npc.cannotAct = true;
    npc.cannotWin = true;
    const fighters = [playerA, playerB, slacker, summon, npc];
    const state = createBattleState(23);
    syncLargeRoundState(state, fighters);
    assert(state.largeRound.participantIds.length === 2, 'Large-round roster should exclude field-away players, summons, and NPCs');

    const newcomer = makeFighter('轮次中途入场者@F');
    fighters.push(newcomer);
    syncLargeRoundState(state, fighters);
    assert(!state.largeRound.participantIds.includes(newcomer.id), 'Mid-round entrants should not extend the active large round');
    noteLargeRoundActor(state, fighters, playerA);
    noteLargeRoundActor(state, fighters, playerB);
    consumeCompletedLargeRound(state, fighters);
    assert(state.largeRound.participantIds.includes(newcomer.id), 'Mid-round entrants should join the next large-round snapshot');
    cases.push('large-round roster snapshots exclude off-field entities and defer entrants');
  }

  {
    const actor = makeFighter('退场收束行动者@A');
    const defeatedA = makeFighter('退场收束目标甲@B');
    const defeatedB = makeFighter('退场收束目标乙@C');
    const fighters = [actor, defeatedA, defeatedB];
    const state = createBattleState(29);
    syncLargeRoundState(state, fighters);
    noteLargeRoundActor(state, fighters, actor);
    [defeatedA, defeatedB].forEach((fighter) => {
      fighter.currentHp = 0;
      fighter.isDead = true;
    });
    const completed = syncLargeRoundState(state, fighters);
    assert(completed === 1 && state.completedLargeRound === 1, 'Removing every unacted participant should complete the current large round immediately');
    assert(state.largeRound.actedIds.length === 1 && state.largeRound.participantIds.length === 1, 'Roster contraction should preserve the actor that already moved');
    cases.push('large rounds complete immediately when all unacted participants leave');
  }

  {
    const fighter = makeFighter('临时属性测试@A');
    fighter.atk = 100;
    applyStatus(fighter, {
      identityId: 'GAMER_RUSH_B',
      remainingTurns: 3,
      componentPotencies: { ATK_UP: 50, SPD_UP: 100 },
      attribution: { effectSourceId: 'architecture-atk' },
    });
    assert(getEffectiveCombatStat(fighter, 'atk') === 150, `Temporary status should affect the calculated stat once, got ${getEffectiveCombatStat(fighter, 'atk')}`);
    applyStatus(fighter, {
      identityId: 'GAMER_RUSH_B',
      remainingTurns: 3,
      componentPotencies: { ATK_UP: 100, SPD_UP: 100 },
      attribution: { effectSourceId: 'architecture-atk' },
    });
    assert(getEffectiveCombatStat(fighter, 'atk') === 200, `Refreshing a status should recompute from the raw stat instead of stacking exponentially, got ${getEffectiveCombatStat(fighter, 'atk')}`);
    applyPermanentStatBuff(fighter, { atk: 1.5 });
    assert(Number(fighter.atk) === 150 && getEffectiveCombatStat(fighter, 'atk') === 300, `Permanent growth should update the raw stat before the temporary layer, got raw ${fighter.atk} / effective ${getEffectiveCombatStat(fighter, 'atk')}`);
    removeEffects(fighter, { identityIds: ['GAMER_RUSH_B'], reason: 'expired' });
    assert(Number(fighter.atk) === 150 && getEffectiveCombatStat(fighter, 'atk') === 150, `Expired status should leave the permanent raw stat intact, got ${getEffectiveCombatStat(fighter, 'atk')}`);
    cases.push('temporary status calculators refresh and roll back against permanent stats');
  }

  {
    const projectRoot = process.cwd();
    const legacyModules = [
      'lib/namearena/statusLifecycle.ts',
      'lib/namearena/statusRules.ts',
      'lib/namearena/statModifiers.ts',
    ];
    legacyModules.forEach((path) => {
      assert(!existsSync(join(projectRoot, path)), `Legacy status module must stay deleted: ${path}`);
    });

    const productionFiles = [
      ...collectTypeScriptFiles(join(projectRoot, 'lib/namearena')),
      ...collectTypeScriptFiles(join(projectRoot, 'components/namearena')),
    ];
    const forbiddenSymbols = [
      'StatusEntry',
      'legacyType',
      'timedStatModifiers',
      'timedStatBase',
      'baseStatsForZero',
      'savedStats',
      'savedSpd',
      'savedAgl',
      'originiumInfectionStacks',
      'originiumStatMultipliers',
      'yuzuShield',
      'puruisaishiShield',
      'STATUS_EFFECTS',
      'WT_AIRBORNE',
      'deferAirborneLanding',
      'statusLifecycle',
      'statusRules',
      'statModifiers',
    ];
    productionFiles.forEach((path) => {
      const source = readFileSync(path, 'utf8');
      forbiddenSymbols.forEach((symbol) => {
        assert(!source.includes(symbol), `${relative(projectRoot, path)} must not reference legacy status symbol ${symbol}`);
      });
      assert(
        !/\b(?:fighter|actor|target|user|enemy|ally|summon|owner|candidate|tgt)\.status\b/.test(source),
        `${relative(projectRoot, path)} must use fighter.statuses instead of the removed fighter.status field`,
      );
      assert(
        !/(?:duration|remainingTurns)\s*:\s*999\b/.test(source),
        `${relative(projectRoot, path)} must not encode permanent status lifetime as 999 turns`,
      );
      for (const match of source.matchAll(/\bidentityId\s*:\s*['"]([A-Z0-9_:-]+)['"]/g)) {
        const identityId = match[1];
        assert(Boolean(STATUS_IDENTITIES[identityId] || BARRIER_IDENTITIES[identityId]), `${relative(projectRoot, path)} references unregistered identity ${identityId}`);
      }
    });

    const unauthorizedFormMutations = collectTypeScriptFiles(join(projectRoot, 'lib/namearena'))
      .flatMap(findUnauthorizedFormMutations);
    assert(
      unauthorizedFormMutations.length === 0,
      `Runtime form fields must change only through commitFormTransition (initializers are explicitly allowlisted): ${unauthorizedFormMutations.join(', ')}`,
    );
    const deferredFlushOrderingIssues = collectTypeScriptFiles(join(projectRoot, 'lib/namearena'))
      .flatMap(findDeferredFlushBeforeResultLogs);
    assert(
      deferredFlushOrderingIssues.length === 0,
      `Direct-hit result logs must precede full fate/status flushing: ${deferredFlushOrderingIssues.join(', ')}`,
    );
    const manualTransformationCueFiles = collectTypeScriptFiles(join(projectRoot, 'lib/namearena'))
      .filter((path) => {
        const normalizedPath = path.replace(/\\/g, '/');
        return !normalizedPath.endsWith('/battlePresentation.ts') && !normalizedPath.endsWith('/types.ts');
      })
      .filter((path) => /visualCue\s*:\s*\{[\s\S]{0,240}?kind\s*:\s*['"]transformation['"]/.test(readFileSync(path, 'utf8')));
    assert(
      manualTransformationCueFiles.length === 0,
      `Transformation cues must be emitted by commitFormTransition: ${manualTransformationCueFiles.map((path) => relative(projectRoot, path)).join(', ')}`,
    );

    const metadataAwareSkillFiles = [
      join(projectRoot, 'lib/namearena/skills/momo.ts'),
      join(projectRoot, 'lib/namearena/skills/owl.ts'),
      join(projectRoot, 'lib/namearena/skills/yuzu.ts'),
    ];
    metadataAwareSkillFiles.forEach((path) => {
      const source = readFileSync(path, 'utf8');
      assert(
        !/log\s*:\s*\(\s*type\s*,\s*text\s*\)\s*=>\s*ctx\.log\s*\(\s*type\s*,\s*text\s*\)/.test(source),
        `${relative(projectRoot, path)} must forward BattleLogMetadata through nested mechanic runtimes`,
      );
    });

    productionFiles
      .filter((path) => !path.replace(/\\/g, '/').endsWith('/statusSystem.ts'))
      .forEach((path) => {
        const source = readFileSync(path, 'utf8');
      assert(
        !/\.statuses\.(?:push|splice|pop|shift|unshift|sort|reverse)\s*\(|\.statuses\s*=/.test(source),
        `${relative(projectRoot, path)} must mutate statuses through statusSystem`,
      );
      assert(
        !/\.(?:potency|count|remainingTurns|charges)\s*(?:\+\+|--|[+\-*/]?=(?!=))/.test(source),
        `${relative(projectRoot, path)} must mutate status values through statusSystem`,
      );
      assert(
        !/\.barriers\.(?:push|splice|pop|shift|unshift|sort|reverse)\s*\(|\.barriers\s*=/.test(source),
        `${relative(projectRoot, path)} must mutate barriers through statusSystem`,
      );
      });

    const strictConsumerFiles = productionFiles.filter((path) => {
      const normalizedPath = path.replace(/\\/g, '/');
      return normalizedPath.includes('/lib/namearena/skills/') ||
        normalizedPath.includes('/lib/namearena/characterHooks/') ||
        normalizedPath.includes('/components/namearena/');
    });
    strictConsumerFiles.forEach((path) => {
      const source = readFileSync(path, 'utf8');
      assert(
        !/\.statuses(?:\.|\[)/.test(source),
        `${relative(projectRoot, path)} must query statuses through the unified service`,
      );
    });

    const presentationConsumers = productionFiles.filter((path) => {
      const source = readFileSync(path, 'utf8');
      const normalizedPath = path.replace(/\\/g, '/');
      return source.includes('STATUS_IDENTITY_PRESENTATION') &&
        !normalizedPath.endsWith('/statusRegistry.ts') &&
        !normalizedPath.endsWith('/data/constants.ts');
    });
    assert(
      presentationConsumers.length === 0,
      `Only statusRegistry may consume presentation seeds: ${presentationConsumers.map((path) => relative(projectRoot, path)).join(', ')}`,
    );

    const directReviveCleanupFiles = productionFiles.filter((path) => {
      const normalizedPath = path.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/statusMechanics.ts')) return false;
      return /removeEffects\s*\([\s\S]{0,220}?reason\s*:\s*['"]revive['"]/.test(readFileSync(path, 'utf8'));
    });
    assert(
      directReviveCleanupFiles.length === 0,
      `Revival cleanup must preserve event-persistent statuses through clearReviveEffects: ${directReviveCleanupFiles.map((path) => relative(projectRoot, path)).join(', ')}`,
    );

    Object.values(STATUS_IDENTITIES).forEach((identity) => {
      const mechanicIds = [identity.mechanicId, ...(identity.components ?? []).map((component) => component.mechanicId)];
      mechanicIds.forEach((mechanicId) => {
        assert(Boolean(STATUS_MECHANICS[mechanicId]), `${identity.identityId} references unregistered mechanic ${mechanicId}`);
      });
    });
    Object.entries(BARRIER_IDENTITIES).forEach(([identityId, identity]) => {
      assert(identity.identityId === identityId, `Barrier identity key mismatch: ${identityId}/${identity.identityId}`);
    });
    cases.push('production status architecture has one strict registry and mutation pipeline');
  }

  {
    Object.entries(STATUS_IDENTITIES).forEach(([identityId, identity]) => {
      assert(identity.identityId === identityId, `Status identity key mismatch: ${identityId}/${identity.identityId}`);
      const fighter = makeFighter(`目录验收-${identityId}@A`);
      const result = applyStatus(fighter, {
        identityId,
        attribution: {
          effectSourceId: `catalog:${identityId}`,
          effectSourceName: '目录验收',
          applierId: 'catalog-applier',
          applierName: '目录施加者',
        },
      });
      const expectedMechanics = new Set(
        identity.components?.map((component) => component.mechanicId) ?? [identity.mechanicId],
      );
      assert(result.statuses.length === expectedMechanics.size, `${identityId} should materialize one instance per declared mechanic`);
      result.statuses.forEach((status) => {
        assert(expectedMechanics.has(status.mechanicId), `${identityId} materialized undeclared mechanic ${status.mechanicId}`);
        assert(status.attribution.effectSourceId === `catalog:${identityId}`, `${identityId} lost effect-source attribution`);
      });
      const presentation = buildFighterStatusPresentation(fighter);
      const presentedIds = new Set(presentation.flatMap((item) => item.members.map((member) => member.key)));
      assert(result.statuses.every((status) => presentedIds.has(status.instanceId)), `${identityId} did not expose every mechanic through its themed status card`);
      const removed = removeEffects(fighter, { identityIds: [identityId], reason: 'scripted' });
      assert(removed.length === result.statuses.length && fighter.statuses.length === 0, `${identityId} did not leave through the unified removal service`);
    });
    cases.push('every registered status materializes, presents, attributes, and removes through the unified service');
  }

  {
    Object.values(BARRIER_IDENTITIES).forEach((identity) => {
      const fighter = makeFighter(`护盾目录验收-${identity.identityId}@A`);
      const barrier = grantBarrier(fighter, 25, {
        identityId: identity.identityId,
        sourceId: `catalog:${identity.identityId}`,
        displayName: identity.displayName,
        attribution: { effectSourceId: `catalog:${identity.identityId}` },
      });
      if (!barrier) throw new Error(`${identity.identityId} unexpectedly rejected a positive barrier grant`);
      const presentation = buildFighterStatusPresentation(fighter);
      assert(barrier.identityId === identity.identityId, `${identity.identityId} lost its registered barrier identity`);
      assert(presentation.some((item) => item.kind === 'barrier' && item.members.some((member) => member.key === barrier.id)), `${identity.identityId} did not expose its barrier presentation`);
    });
    cases.push('every registered barrier validates and presents through the unified effect service');
  }

  {
    const fighter = makeFighter('状态生命周期测试@A');
    const spellBlock = applyStatus(fighter, {
      identityId: 'SPELL_BLOCK',
      charges: 2,
      attribution: { effectSourceId: 'architecture' },
    }).primary;
    assert(spellBlock.charges === 2 && spellBlock.remainingTurns === undefined, 'Spell block should expose charges without a turn duration');
    assert(formatStatusValue(spellBlock) === '2次', `Spell block UI should display charges, got ${formatStatusValue(spellBlock)}`);
    consumeStatusValue(fighter, spellBlock, 'charges');
    assert(fighter.statuses.includes(spellBlock) && Number(spellBlock.charges) === 1, 'First spell block trigger should consume exactly one charge');
    consumeStatusValue(fighter, spellBlock, 'charges');
    assert(!fighter.statuses.includes(spellBlock), 'Second spell block trigger should remove the exhausted status');

    const counter = applyStatus(fighter, {
      identityId: 'CTR_CHARM',
      remainingTurns: 5,
      charges: 1,
      attribution: { effectSourceId: 'architecture-counter' },
    }).primary;
    assert(counter.remainingTurns === 5 && counter.charges === 1, 'Counter stance should separate owner-turn expiry from its one trigger');
    assert(formatStatusValue(counter) === '5次自身行动机会 · 1次', `Counter UI should display both clocks, got ${formatStatusValue(counter)}`);
    consumeStatusValue(fighter, counter, 'charges');
    assert(fighter.statuses.length === 0, 'Counter stance should disappear after its single trigger even with turns remaining');

    const permanentRage = applyStatus(fighter, {
      identityId: 'RABBIT_STYLE_RAGE',
      attribution: { effectSourceId: 'architecture-permanent' },
    }).primary;
    assert(permanentRage.expiresOn === 'never' && permanentRage.remainingTurns === undefined, 'Permanent statuses should have no turn counter');
    assert(!/999|回合|行动机会/.test(formatStatusValue(permanentRage)), 'Permanent statuses should not expose a fake turn label');

    const flatAttack = applyStatus(fighter, {
      identityId: 'ATK_FLAT_UP',
      potency: 18,
      remainingTurns: 2,
      attribution: { effectSourceId: 'architecture-flat-stat' },
    }).primary;
    assert(formatStatusValue(flatAttack) === '18点 · 2次自身行动机会', `Flat stat status should use points instead of percent, got ${formatStatusValue(flatAttack)}`);
    const crowdJoy = applyStatus(fighter, {
      identityId: 'MOMO_CROWD_JOY',
      potency: 42,
      attribution: { effectSourceId: 'architecture-crowd-joy' },
    }).primary;
    assert(formatStatusValue(crowdJoy) === '42/138层', `Crowd joy should expose stacks and cap, got ${formatStatusValue(crowdJoy)}`);
    const owlWild = applyStatus(fighter, {
      identityId: 'OWL_WILD',
      potency: 3,
      attribution: { effectSourceId: 'architecture-owl-wild' },
    }).primary;
    assert(formatStatusValue(owlWild) === '3/5层', `Owl wild should expose stacks and cap, got ${formatStatusValue(owlWild)}`);
    const poison = applyStatus(fighter, {
      identityId: 'POISON',
      potency: 2,
      remainingTurns: 3,
      attribution: { effectSourceId: 'architecture-poison' },
    }).primary;
    assert(formatStatusValue(poison) === '2层 · 3次自身行动机会', `Poison should expose stacks and its settlement clock, got ${formatStatusValue(poison)}`);
    const poisonPresentation = buildFighterStatusPresentation(fighter).find((item) =>
      item.members.some((member) => member.key === poison.instanceId),
    );
    assert(poisonPresentation?.valueLabel === '2层 · 3次自身行动机会', `Poison presentation should consume the canonical value label exactly once, got ${poisonPresentation?.valueLabel}`);
    cases.push('status duration, trigger charges, and UI labels are independent');
  }

  {
    const fighter = makeFighter('击飞刷新测试@A');
    applyStatus(fighter, {
      identityId: 'AIRBORNE',
      remainingTurns: 1,
      attribution: { effectSourceId: 'first-launch', applierId: 'first-attacker' },
    });
    applyStatus(fighter, {
      identityId: 'AIRBORNE',
      remainingTurns: 1,
      attribution: { effectSourceId: 'second-launch', applierId: 'second-attacker' },
    });
    const airborne = queryMechanic(fighter, 'AIRBORNE').entries;
    assert(airborne.length === 1, 'Repeated airborne applications must leave one pending landing');
    assert(airborne[0]?.attribution.effectSourceId === 'second-launch', 'Airborne refresh should attribute the landing to the latest launch');
    cases.push('airborne refreshes one landing across different sources');
  }

  {
    const attacker = makeFighter('权威统计攻击者@A');
    const target = makeFighter('权威统计目标@B');
    target.maxHp = 100;
    localProject.setCurrentHp(target, 100);
    const { engine } = makeDeathEngine([attacker, target]);
    const options: DamageApplicationOptions = {};
    const actual = engine.applyDamage(engine.fighters[1], 150, 'skill', true, engine.fighters[0], options);
    assert(actual === 100 && engine.fighters[1].currentHp === 0, `Lethal settlement should clamp to 100 actual HP damage, got ${actual}`);
    assert(options.resolution?.outcome === 'hp_damage' && options.resolution.overkillDamage === 50, 'Damage resolution should retain HP damage and overkill separately');
    assert(engine.fighters[0].stats.dmgDealt === 100 && engine.fighters[0].stats.overkillDmg === 50, 'Attacker ledger should count effective damage and overkill separately');
    assert(engine.fighters[1].stats.dmgTaken === 100, 'Target ledger should count actual HP loss only');

    const shieldAttacker = makeFighter('护盾统计攻击者@A');
    const shieldTarget = makeFighter('护盾统计目标@B');
    grantBarrier(shieldTarget, 40, {
      sourceId: 'YUZU_BARRIER',
      displayName: '护盾',
      attribution: { effectSourceId: 'architecture-shield' },
    });
    const shieldFixture = makeDeathEngine([shieldAttacker, shieldTarget]);
    const shieldOptions: DamageApplicationOptions = {};
    const shieldActual = shieldFixture.engine.applyDamage(
      shieldFixture.engine.fighters[1],
      30,
      'skill',
      true,
      shieldFixture.engine.fighters[0],
      shieldOptions,
    );
    assert(shieldActual === 0 && shieldOptions.resolution?.outcome === 'shielded', 'Fully absorbed damage should have an explicit shielded outcome');
    assert(shieldFixture.engine.fighters[0].stats.shieldDmgDealt === 30, 'Shield damage should be credited without inventing HP damage');

    const blockedAttacker = makeFighter('抵挡统计攻击者@A');
    const blockedTarget = makeFighter('抵挡统计目标@B');
    applyStatus(blockedTarget, {
      identityId: 'SPELL_BLOCK',
      charges: 1,
      attribution: { effectSourceId: 'morphling_linken_sphere' },
    });
    const blockedFixture = makeDeathEngine([blockedAttacker, blockedTarget]);
    const blockedOptions: DamageApplicationOptions = { respectDefenses: true };
    const blockedActual = blockedFixture.engine.applyDamage(
      blockedFixture.engine.fighters[1],
      50,
      'skill',
      false,
      blockedFixture.engine.fighters[0],
      blockedOptions,
    );
    assert(blockedActual === 0 && blockedOptions.resolution?.outcome === 'spell_blocked', 'Spell block should produce a typed zero-damage outcome');
    assert(blockedFixture.engine.fighters[0].stats.dmgDealt === 0, 'Blocked damage should not inflate attacker damage statistics');
    cases.push('damage ledger separates HP, shields, overkill, and blocked outcomes');
  }

  {
    let nextHandle = 0;
    const timers = new Map<number, () => void>();
    const frames = new Map<number, FrameRequestCallback>();
    const host: StageAnimationHost = {
      setTimeout: (callback) => {
        const handle = ++nextHandle;
        timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => { timers.delete(handle); },
      requestAnimationFrame: (callback) => {
        const handle = ++nextHandle;
        frames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle) => { frames.delete(handle); },
    };
    const flush = () => {
      const timerBatch = [...timers.entries()];
      timers.clear();
      timerBatch.forEach(([, callback]) => callback());
      const frameBatch = [...frames.entries()];
      frames.clear();
      frameBatch.forEach(([, callback]) => callback(16));
    };
    const scheduler = new StageAnimationScheduler(host);
    const fired: string[] = [];
    const staleGeneration = scheduler.begin('action');
    scheduler.after('action', 100, () => fired.push('stale'), staleGeneration);
    const currentGeneration = scheduler.begin('action');
    scheduler.frame('action', () => fired.push('current'), currentGeneration);
    flush();
    assert(fired.join(',') === 'current', `Superseded stage callbacks should be cancelled, got ${fired.join(',')}`);
    scheduler.after('impact', 100, () => fired.push('impact'));
    scheduler.frame('popup:1', () => fired.push('popup'));
    assert(scheduler.pendingCount() === 2, 'Stage scheduler should account for pending work across scopes');
    scheduler.after('cinematic-followup:old-action', 100, () => fired.push('old-followup'));
    scheduler.after('cinematic-followup:new-action', 100, () => fired.push('new-followup'));
    scheduler.after('unrelated', 100, () => fired.push('unrelated'));
    scheduler.cancelPrefix('cinematic-followup:');
    assert(scheduler.pendingCount() === 3, 'Cancelling cinematic follow-ups should preserve unrelated stage work');
    scheduler.reset();
    assert(scheduler.pendingCount() === 0 && timers.size === 0 && frames.size === 0, 'Stage reset should cancel every timer and animation frame');
    assert(scheduler.trackedScopeCount() === 0, 'Stage reset should release dynamic scope generations instead of retaining them across battles');
    flush();
    assert(
      !fired.includes('impact') &&
      !fired.includes('popup') &&
      !fired.includes('old-followup') &&
      !fired.includes('new-followup') &&
      !fired.includes('unrelated'),
      'Callbacks cancelled by a prefix or reset must stay stale after scope generations are cleared',
    );
    scheduler.dispose();
    assert(scheduler.after('disposed', 0, () => fired.push('disposed')) === null, 'Disposed scheduler should reject new work');
    cases.push('stage animation scheduler cancels stale actions and releases pending work');
  }

  {
    const firstState = createBattleState(31337);
    const first = createBattlePlaybackView<StageLogEntry>(firstState);
    const fighters = [makeFighter('播放帧甲@A'), makeFighter('播放帧乙@B')];
    const visibleLog: StageLogEntry = {
      type: 'skill',
      text: '播放帧甲发动了测试技能。',
      actionId: 'atomic-action-1',
      actorId: fighters[0].id,
      turn: 1,
      largeRound: 1,
    };
    const committed = commitBattlePlaybackView(first, {
      fighters,
      battleTurn: 1,
      battleState: createBattleState(31337, 1),
      log: visibleLog,
    });
    assert(first.fighters.length === 0 && first.feed.logs.length === 0, 'Atomic playback commits must not mutate the previous UI frame');
    assert(committed.fighters === fighters && committed.battleTurn === 1, 'Atomic playback should publish roster and turn in the same frame');
    assert(committed.feed.logs[0] === visibleLog && committed.feed.groups.length === 1, 'Atomic playback should publish the matching log with its fighter frame');

    const hiddenLog: StageLogEntry = { type: 'info', text: '隐藏状态检查点', displayInFeed: false };
    const hiddenCommit = commitBattlePlaybackView(committed, {
      fighters: cloneFighters(fighters),
      battleTurn: 2,
      battleState: createBattleState(31337, 2),
      log: hiddenLog,
    });
    assert(hiddenCommit.feed === committed.feed, 'Hidden state checkpoints should reuse the visible feed while advancing the fighter frame');

    const synchronizedQueue = [{
      fighters,
      battleTurn: 1,
      battleState: createBattleState(31337, 1),
      log: visibleLog,
    }];
    const damagedFighters = cloneFighters(fighters);
    damagedFighters[1]!.currentHp -= 25;
    enqueueBattlePlaybackCommit(synchronizedQueue, {
      fighters: damagedFighters,
      battleTurn: 1,
      battleState: createBattleState(31337, 1),
      log: {
        type: 'system',
        text: `state-sync:${damagedFighters[1]!.id}`,
        displayInFeed: false,
        actionId: visibleLog.actionId,
        rootEventId: 'root-atomic-action-1',
      },
    });
    assert(synchronizedQueue.length === 1, 'A hidden damage checkpoint should merge into its preceding visible action frame');
    assert(
      synchronizedQueue[0]!.fighters[1]!.currentHp === fighters[1]!.currentHp - 25,
      'The visible damage log and resulting HP must be published in the same playback frame',
    );
    enqueueBattlePlaybackCommit(synchronizedQueue, {
      fighters: cloneFighters(damagedFighters),
      battleTurn: 1,
      battleState: createBattleState(31337, 1),
      log: { type: 'system', text: 'unowned-hidden-checkpoint', displayInFeed: false },
    });
    assert(Number(synchronizedQueue.length) === 2, 'Unowned hidden checkpoints must not overwrite an unrelated visible frame');

    let cappedFeed = committed.feed;
    for (let index = 0; index < 260; index += 1) {
      cappedFeed = appendBattleFeedEntry(cappedFeed, { type: 'info', text: `日志 ${index}`, id: `cap-${index}` });
    }
    assert(cappedFeed.logs.length === 240 && cappedFeed.groups.length <= 16, 'Playback feed should keep bounded visible logs and action groups');
    cases.push('battle playback publishes synchronized atomic frames with bounded feed memory');
  }

  {
    const ordinary = makeFighter('素材预载普通角色@A');
    const ordinaryManifest = collectStageAssetManifest([ordinary]);
    assert(ordinaryManifest.deferred.length === 0, 'A roster without gacha summons should not preload the full summon library');

    const gacha = makeFighter('牢鳄@素材预载');
    gacha.isGacha = true;
    const gachaManifest = collectStageAssetManifest([gacha]);
    assert(gachaManifest.deferred.length > 0, 'A gacha roster should idle-preload possible summon artwork');
    assert(new Set(gachaManifest.deferred).size === gachaManifest.deferred.length, 'Deferred stage assets should be deduplicated');
    assert(!gachaManifest.deferred.some((source) => gachaManifest.immediate.includes(source)), 'Immediate and deferred preload queues should not overlap');
    cases.push('stage asset manifests prioritize active roster art and defer summon libraries');
  }

  {
    const first = seededTrace(20260712);
    const replay = seededTrace(20260712);
    assert(first === replay, 'The same roster and seed should reproduce an identical structured battle trace');
    cases.push('seeded structured events replay deterministically');
  }

  {
    const issues = scanLogs([
      { type: 'info', text: '💥 地狱笑话命中 鸮，实际造成 300 点魔法伤害！' },
      { type: 'debuff', text: '🌀 【谢幕返场】鸮 被地狱笑话扰乱，陷入 1 回合混乱！' },
      { type: 'info', text: '🦉 【不怕酸】鸮 削减 101 点伤害，剩余 300 点继续结算。' },
    ], '减伤时序扫描测试', ['鸮']);
    assert(issues.some((issue) => issue.type === 'result-before-mitigation'), 'Log scanner should flag a final damage result emitted before mitigation');
    const separatedIssues = scanLogs([
      { type: 'info', text: '📌 实际结算：柚子 实际承受 70 点伤害（原始预估 367）。' },
      { type: 'system', text: 'state-sync:test-target' },
      { type: 'info', text: '🪞 【镜界减伤】柚子 处于第 3 阶段，削减 27 点伤害。' },
      { type: 'skill', text: '🐲 【原子吐息】帝王之征 轰向 柚子，实际造成 144 点伤害！' },
    ], '减伤时序边界测试', ['柚子']);
    assert(!separatedIssues.some((issue) => issue.type === 'result-before-mitigation'), 'A state-sync boundary must keep consecutive attacks in separate causal chains');
    const redistributedIssues = scanLogs([
      { type: 'info', text: '📌 【|OMO结算】鸮 分得 515 点伤害，生命实际损失 515 点。', rootEventId: 'action-1' },
      { type: 'buff', text: '🦉 【天意侵蚀】鸮 由【骄兵】转入【败兵】。', rootEventId: 'action-1' },
      { type: 'info', text: '🦉 【败兵阵势】鸮 削减 131 点伤害，剩余 23 点继续结算。', rootEventId: 'action-1' },
      { type: 'skill', text: '🌑 黑气余波扫过 鸮，实际造成 23 点真实伤害！', rootEventId: 'action-1' },
    ], '分摊与后续余波边界测试', ['鸮']);
    assert(!redistributedIssues.some((issue) => issue.type === 'result-before-mitigation'), 'A redistribution settlement must not be paired with mitigation for a later damage packet');
    const crossTurnIssues = scanLogs([
      { type: 'poison', text: '🦠 【矿石病侵蚀】鸮 实际损失 18 点生命。', turn: 10 },
      { type: 'info', text: '🦉 鸮 处于【败兵】状态，无法行动！', turn: 11 },
      { type: 'info', text: '🦉 【败兵阵势】鸮 削减 103 点伤害，剩余 18 点继续结算。', turn: 11 },
    ], '跨回合重复结算边界测试', ['鸮']);
    assert(!crossTurnIssues.some((issue) => issue.type === 'result-before-mitigation'), 'Mitigation in a new turn must not be paired with the previous turn settlement');
    const multiHitThenStatusIssues = scanLogs([
      { type: 'skill', text: '🪞 【一码归一码】第 4/4 击抽到 盾牌（武器倍率+5%），命中 鸮，实际造成 42 点伤害。', rootEventId: 'action-yuzu', actionId: 'action-yuzu', turn: 20 },
      { type: 'buff', text: '🛡️ 【盾牌】柚子把 42 点命中伤害折成镜界护盾。', rootEventId: 'action-yuzu', actionId: 'action-yuzu', turn: 20 },
      { type: 'info', text: '🦉 【败兵阵势】鸮 削减 88 点伤害，剩余 15 点继续结算。', rootEventId: 'action-yuzu', turn: 20 },
      { type: 'poison', text: '🦠 【矿石病侵蚀】本次全局行动结束结算：鸮 实际损失 15 点生命。', rootEventId: 'action-yuzu', turn: 20 },
    ], '多段技能后状态减伤边界测试', ['鸮', '柚子']);
    assert(!multiHitThenStatusIssues.some((issue) => issue.type === 'result-before-mitigation'), 'A later status-damage mitigation must not be paired with the final hit of a multi-hit skill');
    const consecutiveStatusIssues = scanLogs([
      { type: 'info', text: '🦉 【不怕酸】鸮 削减 38 点伤害，剩余 111 点继续结算。', rootEventId: 'turn-30', turn: 30 },
      { type: 'poison', text: '🤢 【中毒】鸮 受到持续伤害，实际损失 111 点生命！', rootEventId: 'turn-30', turn: 30 },
      { type: 'info', text: '🦉 【不怕酸】鸮 削减 75 点伤害，剩余 224 点继续结算。', rootEventId: 'turn-30', turn: 30 },
      { type: 'info', text: '🌊 鸮 的【深渊水牢】本次没有穿透防护，生命未减少。', rootEventId: 'turn-30', turn: 30 },
    ], '连续状态伤害减伤边界测试', ['鸮']);
    assert(!consecutiveStatusIssues.some((issue) => issue.type === 'result-before-mitigation'), 'Mitigation for a following status packet must not be paired with the previous status settlement');
    const mitigationSubjectIssues = scanLogs([
      { type: 'info', text: '🩸 小汀 因【以命换命】反噬，实际损失 599 点生命！', rootEventId: 'action-trade', actionId: 'action-trade', turn: 40 },
      { type: 'info', text: '🧿 【适应转轮】表情 记录 小汀 的攻击模式，削减 203 点伤害并复制属性。', rootEventId: 'action-trade', actionId: 'action-trade', turn: 40 },
      { type: 'info', text: '📌 实际结算：表情 实际承受 474 点伤害。', rootEventId: 'action-trade', actionId: 'action-trade', turn: 40 },
    ], '减伤主语识别测试', ['小汀', '表情']);
    assert(!mitigationSubjectIssues.some((issue) => issue.type === 'result-before-mitigation'), 'A mitigation log must attribute reduction to its titled subject, not the attacker mentioned later in the sentence');
    const redirectedThenDirectAoeIssues = scanLogs([
      { type: 'crit', text: '🎭 【随机恶作剧】屑 将爆风余波转移给了倒霉的 柚子！', rootEventId: 'action-cas', actionId: 'action-cas', turn: 41 },
      { type: 'info', text: '🪞 【镜界减伤】柚子 处于第 3 阶段，削减 16 点伤害。', rootEventId: 'action-cas', actionId: 'action-cas', turn: 41 },
      { type: 'info', text: '🎭 转移伤害落在 柚子 身上，实际承受 81 点伤害！', rootEventId: 'action-cas', actionId: 'action-cas', turn: 41 },
      { type: 'info', text: '🪞 【镜界减伤】柚子 处于第 3 阶段，削减 16 点伤害。', rootEventId: 'action-cas', actionId: 'action-cas', turn: 41 },
      { type: 'crit', text: '💥 爆风余波波及！柚子 承受了 81 点真实伤害并被【火力压制】！', rootEventId: 'action-cas', actionId: 'action-cas', turn: 41 },
    ], '转移后再次直接命中边界测试', ['屑', '柚子']);
    assert(
      !redirectedThenDirectAoeIssues.some((issue) => issue.type === 'result-before-mitigation'),
      'A redirected hit and a later direct AOE hit on the same fighter must remain separate mitigation packets',
    );
    const repeatedNameIssues = scanLogs([
      { type: 'skill', text: '🔊 【扩音处刑】魔音刺向 2 名敌人：萨姆、萨姆！', rootEventId: 'action-2' },
      { type: 'death', text: '💀 【击杀】萨姆 被魔音贯耳，大脑宕机而亡！', rootEventId: 'action-2' },
      { type: 'info', text: '🔊 刺耳魔音贯耳！萨姆 实际承受 425 点真实精神伤害！', rootEventId: 'action-2' },
    ], '同名多目标测试', ['萨姆']);
    assert(!repeatedNameIssues.some((issue) => issue.type === 'dead-fighter-mentioned-as-target'), 'Repeated display names in one multi-target action must remain distinguishable to the scanner');
    const crossSubactionHealingIssues = scanLogs([
      {
        type: 'info',
        text: '🥀 【枯竭】萌月沫沫 的治疗被完全阻止！（枯竭 100%）',
        rootEventId: 'action-peaches',
        actionId: 'action-peach-3',
      },
      {
        type: 'info',
        text: '🌈 【奇迹炼成装甲】的彩虹装甲为 刺猬人 挡下了 萌月沫沫 的【！？桃桃？！】，但生命已满，治疗溢出！',
        rootEventId: 'action-peaches',
        actionId: 'action-peach-4',
      },
    ], '跨子攻击治疗边界测试', ['萌月沫沫', '刺猬人']);
    assert(
      !crossSubactionHealingIssues.some((issue) => issue.type === 'blocked-healing-described-as-full-health'),
      'Healing outcomes from separate child attacks must not be merged just because they share a root action',
    );
    const contradictoryHealingIssues = scanLogs([
      {
        type: 'info',
        text: '🥀 【枯竭】萌月沫沫 的治疗被完全阻止！（枯竭 100%）',
        rootEventId: 'action-heal',
        actionId: 'action-heal',
      },
      {
        type: 'heal',
        text: '🍑 萌月沫沫 生命已满，治疗溢出！',
        rootEventId: 'action-heal',
        actionId: 'action-heal',
      },
    ], '同次行动治疗矛盾测试', ['萌月沫沫']);
    assert(
      contradictoryHealingIssues.some((issue) => issue.type === 'blocked-healing-described-as-full-health'),
      'The scanner must still flag blocked and full-health outcomes for the same fighter in one action',
    );
    const prematureAftermathIssues = scanLogs([
      {
        type: 'crit',
        text: '💥 暴击！🛸 【歼灭·全弹发射】克蕾儿丝菲尔 的浮游炮齐射！对 刺猬人 造成 4 次打击，共 5208 伤害！（结算前预估；若伤害发生变化会追加实际结算，附加状态另行确认）',
        rootEventId: 'action-aftermath-order',
        actionId: 'action-aftermath-order',
        targetIds: ['tokusatsu-target'],
        turn: 50,
      },
      {
        type: 'buff',
        text: '🔥 【悲愿不倒】刺猬人 的奇迹怪兽武刃拒绝退场！',
        rootEventId: 'action-aftermath-order',
        actionId: 'action-aftermath-order',
        targetIds: ['tokusatsu-target'],
        turn: 50,
      },
      {
        type: 'poison',
        text: '🚀 【炮震坠落】刺猬人 从大口径冲击中重重落地，实际损失 114 点生命！',
        rootEventId: 'action-aftermath-order',
        actionId: 'action-aftermath-order',
        targetIds: ['tokusatsu-target'],
        turn: 50,
      },
      {
        type: 'info',
        text: '📌 实际结算：刺猬人 实际承受 3142 点伤害（原始预估 5208）。',
        rootEventId: 'action-aftermath-order',
        actionId: 'action-aftermath-order',
        targetIds: ['tokusatsu-target'],
        turn: 50,
      },
    ], '伤害后续抢跑测试', ['克蕾儿丝菲尔', '刺猬人']);
    assert(
      prematureAftermathIssues.some((issue) => issue.type === 'aftermath-before-damage-result'),
      'The scanner must reject death-save or landing aftermath emitted before its parent damage result',
    );
    const orderedAftermathIssues = scanLogs([
      {
        type: 'crit',
        text: '💥 暴击！🛸 【歼灭·全弹发射】克蕾儿丝菲尔 对 刺猬人 造成 5208 伤害！（结算前预估）',
        rootEventId: 'action-ordered-aftermath',
        actionId: 'action-ordered-aftermath',
        targetIds: ['tokusatsu-target'],
        turn: 51,
      },
      {
        type: 'info',
        text: '📌 实际结算：刺猬人 实际承受 3142 点伤害（原始预估 5208）。',
        rootEventId: 'action-ordered-aftermath',
        actionId: 'action-ordered-aftermath',
        targetIds: ['tokusatsu-target'],
        turn: 51,
      },
      {
        type: 'system',
        text: 'state-sync:tokusatsu-target',
        rootEventId: 'action-ordered-aftermath',
        actionId: 'action-ordered-aftermath',
        targetIds: ['tokusatsu-target'],
        turn: 51,
      },
      {
        type: 'buff',
        text: '🔥 【悲愿不倒】刺猬人 的奇迹怪兽武刃拒绝退场！',
        rootEventId: 'action-ordered-aftermath',
        actionId: 'action-ordered-aftermath',
        targetIds: ['tokusatsu-target'],
        turn: 51,
      },
    ], '伤害后续正确顺序测试', ['克蕾儿丝菲尔', '刺猬人']);
    assert(
      !orderedAftermathIssues.some((issue) => issue.type === 'aftermath-before-damage-result'),
      'The scanner must accept aftermath emitted after the authoritative damage result',
    );
    const removedDeathSaveIdentityIssues = scanLogs([
      {
        type: 'skill',
        text: '📿 【万法归无】剥夺了 刺猬人 的【悲愿抗性护层】、【悲愿不倒】，防护与反击链条被切断！',
        rootEventId: 'action-nullify',
        actionId: 'action-nullify',
        targetIds: ['tokusatsu-target'],
        turn: 52,
      },
      {
        type: 'info',
        text: '📌 实际结算：刺猬人 实际承受 499 点伤害（原始预估 994）。',
        rootEventId: 'action-nullify',
        actionId: 'action-nullify',
        targetIds: ['tokusatsu-target'],
        turn: 52,
      },
    ], '移除保命身份不是触发保命测试', ['水人', '刺猬人']);
    assert(
      !removedDeathSaveIdentityIssues.some((issue) => issue.type === 'aftermath-before-damage-result'),
      'Mentioning a removed death-save identity inside another skill must not be treated as aftermath',
    );
    cases.push('log scanner detects damage results emitted before mitigation without crossing state-sync boundaries');
  }

  return cases;
}
