/**
 * motionClock.ts — the wall clock display motion steps by.
 *
 * PlayLayer advances the display-motion clock by the wall time between drawn
 * frames. Instant Replay's offline clip draws its frames at whatever pace the
 * device manages, one clip frame per drawn frame, so while it renders it
 * drives this clock itself: exactly 1/30 s for each clip frame, and no time
 * at all on the frames in between (replay/offlineClip.ts). The toys then move
 * by the clip's clock, frame for frame, on a fast desktop and a slow phone
 * alike. Every other time it is `performance.now()`.
 */

let driver: (() => number) | null = null;

/** The display-motion wall time (ms): `performance.now()`, or a clip's frame clock while one renders. */
export function motionWallMs(): number {
  if (driver) return driver();
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Drive the display-motion clock (ms) until the returned release runs. */
export function driveMotionClock(read: () => number): () => void {
  driver = read;
  return () => {
    if (driver === read) driver = null;
  };
}
