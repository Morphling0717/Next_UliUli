import { cloneJobDefinition } from '../combatState';
import type { DamageApplicationOptions } from '../types';
import { isSelectableTargetFor } from '../targeting';
import type { CharacterHook } from './types';

export const jokerHook: CharacterHook = {
  id: 'joker',

  onTransformCheck: ({ fighter, runtime, transform }) => {
    const DUAL_JOKER = runtime.jobs.DUAL_JOKER;
    if (!fighter.isJoker || !DUAL_JOKER) return false;

    transform('DUAL_JOKER', `🤡 ${fighter.name} 摘下了冷笑话面具，展现出【${DUAL_JOKER.name}】的恐怖姿态！`, () => {
      fighter.maxHp = Math.max(2500, Math.min(3000, Math.floor(fighter.maxHp * 1.5)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk *= 1.5;
      fighter.mag *= 2.0;
      fighter.spd = 100;
      fighter.agl = Math.max(80, fighter.agl * 2);
      fighter.wis = Math.max(100, fighter.wis * 2);
      fighter.res = Math.max(80, fighter.res * 1.5);
    });
    return true;
  },

  onDefeated: ({ fighter, runtime }) => {
    if (fighter.isJoker && !fighter.hasResurrected) {
      fighter.reviveTurns = 4;
      runtime.log('info', `🃏 ${fighter.name} 没有真正退场，进入 4 次结算的返场倒计时！`);
    }
  },

  shouldPreventWin: ({ fighter, runtime, aliveCombatants, activeTeams }) => {
    if (!fighter.isDead || !fighter.isJoker || fighter.hasResurrected || (fighter.reviveTurns ?? 0) <= 0) return false;

    const myTeamId = runtime.getTeamId(fighter);
    const hasTeammates = runtime.fighters.some((other) => other.id !== fighter.id && runtime.getTeamId(other) === myTeamId);
    if (hasTeammates) {
      return !aliveCombatants.some((ally) => runtime.getTeamId(ally) === myTeamId);
    }
    return activeTeams.size <= 1;
  },

  onReviveCheck: ({ fighter, runtime, spinalSwordRef }) => {
    if (!fighter.isDead || !fighter.isJoker || fighter.hasResurrected || (fighter.reviveTurns ?? 0) <= 0) return false;

    const myTeamId = runtime.getTeamId(fighter);
    const hasTeammates = runtime.fighters.some((other) => other.id !== fighter.id && runtime.getTeamId(other) === myTeamId);
    const livingFighters = runtime.fighters.filter((other) => runtime.isActiveCombatant(other));
    let forceRevive = false;

    if (hasTeammates) {
      if (!livingFighters.some((ally) => ally.id !== fighter.id && runtime.getTeamId(ally) === myTeamId)) {
        forceRevive = true;
        runtime.log('info', `⚠️ 己方全灭，${fighter.name} 提前结束读秒，强制返场！`);
      }
    } else if (new Set(livingFighters.map((enemy) => runtime.getTeamId(enemy))).size <= 1) {
      forceRevive = true;
      runtime.log('info', `⚠️ 场上只剩最终的赢家，独狼 ${fighter.name} 决定现在登场截胡！`);
    }

    fighter.reviveTurns = forceRevive ? 0 : (fighter.reviveTurns ?? 0) - 1;
    if ((fighter.reviveTurns ?? 0) > 0) return true;

    fighter.isDead = false;
    fighter.defeatHooksResolved = false;
    fighter.hasResurrected = true;
    fighter.isDeadAnnounced = false;
    const GOD_OF_TROLLS = runtime.jobs.GOD_OF_TROLLS;
    if (GOD_OF_TROLLS) {
      fighter.jobData = cloneJobDefinition(GOD_OF_TROLLS);
      fighter.job = 'GOD_OF_TROLLS';
      fighter.maxHp = Math.floor(fighter.maxHp * 1.6);
      fighter.currentHp = fighter.maxHp;
      fighter.spd = 150;
      fighter.atk = Math.max(100, fighter.atk * 2);
      fighter.def = Math.max(80, fighter.def * 2);
      fighter.res = Math.max(150, fighter.res * 2);
      fighter.mag = Math.max(225, fighter.mag * 3.02);
      fighter.agl = Math.max(250, fighter.agl * 3);
      fighter.wis = Math.max(200, fighter.wis * 3);
    } else {
      fighter.currentHp = fighter.maxHp;
    }
    runtime.syncHpPct(fighter);
    fighter.status = [];
    runtime.log('buff', `🤡 ${fighter.name} 从地狱归来！转职为【${GOD_OF_TROLLS ? GOD_OF_TROLLS.name : '乐子人'}】！\n"接下来，是我的谢幕演出！"`);

    const enemies = runtime.fighters.filter((enemy) => isSelectableTargetFor(runtime, fighter, enemy));
    if (enemies.length > 0) {
      const aoeDmg = Math.floor(fighter.mag * 2.06);
      runtime.log('skill', `💥 【谢幕返场】${fighter.name} 的地狱笑话席卷 ${enemies.length} 名敌人：${enemies.map((enemy) => enemy.name).join('、')}！`);
      for (const enemy of enemies) {
        if (!runtime.isActiveCombatant(fighter)) break;
        if (!isSelectableTargetFor(runtime, fighter, enemy)) continue;
        const damageOptions: DamageApplicationOptions = {
          deferTransform: true,
          respectDefenses: true,
          actionName: '谢幕返场',
        };
        const actualDmg = runtime.applyDamage(enemy, Math.max(1, aoeDmg - Math.floor(enemy.res * 0.5)), 'skill', false, fighter, damageOptions);
        if (damageOptions.redirectedByJoker) continue;
        if (actualDmg > 0) {
          runtime.log('info', `💥 地狱笑话命中 ${enemy.name}，实际造成 ${actualDmg} 点魔法伤害，并施加【混乱】！`);
        } else {
          runtime.log('info', `💥 地狱笑话扫过 ${enemy.name}，但没有造成实际伤害，【混乱】没有生效！`);
        }
        if (actualDmg > 0) runtime.flushDeferredDamageEvents(enemy);
        if (enemy.currentHp <= 0 && !enemy.isDead) {
          runtime.finalizeFighterDeath(enemy, spinalSwordRef, `💀 【击杀】${enemy.name} 被地狱笑话震死了！`, fighter);
        }
        if (actualDmg > 0 && runtime.isActiveCombatant(enemy)) {
          enemy.status.push({ type: 'CONFUSED', duration: 1 });
        }
      }
    }
    return true;
  },
};
