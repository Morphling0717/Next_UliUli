import type {
  Fighter,
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
import { cloneJobDefinition, isActiveCombatant, setCurrentHp, syncHpPct } from './combatState';
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
    this.addLogCallback({ type, text });
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

  applyDamage(target: Fighter, amount: number, source: string, isTrueDamage = false): number {
    if (amount <= 0 || target.isDead || target.currentHp <= 0) return 0;
    if (target.status.some((s) => s.type === 'SYNERGY_SLACKING')) return 0;

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
      this.log('info', `🛡️ ${target.name} 触发了锁血保护，强制保留最后 1 点生命！`);
    }

    if (source !== 'transfer' && target.job === 'GOD_OF_TROLLS' && amount > 0 && Math.random() < 0.40) {
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
          this.log('crit', `🎭 【随机恶作剧】${target.name} 施展魔术完美闪避！并将伤害转移给了倒霉的 ${victim.name}！`);
          this.applyDamage(victim, originalAmount, 'transfer', isTrueDamage);
        } else {
          this.log('info', `🎭 【随机恶作剧】${target.name} 像个泥鳅一样躲开了 ${originalAmount} 点伤害！`);
        }
      }
    }

    target.currentHp -= amount;
    target.stats.dmgTaken += amount;
    this.syncHpPct(target);
    if (amount > 0) {
      target.isHit = true;
      // Check transformation immediately after every damage application so it fires
      // regardless of which code path (onExecute skill, counter, reflect, DoT, etc.) caused the damage.
      this.handleTransformations(target);
    }
    return amount;
  }

  markDefeated(target: Fighter, options: DefeatOptions = {}): boolean {
    if (target.isDead || target.isDeadAnnounced) return false;

    if (options.setHpZero ?? true) setCurrentHp(target, 0);
    if (options.message) this.log(options.logType ?? 'death', options.message);
    target.isDeadAnnounced = true;

    const shouldAwardKill = options.awardKill ?? true;
    if (shouldAwardKill && options.killer && options.killer.id !== target.id) {
      options.killer.stats.kills += 1;
    }

    return true;
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
      this.log('win', `🔥 浴火重生！${f.name} 受到致命伤，触发【再火一回】，原地满血复活！`);
      return;
    }

    if (!this.markDefeated(f, { message: deathMessage ?? `💀 ${f.name} 伤重不治倒下了...`, killer })) {
      setCurrentHp(f, 0);
    }
    f.isDead = true;

    const MORPHLING_SON = this.JOBS['MORPHLING_SON'];
    if (f.isGamer && !f.resurrected && this.fighters.some((cf) => cf.isMorphling && this.isActiveCombatant(cf)) && MORPHLING_SON) {
      f.isDead = false; f.resurrected = true; f.isSon = true;
      f.jobData = cloneJobDefinition(MORPHLING_SON);
      f.maxHp = Math.floor(f.maxHp * 6); f.currentHp = f.maxHp;
      f.atk *= 6; f.mag *= 6; f.wis = Math.floor(f.wis * 4.0); f.spd = 100;
      this.syncHpPct(f);
      f.status = []; f.isDeadAnnounced = false;
      this.log('win', `👶 ${f.name} 并没有死！他被水人救起，清除了负面状态并转职为【${MORPHLING_SON.name}】！`);
    }
    if (f.isDead) {
      runCharacterDefeatHooks({
        fighter: f,
        runtime: this.createCharacterHookRuntime(),
        spinalSwordRef,
      });
    }
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
    this.advanceGlobalTimedStatuses();
    runCharacterReentryHooks({ runtime: this.createCharacterHookRuntime() });
  }

  advanceBunnyStyleClock(actor: Fighter): void {
    if (actor.isDead || actor.job !== 'VERSATILE_RABBIT') return;
    actor.styleTurnCounter = (actor.styleTurnCounter ?? 0) + 1;
    if (actor.styleTurnCounter >= 4) {
      actor.styleTurnCounter = 0;
      this.log('win', `⏰ 【人设时钟】第 4 回合已到！${actor.name} 准时开启了新一轮的【光速换装】！`);
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
      this.log('win', msg);
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
  ): SkillContext {
    return createSkillContextAction(this.createActionResolutionRuntime(), user, target, currentTargets, triggerDepth);
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
    this.fighters.forEach((f) => { f.isActing = false; f.isHit = false; });

    const alive = this.fighters.filter((f) => this.isActiveCombatant(f));
    if (this.checkWinCondition(alive)) return true;

    this.turnCount += 1;
    if (this.turnCount === 501) {
      this.log('win', '⏳ 久战不决，战场进入疲劳阶段！所有伤害会随回合推进逐步提高，防止战斗无限拖延。');
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

    const skId = this.selectSkill(actor);
    this.executeSkillAction(skId, actor);
    this.advanceBunnyStyleClock(actor);
    this.finishStep(spinalSwordRef);
    return false;
  }
}
