import type {
  BattleEngineData,
  DamageApplicationOptions,
  DefeatOptions,
  DispelOptions,
  DispelResolution,
  Fighter,
  SkillDefinition,
  StatKey,
  StatusApplication,
  StatusInstance,
  BattleLogMetadata,
} from './types';
import { applyPermanentStatBuff, healFighter, resolveHealing } from './combatState';
import { isSelectableTargetFor } from './targeting';
import {
  getStatusIdentityDefinition,
  getStatusIdentityIdsByTag,
  identityHasTag,
  STATUS_IDENTITIES,
} from './statusRegistry';
import { dispelStatusEffects, queryMechanic, removeEffects, applyStatus } from './statusSystem';
import { buildStatusPresentationMember } from './statusPresentation';
import { getEffectiveCombatStat } from './statusMechanics';
import { resolveDeclarativeSkillDispel } from './skillDispel';
import { primaryStatusIdentity, statusApplicationsOf } from './skillEffects';
import type { ReactionActionDescriptor } from './characterHooks';
import { didDamageConnect, getResolvedDamageTotal, isDamageRedirected } from './damageRedirects';

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
  applyStatus: (target: Fighter, application: StatusApplication) => boolean;
  dispelStatusEffects: (target: Fighter, options: DispelOptions) => DispelResolution;
  markDefeated: (target: Fighter, options?: DefeatOptions) => boolean;
  flushDeferredDamageEvents: (fighter: Fighter, phase?: 'mitigation' | 'all') => void;
  runReactionAction: (actor: Fighter, descriptor: ReactionActionDescriptor, callback: () => void) => void;
  formatSkillText: (skill: SkillDefinition, text: string) => string;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
}

function isSpreadableDivaStatus(statusType: string): boolean {
  return !identityHasTag(statusType, 'not_diva_spreadable');
}

function effectiveStat(fighter: Fighter, key: StatKey): number {
  return getEffectiveCombatStat(fighter, key, 'custom');
}

export function spreadDivaSupport(
  runtime: SupportResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  userTeamId: string,
): void {
  if (user.job !== 'VIRTUAL_DIVA' || (skill.tag !== runtime.skillTags.BUFF && skill.tag !== runtime.skillTags.HEAL)) return;

  const teammates = runtime.fighters.filter((fighter) => runtime.isActiveCombatant(fighter) && fighter.id !== user.id && runtime.getTeamId(fighter) === userTeamId);
  const hasAlliesDispel = (skill.dispelSpecs ?? []).some((spec) => spec.target === 'allies');
  teammates.forEach((mate) => {
    if (!hasAlliesDispel) {
      resolveDeclarativeSkillDispel(runtime, skill, user, mate, 'before_action', 'after_recovery');
    }
    if (skill.tag === runtime.skillTags.HEAL) {
      healFighter(mate, Math.floor(Math.max(effectiveStat(user, 'atk'), effectiveStat(user, 'mag')) * (skill.mult ?? 1)), runtime.log, {
        kind: 'direct',
        sourceId: skill.name,
        healer: user,
      });
    }
    if (skill.tag === runtime.skillTags.BUFF) {
      for (const declared of statusApplicationsOf(skill)) {
        if (!isSpreadableDivaStatus(declared.identityId)) continue;
        const definition = getStatusIdentityDefinition(declared.identityId);
        const lifecycle = definition.dualValue
          ? { count: declared.count ?? definition.defaultCount ?? 1 }
          : definition.expiresOn === 'trigger'
            ? { charges: declared.charges ?? definition.defaultCharges ?? 3 }
            : definition.expiresOn === 'never'
              ? {}
              : { remainingTurns: declared.remainingTurns ?? (declared.identityId === 'INVUL' ? 1 : 3) };
        const application = { ...declared };
        delete application.target;
        runtime.applyStatus(mate, {
          ...lifecycle,
          ...application,
          effectName: declared.effectName ?? skill.name,
          attribution: {
            ...declared.attribution,
            effectSourceId: declared.attribution?.effectSourceId ?? declared.identityId,
            applierId: user.id,
            applierName: user.name,
          },
          silent: true,
        });
      }
    }
    if (!hasAlliesDispel) {
      resolveDeclarativeSkillDispel(runtime, skill, user, mate, 'after_recovery', 'after_recovery');
    }
  });
  if (teammates.length > 0) runtime.log('buff', `🎵 歌姬的光环！${user.name} 的技能效果同步给了 ${teammates.length} 名队友！`);
}

export function cleanseCommonNegativeStatuses(target: Fighter): void {
  dispelStatusEffects(target, { strength: 'normal', direction: 'negative' });
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
  const identityId = primaryStatusIdentity(skill);
  if (!identityId || !identityHasTag(identityId, 'chimera_plug')) return false;
  if (!target.isSuccubus || !target.transformed) return false;
  return (runtime.data.CHIMERA_PLUGIN_POOL ?? []).some((entry) =>
    primaryStatusIdentity(entry) === identityId &&
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

function cleanseOneCommonNegativeStatus(runtime: SupportResolutionRuntime, target: Fighter): StatusInstance | null {
  const removable = Object.values(STATUS_IDENTITIES)
    .filter((identity) => identity.polarity === 'negative' && identity.dispelTier === 'normal')
    .flatMap((identity) => queryMechanic(target, identity.mechanicId, { identityIds: [identity.identityId] }).entries)
    .sort((a, b) => a.appliedSequence - b.appliedSequence)[0];
  if (!removable) return null;
  const result = runtime.dispelStatusEffects(target, {
    strength: 'normal',
    direction: 'negative',
    instanceIds: [removable.instanceId],
  });
  return result.removed[0] ?? null;
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
  onLanded?: () => void,
): ChimeraSideDamageResult {
  let outcome: ChimeraSideDamageResult = { actual: 0, landedOnTarget: false };
  runtime.runReactionAction(user, {
    skillId: 'chimera_install_reaction',
    skillName: actionName,
    presentation: 'skill',
    targets: [target],
  }, () => {
    const damageOptions: DamageApplicationOptions = {
      actionName,
      respectDefenses: true,
      canTriggerWaitCounter: false,
      deferTransform: true,
    };
    const actual = runtime.applyDamage(target, Math.max(1, Math.floor(amount)), 'skill', false, user, damageOptions);
    runtime.flushDeferredDamageEvents(target, 'mitigation');
    const resolvedActual = getResolvedDamageTotal(actual, damageOptions);
    const visualMetadata: BattleLogMetadata = {
      actorId: user.id,
      actorName: user.name,
      targetIds: [target.id],
      visualCue: {
        kind: 'combat_action',
        sourceId: user.id,
        targetIds: [target.id],
        presentation: 'skill',
      },
    };
    if (damageOptions.redirectedByJoker) {
      runtime.log(resolvedActual > 0 ? 'skill' : 'info', resolvedActual > 0
        ? `🎭 【${actionName}】${user.name} 的攻击被 ${target.name} 的随机恶作剧带偏，转移目标实际承受 ${resolvedActual} 点伤害！`
        : `🎭 【${actionName}】${user.name} 的攻击被 ${target.name} 的随机恶作剧带偏，转移后仍被化解，没有单位损失生命！`, visualMetadata);
    } else if (damageOptions.redirectedByOriginiumCore) {
      runtime.log(resolvedActual > 0 ? 'skill' : 'info', resolvedActual > 0
        ? `🜚 【${actionName}】${user.name} 对 ${target.name} 的攻击被转入源石网络，共对源石结晶结算 ${resolvedActual} 点伤害；阿喃那本体未受伤！`
        : `🜚 【${actionName}】攻击被转入源石网络，但源石结晶均未损失生命！`, visualMetadata);
    } else if (damageOptions.redirectedByOwlEmperor) {
      runtime.log(resolvedActual > 0 ? 'skill' : 'info', resolvedActual > 0
        ? `🐲 【${actionName}】${target.name} 的帝王之征接管了伤害，龙实际承受 ${resolvedActual} 点伤害！`
        : `🐲 【${actionName}】${target.name} 的帝王之征接管了伤害，但龙未损失生命！`, visualMetadata);
    } else if (damageOptions.redirectedByMomo) {
      runtime.log(resolvedActual > 0 ? 'skill' : 'info', resolvedActual > 0
        ? `💗 【${actionName}】${target.name} 通过【|OMO】把伤害均摊给舰长，舰长合计损失 ${resolvedActual} 点生命！`
        : `💗 【${actionName}】${target.name} 通过【|OMO】完成均摊，但舰长均未损失生命！`, visualMetadata);
    } else if (damageOptions.redirectedByYuzu) {
      runtime.log(resolvedActual > 0 ? 'skill' : 'info', resolvedActual > 0
        ? `🪞 【${actionName}】${target.name} 通过【镜界分摊】把伤害交给队友，队友合计损失 ${resolvedActual} 点生命！`
        : `🪞 【${actionName}】${target.name} 通过【镜界分摊】把伤害交给队友，但队友均未损失生命！`, visualMetadata);
    } else if (actual > 0) {
      runtime.log('skill', logText(actual), visualMetadata);
    } else if (didDamageConnect(actual, damageOptions)) {
      runtime.log('skill', `⚔️ 【${actionName}】${user.name} 的攻击成功命中 ${target.name}；但【黄昏余命】期间未再损失生命！`, visualMetadata);
    } else {
      runtime.log('info', `🛡️ 【${actionName}】${user.name} 的攻击被 ${target.name} 化解，没有造成生命伤害！`, visualMetadata);
    }
    const landedOnTarget = !isDamageRedirected(damageOptions) && didDamageConnect(actual, damageOptions);
    if (landedOnTarget && target.currentHp > 0) onLanded?.();
    runtime.flushDeferredDamageEvents(target);
    if (landedOnTarget && target.currentHp <= 0 && !target.isDead && !target.isDeadAnnounced) {
      runtime.markDefeated(target, {
        message: `💀 【${actionName}】${target.name} 被 ${user.name} 安装插件时爆发的异变余波击倒！`,
        killer: user,
      });
    }
    outcome = { actual: resolvedActual, landedOnTarget };
  });
  return outcome;
}

function applyChimeraInstallSideEffect(
  runtime: SupportResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  const identityId = primaryStatusIdentity(skill);
  if (!runtime.isActiveCombatant(user) || !user.isSuccubus || !user.transformed || !identityId || !identityHasTag(identityId, 'chimera_plug')) return;

  if (identityId === 'PLUG_HEART') {
    const healing = resolveHealing(user, Math.floor(user.maxHp * 0.12), {
      kind: 'direct',
      sourceId: '永动炉心',
      healer: user,
    }, runtime.log);
    const cleaned = cleanseOneCommonNegativeStatus(runtime, user);
    applyStatus(user, { identityId: 'REGEN', remainingTurns: 3 });
    runtime.syncHpPct(user);
    const cleanText = cleaned ? `，排出了【${buildStatusPresentationMember(cleaned).name}】` : '';
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    runtime.log(healing.outcome === 'blocked' ? 'info' : 'heal', `☢️ 【永动炉心】${user.name} 的新心脏开始泵动，${healText}${cleanText}，并获得再生！`);
    return;
  }

  if (identityId === 'PLUG_SKIN') {
    const healing = resolveHealing(user, Math.floor(user.maxHp * 0.06), {
      kind: 'direct',
      sourceId: '纳米皮肤',
      healer: user,
    }, runtime.log);
    applyStatus(user, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'chimera_adaptive_skin' } });
    applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'chimera_adaptive_skin' } });
    runtime.syncHpPct(user);
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    runtime.log('buff', `🛡️ 【纳米皮肤】${user.name} 的外壳完成自适应硬化，${healText}，并获得短暂抗控制与法术抵挡！`);
    return;
  }

  if (identityId === 'PLUG_LEG') {
    applyStatus(user, { identityId: 'AIM', charges: 1 });
    runtime.log('buff', `🦶 【反重力足】${user.name} 的机动回路重新校准，下一次攻击进入锁定状态！`);
    return;
  }

  const enemy = pickRandomEnemy(runtime, user);
  if (!enemy) return;

  if (identityId === 'PLUG_HEAD') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      effectiveStat(user, 'atk') * 0.55 + effectiveStat(user, 'mag') * 0.25,
      '暴食之口启动',
      (damage) => `🦷 【暴食之口启动】${user.name} 的新口器咬向 ${enemy.name}，实际造成 ${damage} 点伤害！`,
    );
    if (!runtime.isActiveCombatant(user)) return;
    const healed = healFighter(user, Math.floor(result.actual * 0.45), runtime.log);
    runtime.syncHpPct(user);
    if (healed > 0) runtime.log('heal', `🦷 【暴食回流】${user.name} 吞下生命力，恢复 ${healed} 点生命！`);
    return;
  }

  if (identityId === 'PLUG_ARM') {
    applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      effectiveStat(user, 'atk') * 0.78,
      '斩舰巨刃校准',
      (damage) => `⚔️ 【斩舰巨刃校准】${user.name} 挥动新生巨刃试斩 ${enemy.name}，实际造成 ${damage} 点伤害！`,
    );
    return;
  }

  if (identityId === 'PLUG_BACK') {
    const enemies = activeEnemiesOf(runtime, user).sort(() => Math.random() - 0.5).slice(0, 2);
    enemies.forEach((target) => {
      if (!runtime.isActiveCombatant(user)) return;
      if (!runtime.isActiveCombatant(target)) return;
      applyChimeraSideDamage(
        runtime,
        user,
        target,
        effectiveStat(user, 'mag') * 0.42,
        '浮游炮试射',
        (damage) => `🛸 【浮游炮试射】${user.name} 的浮游炮锁定 ${target.name}，实际造成 ${damage} 点魔法伤害！`,
      );
    });
    return;
  }

  if (identityId === 'PLUG_EYE') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      effectiveStat(user, 'mag') * 0.35,
      '石化魔眼校准',
      (damage) => damage > 0
        ? `👁️ 【石化魔眼校准】${user.name} 看穿 ${enemy.name} 的破绽，实际造成 ${damage} 点魔法伤害！`
        : `👁️ 【石化魔眼校准】${user.name} 试图看穿 ${enemy.name} 的破绽，但没有造成实际伤害，虚弱没有生效！`,
      () => {
        if (runtime.isActiveCombatant(user) && runtime.isActiveCombatant(enemy) && runtime.applyStatus(enemy, { identityId: 'WEAK', remainingTurns: 2, effectName: '石化魔眼校准的虚弱效果', attribution: { applierId: user.id, applierName: user.name } })) {
          runtime.log('debuff', `👁️ 【石化魔眼校准】${enemy.name} 被施加虚弱 2 回合！`);
        }
      },
    );
    void result;
    return;
  }

  if (identityId === 'PLUG_TAIL') {
    const result = applyChimeraSideDamage(
      runtime,
      user,
      enemy,
      effectiveStat(user, 'mag') * 0.45 + effectiveStat(user, 'atk') * 0.25,
      '灾厄毒尾甩击',
      (damage) => damage > 0
        ? `🦂 【灾厄毒尾甩击】${user.name} 的毒尾扫中 ${enemy.name}，实际造成 ${damage} 点伤害！`
        : `🦂 【灾厄毒尾甩击】${user.name} 的毒尾扫过 ${enemy.name}，但没有造成实际伤害！`,
      () => {
        if (runtime.isActiveCombatant(user) && runtime.isActiveCombatant(enemy) && runtime.applyStatus(enemy, { identityId: 'POISON', remainingTurns: 2, effectName: '灾厄毒尾甩击的剧毒效果', attribution: { applierId: user.id, applierName: user.name } })) {
          runtime.log('debuff', `🦂 【灾厄毒尾甩击】${enemy.name} 被注入剧毒 2 回合！`);
        }
      },
    );
    void result;
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
    const healing = resolveHealing(target, Math.floor(target.maxHp * 0.155), {
      kind: 'direct',
      sourceId: '合成稳定',
      healer: target,
    }, runtime.log);
    const cleaned = cleanseOneCommonNegativeStatus(runtime, target);
    applyStatus(target, { identityId: 'REGEN', remainingTurns: 3 });
    runtime.syncHpPct(target);
    const cleanText = cleaned ? `，排出了【${buildStatusPresentationMember(cleaned).name}】` : '';
    const healText = healing.actual > 0
      ? `恢复 ${healing.actual} 点生命`
      : healing.outcome === 'blocked'
        ? '治疗被完全阻止'
        : '生命已满，治疗溢出';
    runtime.log(healing.outcome === 'blocked' ? 'info' : 'heal', `🧬 【合成稳定】${target.name} 的第 2 个插件接入完成，${healText}${cleanText}，身体开始稳定再生！`);
  }

  if (currentMilestone < 4 && plugCount >= 4) {
    target.chimeraMilestoneLevel = 4;
    target.chimeraInstantActionQueued = true;
    applyPermanentStatBuff(target, { atk: 1.068, mag: 1.068, spd: 1.05 });
    applyStatus(target, { identityId: 'AIM', charges: 1 });
    applyStatus(target, { identityId: 'BKB', remainingTurns: 1, attribution: { effectSourceId: 'chimera_startup_core' } });
    runtime.log('buff', `🧬 【兽性苏醒】${target.name} 的第 4 个插件接入完成，攻击、魔力与速度小幅裂变，锁定猎物并准备立刻追加一次插件行动！`);
  }

  if (currentMilestone < 6 && plugCount >= 6) {
    target.chimeraMilestoneLevel = 6;
    applyPermanentStatBuff(target, { atk: 1.14, mag: 1.14, def: 1.105, res: 1.105 });
    target.maxHp = Math.floor(target.maxHp * 1.14);
    const healed = healFighter(target, Math.floor(target.maxHp * 0.235), runtime.log, {
      kind: 'direct',
      sourceId: 'chimera_disaster_omen',
      healer: target,
    });
    runtime.syncHpPct(target);
    applyStatus(target, { identityId: 'INVUL', remainingTurns: 1, attribution: { effectSourceId: 'chimera_disaster_omen' } });
    applyStatus(target, { identityId: 'SPELL_BLOCK', charges: 2, attribution: { effectSourceId: 'chimera_disaster_omen' } });
    applyStatus(target, { identityId: 'AIM', charges: 1 });
    runtime.log('buff', `☣️ 【灾厄预兆】${target.name} 的第 6 个插件接入完成，肉体进入半成型裂变${healed > 0 ? `，实际恢复 ${healed} 点生命` : ''}，并短暂脱离常理！`);
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
  const visualMetadata: BattleLogMetadata = {
    targetIds: [targetForBuff.id],
    visualCue: {
      kind: 'combat_action',
      sourceId: user.id,
      targetIds: [targetForBuff.id],
      presentation: skill.presentation ?? 'skill',
      ...(skill.visualEffect ? { effectId: skill.visualEffect } : {}),
    },
  };
  resolveDeclarativeSkillDispel(runtime, skill, user, targetForBuff, 'before_action', 'after_recovery');

  if (skill.tag === runtime.skillTags.HEAL) {
    const heal = Math.floor(Math.max(effectiveStat(user, 'atk'), effectiveStat(user, 'mag')) * (skill.mult ?? 1));
    const healing = resolveHealing(targetForBuff, heal, {
      kind: 'direct',
      sourceId: skill.name,
      healer: user,
    }, runtime.log);
    if (healing.actual <= 0) {
      const resultText = healing.modified <= 0 ? '治疗被完全阻止' : '生命已满，治疗溢出';
      runtime.log(healing.modified <= 0 ? 'info' : 'heal', `✨ 【${skill.name}】${user.name} 试图治疗 ${targetForBuff.name}，但${resultText}。`, visualMetadata);
    } else {
      let healMessage = runtime.formatSkillText(skill, skill.text ?? '');
      if (!healMessage.includes('{VAL}')) healMessage += ` (恢复 {VAL} 点生命)`;
      runtime.log('heal', healMessage.replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name).replace(/{VAL}/g, String(healing.actual)), visualMetadata);
    }
    resolveDeclarativeSkillDispel(runtime, skill, user, targetForBuff, 'after_recovery', 'after_recovery');
    return true;
  }

  let installedChimeraPlug = false;
  let chimeraPlugCountAfterInstall = 0;
  let shouldCheckChimeraUltimate = false;

  const primaryIdentityId = primaryStatusIdentity(skill);
  if (primaryIdentityId) {
    const isCounterStance = identityHasTag(primaryIdentityId, 'counter_stance');
    const isPlugStatus = identityHasTag(primaryIdentityId, 'chimera_plug');
    const isValidChimeraPlug = isPlugStatus && isChimeraPluginInstall(runtime, targetForBuff, skill);
    if (isPlugStatus && !isValidChimeraPlug) {
      runtime.log('info', `⚠️ 【状态归属校验】${skill.name ?? '未知技能'} 试图给 ${targetForBuff.name} 安装克蕾儿插件【${getStatusIdentityDefinition(primaryIdentityId).displayName}】，已被拦截。`);
      return true;
    }

    if (isCounterStance) {
      removeEffects(targetForBuff, { identityIds: getStatusIdentityIdsByTag('counter_stance'), reason: 'replaced' });
    }
    if (isValidChimeraPlug) {
      if (skill.permanentStatMultiplier) applyPermanentStatBuff(targetForBuff, skill.permanentStatMultiplier);
      if (skill.newSkill && !targetForBuff.jobData.skills.includes(skill.newSkill)) {
        targetForBuff.jobData.skills.push(skill.newSkill);
        installedChimeraPlug = !!targetForBuff.isSuccubus && !!targetForBuff.transformed;
        chimeraPlugCountAfterInstall = getChimeraPluginCount(runtime, targetForBuff);
        shouldCheckChimeraUltimate = true;
      }
    }
    if (isValidChimeraPlug) {
      removeEffects(targetForBuff, { identityIds: [primaryIdentityId], reason: 'replaced' });
    }
    for (const declared of statusApplicationsOf(skill)) {
      const definition = getStatusIdentityDefinition(declared.identityId);
      const lifecycle = definition.dualValue
        ? { count: declared.count ?? definition.defaultCount ?? 1 }
        : definition.expiresOn === 'trigger'
          ? { charges: declared.charges ?? definition.defaultCharges ?? 3 }
          : definition.expiresOn === 'never'
            ? {}
            : { remainingTurns: declared.remainingTurns ?? (declared.identityId === 'INVUL' ? 1 : (isCounterStance ? 5 : 3)) };
      const application = { ...declared };
      delete application.target;
      runtime.applyStatus(targetForBuff, {
        ...lifecycle,
        ...application,
        effectName: declared.effectName ?? skill.name,
        attribution: {
          ...declared.attribution,
          effectSourceId: declared.attribution?.effectSourceId ?? declared.identityId,
          applierId: user.id,
          applierName: user.name,
        },
        silent: true,
      });
    }
  }
  runtime.log('buff', runtime.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name), visualMetadata);
  resolveDeclarativeSkillDispel(runtime, skill, user, targetForBuff, 'after_recovery', 'after_recovery');
  if (installedChimeraPlug && primaryIdentityId && identityHasTag(primaryIdentityId, 'chimera_plug')) {
    applyChimeraInstallSideEffect(runtime, targetForBuff, skill);
    if (!runtime.isActiveCombatant(targetForBuff)) return true;
    applyChimeraMilestoneRewards(runtime, targetForBuff, chimeraPlugCountAfterInstall);
    if (shouldCheckChimeraUltimate) handleChimeraUltimateEvolution(runtime, targetForBuff);
  }
  return true;
}
