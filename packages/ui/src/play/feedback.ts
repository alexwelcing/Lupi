/**
 * feedback.ts — the cue router for toy feedback (sound and haptics).
 *
 * Toys call `cue(kind)` at the moment something clicks into place; this file
 * decides what, if anything, the visitor hears or feels. Both channels are OFF
 * by default and only Settings turns them on:
 *
 * - Sound (lib/clickSound.ts): one procedural click, voiced per kind. Nothing
 *   touches Web Audio while Sound is off.
 * - Haptics (lib/haptics.ts): a short vibration tick, 6 ms for a detent, a
 *   catch or a Tug grab, 12 ms for a flip, 10 ms for a Burst, 8 ms for a
 *   reset, 4 ms each time Heat warms past another 300 K, 8 ms for a Remix
 *   roll, 14 ms for a Foil, none for a poke or a Tug release (a tap or a lift
 *   the finger already felt).
 * - A Foil roll plays a three-note chime (three rising clicks) instead of one.
 *
 * Neither depends on Motion comfort: they are not motion.
 */
import { isClickSoundEnabled, playClick, type ClickOptions } from '../lib/clickSound';
import { tick } from '../lib/haptics';

export type CueKind = 'detent' | 'catch' | 'flip' | 'poke' | 'reset' | 'burst' | 'grab' | 'release' | 'warm' | 'roll' | 'foil';

/** Haptic tick length per cue, in ms (0: none). */
export const CUE_HAPTIC_MS: Readonly<Record<CueKind, number>> = {
  detent: 6,
  catch: 6,
  flip: 12,
  reset: 8,
  poke: 0,
  burst: 10,
  grab: 6,
  release: 0,
  warm: 4,
  roll: 8,
  foil: 14,
};

/** Click voice per cue: the detent is the house click; the rest sit around it. */
const CUE_VOICE: Readonly<Record<CueKind, ClickOptions>> = {
  detent: { freq: 2600, gain: 0.05 },
  catch: { freq: 1700, gain: 0.04 },
  flip: { freq: 3400, gain: 0.06 },
  reset: { freq: 2000, gain: 0.045 },
  poke: { freq: 1300, gain: 0.03 },
  burst: { freq: 900, gain: 0.055 },
  grab: { freq: 1500, gain: 0.03 },
  release: { freq: 2200, gain: 0.035 },
  warm: { freq: 700, gain: 0.025 },
  roll: { freq: 1900, gain: 0.04 },
  foil: { freq: 2400, gain: 0.045 },
};

/** The Foil chime: three rising notes, about 110 ms apart. */
const FOIL_CHIME: ReadonlyArray<ClickOptions & { at: number }> = [
  { at: 0, freq: 2400, gain: 0.045 },
  { at: 110, freq: 3000, gain: 0.045 },
  { at: 220, freq: 3800, gain: 0.05 },
];

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
  if (kind === 'foil') {
    for (const note of FOIL_CHIME) {
      if (note.at === 0) playClick(note);
      else setTimeout(() => playClick(note), note.at);
    }
    return;
  }
  playClick(CUE_VOICE[kind]);
}
