import type { BattleEvent } from './types';

export const BATTLE_CINEMATIC_DURATION_MS = {
  transformation: 3200,
  tokusatsuTransformation: 3600,
  formShift: 1500,
  summonReveal: 2800,
  summonSequence: 4400,
  finisher: 1900,
  themedFinisher: 2100,
  tokusatsuFinisher: 2600,
} as const;

export const BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS = 200;

type VisualTimingEvent = Pick<BattleEvent, 'visualCue' | 'presentation'>;

export function getVisualCueMinimumDisplayMs(event: Partial<VisualTimingEvent>): number {
  const cue = event.visualCue;
  if (cue?.kind === 'transformation') {
    return BATTLE_CINEMATIC_DURATION_MS.tokusatsuTransformation + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS;
  }
  if (cue?.kind === 'form_shift') {
    return BATTLE_CINEMATIC_DURATION_MS.formShift + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS;
  }
  if (cue?.kind === 'summon_card') {
    const duration = cue.summonKind === 'reveal'
      ? BATTLE_CINEMATIC_DURATION_MS.summonReveal
      : BATTLE_CINEMATIC_DURATION_MS.summonSequence;
    return duration + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS;
  }
  const presentation = cue?.kind === 'combat_action' ? cue.presentation : event.presentation;
  if (presentation === 'finisher') {
    return BATTLE_CINEMATIC_DURATION_MS.tokusatsuFinisher + BATTLE_CINEMATIC_PLAYBACK_BUFFER_MS;
  }
  return 0;
}
