import type {
  CharacterDefeatContext,
  CharacterDefeatSettledContext,
  CharacterGlobalTickContext,
  CharacterHook,
  CharacterReentryContext,
  CharacterReviveContext,
  CharacterSkillSelectionContext,
  CharacterTransformContext,
  CharacterWaitCounterContext,
  CharacterWinPreventionContext,
} from './characterHooks/types';
import { bunnyHook } from './characterHooks/bunny';
import { emoteHook } from './characterHooks/emote';
import { gachaHook } from './characterHooks/gacha';
import { gamerHook } from './characterHooks/gamer';
import { jokerHook } from './characterHooks/joker';
import { morphlingHook } from './characterHooks/morphling';
import { momoHook } from './characterHooks/momo';
import { owlHook } from './characterHooks/owl';
import { siguaHook } from './characterHooks/sigua';
import { slackingBondHook } from './characterHooks/slacking';
import { succubusHook } from './characterHooks/succubus';
import { surtrHook } from './characterHooks/surtr';
import { tingHook } from './characterHooks/ting';
import { tokusatsuHook } from './characterHooks/tokusatsu';
import { valoJuniorHook } from './characterHooks/valoJunior';
import { warThunderHook } from './characterHooks/warThunder';
import { yuzuHook } from './characterHooks/yuzu';

export { executeSlackingSynergy } from './characterHooks/slacking';
export type {
  CharacterDefeatContext,
  CharacterDefeatSettledContext,
  CharacterGlobalTickContext,
  CharacterHook,
  CharacterHookRuntime,
  CharacterReentryContext,
  ReactionActionDescriptor,
  CharacterReviveContext,
  CharacterSkillSelectionContext,
  CharacterSkillSelectionPhase,
  CharacterTransformContext,
  CharacterWaitCounterContext,
  CharacterWinPreventionContext,
} from './characterHooks/types';

const CHARACTER_HOOKS: CharacterHook[] = [
  morphlingHook,
  surtrHook,
  owlHook,
  slackingBondHook,
  momoHook,
  valoJuniorHook,
  gamerHook,
  jokerHook,
  tingHook,
  tokusatsuHook,
  gachaHook,
  succubusHook,
  siguaHook,
  bunnyHook,
  warThunderHook,
  emoteHook,
  yuzuHook,
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

export function runCharacterDefeatSettledHooks(ctx: CharacterDefeatSettledContext): void {
  CHARACTER_HOOKS.forEach((hook) => hook.onDefeatSettled?.(ctx));
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

export function runCharacterGlobalTickHooks(ctx: CharacterGlobalTickContext): void {
  CHARACTER_HOOKS.forEach((hook) => hook.onGlobalTick?.(ctx));
}
