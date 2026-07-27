import type {
  DamageApplicationOptions,
  Fighter,
  SkillDefinition,
} from '../types';
import { resolveHealing } from '../combatState';
import type { ActionResolutionRuntime } from './types';
import { isCompetitiveTarget, isSelectableTargetFor } from '../targeting';
import { consumeStatusValue, findIdentity, grantBarrier, hasIdentity, hasMechanic, queryMechanic, removeEffects, applyStatus } from '../statusSystem';
import { consumeDrain, getDrainPercent, getEffectiveCombatStat } from '../statusMechanics';
import { buildFighterStatusPresentation, buildStatusPresentationMember } from '../statusPresentation';
import { getStatusIdentityDefinition } from '../statusRegistry';
import { didDamageConnect } from '../damageRedirects';

const CHIMERA_BABY_SYNC_SKILLS: Record<string, string> = {
  chimera_devour: 'baby_feed',
  chimera_execute: 'baby_laser',
  chimera_funnels: 'baby_satellite',
  chimera_reconstruct: 'baby_cheer',
  chimera_petrify: 'baby_scan',
  chimera_fortress: 'baby_shield',
  chimera_warp: 'baby_speed',
  chimera_plague: 'baby_poison',
};

const VALO_FOCUS_MAX = 10;

function hasStatus(fighter: Fighter, type: string): boolean {
  return hasIdentity(fighter, type);
}

function gainValorantFocus(fighter: Fighter, amount: number): void {
  fighter.crosshairFocus = Math.min(VALO_FOCUS_MAX, Math.max(0, (fighter.crosshairFocus ?? 0) + amount));
}

function restoreValorantOperatorMobility(fighter: Fighter): boolean {
  if (!hasStatus(fighter, 'VALO_OPERATOR_PENALTY')) return false;
  removeEffects(fighter, { identityIds: ['VALO_OPERATOR_PENALTY'], reason: 'scripted' });
  return true;
}

function activeEnemyCount(runtime: ActionResolutionRuntime, user: Fighter): number {
  return runtime.fighters.filter((fighter) =>
    isCompetitiveTarget(fighter) && isSelectableTargetFor(runtime, user, fighter),
  ).length;
}

export function applySelfDamage(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (!skill.selfDmgPct) return;

  const rawSelfDamage = Math.floor(user.maxHp * skill.selfDmgPct);
  const payableSelfDamage = skill.selfDmgCanKill
    ? rawSelfDamage
    : Math.min(rawSelfDamage, Math.max(0, user.currentHp - 1));
  const options = {
    actionName: `${skill.name}反噬`,
    sourceKind: 'self_cost' as const,
    respectDefenses: false,
    bypassShields: true,
    creditAttacker: false,
    suppressStatusAftermath: true,
    suppressOwlCooperation: true,
    bypassOwlOutgoingModifier: true,
    bypassOwlIncomingModifier: true,
    deferTransform: true,
  };
  const actualSelfDmg = runtime.applyDamage(user, payableSelfDamage, 'self_cost', true, user, options);
  if (actualSelfDmg > 0) {
    runtime.log('info', `🩸 ${user.name} 因【${skill.name}】反噬，实际损失 ${actualSelfDmg} 点生命！`);
  }
  if (actualSelfDmg > 0 || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
  if (user.currentHp <= 0 && skill.selfDmgCanKill) {
    runtime.markDefeated(user, { message: `💀 ${user.name} 被【${skill.name}】的反噬击倒！`, awardKill: false });
  }
}

export function applyAttackerStyleEffects(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  allowHostileStatus = true,
): void {
  if (hasStatus(user, 'STYLE_VAIN')) {
    const stealAtk = Math.floor(getEffectiveCombatStat(target, 'atk') * 0.1);
    const stealMag = Math.floor(getEffectiveCombatStat(target, 'mag') * 0.1);
    target.atk = Math.max(1, target.atk - stealAtk);
    target.mag = Math.max(1, target.mag - stealMag);
    user.atk += stealAtk;
    user.mag += stealMag;
    runtime.log('buff', `💅 虚荣窃取！${user.name} 偷走了 ${target.name} 的属性化为己用！(吸收了攻击和魔力)`);
  }

  if (allowHostileStatus && hasStatus(user, 'STYLE_FOOL') && Math.random() < 0.5) {
    const debuffs = ['STUN', 'FREEZE', 'POISON', 'BURN'];
    const randomDebuff = debuffs[Math.floor(Math.random() * debuffs.length)];
    const application = randomDebuff === 'BURN'
      ? { identityId: randomDebuff, count: 2 }
      : { identityId: randomDebuff, remainingTurns: 2 };
    if (runtime.applyStatus(target, {
      ...application,
      attribution: { applierId: user.id, applierName: user.name },
    })) {
      runtime.log('skill', `🤪 笨蛋女人乱拳挥舞！不经意间给 ${target.name} 附加了【${getStatusIdentityDefinition(randomDebuff).displayName}】异常状态！`);
    }
  }
}

export function applySkillStatusEffect(
  runtime: ActionResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  target: Fighter,
  allowTargetStatus = true,
): void {
  for (const declared of skill.statusApplications ?? []) {
    const recipient = declared.target === 'user' ? user : target;
    if (!allowTargetStatus && recipient.id === target.id) continue;
    const appliedSourceId = declared.attribution?.effectSourceId ?? declared.identityId;
    const definition = getStatusIdentityDefinition(declared.identityId);
    const lifecycle = definition.dualValue
      ? { count: declared.count ?? definition.defaultCount ?? 1 }
      : definition.expiresOn === 'trigger'
        ? { charges: declared.charges ?? definition.defaultCharges ?? 2 }
        : definition.expiresOn === 'never'
          ? {}
          : { remainingTurns: declared.remainingTurns ?? 2 };
    const application = { ...declared };
    delete application.target;
    const applied = runtime.applyStatus(recipient, {
      ...lifecycle,
      ...application,
      effectName: declared.effectName ?? skill.name,
      attribution: {
        ...declared.attribution,
        effectSourceId: appliedSourceId,
        applierId: user.id,
        applierName: user.name,
      },
      silent: true,
    });
    if (!applied || !runtime.isActiveCombatant(recipient)) continue;

    const status = findIdentity(recipient, declared.identityId, {
      effectSourceIds: [appliedSourceId],
      applierIds: [user.id],
    });
    if (!status) continue;
    const presentation = buildFighterStatusPresentation(recipient).find((item) =>
      item.members.some((member) => member.key === status.instanceId),
    ) ?? buildStatusPresentationMember(status);
    const valueText = presentation.valueLabel ? `（${presentation.valueLabel}）` : '';
    const sourceText = presentation.sourceLabel ? `，来源：${presentation.sourceLabel}` : '';
    runtime.log(
      recipient.id === user.id ? 'buff' : 'debuff',
      `📌 【状态结算】${recipient.name} 获得【${presentation.name}】${valueText}${sourceText}。`,
    );
  }
  for (const declared of skill.barrierApplications ?? []) {
    const recipient = declared.target === 'user' ? user : target;
    if (!allowTargetStatus && recipient.id === target.id) continue;
    const barrier = grantBarrier(recipient, declared.value, {
      identityId: declared.identityId,
      sourceId: declared.sourceId,
      displayName: declared.displayName,
      icon: declared.icon,
      remainingTurns: declared.remainingTurns,
      tickMode: declared.tickMode,
      priority: declared.priority,
      polarity: declared.polarity,
      dispelTier: declared.dispelTier,
      stackMode: declared.stackMode,
      attribution: {
        effectSourceId: declared.attribution?.effectSourceId ?? declared.sourceId,
        effectSourceName: declared.attribution?.effectSourceName ?? declared.displayName,
        applierId: user.id,
        applierName: user.name,
        creditActorId: declared.attribution?.creditActorId ?? user.id,
        creditOwnerId: declared.attribution?.creditOwnerId,
      },
    });
    runtime.log('buff', `🔵 【屏障结算】${recipient.name} 获得【${barrier.displayName}】${declared.value} 点屏障。`);
  }
}

export function handleValorantWeaponDrop(
  runtime: ActionResolutionRuntime,
  target: Fighter,
  actualDmg: number,
): void {
  const operatorEquipped = hasStatus(target, 'VALO_OPERATOR_PENALTY');
  if (target.job !== 'VALO_JUNIOR' || !operatorEquipped) return;

  const isHeavyHit = actualDmg > target.maxHp * 0.2;
  const isControlled = ['STUN', 'FREEZE', 'CONFUSED', 'EMBARRASSED', 'CHARMED']
    .some((identityId) => hasStatus(target, identityId));
  if (!isHeavyHit && !isControlled) return;

  target.economy = Math.max(0, (target.economy ?? 0) - 5);
  removeEffects(target, { identityIds: ['VALO_OPERATOR_PENALTY'], reason: 'scripted' });
  runtime.log('info', `💔 损失惨重！${target.name} 受到重创或被控，手中的【冥驹】掉落了！经济大幅衰退！`);
}

export function handlePhysicalCounterReflect(
  runtime: ActionResolutionRuntime,
  skill: SkillDefinition,
  user: Fighter,
  target: Fighter,
  actualDmg: number,
): void {
  if (
    skill.tag !== runtime.skillTags.PHYS ||
    hasMechanic(target, 'STAGGERED') ||
    !hasStatus(target, 'COUNTER')
  ) return;

  const counter = queryMechanic(target, 'COUNTER').entries.find((entry) => (entry.charges ?? 0) > 0);
  if (counter) consumeStatusValue(target, counter, 'charges');
  if (!runtime.isActiveCombatant(user)) {
    runtime.log('info', `💢 ${target.name} 的反击护盾亮起，但 ${user.name} 已经退场，反弹没有继续结算。`);
    return;
  }
  runtime.log('skill', `💢 ${target.name} 触发反击！【反弹伤害】开始对 ${user.name} 结算。`);
  const damageOptions: DamageApplicationOptions = { deferTransform: true, actionName: '反弹伤害' };
  const reflectedDmg = runtime.applyDamage(user, actualDmg, 'reflect', false, target, damageOptions);
  const connected = didDamageConnect(reflectedDmg, damageOptions);
  runtime.flushDeferredDamageEvents(user, 'mitigation');
  if (reflectedDmg > 0) {
    runtime.log('crit', `💢 【反击结算】${user.name} 实际承受 ${reflectedDmg} 点反弹伤害！`);
  } else if (connected) {
    runtime.log('crit', `💢 【反击结算】反弹成功命中 ${user.name}；但【黄昏余命】期间未再损失生命！`);
  } else {
    runtime.log('info', `💢 【反击结算】${user.name} 本人没有损失生命；拦截、分摊或无效化结果已在上方记录。`);
  }
  if (connected || (user.pendingDamageEvents?.length ?? 0) > 0) runtime.flushDeferredDamageEvents(user);
  if (user.currentHp <= 0) {
    runtime.markDefeated(user, { message: `💀 ${user.name} 被自己造成的反弹伤害反死了！`, killer: target });
  }
}

export function grantValorantKillRewards(
  runtime: ActionResolutionRuntime,
  user: Fighter,
): void {
  if (user.job !== 'VALO_JUNIOR') return;

  user.economy = (user.economy ?? 0) + 2;
  user.ultPoints = (user.ultPoints ?? 0) + 1;
  gainValorantFocus(user, 1);
  const restored = restoreValorantOperatorMobility(user);
  applyStatus(user, { identityId: 'VALO_REPOSITION', remainingTurns: 1 });
  applyStatus(user, { identityId: 'VALO_CLUTCH', remainingTurns: 3 });
  applyStatus(user, { identityId: 'SPELL_BLOCK', charges: 1, attribution: { effectSourceId: 'valo_reposition' } });
  const enemyCount = activeEnemyCount(runtime, user);
  if ((user.crosshairFocus ?? 0) >= 6 && (enemyCount <= 2 || (enemyCount <= 3 && hasStatus(user, 'VALO_ULT_EMPRESS')))) {
    user.valoInstantActionQueued = true;
  }
  runtime.log('info', `💰 ${user.name} 拿到击杀！经济+2，大招充能+1，准星专注+1（${user.crosshairFocus ?? 0}/${VALO_FOCUS_MAX}），立刻再定位${restored ? '并甩掉冥驹笨重' : ''}！`);
}

export function grantValorantHitRewards(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  actualDmg: number,
): void {
  if (user.job !== 'VALO_JUNIOR' || !isCompetitiveTarget(target) || actualDmg <= 0) return;

  user.economy = Math.min(12, (user.economy ?? 0) + 1);
  if (actualDmg < Math.max(300, getEffectiveCombatStat(user, 'atk'))) return;
  const before = user.crosshairFocus ?? 0;
  gainValorantFocus(user, 1);
  if (before < 5 && (user.crosshairFocus ?? 0) >= 5) {
    runtime.log('buff', `🎯 【准星专注】${user.name} 手感升温，专注达到 ${user.crosshairFocus}/${VALO_FOCUS_MAX}，已能校准爆头线！`);
  } else if (before < 8 && (user.crosshairFocus ?? 0) >= 8) {
    runtime.log('buff', `🎯 【准星专注】${user.name} 完全进入状态，专注达到 ${user.crosshairFocus}/${VALO_FOCUS_MAX}，残局处决已就绪！`);
  }
}

export function handlePrimaryTargetDefeat(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill?: SkillDefinition,
): boolean {
  if (target.currentHp > 0) return false;

  const skillName = skill?.name && !['普通攻击', '魔力攻击'].includes(skill.name) ? `【${skill.name}】` : '攻击';
  const defeated = runtime.markDefeated(target, { message: `💀 【击杀】${target.name} 被 ${user.name} 的${skillName}击败！`, killer: user });
  return defeated;
}

export function applyLifestealEffects(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skill: SkillDefinition,
  actualDmg: number,
  hpBeforeDamage: number,
): void {
  const tingBloodthirst = user.isTing ? (user.transformed ? 0.55 : 0.25) : 0;
  const drainPct = getDrainPercent(user) / 100;
  const lsPct =
    (skill.lifesteal ?? 0) +
    tingBloodthirst +
    drainPct +
    (hasStatus(user, 'PLUG_HEAD') ? 0.25 : 0) +
    (hasStatus(user, 'VALO_ULT_EMPRESS') ? 1.0 : 0) +
    (hasStatus(user, 'STYLE_SMART') || hasStatus(user, 'STYLE_EMPEROR') ? 0.5 : 0);
  if (lsPct <= 0 || actualDmg <= 0 || !runtime.isActiveCombatant(user)) return;
  if (drainPct > 0) consumeDrain(user);

  const tingOverkillCap = user.isTing ? Math.floor(target.maxHp * 0.4) : 0;
  const maxHealBase = user.isTing ? Math.max(hpBeforeDamage, tingOverkillCap) : hpBeforeDamage;
  const healBase = Math.min(actualDmg, maxHealBase);
  const healAmt = Math.floor(healBase * lsPct);
  if (healAmt <= 0) return;

  const lifestealSources = [
    ...((skill.lifesteal ?? 0) > 0 ? [`【${skill.name}】`] : []),
    ...(tingBloodthirst > 0 ? ['【小汀常驻吸血】'] : []),
    ...(drainPct > 0 ? ['【汲取】'] : []),
    ...(hasStatus(user, 'PLUG_HEAD') ? [`【${getStatusIdentityDefinition('PLUG_HEAD').displayName}】`] : []),
    ...(hasStatus(user, 'VALO_ULT_EMPRESS') ? [`【${getStatusIdentityDefinition('VALO_ULT_EMPRESS').displayName}】`] : []),
    ...(hasStatus(user, 'STYLE_EMPEROR')
      ? [`【${getStatusIdentityDefinition('STYLE_EMPEROR').displayName}】`]
      : hasStatus(user, 'STYLE_SMART')
        ? [`【${getStatusIdentityDefinition('STYLE_SMART').displayName}】`]
        : []),
  ];
  const sourceText = lifestealSources.length > 0 ? `（来源：${lifestealSources.join('、')}）` : '';
  const healing = resolveHealing(user, healAmt, {
    kind: 'lifesteal',
    sourceId: lifestealSources.join('+') || skill.name,
    healer: user,
  }, runtime.log);
  if (healing.actual > 0) {
    runtime.log('heal', `💉 ${user.name} 触发吸血被动${sourceText}，恢复了 ${healing.actual} 点生命！`);
  } else if (healing.modified <= 0) {
    runtime.log('info', `🥀 ${user.name} 触发吸血被动${sourceText}，但治疗被完全阻止！`);
  } else {
    runtime.log('info', `💉 ${user.name} 触发吸血被动${sourceText}，但生命已满，治疗溢出！`);
  }
}

export function consumeAimAfterAttack(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  skill: SkillDefinition,
): void {
  if (skill.tag === runtime.skillTags.HEAL || skill.tag === runtime.skillTags.BUFF) return;

  const aim = queryMechanic(user, 'AIM').entries.find((entry) => (entry.charges ?? 0) > 0);
  if (aim) consumeStatusValue(user, aim, 'charges');
  if (user.isWT && user.wtMarkedTargetId) {
    user.wtMarkedTargetId = undefined;
    runtime.log('info', `🎯 ${user.name} 已消耗激光测距坐标，本次火控优先窗口关闭。`);
  }
}

export function triggerSuccubusBabyFollowup(
  runtime: ActionResolutionRuntime,
  user: Fighter,
  target: Fighter,
  skillId: string | null,
  userTeamId: string,
  triggerDepth: number,
): void {
  if (!user.isSuccubus || !user.transformed || !skillId?.startsWith('chimera_') || skillId === 'chimera_install') return;

  const baby = runtime.fighters.find((fighter) => fighter.job === 'MY_BABY' && runtime.isActiveCombatant(fighter) && runtime.getTeamId(fighter) === userTeamId);
  const syncSkillId = CHIMERA_BABY_SYNC_SKILLS[skillId];
  if (!baby || !syncSkillId) return;

  const syncSkill = runtime.skills[syncSkillId];
  const isHealOrBuff = syncSkill && (syncSkill.tag === runtime.skillTags.HEAL || syncSkill.tag === runtime.skillTags.BUFF);
  runtime.executeSkillAction(syncSkillId, baby, isHealOrBuff ? user : target, triggerDepth + 1);
}
