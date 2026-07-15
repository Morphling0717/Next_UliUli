import type {
  BattleEngineData,
  DamageApplicationOptions,
  DefeatOptions,
  Fighter,
  SkillDefinition,
  StatKey,
  StatusApplicationOptions,
} from './types';
import { healFighter } from './combatState';
import {
  COMMON_NEGATIVE_STATUS_TYPES,
  COUNTER_STANCE_STATUS_TYPES,
  isStatusType,
} from './statusRules';
import {
  grantStatus,
  statusSourceFromSkill,
} from './defenseStatus';
import { isSelectableTargetFor } from './targeting';
import {
  applyPermanentStatBuff,
  applyTimedStatModifier,
  makeTimedStatModifier,
} from './statModifiers';

export interface SupportResolutionRuntime {
  fighters: Fighter[];
  skillTags: Record<string, string>;
  data: BattleEngineData;
  turnCount: number;
  getTeamId: (fighter: Fighter) => string;
  isActiveCombatant: (fighter: Fighter) => boolean;
  syncHpPct: (fighter: Fighter) => void;
  applyDamage: (
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage?: boolean,
    attacker?: Fighter,
    options?: DamageApplicationOptions,
  ) => number;
  applyStatus: (target: Fighter, type: string, duration: number, options?: StatusApplicationOptions) => boolean;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  formatSkillText: (skill: SkillDefinition, text: string) => string;
  log: (type: string, text: string) => void;
}

function isSpreadableDivaStatus(statusType: string): boolean {
  if (statusType.startsWith('PLUG_')) return false;
  if (statusType.startsWith('CTR_')) return false;
  if (statusType.startsWith('STYLE_')) return false;
  if (statusType.startsWith('WT_')) return false;
  if (statusType.startsWith('GAMER_')) return false;
  if (statusType.startsWith('VALO_')) return false;
  if (statusType.startsWith('BABY_')) return false;
  return true;
}

function grantTemporaryStatBuff(
  target: Fighter,
  skill: SkillDefinition,
  duration: number,
): void {
  if (!skill.statBuff) return;
  const statusType = skill.status ?? 'TEMP_STAT_BUFF';
  const statusSourceId = statusSourceFromSkill(skill) ?? `skill:${skill.name}`;
  grantStatus(target, statusType, duration, statusSourceId);
  const status = target.status.find((entry) => entry.type === statusType && entry.sourceId === statusSourceId);
  const modifierId = `stat:${statusType}:${statusSourceId}`;
  if (status) {
    status.modifierId = modifierId;
    if (statusType === 'TEMP_STAT_BUFF') {
      status.displayName = skill.name;
      status.displayIcon = '⬆️';
      status.displayDesc = '限时属性强化；状态结束后属性会准确还原';
    }
  }
  applyTimedStatModifier(
    target,
    makeTimedStatModifier(modifierId, statusType, skill.statBuff, statusSourceId),
  );
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
      if (skill.status && isSpreadableDivaStatus(skill.status)) {
        const sourceId = statusSourceFromSkill(skill) ?? (skill.statBuff ? `skill:${skill.name}` : undefined);
        grantStatus(mate, skill.status, skill.status === 'INVUL' ? 1 : 3, sourceId);
      }
      if (skill.statBuff) {
        grantTemporaryStatBuff(mate, skill, skill.status === 'INVUL' ? 1 : 3);
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
  applyPermanentStatBuff(target, buff);
}

function getChimeraPluginSkillSet(runtime: SupportResolutionRuntime): Set<string> {
  return new Set(
    (runtime.data.CHIMERA_PLUGIN_POOL ?? [])
      .map((entry) => entry.newSkill)
      .filter((entry): entry is string => !!entry),
  );
}

function getChimeraPluginCount(runtime: SupportResolutionRuntime, target: Fighter): number {
  const chimeraPluginSkills = getChimeraPluginSkillSet(runtime);
  return target.jobData.skills.filter((skillId) => chimeraPluginSkills.has(skillId)).length;
}

function isChimeraPluginInstall(runtime: SupportResolutionRuntime, target: Fighter, skill: SkillDefinition): boolean {
  if (!skill.status?.startsWith('PLUG_')) return false;
  if (!target.isSuccubus || !target.transformed) return false;
  return (runtime.data.CHIMERA_PLUGIN_POOL ?? []).some((entry) =>
    entry.status === skill.status &&
    !!entry.newSkill &&
    entry.newSkill === skill.newSkill,
  );
}

function activeEnemiesOf(runtime: SupportResolutionRuntime, user: Fighter): Fighter[] {
  return runtime.fighters.filter((fighter) =>
    isSelectableTargetFor(runtime, user, fighter),
  );
}

function pickRandomEnemy(runtime: SupportResolutionRuntime, user: Fighter): Fighter | null {
  const enemies = activeEnemiesOf(runtime, user);
  if (enemies.length === 0) return null;
  return enemies[Math.floor(Math.random() * enemies.length)] ?? null;
}

function cleanseOneCommonNegativeStatus(target: Fighter): string | null {
  const index = target.status.findIndex((status) => isStatusType(status.type, COMMON_NEGATIVE_STATUS_TYPES));
  if (index < 0) return null;
  const [removed] = target.status.splice(index, 1);
  return removed?.type ?? null;
}

interface ChimeraSideDamageResult {
  actual: number;
  landedOnTarget: boolean;
}

function applyChimeraSideDamage(
  runtime: SupportResolutionRuntime,
  user: Fighter,
  target: Fighter,
  amount: number,
  actionName: string,
  logText: (actual: number) => string,
): ChimeraSideDamageResult {
  const damageOptions: DamageApplicationOptions = {
    actionName,
    respectDefenses: true,
    canTriggerWaitCounter: false,
  };
  const actual = runtime.applyDamage(target, Math.max(1, Math.floor(amount)), 'skill', false, user, damageOptions);
  const resolvedActual = damageOptions.redirectedOriginiumDamage ?? damageOptions.redirectedOwlEmperorDamage ?? actual;
  if (damageOptions.redirectedByOriginiumCore) {
    runtime.log('skill', `🜚 【${actionName}】${user.name} 对 ${target.name} 的攻击被转入源石网络，共对源石结晶结算 ${resolvedActual} 点伤害；阿喃那本体未受伤！`);
  } else {
    runtime.log(actual > 0 ? 'skill' : 'info', logText(actual));
  }
  if (damageOptions.redirectedByOwlEmperor) {
    runtime.log('info', `🐲 ${target.name} 的帝王之征接管了伤害，龙实际承受 ${resolvedActual} 点。`);
  }
  const landedOnTarget = !damageOptions.redirectedByJoker && !damageOptions.redirectedByOriginiumCore && !damageOptions.redirectedByOwlEmperor && actual > 0;
  if (landedOnTarget && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
    runtime.markDefeated(target, {
      message: `💀 【${actionName}】${target.name} 被 ${user.name} 安装插件时爆发的异变余波击倒！`,
      killer: user,
    });
  }
  return { actual: resolvedActual, landedOnTarget };
}

function applyChimeraInstallSideEffect(
  runtime: SupportResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (!user.isSuccubus || !user.transformed || !skill.status?.startsWith('PLUG_')) return;

  if (skill.status === 'PLUG_HEART') {
    const healed = healFighter(user, Math.floor(user.maxHp * 0.12));
    const cleaned = cleanseOneCommonNegativeStatus(user);
    grantStatus(user, 'REGEN', 3);
    runtime.syncHpPct(user);
    const cleanText = cleaned ? `，排出了【${runtime.data.STATUS_EFFECTS[cleaned]?.name ?? cleaned}】` : '';
    const healText = healed > 0 ? `恢复 ${healed} 点生命` : '生命已满，治疗溢出';
    runtime.log('heal', `☢️ 【永动炉心】${user.name} 的新心脏开始泵动，${healText}${cleanText}，并获得再生！`);
    return;
  }

  if (skill.status === 'PLUG_SKIN') {
    const healed = healFighter(user, Math.floor(user.maxHp * 0.06));
    grantStatus(user, 'BKB', 1, 'chimera_adaptive_skin');
    grantStatus(user, 'SPELL_BLOCK', 1, 'chimera_adaptive_skin');
    runtime.syncHpPct(user);
    const healText = healed > 0 ? `恢复 ${healed} 点生命` : '生命已满，治疗溢出';
    runtime.log('buff', `🛡️ 【纳米皮肤】${user.name} 的外壳完成自适应硬化，${healText}，并获得短暂抗控制与法术抵挡！`);
    return;
  }

  if (skill.status === 'PLUG_LEG') {
    grantStatus(user, 'AIM', 1);
    runtime.log('buff', `🦶 【反重力足】${user.name} 的机动回路重新校准，下一次攻击进入锁定状态！`);
    return;
  }

  const enemy = pickRandomEnemy(runtime, user);
  if (!enemy) return;

  if (skill.status === 'PLUG_HEAD') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      user.atk * 0.55 + user.mag * 0.25,
      '暴食之口启动',
      (damage) => `🦷 【暴食之口启动】${user.name} 的新口器咬向 ${enemy.name}，实际造成 ${damage} 点伤害！`,
    );
    const healed = healFighter(user, Math.floor(result.actual * 0.45));
    runtime.syncHpPct(user);
    if (healed > 0) runtime.log('heal', `🦷 【暴食回流】${user.name} 吞下生命力，恢复 ${healed} 点生命！`);
    return;
  }

  if (skill.status === 'PLUG_ARM') {
    applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      user.atk * 0.78,
      '斩舰巨刃校准',
      (damage) => `⚔️ 【斩舰巨刃校准】${user.name} 挥动新生巨刃试斩 ${enemy.name}，实际造成 ${damage} 点伤害！`,
    );
    return;
  }

  if (skill.status === 'PLUG_BACK') {
    const enemies = activeEnemiesOf(runtime, user).sort(() => Math.random() - 0.5).slice(0, 2);
    enemies.forEach((target) => {
      applyChimeraSideDamage(
        runtime,
        user,
        target,
        user.mag * 0.42,
        '浮游炮试射',
        (damage) => `🛸 【浮游炮试射】${user.name} 的浮游炮锁定 ${target.name}，实际造成 ${damage} 点魔法伤害！`,
      );
    });
    return;
  }

  if (skill.status === 'PLUG_EYE') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      user.mag * 0.35,
      '石化魔眼校准',
      (damage) => damage > 0
        ? `👁️ 【石化魔眼校准】${user.name} 看穿 ${enemy.name} 的破绽，实际造成 ${damage} 点魔法伤害！`
        : `👁️ 【石化魔眼校准】${user.name} 试图看穿 ${enemy.name} 的破绽，但没有造成实际伤害，虚弱没有生效！`,
    );
    if (result.landedOnTarget && runtime.isActiveCombatant(enemy) && runtime.applyStatus(enemy, 'WEAK', 2, { effectName: '石化魔眼校准的虚弱效果' })) {
      runtime.log('debuff', `👁️ 【石化魔眼校准】${enemy.name} 被施加虚弱 2 回合！`);
    }
    return;
  }

  if (skill.status === 'PLUG_TAIL') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      user.mag * 0.45 + user.atk * 0.25,
      '灾厄毒尾甩击',
      (damage) => damage > 0
        ? `🦂 【灾厄毒尾甩击】${user.name} 的毒尾扫中 ${enemy.name}，实际造成 ${damage} 点伤害！`
        : `🦂 【灾厄毒尾甩击】${user.name} 的毒尾扫过 ${enemy.name}，但没有造成实际伤害！`,
    );
    if (result.landedOnTarget && runtime.isActiveCombatant(enemy) && runtime.applyStatus(enemy, 'POISON', 2, { effectName: '灾厄毒尾甩击的剧毒效果' })) {
      runtime.log('debuff', `🦂 【灾厄毒尾甩击】${enemy.name} 被注入剧毒 2 回合！`);
    }
  }
}

function applyChimeraMilestoneRewards(
  runtime: SupportResolutionRuntime,
  target: Fighter,
  plugCount: number,
): void {
  if (!target.isSuccubus || !target.transformed) return;
  const currentMilestone = target.chimeraMilestoneLevel ?? 0;

  if (currentMilestone < 2 && plugCount >= 2) {
    target.chimeraMilestoneLevel = 2;
    const healed = healFighter(target, Math.floor(target.maxHp * 0.155));
    const cleaned = cleanseOneCommonNegativeStatus(target);
    grantStatus(target, 'REGEN', 3);
    runtime.syncHpPct(target);
    const cleanText = cleaned ? `，排出了【${runtime.data.STATUS_EFFECTS[cleaned]?.name ?? cleaned}】` : '';
    const healText = healed > 0 ? `恢复 ${healed} 点生命` : '生命已满，治疗溢出';
    runtime.log('heal', `🧬 【合成稳定】${target.name} 的第 2 个插件接入完成，${healText}${cleanText}，身体开始稳定再生！`);
  }

  if (currentMilestone < 4 && plugCount >= 4) {
    target.chimeraMilestoneLevel = 4;
    target.chimeraInstantActionQueued = true;
    applyPermanentStatBuff(target, { atk: 1.068, mag: 1.068, spd: 1.05 });
    grantStatus(target, 'AIM', 1);
    grantStatus(target, 'BKB', 1, 'chimera_startup_core');
    runtime.log('buff', `🧬 【兽性苏醒】${target.name} 的第 4 个插件接入完成，攻击、魔力与速度小幅裂变，锁定猎物并准备立刻追加一次插件行动！`);
  }

  if (currentMilestone < 6 && plugCount >= 6) {
    target.chimeraMilestoneLevel = 6;
    applyPermanentStatBuff(target, { atk: 1.14, mag: 1.14, def: 1.105, res: 1.105 });
    target.maxHp = Math.floor(target.maxHp * 1.14);
    target.currentHp = Math.min(target.maxHp, target.currentHp + Math.floor(target.maxHp * 0.235));
    runtime.syncHpPct(target);
    grantStatus(target, 'INVUL', 1, 'chimera_disaster_omen');
    grantStatus(target, 'SPELL_BLOCK', 2, 'chimera_disaster_omen');
    grantStatus(target, 'AIM', 1);
    runtime.log('buff', `☣️ 【灾厄预兆】${target.name} 的第 6 个插件接入完成，肉体进入半成型裂变，并短暂脱离常理！`);
  }
}

export function handleChimeraUltimateEvolution(
  runtime: SupportResolutionRuntime,
  target: Fighter,
): void {
  const currentPlugCount = getChimeraPluginCount(runtime, target);
  if (currentPlugCount < 8 || target.hasUltimateEvolved) return;

  target.hasUltimateEvolved = true;
  target.jobData.skills = target.jobData.skills.filter((skillId) => skillId !== 'chimera_install' && skillId !== 'chimera_strike');
  applyPermanentStatBuff(target, { atk: 2.26, mag: 2.26, def: 1.62, res: 1.62, spd: 1.23 });
  target.maxHp = Math.floor(target.maxHp * 1.53);
  target.currentHp = target.maxHp;
  runtime.syncHpPct(target);
  runtime.log('buff', `🧬 警告！${target.name} 已完成究极进化！全插件安装完毕！\n封印解除，全属性引发恐怖的裂变！化身为最高级别的神级灾厄！`);
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
    if (healed <= 0) {
      const cleanText = skill.cleanStatus ? '，并清除了异常状态' : '';
      runtime.log('heal', `✨ 【${skill.name}】${user.name} 试图治疗 ${targetForBuff.name}，但生命已满，治疗溢出${cleanText}。`);
      return true;
    }
    let healMessage = runtime.formatSkillText(skill, skill.text ?? '');
    if (!healMessage.includes('{VAL}')) healMessage += ` (恢复 {VAL} 点生命)`;
    runtime.log('heal', healMessage.replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name).replace(/{VAL}/g, String(healed)));
    return true;
  }

  let installedChimeraPlug = false;
  let chimeraPlugCountAfterInstall = 0;
  let shouldCheckChimeraUltimate = false;

  if (skill.status) {
    const isCounterStance = isStatusType(skill.status, COUNTER_STANCE_STATUS_TYPES);
    const isPlugStatus = skill.status.startsWith('PLUG_');
    const isValidChimeraPlug = isPlugStatus && isChimeraPluginInstall(runtime, targetForBuff, skill);
    if (isPlugStatus && !isValidChimeraPlug) {
      runtime.log('info', `⚠️ 【状态归属校验】${skill.name ?? '未知技能'} 试图给 ${targetForBuff.name} 安装克蕾儿插件【${runtime.data.STATUS_EFFECTS[skill.status]?.name ?? skill.status}】，已被拦截。`);
      return true;
    }

    let duration = skill.status === 'INVUL' ? 1 : (isCounterStance ? 5 : 3);
    if (isCounterStance) targetForBuff.status = targetForBuff.status.filter((status) => !isStatusType(status.type, COUNTER_STANCE_STATUS_TYPES));
    if (isValidChimeraPlug) {
      if (skill.statBuff) applyPermanentStatBuff(targetForBuff, skill.statBuff);
      if (skill.newSkill && !targetForBuff.jobData.skills.includes(skill.newSkill)) {
        targetForBuff.jobData.skills.push(skill.newSkill);
        installedChimeraPlug = !!targetForBuff.isSuccubus && !!targetForBuff.transformed;
        chimeraPlugCountAfterInstall = getChimeraPluginCount(runtime, targetForBuff);
        shouldCheckChimeraUltimate = true;
      }
      duration = 999;
    }
    if (isValidChimeraPlug) {
      targetForBuff.status = targetForBuff.status.filter((status) => status.type !== skill.status);
    }
    const statusSourceId = statusSourceFromSkill(skill) ?? (skill.statBuff ? `skill:${skill.name}` : undefined);
    grantStatus(targetForBuff, skill.status, duration, statusSourceId);
  }
  if (skill.statBuff && !skill.status?.startsWith('PLUG_')) {
    const duration = skill.status === 'INVUL' ? 1 : (skill.status && isStatusType(skill.status, COUNTER_STANCE_STATUS_TYPES) ? 5 : 3);
    grantTemporaryStatBuff(targetForBuff, skill, duration);
  }
  if (skill.cleanStatus) cleanseCommonNegativeStatuses(targetForBuff);
  runtime.log('buff', runtime.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name));
  if (installedChimeraPlug && skill.status?.startsWith('PLUG_')) {
    applyChimeraInstallSideEffect(runtime, targetForBuff, skill);
    applyChimeraMilestoneRewards(runtime, targetForBuff, chimeraPlugCountAfterInstall);
    if (shouldCheckChimeraUltimate) handleChimeraUltimateEvolution(runtime, targetForBuff);
  }
  return true;
}
