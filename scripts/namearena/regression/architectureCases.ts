import {
  consumeCompletedLargeRound,
  createBattleState,
  getLargeRoundPriorityActorIds,
  noteLargeRoundActor,
  syncLargeRoundState,
  withBattleRandom,
} from '../../../lib/namearena/battleState';
import { grantStatus } from '../../../lib/namearena/defenseStatus';
import {
  cloneFighters,
  cloneJobDefinition,
  reconcileFighterSnapshots,
} from '../../../lib/namearena/combatState';
import {
  createCombatActorMotionPlan,
  TING_SELF_DESTRUCT_TIMELINE,
} from '../../../lib/namearena/combatActorMotion';
import {
  GACHA_COMBAT_EFFECT_IDS,
  resolveCombatEffect,
} from '../../../lib/namearena/combatEffects';
import { GACHA_NORMAL_POOL, GACHA_SSR_POOL } from '../../../lib/namearena/data/gachaPools';
import {
  GACHA_ORDINARY_SUMMON_NAMES,
  GACHA_SUMMON_LIFESTEAL_STATUS,
} from '../../../lib/namearena/gachaMechanics';
import {
  applyPermanentStatBuff,
  applyTimedStatModifier,
  cleanupOrphanedTimedStatModifiers,
  makeTimedStatModifier,
} from '../../../lib/namearena/statModifiers';
import {
  consumeStatusCharge,
  createLifecycleStatus,
  statusDurationText,
  tickStatusTurn,
} from '../../../lib/namearena/statusLifecycle';
import {
  appendStageLogGroup,
  buildStageLogGroups,
  createStagePositions,
  createVisibleStagePositionMap,
  getStageFinisherImage,
  getStageFighterImage,
  getStageFocusCycleKey,
  resolveStageManualFocusId,
  shouldRenderFighterOnStage,
  type StageLogEntry,
} from '../../../lib/namearena/battleStageModel';
import {
  appendBattleFeedEntry,
  commitBattlePlaybackView,
  createBattlePlaybackView,
} from '../../../lib/namearena/battlePlaybackModel';
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
  type LogEntry,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

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
      status: fighter.status,
    })),
    state,
  });
}

export function runArchitectureCases(): string[] {
  const cases: string[] = [];

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
      text: `${ting.name} 自爆卡车冲向目标。`,
      presentation: 'skill',
      type: 'skill',
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
    assert(randomExplosion?.motion === 'detonation', 'Random sacrifice attacks should derive their subtype from the resolved pool text');
    assert(randomExplosion?.actorMotion === 'melee_lunge', 'Charge-based random sacrifice attacks should move toward their target');
    assert(selfDestruct?.actorMotion === 'self_destruct_cling', 'Ting self-destruction should cling to the target before charging');
    assert(localProject.skills.suicide_bomb?.presentation === 'finisher', 'Ting self-destruction should be explicitly classified as a finisher');
    cases.push('Ting combat effects are structured by skill and random-pool subtype');
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
      deathEvents.some((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'gacha_death_save'),
      'Queued damage logs should preserve the Laoe death-save effect metadata',
    );
    assert(
      deathEvents.some((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'gacha_luck_gain'),
      'Luck gained during a queued death-save should preserve its effect metadata',
    );

    const lifestealOwner = makeFighter('牢鳄@吸血回流');
    lifestealOwner.transformed = true;
    lifestealOwner.jobData = { ...lifestealOwner.jobData, name: '欧皇' };
    localProject.setCurrentHp(lifestealOwner, Math.floor(lifestealOwner.maxHp * 0.4));
    lifestealOwner.gachaSummonLifestealPct = 0.35;
    lifestealOwner.status.push(createLifecycleStatus(GACHA_SUMMON_LIFESTEAL_STATUS, 4));
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
    const lifestealCue = lifestealEvents.find((event) => event.visualCue?.kind === 'combat_fx' && event.visualCue.effectId === 'gacha_lifesteal_proc')?.visualCue;
    assert(lifestealCue?.kind === 'combat_fx', 'Queued summon lifesteal should emit a combat effect');
    if (lifestealCue?.kind === 'combat_fx') {
      assert(lifestealCue.sourceId === summon.id, 'Summon lifesteal should originate from the summon that dealt damage');
      assert(lifestealCue.targetIds.includes(lifestealOwner.id), 'Summon lifesteal should terminate on Laoe');
    }
    cases.push('Laoe damage-triggered passives retain source, target, and effect metadata after deferred settlement');
  }

  {
    const firstAction = {
      id: 'focus-log-a',
      actionId: 'focus-action-a',
      actorId: 'actor-a',
      type: 'skill' as const,
      text: '行动者甲发动技能。',
    };
    const sameActionFollowUp = {
      ...firstAction,
      id: 'focus-log-a-2',
      text: '行动者甲结算技能。',
    };
    const nextAction = {
      ...firstAction,
      id: 'focus-log-b',
      actionId: 'focus-action-b',
      actorId: 'actor-b',
      text: '行动者乙发动技能。',
    };
    const firstFocusKey = getStageFocusCycleKey(firstAction, 7, 11, firstAction.actorId);
    const followUpFocusKey = getStageFocusCycleKey(sameActionFollowUp, 7, 11, sameActionFollowUp.actorId);
    const nextFocusKey = getStageFocusCycleKey(nextAction, 7, 12, nextAction.actorId);
    const manualFocus = { fighterId: 'inspected-fighter', focusCycleKey: firstFocusKey };
    assert(firstFocusKey === followUpFocusKey, 'Logs from one actor action should share a detail-card focus cycle');
    assert(resolveStageManualFocusId(manualFocus, followUpFocusKey) === 'inspected-fighter', 'Manual inspection should remain available during the current action');
    assert(resolveStageManualFocusId(manualFocus, nextFocusKey) === null, 'Manual inspection must expire when the next actor action starts');
    assert(
      getStageFocusCycleKey(firstAction, 8, 11, firstAction.actorId) !== firstFocusKey,
      'A new battle run must never restore a stale manual inspection',
    );
    cases.push('stage detail focus is temporary and resumes actor-following on the next action');
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
    const fighter = makeFighter('玄凝@形态快照');
    const events: BattleEvent[] = [];
    const engine = makeProjectEngine(localProject, [fighter], [], 0, undefined, events);
    const beforeJob = fighter.job;
    fighter.transformed = true;
    fighter.job = 'ALL_PLATFORM_CHAMPION';
    fighter.jobData = cloneJobDefinition(localProject.jobs.ALL_PLATFORM_CHAMPION!);
    engine.log('buff', `${fighter.name} 完成职业重构。`);
    const cue = events.find((event) => event.visible)?.visualCue;
    assert(cue?.kind === 'transformation', 'A real form mutation should emit a structured transformation cue');
    if (cue?.kind === 'transformation') {
      assert(cue.from.jobKey === beforeJob && cue.to.jobKey === 'ALL_PLATFORM_CHAMPION', 'Transformation cue should retain authoritative before/after jobs');
    }
    engine.log('transform', `${fighter.name} 只是重复播报当前职业。`);
    const visible = events.filter((event) => event.visible);
    assert(!visible[1]?.visualCue, 'A transform-like log without a form mutation must not replay a transformation');
    cases.push('transformation cinematics require an authoritative form delta');
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
        materials: ['栗子球', '史尔特尔'],
        tributes: 2,
      },
      {
        name: '翼神龙',
        kind: 'tribute',
        job: 'RA_WINGED_DRAGON',
        materials: ['栗子球', '史尔特尔', '海马'],
        tributes: 3,
      },
      {
        name: '青眼究极龙',
        kind: 'fusion',
        job: 'BLUE_EYES_ULTIMATE_DRAGON',
        materials: ['青眼白龙', '栗子球', '史尔特尔'],
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
    requiredCards.forEach((name) => {
      const art = getSummonCardArt(name);
      assert(art.key !== 'unassigned-card', `${name} should have a dedicated card-art slot`);
      assert(art.expectedPath.endsWith('.webp'), `${name} should expose its future card-art path`);
    });
    assert(new Set(SUMMON_CARD_ART_SLOTS.map((entry) => entry.expectedPath)).size === SUMMON_CARD_ART_SLOTS.length, 'Every summon and sealed component should own a distinct card-art path');
    ['护主栗子球', '钟离', 'Saber', '萨姆', '巴哈姆特', '伊莫库', '史尔特尔', '史瓦罗'].forEach((name) => {
      const art = getSummonCardArt(name);
      assert(art.imagePath === art.expectedPath, `${name} should load its final ordinary summon card`);
      assert(art.avatarPath?.endsWith('.webp'), `${name} should load a battlefield avatar`);
      assert(art.cutinPath === undefined, `${name} must not receive an advanced-summon cut-in`);
      const summon = makeFighter(`${name}@普通召唤头像测试`);
      summon.name = name;
      summon.summonBaseName = name;
      summon.isSummon = true;
      summon.isAdvancedSummon = false;
      assert(getStageFighterImage(summon) === art.avatarPath, `${name} should replace its battlefield emoji with the supplied avatar`);
    });
    ['青眼白龙', '青眼究极龙', '翼神龙', '黑暗大法师'].forEach((name) => {
      const art = getSummonCardArt(name);
      assert(art.imagePath === art.expectedPath, `${name} should load its final card image`);
      assert(art.cutinPath?.endsWith('.webp'), `${name} should load a transparent summon cut-in`);
      assert(art.avatarPath?.endsWith('.webp'), `${name} should load a battlefield avatar`);
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
      assert(art.imagePath === art.expectedPath, `${name} should load its final component card`);
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
    changedSource[1].status.push({ type: 'BURN', duration: 2 });
    const second = reconcileFighterSnapshots(changedSource, first);
    assert(second !== first, 'A changed playback frame should receive a new roster array');
    assert(second[0] === first[0], 'Unchanged fighters should be structurally shared across log snapshots');
    assert(second[1] !== first[1] && first[1].status.length === 0, 'Changed fighter state should be cloned without mutating the previous log snapshot');

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
    slacker.status.push(createLifecycleStatus('SYNERGY_SLACKING', 5));
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
    fighter.status = [createLifecycleStatus('TEMP_STAT_BUFF', 3, 'architecture')];
    applyTimedStatModifier(fighter, makeTimedStatModifier('architecture-atk', 'TEMP_STAT_BUFF', { atk: 1.5 }, 'architecture'));
    assert(fighter.atk === 150, `Temporary modifier should apply once, got ${fighter.atk}`);
    applyTimedStatModifier(fighter, makeTimedStatModifier('architecture-atk', 'TEMP_STAT_BUFF', { atk: 2 }, 'architecture'));
    assert(Number(fighter.atk) === 200, `Refreshing a modifier should recompute from base instead of stacking exponentially, got ${fighter.atk}`);
    applyPermanentStatBuff(fighter, { atk: 1.5 });
    assert(Number(fighter.atk) === 300, `Permanent growth should update the unmodified base before reapplying the temporary layer, got ${fighter.atk}`);
    fighter.status = [];
    cleanupOrphanedTimedStatModifiers(fighter);
    assert(Number(fighter.atk) === 150, `Expired temporary modifier should restore the updated permanent base, got ${fighter.atk}`);
    cases.push('temporary stat modifiers refresh and roll back against a permanent base');
  }

  {
    const fighter = makeFighter('状态生命周期测试@A');
    const spellBlock = createLifecycleStatus('SPELL_BLOCK', 2, 'architecture');
    fighter.status = [spellBlock];
    assert(spellBlock.charges === 2 && spellBlock.remainingTurns === undefined, 'Spell block should expose charges without a turn duration');
    assert(statusDurationText(spellBlock) === '2次', `Spell block UI should display charges, got ${statusDurationText(spellBlock)}`);
    consumeStatusCharge(fighter, spellBlock);
    assert(fighter.status.includes(spellBlock) && Number(spellBlock.charges) === 1, 'First spell block trigger should consume exactly one charge');
    consumeStatusCharge(fighter, spellBlock);
    assert(!fighter.status.includes(spellBlock), 'Second spell block trigger should remove the exhausted status');

    const counter = createLifecycleStatus('CTR_CHARM', 5);
    fighter.status = [counter];
    assert(counter.remainingTurns === 5 && counter.charges === 1, 'Counter stance should separate owner-turn expiry from its one trigger');
    assert(statusDurationText(counter) === '5回合 · 1次', `Counter UI should display both clocks, got ${statusDurationText(counter)}`);
    consumeStatusCharge(fighter, counter);
    assert(fighter.status.length === 0, 'Counter stance should disappear after its single trigger even with turns remaining');

    const permanentRage = createLifecycleStatus('RAGE', 999);
    assert(permanentRage.expiresOn === 'never' && !tickStatusTurn(permanentRage), '999-turn non-trigger statuses should be truly permanent');
    assert(statusDurationText(permanentRage) === undefined, 'Permanent statuses should not expose a fake 999-turn UI label');
    cases.push('status duration, trigger charges, and UI labels are independent');
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
    shieldTarget.yuzuShield = 40;
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
    grantStatus(blockedTarget, 'SPELL_BLOCK', 1, 'morphling_linken_sphere');
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
    scheduler.reset();
    assert(scheduler.pendingCount() === 0 && timers.size === 0 && frames.size === 0, 'Stage reset should cancel every timer and animation frame');
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

  return cases;
}
