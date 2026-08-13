import type {
  BattleFormIdentity,
  BattleLogMetadata,
  BattleState,
  Fighter,
  FormTransitionCause,
  SkillDefinition,
  SkillPresentation,
} from './types';

export type FormTransitionKind = 'transformation' | 'form_shift';

export type MajorNpcEventPresentation = {
  kind: 'puruisaishi' | 'herobrine';
  title: string;
  phase: string;
  detail: string;
  countdown?: string;
  tone: 'originium' | 'herobrine';
};

function isPresentOnBattlefield(fighter: Fighter | undefined): fighter is Fighter {
  return !!fighter && !fighter.isDead && !fighter.isDeadAnnounced && fighter.currentHp > 0;
}

export function buildMajorNpcEventPresentation(
  battleState: BattleState,
  fighters: readonly Fighter[],
  turnCount: number,
): MajorNpcEventPresentation | null {
  const event = battleState.majorNpcEvent;
  if (!event) return null;

  if (event.kind === 'puruisaishi') {
    const puruisaishi = fighters.find((fighter) => fighter.isPuruisaishi);
    const phase = Math.max(1, puruisaishi?.puruisaishiPhase ?? 1);
    const crystalCount = fighters.filter((fighter) =>
      fighter.isOriginiumCrystal && isPresentOnBattlefield(fighter),
    ).length;
    const coreCount = fighters.filter((fighter) =>
      fighter.isOriginiumCore && isPresentOnBattlefield(fighter),
    ).length;
    const phaseTwoAt = (puruisaishi?.puruisaishiEnteredTurn ?? event.startedTurn) + 50;
    return {
      kind: 'puruisaishi',
      title: '普瑞赛斯事件',
      phase: phase >= 2 ? '万籁俱寂' : '源石映像',
      detail: `阿喃那 ${coreCount} · 源石结晶 ${crystalCount}`,
      countdown: phase < 2 ? `二阶段还有 ${Math.max(0, phaseTwoAt - turnCount)} 个全局行动` : '每 20 个全局行动扩散矿石病',
      tone: 'originium',
    };
  }

  const activeTraceCount = event.traceIds.filter((id) =>
    isPresentOnBattlefield(fighters.find((fighter) => fighter.id === id)),
  ).length;
  const activeCloneCount = event.cloneIds.filter((id) =>
    isPresentOnBattlefield(fighters.find((fighter) => fighter.id === id)),
  ).length;
  const herobrine = fighters.find((fighter) => fighter.id === event.herobrineId);
  const isHidden = !!herobrine && herobrine.npcUnitState?.capabilities.visible === false;

  if (event.phase === 'fog') {
    return {
      kind: 'herobrine',
      title: 'Herobrine 异常事件',
      phase: '雾中人',
      detail: `异常痕迹 ${activeTraceCount} · 白眼分身 ${activeCloneCount}`,
      countdown: `正式现身还有 ${Math.max(0, event.startedTurn + 10 - turnCount)} 个全局行动`,
      tone: 'herobrine',
    };
  }
  if (event.phase === 'removed') {
    return {
      kind: 'herobrine',
      title: 'Removed Herobrine.',
      phase: event.finalPursuit ? '最终追猎' : '等待回归',
      detail: `异常痕迹 ${activeTraceCount} · 已回归 ${event.revivalCount} 次`,
      countdown: event.removedReturnTurn === undefined
        ? '回归倒计时尚未开始'
        : `回归还有 ${Math.max(0, event.removedReturnTurn - turnCount)} 个全局行动`,
      tone: 'herobrine',
    };
  }
  if (event.phase === 'retreated') {
    const contestantsDefeated = event.outcome === 'contestants_defeated';
    return {
      kind: 'herobrine',
      title: contestantsDefeated ? 'Herobrine 异常事件' : 'Removed Herobrine.',
      phase: contestantsDefeated ? '猎杀结束' : '真正退场',
      detail: contestantsDefeated
        ? `参赛者全灭 · Herobrine 共回归 ${event.revivalCount} 次`
        : `玩家完成击退 · 本局共回归 ${event.revivalCount} 次`,
      tone: 'herobrine',
    };
  }

  const singleWorldTarget = event.singleWorld
    ? fighters.find((fighter) => fighter.id === event.singleWorld?.targetId)
    : undefined;
  return {
    kind: 'herobrine',
    title: 'Herobrine 异常事件',
    phase: event.finalPursuit
      ? '最终追猎'
      : event.phase === 'phase_two'
        ? '你不是一个人在玩'
        : isHidden
          ? '雾后之人'
          : '远处的白眼',
    detail: event.singleWorld
      ? `单人世界：${singleWorldTarget?.name ?? '未知目标'} · 至大回合 ${event.singleWorld.endsAfterLargeRound}`
      : `异常痕迹 ${activeTraceCount} · 白眼分身 ${activeCloneCount}`,
    countdown: isHidden && event.hiddenUntilTurn !== undefined
      ? `重新现身还有 ${Math.max(0, event.hiddenUntilTurn - turnCount)} 个全局行动`
      : event.phase === 'phase_one' && event.formalAppearanceTurn !== undefined
        ? `最迟 ${Math.max(0, event.formalAppearanceTurn + 40 - turnCount)} 个全局行动后进入二阶段`
        : undefined,
    tone: 'herobrine',
  };
}

export type FormTransitionCommit = {
  fighter: Fighter;
  message: string | (() => string);
  mutate: () => void;
  log: (type: string, text: string, metadata?: BattleLogMetadata) => void;
  logType?: string;
  kind?: FormTransitionKind;
  cause?: FormTransitionCause;
  force?: boolean;
};

const CINEMATIC_ADVANCED_SUMMONS = new Set([
  '青眼白龙',
  '青眼究极龙',
  '翼神龙',
  '黑暗大法师',
]);

export function getBattlePhase(fighter: Fighter): number {
  if (fighter.job === 'HEROBRINE_PHASE_TWO') return 2;
  if (fighter.isPuruisaishi) return Math.max(1, fighter.puruisaishiPhase ?? 1);
  if (fighter.isYuzuProphet) return Math.max(1, fighter.yuzuProphetState?.phase ?? 1);
  if (fighter.isYuzu) return Math.max(1, fighter.yuzuPhase ?? 1);
  if (fighter.isOwl) return Math.max(1, fighter.owlState?.phase ?? 1);
  if (fighter.isMomo) return Math.max(1, fighter.momoState?.phase ?? 1);
  if (fighter.job === 'MIRACLE_MONSTER_BUJIN' || fighter.job === 'GOD_OF_TROLLS') return 3;
  return fighter.transformed ? 2 : 1;
}

export function readBattleFormIdentity(fighter: Fighter): BattleFormIdentity {
  return {
    jobKey: fighter.job,
    jobName: fighter.jobData?.name ?? '未知职业',
    icon: fighter.jobData?.icon ?? (fighter.name.slice(0, 1) || '名'),
    phase: getBattlePhase(fighter),
  };
}

export function battleFormChanged(before: BattleFormIdentity, after: BattleFormIdentity): boolean {
  return before.jobKey !== after.jobKey || before.phase !== after.phase;
}

/**
 * Commits every form mutation before publishing the one authoritative visual event.
 * Side effects that happen after the transformation narration should remain outside
 * this function so they cannot accidentally inherit the form cue.
 */
export function commitFormTransition({
  fighter,
  message,
  mutate,
  log,
  logType = 'transform',
  kind,
  cause,
  force = false,
}: FormTransitionCommit): boolean {
  const from = readBattleFormIdentity(fighter);
  mutate();
  const to = readBattleFormIdentity(fighter);
  if (!force && !battleFormChanged(from, to)) return false;

  const resolvedKind: FormTransitionKind = kind ?? (to.phase > from.phase ? 'transformation' : 'form_shift');
  const resolvedCause: FormTransitionCause = cause ?? (resolvedKind === 'transformation' ? 'phase_advance' : 'form_change');
  log(logType, typeof message === 'function' ? message() : message, {
    actorId: fighter.id,
    actorName: fighter.name,
    targetIds: [fighter.id],
    visualCue: {
      kind: resolvedKind,
      fighterId: fighter.id,
      fighterName: fighter.name,
      from,
      to,
      cause: resolvedCause,
    },
  });
  return true;
}

export function isCinematicAdvancedSummon(fighter: Fighter): boolean {
  if (!fighter.isSummon || !fighter.isAdvancedSummon) return false;
  return CINEMATIC_ADVANCED_SUMMONS.has(fighter.summonBaseName ?? fighter.name.replace(/#\d+$/, ''));
}

export function resolveSkillPresentation(
  skillId: string | null,
  skill: SkillDefinition | undefined,
  actor: Fighter,
): SkillPresentation {
  if (skillId === null) return 'basic';
  const requested = skill?.presentation ?? 'skill';
  if (requested === 'finisher' && actor.isSummon && !isCinematicAdvancedSummon(actor)) return 'skill';
  return requested;
}
