import {
  consumeCompletedLargeRound,
  createBattleState,
  getLargeRoundPriorityActorIds,
  noteLargeRoundActor,
  syncLargeRoundState,
  withBattleRandom,
} from '../../../lib/namearena/battleState';
import { grantStatus } from '../../../lib/namearena/defenseStatus';
import { cloneJobDefinition } from '../../../lib/namearena/combatState';
import { createCombatActorMotionPlan } from '../../../lib/namearena/combatActorMotion';
import { resolveCombatEffect } from '../../../lib/namearena/combatEffects';
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
  buildStageLogGroups,
  createStagePositions,
  getStageFighterImage,
  shouldRenderFighterOnStage,
} from '../../../lib/namearena/battleStageModel';
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
    cases.push('tribute, fusion, Exodia, and ordinary summon presentations stay separated');
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
    const first = seededTrace(20260712);
    const replay = seededTrace(20260712);
    assert(first === replay, 'The same roster and seed should reproduce an identical structured battle trace');
    cases.push('seeded structured events replay deterministically');
  }

  return cases;
}
