/**
 * cameraGlide.ts — one eased camera move from a pose to a pose.
 *
 * A glide drives a single spring parameter p from 0 to 1 (math's exact
 * spring, so it lands at the same wall-clock time at any frame rate) and
 * derives the pose from it: the orientation slerps, the distance moves in
 * log space (a zoom feels even), and the target lerps. An under-damped token
 * (MOTION.click) overshoots p past 1 and the pose follows along the same
 * arc, which is what makes a detent click home.
 *
 * Pure three.js math: no DOM, no store.
 */
import { Quaternion, Vector3 } from 'three';
import { GLIDE_MAX_S, settleTime, springTo, type MotionToken } from '@atlas/core/motion';

export type GlideKind = 'glide' | 'detent' | 'relevel';

export interface GlidePose {
  orientation: Quaternion;
  logDistance: number;
  target: Vector3;
}

export function createGlidePose(): GlidePose {
  return { orientation: new Quaternion(), logDistance: 0, target: new Vector3() };
}

export function copyGlidePose(out: GlidePose, from: GlidePose): GlidePose {
  out.orientation.copy(from.orientation);
  out.logDistance = from.logDistance;
  out.target.copy(from.target);
  return out;
}

/** Angle (rad) of the rotation between two unit quaternions. */
export function quaternionAngle(a: Quaternion, b: Quaternion): number {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

/**
 * How big a move is, as one angle: the rotation, or the zoom (log distance),
 * or the pan (target shift over the larger distance), whichever is largest.
 */
export function glideMagnitude(from: GlidePose, to: GlidePose): number {
  const rotation = quaternionAngle(from.orientation, to.orientation);
  const zoom = Math.abs(to.logDistance - from.logDistance);
  const reach = Math.exp(Math.max(from.logDistance, to.logDistance));
  const pan = reach > 0 ? from.target.distanceTo(to.target) / reach : 0;
  return Math.max(rotation, zoom, Math.min(Math.PI, pan));
}

/** Seconds a glide of `magnitude` (rad) takes: 0.3 s for a nudge, up to GLIDE_MAX_S for a half turn. */
export function glideDuration(magnitude: number, minS = 0.3, maxS = GLIDE_MAX_S): number {
  const t = minS + (0.5 * Math.max(0, magnitude)) / Math.PI;
  return Math.min(maxS, Math.max(minS, t));
}

const settleCache = new Map<MotionToken, number>();

function cachedSettleTime(token: MotionToken): number {
  let t = settleCache.get(token);
  if (t === undefined) {
    t = settleTime(token, 1e-3);
    settleCache.set(token, t);
  }
  return t;
}

/** `token` rescaled so its step response settles to 1e-3 within `seconds`. */
export function scaleToken(token: MotionToken, seconds: number): MotionToken {
  const base = cachedSettleTime(token);
  if (!(base > 0) || !(seconds > 0)) return token;
  return { smoothTime: (token.smoothTime * seconds) / base, dampingRatio: token.dampingRatio };
}

export interface CameraGlide {
  kind: GlideKind;
  from: GlidePose;
  to: GlidePose;
  /** The exact end position (a store pose lands bit-exact), else null. */
  toPosition: Vector3 | null;
  token: MotionToken;
  /** Spring parameter: value 0 → 1. */
  p: { value: number; velocity: number };
  label: string | null;
  userMoved: boolean;
  onDone: (() => void) | null;
}

export function createCameraGlide(): CameraGlide {
  return {
    kind: 'glide',
    from: createGlidePose(),
    to: createGlidePose(),
    toPosition: null,
    token: { smoothTime: 0.12, dampingRatio: 1 },
    p: { value: 0, velocity: 0 },
    label: null,
    userMoved: false,
    onDone: null,
  };
}

/**
 * Advance the parameter; true once it has settled on 1 (then p is exactly 1).
 * The token is scaled to settle to 1e-3 (a fraction of a degree on any
 * glide) within its duration, so that is where it ends.
 */
export function stepGlide(glide: CameraGlide, dt: number): boolean {
  const p = glide.p;
  springTo(p, 1, glide.token, dt);
  if (Math.abs(1 - p.value) < 1e-3 && Math.abs(p.velocity) < 0.05) {
    p.value = 1;
    p.velocity = 0;
    return true;
  }
  return false;
}

/** The pose at the glide's current parameter (extrapolates past 1 on overshoot). */
export function sampleGlide(glide: CameraGlide, out: GlidePose): GlidePose {
  const t = glide.p.value;
  const { from, to } = glide;
  if (t >= 1 && glide.p.velocity === 0) return copyGlidePose(out, to);
  slerpUnclamped(from.orientation, to.orientation, t, out.orientation);
  out.logDistance = from.logDistance + (to.logDistance - from.logDistance) * t;
  out.target.copy(from.target).lerp(to.target, t);
  return out;
}

/**
 * Slerp that also extrapolates for t outside [0, 1] (three's slerp returns
 * the end quaternion at t = 1 exactly, but its formula is only valid inside).
 */
export function slerpUnclamped(a: Quaternion, b: Quaternion, t: number, out: Quaternion): Quaternion {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let wa: number;
  let wb: number;
  if (cos > 1 - 1e-9) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = Math.sin(t * theta) / sin;
  }
  out.set(a.x * wa + bx * wb, a.y * wa + by * wb, a.z * wa + bz * wb, a.w * wa + bw * wb);
  return out.normalize();
}
