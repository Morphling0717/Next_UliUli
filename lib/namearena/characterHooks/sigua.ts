import type { Fighter } from '../types';
import type { CharacterHook, CharacterHookRuntime } from './types';
import { isSelectableTargetFor } from '../targeting';

type TeamRuntime = Pick<CharacterHookRuntime, 'fighters' | 'turnCount' | 'getTeamId' | 'isActiveCombatant'>;

const CLEANSABLE_STATUS_TYPES = new Set([
  'STUN',
  'FREEZE',
  'BURN',
  'POISON',
  'BLIND',
  'SILENCE',
  'CONFUSED',
  'CHARMED',
  'VALO_FLASH',
  'VALO_AIM_PUNCH',
  'VALO_CYPHER_REVEALED',
  'NEURAL_THEFT_DEBUFF',
  'BABY_WEAKNESS_MARK',
]);

function scaleStat(value: number, multiplier: number, floor: number): number {
  return Math.max(floor, Math.floor(value * multiplier));
}

function findTeamClaire(actor: Fighter, runtime: TeamRuntime): Fighter | undefined {
  const actorTeamId = runtime.getTeamId(actor);
  return runtime.fighters.find((candidate) =>
    candidate.isSuccubus &&
    runtime.isActiveCombatant(candidate) &&
    runtime.getTeamId(candidate) === actorTeamId,
  );
}

function getEnemies(actor: Fighter, runtime: TeamRuntime): Fighter[] {
  return runtime.fighters.filter((candidate) =>
    isSelectableTargetFor(runtime, actor, candidate),
  );
}

function hasCleansableStatus(fighter: Fighter): boolean {
  return fighter.status.some((status) => CLEANSABLE_STATUS_TYPES.has(status.type));
}

export function selectBabySupportSkill(actor: Fighter, runtime: TeamRuntime): string {
  const claire = findTeamClaire(actor, runtime);
  const supportTarget = claire ?? actor;
  const enemies = getEnemies(actor, runtime);
  const canHealSupportTarget = !supportTarget.status.some((status) => status.type === 'NO_HEAL');

  if (hasCleansableStatus(supportTarget)) return 'baby_bandaid';
  if (supportTarget.hpPct < 0.45 && canHealSupportTarget) return 'baby_feed';
  if (supportTarget.hpPct < 0.65 && !supportTarget.status.some((status) => status.type === 'INVUL')) return 'baby_shield';
  if (supportTarget.hpPct < 0.75 && canHealSupportTarget && Math.random() < 0.45) return 'baby_feed';

  const freshEnemy = enemies.find((enemy) => !enemy.status.some((status) => status.type === 'WEAK'));
  if (freshEnemy && Math.random() < 0.35) return 'baby_scan';
  if (enemies.length >= 2 && Math.random() < 0.35) return 'baby_satellite';
  if (claire && claire.spd < actor.spd * 1.5 && Math.random() < 0.25) return 'baby_speed';
  if (claire && Math.random() < 0.25) return 'baby_cheer';
  if (enemies.length > 0 && Math.random() < 0.25) return 'baby_poison';
  return Math.random() < 0.55 ? 'baby_satellite' : 'baby_laser';
}

export const siguaHook: CharacterHook = {
  id: 'sigua',

  selectSkill: ({ actor, runtime, phase }) => {
    if (phase !== 'preMechanics' || actor.job !== 'MY_BABY') return null;
    return selectBabySupportSkill(actor, runtime);
  },

  onTransformCheck: ({ fighter, runtime, transform }) => {
    if (!fighter.isSigua) return false;

    const MY_BABY = runtime.jobs.MY_BABY;
    const VALO_JUNIOR = runtime.jobs.VALO_JUNIOR;
    const claire = runtime.fighters.find((candidate) =>
      candidate.isSuccubus &&
      runtime.isActiveCombatant(candidate) &&
      runtime.getTeamId(candidate) === runtime.getTeamId(fighter),
    );

    if (claire && MY_BABY) {
      transform('MY_BABY', `👶 ${fighter.name} 看到同队的克蕾儿陷入苦战！羁绊爆发！转职为专属辅助【${MY_BABY.name}】！`, () => {
        fighter.maxHp = Math.max(3000, Math.min(3400, Math.floor(fighter.maxHp * 2.4)));
        fighter.currentHp = fighter.maxHp;
        fighter.atk = scaleStat(fighter.atk, 1.5, 80);
        fighter.def = scaleStat(fighter.def, 4.0, 160);
        fighter.res = scaleStat(fighter.res, 4.0, 160);
        fighter.agl = scaleStat(fighter.agl, 3.0, 120);
        fighter.wis = 250;
        fighter.spd = 130;
        fighter.mag = 300;
      });
      return true;
    }

    if (!VALO_JUNIOR) return false;
    transform('VALO_JUNIOR', `🔫 ${fighter.name} 眼神变了！拿起了步枪！转职为【${VALO_JUNIOR.name}】！全场特工技能准备就绪！`, () => {
      fighter.maxHp = Math.max(3000, Math.min(3375, Math.floor(fighter.maxHp * 2.48)));
      fighter.currentHp = fighter.maxHp;
      fighter.atk = 286;
      fighter.def = scaleStat(fighter.def, 3.5, 150);
      fighter.mag = scaleStat(fighter.mag, 1.5, 90);
      fighter.res = scaleStat(fighter.res, 3.5, 150);
      fighter.spd = 130;
      fighter.agl = Math.max(215, Math.floor(fighter.agl * 4.9));
      fighter.wis = scaleStat(fighter.wis, 2.0, 150);
      fighter.ultPoints = 1;
      fighter.economy = 2;
      fighter.crosshairFocus = 0;
    });
    return true;
  },
};
