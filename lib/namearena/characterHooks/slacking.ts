import type { Fighter, SkillContext } from '../types';
import {
  SLACKING_AWAY_STATUS_TYPES,
  SLACKING_RETURN_PROTECTION_STATUS_TYPES,
  isStatusType,
} from '../statusRules';
import type { CharacterHook } from './types';
import { createStatusEntry } from '../defenseStatus';
import { selectBabySupportSkill } from './sigua';
import { selectValorantSkill } from './valoJunior';

function isSiguaFighter(fighter: Fighter): boolean {
  return !!fighter.isSigua ||
    fighter.job === 'VIRTUAL_DIVA' ||
    fighter.job === 'VALO_JUNIOR' ||
    fighter.job === 'MY_BABY' ||
    fighter.name.includes('丝瓜');
}

function isBunnyFighter(fighter: Fighter): boolean {
  return !!fighter.isTuJuanJuan ||
    fighter.job === 'Q_BUNNY' ||
    fighter.job === 'VERSATILE_RABBIT' ||
    fighter.name.includes('兔卷卷') ||
    fighter.name.includes('curly');
}

function isSlackingCandidate(fighter: Fighter): boolean {
  return isSiguaFighter(fighter) || isBunnyFighter(fighter);
}

function findSlackingPartner(
  actor: Fighter,
  fighters: Fighter[],
  isActive: (fighter: Fighter) => boolean,
): Fighter | undefined {
  if (!isSlackingCandidate(actor)) return undefined;

  const actorIsSigua = isSiguaFighter(actor);
  return fighters.find(
    (fighter) =>
      fighter.id !== actor.id &&
      isActive(fighter) &&
      !fighter.hasTriggeredSlacking &&
      !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING') &&
      (actorIsSigua ? isBunnyFighter(fighter) : isSiguaFighter(fighter)),
  );
}

export function executeSlackingSynergy(ctx: SkillContext): boolean {
  const partner = findSlackingPartner(
    ctx.user,
    ctx.fighters,
    (fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
  );

  if (partner && !ctx.user.hasTriggeredSlacking) {
    if (ctx.user.willSlackThisGame === undefined) {
      const willSlack = Math.random() < 0.35;
      ctx.user.willSlackThisGame = willSlack;
      partner.willSlackThisGame = willSlack;
      if (!willSlack) {
        ctx.user.hasTriggeredSlacking = true;
        partner.hasTriggeredSlacking = true;
      }
    }

    if (ctx.user.willSlackThisGame && !ctx.user.hasTriggeredSlacking) {
      if (Math.random() < 0.15) {
        ctx.user.hasTriggeredSlacking = true;
        partner.hasTriggeredSlacking = true;
        ctx.log('skill', `✨ 【摸鱼伙伴羁绊】触发！战斗进行到一半，${ctx.user.name} 和 ${partner.name} 突然对视了一眼，达成了某种默契...`);
        ctx.log('skill', `⛺ 两人以极快的速度手牵手脱离了战场，去外边悠闲地喝奶茶了！(进入场外OB状态，绝对无敌且无法被选中，5回合后回归)`);

        const applySynergy = (participant: Fighter) => {
          participant.status = participant.status.filter(
            (status) => !['VALO_HOLDING_ANGLE', 'WAIT_COUNTER', 'COUNTER', 'AIM'].includes(status.type) && !status.type.startsWith('CTR_'),
          );
          participant.status.push(createStatusEntry('SYNERGY_SLACKING', 5, 'slacking_off_field'));
          participant.status.push(createStatusEntry('INVUL', 5, 'slacking_off_field'));
          participant.status.push(createStatusEntry('BKB', 5, 'slacking_off_field'));
          participant.status.push(createStatusEntry('STUN', 5, 'slacking_off_field'));
          participant.wasSynergySlacking = true;
        };

        applySynergy(ctx.user);
        applySynergy(partner);
        return true;
      }
    }
  }

  let fallback = 'bash';
  if (ctx.user.job === 'VIRTUAL_DIVA') {
    fallback = 'diva_song';
  } else if (ctx.user.job === 'VALO_JUNIOR') {
    fallback = selectValorantSkill(ctx.user, {
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant: (fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
      log: ctx.log,
    });
  } else if (ctx.user.job === 'MY_BABY') {
    fallback = selectBabySupportSkill(ctx.user, {
      fighters: ctx.fighters,
      turnCount: ctx.turnCount,
      getTeamId: ctx.getTeamId,
      isActiveCombatant: (fighter) => !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0,
    });
  } else if (ctx.user.job === 'Q_BUNNY') {
    fallback = 'q_bunny_attack';
  } else if (ctx.user.job === 'VERSATILE_RABBIT') {
    fallback = 'v_rabbit_calc_rng';
  }

  ctx.executeSkillAction(fallback, ctx.user, ctx.target, ctx.triggerDepth + 1);
  return true;
}

export const slackingBondHook: CharacterHook = {
  id: 'slackingBond',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics') return null;
    if (!(actor.isSigua || actor.isTuJuanJuan)) return null;
    if (actor.hasTriggeredSlacking || actor.status.some((status) => status.type === 'SYNERGY_SLACKING')) return null;
    return findSlackingPartner(actor, runtime.fighters, runtime.isActiveCombatant) ? 'slacking' : null;
  },

  resolveReentry: ({ runtime }) => {
    const activeFighters = runtime.fighters.filter((fighter) =>
      runtime.isActiveCombatant(fighter) && !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );
    const activeTeams = new Set(activeFighters.map((fighter) => runtime.getTeamId(fighter))).size;
    const currentlySlacking = runtime.fighters.filter((fighter) =>
      runtime.isActiveCombatant(fighter) && fighter.wasSynergySlacking && fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );
    const naturallyFinished = runtime.fighters.filter((fighter) =>
      runtime.isActiveCombatant(fighter) && fighter.wasSynergySlacking && !fighter.status.some((status) => status.type === 'SYNERGY_SLACKING'),
    );

    if (currentlySlacking.length > 0 && (activeTeams <= 1 || activeFighters.length <= 1)) {
      runtime.log('info', `🚨 【突发状况】打工的队友快死光了！（场外判定：仅存 ${activeTeams} 支队伍/阵营）`);
      currentlySlacking.forEach((participant) => {
        participant.status = participant.status.filter((status) => !isStatusType(status.type, SLACKING_AWAY_STATUS_TYPES));
        participant.currentHp = participant.maxHp;
        runtime.syncHpPct(participant);
        participant.wasSynergySlacking = false;
        runtime.log('heal', `🏃‍♀️ 惊呼"完了！要被发现我们在摸鱼了！" ${participant.name} 赶紧扔掉手里的奶茶，满血跑回战场假装还在战斗！`);
      });
      naturallyFinished.forEach((participant) => { participant.wasSynergySlacking = false; });
    } else if (naturallyFinished.length > 0) {
      naturallyFinished.forEach((fighter) => {
        fighter.wasSynergySlacking = false;
        fighter.currentHp = fighter.maxHp;
        runtime.syncHpPct(fighter);
        fighter.status = fighter.status.filter((status) => !isStatusType(status.type, SLACKING_RETURN_PROTECTION_STATUS_TYPES));
        runtime.log('heal', `⛺ 摸鱼时间结束！${fighter.name} 悠闲地散步回到了战场，并且状态绝佳（恢复满血）！`);
      });
      currentlySlacking.forEach((fighter) => {
        fighter.wasSynergySlacking = false;
        fighter.currentHp = fighter.maxHp;
        runtime.syncHpPct(fighter);
        fighter.status = fighter.status.filter((status) => !isStatusType(status.type, SLACKING_AWAY_STATUS_TYPES));
        runtime.log('heal', `⛺ 看到搭子回去打工了，${fighter.name} 也赶紧喝完最后一口奶茶，跟着溜回了战场！`);
      });
    }
  },
};
