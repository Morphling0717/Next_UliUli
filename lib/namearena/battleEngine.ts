import type {
  Fighter,
  JobDefinition,
  SkillDefinition,
  SkillContext,
  DefeatOptions,
  GachaEntry,
  StatKey,
  SpinalSwordRef,
  BattleEngineData,
  BattleEngineCore,
  StatusEffectsMap,
} from './types';
import { cloneJobDefinition, healFighter, isActiveCombatant, setCurrentHp, syncHpPct } from './combatState';
import {
  BKB_BLOCKED_STATUS_TYPES,
  COMMON_NEGATIVE_STATUS_TYPES,
  CONTROL_STATUS_TYPES,
  DOT_STATUS_TYPES,
  SLACKING_AWAY_STATUS_TYPES,
  SLACKING_RETURN_PROTECTION_STATUS_TYPES,
  getStatusTickMode,
  isStatusType,
} from './statusRules';

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
    if (f.isJoker && !f.hasResurrected) f.reviveTurns = 5;
    if (f.isTing && !f.hasDroppedSword) {
      f.hasDroppedSword = true;
      spinalSwordRef.current = true;
      this.log('win', `🦴 ${f.name} 倒下了，但他拔出了自己的脊髓剑插在了地上！`);
    }
  }

  checkWinCondition(alive: Fighter[]): boolean {
    const aliveCombatants = alive.filter((f) => this.isActiveCombatant(f));
    const activeTeams = new Set(aliveCombatants.map((f) => this.getTeamId(f)));
    let preventEnd = false;

    for (const f of this.fighters) {
      if (f.isDead && f.isJoker && !f.hasResurrected && (f.reviveTurns ?? 0) > 0) {
        const myTeamId = this.getTeamId(f);
        const hasTeammates = this.fighters.some((other) => other.id !== f.id && this.getTeamId(other) === myTeamId);
        if (hasTeammates) {
          if (!aliveCombatants.some((ally) => this.getTeamId(ally) === myTeamId)) preventEnd = true;
        } else {
          if (activeTeams.size <= 1) preventEnd = true;
        }
      }
    }

    if (activeTeams.size <= 1 && !preventEnd) {
      const winners = aliveCombatants.map((f) => f.name).join(' & ');
      const winTeam = aliveCombatants.length > 0 ? (aliveCombatants[0].teamId ? `【${aliveCombatants[0].teamId}】` : '') : '';
      this.log('win', `🏆 最终胜者：${winTeam} ${winners || '无（同归于尽）'}！`);
      return true;
    }
    return false;
  }

  determineActor(alive: Fighter[]): Fighter | null {
    if (alive.length === 0) return null;
    const actionWeight = (f: Fighter) => Math.max(1, f.spd);
    let ticket = Math.random() * alive.reduce((sum, f) => sum + actionWeight(f), 0);
    for (const f of alive) {
      ticket -= actionWeight(f);
      if (ticket <= 0) return f;
    }
    return alive[0];
  }

  handleSelfTimedStatusExpiry(actor: Fighter, type: string): void {
    if (type !== 'ZEROED' || !actor.baseStatsForZero) return;

    actor.atk = actor.baseStatsForZero.atk;
    actor.def = actor.baseStatsForZero.def;
    actor.res = actor.baseStatsForZero.res;
    delete actor.baseStatsForZero;
    actor.wasZeroed = false;
    this.log('info', `🧮 ${actor.name} 的【归零】状态结束，被降维的属性恢复了！`);
  }

  advanceGlobalTimedStatuses(): void {
    this.fighters.forEach((fighter) => {
      if (fighter.isDead) return;

      fighter.status = fighter.status.flatMap((status) => {
        if (getStatusTickMode(status.type) !== 'global' || status.duration >= 999) {
          return [status];
        }

        const appliedTurn = status.appliedTurn ?? this.turnCount;
        if (appliedTurn >= this.turnCount) {
          return [{ ...status, appliedTurn }];
        }

        if (status.duration > 1) {
          return [{ ...status, duration: status.duration - 1, appliedTurn }];
        }
        return [];
      });
    });
  }

  finishStep(spinalSwordRef: SpinalSwordRef): void {
    this.handleDeathsAndRevives(spinalSwordRef);
    this.advanceGlobalTimedStatuses();
    this.resolveSlackingReentry();
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

    const GOD_SLIME = this.JOBS['GOD_SLIME'];
    const DUAL_JOKER = this.JOBS['DUAL_JOKER'];
    const MIRACLE_BUJIN = this.JOBS['MIRACLE_BUJIN'];
    const LUCK_EMPEROR = this.JOBS['LUCK_EMPEROR'];
    const EXPLOSIVE_ANTI_CROC = this.JOBS['EXPLOSIVE_ANTI_CROC'];
    const GRUDGE_SUICIDER = this.JOBS['GRUDGE_SUICIDER'];
    const CHIMERA = this.JOBS['CHIMERA'];
    const MY_BABY = this.JOBS['MY_BABY'];
    const VALO_JUNIOR = this.JOBS['VALO_JUNIOR'];
    const VERSATILE_RABBIT = this.JOBS['VERSATILE_RABBIT'];
    const WT_TOP_TIER = this.JOBS['WT_TOP_TIER'];

    if (tgt.isMorphling && GOD_SLIME) {
      transform('GOD_SLIME', `🌊 警告：${tgt.name} 显露出【${GOD_SLIME.name}】真身！各项数值发生恐怖膨胀！`, () => {
        tgt.maxHp = 5000; tgt.currentHp = tgt.maxHp;
        tgt.atk = tgt.mag = tgt.def = tgt.res = tgt.wis = tgt.spd = tgt.agl = 300;
        tgt.status.push({ type: 'LIQUID_BODY', duration: 999 });
      });
    } else if (tgt.isJoker && DUAL_JOKER) {
      transform('DUAL_JOKER', `🤡 ${tgt.name} 摘下了冷笑话面具，展现出【${DUAL_JOKER.name}】的恐怖姿态！`, () => {
        tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 1.5))); tgt.currentHp = tgt.maxHp;
        tgt.atk *= 1.5; tgt.mag *= 2.0; tgt.spd = 100; tgt.agl = Math.max(80, tgt.agl * 2); tgt.wis = Math.max(100, tgt.wis * 2); tgt.res = Math.max(80, tgt.res * 1.5);
      });
    } else if (tgt.isTokusatsu && MIRACLE_BUJIN) {
      transform('MIRACLE_BUJIN', `🦗 KABOOM！${tgt.name} 绝境爆发！左手武神之刃，右手奇迹炼金！变身——【${MIRACLE_BUJIN.name}】！`, () => {
        tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 3.0))); tgt.currentHp = tgt.maxHp;
        tgt.atk *= 4.0; tgt.def *= 3.5; tgt.spd = 100; tgt.agl *= 3.5; tgt.mag *= 3.0; tgt.wis = 180;
      });
    } else if (tgt.isGacha && LUCK_EMPEROR) {
      transform('LUCK_EMPEROR', `👑 ${tgt.name} 怒了！觉醒欧皇血统！变身——【${LUCK_EMPEROR.name}】！`, () => {
        tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 1.8))); tgt.currentHp = tgt.maxHp;
        tgt.atk *= 2.0; tgt.mag *= 3.0; tgt.spd = 100; tgt.wis = 120;
      });
    } else if (tgt.isTing) {
      const crocExists = this.fighters.some((f) => f.isGacha && this.isActiveCombatant(f));
      if (crocExists && EXPLOSIVE_ANTI_CROC) {
        transform('EXPLOSIVE_ANTI_CROC', `💥 ${tgt.name} 看到了牢鳄，彻底疯狂！转职为【${EXPLOSIVE_ANTI_CROC.name}】！"牢鳄！我和你爆了！！！"`, () => {
          tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 2.5))); tgt.currentHp = tgt.maxHp;
          tgt.atk *= 4.0; tgt.mag *= 6.0; tgt.spd *= 5.0;
        });
      } else if (GRUDGE_SUICIDER) {
        transform('GRUDGE_SUICIDER', `🩸 ${tgt.name} 怨气爆发！转职为【${GRUDGE_SUICIDER.name}】！"都别活了..."`, () => {
          tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 2.0))); tgt.currentHp = tgt.maxHp;
          tgt.atk *= 2.5; tgt.mag *= 4.0; tgt.spd = 100;
        });
      }
    } else if (tgt.isSuccubus && CHIMERA) {
      transform('CHIMERA', `🧬 ${tgt.name} 解除了限制，肉体开始重组... 变身为【${CHIMERA.name}】！各项数值巨幅提升！`, () => {
        tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 1.5))); tgt.currentHp = tgt.maxHp;
        tgt.atk = Math.floor(tgt.atk * 2.5); tgt.def = Math.floor(tgt.def * 2.0); tgt.mag = Math.floor(tgt.mag * 2.5);
        tgt.res = Math.floor(tgt.res * 2.0); tgt.wis = Math.floor(tgt.wis * 2.0); tgt.agl = Math.floor(tgt.agl * 1.5); tgt.spd = 120;
      });
    } else if (tgt.isSigua) {
      const claire = this.fighters.find((f) => f.isSuccubus && this.isActiveCombatant(f) && this.getTeamId(f) === this.getTeamId(tgt));
      if (claire && MY_BABY) {
        transform('MY_BABY', `👶 ${tgt.name} 看到同队的克蕾儿陷入苦战！羁绊爆发！转职为专属辅助【${MY_BABY.name}】！`, () => {
          tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 1.8))); tgt.currentHp = tgt.maxHp;
          tgt.wis = 250; tgt.spd = 100; tgt.mag = 300;
        });
      } else if (VALO_JUNIOR) {
        transform('VALO_JUNIOR', `🔫 ${tgt.name} 眼神变了！拿起了步枪！转职为【${VALO_JUNIOR.name}】！全场特工技能准备就绪！`, () => {
          tgt.maxHp = Math.max(2500, Math.min(3000, Math.floor(tgt.maxHp * 2.0))); tgt.currentHp = tgt.maxHp;
          tgt.atk = 300; tgt.spd = 100; tgt.agl = 200; tgt.ultPoints = 0; tgt.economy = 0;
        });
      }
    } else if (tgt.isTuJuanJuan && VERSATILE_RABBIT) {
      transform('VERSATILE_RABBIT', `🐰 ${tgt.name} 被打急了！"我不装了！" 掏出巨大的发声计算器，转职为【${VERSATILE_RABBIT.name}】！全属性调整为 150，化身为六边形战士！`, () => {
        tgt.maxHp = 2750; tgt.currentHp = tgt.maxHp;
        tgt.atk = 150; tgt.def = 150; tgt.spd = 150; tgt.agl = 150; tgt.mag = 150; tgt.res = 150; tgt.wis = 150;
        tgt.styleTurnCounter = 0; // 重置人设时钟，二阶段从 0 开始计
        if (tgt.baseStatsForStyle) {
          tgt.baseStatsForStyle = { atk: 150, def: 150, res: 150, mag: 150, spd: 150, wis: 150, agl: 150 };
        }
      });
    } else if (tgt.isWT && WT_TOP_TIER) {
      transform('WT_TOP_TIER', `🚨 【乘员昏迷 / 载具大破】\n${tgt.name} 原下载具被毁！气得一拳砸碎键盘："防空车呢？！我直接上顶级备用载具！"\n🚜 重装巨兽降临！转职为【${WT_TOP_TIER.name}】，满挂爆反装甲接管战区！`, () => {
        tgt.maxHp = 4500; tgt.currentHp = tgt.maxHp;
        tgt.atk = 280; tgt.def = 250; tgt.res = 200; tgt.spd = 120; tgt.agl = 90; tgt.wis = 180; tgt.mag = 50;
        tgt.status.push({ type: 'WT_ERA', duration: 999 });
        tgt.status.push({ type: 'SPELL_BLOCK', duration: 999 });
      });
    }
  }

  processStatus(actor: Fighter): boolean {
    let canAct = true;
    const newStatus: typeof actor.status = [];
    const isSlacking = actor.status.some((s) => s.type === 'SYNERGY_SLACKING');

    actor.status.forEach((s) => {
      if (isStatusType(s.type, CONTROL_STATUS_TYPES)) canAct = false;
      if (!isSlacking && isStatusType(s.type, DOT_STATUS_TYPES)) {
        const dmgAmt = s.type === 'WATER_PRISON' ? Math.floor(actor.maxHp * 0.08) : Math.floor(actor.maxHp * 0.05);
        this.log('poison', `${this.STATUS_EFFECTS[s.type]?.icon ?? ''} ${actor.name} ${s.type === 'WATER_PRISON' ? '在深渊水牢中窒息' : '受到持续伤害'}，损失 ${dmgAmt} 点生命`);
        this.applyDamage(actor, dmgAmt, 'status', true);
        if (actor.currentHp <= 0) {
          this.markDefeated(actor, {
            message: `💀 ${actor.name} 因${s.type === 'WATER_PRISON' ? '窒息' : '状态伤害'}而痛苦地倒下了！`,
            awardKill: false,
          });
        }
      }
      if (!isSlacking && ['PLUG_HEART', 'REGEN', 'STYLE_FAMILY'].includes(s.type) && actor.currentHp < actor.maxHp) {
        if (actor.status.some((x) => x.type === 'NO_HEAL')) {
          this.log('info', `🥀 ${actor.name} 处于禁疗状态，无法自动回复生命！`);
        } else {
          const heal = Math.floor(actor.maxHp * 0.05);
          const healed = healFighter(actor, heal);
          this.log('heal', `${this.STATUS_EFFECTS[s.type]?.icon ?? ''} ${actor.name} 自动回复了 ${healed} 点生命`);
        }
      }
      const tickMode = getStatusTickMode(s.type);
      if (tickMode !== 'self') {
        newStatus.push(s);
      } else if (s.duration > 1) {
        newStatus.push({ ...s, duration: s.duration - 1 });
      } else if (s.duration <= 1) {
        this.handleSelfTimedStatusExpiry(actor, s.type);
      }
    });
    actor.status = newStatus;
    this.syncSpinalSwordState(actor, true);

    if (actor.status.some((s) => s.type === 'BKB') && !actor.status.some((s) => s.type === 'SYNERGY_SLACKING')) {
      const hadBlocked = actor.status.some((s) => isStatusType(s.type, BKB_BLOCKED_STATUS_TYPES));
      if (hadBlocked) {
        actor.status = actor.status.filter((s) => !isStatusType(s.type, BKB_BLOCKED_STATUS_TYPES));
        canAct = true;
        this.log('info', `🟡 ${actor.name} 处于 BKB 状态，强行免疫了控制与沉默效果！`);
      }
    }

    // Bug 8 fix: STYLE_FOOL grants immunity to control — strip any control that got applied
    if (actor.status.some((s) => s.type === 'STYLE_FOOL') && !canAct) {
      const hadControl = actor.status.some((s) => isStatusType(s.type, CONTROL_STATUS_TYPES));
      if (hadControl) {
        actor.status = actor.status.filter((s) => !isStatusType(s.type, CONTROL_STATUS_TYPES));
        canAct = true;
        this.log('info', `🤪 ${actor.name} 笨蛋女人的混沌之力让她对控制免疫，懵懵懂懂地无视了异常状态！`);
      }
    }

    if (actor.jobData?.name === '欧皇' && !canAct && Math.random() < 0.8) {
      canAct = true;
      actor.status = actor.status.filter((s) => !isStatusType(s.type, CONTROL_STATUS_TYPES));
      this.log('buff', `👑 ${actor.name} 发动了钞能力！解除了控制状态！`);
    }
    return canAct;
  }

  isPassiveCharmCounter(fighter: Fighter, counterType: string): boolean {
    return counterType === 'CTR_CHARM' && fighter.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR');
  }

  handleSpinalSwordDrop(actor: Fighter, spinalSwordRef: SpinalSwordRef): void {
    this.syncSpinalSwordState(actor);
    if (
      spinalSwordRef.current &&
      !actor.isTing &&
      !actor.isSummon &&
      !actor.hasSpinalSword &&
      !actor.status.some((s) => s.type === 'SYNERGY_SLACKING')
    ) {
      if (Math.random() < (actor.isGacha ? 0.8 : 0.2)) {
        actor.hasSpinalSword = true;
        actor.spinalSwordTurns = Math.floor(Math.random() * 3) + 3;
        actor.status.push({ type: 'SPINAL_SWORD', duration: actor.spinalSwordTurns });
        spinalSwordRef.current = false;
        this.log('buff', `🦴 ${actor.name} 捡起了小汀留下的脊髓剑！攻击力暴增！`);
        if (!actor.jobData?.skills?.includes('summon_puppet_ting')) {
          actor.jobData?.skills?.push('summon_puppet_ting');
        }
      }
    }
    this.syncSpinalSwordState(actor, true);
  }

  clearSpinalSword(actor: Fighter, logWhenActive = false): void {
    const hadActiveSword = !!actor.hasSpinalSword || actor.status.some((s) => s.type === 'SPINAL_SWORD');
    actor.hasSpinalSword = false;
    actor.spinalSwordTurns = 0;
    actor.status = actor.status.filter((s) => s.type !== 'SPINAL_SWORD');
    if (!actor.isTing) {
      actor.jobData.skills = (actor.jobData.skills ?? []).filter((s) => s !== 'summon_puppet_ting');
    }
    if (logWhenActive && hadActiveSword) {
      this.log('info', `🦴 ${actor.name} 手中的脊髓剑碎裂了...`);
    }
  }

  syncSpinalSwordState(actor: Fighter, logWhenExpired = false): void {
    const hasStatus = actor.status.some((s) => s.type === 'SPINAL_SWORD');
    if (actor.hasSpinalSword && !hasStatus) {
      this.clearSpinalSword(actor, logWhenExpired);
    } else if (!actor.hasSpinalSword && !actor.isTing && actor.jobData?.skills?.includes('summon_puppet_ting')) {
      actor.jobData.skills = actor.jobData.skills.filter((s) => s !== 'summon_puppet_ting');
    }
  }

  syncPuppetMasterStatus(actor: Fighter): void {
    const hasPuppet = this.fighters.some((f) =>
      f.isSummon && f.summonerId === actor.id && f.name === '小汀(傀儡)' && this.isActiveCombatant(f),
    );
    const hasStatus = actor.status.some((s) => s.type === 'PUPPET_MASTER');
    if (hasPuppet && !hasStatus) {
      actor.status.push({ type: 'PUPPET_MASTER', duration: 999 });
    } else if (!hasPuppet && hasStatus) {
      actor.status = actor.status.filter((s) => s.type !== 'PUPPET_MASTER');
    }
  }

  resolveSlackingReentry(): void {
    const activeFighters = this.fighters.filter((f) =>
      this.isActiveCombatant(f) && !f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
    );
    const activeTeams = new Set(activeFighters.map((f) => this.getTeamId(f))).size;
    const currentlySlacking = this.fighters.filter((f) =>
      this.isActiveCombatant(f) && f.wasSynergySlacking && f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
    );
    const naturallyFinished = this.fighters.filter((f) =>
      this.isActiveCombatant(f) && f.wasSynergySlacking && !f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
    );

    if (currentlySlacking.length > 0 && (activeTeams <= 1 || activeFighters.length <= 1)) {
      this.log('win', `🚨 【突发状况】打工的队友快死光了！（场外判定：仅存 ${activeTeams} 支队伍/阵营）`);
      currentlySlacking.forEach((p) => {
        p.status = p.status.filter((s) => !isStatusType(s.type, SLACKING_AWAY_STATUS_TYPES));
        p.currentHp = p.maxHp;
        this.syncHpPct(p);
        p.wasSynergySlacking = false;
        this.log('heal', `🏃‍♀️ 惊呼"完了！要被发现我们在摸鱼了！" ${p.name} 赶紧扔掉手里的奶茶，满血跑回战场假装还在战斗！`);
      });
      naturallyFinished.forEach((p) => { p.wasSynergySlacking = false; });
    } else if (naturallyFinished.length > 0) {
      naturallyFinished.forEach((f) => {
        f.wasSynergySlacking = false;
        f.currentHp = f.maxHp;
        this.syncHpPct(f);
        f.status = f.status.filter((s) => !isStatusType(s.type, SLACKING_RETURN_PROTECTION_STATUS_TYPES));
        this.log('heal', `⛺ 摸鱼时间结束！${f.name} 悠闲地散步回到了战场，并且状态绝佳（恢复满血）！`);
      });
      currentlySlacking.forEach((f) => {
        f.wasSynergySlacking = false;
        f.currentHp = f.maxHp;
        this.syncHpPct(f);
        f.status = f.status.filter((s) => !isStatusType(s.type, SLACKING_AWAY_STATUS_TYPES));
        this.log('heal', `⛺ 看到搭子回去打工了，${f.name} 也赶紧喝完最后一口奶茶，跟着溜回了战场！`);
      });
    }
  }

  selectSkill(actor: Fighter): string | null {
    if (actor.status.some((s) => s.type === 'SILENCE')) {
      this.log('info', `😶 ${actor.name} 处于【${this.STATUS_EFFECTS.SILENCE?.name ?? '沉默'}】状态，无法发动技能，只能普通攻击！`);
      return null;
    }

    if ((actor.isSigua || actor.isTuJuanJuan) && !actor.hasTriggeredSlacking && !actor.status.some((s) => s.type === 'SYNERGY_SLACKING')) {
      const isSigua = (f: Fighter) => f.isSigua || f.job === 'VIRTUAL_DIVA' || f.job === 'VALO_JUNIOR' || f.job === 'MY_BABY' || f.name.includes('丝瓜');
      const isBunny = (f: Fighter) => f.isTuJuanJuan || f.job === 'Q_BUNNY' || f.job === 'VERSATILE_RABBIT' || f.name.includes('兔卷卷') || f.name.includes('curly');
      const meSigua = isSigua(actor);
      const partner = this.fighters.find(
        (f) => f.id !== actor.id && this.isActiveCombatant(f) && !f.hasTriggeredSlacking &&
          !f.status.some((s) => s.type === 'SYNERGY_SLACKING') &&
          (meSigua ? isBunny(f) : isSigua(f)),
      );
      if (partner) return 'slacking';
    }

    if (actor.job === 'VALO_JUNIOR') {
      actor.ultPoints = (actor.ultPoints ?? 0) + 1;
      actor.economy = (actor.economy ?? 0) + 1;
      if (actor.ultPoints >= 5) {
        let validUlts = [
          'valo_ult_showstopper', 'valo_ult_blade_storm', 'valo_ult_cosmic_divide',
          'valo_ult_resurrection', 'valo_ult_lockdown', 'valo_ult_vipers_pit',
          'valo_ult_empress', 'valo_ult_hunters_fury', 'valo_ult_null_cmd',
          'valo_ult_run_it_back', 'valo_ult_orbital_strike', 'valo_ult_neural_theft',
        ];
        if (!this.fighters.some((f) => f.isDead && this.getTeamId(f) === this.getTeamId(actor) && f.id !== actor.id)) {
          validUlts = validUlts.filter((ult) => ult !== 'valo_ult_resurrection');
        }
        actor.ultPoints = 0;
        this.log('win', `✨ 大招充能完毕！${actor.name} 准备释放终极技能！`);
        return validUlts[Math.floor(Math.random() * validUlts.length)];
      } else {
        if (Math.random() < 0.3) return 'valo_holding_angle';
        if ((actor.economy ?? 0) >= 6) {
          if (!actor.savedSpd) {
            actor.savedSpd = actor.spd; actor.savedAgl = actor.agl;
            actor.spd = Math.floor(actor.spd * 0.5); actor.agl = 0;
            this.log('win', `🔭 资金充足！${actor.name} 起了一把【冥驹 (Operator)】！进入架枪姿态，速度和闪避大幅降低！`);
          }
          return 'valo_operator_shot';
        } else {
          if (actor.savedSpd) { actor.spd = actor.savedSpd; actor.agl = actor.savedAgl ?? 0; delete actor.savedSpd; delete actor.savedAgl; }
          return (actor.economy ?? 0) >= 2 ? 'valo_vandal_shot' : 'valo_classic_shot';
        }
      }
    }

    if (actor.hasSpinalSword) {
      if (Math.random() < 0.15) return 'blood_mist';
      if (actor.jobData?.skills?.includes('summon_puppet_ting')) {
        if (!this.fighters.some((f) => f.name === '小汀(傀儡)' && this.isActiveCombatant(f) && f.summonerId === actor.id) && Math.random() < (actor.isGacha ? 0.3 : 0.1)) return 'summon_puppet_ting';
      }
    }

    if (actor.isSuccubus && actor.transformed) {
      const hasInstall = actor.jobData.skills.includes('chimera_install');
      const plugCount = actor.status.filter((s) => s.type.startsWith('PLUG_')).length;
      if (hasInstall && plugCount < 8) {
        if (Math.random() < 0.15) {
          const pluginSkills = actor.jobData.skills.filter((s) => s.startsWith('chimera_') && s !== 'chimera_install' && s !== 'chimera_strike');
          if (pluginSkills.length > 0 && Math.random() < 0.75) {
            return pluginSkills[Math.floor(Math.random() * pluginSkills.length)];
          }
          return 'chimera_strike';
        }
        return 'chimera_install';
      }
    }

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
    return null;
  }

  isSelectableTargetFor(user: Fighter, target: Fighter): boolean {
    return this.isActiveCombatant(target) &&
      target.id !== user.id &&
      this.getTeamId(target) !== this.getTeamId(user) &&
      !target.status.some((s) => s.type === 'SYNERGY_SLACKING');
  }

  getSelectableTargets(user: Fighter): Fighter[] {
    return this.fighters.filter((f) => this.isSelectableTargetFor(user, f));
  }

  handleValorantPreFire(user: Fighter, userTeamId: string, targets: Fighter[], triggerDepth: number): boolean {
    if (triggerDepth !== 0 || user.job === 'VALO_JUNIOR' || targets.length === 0) return false;

    const preFirer = this.fighters.find(
      (f) =>
        this.isActiveCombatant(f) &&
        this.getTeamId(f) !== userTeamId &&
        f.job === 'VALO_JUNIOR' &&
        f.status.some((s) => s.type === 'VALO_HOLDING_ANGLE'),
    );
    if (!preFirer) return false;

    if (user.status.some((s) => s.type === 'LIQUID_BODY')) {
      this.log('skill', `💧 瓦学妹的提前枪精准命中了 ${user.name}，但子弹仅仅是穿过了水流！攻击并未被截停！`);
      preFirer.status = preFirer.status.filter((s) => s.type !== 'VALO_HOLDING_ANGLE');
      return false;
    }

    this.log('skill', `🔭 【受击截停】${preFirer.name} 提前预瞄了 ${user.name} 的位置，强制先手开火拦截！`);
    preFirer.status = preFirer.status.filter((s) => s.type !== 'VALO_HOLDING_ANGLE');
    this.executeSkillAction('valo_pre_fire', preFirer, user, triggerDepth + 1);
    if (user.isDead || user.status.some((s) => s.type === 'VALO_AIM_PUNCH')) {
      this.log('info', `🎯 ${user.name} 被提前枪截停（Aim Punch），原有的攻击动作被打断！`);
      return true;
    }
    return false;
  }

  resolveTarget(
    user: Fighter,
    forcedTarget: Fighter | null,
    currentTargets: Fighter[],
  ): { target: Fighter; isIntercepted: boolean } | null {
    if (currentTargets.length === 0) return null;

    const forcedTargetValid = forcedTarget ? this.isSelectableTargetFor(user, forcedTarget) : false;
    let target = forcedTargetValid ? forcedTarget! : currentTargets[Math.floor(Math.random() * currentTargets.length)];
    let isIntercepted = false;
    const protector = this.fighters.find((f) =>
      f.isSummon &&
      f.summonerId === target.id &&
      f.name === '小汀(傀儡)' &&
      this.isActiveCombatant(f),
    );
    if (protector && protector.id !== user.id) {
      target = protector;
      isIntercepted = true;
    }

    if (!target || !this.isActiveCombatant(target) || target.id === user.id) return null;
    return { target, isIntercepted };
  }

  resolveSkillDefinition(skillId: string | null, user: Fighter): SkillDefinition {
    let skill: SkillDefinition | null = (skillId ? this.SKILLS[skillId] : undefined) ??
      (user.hasSpinalSword
        ? this.SKILLS['spinal_slash'] ?? { name: '脊髓剑·斩', tag: this.SKILL_TAGS['PHYS'] as SkillDefinition['tag'], mult: 2.5, text: '🩸 {USER} 挥舞脊髓剑劈向 {TARGET}，造成 {VAL} 点伤害！' }
        : null);

    if (skillId === 'chimera_install' && skill?.pool) {
      const gachaPool = skill.pool as GachaEntry[];
      const availablePlugs = gachaPool.filter((p) => !p.newSkill || !user.jobData.skills.includes(p.newSkill));
      if (availablePlugs.length > 0) {
        skill = { ...skill, pool: availablePlugs };
      } else {
        user.jobData.skills = user.jobData.skills.filter((s) => s !== 'chimera_install');
        skill = null;
      }
    }

    if (!skill) {
      skill = (user.mag > user.atk && Math.random() < (0.5 + user.wis * 0.002))
        ? { name: '魔力攻击', tag: 'magical', mult: 1.0, text: '{USER} 凝聚魔力攻击 {TARGET}，造成 {VAL} 魔法伤害。' }
        : { name: '普通攻击', tag: 'physical', mult: 1.0, text: '{USER} 攻击了 {TARGET}，造成 {VAL} 伤害。' };
    }

    if (skill.isGacha && skill.pool) {
      const exodiaChance = user.jobData?.name === '欧皇' ? 0.05 : 0.006;
      const pool = skill.pool as GachaEntry[];
      if (pool === this.Data.GACHA_SSR_POOL && Math.random() < exodiaChance) {
        skill = { ...skill, ...this.Data.EXODIA_CARD };
        this.log('win', `👑 欧皇时刻！${user.name} 触发了 5% 的保底机制！`);
      } else {
        skill = { ...skill, ...pool[Math.floor(Math.random() * pool.length)] };
      }
    }

    return skill;
  }

  formatSkillText(skill: SkillDefinition, text: string): string {
    if (skill.name && skill.name !== '普通攻击' && skill.name !== '魔力攻击' && text && !text.includes('【')) {
      return text.replace('{USER}', `【${skill.name}】{USER}`);
    }
    return text;
  }

  executeSummonSkill(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    if ((skill.unique || skill.summonName === '黑暗大法师') && this.fighters.some((f) => f.name === skill.summonName && this.isActiveCombatant(f))) {
      this.log('info', `🚫 场上已经存在 ${skill.summonName}，无法重复召唤！`);
      return;
    }
    if ((skill.tributes ?? 0) > 0) {
      const potentialTributes = this.fighters.filter(
        (f) => f.isSummon && this.isActiveCombatant(f) && this.getTeamId(f) === userTeamId && f.name !== '黑暗大法师' && (skill.summonName !== '青眼白龙' || f.name !== '翼神龙'),
      );
      if (potentialTributes.length < (skill.tributes ?? 0)) {
        this.log('info', `🚫 ${user.name} 试图召唤 ${skill.summonName}，但场上祭品不足！`);
        return;
      }
      const sacrificed = potentialTributes.sort(() => 0.5 - Math.random()).slice(0, skill.tributes);
      sacrificed.forEach((v) => {
        this.markDefeated(v, { awardKill: false });
        v.isDead = true;
      });
      this.log('death', `💀 献祭！${sacrificed.map((f) => f.name).join('、')} 化为了召唤 ${skill.summonName} 的祭品！`);
    }
    if (skill.summonName === '小汀(傀儡)') {
      if (!user.hasSpinalSword || !user.status.some((s) => s.type === 'SPINAL_SWORD')) {
        this.clearSpinalSword(user);
        this.log('info', `🚫 ${user.name} 试图唤醒脊髓剑怨念，但手中已经没有完整的脊髓剑了...`);
        return;
      }
      if (this.fighters.some((f) => f.isTing && this.isActiveCombatant(f))) {
        user.jobData.skills = user.jobData.skills.filter((s) => s !== 'summon_puppet_ting');
        this.log('info', `🚫 ${user.name} 试图唤醒脊髓剑怨念，但感应到小汀本体尚存...`);
        return;
      }
      if (this.fighters.some((f) => f.name === '小汀(傀儡)' && this.isActiveCombatant(f) && f.summonerId === user.id)) return;
    }

    const summonJobKey = skill.summonJob ?? 'WARRIOR';
    const summonJob = (this.JOBS[summonJobKey] ?? this.JOBS['WARRIOR'])!;
    const summonName = skill.summonName ?? '召唤物';
    this.fighters.push({
      id: this.Core.generateUUID ? this.Core.generateUUID() : `summon-${Math.random()}`,
      name: summonName,
      displayName: summonName,
      job: summonJobKey,
      jobData: cloneJobDefinition(summonJob),
      maxHp: skill.stats?.hp ?? 2000, currentHp: skill.stats?.hp ?? 2000, hpPct: 1.0,
      atk: skill.stats?.atk ?? 200, def: skill.stats?.def ?? 100, spd: skill.stats?.spd ?? 120,
      agl: skill.stats?.agl ?? 100, mag: skill.stats?.mag ?? 100, res: skill.stats?.res ?? 100,
      wis: skill.stats?.wis ?? 100, critRate: 0.1,
      color: user.color, isDead: false, isDeadAnnounced: false,
      status: [], stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
      summonerId: user.id, isSummon: true,
    });
    if (skill.summonName === '小汀(傀儡)') this.syncPuppetMasterStatus(user);
    this.log('skill', this.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name));
  }

  createSkillContext(
    user: Fighter,
    target: Fighter,
    currentTargets: Fighter[],
    triggerDepth: number,
  ): SkillContext {
    return {
      user,
      target,
      currentTargets,
      fighters: this.fighters,
      setLogs: () => {},
      log: (type, text) => this.log(type, text),
      getTeamId: (f) => this.getTeamId(f),
      applyDamage: (t, a, s, trueDmg) => this.applyDamage(t, a, s, trueDmg),
      markDefeated: (target, options) => this.markDefeated(target, options),
      triggerDepth,
      executeSkillAction: (id, u, t, d) => this.executeSkillAction(id, u, t, d),
      STATUS_EFFECTS: this.STATUS_EFFECTS,
    };
  }

  spreadDivaSupport(skill: SkillDefinition, user: Fighter, userTeamId: string): void {
    if (user.job !== 'VIRTUAL_DIVA' || (skill.tag !== this.SKILL_TAGS['BUFF'] && skill.tag !== this.SKILL_TAGS['HEAL'])) return;

    const teammates = this.fighters.filter((f) => this.isActiveCombatant(f) && f.id !== user.id && this.getTeamId(f) === userTeamId);
    teammates.forEach((mate) => {
      if (skill.tag === this.SKILL_TAGS['HEAL']) {
        if (!mate.status.some((s) => s.type === 'NO_HEAL')) {
          healFighter(mate, Math.floor(Math.max(user.atk, user.mag) * (skill.mult ?? 1)));
        }
      }
      if (skill.tag === this.SKILL_TAGS['BUFF']) {
        if (skill.status) {
          if (skill.status.startsWith('PLUG_')) mate.status = mate.status.filter((s) => s.type !== skill.status);
          mate.status.push({ type: skill.status, duration: skill.status === 'INVUL' ? 1 : 3 });
        }
        if (skill.statBuff) {
          const buff = skill.statBuff;
          (Object.keys(buff) as (StatKey | 'crit')[]).forEach((k) => {
            if (k !== 'crit' && mate[k] !== undefined) mate[k] = Math.floor(mate[k] * (buff[k as StatKey] ?? 1));
          });
        }
      }
      if (skill.cleanStatus) mate.status = mate.status.filter((s) => !isStatusType(s.type, COMMON_NEGATIVE_STATUS_TYPES));
    });
    if (teammates.length > 0) this.log('buff', `🎵 歌姬的光环！${user.name} 的技能效果同步给了 ${teammates.length} 名队友！`);
  }

  cleanseCommonNegativeStatuses(target: Fighter): void {
    target.status = target.status.filter((s) => !isStatusType(s.type, COMMON_NEGATIVE_STATUS_TYPES));
  }

  applyStatBuff(target: Fighter, buff: Partial<Record<StatKey | 'crit', number>>): void {
    (Object.keys(buff) as (StatKey | 'crit')[]).forEach((key) => {
      if (key !== 'crit' && target[key] !== undefined) {
        target[key] = Math.floor(target[key] * (buff[key] ?? 1));
      } else if (key === 'crit') {
        target.critRate += buff.crit ?? 0;
      }
    });
  }

  handleChimeraUltimateEvolution(target: Fighter): void {
    const chimeraPluginSkills = new Set(
      (this.Data.CHIMERA_PLUGIN_POOL ?? [])
        .map((entry) => entry.newSkill)
        .filter((entry): entry is string => !!entry),
    );
    const currentPlugCount = target.jobData.skills.filter((skillId) => chimeraPluginSkills.has(skillId)).length;
    if (currentPlugCount < 8 || target.hasUltimateEvolved) return;

    target.hasUltimateEvolved = true;
    target.jobData.skills = target.jobData.skills.filter((s) => s !== 'chimera_install' && s !== 'chimera_strike');
    target.atk = Math.floor(target.atk * 3.0);
    target.mag = Math.floor(target.mag * 3.0);
    target.def = Math.floor(target.def * 2.0);
    target.res = Math.floor(target.res * 2.0);
    target.spd = Math.floor(target.spd * 1.5);
    target.maxHp = Math.floor(target.maxHp * 1.8);
    target.currentHp = target.maxHp;
    this.syncHpPct(target);
    this.log('win', `🧬 警告！${target.name} 已完成究极进化！全插件安装完毕！\n封印解除，全属性引发恐怖的裂变！化身为最高级别的神级灾厄！`);
  }

  executeSupportSkill(skill: SkillDefinition, user: Fighter, forcedTarget: Fighter | null, userTeamId: string): boolean {
    if (skill.tag !== this.SKILL_TAGS['HEAL'] && skill.tag !== this.SKILL_TAGS['BUFF']) return false;

    let targetForBuff = (forcedTarget && this.getTeamId(forcedTarget) === userTeamId) ? forcedTarget : user;
    if (user.job === 'MY_BABY') {
      targetForBuff = this.fighters.find((f) => f.isSuccubus && this.isActiveCombatant(f) && this.getTeamId(f) === userTeamId) ?? targetForBuff;
    }

    if (skill.tag === this.SKILL_TAGS['HEAL']) {
      if (targetForBuff.status.some((s) => s.type === 'NO_HEAL')) {
        this.log('info', `🥀 ${targetForBuff.name} 处于禁疗状态，无法接受治疗！`);
        return true;
      }
      const heal = Math.floor(Math.max(user.atk, user.mag) * (skill.mult ?? 1));
      const healed = healFighter(targetForBuff, heal);
      if (skill.cleanStatus) this.cleanseCommonNegativeStatuses(targetForBuff);
      let hMsg = this.formatSkillText(skill, skill.text ?? '');
      if (!hMsg.includes('{VAL}')) hMsg += ` (恢复 {VAL} 点生命)`;
      this.log('heal', hMsg.replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name).replace(/{VAL}/g, String(healed)));
      return true;
    }

    if (skill.status) {
      let duration = skill.status === 'INVUL' ? 1 : (skill.status.startsWith('CTR_') ? 5 : 3);
      if (skill.status.startsWith('CTR_')) targetForBuff.status = targetForBuff.status.filter((s) => !s.type.startsWith('CTR_'));
      if (skill.status.startsWith('PLUG_')) {
        if (skill.statBuff) this.applyStatBuff(targetForBuff, skill.statBuff);
        if (skill.newSkill && !targetForBuff.jobData.skills.includes(skill.newSkill)) {
          targetForBuff.jobData.skills.push(skill.newSkill);
          this.handleChimeraUltimateEvolution(targetForBuff);
        }
        duration = 999;
      }
      if (skill.status.startsWith('PLUG_')) {
        targetForBuff.status = targetForBuff.status.filter((s) => s.type !== skill.status);
      }
      targetForBuff.status.push({ type: skill.status, duration });
    }
    if (skill.statBuff && !skill.status?.startsWith('PLUG_')) {
      this.applyStatBuff(targetForBuff, skill.statBuff);
    }
    if (skill.cleanStatus) this.cleanseCommonNegativeStatuses(targetForBuff);
    this.log('buff', this.formatSkillText(skill, skill.text ?? '').replace(/{USER}/g, user.name).replace(/{TARGET}/g, targetForBuff.name));
    return true;
  }

  missesSkill(user: Fighter, target: Fighter, skill: SkillDefinition, isIntercepted: boolean): boolean {
    const userAgl = user.status.some((s) => s.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(user.agl * 1.2) : user.agl;
    const effectiveTargetAgl = target.status.some((s) => s.type === 'WT_SUPPRESS' || s.type === 'NEURAL_THEFT_DEBUFF') ? 0 : target.agl;
    const targetAgl = target.status.some((s) => s.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(effectiveTargetAgl * 1.2) : effectiveTargetAgl;
    let hitChance = 0.95 + (userAgl - targetAgl) * 0.005;
    const guaranteedHit =
      user.status.some((s) => s.type === 'AIM') ||
      isIntercepted ||
      target.status.some((s) => s.type === 'NEURAL_THEFT_DEBUFF') ||
      skill.alwaysHit ||
      skill.isGacha;
    if (guaranteedHit) {
      hitChance = 10.0;
    } else {
      if (user.status.some((s) => s.type === 'BLIND')) hitChance -= 0.45;
      if (user.status.some((s) => s.type === 'VALO_FLASH')) hitChance -= 0.55;
      if (user.status.some((s) => s.type === 'VALO_AIM_PUNCH')) hitChance -= 0.8;
      hitChance = Math.max(0.05, Math.min(0.98, hitChance));
    }

    return Math.random() > hitChance && !skill.ignoreDef;
  }

  handleWaitCounter(target: Fighter, user: Fighter, triggerDepth: number): boolean {
    if (!target.status.some((s) => s.type === 'WAIT_COUNTER') || target.counterUsed) return false;

    target.status = target.status.filter((s) => s.type !== 'WAIT_COUNTER');
    target.counterUsed = true;
    if (target.isTokusatsu) {
      const MIRACLE_MONSTER = this.JOBS['MIRACLE_MONSTER_BUJIN'];
      target.atk = Math.floor(target.atk * 2.5); target.def = Math.floor(target.def * 2.0); target.mag = Math.floor(target.mag * 2.0); target.spd = Math.floor(target.spd * 1.5);
      if (MIRACLE_MONSTER) target.jobData = cloneJobDefinition(MIRACLE_MONSTER);
      target.job = 'MIRACLE_MONSTER_BUJIN';
      target.monsterTurns = 0;
      delete target.savedStats;
      target.hasUsedRainbowFever = false;
      this.log('win', `🦖 ${target.name} 受到攻击，触发反击！\n"DUAL ON！GREAT！MONSTER！Ready Fight."\n数值暴涨！永久进化为【奇迹怪兽武刃】！`);
      this.log('info', `🚫 ${user.name} 的攻击被 ${target.name} 的怪兽形态打断了！`);
      this.executeSkillAction('great_monster_victory', target, user, triggerDepth + 1);
      return true;
    }

    this.log('win', `🪑 ${target.name} 从借来的椅子上跃起，触发了等待反击！`);
    this.log('info', `🚫 ${user.name} 的攻击被打断了！`);
    const counterDmg = Math.floor(target.atk * 2.0);
    this.applyDamage(user, counterDmg, 'counter');
    this.log('crit', `💥 强力反击！${target.name} 对 ${user.name} 造成了 ${counterDmg} 点伤害！`);
    if (user.currentHp <= 0) {
      this.markDefeated(user, {
        message: `💀 ${user.name} 承受不住反击的威力，被直接击杀了！`,
        killer: target,
      });
    }
    return true;
  }

  handleCounterStatus(target: Fighter, user: Fighter): boolean {
    const counterStatus = target.status.find((s) => s.type.startsWith('CTR_'));
    if (!counterStatus) return false;

    const counterType = counterStatus.type;
    const isPermanentCharmCounter = this.isPassiveCharmCounter(target, counterType);
    const triggerChance = isPermanentCharmCounter ? 0.5 : 1.0;
    if (Math.random() > triggerChance) {
      if (!target.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR')) {
        target.status = target.status.filter((s) => s !== counterStatus);
      }
      return false;
    }

    this.log('skill', `😈 ${target.name} 触发了【${this.STATUS_EFFECTS[counterType]?.name ?? counterType}】！`);
    if (!target.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR')) {
      target.status = target.status.filter((s) => s !== counterStatus);
    }
    if (counterType === 'CTR_CHARM') { user.status.push({ type: 'CHARMED', duration: 2 }); this.log('info', `😍 ${user.name} 被魅惑了，停止了攻击！`); return true; }
    if (counterType === 'CTR_STUN') { user.status.push({ type: 'STUN', duration: 2 }); this.log('info', `💫 ${user.name} 被震慑眩晕，攻击中断！`); return true; }
    if (counterType === 'CTR_DRAIN') {
      this.log('heal', `🧛 ${target.name} 发动反击，试图吸取 ${user.name} 300 点生命！`);
      const drain = this.applyDamage(user, 300, 'counter', true);
      healFighter(target, drain);
      if (user.currentHp <= 0) {
        this.markDefeated(user, { message: `💀 ${user.name} 被吸干了生命！`, killer: target });
      }
    }
    if (counterType === 'CTR_POISON') user.status.push({ type: 'POISON', duration: 5 });
    if (counterType === 'CTR_BURN') user.status.push({ type: 'BURN', duration: 5 });
    if (counterType === 'CTR_FREEZE') { user.status.push({ type: 'FREEZE', duration: 2 }); return true; }
    if (counterType === 'CTR_VOID') {
      this.log('crit', `🌌 虚空反击陷阱启动！试图吞噬 ${user.name}，造成 500 真实伤害！`);
      this.applyDamage(user, 500, 'counter', true);
      if (user.currentHp <= 0) {
        this.markDefeated(user, { message: `💀 ${user.name} 跌入了虚空被粉碎！`, killer: target });
      }
    }
    if (counterType === 'CTR_WEAK') { user.atk = Math.floor(user.atk * 0.5); this.log('info', `📉 ${user.name} 的攻击力大幅下降！`); }
    if (counterType === 'CTR_CONFUSE') { user.status.push({ type: 'CONFUSED', duration: 3 }); return true; }
    if (counterType === 'CTR_EXECUTE') {
      if (user.hpPct < 0.4) {
        this.markDefeated(user, { message: `☠️ 断头台落下！${user.name} 被直接处决！`, killer: target });
        return true;
      }
      this.log('info', `☠️ ${user.name} 生命值尚高，逃过一劫！`);
    }
    return false;
  }

  breakAbsoluteDefense(skillId: string | null, user: Fighter, target: Fighter): boolean {
    if (skillId === 'cosmic_slap' && target.status.some((s) => s.type === 'INVUL' || s.type === 'BKB')) {
      target.status = target.status.filter((s) => s.type !== 'INVUL' && s.type !== 'BKB');
      this.log('skill', `🌌 所谓绝对防御，在神明眼中不过是层薄纸！${user.name} 强行捏碎了 ${target.name} 的无敌/金身！`);
    }
    if (!target.status.some((s) => s.type === 'INVUL')) return false;

    this.log('info', `🛡️ ${target.name} 免疫了 ${user.name} 的攻击！`);
    return true;
  }

  dodgesWithPassiveSkill(user: Fighter, target: Fighter): boolean {
    const targetSkills = target.jobData.skills ?? [];
    if (targetSkills.includes('flash_lol') && Math.random() < 0.2) {
      this.log('skill', `✨ ${target.name} 极限反应！交出闪现（D键），规避了 ${user.name} 的伤害！`);
      return true;
    }
    if (targetSkills.includes('roll_dodge') && Math.random() < 0.25) {
      this.log('skill', `🔄 ${target.name} 战术翻滚！利用无敌帧躲过了 ${user.name} 的攻击！`);
      return true;
    }
    return false;
  }

  canTouchDamagePlane(user: Fighter, target: Fighter, skill: SkillDefinition): boolean {
    if (user.status.some((s) => s.type === 'ETHEREAL') && skill.tag === this.SKILL_TAGS['PHYS']) {
      this.log('info', `👻 ${user.name} 处于虚无界，无法造成物理伤害！`);
      return false;
    }
    if (target.status.some((s) => s.type === 'ETHEREAL') && skill.tag === this.SKILL_TAGS['PHYS']) {
      this.log('info', `👻 ${target.name} 处于虚无界，物理攻击无法触碰！`);
      return false;
    }
    return true;
  }

  calculateDamage(
    user: Fighter,
    target: Fighter,
    skill: SkillDefinition,
    userTeamId: string,
    usedSkillId: string | null,
  ): { dmg: number; logType: string; ignoreDefOverride: boolean; sexyTrueDamage: boolean } {
    let dmg = 0;
    let logType = usedSkillId ? 'skill' : 'attack';
    const sexyTrueDamage = user.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR');
    const ignoreDefOverride = !!skill.ignoreDef || sexyTrueDamage;
    const weakOutputMultiplier = user.status.some((s) => s.type === 'WEAK') ? 0.5 : 1;

    if (skill.tag === this.SKILL_TAGS['PHYS'] || skill.tag === this.SKILL_TAGS['SPECIAL']) {
      const atk = user.atk * weakOutputMultiplier * (user.status.some((s) => s.type === 'RAGE') ? 1.5 : 1) * (user.hasSpinalSword ? 2.5 : 1);
      let def = (target.status.some((s) => s.type === 'FREEZE') || ignoreDefOverride || sexyTrueDamage)
        ? 0
        : (user.jobData?.name === '欧皇' ? Math.floor(target.def * 0.5) : target.def);
      if (target.status.some((s) => s.type === 'WT_ERA')) def = Math.floor(def * 2.0);
      dmg = Math.max(1, Math.floor((atk * (1 + Math.random() * 0.2) - def * 0.5) * (skill.mult ?? 1)));
      if (target.status.some((s) => s.type === 'LIQUID_BODY')) dmg = Math.floor(dmg * 0.5);
    }

    if (skill.tag === this.SKILL_TAGS['MAG'] || skill.tag === this.SKILL_TAGS['DEBUFF']) {
      const res = (ignoreDefOverride || sexyTrueDamage) ? 0 : (user.jobData?.name === '欧皇' ? Math.floor(target.res * 0.5) : target.res);
      dmg = Math.max(1, Math.floor((user.mag * weakOutputMultiplier * (1 + Math.random() * 0.2) - res * 0.5) * (skill.mult ?? 1)));
      if (skill.tag === this.SKILL_TAGS['DEBUFF']) dmg = Math.max(1, Math.floor(dmg * 0.5));
      if (target.status.some((s) => s.type === 'ETHEREAL')) {
        dmg = Math.floor(dmg * 2.0);
        this.log('crit', `👻 魔法爆裂！${target.name} 处于虚无状态，受到了双倍的魔法打击！`);
      }
    }

    if (user.job === 'GOD_SLIME') {
      const sonBattery = this.fighters.find((f) => f.isSon && this.isActiveCombatant(f) && this.getTeamId(f) === userTeamId);
      if (sonBattery) {
        dmg = Math.floor(dmg * 1.5);
        this.log('buff', `🔋 【魔力泵浦】水人的好大儿为 ${user.name} 提供了庞大的魔力增幅！伤害1.5倍！`);
      }
    }

    const isCrit =
      user.status.some((s) => s.type === 'AIM') ||
      target.status.some((s) => s.type === 'NEURAL_THEFT_DEBUFF') ||
      skill.alwaysCrit ||
      Math.random() < (user.critRate + user.agl * 0.001) ||
      user.status.some((s) => s.type === 'STYLE_ANGRY');

    if (isCrit) {
      if (target.status.some((s) => s.type === 'LIQUID_BODY') && skill.tag === this.SKILL_TAGS['PHYS']) {
        // liquid body immune to physical crits
      } else {
        dmg = Math.floor(dmg * 1.5);
        logType = 'crit';
      }
    }

    if (skill.hits) dmg *= skill.hits;
    if (skill.minDamagePct && (skill.tag === this.SKILL_TAGS['PHYS'] || skill.tag === this.SKILL_TAGS['SPECIAL'])) {
      const minDamageBase = user.atk * weakOutputMultiplier * (skill.mult ?? 1) * (skill.hits ?? 1);
      dmg = Math.max(dmg, Math.floor(minDamageBase * skill.minDamagePct));
    }
    const fatigueBonus = this.getFatigueDamageBonus();
    if (fatigueBonus > 0 && dmg > 0) dmg += fatigueBonus;

    return { dmg, logType, ignoreDefOverride, sexyTrueDamage };
  }

  applySelfDamage(user: Fighter, skill: SkillDefinition): void {
    if (!skill.selfDmgPct) return;

    const selfDamageFloor = skill.selfDmgCanKill ? 0 : 1;
    user.currentHp = Math.max(selfDamageFloor, user.currentHp - Math.floor(user.maxHp * skill.selfDmgPct));
    this.syncHpPct(user);
  }

  applyAttackerStyleEffects(user: Fighter, target: Fighter): void {
    if (user.status.some((s) => s.type === 'STYLE_VAIN')) {
      const stealAtk = Math.floor(target.atk * 0.1);
      const stealMag = Math.floor(target.mag * 0.1);
      target.atk = Math.max(1, target.atk - stealAtk);
      target.mag = Math.max(1, target.mag - stealMag);
      user.atk += stealAtk;
      user.mag += stealMag;
      this.log('buff', `💅 虚荣窃取！${user.name} 偷走了 ${target.name} 的属性化为己用！(吸收了攻击和魔力)`);
    }

    if (user.status.some((s) => s.type === 'STYLE_FOOL') && Math.random() < 0.5) {
      const debuffs = ['STUN', 'FREEZE', 'POISON', 'BURN'];
      const randomDebuff = debuffs[Math.floor(Math.random() * debuffs.length)];
      if (!target.status.some((s) => s.type === 'BKB')) {
        target.status.push({ type: randomDebuff, duration: 2 });
        this.log('skill', `🤪 笨蛋女人乱拳挥舞！不经意间给 ${target.name} 附加了【${this.STATUS_EFFECTS[randomDebuff]?.name ?? randomDebuff}】异常状态！`);
      }
    }
  }

  applySkillStatusEffect(skill: SkillDefinition, target: Fighter): void {
    if (!skill.status) return;

    if (target.status.some((s) => s.type === 'BKB') && ['STUN', 'FREEZE', 'SILENCE', 'CONFUSED', 'CHARMED'].includes(skill.status)) {
      this.log('info', `🟡 ${target.name} 处于 BKB 状态，免疫了 ${this.STATUS_EFFECTS[skill.status]?.name ?? skill.status} 效果！`);
      return;
    }
    target.status.push({ type: skill.status, duration: 2 });
  }

  handleValorantWeaponDrop(target: Fighter, actualDmg: number): void {
    if (target.job !== 'VALO_JUNIOR' || (target.economy ?? 0) < 6) return;

    const isHeavyHit = actualDmg > target.maxHp * 0.2;
    const isControlled = target.status.some((s) => ['STUN', 'FREEZE', 'CONFUSED', 'CHARMED'].includes(s.type));
    if (!isHeavyHit && !isControlled) return;

    target.economy = Math.max(0, (target.economy ?? 0) - 5);
    if (target.savedSpd) {
      target.spd = target.savedSpd;
      target.agl = target.savedAgl ?? 0;
      delete target.savedSpd;
      delete target.savedAgl;
    }
    this.log('death', `💔 损失惨重！${target.name} 受到重创或被控，手中的【冥驹】掉落了！经济大幅衰退！`);
  }

  handlePhysicalCounterReflect(skill: SkillDefinition, user: Fighter, target: Fighter, actualDmg: number): void {
    if (skill.tag !== this.SKILL_TAGS['PHYS'] || !target.status.some((s) => s.type === 'COUNTER')) return;

    target.status = target.status.filter((s) => s.type !== 'COUNTER');
    this.log('crit', `💢 ${target.name} 触发反击！将 ${actualDmg} 点伤害弹回给了 ${user.name}！`);
    this.applyDamage(user, actualDmg, 'reflect');
    if (user.currentHp <= 0) {
      this.markDefeated(user, { message: `💀 ${user.name} 被自己造成的反弹伤害反死了！`, killer: target });
    }
  }

  grantValorantKillRewards(user: Fighter): void {
    if (user.job !== 'VALO_JUNIOR') return;

    user.economy = (user.economy ?? 0) + 2;
    user.ultPoints = (user.ultPoints ?? 0) + 1;
    this.log('info', `💰 ${user.name} 拿到击杀！大招充能+1，经济大幅增长(+2)！`);
  }

  handlePrimaryTargetDefeat(user: Fighter, target: Fighter): void {
    if (target.currentHp > 0) return;

    const defeated = this.markDefeated(target, { message: `💀 【击杀】${target.name} 被 ${user.name} 的攻击无情抹杀！`, killer: user });
    if (defeated) this.grantValorantKillRewards(user);
  }

  applyLifestealEffects(
    user: Fighter,
    skill: SkillDefinition,
    actualDmg: number,
    hpBeforeDamage: number,
  ): void {
    const lsPct =
      (skill.lifesteal ?? 0) +
      (user.status.some((s) => s.type === 'PLUG_HEAD') ? 0.25 : 0) +
      (user.status.some((s) => s.type === 'VALO_ULT_EMPRESS') ? 1.0 : 0) +
      (user.status.some((s) => s.type === 'STYLE_SMART' || s.type === 'STYLE_EMPEROR') ? 0.5 : 0);
    if (lsPct <= 0 || actualDmg <= 0 || !this.isActiveCombatant(user)) return;

    if (user.status.some((s) => s.type === 'NO_HEAL')) {
      this.log('info', `🥀 ${user.name} 处于禁疗状态，无法触发吸血被动！`);
      return;
    }

    const healBase = Math.min(hpBeforeDamage, actualDmg);
    const healAmt = Math.floor(healBase * lsPct);
    if (healAmt <= 0) return;

    const healed = healFighter(user, healAmt);
    if (healed > 0) this.log('heal', `💉 ${user.name} 触发吸血被动，恢复了 ${healed} 点生命！`);
  }

  consumeAimAfterAttack(user: Fighter, skill: SkillDefinition): void {
    if (skill.tag === this.SKILL_TAGS['HEAL'] || skill.tag === this.SKILL_TAGS['BUFF']) return;
    if (!user.status.some((s) => s.type === 'AIM')) return;

    user.status = user.status.filter((s) => s.type !== 'AIM');
  }

  triggerSuccubusBabyFollowup(
    user: Fighter,
    target: Fighter,
    skillId: string | null,
    userTeamId: string,
    triggerDepth: number,
  ): void {
    if (!user.isSuccubus || !user.transformed || !skillId?.startsWith('chimera_') || skillId === 'chimera_install') return;

    const baby = this.fighters.find((f) => f.job === 'MY_BABY' && this.isActiveCombatant(f) && this.getTeamId(f) === userTeamId);
    const syncSkillId = CHIMERA_BABY_SYNC_SKILLS[skillId];
    if (!baby || !syncSkillId) return;

    const syncSkill = this.SKILLS[syncSkillId];
    const isHealOrBuff = syncSkill && (syncSkill.tag === this.SKILL_TAGS['HEAL'] || syncSkill.tag === this.SKILL_TAGS['BUFF']);
    this.executeSkillAction(syncSkillId, baby, isHealOrBuff ? user : target, triggerDepth + 1);
  }

  executeSkillAction(skId: string | null, usr: Fighter, forcedTarget: Fighter | null = null, triggerDepth = 0): void {
    if (triggerDepth > 5 || !usr || usr.isDead || usr.isDeadAnnounced || usr.currentHp <= 0) return;

    const userTeamId = this.getTeamId(usr);
    let currentTargets = this.getSelectableTargets(usr);

    if (this.handleValorantPreFire(usr, userTeamId, currentTargets, triggerDepth)) return;

    if (usr.job === 'EXPLOSIVE_ANTI_CROC') {
      const crocTargets = currentTargets.filter((f) => f.isGacha);
      if (crocTargets.length > 0) currentTargets = crocTargets;
    }

    const targetSelection = this.resolveTarget(usr, forcedTarget, currentTargets);
    if (!targetSelection) return;
    let { target: tgt, isIntercepted } = targetSelection;

    const sk = this.resolveSkillDefinition(skId, usr);
    const formatText = (text: string): string => this.formatSkillText(sk, text);

    if (skId === 'bujin_chair' && !usr.isTokusatsu) {
      return this.log('info', `🪑 ${usr.name} 试图模仿刺猬人召唤【武神王座】，但由于缺乏特摄之魂，椅子刚落地就散架了！`);
    }

    if (sk.triggerAgain && triggerDepth === 0) {
      this.log('buff', formatText(sk.text ?? '').replace(/{USER}/g, usr.name));
      for (let i = 0; i < sk.triggerAgain; i++) this.executeSkillAction(skId, usr, null, triggerDepth + 1);
      return;
    }

    if (sk.isSummon) {
      this.executeSummonSkill(sk, usr, userTeamId);
      return;
    }

    const skillCtx = this.createSkillContext(usr, tgt, currentTargets, triggerDepth);
    if (sk.onExecute && sk.onExecute(skillCtx)) return;

    if (sk.tag !== this.SKILL_TAGS['HEAL'] && sk.tag !== this.SKILL_TAGS['BUFF'] && tgt.status.some((s) => s.type === 'SPELL_BLOCK')) {
      tgt.status = tgt.status.filter((s) => s.type !== 'SPELL_BLOCK');
      healFighter(tgt, Math.floor(tgt.maxHp * 0.15));
      return this.log('info', `🔵 庇护之音！林肯法球(或特种装甲)的光幕为 ${tgt.name} 挡下了 ${usr.name} 的攻击，并恢复了部分生命！`);
    }

    this.spreadDivaSupport(sk, usr, userTeamId);

    if (this.executeSupportSkill(sk, usr, forcedTarget, userTeamId)) return;

    if (this.missesSkill(usr, tgt, sk, isIntercepted)) {
      return this.log('info', `💨 ${usr.name} 的 ${sk.name ?? '攻击'} 被 ${tgt.name} 闪避了！`);
    }

    if (this.handleWaitCounter(tgt, usr, triggerDepth)) return;
    if (this.handleCounterStatus(tgt, usr)) return;

    if (this.breakAbsoluteDefense(skId, usr, tgt)) return;
    if (this.dodgesWithPassiveSkill(usr, tgt)) return;
    if (!this.canTouchDamagePlane(usr, tgt, sk)) return;

    const damageResult = this.calculateDamage(usr, tgt, sk, userTeamId, skId);
    let { dmg } = damageResult;
    const { logType, ignoreDefOverride, sexyTrueDamage } = damageResult;
    this.applySelfDamage(usr, sk);
    this.applyAttackerStyleEffects(usr, tgt);
    this.applySkillStatusEffect(sk, tgt);

    if (skId === 'suicide_bomb' && tgt.status.some((s) => s.type === 'LIQUID_BODY')) {
      dmg = Math.floor(dmg * 0.3);
      this.log('info', `💦 爆炸的冲击波被 ${tgt.name} 的液态身躯卸掉了大半伤害！`);
    }

    let preMitigationDmg = isIntercepted ? Math.floor(dmg * 0.5) : dmg;

    if (preMitigationDmg >= tgt.currentHp && tgt.job === 'GOD_SLIME') {
      const sonProtector = this.fighters.find((f) => f.isSon && this.isActiveCombatant(f) && this.getTeamId(f) === this.getTeamId(tgt) && f.id !== tgt.id);
      if (sonProtector) {
        this.log('info', `🛡️ 致命一击袭来！但在命中的瞬间，${tgt.name} 与【水人的好大儿】互换了位置！好大儿化作一滩清水替水神挡下了必杀！`);
        tgt = sonProtector;
        isIntercepted = true;
        preMitigationDmg = Math.floor(dmg * 0.5);
      }
    }

    skillCtx.target = tgt;
    const hpBeforeDamage = tgt.currentHp;

    if (isIntercepted) {
      this.log('info', `🛡️ 【援护】小汀(傀儡) 冲了出来，替宿主挡下了 ${usr.name} 的攻击！预计受到 ${preMitigationDmg} 点伤害！(减伤50%)`);
    } else {
      let msg = formatText(sk.text ?? '');
      if (sk.isRandomText && sk.pool) {
        const pool = sk.pool as string[];
        msg = msg.replace(/{JOKE}/g, pool[Math.floor(Math.random() * pool.length)]);
      }
      if (!msg.includes('{VAL}') && preMitigationDmg > 0 && sk.tag !== this.SKILL_TAGS['BUFF'] && sk.tag !== this.SKILL_TAGS['HEAL']) {
        msg += ` (造成 {VAL} 点伤害)`;
      }
      this.log(logType, (logType === 'crit' ? '💥 暴击！' : '') + msg.replace(/{USER}/g, usr.name).replace(/{TARGET}/g, tgt.name).replace(/{VAL}/g, String(preMitigationDmg)));
    }

    const actualDmg = this.applyDamage(tgt, preMitigationDmg, 'skill', !!ignoreDefOverride || sexyTrueDamage);

    this.handleValorantWeaponDrop(tgt, actualDmg);
    this.handlePhysicalCounterReflect(sk, usr, tgt, actualDmg);
    this.consumeAimAfterAttack(usr, sk);

    usr.stats.dmgDealt += actualDmg;
    this.handlePrimaryTargetDefeat(usr, tgt);

    this.applyLifestealEffects(usr, sk, actualDmg, hpBeforeDamage);
    this.triggerSuccubusBabyFollowup(usr, tgt, skId, userTeamId, triggerDepth);

    // Transformation check fires immediately after damage so HP is restored at once
    this.handleTransformations(tgt);
    this.handleTransformations(usr);
    if (sk.afterExecute) sk.afterExecute(skillCtx, actualDmg, hpBeforeDamage);
  }

  handleDeathsAndRevives(spinalSwordRef: SpinalSwordRef): void {
    for (const f of this.fighters) {
      if ((f.currentHp <= 0 || f.isDeadAnnounced) && !f.isDead) {
        this.finalizeFighterDeath(f, spinalSwordRef);
      }

      if (f.isDead && f.isJoker && !f.hasResurrected && (f.reviveTurns ?? 0) > 0) {
        const myTeamId = this.getTeamId(f);
        const hasTeammates = this.fighters.some((other) => other.id !== f.id && this.getTeamId(other) === myTeamId);
        const livingFighters = this.fighters.filter((other) => this.isActiveCombatant(other));
        let forceRevive = false;

        if (hasTeammates) {
          if (!livingFighters.some((ally) => ally.id !== f.id && this.getTeamId(ally) === myTeamId)) {
            forceRevive = true;
            this.log('info', `⚠️ 己方全灭，${f.name} 提前结束读秒，强制返场！`);
          }
        } else {
          if (new Set(livingFighters.map((e) => this.getTeamId(e))).size <= 1) {
            forceRevive = true;
            this.log('info', `⚠️ 场上只剩最终的赢家，独狼 ${f.name} 决定现在登场截胡！`);
          }
        }

        f.reviveTurns = forceRevive ? 0 : (f.reviveTurns ?? 0) - 1;
        if ((f.reviveTurns ?? 0) <= 0) {
          f.isDead = false; f.hasResurrected = true; f.isDeadAnnounced = false;
          const GOD_OF_TROLLS = this.JOBS['GOD_OF_TROLLS'];
          if (GOD_OF_TROLLS) {
            f.jobData = cloneJobDefinition(GOD_OF_TROLLS);
            f.job = 'GOD_OF_TROLLS';
            f.maxHp = Math.floor(f.maxHp * 1.5); f.currentHp = f.maxHp; f.spd = 150;
            f.atk = Math.max(100, f.atk * 2); f.def = Math.max(80, f.def * 2); f.res = Math.max(150, f.res * 2);
            f.mag = Math.max(220, f.mag * 3); f.agl = Math.max(250, f.agl * 3); f.wis = Math.max(200, f.wis * 3);
          } else {
            f.currentHp = f.maxHp;
          }
          this.syncHpPct(f); f.status = [];
          this.log('win', `🤡 ${f.name} 从地狱归来！转职为【${GOD_OF_TROLLS ? GOD_OF_TROLLS.name : '乐子人'}】！\n"接下来，是我的谢幕演出！"`);

          const enemies = this.fighters.filter((e) => this.isActiveCombatant(e) && this.getTeamId(e) !== myTeamId);
          if (enemies.length > 0) {
            const aoeDmg = Math.floor(f.mag * 2.0);
            this.log('skill', `💥 【谢幕返场】${f.name} 的地狱笑话对全场敌人造成了 ${aoeDmg} 点魔法伤害，并施加了【混乱】！`);
            enemies.forEach((e) => {
              this.applyDamage(e, Math.max(1, aoeDmg - Math.floor(e.res * 0.5)), 'skill');
              if (e.currentHp <= 0 && !e.isDead) {
                this.finalizeFighterDeath(e, spinalSwordRef, `💀 【击杀】${e.name} 被地狱笑话震死了！`, f);
              }
              if (this.isActiveCombatant(e)) {
                e.status.push({ type: 'CONFUSED', duration: 1 });
              }
            });
          }
        }
      }
      this.syncHpPct(f);
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
    }
    this.fighters.forEach((f) => {
      this.syncSpinalSwordState(f);
      this.syncPuppetMasterStatus(f);
      this.syncHpPct(f);
    });
    this.resolveSlackingReentry();
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
      if (actor.status.some((s) => s.type === 'SYNERGY_SLACKING')) {
        this.log('info', `⛺ ${actor.name} 正在场外OB摸鱼，暂时不参与战斗！`);
        this.finishStep(spinalSwordRef);
        return false;
      }
      // Bug 7 fix: find the actual blocking status, not just status[0]
      const blockingStatus = actor.status.find((s) =>
        isStatusType(s.type, CONTROL_STATUS_TYPES),
      );
      if (blockingStatus) {
        this.log('info', `💫 ${actor.name} 处于【${this.STATUS_EFFECTS[blockingStatus.type]?.name ?? blockingStatus.type}】状态，无法行动！`);
      }
      this.finishStep(spinalSwordRef);
      return false;
    }

    const waitingCounter = actor.status.find((s) => s.type === 'WAIT_COUNTER' || (s.type.startsWith('CTR_') && !this.isPassiveCharmCounter(actor, s.type)));
    if (waitingCounter) {
      this.log('info', `🛡️ ${actor.name} 保持【${this.STATUS_EFFECTS[waitingCounter.type]?.name ?? waitingCounter.type}】姿态，等待对手出手！`);
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
