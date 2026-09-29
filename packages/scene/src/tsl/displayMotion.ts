/**
 * displayMotion.ts — display-only motion (arrival, poke ripple, scatter) as a
 * GPU offset on atom and bond centres.
 *
 * WP0 stub: the final export names with inert bodies. The offset is zero, the
 * weight never rises, and suspending is a no-op, so the materials, the driver
 * and the capture guard can be wired before the real node graph lands (WP5).
 */
import type { Node } from 'three/webgpu';
import { vec3 } from 'three/tsl';

/** Tuning points (owner feedback): cloud, delays and ripple character. */
export const DISPLAY_MOTION_TUNING = {
  cloudScale: 1.6,
  maxDelayS: 0.2,
  jitterS: 0.03,
  flatFrontDelayS: 0.12,
  scatterRiseS: 0.18,
  rippleSpeed: 20,
  rippleOmega: 36,
  rippleZeta: 0.28,
  rippleFalloffA: 8,
  rippleAmplitude: 0.3,
} as const;

/**
 * The display offset (world space, Å) to add to a rest centre. `rest` is the
 * rest centre (vec3) and `rawPosition` the raw instance attribute it came from
 * (the seed source). Stub: always vec3(0).
 */
export function lupiDisplayOffset(rest: Node, rawPosition: Node): Node {
  void rest;
  void rawPosition;
  return vec3(0);
}

/** Save and zero the master weight for one capture render; returns the restore. Stub: no-op. */
export function suspendLupiDisplayMotion(): () => void {
  return () => {};
}

/** True while any display motion is live (weight > 0). Stub: never. */
export function isLupiDisplayMotionActive(): boolean {
  return false;
}

let suspended = false;

/** Hold display motion at zero (for example while a video records). */
export function setDisplayMotionSuspended(on: boolean): void {
  suspended = on;
}

export function isDisplayMotionSuspended(): boolean {
  return suspended;
}
