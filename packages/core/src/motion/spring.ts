import { wrapAngle } from 'math';
import { spring, spring3 } from 'math/time';
import type { MotionToken } from './tokens';

/** Caller-owned scalar spring state, mutated in place. */
export type Spring1 = { value: number; velocity: number };
/** Caller-owned 3-vector spring state, mutated in place. */
export type Spring3 = {
  value: [number, number, number];
  velocity: [number, number, number];
};

export function createSpring1(value = 0): Spring1 {
  return { value, velocity: 0 };
}

export function createSpring3(value: [number, number, number] = [0, 0, 0]): Spring3 {
  return { value: [value[0], value[1], value[2]], velocity: [0, 0, 0] };
}

/**
 * Advance `s` toward `target` by `dt` seconds on `token` (exact, stable at any
 * dt). `cut` lands it instantly: value = target, velocity = 0. Mutates `s`.
 */
export function springTo(
  s: Spring1,
  target: number,
  token: MotionToken,
  dt: number,
  cut = false,
): Spring1 {
  if (cut) {
    s.value = target;
    s.velocity = 0;
    return s;
  }
  return spring.update(s, target, token.smoothTime, token.dampingRatio, dt > 0 ? dt : 0);
}

export function springTo3(
  s: Spring3,
  target: [number, number, number],
  token: MotionToken,
  dt: number,
  cut = false,
): Spring3 {
  if (cut) {
    s.value[0] = target[0];
    s.value[1] = target[1];
    s.value[2] = target[2];
    s.velocity[0] = 0;
    s.velocity[1] = 0;
    s.velocity[2] = 0;
    return s;
  }
  return spring3.update(s, target, token.smoothTime, token.dampingRatio, dt > 0 ? dt : 0);
}

/**
 * Critically damped angle spring along the shortest arc; unlike math's
 * `spring.dampAngle`, the value stays wrapped into (−π, π].
 */
export function dampAngleWrapped(
  s: Spring1,
  target: number,
  smoothTime: number,
  dt: number,
): Spring1 {
  spring.dampAngle(s, target, smoothTime, dt > 0 ? dt : 0);
  s.value = wrapAngle(s.value);
  return s;
}
