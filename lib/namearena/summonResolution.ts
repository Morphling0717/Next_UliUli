import type {
  BattleEngineCore,
  DefeatOptions,
  Fighter,
  JobDefinition,
  SkillDefinition,
} from './types';
import { cloneJobDefinition, healFighter } from './combatState';
import {
  GACHA_RA_PHOENIX_STATUS,
  grantGachaLuck,
  isAdvancedSummonName,
  isLuckEmperor,
} from './gachaMechanics';
import {
  createStatusEntry,
  grantStatus,
} from './defenseStatus';

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
  log: (type: string, text: string) => void;
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

export function executeSummonSkill(
  runtime: SummonResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  userTeamId: string,
): void {
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
    [blueEyes, ...ordinaryMaterials].forEach((victim) => {
      runtime.markDefeated(victim, { awardKill: false });
      victim.isDead = true;
    });
    runtime.log('death', `💀 融合！${[blueEyes, ...ordinaryMaterials].map((fighter) => fighter.name).join('、')} 化为了召唤 青眼究极龙 的融合素材！`);
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
        const shield = user.status.find((status) => status.type === 'SPELL_BLOCK');
        if (shield) {
          shield.duration = Math.max(shield.duration, 2);
          shield.sourceId = 'gacha_tribute_compensation';
        } else {
          user.status.push(createStatusEntry('SPELL_BLOCK', 2, 'gacha_tribute_compensation'));
        }
        if (!user.status.some((status) => status.type === 'NO_HEAL')) {
          const healed = healFighter(user, Math.floor(user.maxHp * 0.1));
          if (healed > 0) runtime.log('heal', `🍀 祭品不足反而歪出补偿，${user.name} 恢复了 ${healed} 点生命并获得法术抵挡！`);
        }
      }
      return;
    }
    const sacrificed = potentialTributes.sort(() => 0.5 - Math.random()).slice(0, skill.tributes);
    sacrificed.forEach((victim) => {
      runtime.markDefeated(victim, { awardKill: false });
      victim.isDead = true;
    });
    runtime.log('death', `💀 献祭！${sacrificed.map((fighter) => fighter.name).join('、')} 化为了召唤 ${skill.summonName} 的祭品！`);
  }
  if (skill.summonName === '小汀(傀儡)') {
    if (!user.hasSpinalSword || !user.status.some((status) => status.type === 'SPINAL_SWORD')) {
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
    id: runtime.core.generateUUID ? runtime.core.generateUUID() : `summon-${Math.random()}`,
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
    status: [],
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
  if (skill.summonName === '翼神龙') {
    summon.raChantBoost = 1;
    summon.status.push({ type: GACHA_RA_PHOENIX_STATUS, duration: 6 });
    grantStatus(summon, 'SPELL_BLOCK', 2, 'ra_divine_aura');
    grantStatus(summon, 'BKB', 1, 'ra_divine_aura');
    summon.status.push({ type: 'REGEN', duration: 3 });
  }
  runtime.fighters.push(summon);
  if (skill.summonName === '小汀(傀儡)') runtime.syncPuppetMasterStatus(user);
  const summonText = runtime.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name);
  runtime.log('skill', `${summonText}\n✨ 【召唤成功】${user.name} 召唤出了 ${summonName}！`);
  if (skill.summonName === '翼神龙') {
    runtime.log('buff', `☀️ 【太阳神降临】${summonName} 入场即获得 1 层太阳神力、法术抵挡、神性金身与再生，并点燃一次【神不死鸟】复燃！`);
  }
}
