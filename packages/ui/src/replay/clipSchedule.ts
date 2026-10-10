/**
 * clipSchedule.ts — the offline clip's frames, on the clip's own clock.
 *
 * The clip is rendered frame by frame, never recorded in real time, so every
 * frame has a fixed place: frame i shows the tape at i / 30 s and carries the
 * timestamp round(i × 10⁶ / 30) µs, however long the device took to draw it.
 * The pill's flashes are read from the tape on the same clock (a face's name
 * shows for as long as it did on the sender's pill), so a slow phone and a
 * fast desktop make the same clip.
 *
 * Pure: the browser side is offlineClip.ts.
 */
import type { FlashKind, Tape } from './tape';

/** The clip's frame rate (frames per second). */
export const CLIP_FPS = 30;

/**
 * How long a replayed flash shows (ms), as the live pill shows it
 * (player.ts replays them with the same lengths).
 */
export const CLIP_FLASH_MS: Readonly<Record<FlashKind, number>> = { detent: 1200, flip: 1800, catch: 700, info: 1400 };

/** Frames in a clip of `duration` seconds (at least one). */
export function clipFrameCount(duration: number, fps: number = CLIP_FPS): number {
  if (!Number.isFinite(duration) || duration <= 0) return 1;
  return Math.max(1, Math.round(duration * fps));
}

/** Where frame `index` sits on the clip's clock (s). */
export function clipFrameTime(index: number, fps: number = CLIP_FPS): number {
  return index / fps;
}

/** Frame `index`'s presentation timestamp (µs, integer, as WebCodecs takes it). */
export function clipFrameTimestamp(index: number, fps: number = CLIP_FPS): number {
  return Math.round((index * 1_000_000) / fps);
}

/** Frame `index`'s duration (µs): to the next frame's timestamp, so the durations sum to the clip. */
export function clipFrameDuration(index: number, fps: number = CLIP_FPS): number {
  return clipFrameTimestamp(index + 1, fps) - clipFrameTimestamp(index, fps);
}

/** One of the pill's flashes on the clip's clock. */
export interface ClipFlash {
  text: string;
  kind: FlashKind;
  /** Clip seconds it shows from, and until. */
  from: number;
  until: number;
}

/** The tape's flashes the clip draws (an `info` flash is the pill talking, not the moment). */
export function tapeFlashes(tape: Pick<Tape, 'events'>): ClipFlash[] {
  const flashes: ClipFlash[] = [];
  for (const event of tape.events) {
    if (event.kind !== 'label' || event.flash === 'info') continue;
    flashes.push({ text: event.text, kind: event.flash, from: event.t, until: event.t + CLIP_FLASH_MS[event.flash] / 1000 });
  }
  return flashes;
}

/** The flash on the pill at `seconds`: the latest one that has started and not ended (a new flash replaces the last). */
export function flashAt(flashes: readonly ClipFlash[], seconds: number): ClipFlash | null {
  let shown: ClipFlash | null = null;
  for (const flash of flashes) {
    if (flash.from > seconds + 1e-9) break;
    shown = flash;
  }
  return shown && seconds < shown.until ? shown : null;
}
