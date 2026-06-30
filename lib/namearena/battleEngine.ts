import type {
  Fighter,
  DamageApplicationOptions,
  JobDefinition,
  SkillDefinition,
  SkillContext,
  DefeatOptions,
  StatKey,
  SpinalSwordRef,
  BattleEngineData,
  BattleEngineCore,
  StatusEffectsMap,
} from './types';
import { cloneJobDefinition, healFighter, isActiveCombatant, setCurrentHp, syncHpPct } from './combatState';
import {
  ActionResolutionRuntime,
  applyAttackerStyleEffects as applyAttackerStyleEffectsAction,
  applyLifestealEffects as applyLifestealEffectsAction,
  applySelfDamage as applySelfDamageAction,
  applySkillStatusEffect as applySkillStatusEffectAction,
  breakAbsoluteDefense as breakAbsoluteDefenseAction,
  canTouchDamagePlane as canTouchDamagePlaneAction,
  consumeAimAfterAttack as consumeAimAfterAttackAction,
  createSkillContext as createSkillContextAction,
  dodgesWithPassiveSkill as dodgesWithPassiveSkillAction,
  executeSkillAction as executeSkillActionFlow,
  grantValorantKillRewards as grantValorantKillRewardsAction,
  handleCounterStatus as handleCounterStatusAction,
  handlePhysicalCounterReflect as handlePhysicalCounterReflectAction,
  handlePrimaryTargetDefeat as handlePrimaryTargetDefeatAction,
  handleValorantPreFire as handleValorantPreFireAction,
  handleValorantWeaponDrop as handleValorantWeaponDropAction,
  handleWaitCounter as handleWaitCounterAction,
  missesSkill as missesSkillAction,
  triggerSuccubusBabyFollowup as triggerSuccubusBabyFollowupAction,
} from './actionResolution';
import {
  CharacterHookRuntime,
  runCharacterDefeatHooks,
  runCharacterReentryHooks,
  runCharacterReviveHooks,
  runCharacterSkillSelectionHooks,
  runCharacterTransformHooks,
} from './characterHooks';
import {
  selectSpinalSwordRouteSkill,
  selectSpinalSwordSpecialSkill,
  shouldUseSpinalSwordRoute,
} from './specialMechanics';
import {
  formatSkillText,
  resolveSkillDefinition,
} from './skillResolution';
import {
  getSelectableTargets,
  isSelectableTargetFor,
  resolveTarget,
  TargetingRuntime,
} from './targeting';
import {
  calculateDamage,
  DamageResolutionRuntime,
} from './damageResolution';
import {
  advanceGlobalTimedStatuses,
  clearSpinalSword,
  handleSelfTimedStatusExpiry,
  handleSpinalSwordDrop,
  processStatus,
  StatusProcessingRuntime,
  syncPuppetMasterStatus,
  syncSpinalSwordState,
} from './statusProcessing';
import {
  checkWinCondition,
  determineActor,
  getWaitingCounterStatus,
  logUnableToAct,
  logWaitingCounter,
  TurnFlowRuntime,
} from './turnFlow';
import {
  executeSummonSkill as executeSummonSkillEffect,
  SummonResolutionRuntime,
} from './summonResolution';
import {
  applyStatBuff as applyStatBuffEffect,
  cleanseCommonNegativeStatuses as cleanseCommonNegativeStatusesEffect,
  executeSupportSkill as executeSupportSkillEffect,
  handleChimeraUltimateEvolution as handleChimeraUltimateEvolutionEffect,
  spreadDivaSupport as spreadDivaSupportEffect,
  SupportResolutionRuntime,
} from './supportResolution';
import {
  buildActionResolutionRuntime,
  buildCharacterHookRuntime,
  buildDamageResolutionRuntime,
  buildStatusProcessingRuntime,
  buildSummonResolutionRuntime,
  buildSupportResolutionRuntime,
  buildTargetingRuntime,
  buildTurnFlowRuntime,
} from './battleRuntime';
import {
  applyGachaSummonLifesteal,
  GACHA_LUCK_MAX,
  GACHA_RA_PHOENIX_STATUS,
  grantGachaLuck,
  isLuckEmperor,
  triggerGachaDeathSave,
} from './gachaMechanics';

const DAMAGE_SOURCE_LABELS: Record<string, string> = {
  skill: '技能伤害',
  status: '状态伤害',
  counter: '反击伤害',
  reflect: '反弹伤害',
  transfer: '转移伤害',
};

function getDamageSourceLabel(source: string): string {
  return DAMAGE_SOURCE_LABELS[source] ?? `${source}伤害`;
}

function formatFallbackDeathMessage(fighter: Fighter): string {
  const lastDamage = fighter.lastDamage;
  if (!lastDamage || lastDamage.amount <= 0) {
    return `💀 ${fighter.name} 生命归零，倒在了战场上！`;
  }

  const sourceText = lastDamage.attackerName
    ? `${lastDamage.attackerName} 的${lastDamage.sourceLabel}`
    : lastDamage.sourceLabel;
  return `💀 ${fighter.name} 因 ${sourceText}（${lastDamage.amount}点）倒下了！`;
}

function formatIncomingDamageSource(source: string, attacker?: Fighter, actionName?: string): string {
  const actionText = actionName ? `【${actionName}】` : getDamageSourceLabel(source);
  return attacker ? `${attacker.name}的${actionText}` : actionText;
}

function getSummonBaseName(fighter: Fighter): string {
  return fighter.summonBaseName ?? fighter.name;
}

export class BattleEngine {
  fighters: Fighter[];
  addLogCallback: (e: { type: string; text: string }) => void;
  JOBS: Partial<Record<string, JobDefinition>>;
  SKILLS: Record<string, SkillDefinition>;
  Data: BattleEngineData;
  Core: BattleEngineCore;
  STATUS_EFFECTS: StatusEffectsMap;
  SKILL_TAGS: Record<string, string>;
  turnCount: number;
  activeSpinalSwordRef?: SpinalSwordRef;

  constructor(
    fighters: Fighter[],
    addLogCallback: (e: { type: string; text: string }) => void,
    JOBS: Partial<Record<string, JobDefinition>>,
    SKILLS: Record<string, SkillDefinition>,
    Data: BattleEngineData,
    Core: BattleEngineCore,
    turnCount = 0,
  ) {
    this.fighters = fighters;
    this.addLogCallback = addLogCallback;
    this.JOBS = JOBS;
    this.SKILLS = SKILLS;
    this.Data = Data;
    this.Core = Core;
    this.STATUS_EFFECTS = Data.STATUS_EFFECTS ?? {};
    this.SKILL_TAGS = Data.SKILL_TAGS ?? {};
    this.turnCount = turnCount;
  }

  log(type: string, text: string): void {
    this.addLogCallback({ type, text: text.replace(/\s*\r?\n\s*/g, ' ') });
  }

  queueOrLogDamageEvent(target: Fighter, options: DamageApplicationOptions, type: string, text: string): void {
    if (options.deferTransform) {
      target.pendingDamageEvents = target.pendingDamageEvents ?? [];
      target.pendingDamageEvents.push({ type, text });
      return;
    }
    this.log(type, text);
  }

  flushDeferredDamageEvents(fighter: Fighter): void {
    const pendingEvents = fighter.pendingDamageEvents ?? [];
    delete fighter.pendingDamageEvents;
    pendingEvents.forEach((event) => this.log(event.type, event.text));
    this.handleTransformations(fighter);
  }

  syncHpPct(f: Fighter): void {
    syncHpPct(f);
  }

  isActiveCombatant(f: Fighter): boolean {
    return isActiveCombatant(f);
  }

  getFatigueDamageBonus(): number {
    if (this.turnCount <= 500) return 0;
    return Math.min(120, Math.floor((this.turnCount - 500) / 25));
  }

  getTeamId(f: Fighter): string {
    if (f.isMorphling || f.isSon) return 'WATER_TEAM';
    if (f.isSummon && f.summonerId) {
      const master = this.fighters.find((m) => m.id === f.summonerId);
      return master?.teamId ?? f.summonerId;
    }
    return f.teamId ?? f.id;
  }

  triggerRaPhoenix(target: Fighter, options: DamageApplicationOptions): boolean {
    if (
      getSummonBaseName(target) !== '翼神龙' ||
      target.hasUsedRaPhoenix ||
      !target.status.some((status) => status.type === GACHA_RA_PHOENIX_STATUS)
    ) {
      return false;
    }

    target.hasUsedRaPhoenix = true;
    target.status = target.status.filter((status) => status.type !== GACHA_RA_PHOENIX_STATUS);
    target.currentHp = Math.max(1, Math.floor(target.maxHp * 0.32));
    this.syncHpPct(target);
    this.queueOrLogDamageEvent(target, options, 'heal', `🔥 【神不死鸟】${target.name} 在致死瞬间化为太阳火焰复燃，恢复到 ${target.currentHp} 点生命！`);

    const myTeamId = this.getTeamId(target);
    const enemies = this.fighters.filter((fighter) =>
      fighter.id !== target.id &&
      this.isActiveCombatant(fighter) &&
      this.getTeamId(fighter) !== myTeamId &&
      !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );
    const phoenixDmg = Math.floor(target.mag * 2.8 + target.atk * 1.4);
    enemies.forEach((enemy) => {
      const actualDmg = this.applyDamage(enemy, phoenixDmg, 'skill', true, target, {
        deferTransform: true,
        actionName: '神不死鸟',
        respectDefenses: true,
      });
      if (actualDmg > 0) {
        this.log('crit', `🔥 【神不死鸟】太阳火焰反扑 ${enemy.name}，实际造成 ${actualDmg} 点真实伤害！`);
        this.flushDeferredDamageEvents(enemy);
      } else {
        this.log('info', `🔥 【神不死鸟】火焰扫过 ${enemy.name}，但没有造成实际伤害！`);
      }
      if (enemy.currentHp <= 0) {
        this.markDefeated(enemy, { message: `💀 【神不死鸟】${enemy.name} 被翼神龙的复燃火焰吞没！`, killer: target });
      }
    });

    return true;
  }

  createCharacterHookRuntime(): CharacterHookRuntime {
    return buildCharacterHookRuntime(this);
  }

  createTargetingRuntime(): TargetingRuntime {
    return buildTargetingRuntime(this);
  }

  createDamageResolutionRuntime(): DamageResolutionRuntime {
    return buildDamageResolutionRuntime(this);
  }

  createStatusProcessingRuntime(): StatusProcessingRuntime {
    return buildStatusProcessingRuntime(this);
  }

  createSummonResolutionRuntime(): SummonResolutionRuntime {
    return buildSummonResolutionRuntime(this);
  }

  createSupportResolutionRuntime(): SupportResolutionRuntime {
    return buildSupportResolutionRuntime(this);
  }

  createActionResolutionRuntime(): ActionResolutionRuntime {
    return buildActionResolutionRuntime(this);
  }

  createTurnFlowRuntime(): TurnFlowRuntime {
    return buildTurnFlowRuntime(this);
  }

  applyDamage(
    target: Fighter,
    amount: number,
    source: string,
    isTrueDamage = false,
    attacker?: Fighter,
    options: DamageApplicationOptions = {},
  ): number {
    if (amount <= 0 || target.isDead || target.currentHp <= 0) return 0;
    if (target.status.some((s) => s.type === 'SYNERGY_SLACKING')) return 0;

    if (options.respectDefenses) {
      if (target.status.some((status) => status.type === 'INVUL')) {
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', `🛡️ ${target.name} 处于无敌状态，免疫了${incomingSource}！`);
        return 0;
      }

      const spellBlock = target.status.find((status) => status.type === 'SPELL_BLOCK');
      if (spellBlock && (source === 'skill' || source === 'transfer')) {
        target.status = target.status.filter((status) => status !== spellBlock);
        const healed = healFighter(target, Math.floor(target.maxHp * 0.15));
        const healText = healed > 0 ? `，并恢复了 ${healed} 点生命` : '，但生命已满，治疗溢出';
        const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
        this.log('info', `🔵 庇护之音！林肯法球(或特种装甲)的光幕为 ${target.name} 挡下了${incomingSource}${healText}！`);
        return 0;
      }
    }

    if (target.jobData?.name === '欧皇' && !isTrueDamage) amount = Math.floor(amount * 0.6);

    const isProtected =
      target.isMorphling || target.isJoker || target.isTokusatsu || target.isGacha ||
      target.isTing || target.isSuccubus || target.isSigua || target.isTuJuanJuan || target.isWT;
    if (isProtected && !target.transformed && amount >= target.currentHp) {
      amount = Math.max(0, target.currentHp - 1);
      if (amount === 0) {
        this.syncHpPct(target);
        return 0;
      }
      this.queueOrLogDamageEvent(target, options, 'info', `🛡️ ${target.name} 触发了锁血保护，强制保留最后 1 点生命！`);
    }

    if (source === 'skill' && target.job === 'GOD_OF_TROLLS' && amount > 0 && Math.random() < 0.40) {
      if (target.status.some((s) => s.type === 'WATER_PRISON')) {
        this.log('info', `💧 ${target.name} 被困在深渊水牢中，无法施展魔术转移伤害，必须硬吃！`);
      } else {
        const originalAmount = amount;
        amount = 0;
        const myTeamId = this.getTeamId(target);
        const enemies = this.fighters.filter((f) =>
          !f.isDead &&
          !f.isDeadAnnounced &&
          f.currentHp > 0 &&
          f.id !== target.id &&
          this.getTeamId(f) !== myTeamId &&
          !f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
        );
        if (enemies.length > 0) {
          const victim = enemies[Math.floor(Math.random() * enemies.length)];
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('crit', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术完美闪避！并将伤害转移给了倒霉的 ${victim.name}！`);
          const transferredDmg = this.applyDamage(victim, originalAmount, 'transfer', isTrueDamage, attacker, {
            deferTransform: true,
            actionName: options.actionName,
            respectDefenses: true,
          });
          if (transferredDmg > 0) {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，实际承受 ${transferredDmg} 点伤害！`);
          } else {
            this.log('info', `🎭 转移伤害落在 ${victim.name} 身上，但没有造成实际伤害！`);
          }
          if (transferredDmg > 0) this.flushDeferredDamageEvents(victim);
          if (victim.currentHp <= 0 && !victim.isDead && !victim.isDeadAnnounced) {
            const transferKiller = attacker && attacker.id !== victim.id ? attacker : target;
            this.markDefeated(victim, {
              message: `💀 【伤害转移】${victim.name} 被 ${target.name} 的随机恶作剧转移来的 ${transferredDmg} 点伤害坑倒了！`,
              killer: transferKiller,
            });
          }
        } else {
          const incomingSource = formatIncomingDamageSource(source, attacker, options.actionName);
          this.log('info', `🎭 【随机恶作剧】${target.name} 遭到${incomingSource}时施展魔术，${originalAmount} 点伤害凭空消失！`);
        }
        options.redirectedByJoker = true;
      }
    }

    const hpBeforeDamage = target.currentHp;
    target.currentHp -= amount;
    target.stats.dmgTaken += amount;
    if (amount > 0) {
      target.lastDamage = {
        amount,
        source,
        sourceLabel: getDamageSourceLabel(source),
        attackerId: attacker?.id,
        attackerName: attacker?.name,
        turn: this.turnCount,
      };
    }
    if (isLuckEmperor(target) && amount > 0) {
      if (amount >= target.maxHp * 0.2) {
        grantGachaLuck(target, 1, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), '承受重创');
      }
      if (attacker?.isTing) {
        grantGachaLuck(target, 1, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), '被小汀针对');
      }
    }
    applyGachaSummonLifesteal({
      fighters: this.fighters,
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text) => this.queueOrLogDamageEvent(target, options, type, text),
    }, attacker, Math.min(hpBeforeDamage, amount));
    if (target.currentHp <= 0 && this.triggerRaPhoenix(target, options)) {
      if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
      return amount;
    }
    if (target.currentHp <= 0 && triggerGachaDeathSave(target, (type, text) => this.queueOrLogDamageEvent(target, options, type, text), (fighter) => this.syncHpPct(fighter))) {
      return amount;
    }
    if (target.currentHp <= 0 && target.isTing && target.transformed && !target.isDead && !target.isDeadAnnounced) {
      const hasActiveDefiance = target.status.some((status) => status.type === 'TING_DEFIANCE');
      if (hasActiveDefiance || !target.hasTriggeredTingDefiance) {
        target.currentHp = 1;
        if (!hasActiveDefiance) {
          target.status.push({ type: 'TING_DEFIANCE', duration: 3 });
        }
        if (!target.hasTriggeredTingDefiance) {
          target.hasTriggeredTingDefiance = true;
          target.atk = Math.floor(target.atk * 1.2);
          target.mag = Math.floor(target.mag * 1.2);
          target.spd = Math.floor(target.spd * 1.15);
          this.queueOrLogDamageEvent(target, options, 'buff', `🩸 【不甘倒下】${target.name} 被怨念强行钉在 1 点生命，拒绝退场！`);
        } else {
          this.queueOrLogDamageEvent(target, options, 'info', `🩸 ${target.name} 仍处于【不甘倒下】，硬是撑住了致命伤！`);
        }
      }
    }
    this.syncHpPct(target);
    if (amount > 0) {
      target.isHit = true;
      if (!options.deferTransform) this.handleTransformations(target);
    }
    if (target.isDead || target.isDeadAnnounced) options.targetDefeatedDuringDamage = true;
    return amount;
  }

  markDefeated(target: Fighter, options: DefeatOptions = {}): boolean {
    if (target.isDead || target.isDeadAnnounced) return false;
    if (triggerGachaDeathSave(target, (type, text) => this.log(type, text), (fighter) => this.syncHpPct(fighter))) return false;

    if (options.setHpZero ?? true) setCurrentHp(target, 0);
    if (options.message) this.log(options.logType ?? 'death', options.message);
    target.isDeadAnnounced = true;
    this.runDefeatHooksOnce(target);

    const shouldAwardKill = options.awardKill ?? true;
    if (shouldAwardKill && options.killer && options.killer.id !== target.id) {
      options.killer.stats.kills += 1;
    }
    this.tryMorphlingSonRescue(target);

    return true;
  }

  tryMorphlingSonRescue(fighter: Fighter): boolean {
    const MORPHLING_SON = this.JOBS['MORPHLING_SON'];
    if (!fighter.isGamer || fighter.resurrected || !this.fighters.some((candidate) => candidate.isMorphling && this.isActiveCombatant(candidate)) || !MORPHLING_SON) {
      return false;
    }

    fighter.isDead = false;
    fighter.defeatHooksResolved = false;
    fighter.resurrected = true;
    fighter.isSon = true;
    fighter.jobData = cloneJobDefinition(MORPHLING_SON);
    fighter.maxHp = Math.floor(fighter.maxHp * 6);
    fighter.currentHp = fighter.maxHp;
    fighter.atk *= 6;
    fighter.mag *= 6;
    fighter.wis = Math.floor(fighter.wis * 4.0);
    fighter.spd = 100;
    this.syncHpPct(fighter);
    fighter.status = [];
    fighter.isDeadAnnounced = false;
    this.log('buff', `👶 ${fighter.name} 刚被判定退场，就被水人救起！清除了负面状态并转职为【${MORPHLING_SON.name}】！`);
    return true;
  }

  runDefeatHooksOnce(fighter: Fighter, spinalSwordRef = this.activeSpinalSwordRef): void {
    if (!spinalSwordRef || fighter.defeatHooksResolved) return;
    fighter.defeatHooksResolved = true;
    runCharacterDefeatHooks({
      fighter,
      runtime: this.createCharacterHookRuntime(),
      spinalSwordRef,
    });
  }

  finalizeFighterDeath(
    f: Fighter,
    spinalSwordRef: SpinalSwordRef,
    deathMessage?: string,
    killer?: Fighter,
  ): void {
    if (f.isDead || (f.currentHp > 0 && !f.isDeadAnnounced)) return;

    if (f.status.some((s) => s.type === 'VALO_ULT_RUN_IT_BACK')) {
      f.currentHp = f.maxHp;
      this.syncHpPct(f);
      f.status = f.status.filter((s) => s.type !== 'VALO_ULT_RUN_IT_BACK');
      f.isDeadAnnounced = false;
      this.log('heal', `🔥 浴火重生！${f.name} 受到致命伤，触发【再火一回】，原地满血复活！`);
      return;
    }

    if (!this.markDefeated(f, { message: deathMessage ?? formatFallbackDeathMessage(f), killer })) {
      setCurrentHp(f, 0);
    }
    if (f.currentHp > 0 && !f.isDeadAnnounced) return;
    f.isDead = true;
    this.runDefeatHooksOnce(f, spinalSwordRef);

    this.tryMorphlingSonRescue(f);
  }

  checkWinCondition(alive: Fighter[]): boolean {
    return checkWinCondition(this.createTurnFlowRuntime(), alive);
  }

  determineActor(alive: Fighter[]): Fighter | null {
    return determineActor(alive);
  }

  handleSelfTimedStatusExpiry(actor: Fighter, type: string): void {
    handleSelfTimedStatusExpiry(this.createStatusProcessingRuntime(), actor, type);
  }

  advanceGlobalTimedStatuses(): void {
    advanceGlobalTimedStatuses(this.fighters, this.turnCount);
  }

  finishStep(spinalSwordRef: SpinalSwordRef): void {
    this.handleDeathsAndRevives(spinalSwordRef);
    this.resolveGachaInstantActions(spinalSwordRef);
    this.advanceGlobalTimedStatuses();
    runCharacterReentryHooks({ runtime: this.createCharacterHookRuntime() });
  }

  resolveGachaInstantActions(spinalSwordRef: SpinalSwordRef): void {
    let safety = 0;
    const maxInstantActions = Math.max(1, this.fighters.length);

    while (safety < maxInstantActions) {
      const actor = this.fighters.find((fighter) =>
        fighter.gachaInstantActionQueued &&
        (fighter.gachaLuck ?? 0) >= GACHA_LUCK_MAX &&
        isLuckEmperor(fighter) &&
        this.isActiveCombatant(fighter) &&
        getSelectableTargets(this.createTargetingRuntime(), fighter).length > 0,
      );
      if (!actor) return;

      safety += 1;
      actor.gachaInstantActionQueued = false;
      this.fighters.forEach((fighter) => { fighter.isActing = false; });
      actor.isActing = true;
      this.handleSpinalSwordDrop(actor, spinalSwordRef);

      this.log('skill', `👑 【欧气爆发】${actor.name} 欧气满溢，强行插队获得一次命运抽卡机会！`);
      const skillId = actor.jobData.skills.includes('destiny_draw') ? 'destiny_draw' : this.selectSkill(actor);
      this.executeSkillAction(skillId, actor);
      this.advanceBunnyStyleClock(actor);
      this.handleDeathsAndRevives(spinalSwordRef);
    }

    this.log('info', '⚠️ 欧气插队结算次数过多，本轮剩余插队已被中止以防止循环。');
  }

  advanceBunnyStyleClock(actor: Fighter): void {
    if (actor.isDead || actor.job !== 'VERSATILE_RABBIT') return;
    if (actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) return;
    actor.styleTurnCounter = (actor.styleTurnCounter ?? 0) + 1;
    if (actor.styleTurnCounter >= 4) {
      actor.styleTurnCounter = 0;
      this.log('skill', `⏰ 【人设时钟】第 4 回合已到！${actor.name} 准时开启了新一轮的【光速换装】！`);
      this.executeSkillAction('v_rabbit_style_switch', actor, null, 1);
    }
  }

  handleTransformations(tgt: Fighter): void {
    if (tgt.isDead || tgt.transformed || tgt.currentHp >= tgt.maxHp * 0.5) return;

    const transform = (jobKey: string, msg: string, buffFn: () => void) => {
      tgt.transformed = true;
      const jobData = this.JOBS[jobKey];
      if (jobData) tgt.jobData = cloneJobDefinition(jobData);
      tgt.job = jobKey;
      buffFn();
      this.syncHpPct(tgt);
      this.log('transform', msg);
    };

    runCharacterTransformHooks({
      fighter: tgt,
      runtime: this.createCharacterHookRuntime(),
      transform,
    });
  }

  processStatus(actor: Fighter): boolean {
    return processStatus(this.createStatusProcessingRuntime(), actor);
  }

  isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
    return counterType === 'CTR_CHARM' && fighter.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR');
  }

  handleSpinalSwordDrop(actor: Fighter, spinalSwordRef: SpinalSwordRef): void {
    handleSpinalSwordDrop(this.createStatusProcessingRuntime(), actor, spinalSwordRef);
  }

  clearSpinalSword(actor: Fighter, logWhenActive = false): void {
    clearSpinalSword(this.createStatusProcessingRuntime(), actor, logWhenActive);
  }

  syncSpinalSwordState(actor: Fighter, logWhenExpired = false): void {
    syncSpinalSwordState(this.createStatusProcessingRuntime(), actor, logWhenExpired);
  }

  syncPuppetMasterStatus(actor: Fighter): void {
    syncPuppetMasterStatus(this.createStatusProcessingRuntime(), actor);
  }

  selectSkill(actor: Fighter): string | null {
    if (actor.status.some((s) => s.type === 'SILENCE')) {
      this.log('info', `😶 ${actor.name} 处于【${this.STATUS_EFFECTS.SILENCE?.name ?? '沉默'}】状态，无法发动技能，只能普通攻击！`);
      return null;
    }

    const selectSwordSkill = () => selectSpinalSwordRouteSkill(
      actor,
      this.fighters,
      (fighter) => this.isActiveCombatant(fighter),
    );
    if (shouldUseSpinalSwordRoute(actor)) return selectSwordSkill();

    const runtime = this.createCharacterHookRuntime();
    const characterSkill = runCharacterSkillSelectionHooks({
      actor,
      runtime,
      phase: 'preMechanics',
    });
    if (characterSkill) return characterSkill;

    const spinalSwordSkill = actor.isGacha
      ? selectSpinalSwordSpecialSkill(actor, this.fighters, (fighter) => this.isActiveCombatant(fighter))
      : null;
    if (spinalSwordSkill) return spinalSwordSkill;

    const postMechanicCharacterSkill = runCharacterSkillSelectionHooks({
      actor,
      runtime,
      phase: 'postMechanics',
    });
    if (postMechanicCharacterSkill) return postMechanicCharacterSkill;

    if (Math.random() < (0.3 + actor.wis * 0.005)) {
      const jobSkills = (actor.jobData.skills ?? []).filter((s) => s !== 'slacking' && s !== 'moyu');
      const isSpecialFighter =
        ((actor.isJoker || actor.isTokusatsu || actor.isGacha || actor.isTing || actor.isSigua || actor.isMorphling || actor.isSuccubus || actor.isTuJuanJuan || actor.isWT) && actor.transformed) ||
        actor.isGamer;

      if (isSpecialFighter) {
        let availableSkills = (actor.isTokusatsu && actor.counterUsed)
          ? jobSkills.filter((s) => s !== 'great_monster_victory' && s !== 'bujin_chair')
          : jobSkills;
        availableSkills = availableSkills.filter((s) => {
          const skData = this.SKILLS[s];
          if (!skData) return false;
          if (skData.condition && !skData.condition(actor)) return false;
          if (skData.tag === this.SKILL_TAGS['HEAL'] && actor.hpPct > 0.9) return false;
          return true;
        });
        if (availableSkills.length > 0) return availableSkills[Math.floor(Math.random() * availableSkills.length)];
      } else {
        for (const s of jobSkills) {
          const skData = this.SKILLS[s];
          if (!skData || (skData.condition && !skData.condition(actor)) || (skData.tag === this.SKILL_TAGS['HEAL'] && actor.hpPct > 0.9)) continue;
          const rate = skData.rate !== undefined ? skData.rate : 0.3;
          if (skData.isGacha || (rate > 0 && Math.random() < (rate * (1 + actor.wis * 0.002)))) return s;
        }
      }
    }
    if (actor.hasSpinalSword && actor.isGacha) return 'spinal_slash';
    return null;
  }

  isSelectableTargetFor(user: Fighter, target: Fighter): boolean {
    return isSelectableTargetFor(this.createTargetingRuntime(), user, target);
  }

  getSelectableTargets(user: Fighter): Fighter[] {
    return getSelectableTargets(this.createTargetingRuntime(), user);
  }

  handleValorantPreFire(user: Fighter, userTeamId: string, targets: Fighter[], triggerDepth: number): boolean {
    return handleValorantPreFireAction(this.createActionResolutionRuntime(), user, userTeamId, targets, triggerDepth);
  }

  resolveTarget(
    user: Fighter,
    forcedTarget: Fighter | null,
    currentTargets: Fighter[],
  ): { target: Fighter; isIntercepted: boolean } | null {
    return resolveTarget(this.createTargetingRuntime(), user, forcedTarget, currentTargets);
  }

  resolveSkillDefinition(skillId: string | null, user: Fighter): SkillDefinition {
    return resolveSkillDefinition({
      skills: this.SKILLS,
      data: this.Data,
      fighters: this.fighters,
      getTeamId: (fighter) => this.getTeamId(fighter),
      isActiveCombatant: (fighter) => this.isActiveCombatant(fighter),
      log: (type, text) => this.log(type, text),
    }, skillId, user);
  }

  formatSkillText(skill: SkillDefinition, text: string): string {
    return formatSkillText(skill, text);
  }

  executeSummonSkill(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    executeSummonSkillEffect(this.createSummonResolutionRuntime(), skill, user, userTeamId);
  }

  createSkillContext(
    user: Fighter,
    target: Fighter,
    currentTargets: Fighter[],
    triggerDepth: number,
    actionName?: string,
  ): SkillContext {
    return createSkillContextAction(this.createActionResolutionRuntime(), user, target, currentTargets, triggerDepth, actionName);
  }

  spreadDivaSupport(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    spreadDivaSupportEffect(this.createSupportResolutionRuntime(), skill, user, userTeamId);
  }

  cleanseCommonNegativeStatuses(target: Fighter): void {
    cleanseCommonNegativeStatusesEffect(target);
  }

  applyStatBuff(target: Fighter, buff: Partial<Record<StatKey | 'crit', number>>): void {
    applyStatBuffEffect(target, buff);
  }

  handleChimeraUltimateEvolution(target: Fighter): void {
    handleChimeraUltimateEvolutionEffect(this.createSupportResolutionRuntime(), target);
  }

  executeSupportSkill(skill: SkillDefinition, user: Fighter, forcedTarget: Fighter | null, userTeamId: string): boolean {
    return executeSupportSkillEffect(this.createSupportResolutionRuntime(), skill, user, forcedTarget, userTeamId);
  }

  missesSkill(user: Fighter, target: Fighter, skill: SkillDefinition, isIntercepted: boolean): boolean {
    return missesSkillAction(user, target, skill, isIntercepted);
  }

  handleWaitCounter(target: Fighter, user: Fighter, triggerDepth: number): boolean {
    return handleWaitCounterAction(this.createActionResolutionRuntime(), target, user, triggerDepth);
  }

  handleCounterStatus(target: Fighter, user: Fighter): boolean {
    return handleCounterStatusAction(this.createActionResolutionRuntime(), target, user);
  }

  breakAbsoluteDefense(skillId: string | null, user: Fighter, target: Fighter): boolean {
    return breakAbsoluteDefenseAction(this.createActionResolutionRuntime(), skillId, user, target);
  }

  dodgesWithPassiveSkill(user: Fighter, target: Fighter): boolean {
    return dodgesWithPassiveSkillAction(this.createActionResolutionRuntime(), user, target);
  }

  canTouchDamagePlane(user: Fighter, target: Fighter, skill: SkillDefinition): boolean {
    return canTouchDamagePlaneAction(this.createActionResolutionRuntime(), user, target, skill);
  }

  calculateDamage(
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    userTeamId: string,
    usedSkillId: string | null,
  ): { dmg: number; logType: string; ignoreDefOverride: boolean; sexyTrueDamage: boolean } {
    return calculateDamage(
      this.createDamageResolutionRuntime(),
      user,
      target,
      skill,
      userTeamId,
      usedSkillId,
    );
  }

  applySelfDamage(user: Fighter, skill: SkillDefinition): void {
    applySelfDamageAction(this.createActionResolutionRuntime(), user, skill);
  }

  applyAttackerStyleEffects(user: Fighter, target: Fighter): void {
    applyAttackerStyleEffectsAction(this.createActionResolutionRuntime(), user, target);
  }

  applySkillStatusEffect(skill: SkillDefinition, target: Fighter): void {
    applySkillStatusEffectAction(this.createActionResolutionRuntime(), skill, target);
  }

  handleValorantWeaponDrop(target: Fighter, actualDmg: number): void {
    handleValorantWeaponDropAction(this.createActionResolutionRuntime(), target, actualDmg);
  }

  handlePhysicalCounterReflect(skill: SkillDefinition, user: Fighter, target: Fighter, actualDmg: number): void {
    handlePhysicalCounterReflectAction(this.createActionResolutionRuntime(), skill, user, target, actualDmg);
  }

  grantValorantKillRewards(user: Fighter): void {
    grantValorantKillRewardsAction(this.createActionResolutionRuntime(), user);
  }

  handlePrimaryTargetDefeat(user: Fighter, target: Fighter): void {
    handlePrimaryTargetDefeatAction(this.createActionResolutionRuntime(), user, target);
  }

  applyLifestealEffects(
    user: Fighter,
    skill: SkillDefinition,
    actualDmg: number,
    hpBeforeDamage: number,
  ): void {
    applyLifestealEffectsAction(this.createActionResolutionRuntime(), user, skill, actualDmg, hpBeforeDamage);
  }

  consumeAimAfterAttack(user: Fighter, skill: SkillDefinition): void {
    consumeAimAfterAttackAction(this.createActionResolutionRuntime(), user, skill);
  }

  triggerSuccubusBabyFollowup(
    user: Fighter,
    target: Fighter,
    skillId: string | null,
    userTeamId: string,
    triggerDepth: number,
  ): void {
    triggerSuccubusBabyFollowupAction(this.createActionResolutionRuntime(), user, target, skillId, userTeamId, triggerDepth);
  }

  executeSkillAction(skId: string | null, usr: Fighter, forcedTarget: Fighter | null = null, triggerDepth = 0): void {
    executeSkillActionFlow(this.createActionResolutionRuntime(), skId, usr, forcedTarget, triggerDepth);
  }

  handleDeathsAndRevives(spinalSwordRef: SpinalSwordRef): void {
    const runtime = this.createCharacterHookRuntime();
    for (const f of this.fighters) {
      if ((f.currentHp <= 0 || f.isDeadAnnounced) && !f.isDead) {
        this.finalizeFighterDeath(f, spinalSwordRef);
      }

      runCharacterReviveHooks({ fighter: f, runtime, spinalSwordRef });
      this.syncHpPct(f);
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
    }
    this.fighters.forEach((f) => {
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
      this.syncHpPct(f);
    });
    runCharacterReentryHooks({ runtime });
  }

  step(spinalSwordRef: SpinalSwordRef): boolean {
    this.activeSpinalSwordRef = spinalSwordRef;
    this.fighters.forEach((f) => { f.isActing = false; f.isHit = false; });

    const alive = this.fighters.filter((f) => this.isActiveCombatant(f));
    if (this.checkWinCondition(alive)) return true;

    this.turnCount += 1;
    if (this.turnCount === 501) {
      this.log('info', '⏳ 久战不决，战场进入疲劳阶段！所有伤害会随回合推进逐步提高，防止战斗无限拖延。');
    }

    const actor = this.determineActor(alive);
    if (!actor) { this.finishStep(spinalSwordRef); return false; }

    actor.isActing = true;
    this.handleSpinalSwordDrop(actor, spinalSwordRef);

    const canAct = this.processStatus(actor);
    this.handleTransformations(actor);

    if (actor.currentHp <= 0) {
      this.finishStep(spinalSwordRef);
      return false;
    }
    if (!canAct) {
      logUnableToAct(this.createTurnFlowRuntime(), actor);
      this.finishStep(spinalSwordRef);
      return false;
    }

    const waitingCounter = getWaitingCounterStatus(this.createTurnFlowRuntime(), actor);
    if (waitingCounter) {
      logWaitingCounter(this.createTurnFlowRuntime(), actor, waitingCounter);
      this.finishStep(spinalSwordRef);
      return false;
    }

    if (isLuckEmperor(actor) && actor.hpPct <= 0.35) {
      grantGachaLuck(actor, 1, (type, text) => this.log(type, text), '残血仍然行动');
    }

    const skId = this.selectSkill(actor);
    this.executeSkillAction(skId, actor);
    this.advanceBunnyStyleClock(actor);
    this.finishStep(spinalSwordRef);
    return false;
  }
}
