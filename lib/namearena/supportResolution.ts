import type {
  BattleEngineData,
  Fighter,
  SkillDefinition,
  StatKey,
} from './types';
import { healFighter } from './combatState';
import {
  COMMON_NEGATIVE_STATUS_TYPES,
  isStatusType,
} from './statusRules';

export interface SupportResolutionRuntime {
  fighters: Fighter[];
  skillTags: Record<string, string>;
  data: BattleEngineData;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  syncHpPct: (fighter: Fighter) => void;
  formatSkillText: (skill: SkillDefinition, text: string) => string;
  log: (type: string, text: string) => void;
}

export function spreadDivaSupport(
  runtime: SupportResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  userTeamId: string,
): void {
  if (user.job !== 'VIRTUAL_DIVA' || (skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL)) return;

  const teammates = runtime.fighters.filter((fighter) => runtime.isActiveCombatant(fighter) && fighter.id !== user.id && runtime.getTeamId(fighter) === userTeamId);
  teammates.forEach((mate) => {
    if (skill.tag === runtime.skillTags.HEAL) {
      if (!mate.status.some((status) => status.type === 'NO_HEAL')) {
        healFighter(mate, Math.floor(Math.max(user.atk, user.mag) * (skill.mult ?? 1)));
      }
    }
    if (skill.tag === runtime.skillTags.BUFF) {
      if (skill.status) {
        if (skill.status.startsWith('PLUG_')) mate.status = mate.status.filter((status) => status.type !== skill.status);
        mate.status.push({ type: skill.status, duration: skill.status === 'INVUL' ? 1 : 3 });
      }
      if (skill.statBuff) {
        const buff = skill.statBuff;
        (Object.keys(buff) as (StatKey | 'crit')[]).forEach((key) => {
          if (key !== 'crit' && mate[key] !== undefined) mate[key] = Math.floor(mate[key] * (buff[key] ?? 1));
        });
      }
    }
    if (skill.cleanStatus) cleanseCommonNegativeStatuses(mate);
  });
  if (teammates.length > 0) runtime.log('buff', `🎵 歌姬的光环！${user.name} 的技能效果同步给了 ${teammates.length} 名队友！`);
}

export function cleanseCommonNegativeStatuses(target: Fighter): void {
  target.status = target.status.filter((status) => !isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
}

export function applyStatBuff(target: Fighter, buff: Partial<Record<StatKey | 'crit', number>>): void {
  (Object.keys(buff) as (StatKey | 'crit')[]).forEach((key) => {
    if (key !== 'crit' && target[key] !== undefined) {
      target[key] = Math.floor(target[key] * (buff[key] ?? 1));
    } else if (key === 'crit') {
      target.critRate += buff.crit ?? 0;
    }
  });
}

export function handleChimeraUltimateEvolution(
  runtime: SupportResolutionRuntime,
  target: Fighter,
): void {
  const chimeraPluginSkills = new Set(
    (runtime.data.CHIMERA_PLUGIN_POOL ?? [])
      .map((entry) => entry.newSkill)
      .filter((entry): entry is string => !!entry),
  );
  const currentPlugCount = target.jobData.skills.filter((skillId) => chimeraPluginSkills.has(skillId)).length;
  if (currentPlugCount < 8 || target.hasUltimateEvolved) return;

  target.hasUltimateEvolved = true;
  target.jobData.skills = target.jobData.skills.filter((skillId) => skillId !== 'chimera_install' && skillId !== 'chimera_strike');
  target.atk = Math.floor(target.atk * 3.0);
  target.mag = Math.floor(target.mag * 3.0);
  target.def = Math.floor(target.def * 2.0);
  target.res = Math.floor(target.res * 2.0);
  target.spd = Math.floor(target.spd * 1.5);
  target.maxHp = Math.floor(target.maxHp * 1.8);
  target.currentHp = target.maxHp;
  runtime.syncHpPct(target);
  runtime.log('win', `🧬 警告！${target.name} 已完成究极进化！全插件安装完毕！\n封印解除，全属性引发恐怖的裂变！化身为最高级别的神级灾厄！`);
}

export function executeSupportSkill(
  runtime: SupportResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  forcedTarget: Fighter | null,
  userTeamId: string,
): boolean {
  if (skill.tag !== runtime.skillTags.HEAL && skill.tag !== runtime.skillTags.BUFF) return false;

  let targetForBuff = (forcedTarget && runtime.getTeamId(forcedTarget) === userTeamId) ? forcedTarget : user;
  if (user.job === 'MY_BABY') {
    targetForBuff = runtime.fighters.find((fighter) => fighter.isSuccubus && runtime.isActiveCombatant(fighter) && runtime.getTeamId(fighter) === userTeamId) ?? targetForBuff;
  }

  if (skill.tag === runtime.skillTags.HEAL) {
    if (targetForBuff.status.some((status) => status.type === 'NO_HEAL')) {
      runtime.log('info', `🥀 ${targetForBuff.name} 处于禁疗状态，无法接受治疗！`);
      return true;
    }
    const heal = Math.floor(Math.max(user.atk, user.mag) * (skill.mult ?? 1));
    const healed = healFighter(targetForBuff, heal);
    if (skill.cleanStatus) cleanseCommonNegativeStatuses(targetForBuff);
    let healMessage = runtime.formatSkillText(skill, skill.text ?? '');
    if (!healMessage.includes('{VAL}')) healMessage += ` (恢复 {VAL} 点生命)`;
    runtime.log('heal', healMessage.replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name).replace(/{VAL}/g, String(healed)));
    return true;
  }

  if (skill.status) {
    let duration = skill.status === 'INVUL' ? 1 : (skill.status.startsWith('CTR_') ? 5 : 3);
    if (skill.status.startsWith('CTR_')) targetForBuff.status = targetForBuff.status.filter((status) => !status.type.startsWith('CTR_'));
    if (skill.status.startsWith('PLUG_')) {
      if (skill.statBuff) applyStatBuff(targetForBuff, skill.statBuff);
      if (skill.newSkill && !targetForBuff.jobData.skills.includes(skill.newSkill)) {
        targetForBuff.jobData.skills.push(skill.newSkill);
        handleChimeraUltimateEvolution(runtime, targetForBuff);
      }
      duration = 999;
    }
    if (skill.status.startsWith('PLUG_')) {
      targetForBuff.status = targetForBuff.status.filter((status) => status.type !== skill.status);
    }
    targetForBuff.status.push({ type: skill.status, duration });
  }
  if (skill.statBuff && !skill.status?.startsWith('PLUG_')) {
    applyStatBuff(targetForBuff, skill.statBuff);
  }
  if (skill.cleanStatus) cleanseCommonNegativeStatuses(targetForBuff);
  runtime.log('buff', runtime.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name));
  return true;
}
