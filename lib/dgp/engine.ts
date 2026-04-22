/**
 * DGP 战斗引擎（欲望大奖赛模拟器）。
 *
 * 1:1 Ported from legacy `lib/dgp/4_engine_core.js`, `4_engine_combat.js`,
 * `4_engine_combo.js`, `4_engine_events.js` (originally window.DGP.DgpEngine).
 *
 * 原本 legacy 代码通过在 DgpEngine 类原型上逐个 function 挂方法
 * 来拆分 4 个 js 文件。现在迁移到 TS / Next.js，把这 4 个模块合并进一个
 * class，完整保留了所有游戏逻辑、数值与文案。
 */

import {
  BEROBA_EVOLVE_CHANCE,
  BOUNTY_DURATION,
  BOUNTY_MIN_ALIVE,
  BOUNTY_START_ROUND,
  BOUNTY_TRIGGER_CHANCE,
  BULL_STEAL_CHANCE,
  CEASEFIRE_HEAL_SCALE,
  COMMAND_DROP_OFFSET_FIRST,
  COMMAND_DROP_OFFSET_SECOND,
  COMMAND_MODE_SWITCH_CHANCE,
  COMMAND_TWIN_AWAKEN_CHARGES,
  DECISIVE_ROUND,
  DISARM_DMG_THRESHOLD_SCALE,
  ENGINE_OVERLOAD_PENALTY_SCALE,
  FEVER_MISS_CHANCE_DEFAULT,
  FEVER_MISS_CHANCE_TANUKI,
  FEVER_MISS_CONSOLATION_SHIELD,
  FEVER_ROLL_CD,
  FEVER_SSS_BAN_UNTIL_ROUND,
  FEVER_SSS_CHANCE_DEFAULT,
  FEVER_SSS_CHANCE_TANUKI,
  GENERIC_BRIBE_CHANCE,
  GENERIC_STEAL_CHANCE,
  GM_FEVER_EARLIEST_ROUND,
  GM_FEVER_FORCE_ROUND,
  POISON_SELF_DMG_SCALE,
  REGEN_SCALE,
  STAGE_DURATION,
  STAGE_EVENT_FIRST_ROUND,
  STAGE_EVENT_MIN_GAP,
  STAGE_TRIGGER_CHANCE,
  SUPPORTER_DROP_BASE_CHANCE,
  SUPPORTER_DROP_ROUND_SCALE,
  TANUKI_BRIBE_CHANCE,
  TOXIC_STAGE_BASE_SCALE,
  TOXIC_STAGE_POISONED_SCALE,
  TRADE_ACCEPT_CHANCE,
} from './constants';
import { getRandom, deepClone, escapeHtml } from './core';
import { BUCKLES, BUFF_DICT, JYAMATOS, SUPPORTERS, STAGE_POOL, SECRET_MISSIONS } from './data';
import {
  applyBuff,
  calculateBuckleScore,
  getEffectiveAgi,
  getThreatScore,
  getWeightedRandomBuckle,
} from './logic';
import { SeededRNG } from './rng';
import type {
  BuckleDef,
  BuckleSkill,
  DgpLogEntry,
  Player,
  SecretMission,
  StageDef,
} from './types';

// 短别名：所有 htmlText 里拼接**用户可控输入**（主要是 Player.name —— 骑士代号）
// 都要经过 `e(...)` 过一遍，避免 XSS（htmlText 会被 React 的 dangerouslySetInnerHTML 渲染）。
// 静态数据（BUCKLES/JYAMATOS/ID_CORES/SUPPORTERS/MISSIONS/STAGE_POOL 里的字段）
// 由作者维护、非用户可控，不必转义。
const e = escapeHtml;

// Legacy 在 equipBuckle 里返回这个形状的对象
interface EquipResult {
  log: string;
  type: string;
  delay: number;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional: prototype methods declared via interface merging below (see note near the `export interface DgpEngine` block)
export class DgpEngine {
  currentPlayers: Player[];
  round: number;
  activeStage: StageDef | null;
  stageDuration: number;
  roundsSinceRecovery: number;
  dgpLifted: boolean;
  infightingTriggered: boolean;
  groundBuckles: string[];
  bountyDuration: number;
  bountyTriggered: boolean;
  gmFeverDropped: boolean;
  gmFeverDropRound?: number;
  commandDrops: number;
  secretMission: SecretMission;
  secretMissionCompleted: boolean;
  rng: SeededRNG;
  rngNext: () => number;

  constructor(initialPlayers: Player[], seed?: number | string) {
    this.rng = new SeededRNG(seed);
    this.rngNext = this.rng.next.bind(this.rng);
    this.currentPlayers = deepClone(initialPlayers);

    // --- 核心修改：为所有玩家初始化 Command 专属状态字段 ---
    this.currentPlayers.forEach((p) => {
      if (!p.isJyamato) {
        p.commandCharges = 0;
        p.commandMode = 'Jet'; // 默认喷气机模式
      }
    });

    this.round = 1;
    this.activeStage = null;
    this.stageDuration = 0;
    this.roundsSinceRecovery = 0;
    this.dgpLifted = false;
    this.infightingTriggered = false;
    this.groundBuckles = [];
    this.bountyDuration = 0;
    this.bountyTriggered = false;
    this.gmFeverDropped = false;

    // --- 核心修改：新增指挥带扣全场投放计数器 ---
    this.commandDrops = 0;

    this.secretMission = getRandom(SECRET_MISSIONS, this.rngNext);
    this.secretMissionCompleted = false;
  }

  random(): number {
    return this.rngNext();
  }

  chance(probability: number): boolean {
    return this.random() < probability;
  }

  pickRandom<T>(arr: T[]): T {
    return getRandom(arr, this.rngNext);
  }

  makeEntityId(prefix: string): string {
    return `${prefix}_${this.round}_${Math.floor(this.random() * 1_000_000_000).toString(36)}`;
  }

  updatePlayerStats(player: Player): void {
    if (player.isJyamato || player.isClone) return;
    let hpBonus = player.buckles.reduce((sum, b) => sum + (b.hp || 0), 0);
    let atkBonus = player.buckles.reduce((sum, b) => sum + (b.atk || 0), 0);

    if (player.feverSlot) {
      hpBonus += player.feverSlot.hp || 0;
      atkBonus += player.feverSlot.atk || 0;
    }

    player.maxHp = player.baseHp + hpBonus;
    player.atk = player.baseAtk + atkBonus;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  equipBuckle(
    player: Player,
    buckleKey: string,
    actionText = '找到了',
    prefix = '【物资】',
  ): EquipResult {
    if (player.buckles && player.buckles.some((b) => b.id === 'Command_Twin')) {
      return {
        log: `⚠️【排他机制】${e(player.name)} 处于双重指挥形态，驱动器已被完全占据，无法装备任何新带扣！`,
        type: 'system_warning',
        delay: 500,
      };
    }

    const newBuckle =
      Object.values(BUCKLES).find((b) => b.id === buckleKey) || BUCKLES[buckleKey];

    let buckleNameStr = `[${newBuckle.name}]`;
    if (newBuckle.tier === 'mythic') buckleNameStr = `🌌[${newBuckle.name}]`;
    else if (newBuckle.tier === 'legendary') buckleNameStr = `🌟[${newBuckle.name}]`;
    else if (newBuckle.tier === 'large') buckleNameStr = `⭐[${newBuckle.name}]`;

    const isAffinity = player.idCore && player.idCore.affinity === newBuckle.id;
    let baseLog = `${prefix} ${e(player.name)} ${actionText} ${buckleNameStr} 带扣`;

    if (isAffinity && actionText !== '从地上捡起了' && actionText !== '顺手接住了空中的')
      baseLog += `。✨【核心共鸣】`;

    // 拾取相同带扣回血逻辑
    if (player.buckles.some((b) => b.id === newBuckle.id)) {
      let healAmount = Math.floor(newBuckle.hp * 0.5);
      const isPoisoned = player.buffs && player.buffs.some((b) => b.type === 'Poison');
      if (isPoisoned) healAmount = Math.floor(healAmount * 0.5);

      player.hp = Math.min(player.maxHp, player.hp + healAmount);
      return {
        log: `${baseLog}，能量转化为 ${healAmount} HP！${isPoisoned ? " <span class='text-purple-400 text-xs'>(受中毒减疗影响)</span>" : ''}`,
        type: ['large', 'legendary', 'mythic'].includes(newBuckle.tier) ? 'loot_epic' : 'loot',
        delay: 800,
      };
    }

    if (player.buckles.length >= 2) {
      const evaluateScores = [
        { index: 0, score: calculateBuckleScore(player, player.buckles[0]), buckle: player.buckles[0] },
        { index: 1, score: calculateBuckleScore(player, player.buckles[1]), buckle: player.buckles[1] },
        { index: 2, score: calculateBuckleScore(player, newBuckle), buckle: newBuckle },
      ];
      evaluateScores.sort((a, b) => a.score - b.score);
      const lowest = evaluateScores[0];

      if (lowest.index === 2) {
        if (
          !player.inventory ||
          calculateBuckleScore(player, newBuckle) > calculateBuckleScore(player, player.inventory)
        ) {
          const dropped = player.inventory;
          player.inventory = newBuckle;
          if (dropped && ['large', 'legendary', 'mythic'].includes(dropped.tier)) {
            this.groundBuckles.push(dropped.id);
            return {
              log: `${baseLog}，并替换了备用背包中的 [${dropped.name}]。\n🌟 遗弃的 [${dropped.name}] 掉落在了战场上！`,
              type: 'combat',
              delay: 800,
            };
          }
          return { log: `${baseLog}，收为备用。`, type: 'combat', delay: 600 };
        }
        if (['large', 'legendary', 'mythic'].includes(newBuckle.tier)) {
          this.groundBuckles.push(newBuckle.id);
          return {
            log: `${baseLog}，但不如身上的顺手，果断丢弃了。\n🌟 [${newBuckle.name}] 掉落在了战场上！`,
            type: 'combat',
            delay: 800,
          };
        }
        return { log: `${baseLog}，但不如身上的顺手，果断丢弃了。`, type: 'combat', delay: 400 };
      } else {
        const replacedBuckle = player.buckles[lowest.index];
        let droppedToGround: BuckleDef | null = null;
        if (
          !player.inventory ||
          calculateBuckleScore(player, replacedBuckle) >
            calculateBuckleScore(player, player.inventory)
        ) {
          if (player.inventory) droppedToGround = player.inventory;
          player.inventory = replacedBuckle;
        } else {
          droppedToGround = replacedBuckle;
        }

        let dropLog = '';
        if (
          droppedToGround &&
          ['large', 'legendary', 'mythic'].includes(droppedToGround.tier)
        ) {
          this.groundBuckles.push(droppedToGround.id);
          dropLog = `\n🌟 淘汰的 [${droppedToGround.name}] 掉落在了战场上！`;
        }

        player.hp = Math.max(1, player.hp - replacedBuckle.hp + newBuckle.hp);
        player.buckles[lowest.index] = newBuckle;
        this.updatePlayerStats(player);
        const formName = player.buckles.map((b) => b.formName || b.name).join(' & ');
        if (
          newBuckle.id === 'Fever' ||
          player.buckles.filter((b) => ['large', 'legendary', 'mythic'].includes(b.tier)).length ===
            2
        ) {
          return {
            log: `${baseLog}！\n🔄【REVOLVE ON】\n🔥【DUAL ON】达成 [${formName}] 形态！${dropLog}`,
            type: 'loot_epic',
            delay: 2000 + (dropLog ? 500 : 0),
          };
        }
        return {
          log: `${baseLog}！🔄【REVOLVE ON】达成 [${formName}] 形态。${dropLog}`,
          type: 'sponsor_drop',
          delay: 1500 + (dropLog ? 500 : 0),
        };
      }
    } else {
      player.buckles.push(newBuckle);
      player.hp += newBuckle.hp;
      this.updatePlayerStats(player);
      if (player.buckles.length === 2) {
        const formName = player.buckles.map((b) => b.formName || b.name).join(' & ');
        if (
          newBuckle.id === 'Fever' ||
          player.buckles.filter((b) => ['large', 'legendary', 'mythic'].includes(b.tier)).length ===
            2
        ) {
          return {
            log: `${baseLog}！\n🔥【DUAL ON】双核心载入，达成 [${formName}] 形态！`,
            type: 'loot_epic',
            delay: 2000,
          };
        } else {
          return {
            log: `${baseLog}！⚔️【ARMED】武装联合，达成 [${formName}] 形态！`,
            type: 'sponsor_drop',
            delay: 1500,
          };
        }
      } else {
        const formName = player.buckles[0].formName || player.buckles[0].name;
        return {
          log: `${baseLog}并成功载入驱动器，达成 [${formName}] 形态。`,
          type: 'sponsor_drop',
          delay: 1000,
        };
      }
    }
  }

  checkUndead(
    player: Player,
    currentPlayers: Player[],
    roundLogs: DgpLogEntry[],
    r: number,
    contextStr = '在濒死关头',
  ): boolean {
    if (
      player.hp > 0 ||
      player.status !== 'alive' ||
      player.isJyamato ||
      player.isClone ||
      player.idCore?.passive !== 'undead'
    )
      return false;

    if (player.isUndeadActiveThisTurn) {
      player.hp = 1;
      return true;
    }
    if (!player.undeadCheckedThisTurn) {
      player.undeadCheckedThisTurn = true;
      const pHasFever = player.buckles && player.buckles.some((b) => b.id === 'Fever');
      if (this.chance(pHasFever ? 0.5 : 0.25)) {
        player.hp = 1;
        player.isUndeadActiveThisTurn = true;

        const logText = `🩸${pHasFever ? '【极·狂战不屈】' : '【不屈】'}爆发！${player.name} ${contextStr}，强行锁死 1 点 HP！`;
        roundLogs.push({
          round: r,
          text: logText,
          type: 'combat',
          delay: 1500,
          actorId: player.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        return true;
      }
    }
    return false;
  }

  calculateNextRound(): DgpLogEntry[] {
    const currentPlayers = this.currentPlayers;
    const roundLogs: DgpLogEntry[] = [];
    const r = this.round;

    this.handleEvents(currentPlayers, roundLogs, r);
    this.handleCombat(currentPlayers, roundLogs, r);

    let runEnvironment = true;
    const checkH = currentPlayers.filter(
      (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
    ).length;
    const checkM = currentPlayers.filter((p) => p.status === 'alive' && p.isJyamato).length;
    if ((checkH === 1 && checkM === 0) || checkH === 0) {
      runEnvironment = false;
    }

    if (runEnvironment) {
      this.handleEnvironment(currentPlayers, roundLogs, r);
    }

    this.currentPlayers = currentPlayers.filter((p) => !p.toBeRemoved);
    const activeHumans = this.currentPlayers.filter(
      (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
    );
    const activeMonsters = this.currentPlayers.filter((p) => p.status === 'alive' && p.isJyamato);

    if (activeHumans.length === 1 && activeMonsters.length === 0) {
      roundLogs.push({
        round: r,
        text: `👑【游戏结束】邪魔徒已被清剿，DGP 决出唯一胜者！恭喜 ${activeHumans[0].name} 成为欲望神！`,
        type: 'system',
        delay: 3000,
        activeStage: this.activeStage,
        snapshot: deepClone(this.currentPlayers),
        isGameOver: true,
        winner: activeHumans[0],
      });
    } else if (activeHumans.length === 1 && activeMonsters.length > 0) {
      if (
        this.currentPlayers.filter((p) => !p.isJyamato && !p.isClone).length > 1 &&
        !this.infightingTriggered
      ) {
        roundLogs.push({
          round: r,
          text: `🛡️【孤军奋战】竞争对手都已淘汰... ${activeHumans[0].name} 必须杀光剩余邪魔徒！`,
          type: 'system',
          delay: 2000,
          activeStage: this.activeStage,
          snapshot: deepClone(this.currentPlayers),
        });
      }
    } else if (activeHumans.length === 0) {
      const loseText =
        activeMonsters.length === 0
          ? `💀【游戏结束】同归于尽！所有假面骑士与邪魔徒全部阵亡... 本届 DGP 无人生还，未能决出欲望神。`
          : `💀【游戏结束】所有假面骑士全军覆没... 邪魔徒占领了这座城市。`;

      roundLogs.push({
        round: r,
        text: loseText,
        type: 'system_danger',
        delay: 3000,
        activeStage: this.activeStage,
        snapshot: deepClone(this.currentPlayers),
        isGameOver: true,
        winner: null,
      });
    }

    this.round = r + 1;

    for (let i = 0; i < roundLogs.length - 1; i++) {
      if (roundLogs[i].extraReadTime) {
        roundLogs[i + 1].delay = (roundLogs[i + 1].delay || 0) + (roundLogs[i].extraReadTime || 0);
        delete roundLogs[i].extraReadTime;
      }
    }

    return roundLogs;
  }

  // ==========================================================================
  // Events & Environment (from 4_engine_events.js)
  // ==========================================================================

  handleEvents(currentPlayers: Player[], roundLogs: DgpLogEntry[], r: number): void {
    const aliveHumansAtStart = currentPlayers.filter(
      (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
    ).length;
    const aliveMonstersAtStart = currentPlayers.filter(
      (p) => p.status === 'alive' && p.isJyamato,
    ).length;
    const aliveBossMonstersAtStart = currentPlayers.filter(
      (p) => p.status === 'alive' && p.isJyamato && p.jyamatoTier === 'boss',
    ).length;

    // 决胜阶段 (延迟到第50回合)
    if (r === DECISIVE_ROUND && !this.dgpLifted) {
      this.dgpLifted = true;
      roundLogs.push({
        round: r,
        text: `⏳【决胜阶段】游戏向导 茨姆莉 宣布：“比赛时间过长，即刻起永久解除 [DGP 骑士保护协议]！”`,
        type: 'system_danger',
        delay: 2500,
        snapshot: deepClone(currentPlayers),
      });
    }

    // 邪魔徒失控内斗
    const isEndgameInfighting = aliveHumansAtStart === 1 && aliveMonstersAtStart >= 2;
    if (isEndgameInfighting && !this.infightingTriggered) {
      this.infightingTriggered = true;
      roundLogs.push({
        round: r,
        text: `💥【邪魔徒失控】为了争夺最后的猎物，失去理智的邪魔徒们竟然开始互相残杀！`,
        type: 'system_danger',
        delay: 3000,
        snapshot: deepClone(currentPlayers),
      });
    }

    // 场地异变
    let stageEventLog: DgpLogEntry | null = null;
    if (this.activeStage) {
      this.stageDuration--;
      if (this.stageDuration <= 0) {
        this.activeStage = null;
        this.roundsSinceRecovery = 0;
        stageEventLog = {
          round: r,
          text: `🌐【区域恢复】“特殊阶段结束，大家辛苦了~” 场地恢复了正常的 DGP 规则。`,
          type: 'system',
          delay: 2000,
        };
      }
    }

    if (!this.activeStage && r > 1) {
      let shouldTrigger = false;
      if (r === STAGE_EVENT_FIRST_ROUND) shouldTrigger = true;
      else if (r > STAGE_EVENT_FIRST_ROUND) {
        this.roundsSinceRecovery++;
        if (this.roundsSinceRecovery >= STAGE_EVENT_MIN_GAP) {
          if (this.chance(STAGE_TRIGGER_CHANCE)) shouldTrigger = true;
          else this.roundsSinceRecovery = 0;
        }
      }

      if (shouldTrigger) {
        const newStage = this.pickRandom(STAGE_POOL);
        this.activeStage = newStage;
        this.stageDuration = STAGE_DURATION;
        this.roundsSinceRecovery = 0;
        stageEventLog = {
          round: r,
          text: newStage.startLog,
          type: 'system_danger',
          delay: 3500,
        };
        if (newStage.id === 'Asura') currentPlayers.forEach((p) => (p.shield = 0));
      }
    }

    const currentStage = this.activeStage?.id;
    if (stageEventLog) {
      roundLogs.push({
        ...stageEventLog,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }

    // 场务清理机制 (保留最新的物资)
    if (this.groundBuckles.length > 3) {
      this.groundBuckles.splice(0, this.groundBuckles.length - 2);
      roundLogs.push({
        round: r,
        text: `🧹【场务介入】DGP 场务黑衣人清理了战场上遗落的过多物资。`,
        type: 'system',
        delay: 1500,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }

    // 冷却递减
    currentPlayers.forEach((p) => {
      if (p.status !== 'alive') return;
      if (currentStage !== 'Zero' && p.cooldowns)
        Object.keys(p.cooldowns).forEach((k) => {
          if (p.cooldowns[k] > 0) p.cooldowns[k]--;
        });
    });

    // 悬赏结算
    const currentBounty = currentPlayers.find((p) => p.isBountyTarget && p.status === 'alive');
    if (currentBounty) {
      this.bountyDuration--;
      if (this.bountyDuration <= 0) {
        currentBounty.isBountyTarget = false;

        let healAmount = currentBounty.maxHp - currentBounty.hp;
        const isPoisoned = currentBounty.buffs.some((b) => b.type === 'Poison');
        if (isPoisoned) healAmount = Math.floor(healAmount * 0.5);
        currentBounty.hp += healAmount;

        roundLogs.push({
          round: r,
          htmlText: `🎉<span class="text-yellow-400 font-bold text-xl">【悬赏失效】</span>${e(currentBounty.name)} 成功在悬赏追杀中生还！生命值恢复了 ${healAmount} 点！${isPoisoned ? "<span class='text-xs text-purple-400'>(受中毒减疗)</span>" : ''}`,
          type: 'system_warning',
          delay: 2500,
          targetIds: [currentBounty.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });

        if (!currentBounty.isJyamato && !currentBounty.isClone) {
          const result = this.equipBuckle(currentBounty, 'Fever', '作为生还大奖获得了', '🎁【生存奖励】');
          roundLogs.push({
            round: r,
            text: result.log,
            type: 'loot_epic',
            delay: 2000,
            actorId: currentBounty.id,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        } else if (currentBounty.isJyamato) {
          currentBounty.buffs.push({ type: 'Atk Up', duration: 3 });
          roundLogs.push({
            round: r,
            text: `🧟【怪物狂暴】生还的 ${currentBounty.name} 获得了强力攻击加成！`,
            type: 'system_danger',
            delay: 1000,
            targetIds: [currentBounty.id],
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      } else {
        roundLogs.push({
          round: r,
          text: `🎯【悬赏追踪】${currentBounty.name} 的高额悬赏还剩最后 ${this.bountyDuration} 回合！`,
          type: 'system_warning',
          delay: 1000,
          targetIds: [currentBounty.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }
    }

    // 派发新悬赏
    if (
      r > BOUNTY_START_ROUND &&
      !this.bountyTriggered &&
      !currentPlayers.some((p) => p.isBountyTarget && p.status === 'alive') &&
      this.chance(BOUNTY_TRIGGER_CHANCE)
    ) {
      const allAlive = currentPlayers.filter((p) => p.status === 'alive' && !p.isClone);
      if (allAlive.length >= BOUNTY_MIN_ALIVE) {
        const highestHpEntity = [...allAlive].sort((a, b) => b.hp - a.hp)[0];
        highestHpEntity.isBountyTarget = true;
        this.bountyDuration = BOUNTY_DURATION;
        this.bountyTriggered = true;
        roundLogs.push({
          round: r,
          htmlText: `📜<span class="text-yellow-300 font-bold text-lg">【悬赏发布】GM 基洛利 宣布：“击败 ${e(highestHpEntity.name)} 的人，将获得特别的欲望积分！”</span><br/>🎯 <span class="text-red-400 font-bold">${e(highestHpEntity.name)}</span> 被标记为【悬赏目标】！所有骑士的攻击重心开始疯狂转移！`,
          type: 'system_danger',
          delay: 3000,
          targetIds: [highestHpEntity.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }
    }

    // ==========================================
    // --- 新增：Command Raising 全局限量空投事件 ---
    // ==========================================
    // 注意这里：只有当 GM 发放了狂热后，过了 3 回合才会空投第一把指挥
    if (
      this.gmFeverDropped &&
      this.gmFeverDropRound &&
      r === this.gmFeverDropRound + COMMAND_DROP_OFFSET_FIRST &&
      this.commandDrops === 0
    ) {
      this.commandDrops++;
      this.groundBuckles.push('Command_Raising');
      roundLogs.push({
        round: r,
        htmlText: `👀 场外的观测者 <span class="text-blue-400 font-bold">尼拉姆</span> 扶了下眼镜：“看来现有的武装无法打破僵局，让我来加点料吧。”<br/>☄️ 一枚闪耀着橙色光芒的【喷射器带扣】如陨石般坠落在了战场中心！<br/>⚔️ <span class="text-orange-400 font-bold text-lg drop-shadow-md">【遗物降临】全场第一把 ✈️[喷射器带扣 (Jet Buckle)] 掉落在了无主之地上！所有骑士的目光瞬间被吸引，一场惨烈的争夺战即将爆发！</span>`,
        type: 'system_warning',
        delay: 3500,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }

    // GM 发放狂热后过了 8 回合，空投第二把指挥
    if (
      this.gmFeverDropped &&
      this.gmFeverDropRound &&
      r === this.gmFeverDropRound + COMMAND_DROP_OFFSET_SECOND &&
      this.commandDrops === 1
    ) {
      this.commandDrops++;
      this.groundBuckles.push('Command_Raising');
      roundLogs.push({
        round: r,
        htmlText: `🚨 <span class="text-red-500 font-bold text-lg drop-shadow-md">【系统劫持】</span> 整个大奖赛控制台爆发出刺耳的警报，赛场天穹变为暗红色！<span class="text-red-600 font-bold">GM 基洛利 亲自介入！</span><br/>🗣️ “比赛的走向已经脱离了我的剧本... 只有真正的强者，才有资格打破这个僵局！”<br/>☄️ 管理员强行越权！第二枚【喷射器带扣】突破空间限制，被强行投放至战场！<br/>⚔️ <span class="text-red-500 font-black text-xl drop-shadow-md">【禁忌投放】最后一把 ✈️[喷射器带扣 (Jet Buckle)] 狠狠砸在地面上！最惨烈的物资争夺战进入白热化阶段！</span>`,
        type: 'system_danger',
        delay: 4000,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }

    // 赞助商与 GM 空投 (25回合保底发狂热)
    if (r >= GM_FEVER_EARLIEST_ROUND && (aliveBossMonstersAtStart >= 2 || r >= GM_FEVER_FORCE_ROUND) && !this.gmFeverDropped) {
      this.gmFeverDropped = true;
      this.gmFeverDropRound = r;
      roundLogs.push({
        round: r,
        text: `🌐【系统劫持】警告！检测到严重威胁，游戏平衡已破坏！\n🎛️【GM介入】管理员强行越权，向所有幸存骑士发放补给大奖！`,
        type: 'system_danger',
        delay: 2000,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
      currentPlayers.forEach((p) => {
        if (p.status === 'alive' && !p.isJyamato && !p.isClone) {
          const alreadyHasFever = p.buckles.some((b) => b.id === 'Fever');
          const rewardId = alreadyHasFever ? 'Boost' : 'Fever';
          const result = this.equipBuckle(p, rewardId, '强制载入了', '🎁【GM特权】');
          roundLogs.push({
            round: r,
            text: alreadyHasFever
              ? `🎁【GM特权】${p.name} 已拥有狂热，替换发放了推进器！\n-> ${result.log}`
              : result.log,
            type: 'sponsor_drop',
            delay: 1500,
            actorId: p.id,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      });
    } else if (
      aliveHumansAtStart > 0 &&
      this.chance(SUPPORTER_DROP_BASE_CHANCE + r * SUPPORTER_DROP_ROUND_SCALE)
    ) {
      const supporter = this.pickRandom(SUPPORTERS);
      let didBerobaMonster = false;
      if (supporter.id === 'Beroba') {
        const pawns = currentPlayers.filter(
          (p) => p.status === 'alive' && p.isJyamato && p.name === '邪魔徒步兵',
        );
        if (pawns.length > 0 && this.chance(BEROBA_EVOLVE_CHANCE)) {
          const luckyPawn = this.pickRandom(pawns);
          const riderTpl = JYAMATOS['Rider'];
          const mScale = 1 + (r / 10) * 0.15;
          luckyPawn.name = riderTpl.name;
          luckyPawn.icon = riderTpl.icon;
          luckyPawn.jyamatoTier = riderTpl.tier;
          luckyPawn.str = Math.floor(riderTpl.str * mScale);
          luckyPawn.agi = Math.floor(riderTpl.agi * mScale);
          luckyPawn.int = Math.floor(riderTpl.int * mScale);
          luckyPawn.maxHp = Math.floor(riderTpl.hp * mScale);
          luckyPawn.hp = luckyPawn.maxHp;
          luckyPawn.baseAtk = Math.floor(riderTpl.atk * mScale);
          luckyPawn.atk = luckyPawn.baseAtk;
          luckyPawn.skills = riderTpl.skills;
          luckyPawn.isBountyTarget = false;
          roundLogs.push({
            round: r,
            text: `🌹【恶质空投】支持者 贝洛芭 向 [邪魔徒步兵] 投送了驱动器... 它当场进化为恐怖的 💀[邪魔徒骑士]！`,
            type: 'system_danger',
            delay: 2500,
            targetIds: [luckyPawn.id],
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
          didBerobaMonster = true;
        }
      }
      if (!didBerobaMonster) {
        const aliveHumans = currentPlayers.filter(
          (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
        );
        if (aliveHumans.length > 0) {
          const targetBuckleObj = BUCKLES[supporter.targetBuckle];
          let bestPlayer = aliveHumans[0];
          let bestScore = -1;
          aliveHumans.forEach((p) => {
            const score = calculateBuckleScore(p, targetBuckleObj);
            if (score > bestScore) {
              bestScore = score;
              bestPlayer = p;
            }
          });

          let actualDropId = supporter.targetBuckle;
          let dropContext = '接收了专属';
          if (bestPlayer.buckles.some((b) => b.id === actualDropId)) {
            actualDropId = 'Boost';
            dropContext = '接收了追加支援的';
          }

          if (actualDropId === 'Boost' && r <= 15) {
            // --- FIX: 修复赞助商大带扣随机池，剔除指挥带扣 ---
            const availableLarges = Object.keys(BUCKLES).filter(
              (k) =>
                BUCKLES[k].tier === 'large' &&
                k !== 'Fever' &&
                k !== 'Boost' &&
                k !== 'Command_Raising' &&
                k !== 'Command_Twin',
            );
            actualDropId = this.pickRandom(availableLarges) || 'Fever';
          }

          const result = this.equipBuckle(
            bestPlayer,
            actualDropId,
            dropContext,
            `🎁【赞助商】`,
          );
          roundLogs.push({
            round: r,
            text: `👀 4次元观众席沸腾了！支持者 ${supporter.icon}[${supporter.name}] 为 ${bestPlayer.name} 空投了奖励！\n${result.log}`,
            type: 'system_warning',
            delay: 1500,
            actorId: bestPlayer.id,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      }
    }

    // 隐藏任务
    if (!this.secretMissionCompleted && this.chance(0.08 + r * 0.01)) {
      const mission = this.secretMission;
      const underdogHumans = currentPlayers.filter(
        (p) =>
          p.status === 'alive' &&
          !p.isJyamato &&
          !p.isClone &&
          !p.buckles.some((b) => ['large', 'legendary'].includes(b.tier)),
      );
      const qualifiedPlayers = underdogHumans.filter(mission.condition);
      if (qualifiedPlayers.length > 0) {
        const luckyPlayer = this.pickRandom(qualifiedPlayers);
        this.secretMissionCompleted = true;
        let rewardBuckleId: string | null = null;
        if (this.chance(0.05)) rewardBuckleId = 'Fever';
        else {
          const affinityId = luckyPlayer.idCore.affinity;
          const hasAffinity =
            luckyPlayer.buckles.some((b) => b.id === affinityId) ||
            (luckyPlayer.inventory && luckyPlayer.inventory.id === affinityId);
          // --- FIX: 修复隐藏任务大带扣随机池，剔除指挥带扣 ---
          rewardBuckleId = hasAffinity
            ? this.pickRandom(
                Object.keys(BUCKLES).filter(
                  (k) =>
                    BUCKLES[k].tier === 'large' &&
                    k !== 'Command_Raising' &&
                    k !== 'Command_Twin',
                ),
              )
            : affinityId;
        }
        roundLogs.push({
          round: r,
          htmlText: `📜<span class="text-yellow-300 font-bold text-lg">【隐藏任务】叮咚！${e(luckyPlayer.name)} 达成了本轮大奖赛隐藏条件「${mission.name}」！</span><br/><span class="text-gray-400 text-xs">👉 达成条件：${mission.desc}</span>`,
          type: 'sponsor_drop',
          delay: 2000,
          actorId: luckyPlayer.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        const result = this.equipBuckle(
          luckyPlayer,
          rewardBuckleId!,
          '获得了',
          '🎁【任务奖励】游戏向导 茨姆莉 传送了特殊奖励，',
        );
        roundLogs.push({
          round: r,
          text: result.log,
          type: 'loot_epic',
          delay: 2500,
          actorId: luckyPlayer.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }
    }

    // 邪魔徒进场
    if (aliveHumansAtStart > 1 && aliveMonstersAtStart < 3) {
      let jyamatoSpawnChance = r <= 10 ? 0.25 : 0.15 + r * 0.01;
      if (currentStage === 'Carnival') jyamatoSpawnChance = 1.0;
      if (this.chance(jyamatoSpawnChance)) {
        let type = 'Pawn';
        if (r > 15 && this.chance(0.3)) type = 'Rider';
        else if (r > 5 && this.chance(0.4)) type = 'Rook';

        const tpl = JYAMATOS[type];
        const mScale = 1 + (r / 10) * 0.15;
        const scaledHp = Math.floor(tpl.hp * mScale);
        const scaledAtk = Math.floor(tpl.atk * mScale);
        const scaledStr = Math.floor(tpl.str * mScale);
        const scaledAgi = Math.floor(tpl.agi * mScale);
        const scaledInt = Math.floor(tpl.int * mScale);

        currentPlayers.push({
          id: this.makeEntityId('monster'),
          name: tpl.name,
          icon: tpl.icon,
          isJyamato: true,
          jyamatoTier: tpl.tier,
          str: scaledStr,
          agi: scaledAgi,
          int: scaledInt,
          baseHp: scaledHp,
          maxHp: scaledHp,
          hp: scaledHp,
          baseAtk: scaledAtk,
          atk: scaledAtk,
          skills: tpl.skills,
          status: 'alive',
          kills: 0,
          buckles: [],
          inventory: null,
          buffs: [],
          cooldowns: {},
          shield: 0,
          feverSlot: null,
          isBountyTarget: false,
          // legacy 中 isJyamato monster 没有 idCore，这里用 Player 强类型做个 placeholder 以满足类型
          idCore: {
            id: 'JyamatoCore',
            name: '邪魔徒核心',
            icon: tpl.icon,
            affinity: '',
            passive: 'none',
            passiveName: '',
          },
        });

        let spawnText =
          type === 'Rider'
            ? `🆘【极危警告】 噩梦般的 [邪魔徒骑士] 降临战场！`
            : `⚠️【入侵警报】 [${tpl.name}] 加入了战场！`;
        if (currentStage === 'Carnival')
          spawnText = `🧟【狂欢暴走】 受环境影响，暴躁的 [${tpl.name}] 杀入战场！`;
        roundLogs.push({
          round: r,
          text: spawnText,
          type: type === 'Rider' ? 'system_danger' : 'system_warning',
          delay: type === 'Rider' ? 2500 : 1500,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }
    }
  }

  handleEnvironment(currentPlayers: Player[], roundLogs: DgpLogEntry[], r: number): void {
    const currentStage = this.activeStage?.id;

    currentPlayers.forEach((p) => {
      if (p.status !== 'alive') return;

      if (currentStage === 'Toxic') {
        const toxicScale = p.buffs.some((b) => b.type === 'Poison' || b.type === 'Wet')
          ? TOXIC_STAGE_POISONED_SCALE
          : TOXIC_STAGE_BASE_SCALE;
        const toxicDmg = Math.floor(p.maxHp * toxicScale);
        p.hp -= toxicDmg;
        roundLogs.push({
          round: r,
          htmlText: `☠️【毒气沼泽】${e(p.name)} 受到致命毒气侵蚀，损失 <span class="text-purple-400 font-bold">${toxicDmg}</span> HP。`,
          type: 'combat',
          delay: 400,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        if (p.hp <= 0) {
          if (p.isClone) {
            p.hp = 0;
            p.status = 'eliminated';
            p.toBeRemoved = true;
            roundLogs.push({
              round: r,
              text: `💨 ${p.name} 承受不住毒素，化作一团烟雾消散了！`,
              type: 'combat',
              delay: 800,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers.filter((x) => !x.toBeRemoved)),
            });
            return;
          }
          if (this.checkUndead(p, currentPlayers, roundLogs, r, '深陷致命毒沼时')) return;
          p.hp = 0;
          p.status = 'eliminated';
          if (p.isBountyTarget) {
            p.isBountyTarget = false;
            roundLogs.push({
              round: r,
              text: `🎯【悬赏失效】悬赏目标 ${p.name} 死于致命环境，无人获得悬赏大奖！`,
              type: 'system_warning',
              delay: 1500,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers),
            });
          }
          roundLogs.push({
            round: r,
            text: `💀 ${p.name} 毒发身亡淘汰！`,
            type: 'kill',
            delay: 2000,
            targetIds: [p.id],
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      } else if (currentStage === 'Ceasefire' && !p.isJyamato && !p.isClone) {
        let heal = Math.floor(p.maxHp * CEASEFIRE_HEAL_SCALE);
        const isPoisoned = p.buffs.some((b) => b.type === 'Poison');
        if (isPoisoned) heal = Math.floor(heal * 0.5);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        roundLogs.push({
          round: r,
          htmlText: `🕊️【停战休整】${e(p.name)} 沐浴和平之光，恢复 <span class="text-green-400 font-bold">${heal}</span> HP。${isPoisoned ? '(受中毒减疗)' : ''}`,
          type: 'combat',
          delay: 300,
          actorId: p.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }

      if (p.status === 'alive' && p.buffs.some((b) => b.type === 'Poison')) {
        const dmg = Math.floor(p.maxHp * POISON_SELF_DMG_SCALE);
        p.hp -= dmg;
        roundLogs.push({
          round: r,
          text: `☠️ ${p.name} 毒发，损失 ${dmg} HP，受减疗影响。`,
          type: 'combat',
          delay: 400,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });

        if (p.hp <= 0) {
          if (p.isClone) {
            p.hp = 0;
            p.status = 'eliminated';
            p.toBeRemoved = true;
            roundLogs.push({
              round: r,
              text: `💨 ${p.name} 毒发，化作一团烟雾消散了！`,
              type: 'combat',
              delay: 800,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers.filter((x) => !x.toBeRemoved)),
            });
            return;
          }
          if (this.checkUndead(p, currentPlayers, roundLogs, r, '毒发攻心时')) return;

          p.hp = 0;
          p.status = 'eliminated';

          const poisonBuff = p.buffs.find((b) => b.type === 'Poison');
          const killerId = poisonBuff ? poisonBuff.sourceId : null;
          const killer = killerId ? currentPlayers.find((x) => x.id === killerId) : null;

          if (killer && killer.id !== p.id) {
            killer.kills += 1;
            roundLogs.push({
              round: r,
              text: `☠️【毒发】${p.name} 毒发身亡！人头算在了施毒者 ${killer.name} 头上！`,
              type: 'kill',
              delay: 2000,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers),
            });

            if (p.isBountyTarget) {
              p.isBountyTarget = false;
              let healAmount = killer.maxHp - killer.hp;
              const isPoisonedK = killer.buffs.some((b) => b.type === 'Poison');
              if (isPoisonedK) healAmount = Math.floor(healAmount * 0.5);
              killer.hp += healAmount;

              roundLogs.push({
                round: r,
                htmlText: `💰<span class="text-yellow-400 font-bold text-xl">【悬赏完成】</span>${e(killer.name)} 的剧毒击杀了悬赏目标 ${e(p.name)}！`,
                type: 'system',
                delay: 2000,
                actorId: killer.id,
                activeStage: this.activeStage,
                snapshot: deepClone(currentPlayers),
              });
              roundLogs.push({
                round: r,
                text: `💚 ${killer.name} 恢复了 ${healAmount} 点生命值！${isPoisonedK ? '(受减疗影响)' : ''}`,
                type: 'combat',
                delay: 1000,
                actorId: killer.id,
                activeStage: this.activeStage,
                snapshot: deepClone(currentPlayers),
              });

              if (!killer.isJyamato && !killer.isClone) {
                let rewardId = 'Fever';
                if (r > 15 && this.chance(0.5)) rewardId = 'Boost';
                const result = this.equipBuckle(killer, rewardId, '获得了悬赏大奖', '🎁【高额悬赏】');
                roundLogs.push({
                  round: r,
                  text: result.log,
                  type: 'loot_epic',
                  delay: 2000,
                  actorId: killer.id,
                  activeStage: this.activeStage,
                  snapshot: deepClone(currentPlayers),
                });
              }
            }
          } else {
            if (p.isBountyTarget) {
              p.isBountyTarget = false;
              roundLogs.push({
                round: r,
                text: `🎯【悬赏失效】悬赏目标 ${p.name} 死于毒素，无人获得悬赏大奖！`,
                type: 'system_warning',
                delay: 1500,
                targetIds: [p.id],
                activeStage: this.activeStage,
                snapshot: deepClone(currentPlayers),
              });
            }
            roundLogs.push({
              round: r,
              text: `💀 ${p.name} 毒发身亡淘汰！`,
              type: 'kill',
              delay: 2000,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers),
            });
          }
        }
      }

      if (p.status === 'alive' && p.buffs.some((b) => b.type === 'Burn')) {
        const burnDmg = Math.floor(p.maxHp * 0.04);
        let shieldLost = 0;
        let hpLost = 0;
        if (p.shield > 0) {
          shieldLost = Math.min(p.shield, Math.floor(p.maxHp * 0.08));
          p.shield -= shieldLost;
        } else {
          hpLost = burnDmg;
          p.hp -= hpLost;
        }
        let burnLog = `🔥 ${p.name} 受到高温灼烧，`;
        if (shieldLost > 0) burnLog += `护盾被融化了 ${shieldLost} 点！`;
        else burnLog += `损失了 ${hpLost} HP。`;

        roundLogs.push({
          round: r,
          text: burnLog,
          type: 'combat',
          delay: 400,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        if (p.hp <= 0) {
          if (p.isClone) {
            p.hp = 0;
            p.status = 'eliminated';
            p.toBeRemoved = true;
            roundLogs.push({
              round: r,
              text: `💨 ${p.name} 被烈焰焚毁，化作一团烟雾消散了！`,
              type: 'combat',
              delay: 800,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers.filter((x) => !x.toBeRemoved)),
            });
            return;
          }
          if (this.checkUndead(p, currentPlayers, roundLogs, r, '在烈火焚烧中')) return;
          p.hp = 0;
          p.status = 'eliminated';
          if (p.isBountyTarget) {
            p.isBountyTarget = false;
            roundLogs.push({
              round: r,
              text: `🎯【悬赏失效】悬赏目标 ${p.name} 被烈火烧成灰烬，无人获得悬赏大奖！`,
              type: 'system_warning',
              delay: 1500,
              targetIds: [p.id],
              activeStage: this.activeStage,
              snapshot: deepClone(currentPlayers),
            });
          }
          roundLogs.push({
            round: r,
            text: `💀 ${p.name} 被烧成灰烬淘汰！`,
            type: 'kill',
            delay: 2000,
            targetIds: [p.id],
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      }

      if (p.status === 'alive' && p.buffs.some((b) => b.type === 'Regen')) {
        let heal = Math.floor((p.maxHp - p.hp) * REGEN_SCALE);
        const isPoisoned = p.buffs.some((b) => b.type === 'Poison');
        if (isPoisoned) heal = Math.floor(heal * 0.5);
        if (heal > 0) {
          p.hp += heal;
          roundLogs.push({
            round: r,
            htmlText: `💚 ${e(p.name)} 治愈恢复 ${heal} HP。${isPoisoned ? '(受中毒减疗)' : ''}`,
            type: 'combat',
            delay: 300,
            actorId: p.id,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      }
      p.buffs.forEach((b) => b.duration--);
      p.buffs = p.buffs.filter((b) => b.duration > 0);

      if (p.isClone && p.status === 'alive') {
        p.cloneDuration = (p.cloneDuration || 0) - 1;
        if ((p.cloneDuration || 0) <= 0) {
          p.hp = 0;
          p.status = 'eliminated';
          p.toBeRemoved = true;
          roundLogs.push({
            round: r,
            text: `💨 ${p.name} 的持续时间结束，化作一团烟雾消散了。`,
            type: 'combat',
            delay: 800,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers.filter((x) => !x.toBeRemoved)),
          });
        }
      }
    });

    // 回合结束后统一清理状态
    currentPlayers.forEach((p) => {
      delete p.isUndeadActiveThisTurn;
      delete p.undeadCheckedThisTurn;
    });
  }

}

// ==========================================================================
// Interface 合并（declaration merging）
// 将下方以 `DgpEngine.prototype.xxx = function(...)` 形式挂载的方法
// 在类型系统里补齐到 DgpEngine 上。此块只存在于类型层面，不会产生任何
// 运行时代码，也不会在 constructor 里生成 `this.handleCombat = undefined`
// 这种会覆盖掉原型方法的初始化（SWC 编译 `handleCombat!: () => void`
// 时会做此类覆盖，导致运行时 `this.handleCombat is not a function`）。
// ==========================================================================
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional: see note above
export interface DgpEngine {
  _processPreActions(
    actor: Player,
    currentPlayers: Player[],
    roundLogs: DgpLogEntry[],
    r: number,
  ): boolean;
  _determineActionType(actor: Player): string;
  _executeLootAction(
    actor: Player,
    currentPlayers: Player[],
    roundLogs: DgpLogEntry[],
    r: number,
    actedThisRound: Set<string>,
  ): void;
  _applyStageTargetModifiers(
    actor: Player,
    targets: Player[],
    modifiedSkill: BuckleSkill,
    currentPlayers: Player[],
    isAttackSkill: boolean,
  ): { targets: Player[]; logPrefix: string | null };
  _executeAttackAction(
    actor: Player,
    currentPlayers: Player[],
    roundLogs: DgpLogEntry[],
    r: number,
    isEndgameInfighting: boolean,
    hasDgpProtection: boolean,
  ): void;
  resolveSkillCombo(
    actor: Player,
    modifiedSkill: BuckleSkill,
    isBurstingJackpot: boolean,
    currentPlayers: Player[],
  ): { weaponLog: string; sourceBuckle: BuckleDef | undefined };
  _processPostActions(
    actor: Player,
    currentPlayers: Player[],
    roundLogs: DgpLogEntry[],
    r: number,
  ): void;
  handleCombat(currentPlayers: Player[], roundLogs: DgpLogEntry[], r: number): void;
}

// ==========================================================================
// Combat methods attached to prototype (ported 1:1 from 4_engine_combat.js).
// 放在 prototype 上是为了让这个巨大的战斗模块和 core 分文件组织，但仍共享同一个 class。
// ==========================================================================

// ---------------------------------------------------------
// 模块 1：回合预处理 (异常状态挣脱、玩家间交易、狂热摇奖)
// ---------------------------------------------------------
DgpEngine.prototype._processPreActions = function (
  this: DgpEngine,
  actor: Player,
  currentPlayers: Player[],
  roundLogs: DgpLogEntry[],
  r: number,
): boolean {
  // 1. 异常状态挣脱
  if (actor.buffs.some((b) => b.type === 'Stun')) {
    const stunResist = (actor.str / 100) * 0.3;
    if (this.chance(stunResist)) {
      actor.buffs = actor.buffs.filter((b) => b.type !== 'Stun');
      roundLogs.push({
        round: r,
        text: `💪 ${actor.name} 凭借惊人的力量强行挣脱了 [眩晕]！`,
        type: 'combat',
        delay: 800,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    } else {
      roundLogs.push({
        round: r,
        text: `💫 ${actor.name} 处于 [眩晕] 状态，无法行动！`,
        type: 'combat',
        delay: 500,
        targetIds: [actor.id],
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
      return true; // 返回 true 表示跳过当前回合
    }
  }

  // 2. 玩家间带扣交易
  let tradedThisTurn = false;
  const actorHasTwin =
    !actor.isJyamato && !actor.isClone && actor.buckles.some((b) => b.id === 'Command_Twin');

  if (
    !actor.isJyamato &&
    !actor.isClone &&
    !actorHasTwin &&
    actor.buckles.some((b) => ['large', 'legendary', 'mythic'].includes(b.tier))
  ) {
    const otherHumans = currentPlayers.filter(
      (p) =>
        p.id !== actor.id &&
        p.status === 'alive' &&
        !p.isJyamato &&
        !p.isClone &&
        p.buckles.some((b) => ['large', 'legendary', 'mythic'].includes(b.tier)) &&
        !p.buckles.some((b) => b.id === 'Command_Twin'),
    );
    const shuffledHumans = [...otherHumans].sort(() => this.random() - 0.5);
    for (const rival of shuffledHumans) {
      if (tradedThisTurn) break;
      for (let ai = 0; ai < actor.buckles.length; ai++) {
        if (tradedThisTurn) break;
        for (let rj = 0; rj < rival.buckles.length; rj++) {
          const bA = actor.buckles[ai];
          const bB = rival.buckles[rj];
          if (
            bA.id === bB.id ||
            !['large', 'legendary', 'mythic'].includes(bA.tier) ||
            !['large', 'legendary', 'mythic'].includes(bB.tier)
          )
            continue;
          if (
            actor.buckles.some((b, idx) => idx !== ai && b.id === bB.id) ||
            rival.buckles.some((b, idx) => idx !== rj && b.id === bA.id)
          )
            continue;

          const aScoreOld = calculateBuckleScore(actor, bA);
          const aScoreNew = calculateBuckleScore(actor, bB);
          const rScoreOld = calculateBuckleScore(rival, bB);
          const rScoreNew = calculateBuckleScore(rival, bA);

          if (aScoreNew > aScoreOld && rScoreNew > rScoreOld && this.chance(TRADE_ACCEPT_CHANCE)) {
            let canTrade = true;
            let trickLog = '';
            if (bA.id === 'Boost' || bB.id === 'Boost') {
              const tricker = bA.id === 'Boost' ? actor : rival;
              if (tricker.idCore.id === 'Fox') canTrade = false;
              else if (tricker.idCore.id === 'Tanuki') {
                canTrade = this.chance(TANUKI_BRIBE_CHANCE);
                if (canTrade) trickLog = `老实的 ${e(tricker.name)} 被三言两语哄骗，`;
              } else canTrade = this.chance(GENERIC_BRIBE_CHANCE);
            }
            if (canTrade) {
              actor.buckles[ai] = bB;
              rival.buckles[rj] = bA;
              this.updatePlayerStats(actor);
              this.updatePlayerStats(rival);
              let htmlText = `🤝<span class="text-cyan-400 font-bold">【交易】各取所需！${e(actor.name)} 和 ${e(rival.name)} 发现对方手里有自己更契合的大带扣，达成了交换！</span>\n`;
              if (trickLog) htmlText += `   🗣️ ${trickLog}交出了 [推进器]！\n`;
              htmlText += `   🔄 ${e(actor.name)} 获得了 ⭐[${bB.name}] (失去 [${bA.name}])\n   🔄 ${e(rival.name)} 获得了 ⭐[${bA.name}] (失去 [${bB.name}])`;
              roundLogs.push({
                round: r,
                htmlText: htmlText,
                type: 'sponsor_drop',
                delay: 2000,
                actorId: actor.id,
                targetIds: [rival.id],
                activeStage: this.activeStage,
                snapshot: deepClone(currentPlayers),
              });
              tradedThisTurn = true;
              break;
            }
          }
        }
      }
    }
  }

  // 3. 狂热插槽摇奖机
  const actorHasFever =
    !actorHasTwin &&
    !actor.isJyamato &&
    !actor.isClone &&
    actor.buckles.some((b) => b.id === 'Fever');
  if (actorHasFever) {
    actor.feverRollCd = actor.feverRollCd || 0;
    if (actor.feverRollCd <= 0 || !actor.feverSlot) {
      actor.feverRollCd = FEVER_ROLL_CD;
      const isTanuki = actor.idCore.passive === 'luck';
      const rand = this.random();
      let rollResult = '';
      let drawnId = 'Entry';

      const pSSS =
        r <= FEVER_SSS_BAN_UNTIL_ROUND
          ? 0
          : isTanuki
            ? FEVER_SSS_CHANCE_TANUKI
            : FEVER_SSS_CHANCE_DEFAULT;
      const pC = isTanuki ? FEVER_MISS_CHANCE_TANUKI : FEVER_MISS_CHANCE_DEFAULT;
      const pS = 0.25;
      const otherLargeBuckle = actor.buckles.find(
        (b) =>
          b.id !== 'Fever' &&
          b.id !== 'Command_Raising' &&
          b.id !== 'Command_Twin' &&
          ['large', 'legendary', 'mythic'].includes(b.tier),
      );

      roundLogs.push({
        round: r,
        htmlText: `<span class="animate-pulse font-bold text-yellow-300"> [ 🎰 狂热轮盘启动... ❓ | ❓ | ❓ ] </span><br/><span class="text-sm text-gray-300">⚙️ ${e(actor.name)} 扣动了狂热插槽的拉杆，轮盘开始疯狂旋转！</span>`,
        type: 'sponsor_drop',
        delay: 1500,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });

      if (rand < pSSS) {
        rollResult = 'SSS';
        drawnId = 'Boost';
      } else if (rand < pSSS + pC) {
        rollResult = 'C';
      } else if (rand < pSSS + pC + pS && otherLargeBuckle) {
        rollResult = 'S';
        drawnId = otherLargeBuckle.id;
      } else {
        rollResult = 'A';
        drawnId = this.pickRandom(
          ['Magnum', 'Zombie', 'Ninja', 'Monster', 'Beat'].filter(
            (id) => !otherLargeBuckle || id !== otherLargeBuckle.id,
          ),
        );
      }

      if (rollResult === 'C') {
        const trashNames = ['水管', '螺旋桨', '战锤', '猫头鹰', '防爆盾'];
        const tName = this.pickRandom(trashNames);
        actor.feverSlot = {
          id: 'Trash',
          name: tName,
          tier: 'small',
          tags: ['trash'],
          hp: 0,
          atk: 0,
          pref: {},
          skills: [{ name: `滑稽的${tName}敲击`, type: 'attack', cd: 0, dmg: 0.5 }],
        };
        actor.shield += FEVER_MISS_CONSOLATION_SHIELD;
        roundLogs.push({
          round: r,
          htmlText: `<span class="text-gray-500 font-bold"> [ 🎰 轮盘停止... 💦 | 🔨 | 💩 -> 💀 MISS... ] </span><br/><span class="text-gray-400">竟然摇出了小型武装 [${tName}]？！全场陷入了尴尬的沉默... (${e(actor.name)} 沮丧地获得了 50 点安慰护盾)</span>`,
          type: 'system_warning',
          delay: 2500,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      } else if (rollResult === 'SSS') {
        actor.feverSlot = BUCKLES[drawnId];
        actor.jackpotBurstReady = true;
        roundLogs.push({
          round: r,
          htmlText: `<span class="text-red-500 font-bold text-lg drop-shadow-md"> [ 🎰 轮盘停止... 🦊 | 🦊 | 🦊 -> 🚀 HIDDEN JACKPOT！！！ ] </span><br/><span class="text-red-400 font-bold">隐藏大奖降临！${e(actor.name)} 摇出了传说中的 [推进器]！属性极限暴增！</span>`,
          type: 'loot_epic',
          delay: 2500,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      } else if (rollResult === 'S') {
        actor.feverSlot = BUCKLES[drawnId];
        actor.jackpotBurstReady = true;
        roundLogs.push({
          round: r,
          htmlText: `<span class="text-yellow-400 font-bold text-lg drop-shadow-md"> [ 🎰 轮盘停止... ⭐ | ⭐ | ⭐ -> 🎯 GOLDEN JACKPOT！！！ ] </span><br/><span class="text-yellow-300 font-bold">触发同色大奖！${e(actor.name)} 摇出了第二把 [${BUCKLES[drawnId].name}]，达成狂热双持形态！面板属性完美翻倍！</span>`,
          type: 'loot_epic',
          delay: 2500,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      } else {
        actor.feverSlot = BUCKLES[drawnId];
        roundLogs.push({
          round: r,
          htmlText: `<span class="text-blue-300 font-bold"> [ 🎰 轮盘停止... 🍒 | 🍉 | ⭐ -> ✅ MATCH！ ] </span><br/><span class="text-blue-200">成功发牌！${e(actor.name)} 获得了 ⭐[${BUCKLES[drawnId].name}] 的武装力量及属性增幅！</span>`,
          type: 'sponsor_drop',
          delay: 2000,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      }
      this.updatePlayerStats(actor);
    } else {
      actor.feverRollCd--;
    }
  } else if (!actor.isJyamato && !actor.isClone && actor.feverSlot) {
    actor.feverSlot = null;
    actor.jackpotBurstReady = false;
    this.updatePlayerStats(actor);
  }

  return false;
};

// ---------------------------------------------------------
// 模块 2：AI 行为决策 (决定当前回合是捡东西还是打架)
// ---------------------------------------------------------
DgpEngine.prototype._determineActionType = function (this: DgpEngine, actor: Player): string {
  let actionType = 'attack';
  const actorHasTwin =
    !actor.isJyamato && !actor.isClone && actor.buckles.some((b) => b.id === 'Command_Twin');

  if (!actor.isJyamato && !actor.isClone && !actorHasTwin) {
    // 判断自身是否“饥渴”（有空位，或者只有垃圾带扣）
    const isHungry =
      actor.buckles.length < 2 ||
      !actor.inventory ||
      actor.buckles.some((b) => !['large', 'legendary', 'mythic'].includes(b.tier)) ||
      (actor.inventory && !['large', 'legendary', 'mythic'].includes(actor.inventory.tier));

    if (actor.buckles.length === 0 && this.chance(0.8)) actionType = 'loot';
    else if (actor.buckles.length === 1 && this.chance(0.6)) actionType = 'loot';
    else if (isHungry && this.chance(0.25)) actionType = 'loot';
    else if (this.groundBuckles.length > 0) {
      // 侦测地上是否有高阶带扣，避免被地上的垃圾吸引去浪费回合
      const hasGoodStuff = this.groundBuckles.some(
        (id) => BUCKLES[id] && ['large', 'legendary', 'mythic'].includes(BUCKLES[id].tier),
      );
      if (hasGoodStuff && this.chance(0.4)) actionType = 'loot';
      else if (this.chance(0.05)) actionType = 'loot'; // 极小概率继续摸盲盒
    } else if (this.chance(0.1)) {
      actionType = 'loot'; // 没有带扣时，也有概率去开未知的盲盒箱
    }
  }
  return actionType;
};

// ---------------------------------------------------------
// 模块 3：执行拾取行为 (智能拾取与抢夺结算)
// ---------------------------------------------------------
DgpEngine.prototype._executeLootAction = function (
  this: DgpEngine,
  actor: Player,
  currentPlayers: Player[],
  roundLogs: DgpLogEntry[],
  r: number,
  actedThisRound: Set<string>,
): void {
  let foundBuckleId: string | null = null;
  let isFromGround = false;
  let groundIndexToPick = -1;

  // --- 核心修复：智能评估地面物资，避免捡了又丢 ---
  if (this.groundBuckles.length > 0) {
    let minCurrentScore = -1;
    if (actor.buckles.length >= 2) {
      const scores = actor.buckles.map((b) => calculateBuckleScore(actor, b));
      const minBuckleScore = Math.min(...scores);
      if (actor.inventory) {
        const invScore = calculateBuckleScore(actor, actor.inventory);
        minCurrentScore = Math.min(minBuckleScore, invScore);
      } else {
        minCurrentScore = -1; // 身上满了但背包有空，可以随意捡
      }
    }

    let bestGroundScore = -1;
    for (let i = 0; i < this.groundBuckles.length; i++) {
      const bId = this.groundBuckles[i];
      const bObj = BUCKLES[bId];
      if (!bObj) continue;

      let score = calculateBuckleScore(actor, bObj);

      // 智能特判：如果地上是同名带扣，且身上有，可以作为血包捡走（仅当血量不满时给极大权重）
      if (actor.buckles.some((b) => b.id === bId) && actor.hp < actor.maxHp) {
        score = 9999999;
      }

      // 严格把控：要求地上的带扣分值【严格大于】自己最差的带扣才值得去拿
      if (score > minCurrentScore && score > bestGroundScore) {
        bestGroundScore = score;
        groundIndexToPick = i;
      }
    }
  }

  if (groundIndexToPick !== -1) {
    foundBuckleId = this.groundBuckles.splice(groundIndexToPick, 1)[0];
    isFromGround = true;
  } else {
    // 没看上地上的，或者地上本来就没有，果断去开盲盒卡池抽卡
    const ownedIds = actor.buckles.map((b) => b.id);
    if (actor.inventory) ownedIds.push(actor.inventory.id);
    if (actor.feverSlot && actor.feverSlot.id !== 'Trash') ownedIds.push(actor.feverSlot.id);

    const avBuckles = Object.keys(BUCKLES).filter(
      (k) =>
        k !== 'Entry' &&
        k !== 'Fever' &&
        (r > 15 || k !== 'Boost') &&
        !ownedIds.includes(k) &&
        k !== 'Command_Raising' &&
        k !== 'Command_Twin',
    );
    if (avBuckles.length > 0) foundBuckleId = getWeightedRandomBuckle(avBuckles, actor, this.rngNext);
  }

  if (foundBuckleId) {
    const otherIdleHumans = currentPlayers.filter(
      (p) =>
        p.id !== actor.id &&
        p.status === 'alive' &&
        !p.isJyamato &&
        !p.isClone &&
        !actedThisRound.has(p.id),
    );
    if (otherIdleHumans.length > 0 && this.chance(0.2)) {
      const rival = this.pickRandom(otherIdleHumans);
      actedThisRound.add(rival.id);
      const bkName =
        BUCKLES[foundBuckleId].tier === 'large'
          ? `⭐[${BUCKLES[foundBuckleId].name}]`
          : `[${BUCKLES[foundBuckleId].name}]`;
      const conflictText = isFromGround
        ? `⚠️【遗物争夺】${actor.name} 和 ${rival.name} 同时盯上了地上的 ${bkName}，爆发争夺！`
        : `⚠️【物资冲突】${actor.name} 和 ${rival.name} 同时发现了未知补给箱里的 ${bkName}，爆发争夺！`;
      roundLogs.push({
        round: r,
        text: conflictText,
        type: 'system_warning',
        delay: 1500,
        actorId: actor.id,
        targetIds: [rival.id],
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });

      const actorCP = actor.atk + getEffectiveAgi(actor) + this.random() * 100;
      const rivalCP = rival.atk + getEffectiveAgi(rival) + this.random() * 100;
      const winner = actorCP >= rivalCP ? actor : rival;
      const loser = actorCP >= rivalCP ? rival : actor;

      const damage = Math.floor(winner.atk * (0.6 + this.random() * 0.4));
      loser.hp -= damage;
      let contestLog = `🥊【争夺结果】${winner.name} 击退了 ${loser.name} (💥-${damage})！`;

      if (loser.hp <= 0) {
        if (this.checkUndead(loser, currentPlayers, roundLogs, r, '在带扣争夺战被重创时')) {
          contestLog += `🩸${loser.name} 锁血 1 点站住了！`;
        } else {
          loser.hp = 0;
          loser.status = 'eliminated';
          winner.kills += 1;
          if (loser.isBountyTarget) {
            loser.isBountyTarget = false;
            contestLog += `\n💰【悬赏完成】${winner.name} 成功击杀了悬赏目标 ${loser.name}！`;
            let healAmount = winner.maxHp - winner.hp;
            if (winner.buffs.some((b) => b.type === 'Poison'))
              healAmount = Math.floor(healAmount * 0.5);
            winner.hp += healAmount;
            if (!winner.isJyamato && !winner.isClone) {
              let rewardId = 'Fever';
              if (r > 15 && this.chance(0.5)) rewardId = 'Boost';
              const rewardRes = this.equipBuckle(winner, rewardId, '获得了悬赏大奖', '🎁【高额悬赏】');
              contestLog += `\n-> 💚 ${winner.name} 恢复了 ${healAmount} 点生命值！\n-> ${rewardRes.log}`;
            }
          } else {
            contestLog += `💀 ${loser.name} 伤重淘汰！`;
          }
        }
      }
      roundLogs.push({
        round: r,
        text: contestLog,
        type: 'combat',
        delay: 1000,
        actorId: winner.id,
        targetIds: [loser.id],
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
      const result = this.equipBuckle(
        winner,
        foundBuckleId,
        isFromGround ? '从地上捡起了' : '抢到了未知补给箱中的',
        isFromGround ? '【拾取】' : '【战利品】',
      );
      roundLogs.push({
        round: r,
        text: result.log,
        type: result.type,
        delay: result.delay,
        actorId: winner.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    } else {
      const result = this.equipBuckle(
        actor,
        foundBuckleId,
        isFromGround ? '从地上捡起了' : '在空投补给中找到了',
        isFromGround ? '【拾取】' : '【搜集】',
      );
      roundLogs.push({
        round: r,
        text: result.log,
        type: result.type,
        delay: result.delay,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }
  }
};

// ---------------------------------------------------------
// 模块 3.5：场地修饰器钩子 (Stage Modifiers Hook) - 解决硬编码问题
// ---------------------------------------------------------
DgpEngine.prototype._applyStageTargetModifiers = function (
  this: DgpEngine,
  actor: Player,
  targets: Player[],
  modifiedSkill: BuckleSkill,
  currentPlayers: Player[],
  isAttackSkill: boolean,
): { targets: Player[]; logPrefix: string | null } {
  if (!this.activeStage || !isAttackSkill || modifiedSkill.aoe)
    return { targets, logPrefix: null };

  let newTargets = targets;
  let logPrefix: string | null = null;

  switch (this.activeStage.id) {
    case 'Labyrinth': {
      const allOtherAlive = currentPlayers.filter(
        (p) => p.status === 'alive' && p.id !== actor.id,
      );
      if (allOtherAlive.length > 0) {
        newTargets = [this.pickRandom(allOtherAlive)];
        logPrefix = '🌀【失重·盲击】';
      }
      break;
    }
    // 未来可在此处添加更多场地特性分支
  }
  return { targets: newTargets, logPrefix };
};

// ---------------------------------------------------------
// 模块 4：执行攻击行为 (技能抽取、目标选定、伤害结算与变身)
// ---------------------------------------------------------
DgpEngine.prototype._executeAttackAction = function (
  this: DgpEngine,
  actor: Player,
  currentPlayers: Player[],
  roundLogs: DgpLogEntry[],
  r: number,
  isEndgameInfighting: boolean,
  hasDgpProtection: boolean,
): void {
  const currentStage = this.activeStage?.id;
  const availableSkills: BuckleSkill[] = [];
  let hasRaising = false;
  let hasTwin = false;
  const actorHasTwin =
    !actor.isJyamato && !actor.isClone && actor.buckles.some((b) => b.id === 'Command_Twin');
  const actorHasFever =
    !actorHasTwin &&
    !actor.isJyamato &&
    !actor.isClone &&
    actor.buckles.some((b) => b.id === 'Fever');

  // 1. 技能组准备
  if (actor.isJyamato || actor.isClone) {
    (actor.skills || []).forEach((s) => availableSkills.push(s));
  } else {
    hasRaising =
      actor.buckles.some((b) => b.id === 'Command_Raising') ||
      (!!actor.feverSlot && actor.feverSlot.id === 'Command_Raising');
    hasTwin = actor.buckles.some((b) => b.id === 'Command_Twin');

    if (hasTwin && this.chance(COMMAND_MODE_SWITCH_CHANCE)) {
      actor.commandMode = actor.commandMode === 'Jet' ? 'Cannon' : 'Jet';
      const modeLog =
        actor.commandMode === 'Jet'
          ? `<span class="text-orange-400 font-bold italic drop-shadow-sm">🔄 驱动器音效：『 REVOLVE ON 』 ✈️ ${e(actor.name)} 切换至喷气机模式！</span>`
          : `<span class="text-cyan-400 font-bold italic drop-shadow-sm">🔄 驱动器音效：『 REVOLVE ON 』 炮 ${e(actor.name)} 切换至加农炮模式！</span>`;
      roundLogs.push({
        round: r,
        htmlText: modeLog,
        type: 'system_warning',
        delay: 1200,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }

    const slot0 = actor.buckles[0];
    const slot1 = actor.buckles[1];
    const addS = (b: BuckleDef | null | undefined, types: string[]) => {
      if (!b || (currentStage === 'Zero' && b.id === 'Boost')) return;
      b.skills.forEach((s) => {
        if (b.id === 'Command_Twin' && s.mode && s.mode !== actor.commandMode) return;
        if (types.includes(s.type) && (actor.cooldowns[s.name] || 0) <= 0)
          availableSkills.push(s);
      });
    };
    if (!slot0) addS(BUCKLES['Entry'], ['attack', 'tactical', 'ultimate']);
    else if (!slot1) addS(slot0, ['attack', 'tactical', 'ultimate']);
    else {
      addS(slot0, ['attack', 'ultimate']);
      addS(slot1, ['tactical']);
    }

    if (actor.feverSlot && actor.feverSlot.id !== 'Trash')
      addS(actor.feverSlot, ['attack', 'tactical', 'ultimate']);
    else if (actor.feverSlot && actor.feverSlot.id === 'Trash')
      addS(actor.feverSlot, ['attack']);

    if (actor.feverSlot && actor.feverSlot.id === 'Boost' && !actor.jackpotBurstReady) {
      availableSkills.push({
        name: 'Hyper Boostriker Rush',
        type: 'tactical',
        cd: 0,
        dmg: 3.5,
        hits: 5,
        randomTargets: true,
        ignoreDef: 0.8,
        effect: { type: 'Stun', duration: 1, chance: 0.8 },
      });
    }

    if (
      slot0 &&
      slot1 &&
      (slot0.tier === 'large' || slot0.tier === 'legendary') &&
      (slot1.tier === 'large' || slot1.tier === 'legendary')
    ) {
      const u0 = slot0.skills.find((s) => s.type === 'ultimate');
      const u1 = slot1.skills.find((s) => s.type === 'ultimate');
      if (
        u0 &&
        u1 &&
        (actor.cooldowns[u0.name] || 0) <= 0 &&
        (actor.cooldowns[u1.name] || 0) <= 0
      ) {
        const isBoost = slot0.id === 'Boost' || slot1.id === 'Boost';
        const isFever = slot0.id === 'Fever' || slot1.id === 'Fever';
        if (!(currentStage === 'Zero' && isBoost)) {
          availableSkills.push({
            name: '连携必杀',
            type: 'dual_ultimate',
            cd: 5,
            dmg: 3.2,
            aoe: false,
            ignoreShield: false,
            removeBoost: isBoost,
            lifesteal: slot0.id === 'Zombie' || slot1.id === 'Zombie' ? 0.3 : 0,
            effect:
              slot0.id === 'Monster' || slot1.id === 'Monster'
                ? { type: 'Stun', duration: 1, chance: 0.5 }
                : undefined,
            selfHeal: slot0.id === 'Beat' || slot1.id === 'Beat',
            healIntMult: 12,
            selfBuff:
              slot0.id === 'Beat' || slot1.id === 'Beat'
                ? { type: 'Atk Up', duration: 2 }
                : undefined,
            alwaysCrit: slot0.id === 'Magnum' || slot1.id === 'Magnum',
            hits: slot0.id === 'Ninja' || slot1.id === 'Ninja' ? 2 : 1,
            b1Name: slot0.name,
            b2Name: slot1.name,
            isBoostDual: isBoost,
            isFeverDual: isFever,
          });
        }
      }
    }

    if (hasRaising) {
      const baseAttack = availableSkills.find(
        (s) => s.name === '跃升斩剑·基础斩击' || s.name.includes('跃升斩剑'),
      );
      if (baseAttack) {
        if (actor.idCore.id === 'Fox') {
          baseAttack.name = '跃升斩剑·神速连斩';
          baseAttack.hits = 3;
          baseAttack.dmg = 1.5;
        } else if (actor.idCore.id === 'Bull') {
          if (this.chance(0.3)) {
            baseAttack.name = '跃升斩剑·自残蓄力';
            baseAttack.hits = 1;
            baseAttack.dmg = 2.5;
            baseAttack.selfDamage = 500;
            baseAttack.bonusCharge = 2;
          } else {
            baseAttack.name = '跃升斩剑·狂蛮重劈';
            baseAttack.hits = 1;
            baseAttack.dmg = 1.5;
          }
        } else if (actor.idCore.id === 'Tanuki') {
          baseAttack.name = '跃升斩剑·幸运抽奖';
          baseAttack.hits = this.chance(0.5) ? 4 : 1;
          baseAttack.dmg = 1.5;
          if (baseAttack.hits === 4) baseAttack.bonusCharge = 3;
        } else if (actor.idCore.id === 'Cat') {
          baseAttack.name = '跃升斩剑·灵动燕返';
          baseAttack.hits = 2;
          baseAttack.dmg = 1.2;
          baseAttack.selfBuff = { type: 'Dodge Up', duration: 1 };
          baseAttack.bonusCharge = 1;
        } else if (actor.idCore.id === 'Pumpkin') {
          baseAttack.name = '跃升斩剑·荆棘重砸';
          baseAttack.hits = 1;
          baseAttack.dmg = 1.5;
          baseAttack.shield = true;
          baseAttack.hpScale = 0.1;
        } else if (actor.idCore.id === 'Wolf') {
          baseAttack.name = '跃升斩剑·嗜血狂舞';
          baseAttack.hits = 2;
          baseAttack.dmg = 1.0 + (1 - actor.hp / actor.maxHp);
          baseAttack.lifesteal = 0.2;
          baseAttack.bonusCharge = this.chance(0.5) ? 1 : 0;
        } else if (actor.idCore.id === 'Penguin') {
          baseAttack.name = '跃升斩剑·抗压反击';
          baseAttack.hits = 1;
          baseAttack.dmg = 1.2;
          baseAttack.selfBuff = { type: 'Shield', hpScale: 0.15 };
        } else if (actor.idCore.id === 'Eagle') {
          baseAttack.name = '跃升斩剑·鹰眼精准打击';
          baseAttack.hits = 1;
          baseAttack.dmg = 1.5;
          baseAttack.alwaysHit = true;
        }
      }
    }
  }
  if (availableSkills.length === 0) availableSkills.push(BUCKLES['Entry'].skills[0]);

  let chosenSkill = availableSkills[0];
  let isBurstingJackpot = false;

  if (actor.jackpotBurstReady && actor.feverSlot && actor.feverSlot.id !== 'Trash') {
    const sourceBuckle = BUCKLES[actor.feverSlot.id];
    const ultSkill =
      sourceBuckle.skills.find((s) => s.type === 'ultimate' || s.type === 'tactical') ||
      sourceBuckle.skills[0];
    chosenSkill = deepClone(ultSkill);
    isBurstingJackpot = true;
    actor.jackpotBurstReady = false;
  } else {
    const weightMap: Record<string, number> = {
      dual_ultimate: 5,
      ultimate: 3,
      tactical: 2,
      attack: 1,
    };
    const totalW = availableSkills.reduce((sum, s) => sum + (weightMap[s.type] || 1), 0);
    let rNum = this.random() * totalW;
    for (const s of availableSkills) {
      rNum -= weightMap[s.type] || 1;
      if (rNum <= 0) {
        chosenSkill = s;
        break;
      }
    }
  }

  const modifiedSkill = deepClone(chosenSkill);
  if (
    modifiedSkill.name.includes('Tactical Blast') ||
    modifiedSkill.name.includes('战术爆破') ||
    modifiedSkill.name.includes('战术粉碎') ||
    isBurstingJackpot
  ) {
    modifiedSkill.isWeaponSlotSkill = true;
  }

  // 2. 连携组合解析与冷却重置
  const { weaponLog, sourceBuckle } = this.resolveSkillCombo(
    actor,
    modifiedSkill,
    isBurstingJackpot,
    currentPlayers,
  );

  if (chosenSkill.cd > 0 && currentStage !== 'Zero')
    actor.cooldowns[chosenSkill.name] = chosenSkill.cd;
  if (chosenSkill.type === 'dual_ultimate' && currentStage !== 'Zero') {
    actor.buckles.forEach((b) =>
      b.skills.forEach((s) => {
        if (s.type === 'ultimate') actor.cooldowns[s.name] = s.cd;
      }),
    );
  }

  // 3. 寻找倒霉的目标
  let potentialTargets: Player[] = [];
  const aliveHumans = currentPlayers.filter((p) => p.status === 'alive' && !p.isJyamato);
  const aliveMonsters = currentPlayers.filter((p) => p.status === 'alive' && p.isJyamato);
  const isFriendly = (a: Player, b: Player) =>
    a.id === b.id ||
    a.ownerId === b.id ||
    b.ownerId === a.id ||
    (!!a.ownerId && a.ownerId === b.ownerId);
  const otherHumans = aliveHumans.filter((p) => !isFriendly(actor, p));

  if (actor.isJyamato) {
    if (isEndgameInfighting) {
      const otherMonsters = aliveMonsters.filter((m) => m.id !== actor.id);
      if (this.chance(0.5) && otherMonsters.length > 0) potentialTargets = otherMonsters;
      else potentialTargets = aliveHumans;
      if (modifiedSkill.aoe) potentialTargets = [...aliveHumans, ...otherMonsters];
    } else potentialTargets = aliveHumans;
  } else {
    const hasEnemyBounty = otherHumans.some((p) => p.isBountyTarget);
    if (hasEnemyBounty && this.chance(0.8)) {
      potentialTargets = [...aliveMonsters, ...otherHumans];
    } else if (aliveMonsters.length > 0) {
      if (this.chance(0.85)) potentialTargets = aliveMonsters;
      else potentialTargets = otherHumans.length > 0 ? otherHumans : aliveMonsters;
    } else potentialTargets = otherHumans;
  }

  potentialTargets.sort(
    (a, b) =>
      getThreatScore(actor, b, modifiedSkill, this.rngNext) -
      getThreatScore(actor, a, modifiedSkill, this.rngNext),
  );

  let targets: Player[] = [];
  const targetHits = new Map<string, number>();
  const isAttackSkill = modifiedSkill.dmg > 0 || !!modifiedSkill.effect;

  if (isAttackSkill && potentialTargets.length > 0) {
    if (modifiedSkill.dynamicMagnumJackpot) {
      const lockedTargets = potentialTargets.filter((t) =>
        t.buffs.some((b) => b.type === 'Locked-on'),
      );
      if (lockedTargets.length > 0) {
        modifiedSkill.aoe = false;
        modifiedSkill.randomTargets = true;
        modifiedSkill.hits = 8;
        modifiedSkill.dmg = 3.8;
        for (let i = 0; i < 8; i++) {
          const t = this.pickRandom(lockedTargets);
          targetHits.set(t.id, (targetHits.get(t.id) || 0) + 1);
        }
        targets = lockedTargets.filter((p) => targetHits.has(p.id));
      } else if (potentialTargets.length === 1) {
        targets = potentialTargets;
        modifiedSkill.aoe = false;
        modifiedSkill.randomTargets = false;
        modifiedSkill.hits = 8;
        modifiedSkill.dmg = 3.8;
      } else {
        targets = potentialTargets;
        modifiedSkill.aoe = true;
        modifiedSkill.randomTargets = false;
        modifiedSkill.hits = 4;
        modifiedSkill.dmg = 3.8;
      }
    } else if (modifiedSkill.aoe) {
      targets = potentialTargets;
      modifiedSkill.randomTargets = false;
    } else if (modifiedSkill.maxTargets) {
      const shuffled = [...potentialTargets].sort(() => this.random() - 0.5);
      targets = shuffled.slice(0, modifiedSkill.maxTargets);
      modifiedSkill.randomTargets = false;
    } else if (modifiedSkill.randomTargets) {
      const totalHits = modifiedSkill.hits || 1;
      for (let i = 0; i < totalHits; i++) {
        const t = this.pickRandom(potentialTargets);
        if (t) targetHits.set(t.id, (targetHits.get(t.id) || 0) + 1);
      }
      targets = potentialTargets.filter((p) => targetHits.has(p.id));
    } else if (modifiedSkill.target === 'lowest_hp')
      targets = [potentialTargets.sort((a, b) => a.hp - b.hp)[0]];
    else targets = [potentialTargets[0]];
  }

  const stageMod = this._applyStageTargetModifiers(
    actor,
    targets,
    modifiedSkill,
    currentPlayers,
    isAttackSkill,
  );
  targets = stageMod.targets;
  const stageActionPrefix = stageMod.logPrefix;

  // 4. 播报文案渲染
  let tempAtk = actor.atk;
  if (actor.isJyamato && currentStage === 'Carnival') tempAtk = Math.floor(tempAtk * 1.5);

  let logDelay =
    modifiedSkill.type === 'attack'
      ? 500
      : modifiedSkill.type.includes('ultimate')
        ? 1500
        : 800;
  const isDualBoost = modifiedSkill.type === 'dual_ultimate' && !!modifiedSkill.isBoostDual;
  const isDualFever = modifiedSkill.type === 'dual_ultimate' && !!modifiedSkill.isFeverDual;

  if (modifiedSkill.isJackpot || modifiedSkill.isHyperGrandVictory || modifiedSkill.isTrueFeverBoost)
    logDelay = 3500;
  else if (modifiedSkill.type === 'dual_ultimate') {
    if (isDualFever) logDelay = 3000;
    else if (isDualBoost) logDelay = 2500;
    else logDelay = 2000;
  } else if (modifiedSkill.isWeaponSlotSkill) logDelay = 2500;

  let actionPrefix = stageActionPrefix || '【攻击·普通】';
  if (modifiedSkill.isTrueFeverBoost) actionPrefix = '🌟【真·狂热大胜利】';
  else if (modifiedSkill.isHyperGrandVictory) actionPrefix = '🌟【超限宏大胜利】';
  else if (modifiedSkill.isJackpot) actionPrefix = '🌟【黄金狂热大胜利】';
  else if (modifiedSkill.isWeaponSlotSkill) actionPrefix = '【武器联动·必杀】';
  else if (modifiedSkill.type === 'tactical') actionPrefix = '【攻击·战术】';
  else if (modifiedSkill.type === 'ultimate') actionPrefix = '【攻击·必杀】';
  else if (modifiedSkill.type === 'dual_ultimate') {
    if (isDualFever) actionPrefix = '【攻击·狂热连携必杀】';
    else actionPrefix = modifiedSkill.removeBoost ? '【攻击·推进器连携必杀】' : '【攻击·连携必杀】';
  }

  let fullActionLog = '';
  if (modifiedSkill.type === 'dual_ultimate') {
    if (isDualFever) {
      const otherName = modifiedSkill.b1Name === '狂热插槽' ? modifiedSkill.b2Name : modifiedSkill.b1Name;
      fullActionLog = `${actionPrefix} 💥 ${e(actor.name)} 发动了 超级${otherName}胜利！！！！！！`;
    } else if (isDualBoost) {
      const otherName = modifiedSkill.b1Name === '推进器' ? modifiedSkill.b2Name : modifiedSkill.b1Name;
      let otherBuckleObj: BuckleDef | null | undefined = actor.buckles
        ? actor.buckles.find((b) => b.name === otherName)
        : null;
      if (!otherBuckleObj && actor.feverSlot && actor.feverSlot.id !== 'Trash')
        otherBuckleObj = actor.feverSlot;
      const coreName = actor.idCore ? actor.idCore.name : '机车';

      let boostDualText = '';
      const voiceStyle = 'font-black text-xl italic tracking-widest drop-shadow-md';

      if (otherBuckleObj && otherBuckleObj.id === 'Magnum')
        boostDualText = `${actionPrefix}<br/>🎯🔥 <span class="${voiceStyle}">【MAGNUM! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 跨上推进者摩托，在极速冲刺中拔出马格南射击者，将推进器的极致火焰与马格南的破坏光束融合，轰出了撕裂战场的黄金爆破！`;
      else if (otherBuckleObj && otherBuckleObj.id === 'Zombie')
        boostDualText = `${actionPrefix}<br/>☠️🔥 <span class="${voiceStyle}">【ZOMBIE! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 驱动推进器爆发猩红火光，与僵尸的紫色猛毒交织！驾驶推进者摩托碾碎地面的同时，挥舞极限充能的僵尸破坏者，劈出撕裂空间与生命的剧毒烈焰断头台！`;
      else if (otherBuckleObj && otherBuckleObj.id === 'Ninja')
        boostDualText = `${actionPrefix}<br/>🥷🔥 <span class="${voiceStyle}">【NINJA! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 推进器马力全开，与忍者的风遁残影完美结合！化作漫天交织的风火轮之影，随后在推进者摩托的极限加速下，以无法观测的神速斩出焚风十字瞬杀！`;
      else if (otherBuckleObj && otherBuckleObj.id === 'Monster')
        boostDualText = `${actionPrefix}<br/>☄️🔥 <span class="${voiceStyle}">【MONSTER! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 推进器的尾焰狂喷，将怪兽的巨兽本能推至绝对顶点！伴随着星耀与烈焰，连同变形为 <span class="text-red-200 font-bold">[机械${coreName}]</span> 模式的推进者摩托一同化作坠落的红蓝色超重力流星，将整个战场彻底砸穿！`;
      else if (otherBuckleObj && otherBuckleObj.id === 'Beat')
        boostDualText = `${actionPrefix}<br/>🎵🔥 <span class="${voiceStyle}">【BEAT! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 推进器引擎的轰鸣与节拍的狂暴摇滚产生共鸣！弹奏出燃尽一切的死亡重金属，推进者摩托化作穿梭音符的烈焰舞台，向全场轰出震碎灵魂的爆裂火之音轨！`;
      else {
        const soundName = otherBuckleObj ? otherBuckleObj.id.toUpperCase() : 'UNKNOWN';
        boostDualText = `${actionPrefix}<br/>💥🔥 <span class="${voiceStyle}">【${soundName}! BOOST! GRAND VICTORY!】</span><br/>${e(actor.name)} 发动了 ${otherName}·推进器 大胜利！！！！！`;
      }
      fullActionLog = `<span class="text-purple-400 font-bold tracking-wide">${boostDualText}</span>`;
    } else {
      fullActionLog = `${actionPrefix} 💥 ${e(actor.name)} 发动了 ${modifiedSkill.b1Name}·${modifiedSkill.b2Name} 胜利！`;
    }
  } else {
    if (modifiedSkill.name === 'Hyper Boostriker Rush') {
      fullActionLog = `<span class="text-red-400 font-bold tracking-wide">${actionPrefix} 🏍️🔥 ${e(actor.name)} 狂热插槽爆发！扭动拉杆，竟从虚空中强行召唤出 4 台猩红的【推进者摩托】！五骑并驱，化作狂暴的火焰车队对全场进行极速碾压！</span>`;
    } else if (
      sourceBuckle &&
      sourceBuckle.id === 'Boost' &&
      !modifiedSkill.isJackpot &&
      !modifiedSkill.isHyperGrandVictory &&
      !modifiedSkill.isTrueFeverBoost
    ) {
      const coreName = actor.idCore ? actor.idCore.name : '机车';
      let boostText = '';
      if (modifiedSkill.name.includes('Boost Time'))
        boostText = `${actionPrefix} 🔥 ${e(actor.name)} 连续两次扭动推进器把手！【Boost Time！】引擎发出震耳欲聋的轰鸣，全身喷发出猩红的烈焰，进入了超越极限的加速爆发状态！`;
      else if (modifiedSkill.name.includes('狂兽突击'))
        boostText = `${actionPrefix} 🏍️ ${e(actor.name)} 召唤出赤红的 <span class="text-gray-100">[推进者摩托]</span>！摩托车在半空中变形为巨大的 <span class="text-red-200 font-bold">[机械${coreName}]</span>！向全场喷射出焚毁一切的烈焰火海！`;
      else if (modifiedSkill.name.includes('Boost Strike'))
        boostText = `${actionPrefix} 🔥 ${e(actor.name)} 极限扭动把手！【Boost Strike！】将推进器喷射的尾焰压缩至腿部，化作一颗陨石般的火球踢爆了目标！`;
      else boostText = `${actionPrefix} ${e(actor.name)} 使用 [${modifiedSkill.name}]`;
      fullActionLog = `<span class="text-purple-400 font-bold tracking-wide">${boostText}</span>`;
    } else if (modifiedSkill.isWeaponSlotSkill) {
      fullActionLog = `${actionPrefix} ${e(actor.name)} ${weaponLog}`;
    } else {
      fullActionLog = `${actionPrefix} ${e(actor.name)} ${weaponLog}使用 [${modifiedSkill.name}]`;
    }
  }

  const isStageChaos = !!stageActionPrefix;
  if (
    !isStageChaos &&
    !actor.isJyamato &&
    !actor.isClone &&
    aliveMonsters.length > 0 &&
    targets.length > 0 &&
    targets.some((t) => !t.isJyamato) &&
    !modifiedSkill.selfHeal &&
    !modifiedSkill.selfBuff &&
    !modifiedSkill.selfDamage
  ) {
    if (targets.some((t) => t.isBountyTarget))
      roundLogs.push({
        round: r,
        text: `🤑【贪婪诱惑】人为财死！${actor.name} 无视了周围的邪魔徒，将贪婪的攻击砸向了悬赏目标！`,
        type: 'system_danger',
        delay: 1500,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    else
      roundLogs.push({
        round: r,
        text: `😈【内斗】场上明明还有邪魔徒，${actor.name} 却把枪口对准了其他骑士！`,
        type: 'system_danger',
        delay: 1500,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
  }

  // 5. 自身增益处理
  if (
    modifiedSkill.selfBuff ||
    modifiedSkill.selfHeal ||
    modifiedSkill.summon ||
    modifiedSkill.shield ||
    modifiedSkill.selfDamage
  ) {
    const selfLogs: string[] = [];
    if (modifiedSkill.selfDamage) {
      actor.hp -= modifiedSkill.selfDamage;
      selfLogs.push(`🩸自残-${modifiedSkill.selfDamage}HP`);
      if (actor.hp <= 0 && !this.checkUndead(actor, currentPlayers, roundLogs, r, '在自残蓄力时')) {
        actor.hp = 1;
      }
    }
    if (modifiedSkill.shield) {
      if (currentStage === 'Asura') selfLogs.push(`❌护盾生成失败(修罗场限制)`);
      else {
        let scale = modifiedSkill.hpScale || 0.3;
        if (currentStage === 'Defense') scale *= 2;
        actor.shield = Math.floor(actor.maxHp * scale);
        selfLogs.push(`🛡️护盾+${actor.shield}`);
      }
    }
    if (modifiedSkill.selfBuff) {
      if (modifiedSkill.selfBuff.type === 'Shield') {
        if (currentStage === 'Asura') selfLogs.push(`❌护盾生成失败(修罗场限制)`);
        else {
          let scale = modifiedSkill.selfBuff.hpScale || 0.25;
          if (currentStage === 'Defense') scale *= 2;
          actor.shield = Math.floor(actor.maxHp * scale);
          selfLogs.push(`🛡️护盾+${actor.shield}`);
        }
      } else {
        applyBuff(actor, modifiedSkill.selfBuff.type, modifiedSkill.selfBuff.duration || 0, actor.id);
        selfLogs.push(`获得 [${BUFF_DICT[modifiedSkill.selfBuff.type]}]`);
      }
    }
    if (modifiedSkill.selfHeal) {
      let healAmount = actor.int * (modifiedSkill.healIntMult || 12);
      if (actor.buffs && actor.buffs.some((b) => b.type === 'Poison'))
        healAmount = Math.floor(healAmount * 0.5);
      actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
      selfLogs.push(`💚治愈+${healAmount}`);
    }
    if (modifiedSkill.summon) {
      const existingClone = currentPlayers.find(
        (p) => p.isClone && p.ownerId === actor.id && p.status === 'alive' && !p.toBeRemoved,
      );
      if (existingClone) {
        existingClone.cloneDuration = modifiedSkill.summon.duration;
        existingClone.hp = existingClone.maxHp;
        selfLogs.push(`刷新了 [${modifiedSkill.summon.name}]`);
      } else {
        const ratio = modifiedSkill.summon.inheritStats || 0.3;
        const clone: Player = {
          id: this.makeEntityId(`${actor.id}_clone`),
          name: `${actor.name}的${modifiedSkill.summon.name}`,
          icon: '🌪️',
          isClone: true,
          ownerId: actor.id,
          cloneDuration: modifiedSkill.summon.duration,
          str: Math.max(10, Math.floor(actor.str * ratio)),
          agi: Math.max(10, Math.floor(actor.agi * ratio)),
          int: Math.max(10, Math.floor(actor.int * ratio)),
          baseHp: Math.max(100, Math.floor(actor.maxHp * ratio)),
          maxHp: Math.max(100, Math.floor(actor.maxHp * ratio)),
          hp: Math.max(100, Math.floor(actor.maxHp * ratio)),
          baseAtk: Math.max(10, Math.floor(actor.atk * ratio)),
          atk: Math.max(10, Math.floor(actor.atk * ratio)),
          buckles: [],
          skills: [{ name: '风遁连斩', type: 'attack', cd: 0, dmg: 0.8, hits: 2 }],
          status: 'alive',
          kills: 0,
          feverSlot: null,
          inventory: null,
          buffs: [],
          cooldowns: {},
          shield: 0,
          isBountyTarget: false,
          isJyamato: false,
          idCore: {
            id: 'CloneCore',
            name: '分身核心',
            icon: '🌪️',
            passive: 'none',
            passiveName: '忍法分身',
            passiveDesc: '实体分身，与本体协同作战',
            affinity: 'Ninja',
          },
        };
        currentPlayers.push(clone);
        selfLogs.push(`召唤了 [${modifiedSkill.summon.name}]`);
      }
    }
    fullActionLog += `，自身 ${selfLogs.join(' ')}！`;
  }
  if (isAttackSkill && targets.length === 0) fullActionLog += `，但并没有找到有效目标...`;

  const settlementLogs: string[] = [];
  let chargeGainedThisTurn = 0;

  // 6. 伤害结算
  if (targets.length > 0) {
    targets.forEach((target) => {
      const hits = modifiedSkill.randomTargets
        ? targetHits.get(target.id) || 0
        : modifiedSkill.hits || 1;
      let actualHits = 0;
      let totalDmg = 0;
      const hitDetails: string[] = [];

      let applyDgpProtection = hasDgpProtection && !actor.isJyamato && !target.isJyamato;
      if (currentStage === 'Asura') applyDgpProtection = false;

      for (let h = 0; h < hits; h++) {
        if (target.hp <= 0 && !target.isUndeadActiveThisTurn) break;

        let dodgeChance = getEffectiveAgi(target) * 0.0015;
        const isPhantom = target.buffs.some((b) => b.type === 'Phantom');
        if (isPhantom) {
          dodgeChance = 1.0;
          if (h === 0) target.buffs = target.buffs.filter((b) => b.type !== 'Phantom');
        }
        if (target.buffs.some((b) => b.type === 'Dodge Up')) dodgeChance += 0.2;
        if (!target.isJyamato && target.idCore?.passive === 'agile')
          dodgeChance += target.buckles.some((b) => b.id === 'Fever') ? 0.3 : 0.15;
        if (currentStage === 'Midnight') dodgeChance += 0.3;

        const dodgeSuccess = this.chance(dodgeChance);
        let isGraze = false;
        if (dodgeSuccess && modifiedSkill.dmg > 0) {
          let guaranteed =
            modifiedSkill.alwaysHit || target.buffs.some((b) => b.type === 'Locked-on');
          if (!guaranteed && !actor.isJyamato && actor.idCore && actor.idCore.passive === 'precise') {
            if (actorHasFever) guaranteed = true;
            else if (!isPhantom && !target.buffs.some((b) => b.type === 'Dodge Up'))
              guaranteed = true;
          }
          if (guaranteed) {
            isGraze = true;
            if (h === 0) hitDetails.push('擦伤');
          } else continue;
        }

        if (modifiedSkill.dmg > 0) {
          let baseDamage = modifiedSkill.magic
            ? actor.int * 2 + tempAtk * 0.5
            : tempAtk * 1.0 + actor.str * 1.5;

          baseDamage *= modifiedSkill.dmg / (modifiedSkill.hits || 1);

          if (isGraze) baseDamage *= 0.3;
          if (actor.buffs.some((b) => b.type === 'Atk Up')) baseDamage *= 1.3;
          if (actor.buffs.some((b) => b.type === 'Burst')) baseDamage *= 1.5;
          if (target.buffs.some((b) => b.type === 'Vulnerable')) baseDamage *= 1.3;

          let meetsCond = false;
          if (modifiedSkill.cond === 'hasClone')
            meetsCond = currentPlayers.some(
              (p) => p.isClone && p.ownerId === actor.id && p.status === 'alive' && !p.toBeRemoved,
            );
          else if (modifiedSkill.cond)
            meetsCond = target.buffs.some((b) => b.type === modifiedSkill.cond);

          if (meetsCond) {
            baseDamage *= modifiedSkill.condMult || 1.5;
            if (h === 0 && modifiedSkill.cond === 'hasClone' && !hitDetails.includes('👥分身连携'))
              hitDetails.push('👥分身连携');
          }

          const forceCrit = currentStage === 'Midnight';
          if (forceCrit) {
            baseDamage *= 1.5;
            if (h === 0 && !isGraze && !hitDetails.includes('🌑暗夜暴击'))
              hitDetails.push('🌑暗夜暴击');
          } else if (!actor.isJyamato && !actor.isClone) {
            if (actor.buckles.some((b) => b.id === actor.idCore.affinity)) baseDamage *= 1.3;
            if (target.shield <= 0) {
              let critChance = actorHasFever ? 0.4 : 0.2;
              if (target.buffs.some((b) => b.type === 'Locked-on')) critChance += 0.3;
              const baseCritMult = actor.idCore.id === 'Fox' ? 1.35 : 1.2;
              const critMult =
                (actorHasFever ? baseCritMult + 0.2 : baseCritMult) +
                (modifiedSkill.tags?.includes('ranged') ? actor.agi / 150 : 0);
              if (
                (actor.idCore.passive === 'crit' && this.chance(critChance)) ||
                modifiedSkill.alwaysCrit
              ) {
                baseDamage *= critMult;
                if (h === 0 && !isGraze && !hitDetails.includes('暴击')) hitDetails.push('暴击');
              }
            } else if (
              modifiedSkill.alwaysCrit ||
              (actor.idCore.passive === 'crit' && this.chance(0.2))
            ) {
              if (h === 0 && !hitDetails.includes('🛡️护盾抵消暴击')) hitDetails.push('🛡️护盾抵消暴击');
            }
            if (
              actor.idCore.passive === 'blood' &&
              actor.hp < actor.maxHp * (actorHasFever ? 0.8 : 0.5)
            ) {
              baseDamage *= actorHasFever ? 1.8 : 1.4;
              if (h === 0 && !hitDetails.includes('嗜血')) hitDetails.push('嗜血');
            }
          }

          if (!target.isJyamato && target.idCore?.passive === 'survive')
            baseDamage *= target.buckles.some((b) => b.id === 'Fever') ? 0.7 : 0.85;
          if (modifiedSkill.ignoreDef) {
            baseDamage *= 1 + modifiedSkill.ignoreDef;
            if (h === 0) hitDetails.push('无视防御');
          }
          if (modifiedSkill.trueDmg) {
            baseDamage *= 1.5;
            if (h === 0) hitDetails.push('真实伤害');
          }

          if (applyDgpProtection) {
            if (currentStage === 'Ceasefire') {
              baseDamage = 0;
              if (h === 0 && !hitDetails.includes('🕊️停战协议')) hitDetails.push('🕊️停战协议');
            } else {
              baseDamage *= 0.35;
              if (h === 0 && !hitDetails.includes('🛡️DGP保护')) hitDetails.push('🛡️DGP保护');
            }
          }

          if (currentStage === 'Defense') baseDamage *= 0.5;
          let hitDmg = Math.floor(baseDamage * (0.9 + this.random() * 0.2));

          if (target.shield > 0 && !modifiedSkill.ignoreShield) {
            if (target.shield >= hitDmg) {
              target.shield -= hitDmg;
              hitDmg = 0;
            } else {
              hitDmg -= target.shield;
              target.shield = 0;
              hitDetails.push('破盾');
            }
          } else if (modifiedSkill.ignoreShield && target.shield > 0) {
            target.shield = 0;
            hitDetails.push('贯穿护盾');
          }

          totalDmg += hitDmg;
          actualHits++;
          if (hasRaising) chargeGainedThisTurn++;

          if (hitDmg > 0) {
            target.hp -= hitDmg;
            if (target.hp <= 0) {
              if (this.checkUndead(target, currentPlayers, roundLogs, r, '在狂风暴雨般的连击中')) {
                if (!hitDetails.includes('锁血')) hitDetails.push('锁血');
              }
            }
          }
        }
      }

      if (modifiedSkill.dmg > 0) {
        if (actualHits === 0) {
          settlementLogs.push(`💨 <span class="text-gray-400">被 ${e(target.name)} 闪避</span>`);
        } else {
          let droppedBuckle: BuckleDef | null = null;
          if (
            target.hp > 0 &&
            totalDmg > target.maxHp * DISARM_DMG_THRESHOLD_SCALE &&
            !target.isJyamato &&
            !target.isClone
          ) {
            const largeBuckleIndex = target.buckles.findIndex((b) =>
              ['large', 'legendary', 'mythic'].includes(b.tier),
            );
            if (largeBuckleIndex !== -1 && this.chance(0.3)) {
              droppedBuckle = target.buckles.splice(largeBuckleIndex, 1)[0];
              this.updatePlayerStats(target);
              hitDetails.push(`掉落[${droppedBuckle.name}]`);
            }
          }

          let targetStr = `⚔️ 对 ${target.name} 造成 ${totalDmg > 0 ? `<span class="text-orange-400 font-bold">💥${totalDmg}</span>` : '0'} 伤害${modifiedSkill.randomTargets ? `(命中${actualHits}次)` : ''}`;
          let ls = modifiedSkill.lifesteal || 0;
          if (actor.isJyamato && currentStage === 'Carnival') ls = 0.3;

          if (ls > 0) {
            let heal = Math.floor(totalDmg * ls);
            if (actor.buffs && actor.buffs.some((b) => b.type === 'Poison'))
              heal = Math.floor(heal * 0.5);
            actor.hp = Math.min(actor.maxHp, actor.hp + heal);
            hitDetails.push(`💚吸血+${heal}`);
          }
          if (!target.isJyamato && target.idCore?.passive === 'thorns') {
            const targetHasFever = target.buckles && target.buckles.some((b) => b.id === 'Fever');
            const recoil = Math.floor(totalDmg * (targetHasFever ? 0.4 : 0.2));
            actor.hp -= recoil;
            hitDetails.push(`🩸被反伤-${recoil}`);
            if (actor.hp <= 0) this.checkUndead(actor, currentPlayers, roundLogs, r, '遭到荆棘反伤时');
          }
          if (modifiedSkill.effect && actualHits > 0 && target.shield <= 0) {
            const applyChance = (modifiedSkill.effect.chance || 1.0) + actor.int / 200;
            if (this.chance(applyChance)) {
              if (applyBuff(target, modifiedSkill.effect.type, modifiedSkill.effect.duration || 0, actor.id))
                hitDetails.push(`附加 [${BUFF_DICT[modifiedSkill.effect.type]}]`);
            }
          }
          if (modifiedSkill.dispelBuffs && actualHits > 0) {
            target.buffs = target.buffs.filter((b) =>
              ['Poison', 'Stun', 'Vulnerable', 'Locked-on', 'Wet'].includes(b.type),
            );
            target.shield = 0;
            hitDetails.push(`净化其增益`);
          }

          if (hitDetails.length > 0)
            targetStr += ` <span class="text-xs text-gray-300">(${hitDetails.join(', ')})</span>`;
          settlementLogs.push(targetStr);

          if (droppedBuckle) {
            const stealChance =
              !actor.isJyamato && actor.idCore.id === 'Bull' ? BULL_STEAL_CHANCE : GENERIC_STEAL_CHANCE;
            settlementLogs.push(
              `💥 <span class="text-orange-400 font-bold">【武装击飞】</span>${e(target.name)} 被打落了 ⭐[${droppedBuckle.name}]！`,
            );

            if (!actor.isJyamato && this.chance(stealChance)) {
              const equipResult = this.equipBuckle(
                actor,
                droppedBuckle.id,
                '顺手接住了空中的',
                '🫴【强夺】',
              );
              settlementLogs.push(
                `&nbsp;&nbsp;&nbsp;└ 🫴 <span class="text-red-400 font-bold">【强夺】</span>${e(actor.name)} 抢走了它！<span class="text-gray-400 text-xs">(${equipResult.log})</span>`,
              );
            } else {
              this.groundBuckles.push(droppedBuckle.id);
              settlementLogs.push(`&nbsp;&nbsp;&nbsp;└ 🌟 带扣掉落在了战场上！`);
            }
          }
        }
      }
    });
  }

  let extraReadTime = 0;
  if (settlementLogs.length > 0) {
    let boxHtml = `<div class="mt-2 pl-3 pr-2 py-2 bg-black/30 border-l-2 border-orange-500/80 rounded-r shadow-inner space-y-1.5 text-sm">`;
    boxHtml += settlementLogs.map((log) => `<div>${log}</div>`).join('');
    boxHtml += `</div>`;
    fullActionLog += boxHtml;
    extraReadTime = settlementLogs.length * 600;
  }

  // 7. 跃升斩剑充能
  if (hasRaising && actor.status === 'alive') {
    if (modifiedSkill.bonusCharge) chargeGainedThisTurn += modifiedSkill.bonusCharge;
    if (chargeGainedThisTurn > 0) {
      actor.commandCharges = (actor.commandCharges || 0) + chargeGainedThisTurn;
      fullActionLog += `<br/><div class="mt-2 px-3 py-1 bg-blue-900/40 border border-blue-500/50 rounded inline-block text-blue-300 text-xs font-bold drop-shadow-sm animate-pulse">🔋 跃升斩剑充能 +${chargeGainedThisTurn} (当前: ${actor.commandCharges}/10)</div>`;
    }
  }

  roundLogs.push({
    round: r,
    htmlText: fullActionLog,
    type:
      modifiedSkill.type.includes('ultimate') ||
      modifiedSkill.type === 'dual_ultimate' ||
      modifiedSkill.isJackpot
        ? 'system_warning'
        : 'combat',
    delay: logDelay,
    extraReadTime: extraReadTime,
    actorId: actor.id,
    targetIds: targets.map((t) => t.id),
    activeStage: this.activeStage,
    snapshot: deepClone(currentPlayers),
  });

  // 8. 双重指挥满充能觉醒
  if (hasRaising && (actor.commandCharges || 0) >= COMMAND_TWIN_AWAKEN_CHARGES && actor.status === 'alive') {
    actor.commandCharges = 0;
    actor.commandMode = 'Jet';

    const droppedBuckles: BuckleDef[] = actor.buckles.filter((b) => b.id !== 'Command_Raising');
    if (
      actor.feverSlot &&
      actor.feverSlot.id !== 'Trash' &&
      actor.feverSlot.id !== 'Command_Raising'
    )
      droppedBuckles.push(actor.feverSlot);
    if (actor.inventory) droppedBuckles.push(actor.inventory);

    actor.buckles = [deepClone(BUCKLES['Command_Twin'])];
    actor.feverSlot = null;
    actor.inventory = null;
    this.updatePlayerStats(actor);
    actor.hp = actor.maxHp;

    let awakenLog = `<br/><div class="mt-4 p-4 border border-cyan-500/50 bg-black/50 rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.3)]">`;
    awakenLog += `<div class="text-blue-400 font-bold drop-shadow-md text-base mb-1">🔋 【FULL CHARGE】 跃升斩剑爆发出耀眼的蓝光，能量满载！</div>`;
    awakenLog += `<div class="text-red-400 font-bold mb-1">🔄 ${e(actor.name)} 从跃升斩剑上拔出加农炮部件，将原本除喷射器外的带扣全部粗暴地扯下丢弃！</div>`;
    awakenLog += `<div class="text-yellow-400 font-bold italic tracking-wider mb-2">⚔️ 插入了加农炮带扣【TWIN SET!】拉动加农炮带扣摇杆【TAKE OFF COMPLETE! JET & CANNON! READY FIGHT! 】</div>`;
    awakenLog += `<div class="text-cyan-300 font-black text-xl drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">🌌 ${e(actor.name)} 变身为 传说中的 🌌[双重指挥形态 (Command Twin)]！全场威压剧增！</div>`;

    if (droppedBuckles.length > 0) {
      droppedBuckles.forEach((b) => {
        if (['large', 'legendary', 'mythic'].includes(b.tier)) this.groundBuckles.push(b.id);
      });
      awakenLog += `<div class="text-gray-400 text-xs mt-2">（由于双重指挥独占了驱动器的两侧，被强行卸下的高级带扣散落在了战场上）</div>`;
    }
    awakenLog += `</div>`;

    roundLogs.push({
      round: r,
      htmlText: awakenLog,
      type: 'loot_epic',
      delay: 4000,
      actorId: actor.id,
      activeStage: this.activeStage,
      snapshot: deepClone(currentPlayers),
    });
  }

  // 9. 消耗型带扣的反噬与回收
  if (actor.buckles && actor.buckles.some((b) => b.tags.includes('consumable'))) {
    const normalBoostIndex = actor.buckles.findIndex((b) => b.tags.includes('consumable'));
    if (normalBoostIndex !== -1 && modifiedSkill.removeBoost) {
      const normalBoost = actor.buckles[normalBoostIndex];
      actor.buckles.splice(normalBoostIndex, 1);
      let boostLog = '能量耗尽飞离';
      if (actor.inventory) {
        const backup = actor.inventory;
        actor.inventory = null;
        if (actor.buckles.some((b) => b.id === backup.id)) {
          let healAmount = Math.floor(backup.hp * 0.5);
          if (actor.buffs && actor.buffs.some((b) => b.type === 'Poison'))
            healAmount = Math.floor(healAmount * 0.5);
          actor.hp = Math.min(actor.maxHp, actor.hp + healAmount);
          boostLog = `能量耗尽飞离！备用的 [${backup.name}] 无法重叠兼容，化为纯粹能量恢复 ${healAmount} HP`;
        } else {
          actor.buckles.push(backup);
          boostLog = `能量耗尽飞离！自动载入备用带扣 [${backup.name}]`;
        }
      } else if (actor.buckles.length === 0) boostLog = `能量耗尽飞离！退回 素体 (Entry) 形态`;
      else boostLog = `能量耗尽飞离！武装降级`;

      roundLogs.push({
        round: r,
        text: `🚀 ${actor.name} 的 [${normalBoost.name}] ${boostLog}！`,
        type: 'system_warning',
        delay: 1200,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }
    this.updatePlayerStats(actor);
  }

  if (actor.feverSlot && actor.feverSlot.tags.includes('consumable') && modifiedSkill.removeBoost) {
    const feverBoostName = actor.feverSlot.name;
    actor.feverSlot = null;
    this.updatePlayerStats(actor);
    if (modifiedSkill.feverBoostPenalty) {
      const penaltyDmg = Math.floor(actor.hp * ENGINE_OVERLOAD_PENALTY_SCALE);
      actor.hp -= penaltyDmg;
      applyBuff(actor, 'Stun', 1);
      roundLogs.push({
        round: r,
        htmlText: `💥<span class="text-red-400 font-bold">【引擎过载】</span>由于承受了超越极限的高温与重力，${e(actor.name)} 的 狂热[${feverBoostName}] 彻底烧毁飞离！不仅反噬损失了 ${penaltyDmg} HP，更是因为力竭而单膝跪地，陷入了 <span class="text-yellow-400 font-bold">[眩晕]</span>！`,
        type: 'system_danger',
        delay: 2000,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
      if (actor.hp <= 0) this.checkUndead(actor, currentPlayers, roundLogs, r, '遭到引擎反噬时');
    } else {
      roundLogs.push({
        round: r,
        text: `🎰 ${actor.name} 摇出的 狂热[${feverBoostName}] 武装技能耗尽飞离了！`,
        type: 'system_warning',
        delay: 1000,
        actorId: actor.id,
        activeStage: this.activeStage,
        snapshot: deepClone(currentPlayers),
      });
    }
  }
};

// ==========================================================================
// Combos (from 4_engine_combo.js)
// ==========================================================================
DgpEngine.prototype.resolveSkillCombo = function (
  this: DgpEngine,
  actor: Player,
  modifiedSkill: BuckleSkill,
  isBurstingJackpot: boolean,
  currentPlayers: Player[],
): { weaponLog: string; sourceBuckle: BuckleDef | undefined } {
  let weaponLog = '';
  let sourceBuckle: BuckleDef | undefined = Object.values(BUCKLES).find((b) =>
    b.skills?.some((s) => s.name === modifiedSkill.name),
  );

  if (isBurstingJackpot && actor.feverSlot) {
    sourceBuckle = BUCKLES[actor.feverSlot.id];
  }

  if (sourceBuckle && isBurstingJackpot) {
    modifiedSkill.isWeaponSlotSkill = true;
  }

  if (modifiedSkill.name === 'Hyper Boostriker Rush') {
    modifiedSkill.isWeaponSlotSkill = false;
  }

  if (sourceBuckle?.weapon) {
    let modeLog = '';
    if (sourceBuckle.id === 'Magnum') {
      if (modifiedSkill.name.includes('手枪') || modifiedSkill.name.includes('Charge'))
        modeLog = '·手枪模式';
      else if (modifiedSkill.name.includes('步枪') || modifiedSkill.name.includes('Blast'))
        modeLog = '·步枪模式';
    }
    weaponLog = `拔出了 <span class="text-gray-300">[${sourceBuckle.weapon.name}${modeLog}]</span>，`;
  }

  // --- Command Twin 专属神话级播报与特化文案 ---
  if (modifiedSkill.name === 'Jet Twin Victory (喷气机·双重胜利)') {
    modifiedSkill.isWeaponSlotSkill = true; // 阻止后续普通文案拼接
    weaponLog = `<br/><span class="font-black text-xl text-orange-400 drop-shadow-md italic tracking-widest">  ✈️🔥【JET! TWIN VICTORY!】</span><br/><span class="text-orange-200 font-bold">  ${e(actor.name)} 在右脚汇聚能量，借助后腰部推进器的火力全开加持下，对敌进行带来真实伤害的全力毁灭飞踢！</span>`;
  } else if (modifiedSkill.name === 'Cannon Twin Victory (加农炮·双重胜利)') {
    modifiedSkill.isWeaponSlotSkill = true;
    weaponLog = `<br/><span class="font-black text-xl text-cyan-400 drop-shadow-md tracking-widest">  炮🌌【CANNON! TWIN VICTORY!】</span><br/><span class="text-cyan-200 font-bold">  ${e(actor.name)} 伸长腰后的“WingAnchor”插入地面进行固定以抵御后坐力，从加农炮中释放出贯穿一切空间与护盾的强烈暴击光束！</span>`;
  } else if (sourceBuckle && sourceBuckle.id === 'Command_Twin') {
    if (actor.commandMode === 'Jet') {
      weaponLog = `<span class="text-orange-300 font-bold">展开巨大的喷气机翼，以突破音障的超高速机动性</span>，`;
    } else {
      weaponLog = `<span class="text-cyan-300 font-bold">架起沉重但毁灭性的重装加农炮，锁定目标区域</span>，`;
    }
  }

  if (modifiedSkill.isWeaponSlotSkill && sourceBuckle) {
    let comboBuckleId: string = sourceBuckle.id;
    const hasRealSource = actor.buckles && actor.buckles.some((b) => b.id === sourceBuckle!.id);
    const hasFeverSource = actor.feverSlot && actor.feverSlot.id === sourceBuckle.id;
    const hasBoost =
      (actor.buckles && actor.buckles.some((b) => b.id === 'Boost')) ||
      (actor.feverSlot && actor.feverSlot.id === 'Boost');

    if (isBurstingJackpot) {
      comboBuckleId = 'Fever';
    } else if (hasRealSource && hasFeverSource) {
      comboBuckleId = sourceBuckle.id;
    } else if (hasBoost) {
      comboBuckleId = 'Boost';
      modifiedSkill.removeBoost = true;
    } else if (actor.buckles) {
      const pool = actor.buckles
        .filter((b) => b.tier === 'large' && b.id !== 'Fever')
        .map((b) => b.id);
      if (
        actor.feverSlot &&
        actor.feverSlot.id !== sourceBuckle.id &&
        actor.feverSlot.id !== 'Trash'
      )
        pool.push(actor.feverSlot.id);
      if (actor.inventory && actor.inventory.tier === 'large') pool.push(actor.inventory.id);
      const filteredPool = pool.filter((id) => id !== sourceBuckle!.id && id !== 'Fever');
      if (filteredPool.length > 0) comboBuckleId = this.pickRandom(filteredPool);
      else comboBuckleId = sourceBuckle.id;
    }

    weaponLog = '';
    const gfvStyle = 'font-black text-2xl italic tracking-widest text-yellow-400';
    const gfvShadow =
      'text-shadow: 0 0 10px rgba(250,204,21,0.8), 0 0 20px rgba(250,204,21,0.6), 0 0 30px rgba(250,204,21,0.4);';
    const gfvBoostStyle = 'font-black text-2xl italic tracking-widest text-red-500';
    const gfvBoostShadow =
      'text-shadow: 0 0 10px rgba(239,68,68,0.8), 0 0 20px rgba(250,204,21,0.6), 0 0 30px rgba(250,204,21,0.4);';

    if (sourceBuckle.id === 'Magnum') {
      switch (comboBuckleId) {
        case 'Fever':
          modifiedSkill.isJackpot = true;
          modifiedSkill.dynamicMagnumJackpot = true;
          modifiedSkill.alwaysHit = true;
          modifiedSkill.ignoreShield = true;
          modifiedSkill.alwaysCrit = true;
          modifiedSkill.trueDmg = false;
          modifiedSkill.dmg = 3.8; // 同色狂热标准倍率
          weaponLog = `<br/>🎰 <span class="text-yellow-400 font-bold drop-shadow-md text-lg">JACKPOT！触发狂热共鸣，召唤出第二把马格南射击者！双枪齐发！</span><br/>🎯🔥 <span class="${gfvStyle}" style="${gfvShadow}">【MAGNUM! FEVER! GOLDEN FEVER VICTORY!】</span><br/>倾泻出铺天盖地的黄金弹幕，犹如暴雨般进行无死角火力洗礼！`;
          break;
        case 'Boost':
          modifiedSkill.dmg = 3.2;
          modifiedSkill.ignoreDef = 0.8;
          modifiedSkill.aoe = true;
          weaponLog = `🔥 将 [推进器带扣] 插入马格南射击者！发动【Boost Tactical Blast】！射出了极具破坏力的破甲推进死光扫射全场！`;
          break;
        case 'Magnum':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.aoe = true;
          weaponLog = `🎯 将 [马格南带扣] 能量极限压缩！发动【Magnum Tactical Blast】！射出了纯粹的超高密度赤红破坏死光贯穿了战场直线！`;
          break;
        case 'Zombie':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 4;
          modifiedSkill.effect = { type: 'Poison', duration: 3, chance: 1.0 };
          modifiedSkill.lifesteal = 0.3;
          modifiedSkill.aoe = false;
          weaponLog = `☠️ 插入 [僵尸带扣]！发动【Zombie Tactical Blast】！射出了数发紫色的剧毒吸血光束！`;
          break;
        case 'Ninja':
          modifiedSkill.aoe = false;
          modifiedSkill.hits = 4;
          modifiedSkill.dmg = 2.8;
          modifiedSkill.selfBuff = { type: 'Phantom', duration: 1 };
          weaponLog = `🌪️ 插入 [忍者带扣]！发动【Ninja Tactical Blast】！舍弃AOE召唤幻影，对目标进行极其密集的4段高速射击！`;
          break;
        case 'Monster':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.aoe = true;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 1.0 };
          modifiedSkill.ignoreDef = 0.5;
          weaponLog = `☄️ 插入 [怪兽带扣]！发动【Monster Tactical Blast】！射出了巨大的眩晕能量爆弹，炸裂席卷四周！`;
          break;
        case 'Beat':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.aoe = true;
          modifiedSkill.magic = true;
          modifiedSkill.selfHeal = true;
          modifiedSkill.healIntMult = 12;
          weaponLog = `🎵 插入 [节拍带扣]！发动【Beat Tactical Blast】！射出了带有魔法音符的治愈与破坏光束横扫了战场！`;
          break;
        default:
          modifiedSkill.dmg = 2.5;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 3;
          modifiedSkill.aoe = false;
          weaponLog = `将带扣能量极限压缩！发动【Tactical Blast】！极其迅猛地连续点射锁定的敌人！`;
      }
    } else if (sourceBuckle.id === 'Ninja') {
      const hasCloneAlive = currentPlayers.some(
        (p) => p.isClone && p.ownerId === actor.id && p.status === 'alive' && !p.toBeRemoved,
      );
      const cloneLinkageText = hasCloneAlive
        ? '<br/>👥 <i>*本体与分身心意相通，从两侧同时发起了双重打击！*</i>'
        : '';

      switch (comboBuckleId) {
        case 'Fever':
          modifiedSkill.isJackpot = true;
          modifiedSkill.dmg = 3.8;
          modifiedSkill.aoe = false;
          modifiedSkill.trueDmg = true;
          modifiedSkill.alwaysCrit = true;
          modifiedSkill.selfBuff = { type: 'Phantom', duration: 1 };
          weaponLog = `<br/>🎰 <span class="text-yellow-400 font-bold drop-shadow-md text-lg">JACKPOT！触发狂热共鸣，上下半身完全覆盖忍者装甲！</span><br/>🥷🔥 <span class="${gfvStyle}" style="${gfvShadow}">【NINJA! FEVER! GOLDEN FEVER VICTORY!】</span><br/>双持忍者双重刃！漫天黄金分身结印，化作万千极速流光，落下无可闪避的十字瞬杀大阵！${cloneLinkageText}`;
          break;
        case 'Boost':
          modifiedSkill.dmg = 3.2;
          modifiedSkill.ignoreDef = 0.8;
          modifiedSkill.removeBoost = true;
          weaponLog = `🔥 通过驱动器将 [推进器带扣] 的能量传导至双重刃！滑动手里剑Rounder！<br/>🥷 发动【**Tactical Finish**】！双重刃喷射出猩红的烈焰与翠绿的狂风，化作极速的风火交加龙卷，以无可匹敌的贯穿力将敌人撕裂！${cloneLinkageText}`;
          break;
        case 'Magnum':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 4;
          modifiedSkill.aoe = false;
          weaponLog = `🎯 通过驱动器将 [马格南带扣] 的射击能量传导至双重刃！滑动手里剑Rounder！<br/>🥷 发动【**Tactical Finish**】！将双重刃切换为手里剑模式掷出，并在空中用马格南射击引爆，化作无数风之追踪弹雨洗礼战场！${cloneLinkageText}`;
          break;
        case 'Zombie':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.effect = { type: 'Poison', duration: 3, chance: 1.0 };
          modifiedSkill.lifesteal = 0.3;
          weaponLog = `☠️ 通过驱动器将 [僵尸带扣] 的猛毒能量传导至双重刃！滑动手里剑Rounder！<br/>🥷 发动【**Tactical Finish**】！化作带有剧毒的紫色残影潜入地底或阴影中，随后从死角挥出腐蚀一切的猛毒十字斩！${cloneLinkageText}`;
          break;
        case 'Monster':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 1.0 };
          weaponLog = `☄️ 通过驱动器将 [怪兽带扣] 的巨兽能量传导至双重刃！滑动手里剑Rounder！<br/>🥷 发动【**Tactical Finish**】！双重刃缠绕着狂暴的星芒，伴随着风遁分身从天而降，砸出足以粉碎大地与脑神经的流星大风车斩！${cloneLinkageText}`;
          break;
        case 'Beat':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.selfHeal = true;
          modifiedSkill.healIntMult = 12;
          weaponLog = `🎵 通过驱动器将 [节拍带扣] 的音波能量传导至双重刃！滑动手里剑Rounder！<br/>🥷 发动【**Tactical Finish**】！伴随着疾风摇滚的节拍，挥出带有治愈音符的风暴斩击，在切碎敌人的同时恢复自身体力！${cloneLinkageText}`;
          break;
        default:
          modifiedSkill.dmg = 2.5;
          weaponLog = `🥷 连续滑动手里剑Rounder三次！【Fever！】<br/>🥷 发动【**Tactical Finish**】！将单刃模式的忍者双重刃猛地刺入墙壁，借力腾空飞跃，化作一道翠绿的流星从敌人的死角一刀两断！${cloneLinkageText}`;
      }
    } else if (sourceBuckle.id === 'Zombie') {
      switch (comboBuckleId) {
        case 'Fever':
          modifiedSkill.isJackpot = true;
          modifiedSkill.dmg = 3.8;
          modifiedSkill.lifesteal = 0.6;
          modifiedSkill.alwaysHit = true;
          modifiedSkill.aoe = true;
          modifiedSkill.randomTargets = false;
          weaponLog = `<br/>🎰 <span class="text-yellow-400 font-bold drop-shadow-md text-lg">JACKPOT！触发狂热共鸣，全装甲覆盖！双眼亮起狂暴的黄光！</span><br/>🪚🔥 <span class="${gfvStyle}" style="${gfvShadow}">【ZOMBIE! FEVER! GOLDEN FEVER VICTORY!】</span><br/>双持僵尸破坏者！化作狂暴的黄金毒液绞肉机，以无可阻挡的绝强怪力将全场敌人无情撕裂榨干！`;
          break;
        case 'Boost':
          modifiedSkill.dmg = 3.2;
          modifiedSkill.ignoreShield = true;
          modifiedSkill.removeBoost = true;
          weaponLog = `🔥 通过驱动器将 [推进器带扣] 的能量传导至破坏者！滑动 Deadly Pomp 极限充能！<br/>🪚 发动【**Tactical Break**】！电锯喷射出狂暴的紫红尾焰，以无视一切护盾的超绝怪力将敌人一刀两断！`;
          break;
        case 'Magnum':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 4;
          modifiedSkill.aoe = false;
          weaponLog = `🎯 通过驱动器将 [马格南带扣] 的射击能量传导至破坏者！【Poison Charge！】<br/>🪚 发动【**Tactical Break**】！挥动僵尸破坏者，斩出无数道伴随剧毒与爆破属性的赤紫色追踪能量锯刃！`;
          break;
        case 'Ninja':
          modifiedSkill.aoe = false;
          modifiedSkill.hits = 4;
          modifiedSkill.dmg = 2.8;
          modifiedSkill.selfBuff = { type: 'Phantom', duration: 1 };
          weaponLog = `🌪️ 通过驱动器将 [忍者带扣] 的忍术能量传导至破坏者！【Poison Charge！】<br/>🪚 发动【**Tactical Break**】！化作数道带有剧毒的残影，对锁定目标进行肉眼无法捕捉的4段高速残暴锯斩！`;
          break;
        case 'Monster':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 1.0 };
          weaponLog = `☄️ 通过驱动器将 [怪兽带扣] 的巨兽能量传导至破坏者！【Poison Charge！】<br/>🪚 发动【**Tactical Break**】！左臂巨爪与巨大化的电锯同时砸向地面，掀起粉碎大地与脑神经的剧毒地震冲击波！`;
          break;
        case 'Beat':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.selfHeal = true;
          modifiedSkill.healIntMult = 12;
          weaponLog = `🎵 通过驱动器将 [节拍带扣] 的音波能量传导至破坏者！【Poison Charge！】<br/>🪚 发动【**Tactical Break**】！电锯齿轮与音乐节拍共鸣，发出极其刺耳的毒素音波，粉碎敌方内部的同时治愈自身！`;
          break;
        default:
          modifiedSkill.dmg = 2.5;
          weaponLog = `☠️ 滑动 Deadly Pomp！【Poison Charge！】<br/>🪚 发动【**Tactical Break**】！紫色的能量凝聚于锯刃之上，转动锯齿，对敌人发动了极其致命的毒素电锯斩击！`;
      }
    } else if (sourceBuckle.id === 'Beat') {
      switch (comboBuckleId) {
        case 'Fever':
          modifiedSkill.isJackpot = true;
          modifiedSkill.dmg = 3.8;
          modifiedSkill.aoe = true;
          modifiedSkill.magic = true;
          modifiedSkill.trueDmg = true;
          modifiedSkill.ignoreShield = true;
          modifiedSkill.dispelBuffs = true;
          weaponLog = `<br/>🎰 <span class="text-yellow-400 font-bold drop-shadow-md text-lg">JACKPOT！触发狂热共鸣，上下半身完全覆盖节拍装甲！</span><br/>🎸🔥 <span class="${gfvStyle}" style="${gfvShadow}">【BEAT! FEVER! GOLDEN FEVER VICTORY!】</span><br/>双持节拍战斧！奏响震碎灵魂的狂热摇滚，令地面瞬间喷发无数巨大的黄金音符能量柱粉碎一切！`;
          break;
        case 'Boost':
          modifiedSkill.dmg = 3.2;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = true;
          modifiedSkill.ignoreDef = 0.8;
          modifiedSkill.removeBoost = true;
          weaponLog = `🔥 将 [推进器带扣] 能量传导至战斧！操作调音装置！【**Rock Fire！**】<br/>🎸 发动【**Tactical Fire (战术烈火)**】！弹奏出爆裂的摇滚乐（Rock），战斧环绕着推进器喷射的极度高温，向全场挥出如狂热音符般的巨大火焰龙卷斩击！`;
          break;
        case 'Ninja':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = true;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 0.8 };
          weaponLog = `🥷 将 [忍者带扣] 的风遁能量传导至战斧！操作调音装置！【**Funk Hurricane！**】<br/>🎸 发动【**Tactical Hurricane (战术飓风)**】！弹奏出放克风格（Funk）的律动乐曲！风遁化作狂暴的飓风，在地上形成摧毁一切的龙卷音波圈，将范围内的敌人全部卷入半空后一刀斩裂！`;
          break;
        case 'Monster':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = false;
          modifiedSkill.hits = 2;
          weaponLog = `☄️ 将 [怪兽带扣] 的巨兽能量传导至战斧！操作调音装置！【**Metal Thunder！**】<br/>🎸 发动【**Tactical Thunder (战术狂雷)**】！弹奏出狂暴的重金属音乐（Metal）！怪兽的星芒化作粗壮的落雷，随着战斧的挥动对敌人降下毁天灭地的双重神雷制裁！`;
          break;
        case 'Magnum':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 4;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 1.0 };
          modifiedSkill.aoe = false;
          weaponLog = `🎯 将 [马格南带扣] 的射击能量传导至战斧！操作调音装置！【**Techno Blizzard！**】<br/>🎸 发动【**Tactical Blizzard (战术暴雪)**】！弹奏出动感极速的电子舞曲（Techno）！战斧化作极寒的音波发射器，将魔法音符转化为数十发追踪冰弹，对全场进行无死角的绝对零度暴雪覆盖！`;
          break;
        case 'Zombie':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = true;
          modifiedSkill.effect = { type: 'Poison', duration: 3, chance: 1.0 };
          modifiedSkill.lifesteal = 0.3;
          weaponLog = `☠️ 将 [僵尸带扣] 的腐流传导至战斧！操作调音装置！【**Grunge Venom！**】<br/>🎸 发动【**Tactical Venom (战术猛毒)**】！弹奏出失真咆哮的垃圾摇滚（Grunge）！紫色的剧毒音波伴随着电锯般的吉他失真轰鸣撕裂全场，化作剧毒泥沼疯狂榨取敌人的生命力！`;
          break;
        default:
          modifiedSkill.dmg = 2.5;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = true;
          weaponLog = `🎸 疯狂扫动吉他弦！操作调音装置！【**Disco Quake！**】<br/>🎸 发动【**Tactical Quake (战术地震)**】！弹奏出节奏感爆棚的迪斯科舞曲（Disco）！将战斧猛烈砸向地面，狂野的音乐化作实质性的地震波与大地碎裂的土属性冲击，将全场敌人强制卷入狂热节奏中粉碎！`;
      }
    } else if (sourceBuckle.id === 'Monster') {
      switch (comboBuckleId) {
        case 'Fever':
          modifiedSkill.isJackpot = true;
          modifiedSkill.dmg = 3.8;
          modifiedSkill.hits = 6;
          modifiedSkill.trueDmg = true;
          modifiedSkill.aoe = false;
          modifiedSkill.ignoreDef = 1.0;
          weaponLog = `<br/>🎰 <span class="text-yellow-400 font-bold drop-shadow-md text-lg">JACKPOT！触发狂热共鸣，上下半身完全覆盖星型怪兽装甲！</span><br/>☄️🔥 <span class="${gfvStyle}" style="${gfvShadow}">【MONSTER! FEVER! GOLDEN FEVER VICTORY!】</span><br/>双重星型拳套巨大化！怪兽本能极度狂化，轰出足以碾碎空间与大地板块的超密度黄金流星乱打！`;
          break;
        case 'Boost':
          modifiedSkill.dmg = 3.2;
          modifiedSkill.ignoreDef = 0.8;
          modifiedSkill.removeBoost = true;
          weaponLog = `🔥 将 [推进器带扣] 的尾焰能量传导至怪兽拳套！极限充能！<br/>☄️ 发动【 Tactical Smash 】！怪兽巨拳后方喷射出猩红的爆裂烈焰，化作一枚巨大的火焰星型火箭铁拳，以绝对的动能将目标的防御彻底粉碎贯穿！`;
          break;
        case 'Magnum':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.randomTargets = true;
          modifiedSkill.hits = 4;
          modifiedSkill.aoe = false;
          weaponLog = `🎯 将 [马格南带扣] 的火控系统连接至怪兽装甲！<br/>☄️ 发动【 Tactical Smash 】！不再进行近战肉搏，而是将高密度的怪兽能量压缩成数颗巨大的星型能量榴弹，从双臂如重型火炮般倾泻而出，对战场进行毁灭性的狂轰滥炸！`;
          break;
        case 'Zombie':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.effect = { type: 'Poison', duration: 3, chance: 1.0 };
          modifiedSkill.lifesteal = 0.4;
          weaponLog = `☠️ 将 [僵尸带扣] 的猛毒腐流传导至怪兽拳套！<br/>☄️ 发动【 Tactical Smash 】！蓝黄双色的星型拳套染上了一层剧毒的紫黑色！犹如狂暴的丧尸巨兽一般扑向目标，一拳砸烂敌人的同时，锋利的能量利爪疯狂汲取着对方的生命力！`;
          break;
        case 'Ninja':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.hits = 2;
          modifiedSkill.selfBuff = { type: 'Phantom', duration: 1 };
          weaponLog = `🥷 将 [忍者带扣] 的风遁机动力传导至怪兽装甲！<br/>☄️ 发动【 Tactical Smash 】！打破了重装甲的笨重限制，化作一道狂风残影瞬间闪现至敌人视觉死角，随后从两侧同时轰出重达千吨的怪兽双重夹击！`;
          break;
        case 'Beat':
          modifiedSkill.dmg = 2.8;
          modifiedSkill.magic = true;
          modifiedSkill.aoe = true;
          modifiedSkill.effect = { type: 'Stun', duration: 1, chance: 0.8 };
          weaponLog = `🎵 将 [节拍带扣] 的重金属音波传导至怪兽拳套！<br/>☄️ 发动【 Tactical Smash 】！高举一双巨大的星型拳套，伴随着震耳欲聋的重金属节拍在胸前猛烈对撞！爆发出夹杂着狂雷与地震的毁灭性实质音浪，将全场敌人震晕掀翻！`;
          break;
        default:
          modifiedSkill.dmg = 2.5;
          weaponLog = `☄️ 按下怪兽带扣唤醒机关！能量汇聚！<br/>☄️ 发动【 Tactical Smash 】！全身的力量与星芒能量集中于右臂，毫无花哨地向着前方砸出了一记纯粹暴力、足以引发小型地震的超巨型毁灭重拳！`;
      }
    } else if (sourceBuckle.id === 'Boost') {
      switch (comboBuckleId) {
        case 'Fever': {
          const realBuckle = actor.buckles.find(
            (b) => b.id !== 'Fever' && ['large', 'legendary'].includes(b.tier),
          );
          const realBuckleId = realBuckle ? realBuckle.id : 'Entry';
          modifiedSkill.removeBoost = true;

          if (realBuckleId === 'Boost') {
            // 真·狂热推进大胜利，总倍率严格控制在 4.5，由 4 段伤害平摊
            modifiedSkill.isTrueFeverBoost = true;
            modifiedSkill.dmg = 4.5;
            modifiedSkill.hits = 4;
            modifiedSkill.aoe = true;
            modifiedSkill.randomTargets = false;
            modifiedSkill.trueDmg = true;
            modifiedSkill.ignoreShield = true;
            modifiedSkill.alwaysHit = true;
            modifiedSkill.feverBoostPenalty = true;
            weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！触发极限狂热共鸣，全身五重推进器引擎全功率过载！</span><br/>🚀🔥 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【BOOST! FEVER! GOLDEN FEVER VICTORY!】</span><br/>空间因极致的高温与超光速发生扭曲！化作五道猩红与暗金交织的灭世流星，踢碎空间的界限，引发吞噬整个赛场的歼星级大爆炸！`;
          } else {
            // 超限宏大胜利，单次爆发总倍率严格控制在 4.5
            modifiedSkill.isHyperGrandVictory = true;
            modifiedSkill.dmg = 4.5;
            modifiedSkill.hits = 1;
            modifiedSkill.aoe = true;
            modifiedSkill.ignoreDef = 0.8;
            if (realBuckleId === 'Magnum') {
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！狂热推进器的猩红爆炎全功率注入马格南！</span><br/>🎯🚀 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【MAGNUM! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>召唤出全副武装的推进者摩托舰队，在极速环绕中向全场倾泻出毁天灭地的黄金爆裂弹雨轨道轰炸！`;
            } else if (realBuckleId === 'Zombie') {
              modifiedSkill.lifesteal = 0.5;
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！极限猩红火光与紫黑猛毒完美交织！</span><br/>☠️🚀 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【ZOMBIE! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>驾驶推进者摩托碾碎地面的同时，挥舞极度充能的僵尸破坏者，劈出撕裂空间、连同生命力一并抽干的绝死剧毒烈焰断头台！`;
            } else if (realBuckleId === 'Ninja') {
              modifiedSkill.alwaysCrit = true;
              modifiedSkill.selfBuff = { type: 'Phantom', duration: 1 };
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！风遁残影与超光速推进完美结合！</span><br/>🥷🚀 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【NINJA! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>召唤出无数驾驶着推进者摩托的幻影分身，化作遮天蔽日的风火交织龙卷，以无法观测的神速斩下焚毁万物的超音速十字瞬杀阵！`;
            } else if (realBuckleId === 'Monster') {
              modifiedSkill.ignoreDef = 1.0;
              modifiedSkill.trueDmg = true;
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！推进器尾焰将巨兽本能推至绝对顶点！</span><br/>☄️🚀 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【MONSTER! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>双重星型巨拳伴随着推进爆炎，连同推进者摩托一同化作坠落的红蓝色超重力歼星陨石，将整个战场连同敌人的绝对防御彻底砸穿粉碎！`;
            } else if (realBuckleId === 'Beat') {
              modifiedSkill.magic = true;
              modifiedSkill.trueDmg = true;
              modifiedSkill.dispelBuffs = true;
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！引擎轰鸣与死亡摇滚产生极致共鸣！</span><br/>🎵🚀 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【BEAT! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>推进者摩托化作穿梭音符的烈焰重金属舞台，在狂飙中向全场轰出震碎灵魂、净化一切邪恶的超爆裂火之神圣音轨！`;
            } else {
              weaponLog = `<br/>🎰 <span class="text-red-500 font-bold drop-shadow-md text-lg">HIDDEN JACKPOT！全身推进器装甲超限爆发！</span><br/>🚀🔥 <span class="${gfvBoostStyle}" style="${gfvBoostShadow}">【BOOST! FEVER BOOST! HYPER GRAND VICTORY!】</span><br/>化作贯穿天际的超光速猩红陨石引爆全场！`;
            }
          }
          break;
        }
      }
    }
  }

  if (
    sourceBuckle &&
    (sourceBuckle.id === 'Ninja' || sourceBuckle.id === 'Zombie' || sourceBuckle.id === 'Beat')
  ) {
    if (modifiedSkill.aoe && modifiedSkill.type === 'tactical') {
      modifiedSkill.aoe = false;
      modifiedSkill.maxTargets = 6;
    }
  }

  return { weaponLog, sourceBuckle };
};

// ==========================================================================
// Post-action cleanup & death judgement (from 4_engine_combat.js 模块 5)
// ==========================================================================
DgpEngine.prototype._processPostActions = function (
  this: DgpEngine,
  actor: Player,
  currentPlayers: Player[],
  roundLogs: DgpLogEntry[],
  r: number,
): void {
  currentPlayers.forEach((p) => {
    if (p.hp <= 0 && p.status === 'alive') {
      if (p.isClone) {
        p.status = 'eliminated';
        p.toBeRemoved = true;
        roundLogs.push({
          round: r,
          text: `💨 ${p.name} 承受不住伤害，化作一团烟雾消散了！`,
          type: 'combat',
          delay: 1000,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers.filter((x) => !x.toBeRemoved)),
        });
        return;
      }
      if (this.checkUndead(p, currentPlayers, roundLogs, r, '濒临死亡时')) return;

      p.hp = 0;
      p.status = 'eliminated';
      if (p.id !== actor.id) actor.kills += 1;
      if (p.isBountyTarget) {
        p.isBountyTarget = false;
        let healAmount = actor.maxHp - actor.hp;
        const isPoisoned = actor.buffs.some((b) => b.type === 'Poison');
        if (isPoisoned) healAmount = Math.floor(healAmount * 0.5);
        actor.hp += healAmount;

        roundLogs.push({
          round: r,
          htmlText: `💰<span class="text-yellow-400 font-bold text-xl">【悬赏完成】</span>${e(actor.name)} 成功击杀了悬赏目标 ${e(p.name)}！`,
          type: 'system',
          delay: 2000,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        roundLogs.push({
          round: r,
          text: `💚 ${actor.name} 恢复了 ${healAmount} 点生命值！${isPoisoned ? '(受减疗影响)' : ''}`,
          type: 'combat',
          delay: 1000,
          actorId: actor.id,
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
        if (!actor.isJyamato) {
          let rewardId = 'Fever';
          if (r > 15 && this.chance(0.5)) rewardId = 'Boost';
          const result = this.equipBuckle(actor, rewardId, '获得了悬赏大奖', '🎁【高额悬赏】');
          roundLogs.push({
            round: r,
            text: result.log,
            type: 'loot_epic',
            delay: 2000,
            actorId: actor.id,
            activeStage: this.activeStage,
            snapshot: deepClone(currentPlayers),
          });
        }
      }
      if (p.isJyamato)
        roundLogs.push({
          round: r,
          text: `🎯 ${p.name} 被彻底消灭！`,
          type: 'kill_monster',
          delay: 1000,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
      else
        roundLogs.push({
          round: r,
          text: `💀【ID核心碎裂】${p.name} 淘汰！`,
          type: 'kill',
          delay: 2500,
          targetIds: [p.id],
          activeStage: this.activeStage,
          snapshot: deepClone(currentPlayers),
        });
    }
  });
};

// ==========================================================================
// 核心入口：单回合战斗大循环
// ==========================================================================
DgpEngine.prototype.handleCombat = function (
  this: DgpEngine,
  currentPlayers: Player[],
  roundLogs: DgpLogEntry[],
  r: number,
): void {
  const aliveHumansAtStart = currentPlayers.filter(
    (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
  ).length;
  const aliveMonstersAtStart = currentPlayers.filter(
    (p) => p.status === 'alive' && p.isJyamato,
  ).length;
  const isEndgameInfighting = aliveHumansAtStart === 1 && aliveMonstersAtStart >= 2;
  const hasDgpProtection = aliveMonstersAtStart > 0 && r < DECISIVE_ROUND;

  const aliveEntities = currentPlayers.filter((p) => p.status === 'alive');
  aliveEntities.sort((a, b) => {
    let aAgi = getEffectiveAgi(a) + this.random() * 50;
    let bAgi = getEffectiveAgi(b) + this.random() * 50;
    if (a.buffs.some((x) => x.type === 'Burst')) aAgi += 1000;
    if (b.buffs.some((x) => x.type === 'Burst')) bAgi += 1000;
    return bAgi - aAgi;
  });

  const actedThisRound = new Set<string>();

  for (let i = 0; i < aliveEntities.length; i++) {
    const actor = aliveEntities[i];
    if (actor.status !== 'alive' || actedThisRound.has(actor.id)) continue;
    actedThisRound.add(actor.id);

    const skipTurn = this._processPreActions(actor, currentPlayers, roundLogs, r);
    if (skipTurn) continue;

    const actionType = this._determineActionType(actor);

    if (actionType === 'loot') {
      this._executeLootAction(actor, currentPlayers, roundLogs, r, actedThisRound);
    } else {
      this._executeAttackAction(actor, currentPlayers, roundLogs, r, isEndgameInfighting, hasDgpProtection);
    }

    this._processPostActions(actor, currentPlayers, roundLogs, r);

    const currentAliveH = currentPlayers.filter(
      (p) => p.status === 'alive' && !p.isJyamato && !p.isClone,
    ).length;
    const currentAliveM = currentPlayers.filter((p) => p.status === 'alive' && p.isJyamato).length;
    if ((currentAliveH === 1 && currentAliveM === 0) || currentAliveH === 0) {
      break;
    }
  }
};
