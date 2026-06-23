import type {
  CharacterDefeatContext,
  CharacterHook,
  CharacterReentryContext,
  CharacterReviveContext,
  CharacterSkillSelectionContext,
  CharacterTransformContext,
  CharacterWaitCounterContext,
  CharacterWinPreventionContext,
} from './characterHooks/types';
import { bunnyHook } from './characterHooks/bunny';
import { gachaHook } from './characterHooks/gacha';
import { jokerHook } from './characterHooks/joker';
import { morphlingHook } from './characterHooks/morphling';
import { siguaHook } from './characterHooks/sigua';
import { slackingBondHook } from './characterHooks/slacking';
import { succubusHook } from './characterHooks/succubus';
import { tingHook } from './characterHooks/ting';
import { tokusatsuHook } from './characterHooks/tokusatsu';
import { valoJuniorHook } from './characterHooks/valoJunior';
import { warThunderHook } from './characterHooks/warThunder';

export { executeSlackingSynergy } from './characterHooks/slacking';
export type {
  CharacterDefeatContext,
  CharacterHook,
  CharacterHookRuntime,
  CharacterReentryContext,
  CharacterReviveContext,
  CharacterSkillSelectionContext,
  CharacterSkillSelectionPhase,
  CharacterTransformContext,
  CharacterWaitCounterContext,
  CharacterWinPreventionContext,
} from './characterHooks/types';

const CHARACTER_HOOKS: CharacterHook[] = [
  morphlingHook,
  slackingBondHook,
  valoJuniorHook,
  jokerHook,
  tingHook,
  tokusatsuHook,
  gachaHook,
  succubusHook,
  siguaHook,
  bunnyHook,
  warThunderHook,
];

export function runCharacterSkillSelectionHooks(ctx: CharacterSkillSelectionContext): string | null {
  for (const hook of CHARACTER_HOOKS) {
    const skillId = hook.selectSkill?.(ctx);
    if (skillId) return skillId;
  }
  return null;
}

export function runCharacterTransformHooks(ctx: CharacterTransformContext): boolean {
  return CHARACTER_HOOKS.some((hook) => hook.onTransformCheck?.(ctx));
}

export function runCharacterDefeatHooks(ctx: CharacterDefeatContext): void {
  CHARACTER_HOOKS.forEach((hook) => hook.onDefeated?.(ctx));
}

export function shouldCharacterPreventWin(ctx: CharacterWinPreventionContext): boolean {
  return CHARACTER_HOOKS.some((hook) => hook.shouldPreventWin?.(ctx));
}

export function runCharacterReviveHooks(ctx: CharacterReviveContext): boolean {
  return CHARACTER_HOOKS.some((hook) => hook.onReviveCheck?.(ctx));
}

export function runCharacterWaitCounterHooks(ctx: CharacterWaitCounterContext): boolean {
  return CHARACTER_HOOKS.some((hook) => hook.onWaitCounter?.(ctx));
}

export function runCharacterReentryHooks(ctx: CharacterReentryContext): void {
  CHARACTER_HOOKS.forEach((hook) => hook.resolveReentry?.(ctx));
}
