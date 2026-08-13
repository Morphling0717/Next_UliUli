import { resolveHealing } from '../../../lib/namearena/combatState';
import { getEmoteClaimableKills } from '../../../lib/namearena/emoteMechanics';
import {
  GACHA_ADVANCED_SUMMON_NAMES,
  GACHA_ORDINARY_SUMMON_CARDS,
  GACHA_SURTR_CARD,
} from '../../../lib/namearena/gachaMechanics';
import { spawnOwlFurrySquad } from '../../../lib/namearena/owlMechanics';
import {
  clearOriginiumInfection,
  ORIGINIUM_DISEASE_STATUS,
} from '../../../lib/namearena/puruisaishiMechanics';
import { settleBurnAtLargeRound } from '../../../lib/namearena/statusMechanics';
import {
  getConfusionTargets,
  isSelectableTargetFor,
  type TargetingRuntime,
} from '../../../lib/namearena/targeting';
import { formatFighterTeamDisplayLabel } from '../../../lib/namearena/teamPresentation';
import {
  getSurtrDisplayHp,
  getSurtrResolvedTeamId,
  getSurtrTacticalHpPct,
  initializeSurtrState,
  isSurtrAfterglowActive,
  settleSurtrScheduledOpportunity,
  SURTR_BASE_STATS,
} from '../../../lib/namearena/surtrMechanics';
import type { Fighter, SkillDefinition } from '../../../lib/namearena/types';
import {
  applyTestStatus,
  assert,
  localProject,
  makeFighter,
  withRandomSequence,
} from '../shared/harness';
import { makeDeathEngine } from './deathAccountingCases';

function setExactSurtrStats(fighter: Fighter): void {
  fighter.maxHp = SURTR_BASE_STATS.hp;
  fighter.currentHp = SURTR_BASE_STATS.hp;
  fighter.hpPct = 1;
  fighter.atk = SURTR_BASE_STATS.atk;
  fighter.def = SURTR_BASE_STATS.def;
  fighter.spd = SURTR_BASE_STATS.spd;
  fighter.agl = SURTR_BASE_STATS.agl;
  fighter.mag = SURTR_BASE_STATS.mag;
  fighter.res = SURTR_BASE_STATS.res;
  fighter.wis = SURTR_BASE_STATS.wis;
  fighter.critRate = 0;
}

function makeManualSurtr(
  primaryOwner: Fighter,
  owlOwner: Fighter,
  primaryTeam = primaryOwner.teamId ?? primaryOwner.id,
  owlTeam = owlOwner.teamId ?? owlOwner.id,
): Fighter {
  const surtr = makeFighter(`史尔特尔测试体@${primaryTeam}`);
  const job = localProject.jobs.ARKNIGHTS_OP;
  assert(job, 'ARKNIGHTS_OP job should exist for Surtr tests');
  surtr.name = '史尔特尔';
  surtr.displayName = '史尔特尔';
  surtr.job = 'ARKNIGHTS_OP';
  surtr.jobData = { ...job, skills: [...job.skills] };
  setExactSurtrStats(surtr);
  surtr.isSummon = true;
  surtr.isAdvancedSummon = true;
  surtr.isSurtr = true;
  surtr.summonerId = primaryOwner.id;
  surtr.summonBaseName = '史尔特尔';
  surtr.teamId = primaryTeam;
  surtr.surtrState = initializeSurtrState(primaryOwner, primaryTeam, owlOwner, owlTeam);
  return surtr;
}

function settleOpportunity(
  engine: ReturnType<typeof makeDeathEngine>['engine'],
  surtr: Fighter,
): void {
  settleSurtrScheduledOpportunity({
    fighters: engine.fighters,
    turnCount: engine.turnCount,
    getTeamId: (fighter) => engine.getTeamId(fighter),
    isActiveCombatant: (fighter) => engine.isActiveCombatant(fighter),
    syncHpPct: (fighter) => engine.syncHpPct(fighter),
    markDefeated: (fighter, options) => engine.markDefeated(fighter, options),
    log: (type, text, metadata) => engine.log(type, text, metadata),
  }, surtr);
}

function deterministicDamage(
  engine: ReturnType<typeof makeDeathEngine>['engine'],
  user: Fighter,
  target: Fighter,
  skillId: string,
): number {
  const skill = engine.SKILLS[skillId];
  assert(skill, `Missing Surtr skill ${skillId}`);
  return withRandomSequence([0, 0.999], () =>
    engine.calculateDamage(user, target, skill, engine.getTeamId(user), skillId).dmg,
  );
}

export function runSurtrCases(): string[] {
  const cases: string[] = [];

  {
    assert(
      !GACHA_ORDINARY_SUMMON_CARDS.some((entry) => entry.summonName === '史尔特尔'),
      'Surtr must be removed from the ordinary summon pool',
    );
    assert(
      (GACHA_ADVANCED_SUMMON_NAMES as readonly string[]).includes('史尔特尔'),
      'Surtr must be classified as an advanced summon',
    );
    assert(GACHA_SURTR_CARD.advancedSummon, 'Surtr card must be an advanced summon card');
    assert(
      JSON.stringify(GACHA_SURTR_CARD.stats) === JSON.stringify(SURTR_BASE_STATS),
      'Surtr card stats must exactly match the Blue-Eyes baseline',
    );
    cases.push('Surtr is an advanced summon with exact Blue-Eyes baseline stats');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    surtr.surtrState!.afterglowActive = true;
    localProject.setCurrentHp(surtr, 1);
    applyTestStatus(surtr, { identityId: ORIGINIUM_DISEASE_STATUS, potency: 15 });
    clearOriginiumInfection(surtr);
    assert(surtr.currentHp === 1, 'Persistent status shape changes must preserve Surtr internal scheduler HP');
    assert(surtr.hpPct === 0, 'Persistent status shape changes must preserve Surtr afterglow display HP');
    cases.push('Surtr afterglow HP remains normalized across persistent status shape changes');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const gachaAlly = makeFighter('牢鳄队友@A');
    const owlAlly = makeFighter('鸮队友@B');
    const { engine, logs } = makeDeathEngine([gacha, owl, gachaAlly, owlAlly]);
    const engineGacha = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    [engine.fighters[0], engine.fighters[2], engine.fighters[3]].forEach((fighter) => {
      fighter.maxHp = 50000;
      localProject.setCurrentHp(fighter, 50000);
    });

    localProject.setCurrentHp(engineOwl, Math.max(1, Math.floor(engineOwl.maxHp * 0.4)));
    engine.handleTransformations(engineOwl);
    const furry = spawnOwlFurrySquad(engine.createOwlRuntime(), engineOwl);
    assert(furry.length === 4, 'Owl should provide the full furry squad for Surtr tribute tests');
    const heavenBefore = engineOwl.owlState?.heavenStacks ?? 0;

    engine.executeSummonSkill({
      name: '上级召唤·史尔特尔',
      tag: 'special',
      ...GACHA_SURTR_CARD,
    }, engineGacha, engine.getTeamId(engineGacha));

    const surtr = engine.fighters.find((fighter) => fighter.isSurtr);
    assert(surtr, 'Valid Swire + Specter materials should summon Surtr');
    assert(surtr.surtrState?.primaryOwnerId === engineGacha.id, 'Gacha user should be Surtr primary owner');
    assert(surtr.surtrState?.owlOwnerId === engineOwl.id, 'Material Owl should be Surtr joint owner');
    assert(surtr.maxHp === 2800 && surtr.atk === 180 && surtr.mag === 190 && surtr.spd === 140, 'Summoned Surtr should use exact baseline stats');
    assert(
      engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'swire')?.isDead,
      'Base Swire must die as the first tribute',
    );
    assert(
      engine.fighters.find((fighter) => fighter.owlSummonState?.kind === 'specter')?.isDead,
      'Base Specter must die as the second tribute',
    );
    assert(
      engine.fighters.some((fighter) => fighter.owlSummonState?.kind === 'linlang_swire' && engine.isActiveCombatant(fighter)),
      'Linlang Swire must survive and cannot substitute for base Swire',
    );
    assert(
      engine.fighters.some((fighter) => fighter.owlSummonState?.kind === 'spalter' && engine.isActiveCombatant(fighter)),
      'Spalter must survive and cannot substitute for base Specter',
    );
    assert((engineOwl.owlState?.heavenStacks ?? 0) === heavenBefore + 2, 'Two tribute deaths should grant two Heaven observations');
    const crossTeamLog = logs.find((entry) => entry.text.includes('跨阵营献祭'));
    assert(crossTeamLog, 'Cross-team tribute should be explicit in logs');
    assert(
      !/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(crossTeamLog.text),
      'Cross-team tribute logs must not expose internal team UUIDs',
    );
    assert(logs.filter((entry) => entry.text.includes('【第一祭品】') || entry.text.includes('【第二祭品】')).length === 2, 'Each tribute should receive a separate death log');

    assert(!engine.isSelectableTargetFor(surtr, engineGacha), 'Surtr must never normally target its Gacha owner');
    assert(!engine.isSelectableTargetFor(surtr, engineOwl), 'Surtr must never normally target its Owl owner');
    assert(engine.isSelectableTargetFor(surtr, engine.fighters[2]), 'Surtr must target the Gacha owner teammate during owner conflict');
    assert(engine.isSelectableTargetFor(surtr, engine.fighters[3]), 'Surtr must target the Owl owner teammate during owner conflict');
    assert(engine.isSelectableTargetFor(engine.fighters[2], surtr), 'Gacha owner teammates must be able to target Surtr during owner conflict');
    assert(engine.isSelectableTargetFor(engine.fighters[3], surtr), 'Owl owner teammates must be able to target Surtr during owner conflict');
    assert(getSurtrResolvedTeamId(engine, surtr).startsWith('SURTR_CONFLICT:'), 'Surtr should use conflict affiliation while both owner sides compete');
    assert(
      formatFighterTeamDisplayLabel(surtr, engine.fighters) === undefined,
      'Surtr must not display either owner team while both owner sides compete',
    );
    cases.push('Surtr tribute order, Heaven hooks, joint owners, and conflict targeting are exact');
  }

  {
    const gacha = makeFighter('牢鳄@A');
    const owlA = makeFighter('鸮@B');
    const owlB = makeFighter('鸮@C');
    const swire = makeFighter('诗怀雅伪素材@B');
    const specter = makeFighter('幽灵鲨伪素材@C');
    swire.isSummon = true;
    swire.summonerId = owlA.id;
    swire.owlSummonState = { kind: 'swire', spawnedTurn: 0 };
    specter.isSummon = true;
    specter.summonerId = owlB.id;
    specter.owlSummonState = { kind: 'specter', spawnedTurn: 0 };
    const { engine } = makeDeathEngine([gacha, owlA, owlB, swire, specter]);

    engine.executeSummonSkill({
      name: '非法上级召唤',
      tag: 'special',
      ...GACHA_SURTR_CARD,
    }, engine.fighters[0], engine.getTeamId(engine.fighters[0]));

    assert(!engine.fighters.some((fighter) => fighter.isSurtr), 'Materials from different Owls must not summon Surtr');
    assert(engine.isActiveCombatant(engine.fighters[3]) && engine.isActiveCombatant(engine.fighters[4]), 'Rejected cross-Owl materials must not be consumed');
    cases.push('Surtr rejects cross-Owl and substitute tribute combinations');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const target = makeFighter('魔抗公式靶@B');
    target.res = 100;
    target.def = 9999;
    target.agl = 0;
    const { engine } = makeDeathEngine([owner, owl, surtr, target]);
    const engineSurtr = engine.fighters[2];
    const engineTarget = engine.fighters[3];

    assert(deterministicDamage(engine, engineSurtr, engineTarget, 'surtr_flame_sword') === 474, 'Flame Sword should use MAG x3.10 with 26 RES penetration');
    assert(deterministicDamage(engine, engineSurtr, engineTarget, 'surtr_molten_shadow_split_hit') === 314, 'Two-target Molten Shadow should use ATK x2.20 as magical damage');
    assert(deterministicDamage(engine, engineSurtr, engineTarget, 'surtr_molten_shadow_single_hit') === 371, 'Single-target Molten Shadow should use ATK x2.60 as magical damage');
    assert(deterministicDamage(engine, engineSurtr, engineTarget, 'surtr_twilight_hit') === 614, 'Twilight should use ATK x4.30 as magical damage');
    engineSurtr.atk = 100000;
    assert(deterministicDamage(engine, engineSurtr, engineTarget, 'surtr_twilight_hit') > 400000, 'Twilight must not have a damage cap');
    cases.push('Surtr formulas, ATK-to-magic conversion, penetration, and uncapped scaling are exact');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const target = makeFighter('黄昏法术抵挡靶@B');
    target.maxHp = 10000;
    localProject.setCurrentHp(target, 10000);
    localProject.setCurrentHp(surtr, 1000);
    applyTestStatus(surtr, { identityId: 'EXHAUSTION', potency: 100, remainingTurns: 3 });
    applyTestStatus(target, { identityId: 'SPELL_BLOCK', charges: 1 });
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, target]);
    const engineSurtr = engine.fighters[2];
    const engineTarget = engine.fighters[3];
    const hpBefore = engineTarget.currentHp;

    withRandomSequence([0, 0, 0, 0], () => {
      engine.executeSkillAction('surtr_twilight', engineSurtr, engineTarget);
    });
    assert(engineSurtr.surtrState?.twilightUsed, 'Twilight should consume its only activation as soon as it starts resolving');
    assert(engineSurtr.maxHp === 7800, 'Twilight should permanently add 5000 max HP exactly once');
    assert(engineSurtr.currentHp === 1000, '100% anti-heal should block Twilight healing without cancelling activation');
    assert(engineTarget.currentHp === hpBefore, 'Per-target spell block should stop that Twilight impact');
    const maxHpAfterFirst = engineSurtr.maxHp;
    engine.executeSkillAction('surtr_twilight', engineSurtr, engineTarget);
    assert(engineSurtr.maxHp === maxHpAfterFirst, 'Direct attempts must not activate Twilight a second time');
    assert(logs.some((entry) => entry.text.includes('本局唯一一次黄昏已经消耗')), 'Successful Twilight log should state that its only use was consumed');
    assert(logs.some((entry) => entry.text.includes('已经燃尽')), 'Repeated Twilight attempt should explain that it cannot activate again');
    const selectedAfterUse = withRandomSequence([0.999], () => engine.selectSkill(engineSurtr));
    assert(selectedAfterUse !== 'surtr_twilight', 'Twilight must be removed from the weighted skill pool after use');
    cases.push('Twilight setup is once-only and target spell blocks never refund it');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const laterTarget = makeFighter('黄昏后续斩击靶@B');
    const charmTarget = makeFighter('黄昏魅惑反击靶@C');
    laterTarget.maxHp = 10000;
    charmTarget.maxHp = 10000;
    localProject.setCurrentHp(laterTarget, 10000);
    localProject.setCurrentHp(charmTarget, 10000);
    laterTarget.agl = 0;
    charmTarget.agl = 0;
    applyTestStatus(charmTarget, {
      identityId: 'CTR_CHARM',
      charges: 1,
      attribution: { applierId: charmTarget.id, applierName: charmTarget.name },
    });
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, laterTarget, charmTarget]);
    const engineSurtr = engine.fighters[2];
    const engineLaterTarget = engine.fighters[3];
    const hpBefore = engineLaterTarget.currentHp;

    withRandomSequence([0, 0, 0, 0, 0, 0], () => {
      engine.executeSkillAction('surtr_twilight', engineSurtr, engineLaterTarget);
    });
    assert(engineLaterTarget.currentHp < hpBefore, 'A counter that stops one Twilight impact must not cancel later locked impacts');
    assert(
      logs.some((entry) => entry.text.includes('当前一击中断')),
      'Counter logs inside Twilight should state that only the current impact was interrupted',
    );
    assert(
      !logs.some((entry) => entry.text.includes('被魅惑 2 回合，攻击中断')),
      'Counter logs must not imply the entire multi-target Twilight action stopped',
    );
    assert(engineSurtr.surtrState?.twilightUsed, 'A countered impact must not refund the once-only Twilight activation');
    cases.push('Per-target counters interrupt one Twilight impact without misleading logs or refunds');
  }

  {
    const owner = makeFighter('已退场牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const primarySideLastUnit = makeFighter('牢鳄方最后单位@A');
    const owlAlly = makeFighter('鸮方后续锁定目标@B');
    primarySideLastUnit.maxHp = 100;
    localProject.setCurrentHp(primarySideLastUnit, 100);
    owlAlly.maxHp = 10000;
    localProject.setCurrentHp(owlAlly, 10000);
    surtr.atk = 1000;
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, primarySideLastUnit, owlAlly]);
    const engineSurtr = engine.fighters[2];
    const firstTarget = engine.fighters[3];
    const secondTarget = engine.fighters[4];

    engine.markDefeated(engine.fighters[0], { awardKill: false, bypassDeathSaves: true });
    assert(getSurtrResolvedTeamId(engine, engineSurtr).startsWith('SURTR_CONFLICT:'), 'Both owner sides should still compete through their surviving units');
    const splitImpact = engine.SKILLS.surtr_molten_shadow_split_hit!;
    const previousAlwaysHit = splitImpact.alwaysHit;
    splitImpact.alwaysHit = true;
    const secondHpBefore = secondTarget.currentHp;
    try {
      withRandomSequence([0.999], () => {
        engine.executeSkillAction('surtr_molten_shadow', engineSurtr, firstTarget);
      });
    } finally {
      splitImpact.alwaysHit = previousAlwaysHit;
    }

    assert(firstTarget.isDeadAnnounced, 'The first Molten Shadow target should remove the final primary-side unit');
    assert(getSurtrResolvedTeamId(engine, engineSurtr) === 'B', 'Surtr should attach to the Owl side after the primary side leaves');
    assert(
      secondTarget.currentHp < secondHpBefore,
      'A second target locked before affiliation changed must still receive its Molten Shadow impact',
    );
    assert(
      logs.some((entry) =>
        entry.text.includes('共同主人关系变化') &&
        entry.text.includes('归入') &&
        entry.text.includes(engine.fighters[1].name)),
      'Surtr affiliation changes must explain why she joined the surviving Owl side',
    );
    assert(!logs.some((entry) => entry.text.includes('预计预计')), 'Surtr damage previews must not duplicate the estimate prefix');
    cases.push('Surtr multi-target skills preserve every cast-start target through mid-cast affiliation changes');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const ownerAlly = makeFighter('牢鳄方指令目标@A');
    const owlAlly = makeFighter('鸮方指令目标@B');
    owner.maxHp = 50000;
    owl.maxHp = 50000;
    ownerAlly.maxHp = 50000;
    owlAlly.maxHp = 50000;
    [owner, owl, ownerAlly, owlAlly].forEach((fighter) => localProject.setCurrentHp(fighter, fighter.maxHp));
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, ownerAlly, owlAlly]);
    const commandCard = engine.Data.GACHA_SSR_POOL.find((entry) => entry.text.includes('召唤指令'));
    assert(commandCard, 'Gacha SSR pool should include summon command for Surtr interaction tests');
    engine.SKILLS.__surtr_command_probe = { name: '史尔特尔召唤指令测试', tag: 'buff', ...commandCard };

    withRandomSequence([0], () => {
      engine.executeSkillAction('__surtr_command_probe', engine.fighters[0], engine.fighters[4]);
    });

    const commandLog = logs.find((entry) => entry.text.includes('命令 史尔特尔 立刻压制'));
    assert(commandLog, 'Gacha summon command should recognize jointly owned Surtr');
    assert(
      !commandLog.text.includes(`压制 ${engine.fighters[0].name}！`) &&
      !commandLog.text.includes(`压制 ${engine.fighters[1].name}！`),
      'Surtr summon command must never target either exact joint owner',
    );
    assert(
      engine.fighters[0].stats.dmgTaken === 0 && engine.fighters[1].stats.dmgTaken === 0,
      'Neither exact owner should take damage from a Surtr summon command',
    );
    cases.push('Gacha summon command uses Surtr conflict targeting and protects both exact owners');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const attacker = makeFighter('余命最初攻击者@B');
    const laterAttacker = makeFighter('余命后续攻击者@C');
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, attacker, laterAttacker]);
    const engineSurtr = engine.fighters[2];
    const originalAttacker = engine.fighters[3];
    const later = engine.fighters[4];
    engineSurtr.surtrState!.twilightUsed = true;
    engineSurtr.surtrState!.twilightActivatedTurn = 0;
    engineSurtr.maxHp = 7800;
    localProject.setCurrentHp(engineSurtr, 7800);

    engine.turnCount = 1;
    settleOpportunity(engine, engineSurtr);
    assert(engineSurtr.surtrState?.twilightDrainOpportunities === 1, 'First post-Twilight opportunity should drain at 1%');
    assert(engineSurtr.currentHp === 7722, `First Twilight drain should remove 78 HP, got ${engineSurtr.currentHp}`);

    localProject.setCurrentHp(engineSurtr, 50);
    engine.applyDamage(engineSurtr, 500, 'skill', true, originalAttacker, { actionName: '余命触发测试' });
    assert(isSurtrAfterglowActive(engineSurtr), 'Lethal damage should enter Surtr afterglow instead of defeating her');
    assert(getSurtrDisplayHp(engineSurtr) === 0 && engineSurtr.hpPct === 0, 'Afterglow should publicly display zero HP');
    assert(Number(engineSurtr.currentHp) === 1, 'Afterglow should retain only the internal scheduler sentinel');
    assert(engineSurtr.spd === 160, 'Afterglow should add exactly 20 speed');

    const blockedHealing = resolveHealing(engineSurtr, 9999);
    assert(blockedHealing.actual === 0, 'Afterglow must block all healing');
    engineSurtr.maxHp += 138;
    engineSurtr.currentHp = engineSurtr.maxHp;
    engine.syncHpPct(engineSurtr);
    assert(
      Number(engineSurtr.currentHp) === 1 && engineSurtr.hpPct === 0,
      'Direct full-HP resets and max-HP buffs must normalize back to the afterglow scheduler sentinel',
    );
    engine.SKILLS.__surtr_afterglow_status_probe = {
      name: '余命状态命中测试',
      tag: 'magical',
      mult: 1,
      alwaysHit: true,
      statusApplications: [{ identityId: 'STUN', remainingTurns: 1 }],
      text: '{USER} 命中 {TARGET}。',
    } satisfies SkillDefinition;
    engine.executeSkillAction('__surtr_afterglow_status_probe', later, engineSurtr);
    assert(engineSurtr.statuses.some((status) => status.identityId === 'STUN'), 'A hit during afterglow should still apply legal on-hit statuses');
    assert(engineSurtr.surtrState?.zeroedById === originalAttacker.id, 'Later hits must not overwrite the original zeroing attacker');
    assert(!engine.markDefeated(engineSurtr, { killer: later }), 'Ordinary forced death must not bypass afterglow');

    for (let opportunity = 1; opportunity <= 7; opportunity += 1) {
      engine.turnCount += 1;
      settleOpportunity(engine, engineSurtr);
      assert(!engineSurtr.isDeadAnnounced, `Surtr must remain active through afterglow opportunity ${opportunity}/8`);
    }
    engine.turnCount += 1;
    settleOpportunity(engine, engineSurtr);
    assert(engineSurtr.isDeadAnnounced, 'Surtr should truly die after the eighth later own opportunity');
    assert(originalAttacker.stats.kills === 1, 'Final afterglow death should credit the original zeroing attacker');
    assert(later.stats.kills === 0, 'Later attackers must not steal afterglow kill credit');
    assert(logs.some((entry) => entry.text.includes('第 8/8 次余命行动机会')), 'Afterglow log should reach an explicit 8/8 count');
    cases.push('Twilight drain and eight-opportunity afterglow preserve display, status hits, and original kill credit');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const rabbit = makeFighter('兔卷卷@B');
    const yuzu = makeFighter('柚子@B');
    const tokusatsu = makeFighter('刺猬人@B');
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, rabbit, yuzu, tokusatsu]);
    const engineSurtr = engine.fighters[2];
    const engineRabbit = engine.fighters[3];
    const engineYuzu = engine.fighters[4];
    const engineTokusatsu = engine.fighters[5];

    engine.markDefeated(engineSurtr, { killer: engineRabbit });
    engine.executeSkillAction('v_rabbit_megaphone', engineRabbit, engineSurtr);
    assert(
      engineSurtr.statuses.some((status) => status.identityId === 'STUN'),
      'Rabbit megaphone must still apply its legal on-hit stun to afterglow Surtr',
    );
    assert(
      logs.some((entry) => entry.text.includes('刺耳魔音贯耳并成功命中') && entry.text.includes(engineSurtr.name)),
      'Rabbit megaphone should describe an afterglow hit instead of a miss',
    );
    assert(
      !logs.some((entry) => entry.text.includes('刺耳魔音擦身而过') && entry.text.includes(engineSurtr.name)),
      'Rabbit megaphone must not contradict the authoritative afterglow hit log',
    );

    engineYuzu.yuzuPhase = 3;
    engineYuzu.transformed = true;
    engineYuzu.yuzuMarkedTargetId = engineSurtr.id;
    engineYuzu.yuzuMarkedHitCount = 0;
    delete engineYuzu.yuzuFuriosoCountedTurn;
    withRandomSequence([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], () => {
      engine.executeSkillAction('yuzu_hammer_crush', engineYuzu, engineSurtr);
    });
    assert(
      engineYuzu.yuzuMarkedHitCount === 1,
      'Yuzu must count a marked afterglow hit toward Furioso without requiring HP loss',
    );
    assert(
      logs.some((entry) =>
        entry.text.includes('钝器重压') &&
        entry.text.includes('成功命中') &&
        entry.text.includes('黄昏余命')),
      'Yuzu should log marked afterglow hits as connected attacks',
    );

    const monsterJob = localProject.jobs.MIRACLE_MONSTER_BUJIN;
    assert(monsterJob, 'MIRACLE_MONSTER_BUJIN job should exist for afterglow interaction tests');
    engineTokusatsu.isTokusatsu = true;
    engineTokusatsu.transformed = true;
    engineTokusatsu.job = 'MIRACLE_MONSTER_BUJIN';
    engineTokusatsu.jobData = { ...monsterJob, skills: [...monsterJob.skills] };
    withRandomSequence([0.99, 0.99, 0.99, 0.99], () => {
      engine.executeSkillAction('monster_roar', engineTokusatsu, engineSurtr);
    });
    assert(
      engineSurtr.statuses.some((status) => status.identityId === 'WEAK'),
      'Tokusatsu roar must still apply its legal on-hit weakness to afterglow Surtr',
    );
    assert(
      logs.some((entry) =>
        entry.text.includes('咆哮冲击成功命中') &&
        entry.text.includes(engineSurtr.name) &&
        entry.text.includes('黄昏余命')),
      'Tokusatsu roar should not describe an afterglow hit as being negated',
    );
    cases.push('Custom multi-hit skills preserve afterglow hit logs and on-hit effects');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const source = makeFighter('余命持续伤害来源@B');
    const counter = makeFighter('余命反击来源@B');
    counter.atk = 500;
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, source, counter]);
    const engineSurtr = engine.fighters[2];
    const engineSource = engine.fighters[3];
    const engineCounter = engine.fighters[4];

    engine.markDefeated(engineSurtr, { killer: engineSource });
    applyTestStatus(engineSurtr, {
      identityId: 'BURN',
      count: 2,
      attribution: {
        applierId: engineSource.id,
        applierName: engineSource.name,
        creditActorId: engineSource.id,
      },
    });
    settleBurnAtLargeRound(engine.createStatusMechanicsRuntime(), 1);
    assert(
      logs.some((entry) =>
        entry.text.includes('【灼烧】') &&
        entry.text.includes(engineSurtr.name) &&
        entry.text.includes('黄昏余命')),
      'Status damage against afterglow Surtr must log a connected zero-HP hit',
    );
    assert(
      !logs.some((entry) =>
        entry.text.includes('【灼烧】') &&
        entry.text.includes(engineSurtr.name) &&
        entry.text.includes('伤害被完全化解')),
      'Status logs must not claim afterglow damage was negated',
    );

    applyTestStatus(engineCounter, { identityId: 'WAIT_COUNTER', charges: 1 });
    withRandomSequence(Array.from({ length: 24 }, () => 0), () => {
      engine.executeSkillAction('surtr_flame_sword', engineSurtr, engineCounter);
    });
    assert(
      logs.some((entry) =>
        entry.text.includes('强力反击成功命中') &&
        entry.text.includes(engineSurtr.name) &&
        entry.text.includes('黄昏余命')),
      'Counter damage should log an afterglow hit without false mitigation text',
    );
    assert(
      !logs.some((entry) =>
        entry.text.includes('强力反击被化解') &&
        entry.text.includes(engineSurtr.name)),
      'Counter logs must not contradict an afterglow hit',
    );
    assert(
      engineSurtr.surtrState?.zeroedById === engineSource.id,
      'Status and counter hits during afterglow must not replace the original zeroing source',
    );
    cases.push('Afterglow status and counter damage keep causal logs and original kill credit');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@A');
    const surtr = makeManualSurtr(owner, owl, 'A', 'A');
    const gamer = makeFighter('玄凝@C');
    const wounded = makeFighter('真正残血目标@B');
    const champion = localProject.jobs.ALL_PLATFORM_CHAMPION;
    assert(champion, 'ALL_PLATFORM_CHAMPION job should exist for Surtr tactical targeting tests');
    gamer.isGamer = true;
    gamer.job = 'ALL_PLATFORM_CHAMPION';
    gamer.jobData = { ...champion, skills: [...champion.skills] };
    gamer.apm = 12;
    wounded.maxHp = 5000;
    localProject.setCurrentHp(wounded, 100);
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, gamer, wounded]);
    const engineSurtr = engine.fighters[2];
    const engineGamer = engine.fighters[3];
    const engineWounded = engine.fighters[4];

    engine.markDefeated(engineSurtr, { killer: engineWounded });
    assert(getSurtrTacticalHpPct(engineSurtr) === 1, 'Afterglow should present as full tactical HP despite displaying zero');
    const selected = engine.resolveTarget(engineGamer, null, engine.getSelectableTargets(engineGamer));
    assert(selected?.target.id === engineWounded.id, 'Champion low-health targeting should prefer a real wounded enemy over afterglow Surtr');

    engine.markDefeated(engineWounded, { awardKill: false, bypassDeathSaves: true });
    engine.executeSkillAction('gamer_headshot_line', engineGamer, engineSurtr);
    assert(
      logs.some((entry) => entry.text.includes('先打一枪压低血线')),
      'A normal hit may still target afterglow, but its log must not claim Surtr is inside the execute line',
    );
    assert(
      !logs.some((entry) => entry.text.includes('目标已经进入斩杀线')),
      'Afterglow must never produce a false champion execute-line log',
    );
    cases.push('Afterglow remains attackable without becoming a false low-health or execute target');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const victim = makeFighter('共同击杀靶@C');
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, victim]);
    const engineOwner = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    const engineSurtr = engine.fighters[2];

    engine.markDefeated(engine.fighters[3], {
      message: '💀 【共同击杀测试】目标倒下。',
      killer: engineSurtr,
    });
    assert(engineOwner.stats.kills === 0.5, 'Surtr kill should grant primary owner exactly 0.5');
    assert(engineOwl.stats.kills === 0.5, 'Surtr kill should grant Owl owner exactly 0.5');
    assert(engineSurtr.stats.kills === 0, 'Surtr should not duplicate the shared kill in ordinary kill stats');
    assert(engineSurtr.surtrState?.actualKills === 1, 'Surtr should retain one internal actual-kill count');
    assert(getEmoteClaimableKills(engineOwner) === 0.5, 'Emote must treat a 0.5 shared kill as nonzero');
    assert(logs.filter((entry) => entry.text.includes('共同击杀分账')).length === 1, 'One Surtr kill should emit one split log');
    cases.push('Surtr kills split once and Emote preserves fractional nonzero kills');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const { engine, logs } = makeDeathEngine([owner, owl, surtr]);
    const engineOwner = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    const engineSurtr = engine.fighters[2];

    engine.markDefeated(engineOwner, {
      message: '💀 【共同主人受害测试】牢鳄 倒下。',
      killer: engineSurtr,
      bypassDeathSaves: true,
    });

    assert(engineOwner.stats.kills === 0, 'A defeated Surtr owner must not receive credit for their own death');
    assert(engineOwl.stats.kills === 0.5, 'The other Surtr owner should retain their half kill credit');
    assert(
      logs.some((entry) => entry.text.includes('不获得自己的击杀分账')),
      'Joint-kill logs should explain why the defeated owner received no credit',
    );
    cases.push('Surtr joint kill never credits the defeated owner for their own death');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const outsider = makeFighter('混乱可选目标@C');
    const { engine } = makeDeathEngine([owner, owl, surtr, outsider]);
    const engineOwner = engine.fighters[0];
    const engineOwl = engine.fighters[1];
    const engineSurtr = engine.fighters[2];
    const engineOutsider = engine.fighters[3];
    const runtime: TargetingRuntime = {
      fighters: engine.fighters,
      turnCount: engine.turnCount,
      getTeamId: (fighter) => engine.getTeamId(fighter),
      isActiveCombatant: (fighter) => engine.isActiveCombatant(fighter),
    };

    const confusionTargets = getConfusionTargets(runtime, engineSurtr);
    assert(
      !confusionTargets.some((target) => target.id === engineOwner.id || target.id === engineOwl.id),
      'Confusion must never choose either exact Surtr owner',
    );
    assert(
      confusionTargets.some((target) => target.id === engineOutsider.id),
      'Confusion should retain other active combatants as valid Surtr targets',
    );
    engineSurtr.confusedForcedTargetId = engineOwner.id;
    assert(
      !isSelectableTargetFor(runtime, engineSurtr, engineOwner),
      'Even a forced target id must not bypass Surtr owner immunity',
    );
    engineSurtr.confusedForcedTargetId = engineOwl.id;
    assert(
      !isSelectableTargetFor(runtime, engineSurtr, engineOwl),
      'Forced targeting must protect both exact owners symmetrically',
    );
    delete engineSurtr.confusedForcedTargetId;
    cases.push('Confusion and forced targeting can never make Surtr attack either exact owner');
  }

  {
    const owner = makeFighter('牢鳄@A');
    const owl = makeFighter('鸮@B');
    const surtr = makeManualSurtr(owner, owl, 'A', 'B');
    const enemy = makeFighter('共同遗产敌人@C');
    const { engine, logs } = makeDeathEngine([owner, owl, surtr, enemy]);
    const engineSurtr = engine.fighters[2];

    engine.markDefeated(engine.fighters[0], { awardKill: false, bypassDeathSaves: true });
    engine.fighters[0].isDead = true;
    engine.markDefeated(engine.fighters[1], { awardKill: false, bypassDeathSaves: true });
    engine.fighters[1].isDead = true;
    assert(getSurtrResolvedTeamId(engine, engineSurtr).startsWith('SURTR_LEGACY:'), 'Surtr should become joint legacy after both owner sides leave');
    assert(!engine.checkWinCondition(engine.fighters.filter((fighter) => engine.isActiveCombatant(fighter))), 'A living third-party enemy should prevent joint-legacy victory');

    engine.markDefeated(engine.fighters[3], { awardKill: false, bypassDeathSaves: true });
    engine.fighters[3].isDead = true;
    assert(engine.checkWinCondition([engineSurtr]), 'A sole surviving joint-legacy Surtr should end the battle');
    assert(
      logs.some((entry) => entry.type === 'win' && entry.text.includes('牢鳄') && entry.text.includes('鸮')),
      'Joint-legacy victory should name both original owners',
    );
    cases.push('Surtr joint legacy resolves as a shared owner victory without stalling');
  }

  return cases;
}
