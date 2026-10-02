/**
 * feedback.ts — the cue router for toy feedback (sound and haptics).
 *
 * Toys call `cue(kind)` at the moment something clicks into place; this file
 * decides what, if anything, the visitor hears or feels. Both channels are OFF
 * by default and only Settings turns them on:
 *
 * - Sound (lib/clickSound.ts): one procedural click, voiced per kind. Nothing
 *   touches Web Audio while Sound is off.
 * - Haptics (lib/haptics.ts): a short vibration tick, 6 ms for a detent or a
 *   catch, 12 ms for a flip, 8 ms for a reset, none for a poke (a poke is a
 *   tap the finger already felt).
 *
 * Neither depends on Motion comfort: they are not motion.
 */
import { isClickSoundEnabled, playClick, type ClickOptions } from '../lib/clickSound';
import { tick } from '../lib/haptics';

export type CueKind = 'detent' | 'catch' | 'flip' | 'poke' | 'reset';

/** Haptic tick length per cue, in ms (0: none). */
export const CUE_HAPTIC_MS: Readonly<Record<CueKind, number>> = {
  detent: 6,
  catch: 6,
  flip: 12,
  reset: 8,
  poke: 0,
};

/** Click voice per cue: the detent is the house click; the rest sit around it. */
const CUE_VOICE: Readonly<Record<CueKind, ClickOptions>> = {
  detent: { freq: 2600, gain: 0.05 },
  catch: { freq: 1700, gain: 0.04 },
  flip: { freq: 3400, gain: 0.06 },
  reset: { freq: 2000, gain: 0.045 },
  poke: { freq: 1300, gain: 0.03 },
};

/** Clicks closer together than this merge into one (no machine-gun rattle). */
const MIN_CLICK_GAP_MS = 35;
let lastClickAt = -Infinity;

export function cue(kind: CueKind): void {
  const hapticMs = CUE_HAPTIC_MS[kind];
  if (hapticMs > 0) tick(hapticMs);
  if (!isClickSoundEnabled()) return;
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (t - lastClickAt < MIN_CLICK_GAP_MS) return;
  lastClickAt = t;
  playClick(CUE_VOICE[kind]);
}
