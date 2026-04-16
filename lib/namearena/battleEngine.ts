import type {
  Fighter,
  JobDefinition,
  SkillDefinition,
  SkillContext,
  GachaEntry,
  StatKey,
  SpinalSwordRef,
  BattleEngineData,
  BattleEngineCore,
  StatusEffectsMap,
} from './types';

export class BattleEngine {
  fighters: Fighter[];
  addLogCallback: (e: { type: string; text: string }) => void;
  JOBS: Partial<Record<string, JobDefinition>>;
  SKILLS: Record<string, SkillDefinition>;
  Data: BattleEngineData;
  Core: BattleEngineCore;
  STATUS_EFFECTS: StatusEffectsMap;
  SKILL_TAGS: Record<string, string>;

  constructor(
    fighters: Fighter[],
    addLogCallback: (e: { type: string; text: string }) => void,
    JOBS: Partial<Record<string, JobDefinition>>,
    SKILLS: Record<string, SkillDefinition>,
    Data: BattleEngineData,
    Core: BattleEngineCore,
  ) {
    this.fighters = fighters;
    this.addLogCallback = addLogCallback;
    this.JOBS = JOBS;
    this.SKILLS = SKILLS;
    this.Data = Data;
    this.Core = Core;
    this.STATUS_EFFECTS = Data.STATUS_EFFECTS ?? {};
    this.SKILL_TAGS = Data.SKILL_TAGS ?? {};
  }

  log(type: string, text: string): void {
    this.addLogCallback({ type, text });
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
    void source;
    if (amount <= 0) return 0;

    if (target.jobData?.name === '欧皇' && !isTrueDamage) amount = Math.floor(amount * 0.6);

    const isProtected =
      target.isMorphling || target.isJoker || target.isTokusatsu || target.isGacha ||
      target.isTing || target.isSuccubus || target.isSigua || target.isTuJuanJuan || target.isWT;
    if (isProtected && !target.transformed && amount >= target.currentHp) {
      amount = target.currentHp - 1;
      this.log('info', `🛡️ ${target.name} 触发了锁血保护，强制保留最后 1 点生命！`);
    }

    if (target.job === 'GOD_OF_TROLLS' && amount > 0 && Math.random() < 0.40) {
      if (target.status.some((s) => s.type === 'WATER_PRISON')) {
        this.log('info', `💧 ${target.name} 被困在深渊水牢中，无法施展魔术转移伤害，必须硬吃！`);
      } else {
        const originalAmount = amount;
        amount = 0;
        const myTeamId = this.getTeamId(target);
        const enemies = this.fighters.filter((f) => !f.isDead && f.id !== target.id && this.getTeamId(f) !== myTeamId);
        if (enemies.length > 0) {
          const victim = enemies[Math.floor(Math.random() * enemies.length)];
          this.log('crit', `🎭 【随机恶作剧】${target.name} 施展魔术完美闪避！并将伤害转移给了无辜的 ${victim.name}！`);
          this.applyDamage(victim, originalAmount, 'transfer', isTrueDamage);
        } else {
          this.log('info', `🎭 【随机恶作剧】${target.name} 像个泥鳅一样躲开了 ${originalAmount} 点伤害！`);
        }
      }
    }

    target.currentHp -= amount;
    target.stats.dmgTaken += amount;
    if (amount > 0) {
      target.isHit = true;
      // Check transformation immediately after every damage application so it fires
      // regardless of which code path (onExecute skill, counter, reflect, DoT, etc.) caused the damage.
      this.handleTransformations(target);
    }
    return amount;
  }

  checkWinCondition(alive: Fighter[]): boolean {
    const activeTeams = new Set(alive.map((f) => this.getTeamId(f)));
    let preventEnd = false;

    for (const f of this.fighters) {
      if (f.isDead && f.isJoker && !f.hasResurrected) {
        const myTeamId = this.getTeamId(f);
        const hasTeammates = this.fighters.some((other) => other.id !== f.id && this.getTeamId(other) === myTeamId);
        if (hasTeammates) {
          if (!alive.some((ally) => this.getTeamId(ally) === myTeamId)) preventEnd = true;
        } else {
          if (activeTeams.size <= 1) preventEnd = true;
        }
      }
    }

    if (activeTeams.size <= 1 && !preventEnd) {
      const winners = alive.map((f) => f.name).join(' & ');
      const winTeam = alive.length > 0 ? (alive[0].teamId ? `【${alive[0].teamId}】` : '') : '';
      this.log('win', `🏆 最终胜者：${winTeam} ${winners || '无（同归于尽）'}！`);
      return true;
    }
    return false;
  }

  determineActor(alive: Fighter[]): Fighter | null {
    if (alive.length === 0) return null;
    let ticket = Math.random() * alive.reduce((sum, f) => sum + f.spd, 0);
    for (const f of alive) {
      ticket -= f.spd;
      if (ticket <= 0) return f;
    }
    return alive[0];
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
      if (jobData) tgt.jobData = JSON.parse(JSON.stringify(jobData)) as JobDefinition;
      tgt.job = jobKey;
      buffFn();
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
      const crocExists = this.fighters.some((f) => f.isGacha && !f.isDead);
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
      const claire = this.fighters.find((f) => f.isSuccubus && !f.isDead && this.getTeamId(f) === this.getTeamId(tgt));
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

    const CONTROL_TYPES = ['STUN', 'FREEZE', 'CONFUSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING'];

    actor.status.forEach((s) => {
      if (CONTROL_TYPES.includes(s.type)) canAct = false;
      if (['POISON', 'BURN', 'WATER_PRISON'].includes(s.type)) {
        const dmgAmt = s.type === 'WATER_PRISON' ? Math.floor(actor.maxHp * 0.08) : Math.floor(actor.maxHp * 0.05);
        this.log('poison', `${this.STATUS_EFFECTS[s.type]?.icon ?? ''} ${actor.name} ${s.type === 'WATER_PRISON' ? '在深渊水牢中窒息' : '受到持续伤害'}，损失 ${dmgAmt} 点生命`);
        this.applyDamage(actor, dmgAmt, 'status', true);
        if (actor.currentHp <= 0 && !actor.isDeadAnnounced && !actor.isDead) {
          this.log('death', `💀 ${actor.name} 因${s.type === 'WATER_PRISON' ? '窒息' : '状态伤害'}而痛苦地倒下了！`);
          actor.isDeadAnnounced = true;
        }
      }
      if (['PLUG_HEART', 'REGEN', 'STYLE_FAMILY'].includes(s.type) && actor.currentHp < actor.maxHp) {
        if (actor.status.some((x) => x.type === 'NO_HEAL')) {
          this.log('info', `🥀 ${actor.name} 处于禁疗状态，无法自动回复生命！`);
        } else {
          const heal = Math.floor(actor.maxHp * 0.05);
          actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
          this.log('heal', `${this.STATUS_EFFECTS[s.type]?.icon ?? ''} ${actor.name} 自动回复了 ${heal} 点生命`);
        }
      }
      if (s.duration > 1) {
        newStatus.push({ ...s, duration: s.duration - 1 });
      } else if (s.duration <= 1 && s.type === 'ZEROED' && actor.baseStatsForZero) {
        actor.atk = actor.baseStatsForZero.atk;
        actor.def = actor.baseStatsForZero.def;
        actor.res = actor.baseStatsForZero.res;
        delete actor.baseStatsForZero;
        actor.wasZeroed = false; // Bug 2 fix: clear flag so interceptor doesn't double-log
        this.log('info', `🧮 ${actor.name} 的【归零】状态结束，被降维的属性恢复了！`);
      }
    });
    actor.status = newStatus;

    // Bug 8 fix: STYLE_FOOL grants immunity to control — strip any control that got applied
    if (actor.status.some((s) => s.type === 'STYLE_FOOL') && !canAct) {
      const hadControl = actor.status.some((s) => CONTROL_TYPES.includes(s.type));
      if (hadControl) {
        actor.status = actor.status.filter((s) => !CONTROL_TYPES.includes(s.type));
        canAct = true;
        this.log('info', `🤪 ${actor.name} 笨蛋女人的混沌之力让她对控制免疫，懵懵懂懂地无视了异常状态！`);
      }
    }

    if (actor.jobData?.name === '欧皇' && !canAct && Math.random() < 0.8) {
      canAct = true;
      actor.status = actor.status.filter((s) => !CONTROL_TYPES.includes(s.type));
      this.log('buff', `👑 ${actor.name} 发动了钞能力！解除了控制状态！`);
    }
    return canAct;
  }

  handleSpinalSwordDrop(actor: Fighter, spinalSwordRef: SpinalSwordRef): void {
    if (spinalSwordRef.current && !actor.isTing && !actor.hasSpinalSword) {
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
    if (actor.hasSpinalSword && !actor.status.some((s) => s.type === 'SPINAL_SWORD')) {
      actor.hasSpinalSword = false;
      this.log('info', `🦴 ${actor.name} 手中的脊髓剑碎裂了...`);
    }
  }

  selectSkill(actor: Fighter): string | null {
    if ((actor.isSigua || actor.isTuJuanJuan) && !actor.hasTriggeredSlacking && !actor.status.some((s) => s.type === 'SYNERGY_SLACKING')) {
      const isSigua = (f: Fighter) => f.isSigua || f.job === 'VIRTUAL_DIVA' || f.job === 'VALO_JUNIOR' || f.job === 'MY_BABY' || f.name.includes('丝瓜');
      const isBunny = (f: Fighter) => f.isTuJuanJuan || f.job === 'Q_BUNNY' || f.job === 'VERSATILE_RABBIT' || f.name.includes('兔卷卷') || f.name.includes('curly');
      const meSigua = isSigua(actor);
      const partner = this.fighters.find(
        (f) => f.id !== actor.id && !f.isDead && !f.hasTriggeredSlacking &&
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
        if (!this.fighters.some((f) => f.name === '小汀(傀儡)' && !f.isDead && f.summonerId === actor.id) && Math.random() < (actor.isGacha ? 0.3 : 0.1)) return 'summon_puppet_ting';
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
      const jobSkills = actor.jobData.skills ?? [];
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

  executeSkillAction(skId: string | null, usr: Fighter, forcedTarget: Fighter | null = null, triggerDepth = 0): void {
    if (triggerDepth > 5 || !usr || usr.isDead) return;

    const userTeamId = this.getTeamId(usr);
    let currentTargets = this.fighters.filter(
      (f) => !f.isDead && f.id !== usr.id && this.getTeamId(f) !== userTeamId && !f.status.some((s) => s.type === 'SYNERGY_SLACKING'),
    );

    if (triggerDepth === 0 && usr.job !== 'VALO_JUNIOR' && currentTargets.length > 0) {
      const preFirer = this.fighters.find(
        (f) => !f.isDead && this.getTeamId(f) !== userTeamId && f.job === 'VALO_JUNIOR' && f.status.some((s) => s.type === 'VALO_HOLDING_ANGLE'),
      );
      if (preFirer) {
        if (usr.status.some((s) => s.type === 'LIQUID_BODY')) {
          this.log('skill', `💧 瓦学妹的提前枪精准命中了 ${usr.name}，但子弹仅仅是穿过了水流！攻击并未被截停！`);
          preFirer.status = preFirer.status.filter((s) => s.type !== 'VALO_HOLDING_ANGLE');
        } else {
          this.log('skill', `🔭 【受击截停】${preFirer.name} 提前预瞄了 ${usr.name} 的位置，强制先手开火拦截！`);
          preFirer.status = preFirer.status.filter((s) => s.type !== 'VALO_HOLDING_ANGLE');
          this.executeSkillAction('valo_pre_fire', preFirer, usr, triggerDepth + 1);
          if (usr.isDead || usr.status.some((s) => s.type === 'VALO_AIM_PUNCH')) {
            return this.log('info', `🎯 ${usr.name} 被提前枪截停（Aim Punch），原有的攻击动作被打断！`);
          }
        }
      }
    }

    if (usr.job === 'EXPLOSIVE_ANTI_CROC') {
      const crocTargets = currentTargets.filter((f) => f.isGacha);
      if (crocTargets.length > 0) currentTargets = crocTargets;
    }

    if (currentTargets.length === 0) return;
    let tgt = forcedTarget ?? currentTargets[Math.floor(Math.random() * currentTargets.length)];
    let isIntercepted = false;
    const protector = this.fighters.find((f) => f.isSummon && f.summonerId === tgt.id && f.name === '小汀(傀儡)' && !f.isDead);
    if (protector && protector.id !== usr.id) { tgt = protector; isIntercepted = true; }
    if (!tgt || tgt.isDead || tgt.id === usr.id) return;

    // Resolve skill definition
    let sk: SkillDefinition | null = (skId ? this.SKILLS[skId] : undefined) ??
      (usr.hasSpinalSword
        ? this.SKILLS['spinal_slash'] ?? { name: '脊髓剑·斩', tag: this.SKILL_TAGS['PHYS'] as SkillDefinition['tag'], mult: 2.5, text: '🩸 {USER} 挥舞脊髓剑劈向 {TARGET}，造成 {VAL} 点伤害！' }
        : null);

    if (skId === 'chimera_install' && sk?.pool) {
      const installedPlugs = usr.status.filter((s) => s.type.startsWith('PLUG_')).map((s) => s.type);
      const gachaPool = sk.pool as GachaEntry[];
      const availablePlugs = gachaPool.filter((p) => !installedPlugs.includes(p.status ?? ''));
      if (availablePlugs.length > 0) sk = { ...sk, pool: availablePlugs };
      else { usr.jobData.skills = usr.jobData.skills.filter((s) => s !== 'chimera_install'); sk = null; }
    }

    if (!sk) {
      sk = (usr.mag > usr.atk && Math.random() < (0.5 + usr.wis * 0.002))
        ? { name: '魔力攻击', tag: 'magical', mult: 1.0, text: '{USER} 凝聚魔力攻击 {TARGET}，造成 {VAL} 魔法伤害。' }
        : { name: '普通攻击', tag: 'physical', mult: 1.0, text: '{USER} 攻击了 {TARGET}，造成 {VAL} 伤害。' };
    }

    if (sk.isGacha && sk.pool) {
      const exodiaChance = usr.jobData?.name === '欧皇' ? 0.05 : 0.006;
      const pool = sk.pool as GachaEntry[];
      if (pool === this.Data.GACHA_SSR_POOL && Math.random() < exodiaChance) {
        sk = { ...sk, ...this.Data.EXODIA_CARD };
        this.log('win', `👑 欧皇时刻！${usr.name} 触发了 5% 的保底机制！`);
      } else {
        sk = { ...sk, ...pool[Math.floor(Math.random() * pool.length)] };
      }
    }

    const formatText = (text: string): string => {
      if (sk!.name && sk!.name !== '普通攻击' && sk!.name !== '魔力攻击' && text && !text.includes('【')) {
        return text.replace('{USER}', `【${sk!.name}】{USER}`);
      }
      return text;
    };

    if (sk.status === 'WAIT_COUNTER' && !usr.isTokusatsu) {
      return this.log('info', `🪑 ${usr.name} 试图模仿刺猬人召唤【武神王座】，但由于缺乏特摄之魂，椅子刚落地就散架了！`);
    }

    if (sk.triggerAgain && triggerDepth === 0) {
      this.log('buff', formatText(sk.text ?? '').replace(/{USER}/g, usr.name));
      for (let i = 0; i < sk.triggerAgain; i++) this.executeSkillAction(skId, usr, null, triggerDepth + 1);
      return;
    }

    if (sk.isSummon) {
      if ((sk.unique || sk.summonName === '黑暗大法师') && this.fighters.some((f) => f.name === sk!.summonName && !f.isDead)) {
        return this.log('info', `🚫 场上已经存在 ${sk.summonName}，无法重复召唤！`);
      }
      if ((sk.tributes ?? 0) > 0) {
        const potentialTributes = this.fighters.filter(
          (f) => f.isSummon && !f.isDead && f.name !== '黑暗大法师' && (sk!.summonName !== '青眼白龙' || f.name !== '翼神龙'),
        );
        if (potentialTributes.length < (sk.tributes ?? 0)) return this.log('info', `🚫 ${usr.name} 试图召唤 ${sk.summonName}，但场上祭品不足！`);
        const sacrificed = potentialTributes.sort(() => 0.5 - Math.random()).slice(0, sk.tributes);
        sacrificed.forEach((v) => { v.currentHp = 0; v.isDeadAnnounced = true; v.isDead = true; });
        this.log('death', `💀 献祭！${sacrificed.map((f) => f.name).join('、')} 化为了召唤 ${sk.summonName} 的祭品！`);
      }
      if (sk.summonName === '小汀(傀儡)') {
        if (this.fighters.some((f) => f.isTing && !f.isDead)) {
          usr.jobData.skills = usr.jobData.skills.filter((s) => s !== 'summon_puppet_ting');
          return this.log('info', `🚫 ${usr.name} 试图唤醒脊髓剑怨念，但感应到小汀本体尚存...`);
        }
        if (this.fighters.some((f) => f.name === '小汀(傀儡)' && !f.isDead && f.summonerId === usr.id)) return;
      }

      const summonJobKey = sk.summonJob ?? 'WARRIOR';
      const sJob = (this.JOBS[summonJobKey] ?? this.JOBS['WARRIOR'])!;
      const summonName = sk.summonName ?? '召唤物';
      this.fighters.push({
        id: this.Core.generateUUID ? this.Core.generateUUID() : `summon-${Math.random()}`,
        name: summonName,
        displayName: summonName,
        job: summonJobKey,
        jobData: JSON.parse(JSON.stringify(sJob)) as JobDefinition,
        maxHp: sk.stats?.hp ?? 2000, currentHp: sk.stats?.hp ?? 2000, hpPct: 1.0,
        atk: sk.stats?.atk ?? 200, def: sk.stats?.def ?? 100, spd: sk.stats?.spd ?? 120,
        agl: sk.stats?.agl ?? 100, mag: sk.stats?.mag ?? 100, res: sk.stats?.res ?? 100,
        wis: sk.stats?.wis ?? 100, critRate: 0.1,
        color: usr.color, isDead: false, isDeadAnnounced: false,
        status: [], stats: { kills: 0, dmgDealt: 0, dmgTaken: 0 },
        summonerId: usr.id, isSummon: true,
      });
      return this.log('skill', formatText(sk.text ?? '').replace(/{USER}/g, usr.name));
    }

    const skillCtx: SkillContext = {
      user: usr, target: tgt, currentTargets, fighters: this.fighters,
      setLogs: () => {},
      log: (type, text) => this.log(type, text),
      getTeamId: (f) => this.getTeamId(f),
      applyDamage: (t, a, s, trueDmg) => this.applyDamage(t, a, s, trueDmg),
      triggerDepth,
      executeSkillAction: (id, u, t, d) => this.executeSkillAction(id, u, t, d),
      STATUS_EFFECTS: this.STATUS_EFFECTS,
    };
    if (sk.onExecute && sk.onExecute(skillCtx)) return;

    if (sk.tag !== this.SKILL_TAGS['HEAL'] && sk.tag !== this.SKILL_TAGS['BUFF'] && tgt.status.some((s) => s.type === 'SPELL_BLOCK')) {
      tgt.status = tgt.status.filter((s) => s.type !== 'SPELL_BLOCK');
      tgt.currentHp = Math.min(tgt.maxHp, tgt.currentHp + Math.floor(tgt.maxHp * 0.15));
      return this.log('info', `🔵 庇护之音！林肯法球(或特种装甲)的光幕为 ${tgt.name} 挡下了 ${usr.name} 的攻击，并恢复了部分生命！`);
    }

    if (usr.job === 'VIRTUAL_DIVA' && (sk.tag === this.SKILL_TAGS['BUFF'] || sk.tag === this.SKILL_TAGS['HEAL'])) {
      const teammates = this.fighters.filter((f) => !f.isDead && f.id !== usr.id && this.getTeamId(f) === userTeamId);
      teammates.forEach((mate) => {
        if (sk!.tag === this.SKILL_TAGS['HEAL']) {
          if (!mate.status.some((s) => s.type === 'NO_HEAL')) {
            mate.currentHp = Math.min(mate.maxHp, mate.currentHp + Math.floor(Math.max(usr.atk, usr.mag) * (sk!.mult ?? 1)));
          }
        }
        if (sk!.tag === this.SKILL_TAGS['BUFF']) {
          if (sk!.status) mate.status.push({ type: sk!.status, duration: sk!.status === 'INVUL' ? 1 : 3 });
          if (sk!.statBuff) {
            const buff = sk!.statBuff;
            (Object.keys(buff) as (StatKey | 'crit')[]).forEach((k) => {
              if (k !== 'crit' && mate[k] !== undefined) mate[k] = Math.floor(mate[k] * (buff[k as StatKey] ?? 1));
            });
          }
        }
        if (sk!.cleanStatus) mate.status = mate.status.filter((s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF'].includes(s.type));
      });
      if (teammates.length > 0) this.log('buff', `🎵 歌姬的光环！${usr.name} 的技能效果同步给了 ${teammates.length} 名队友！`);
    }

    if (sk.tag === this.SKILL_TAGS['HEAL'] || sk.tag === this.SKILL_TAGS['BUFF']) {
      let targetForBuff = (forcedTarget && this.getTeamId(forcedTarget) === userTeamId) ? forcedTarget : usr;
      if (usr.job === 'MY_BABY') {
        targetForBuff = this.fighters.find((f) => f.isSuccubus && !f.isDead && this.getTeamId(f) === userTeamId) ?? targetForBuff;
      }

      if (sk.tag === this.SKILL_TAGS['HEAL']) {
        if (targetForBuff.status.some((s) => s.type === 'NO_HEAL')) {
          return this.log('info', `🥀 ${targetForBuff.name} 处于禁疗状态，无法接受治疗！`);
        }
        const heal = Math.floor(Math.max(usr.atk, usr.mag) * (sk.mult ?? 1));
        targetForBuff.currentHp = Math.min(targetForBuff.maxHp, targetForBuff.currentHp + heal);
        if (sk.cleanStatus) targetForBuff.status = targetForBuff.status.filter((s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF'].includes(s.type));
        let hMsg = formatText(sk.text ?? '');
        if (!hMsg.includes('{VAL}')) hMsg += ` (恢复 {VAL} 点生命)`;
        return this.log('heal', hMsg.replace(/{USER}/g, usr.name).replace(/{TARGET}/g, targetForBuff.name).replace(/{VAL}/g, String(heal)));
      }

      if (sk.tag === this.SKILL_TAGS['BUFF']) {
        if (sk.status) {
          let duration = sk.status === 'INVUL' ? 1 : (sk.status.startsWith('CTR_') ? 5 : 3);
          if (sk.status.startsWith('CTR_')) targetForBuff.status = targetForBuff.status.filter((s) => !s.type.startsWith('CTR_'));
          if (sk.status.startsWith('PLUG_')) {
            if (sk.statBuff) {
              const buff = sk.statBuff;
              (Object.keys(buff) as (StatKey | 'crit')[]).forEach((k) => {
                if (k !== 'crit' && targetForBuff[k] !== undefined) {
                  targetForBuff[k] = Math.floor(targetForBuff[k] * (buff[k as StatKey] ?? 1));
                } else if (k === 'crit') {
                  targetForBuff.critRate += buff.crit ?? 0;
                }
              });
            }
            if (sk.newSkill && !targetForBuff.jobData.skills.includes(sk.newSkill)) {
              targetForBuff.jobData.skills.push(sk.newSkill);
              const currentPlugCount = targetForBuff.status.filter((s) => s.type.startsWith('PLUG_')).length;
              if (currentPlugCount >= 7 && !targetForBuff.hasUltimateEvolved) {
                targetForBuff.hasUltimateEvolved = true;
                targetForBuff.jobData.skills = targetForBuff.jobData.skills.filter((s) => s !== 'chimera_install' && s !== 'chimera_strike');
                targetForBuff.atk = Math.floor(targetForBuff.atk * 3.0);
                targetForBuff.mag = Math.floor(targetForBuff.mag * 3.0);
                targetForBuff.def = Math.floor(targetForBuff.def * 2.0);
                targetForBuff.res = Math.floor(targetForBuff.res * 2.0);
                targetForBuff.spd = Math.floor(targetForBuff.spd * 1.5);
                targetForBuff.maxHp = Math.floor(targetForBuff.maxHp * 1.8);
                targetForBuff.currentHp = targetForBuff.maxHp;
                this.log('win', `🧬 警告！${targetForBuff.name} 已完成究极进化！全插件安装完毕！\n封印解除，全属性引发恐怖的裂变！化身为最高级别的神级灾厄！`);
              }
            }
            duration = 999;
          }
          targetForBuff.status.push({ type: sk.status, duration });
        }
        // Bug 1 fix: apply statBuff for all non-PLUG_ statuses (PLUG_ already handled above)
        if (sk.statBuff && !sk.status?.startsWith('PLUG_')) {
          const buff = sk.statBuff;
          (Object.keys(buff) as (StatKey | 'crit')[]).forEach((k) => {
            if (k !== 'crit' && targetForBuff[k] !== undefined) {
              targetForBuff[k] = Math.floor(targetForBuff[k] * (buff[k as StatKey] ?? 1));
            } else if (k === 'crit') {
              targetForBuff.critRate += buff.crit ?? 0;
            }
          });
        }
        if (sk.cleanStatus) targetForBuff.status = targetForBuff.status.filter((s) => !['STUN', 'FREEZE', 'BURN', 'POISON', 'BLIND', 'SILENCE', 'CONFUSED', 'CHARMED', 'VALO_FLASH', 'VALO_AIM_PUNCH', 'NEURAL_THEFT_DEBUFF'].includes(s.type));
        return this.log('buff', formatText(sk.text ?? '').replace(/{USER}/g, usr.name).replace(/{TARGET}/g, targetForBuff.name));
      }
    }

    const userAgl = usr.status.some((s) => s.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(usr.agl * 1.2) : usr.agl;
    const targetAgl = tgt.status.some((s) => s.type === 'Q_BUNNY_IDOL_AGL') ? Math.floor(tgt.agl * 1.2) : tgt.agl;
    let hitChance = 0.95 + (userAgl - targetAgl) * 0.005;
    if (usr.status.some((s) => s.type === 'AIM') || isIntercepted || tgt.status.some((s) => s.type === 'NEURAL_THEFT_DEBUFF') || sk.alwaysHit || sk.isGacha) hitChance = 10.0;
    if (usr.status.some((s) => s.type === 'VALO_AIM_PUNCH')) hitChance -= 0.8;

    if (Math.random() > hitChance && !sk.ignoreDef) {
      return this.log('info', `💨 ${usr.name} 的 ${sk.name ?? '攻击'} 被 ${tgt.name} 闪避了！`);
    }

    if (tgt.status.some((s) => s.type === 'WAIT_COUNTER') && !tgt.counterUsed) {
      tgt.status = tgt.status.filter((s) => s.type !== 'WAIT_COUNTER');
      tgt.counterUsed = true;
      if (tgt.isTokusatsu) {
        const MIRACLE_MONSTER = this.JOBS['MIRACLE_MONSTER_BUJIN'];
        tgt.savedStats = { atk: tgt.atk, def: tgt.def, spd: tgt.spd, agl: tgt.agl, mag: tgt.mag, res: tgt.res, wis: tgt.wis };
        tgt.atk = Math.floor(tgt.atk * 2.5); tgt.def = Math.floor(tgt.def * 2.0); tgt.mag = Math.floor(tgt.mag * 2.0); tgt.spd = Math.floor(tgt.spd * 1.5);
        if (MIRACLE_MONSTER) tgt.jobData = JSON.parse(JSON.stringify(MIRACLE_MONSTER)) as JobDefinition;
        tgt.monsterTurns = 6;
        this.log('win', `🦖 ${tgt.name} 受到攻击，触发反击！\n"DUAL ON！GREAT！MONSTER！Ready Fight."\n数值暴涨！变身【奇迹怪兽武刃】！`);
        this.log('info', `🚫 ${usr.name} 的攻击被 ${tgt.name} 的怪兽形态打断了！`);
        return this.executeSkillAction('great_monster_victory', tgt, usr, triggerDepth + 1);
      } else {
        this.log('win', `🪑 ${tgt.name} 从借来的椅子上跃起，触发了等待反击！`);
        this.log('info', `🚫 ${usr.name} 的攻击被打断了！`);
        const counterDmg = Math.floor(tgt.atk * 2.0);
        this.applyDamage(usr, counterDmg, 'counter');
        this.log('crit', `💥 强力反击！${tgt.name} 对 ${usr.name} 造成了 ${counterDmg} 点伤害！`);
        if (usr.currentHp <= 0 && !usr.isDeadAnnounced && !usr.isDead) {
          this.log('death', `💀 ${usr.name} 承受不住反击的威力，被直接击杀了！`);
          usr.isDeadAnnounced = true;
          tgt.stats.kills += 1;
        }
        return;
      }
    }

    const sCounter = tgt.status.find((s) => s.type.startsWith('CTR_'));
    if (sCounter) {
      const tType = sCounter.type;
      const triggerChance = tType === 'CTR_CHARM' ? 0.5 : 1.0;
      if (Math.random() <= triggerChance) {
        this.log('skill', `😈 ${tgt.name} 触发了【${this.STATUS_EFFECTS[tType]?.name ?? tType}】！`);
        if (!tgt.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR')) {
          tgt.status = tgt.status.filter((s) => s !== sCounter);
        }
        if (tType === 'CTR_CHARM') { usr.status.push({ type: 'CHARMED', duration: 2 }); return this.log('info', `😍 ${usr.name} 被魅惑了，停止了攻击！`); }
        if (tType === 'CTR_STUN') { usr.status.push({ type: 'STUN', duration: 2 }); return this.log('info', `💫 ${usr.name} 被震慑眩晕，攻击中断！`); }
        if (tType === 'CTR_DRAIN') {
          this.log('heal', `🧛 ${tgt.name} 发动反击，试图吸取 ${usr.name} 300 点生命！`);
          const drain = this.applyDamage(usr, 300, 'counter', true);
          tgt.currentHp = Math.min(tgt.maxHp, tgt.currentHp + drain);
          if (usr.currentHp <= 0 && !usr.isDeadAnnounced && !usr.isDead) {
            this.log('death', `💀 ${usr.name} 被吸干了生命！`);
            usr.isDeadAnnounced = true; tgt.stats.kills += 1;
          }
        }
        if (tType === 'CTR_POISON') usr.status.push({ type: 'POISON', duration: 5 });
        if (tType === 'CTR_BURN') usr.status.push({ type: 'BURN', duration: 5 });
        if (tType === 'CTR_FREEZE') { usr.status.push({ type: 'FREEZE', duration: 2 }); return; }
        if (tType === 'CTR_VOID') {
          this.log('crit', `🌌 虚空反击陷阱启动！试图吞噬 ${usr.name}，造成 500 真实伤害！`);
          this.applyDamage(usr, 500, 'counter', true);
          if (usr.currentHp <= 0 && !usr.isDeadAnnounced && !usr.isDead) {
            this.log('death', `💀 ${usr.name} 跌入了虚空被粉碎！`);
            usr.isDeadAnnounced = true; tgt.stats.kills += 1;
          }
        }
        if (tType === 'CTR_WEAK') { usr.atk = Math.floor(usr.atk * 0.5); this.log('info', `📉 ${usr.name} 的攻击力大幅下降！`); }
        if (tType === 'CTR_CONFUSE') { usr.status.push({ type: 'CONFUSED', duration: 3 }); return; }
        if (tType === 'CTR_EXECUTE') {
          if (usr.hpPct < 0.4) {
            usr.currentHp = 0; usr.isDeadAnnounced = true; tgt.stats.kills += 1;
            return this.log('death', `☠️ 断头台落下！${usr.name} 被直接处决！`);
          } else {
            this.log('info', `☠️ ${usr.name} 生命值尚高，逃过一劫！`);
          }
        }
      } else {
        if (!tgt.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR')) {
          tgt.status = tgt.status.filter((s) => s !== sCounter);
        }
      }
    }

    if (skId === 'cosmic_slap' && tgt.status.some((s) => s.type === 'INVUL' || s.type === 'BKB')) {
      tgt.status = tgt.status.filter((s) => s.type !== 'INVUL' && s.type !== 'BKB');
      this.log('skill', `🌌 所谓绝对防御，在神明眼中不过是层薄纸！${usr.name} 强行捏碎了 ${tgt.name} 的无敌/金身！`);
    }
    if (tgt.status.some((s) => s.type === 'INVUL')) return this.log('info', `🛡️ ${tgt.name} 免疫了 ${usr.name} 的攻击！`);

    const tgtSkills = tgt.jobData.skills ?? [];
    if (tgtSkills.includes('flash_lol') && Math.random() < 0.2) return this.log('skill', `✨ ${tgt.name} 极限反应！交出闪现（D键），规避了 ${usr.name} 的伤害！`);
    if (tgtSkills.includes('roll_dodge') && Math.random() < 0.25) return this.log('skill', `🔄 ${tgt.name} 战术翻滚！利用无敌帧躲过了 ${usr.name} 的攻击！`);

    let dmg = 0;
    let logType = skId ? 'skill' : 'attack';

    if (usr.status.some((s) => s.type === 'ETHEREAL') && sk.tag === this.SKILL_TAGS['PHYS']) {
      return this.log('info', `👻 ${usr.name} 处于虚无界，无法造成物理伤害！`);
    }
    if (tgt.status.some((s) => s.type === 'ETHEREAL') && sk.tag === this.SKILL_TAGS['PHYS']) {
      return this.log('info', `👻 ${tgt.name} 处于虚无界，物理攻击无法触碰！`);
    }

    const sexyTrueDamage = usr.status.some((s) => s.type === 'STYLE_SEXY' || s.type === 'STYLE_EMPEROR');
    const ignoreDefOverride = sk.ignoreDef || sexyTrueDamage;

    if (sk.tag === this.SKILL_TAGS['PHYS'] || sk.tag === this.SKILL_TAGS['SPECIAL']) {
      const atk = usr.atk * (usr.status.some((s) => s.type === 'RAGE') ? 1.5 : 1) * (usr.hasSpinalSword ? 2.5 : 1);
      let def = (tgt.status.some((s) => s.type === 'FREEZE') || ignoreDefOverride || sexyTrueDamage)
        ? 0
        : (usr.jobData?.name === '欧皇' ? Math.floor(tgt.def * 0.5) : tgt.def);
      if (tgt.status.some((s) => s.type === 'WT_ERA')) def = Math.floor(def * 2.0);
      dmg = Math.max(1, Math.floor((atk * (1 + Math.random() * 0.2) - def * 0.5) * (sk.mult ?? 1)));
      if (tgt.status.some((s) => s.type === 'LIQUID_BODY')) dmg = Math.floor(dmg * 0.5);
    }
    if (sk.tag === this.SKILL_TAGS['MAG'] || sk.tag === this.SKILL_TAGS['DEBUFF']) {
      const res = (ignoreDefOverride || sexyTrueDamage) ? 0 : (usr.jobData?.name === '欧皇' ? Math.floor(tgt.res * 0.5) : tgt.res);
      dmg = Math.max(1, Math.floor((usr.mag * (1 + Math.random() * 0.2) - res * 0.5) * (sk.mult ?? 1)));
      if (sk.tag === this.SKILL_TAGS['DEBUFF']) dmg = Math.max(1, Math.floor(dmg * 0.5));
      if (tgt.status.some((s) => s.type === 'ETHEREAL')) {
        dmg = Math.floor(dmg * 2.0);
        this.log('crit', `👻 魔法爆裂！${tgt.name} 处于虚无状态，受到了双倍的魔法打击！`);
      }
    }

    if (usr.job === 'GOD_SLIME') {
      const sonBattery = this.fighters.find((f) => f.isSon && !f.isDead && this.getTeamId(f) === userTeamId);
      if (sonBattery) {
        dmg = Math.floor(dmg * 1.5);
        this.log('buff', `🔋 【魔力泵浦】水人的好大儿为 ${usr.name} 提供了庞大的魔力增幅！伤害1.5倍！`);
      }
    }

    const isCrit =
      usr.status.some((s) => s.type === 'AIM') ||
      tgt.status.some((s) => s.type === 'NEURAL_THEFT_DEBUFF') ||
      sk.alwaysCrit ||
      Math.random() < (usr.critRate + usr.agl * 0.001) ||
      usr.status.some((s) => s.type === 'STYLE_ANGRY');

    if (isCrit) {
      if (tgt.status.some((s) => s.type === 'LIQUID_BODY') && sk.tag === this.SKILL_TAGS['PHYS']) {
        // liquid body immune to physical crits
      } else {
        dmg = Math.floor(dmg * 1.5);
        logType = 'crit';
      }
    }
    if (sk.hits) dmg *= sk.hits;
    if (sk.selfDmgPct) usr.currentHp = Math.max(1, usr.currentHp - Math.floor(usr.maxHp * sk.selfDmgPct));

    if (usr.status.some((s) => s.type === 'STYLE_VAIN')) {
      const stealAtk = Math.floor(tgt.atk * 0.1);
      const stealMag = Math.floor(tgt.mag * 0.1);
      tgt.atk = Math.max(1, tgt.atk - stealAtk);
      tgt.mag = Math.max(1, tgt.mag - stealMag);
      usr.atk += stealAtk;
      usr.mag += stealMag;
      this.log('buff', `💅 虚荣窃取！${usr.name} 偷走了 ${tgt.name} 的属性化为己用！(吸收了攻击和魔力)`);
    }

    if (usr.status.some((s) => s.type === 'STYLE_FOOL') && Math.random() < 0.5) {
      const debuffs = ['STUN', 'FREEZE', 'POISON', 'BURN'];
      const randomDebuff = debuffs[Math.floor(Math.random() * debuffs.length)];
      if (!tgt.status.some((s) => s.type === 'BKB')) {
        tgt.status.push({ type: randomDebuff, duration: 2 });
        this.log('skill', `🤪 笨蛋女人乱拳挥舞！不经意间给 ${tgt.name} 附加了【${this.STATUS_EFFECTS[randomDebuff]?.name ?? randomDebuff}】异常状态！`);
      }
    }

    if (sk.status) {
      if (tgt.status.some((s) => s.type === 'BKB') && ['STUN', 'FREEZE', 'SILENCE', 'CONFUSED', 'CHARMED'].includes(sk.status)) {
        this.log('info', `🟡 ${tgt.name} 处于 BKB 状态，免疫了 ${this.STATUS_EFFECTS[sk.status]?.name ?? sk.status} 效果！`);
      } else {
        tgt.status.push({ type: sk.status, duration: 2 });
      }
    }

    if (skId === 'suicide_bomb' && tgt.status.some((s) => s.type === 'LIQUID_BODY')) {
      dmg = Math.floor(dmg * 0.3);
      this.log('info', `💦 爆炸的冲击波被 ${tgt.name} 的液态身躯卸掉了大半伤害！`);
    }

    const hpBeforeDamage = tgt.currentHp;
    let preMitigationDmg = isIntercepted ? Math.floor(dmg * 0.5) : dmg;

    if (preMitigationDmg >= tgt.currentHp && tgt.job === 'GOD_SLIME') {
      const sonProtector = this.fighters.find((f) => f.isSon && !f.isDead && this.getTeamId(f) === this.getTeamId(tgt) && f.id !== tgt.id);
      if (sonProtector) {
        this.log('info', `🛡️ 致命一击袭来！但在命中的瞬间，${tgt.name} 与【水人的好大儿】互换了位置！好大儿化作一滩清水替水神挡下了必杀！`);
        tgt = sonProtector;
        isIntercepted = true;
        preMitigationDmg = Math.floor(dmg * 0.5);
      }
    }

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

    if (tgt.job === 'VALO_JUNIOR' && (tgt.economy ?? 0) >= 6 && (actualDmg > tgt.maxHp * 0.2 || tgt.status.some((s) => ['STUN', 'FREEZE', 'CONFUSED', 'CHARMED'].includes(s.type)))) {
      tgt.economy = Math.max(0, (tgt.economy ?? 0) - 5);
      if (tgt.savedSpd) { tgt.spd = tgt.savedSpd; tgt.agl = tgt.savedAgl ?? 0; delete tgt.savedSpd; delete tgt.savedAgl; }
      this.log('death', `💔 损失惨重！${tgt.name} 受到重创或被控，手中的【冥驹】掉落了！经济大幅衰退！`);
    }

    if (sk.tag === this.SKILL_TAGS['PHYS'] && tgt.status.some((s) => s.type === 'COUNTER')) {
      this.log('crit', `💢 ${tgt.name} 触发反击！将 ${actualDmg} 点伤害弹回给了 ${usr.name}！`);
      this.applyDamage(usr, actualDmg, 'reflect');
      if (usr.currentHp <= 0 && !usr.isDeadAnnounced && !usr.isDead) {
        this.log('death', `💀 ${usr.name} 被自己造成的反弹伤害反死了！`);
        usr.isDeadAnnounced = true;
        tgt.stats.kills += 1;
      }
    }

    usr.stats.dmgDealt += actualDmg;
    if (tgt.currentHp <= 0 && !tgt.isDeadAnnounced && !tgt.isDead) {
      this.log('death', `💀 【击杀】${tgt.name} 被 ${usr.name} 的攻击无情抹杀！`);
      tgt.isDeadAnnounced = true;
      usr.stats.kills += 1;
      if (usr.job === 'VALO_JUNIOR') {
        usr.economy = (usr.economy ?? 0) + 2;
        usr.ultPoints = (usr.ultPoints ?? 0) + 1;
        this.log('info', `💰 ${usr.name} 拿到击杀！大招充能+1，经济大幅增长(+2)！`);
      }
    }

    const lsPct =
      (sk.lifesteal ?? 0) +
      (usr.status.some((s) => s.type === 'PLUG_HEAD') ? 0.25 : 0) +
      (usr.status.some((s) => s.type === 'VALO_ULT_EMPRESS') ? 1.0 : 0) +
      (usr.status.some((s) => s.type === 'STYLE_SMART' || s.type === 'STYLE_EMPEROR') ? 0.5 : 0);
    if (lsPct > 0 && actualDmg > 0) {
      if (usr.status.some((s) => s.type === 'NO_HEAL')) {
        this.log('info', `🥀 ${usr.name} 处于禁疗状态，无法触发吸血被动！`);
      } else {
        const healBase = Math.min(hpBeforeDamage, actualDmg);
        const healAmt = Math.floor(healBase * lsPct);
        if (healAmt > 0) {
          usr.currentHp = Math.min(usr.maxHp, usr.currentHp + healAmt);
          this.log('heal', `💉 ${usr.name} 触发吸血被动，恢复了 ${healAmt} 点生命！`);
        }
      }
    }

    if (usr.isSuccubus && usr.transformed && skId?.startsWith('chimera_') && skId !== 'chimera_install') {
      const baby = this.fighters.find((f) => f.job === 'MY_BABY' && !f.isDead && this.getTeamId(f) === userTeamId);
      if (baby) {
        const synMap: Record<string, string> = {
          'chimera_devour': 'baby_feed', 'chimera_execute': 'baby_laser',
          'chimera_funnels': 'baby_satellite', 'chimera_reconstruct': 'baby_cheer',
          'chimera_petrify': 'baby_scan', 'chimera_fortress': 'baby_shield',
          'chimera_warp': 'baby_speed', 'chimera_plague': 'baby_poison',
        };
        const synSkill = synMap[skId];
        if (synSkill) {
          const synSkillDef = this.SKILLS[synSkill];
          const isHealOrBuff = synSkillDef && (synSkillDef.tag === this.SKILL_TAGS['HEAL'] || synSkillDef.tag === this.SKILL_TAGS['BUFF']);
          this.executeSkillAction(synSkill, baby, isHealOrBuff ? usr : tgt, triggerDepth + 1);
        }
      }
    }

    // Transformation check fires immediately after damage so HP is restored at once
    this.handleTransformations(tgt);
    this.handleTransformations(usr);
    if (sk.afterExecute) sk.afterExecute(skillCtx, actualDmg, hpBeforeDamage);
  }

  handleDeathsAndRevives(spinalSwordRef: SpinalSwordRef): void {
    for (const f of this.fighters) {
      if (f.currentHp <= 0 && !f.isDead) {
        if (f.status.some((s) => s.type === 'VALO_ULT_RUN_IT_BACK')) {
          f.currentHp = f.maxHp;
          f.status = f.status.filter((s) => s.type !== 'VALO_ULT_RUN_IT_BACK');
          f.isDeadAnnounced = false;
          this.log('win', `🔥 浴火重生！${f.name} 受到致命伤，触发【再火一回】，原地满血复活！`);
          continue;
        }

        f.currentHp = 0;
        if (!f.isDeadAnnounced) {
          this.log('death', `💀 ${f.name} 伤重不治倒下了...`);
          f.isDeadAnnounced = true;
        }
        f.isDead = true;

        const MORPHLING_SON = this.JOBS['MORPHLING_SON'];
        if (f.isGamer && !f.resurrected && this.fighters.some((cf) => cf.isMorphling && !cf.isDead) && MORPHLING_SON) {
          f.isDead = false; f.resurrected = true; f.isSon = true;
          f.jobData = JSON.parse(JSON.stringify(MORPHLING_SON)) as JobDefinition;
          f.maxHp = Math.floor(f.maxHp * 6); f.currentHp = f.maxHp;
          f.atk *= 6; f.mag *= 6; f.wis = Math.floor(f.wis * 4.0); f.spd = 100;
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

      if (f.isDead && f.isJoker && !f.hasResurrected && (f.reviveTurns ?? 0) > 0) {
        const myTeamId = this.getTeamId(f);
        const hasTeammates = this.fighters.some((other) => other.id !== f.id && this.getTeamId(other) === myTeamId);
        let forceRevive = false;

        if (hasTeammates) {
          if (!this.fighters.some((ally) => !ally.isDead && this.getTeamId(ally) === myTeamId)) {
            forceRevive = true;
            this.log('info', `⚠️ 己方全灭，${f.name} 提前结束读秒，强制返场！`);
          }
        } else {
          if (new Set(this.fighters.filter((e) => !e.isDead).map((e) => this.getTeamId(e))).size <= 1) {
            forceRevive = true;
            this.log('info', `⚠️ 场上只剩最终的赢家，独狼 ${f.name} 决定现在登场截胡！`);
          }
        }

        f.reviveTurns = forceRevive ? 0 : (f.reviveTurns ?? 0) - 1;
        if ((f.reviveTurns ?? 0) <= 0) {
          f.isDead = false; f.hasResurrected = true; f.isDeadAnnounced = false;
          const GOD_OF_TROLLS = this.JOBS['GOD_OF_TROLLS'];
          if (GOD_OF_TROLLS) {
            f.jobData = JSON.parse(JSON.stringify(GOD_OF_TROLLS)) as JobDefinition;
            f.job = 'GOD_OF_TROLLS';
            f.maxHp = Math.floor(f.maxHp * 1.5); f.currentHp = f.maxHp; f.spd = 150;
            f.atk = Math.max(100, f.atk * 2); f.def = Math.max(80, f.def * 2); f.res = Math.max(150, f.res * 2);
            f.mag = Math.max(220, f.mag * 3); f.agl = Math.max(250, f.agl * 3); f.wis = Math.max(200, f.wis * 3);
          } else {
            f.currentHp = f.maxHp;
          }
          f.hpPct = 1.0; f.status = [];
          this.log('win', `🤡 ${f.name} 从地狱归来！转职为【${GOD_OF_TROLLS ? GOD_OF_TROLLS.name : '乐子人'}】！\n"接下来，是我的谢幕演出！"`);

          const enemies = this.fighters.filter((e) => !e.isDead && this.getTeamId(e) !== myTeamId);
          if (enemies.length > 0) {
            const aoeDmg = Math.floor(f.mag * 2.0);
            this.log('skill', `💥 【谢幕返场】${f.name} 的地狱笑话对全场敌人造成了 ${aoeDmg} 点魔法伤害，并施加了【混乱】！`);
            enemies.forEach((e) => {
              this.applyDamage(e, Math.max(1, aoeDmg - Math.floor(e.res * 0.5)), 'skill');
              if (e.currentHp <= 0 && !e.isDeadAnnounced && !e.isDead) {
                this.log('death', `💀 【击杀】${e.name} 被地狱笑话震死了！`);
                e.isDeadAnnounced = true;
                f.stats.kills += 1;
              }
              e.status.push({ type: 'CONFUSED', duration: 1 });
            });
          }
        }
      }
      f.hpPct = f.currentHp / f.maxHp;
    }
  }

  step(spinalSwordRef: SpinalSwordRef): boolean {
    this.fighters.forEach((f) => { f.isActing = false; f.isHit = false; });

    const alive = this.fighters.filter((f) => !f.isDead);
    if (this.checkWinCondition(alive)) return true;

    const actor = this.determineActor(alive);
    if (!actor) { this.handleDeathsAndRevives(spinalSwordRef); return false; }

    actor.isActing = true;
    this.handleSpinalSwordDrop(actor, spinalSwordRef);

    if (actor.monsterTurns !== undefined && actor.monsterTurns > 0 && --actor.monsterTurns === 0) {
      const MIRACLE_BUJIN = this.JOBS['MIRACLE_BUJIN'];
      if (actor.isTokusatsu && MIRACLE_BUJIN) actor.jobData = JSON.parse(JSON.stringify(MIRACLE_BUJIN)) as JobDefinition;
      if (actor.savedStats) { Object.assign(actor, actor.savedStats); delete actor.savedStats; }
      this.log('info', `🦖 ${actor.name} 解除了怪兽武装，数值回落${actor.isTokusatsu ? '，变回了奇迹武刃' : ''}。`);
    }

    if (actor.status.some((s) => s.type === 'WAIT_COUNTER' || s.type.startsWith('CTR_'))) {
      this.handleDeathsAndRevives(spinalSwordRef);
      return false;
    }

    const canAct = this.processStatus(actor);
    this.handleTransformations(actor);

    if (actor.currentHp <= 0) {
      this.handleDeathsAndRevives(spinalSwordRef);
      return false;
    }
    if (!canAct) {
      // Bug 7 fix: find the actual blocking status, not just status[0]
      const blockingStatus = actor.status.find((s) =>
        ['STUN', 'FREEZE', 'CONFUSED', 'CHARMED', 'WATER_PRISON', 'WT_SUPPRESS', 'WT_AIRBORNE', 'WT_REPAIRING'].includes(s.type),
      );
      if (blockingStatus) {
        this.log('info', `💫 ${actor.name} 处于【${this.STATUS_EFFECTS[blockingStatus.type]?.name ?? blockingStatus.type}】状态，无法行动！`);
      }
      this.handleDeathsAndRevives(spinalSwordRef);
      return false;
    }

    const skId = this.selectSkill(actor);
    this.executeSkillAction(skId, actor);
    this.advanceBunnyStyleClock(actor);
    this.handleDeathsAndRevives(spinalSwordRef);
    return false;
  }
}
