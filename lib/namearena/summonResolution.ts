import type {
  BattleEngineCore,
  BattleLogMetadata,
  DefeatOptions,
  Fighter,
  JobDefinition,
  SkillDefinition,
} from './types';
import { cloneJobDefinition, healFighter } from './combatState';
import { hasIdentity, initializeEffectState, applyStatus } from './statusSystem';
import {
  GACHA_ORDINARY_SUMMON_NAMES,
  GACHA_RA_PHOENIX_STATUS,
  grantGachaLuck,
  isAdvancedSummonName,
  isLuckEmperor,
} from './gachaMechanics';

import { tryMomoBanishBlueEyes } from './momoMechanics';
import { generateUniqueRuntimeId } from './core';
import {
  initializeSurtrState,
  syncSurtrAffiliation,
  pickSurtrTributeGroup,
  type SurtrTributeGroup,
} from './surtrMechanics';

export interface SummonResolutionRuntime {
  fighters: Fighter[];
  jobs: Partial<Record<string, JobDefinition>>;
  core: BattleEngineCore;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  clearSpinalSword: (fighter: Fighter) => void;
  syncPuppetMasterStatus: (fighter: Fighter) => void;
  formatSkillText: (skill: SkillDefinition, text: string) => string;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
}

function getSummonBaseName(fighter: Fighter): string {
  return fighter.summonBaseName ?? fighter.name;
}

function formatSummonName(runtime: SummonResolutionRuntime, baseName: string): string {
  if (baseName === '黑暗大法师') return baseName;

  const existingCount = runtime.fighters.filter((fighter) =>
    fighter.isSummon && getSummonBaseName(fighter) === baseName,
  ).length;
  return existingCount === 0 ? baseName : `${baseName}#${existingCount + 1}`;
}

function createSummonId(runtime: SummonResolutionRuntime): string {
  return generateUniqueRuntimeId(
    runtime.fighters.map((fighter) => fighter.id),
    () => runtime.core.generateUUID?.() ?? `summon-${Math.random().toString(36).slice(2)}`,
    'summon',
  );
}

export function executeSummonSkill(
  runtime: SummonResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  userTeamId: string,
): void {
  let summonMaterials: string[] = [];
  let surtrTributeGroup: SurtrTributeGroup | undefined;
  let surtrOwlTeamId: string | undefined;
  if (
    skill.summonName === '史尔特尔' &&
    runtime.fighters.some((fighter) =>
      fighter.isSurtr &&
      fighter.surtrState?.primaryOwnerId === user.id &&
      runtime.isActiveCombatant(fighter),
    )
  ) {
    runtime.log('info', `🚫 ${user.name} 已经拥有一名仍在场的史尔特尔，不能重复完成上级召唤！`);
    return;
  }
  if ((skill.unique || skill.summonName === '黑暗大法师') && runtime.fighters.some((fighter) => getSummonBaseName(fighter) === skill.summonName && runtime.isActiveCombatant(fighter))) {
    runtime.log('info', `🚫 场上已经存在 ${skill.summonName}，无法重复召唤！`);
    return;
  }

  if (skill.summonName === '青眼究极龙') {
    const blueEyes = runtime.fighters.find((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === user.id &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === userTeamId &&
      getSummonBaseName(fighter) === '青眼白龙',
    );
    const ordinaryMaterials = runtime.fighters.filter((fighter) =>
      fighter.isSummon &&
      fighter.summonerId === user.id &&
      runtime.isActiveCombatant(fighter) &&
      runtime.getTeamId(fighter) === userTeamId &&
      !isAdvancedSummonName(getSummonBaseName(fighter)),
    ).slice(0, 2);
    if (!blueEyes || ordinaryMaterials.length < 2) {
      runtime.log('info', `🚫 ${user.name} 试图融合青眼究极龙，但缺少青眼白龙或两只普通召唤物！`);
      return;
    }
    const fusionMaterials = [blueEyes, ...ordinaryMaterials];
    summonMaterials = fusionMaterials.map((fighter) => fighter.name);
    runtime.log('death', `💀 融合！${summonMaterials.join('、')} 化为了召唤 青眼究极龙 的融合素材！`);
    fusionMaterials.forEach((victim) => {
      runtime.markDefeated(victim, { awardKill: false });
      victim.isDead = true;
    });
  }

  if (skill.summonName === '史尔特尔') {
    surtrTributeGroup = pickSurtrTributeGroup(runtime);
    if (!surtrTributeGroup) {
      runtime.log('info', `🚫 ${user.name} 试图上级召唤史尔特尔，但场上找不到同一名鸮所属的诗怀雅与幽灵鲨！`);
      if (isLuckEmperor(user)) {
        grantGachaLuck(user, 1, runtime.log, '史尔特尔上级召唤失败');
        applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'surtr_tribute_compensation' } });
        const healed = healFighter(user, Math.floor(user.maxHp * 0.1), runtime.log);
        runtime.log(
          healed > 0 ? 'heal' : 'info',
          `🍀 【上级召唤补偿】${user.name} 获得 1 点欧气与 2 层法术抵挡${healed > 0 ? `，并恢复 ${healed} 点生命` : '，但没有恢复生命'}。`,
        );
      }
      return;
    }

    const { owl, swire, specter } = surtrTributeGroup;
    surtrOwlTeamId = runtime.getTeamId(owl);
    summonMaterials = [swire.name, specter.name];
    const crossTeamText = surtrOwlTeamId !== userTeamId
      ? `两名祭品来自 ${owl.name} 一方的敌对阵营，本次为跨阵营献祭。`
      : '两名祭品与召唤者属于同一阵营。';
    runtime.log(
      'crit',
      `🔥 【史尔特尔上级召唤】${user.name} 锁定 ${owl.name} 所属的 ${swire.name} 与 ${specter.name}。${crossTeamText}`,
      { actorId: user.id, actorName: user.name, targetIds: [swire.id, specter.id] },
    );

    runtime.log('death', `💀 【第一祭品】${swire.name} 被献作史尔特尔的上级召唤素材；这是一场无击杀者的真实死亡。`);
    const swireSacrificed = runtime.markDefeated(swire, {
      awardKill: false,
      setHpZero: true,
      bypassDeathSaves: true,
    });
    swire.isDead = true;

    const specterStillLegal =
      runtime.isActiveCombatant(specter) &&
      specter.summonerId === owl.id &&
      specter.owlSummonState?.kind === 'specter';
    if (!swireSacrificed || !specterStillLegal) {
      runtime.log('info', `🚫 【上级召唤中断】第一祭品死亡后的连锁使幽灵鲨不再合法，史尔特尔不会生成；已经发生的诗怀雅死亡不回滚。`);
      grantGachaLuck(user, 1, runtime.log, '史尔特尔献祭连锁中断');
      applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'surtr_tribute_compensation' } });
      const healed = healFighter(user, Math.floor(user.maxHp * 0.1), runtime.log);
      runtime.log(
        healed > 0 ? 'heal' : 'info',
        `🍀 【献祭中断补偿】${user.name} 获得 1 点欧气与 2 层法术抵挡${healed > 0 ? `，并恢复 ${healed} 点生命` : '，但没有恢复生命'}。`,
      );
      return;
    }

    runtime.log('death', `💀 【第二祭品】${specter.name} 被献作史尔特尔的上级召唤素材；濒死锁血无法阻止这场无击杀者的真实死亡。`);
    const specterSacrificed = runtime.markDefeated(specter, {
      awardKill: false,
      setHpZero: true,
      bypassDeathSaves: true,
    });
    specter.isDead = true;
    if (!specterSacrificed) {
      runtime.log('info', `🚫 【上级召唤中断】幽灵鲨未能完成真实死亡，史尔特尔不会生成；两名祭品的既有死亡结算不回滚。`);
      grantGachaLuck(user, 1, runtime.log, '史尔特尔第二祭品异常');
      applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'surtr_tribute_compensation' } });
      const healed = healFighter(user, Math.floor(user.maxHp * 0.1), runtime.log);
      runtime.log(
        healed > 0 ? 'heal' : 'info',
        `🍀 【献祭异常补偿】${user.name} 获得 1 点欧气与 2 层法术抵挡${healed > 0 ? `，并恢复 ${healed} 点生命` : '，但没有恢复生命'}。`,
      );
      return;
    }
  }

  if ((skill.tributes ?? 0) > 0) {
    const potentialTributes = runtime.fighters.filter(
      (fighter) => {
        const baseName = getSummonBaseName(fighter);
        return fighter.isSummon &&
          fighter.summonerId === user.id &&
          runtime.isActiveCombatant(fighter) &&
          runtime.getTeamId(fighter) === userTeamId &&
          !isAdvancedSummonName(baseName);
      },
    );
    if (potentialTributes.length < (skill.tributes ?? 0)) {
      runtime.log('info', `🚫 ${user.name} 试图召唤 ${skill.summonName}，但场上祭品不足！`);
      if (isLuckEmperor(user)) {
        grantGachaLuck(user, 1, runtime.log, '献祭失败');
        applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'gacha_tribute_compensation' } });
        const healed = healFighter(user, Math.floor(user.maxHp * 0.1), runtime.log);
        if (healed > 0) runtime.log('heal', `🍀 祭品不足反而歪出补偿，${user.name} 恢复了 ${healed} 点生命并获得法术抵挡！`);
      }
      return;
    }
    const sacrificed = potentialTributes.sort(() => 0.5 - Math.random()).slice(0, skill.tributes);
    summonMaterials = sacrificed.map((fighter) => fighter.name);
    runtime.log('death', `💀 献祭！${sacrificed.map((fighter) => fighter.name).join('、')} 化为了召唤 ${skill.summonName} 的祭品！`);
    sacrificed.forEach((victim) => {
      runtime.markDefeated(victim, { awardKill: false });
      victim.isDead = true;
    });
  }
  if (skill.summonName === '小汀(傀儡)') {
    if (!user.hasSpinalSword || !hasIdentity(user, 'SPINAL_SWORD')) {
      runtime.clearSpinalSword(user);
      runtime.log('info', `🚫 ${user.name} 试图唤醒脊髓剑怨念，但手中已经没有完整的脊髓剑了...`);
      return;
    }
    if (runtime.fighters.some((fighter) => fighter.isTing && runtime.isActiveCombatant(fighter))) {
      user.jobData.skills = user.jobData.skills.filter((skillId) => skillId !== 'summon_puppet_ting');
      runtime.log('info', `🚫 ${user.name} 试图唤醒脊髓剑怨念，但感应到小汀本体尚存...`);
      return;
    }
    if (runtime.fighters.some((fighter) => getSummonBaseName(fighter) === '小汀(傀儡)' && runtime.isActiveCombatant(fighter) && fighter.summonerId === user.id)) return;
  }

  const summonJobKey = skill.summonJob ?? 'WARRIOR';
  const summonJob = (runtime.jobs[summonJobKey] ?? runtime.jobs.WARRIOR)!;
  const summonBaseName = skill.summonName ?? '召唤物';
  const summonName = formatSummonName(runtime, summonBaseName);
  const isAdvancedSummon = !!skill.advancedSummon || isAdvancedSummonName(summonBaseName);
  const summon: Fighter = {
    id: createSummonId(runtime),
    name: summonName,
    displayName: summonName,
    job: summonJobKey,
    jobData: cloneJobDefinition(summonJob),
    maxHp: skill.stats?.hp ?? 2000,
    currentHp: skill.stats?.hp ?? 2000,
    hpPct: 1.0,
    atk: skill.stats?.atk ?? 200,
    def: skill.stats?.def ?? 100,
    spd: skill.stats?.spd ?? 120,
    agl: skill.stats?.agl ?? 100,
    mag: skill.stats?.mag ?? 100,
    res: skill.stats?.res ?? 100,
    wis: skill.stats?.wis ?? 100,
    critRate: 0.1,
    color: user.color,
    isDead: false,
    isDeadAnnounced: false,
    statuses: [],
    stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
    summonerId: user.id,
    summonBaseName,
    isSummon: true,
    isAdvancedSummon,
    hasUsedExodiaObliterate: false,
    hasUsedExodiaGuard: false,
    hasUsedRaPhoenix: false,
    hasUsedRaTingGuard: false,
    raChantBoost: 0,
    blueEyesUltimateStrain: 0,
    blueEyesUltimateGuardCount: 0,
  };
  if (skill.summonName === '史尔特尔' && surtrTributeGroup && surtrOwlTeamId) {
    summon.isSurtr = true;
    summon.teamId = userTeamId;
    summon.surtrState = initializeSurtrState(
      user,
      userTeamId,
      surtrTributeGroup.owl,
      surtrOwlTeamId,
    );
  }
  if (skill.summonName === '翼神龙') {
    summon.raChantBoost = 1;
    applyStatus(summon, {
      identityId: GACHA_RA_PHOENIX_STATUS,
      remainingTurns: 6,
      attribution: { effectSourceId: GACHA_RA_PHOENIX_STATUS },
    });
    applyStatus(summon, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'ra_divine_aura' } });
    applyStatus(summon, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'ra_divine_aura' } });
    applyStatus(summon, { identityId: 'REGEN', remainingTurns: 3 });
  }
  initializeEffectState(summon);
  runtime.fighters.push(summon);
  if (skill.summonName === '小汀(傀儡)') runtime.syncPuppetMasterStatus(user);
  const summonText = runtime.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name);
  const summonKind = skill.summonName === '黑暗大法师'
    ? 'exodia'
    : skill.summonName === '青眼究极龙'
      ? 'fusion'
      : (skill.tributes ?? 0) > 0 || skill.summonName === '史尔特尔'
        ? 'tribute'
        : GACHA_ORDINARY_SUMMON_NAMES.includes(skill.summonName ?? '')
          ? 'reveal'
          : undefined;
  if (summonKind === 'exodia') summonMaterials = [...(user.exodiaPieces ?? [])];
  runtime.log('skill', `${summonText}\n✨ 【召唤成功】${user.name} 召唤出了 ${summonName}！`, summonKind ? {
    targetIds: [summon.id],
    visualCue: {
      kind: 'summon_card',
      summonKind,
      summonerId: user.id,
      summonId: summon.id,
      summonName: summonBaseName,
      materials: summonMaterials,
    },
  } : { targetIds: [summon.id] });
  if (skill.summonName === '翼神龙') {
    runtime.log('buff', `☀️ 【太阳神降临】${summonName} 入场即获得 1 层太阳神力、法术抵挡、神性金身与再生，并点燃一次【神不死鸟】复燃！`);
  }
  if (skill.summonName === '史尔特尔' && surtrTributeGroup) {
    const ownerRelation = userTeamId === surtrOwlTeamId ? '同阵营共同主人' : '敌对阵营共同主人';
    runtime.log(
      'crit',
      `🔥 【共同主人确立】${summonName} 同时认 ${user.name} 与 ${surtrTributeGroup.owl.name} 为主人（${ownerRelation}）。黄昏的尽头，莱万汀将烧尽一切。`,
      { actorId: summon.id, actorName: summon.name, targetIds: [user.id, surtrTributeGroup.owl.id] },
    );
    syncSurtrAffiliation({
      fighters: runtime.fighters,
      getTeamId: runtime.getTeamId,
      isActiveCombatant: runtime.isActiveCombatant,
      log: runtime.log,
    }, summon, { announceInitial: true, resetBaseline: true });
  }
  tryMomoBanishBlueEyes(runtime, summon, user);
}
