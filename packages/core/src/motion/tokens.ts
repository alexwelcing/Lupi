/**
 * Motion tokens: the handful of named springs every Lupi motion uses.
 *
 * A token is the two dials of math's exact damped spring (`math/time`):
 * `smoothTime` (roughly the time to reach the target, ω = 2 / smoothTime) and
 * `dampingRatio` (1 = critical, < 1 overshoots). Because the spring is solved
 * analytically, a token settles at the same wall-clock time at 30, 60 or
 * 120 Hz.
 */
export interface MotionToken {
  readonly smoothTime: number;
  readonly dampingRatio: number;
}

export const MOTION = {
  snap: { smoothTime: 0.05, dampingRatio: 1 },
  glide: { smoothTime: 0.12, dampingRatio: 1 },
  /** ≈4.6 % overshoot: a detent clicking home. */
  click: { smoothTime: 0.09, dampingRatio: 0.7 },
  /** ≈2.8 % overshoot: the arrival condensing. */
  land: { smoothTime: 0.125, dampingRatio: 0.75 },
  boing: { smoothTime: 0.12, dampingRatio: 0.45 },
  settle: { smoothTime: 0.2, dampingRatio: 1 },
  float: { smoothTime: 0.35, dampingRatio: 0.8 },
} as const satisfies Record<string, MotionToken>;

export type MotionTokenName = keyof typeof MOTION;

/** No UI glide lasts longer than this (seconds). */
export const GLIDE_MAX_S = 0.8;
