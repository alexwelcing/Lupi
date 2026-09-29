/**
 * releaseVelocity.ts — how fast the pointer was moving when it let go.
 *
 * A least-squares slope over the (coalesced) samples in the last
 * `windowMs` before release. Timestamps are `event.timeStamp` values (never
 * `performance.now()` at handling time: a busy main thread delivers moves in
 * bursts, and only the event timestamps keep the real speed). A release that
 * comes `pauseMs` after the last move is a held release: velocity 0, so a
 * drag that stops before letting go never coasts.
 */
import { GESTURE } from './gestureTokens';

export interface PointerSample {
  x: number;
  y: number;
  /** Milliseconds (event.timeStamp). */
  t: number;
}

export interface ReleaseVelocity {
  /** CSS px per second. */
  vx: number;
  vy: number;
}

const ZERO: ReleaseVelocity = Object.freeze({ vx: 0, vy: 0 }) as ReleaseVelocity;

export function releaseVelocity(
  samples: readonly PointerSample[],
  releaseT: number,
  {
    windowMs = GESTURE.flickWindowMs,
    pauseMs = GESTURE.flickPauseMs,
    minSamples = 3,
  }: { windowMs?: number; pauseMs?: number; minSamples?: number } = {},
): ReleaseVelocity {
  const n = samples.length;
  if (n < minSamples) return ZERO;
  const last = samples[n - 1];
  if (!(releaseT - last.t <= pauseMs)) return ZERO;
  const from = releaseT - windowMs;
  let count = 0;
  let st = 0;
  let sx = 0;
  let sy = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const s = samples[i];
    if (s.t < from) break;
    count += 1;
    st += s.t;
    sx += s.x;
    sy += s.y;
  }
  if (count < minSamples) return ZERO;
  const mt = st / count;
  const mx = sx / count;
  const my = sy / count;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (let i = n - count; i < n; i += 1) {
    const s = samples[i];
    const dt = s.t - mt;
    stt += dt * dt;
    stx += dt * (s.x - mx);
    sty += dt * (s.y - my);
  }
  // Every sample at one instant (a burst with identical stamps): no slope.
  if (!(stt > 1e-6)) return ZERO;
  const vx = (stx / stt) * 1000;
  const vy = (sty / stt) * 1000;
  return Number.isFinite(vx) && Number.isFinite(vy) ? { vx, vy } : ZERO;
}
