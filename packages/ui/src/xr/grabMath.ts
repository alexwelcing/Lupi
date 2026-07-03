/**
 * grabMath — pure transform math for XR grab manipulation.
 *
 * No React, no globals-dependent state: every function is deterministic and
 * writes its result into a caller-provided `out` object so the interaction
 * loop can run it every XR frame without allocating. Module-level scratch
 * objects exist purely as temporaries — no result ever depends on their
 * previous contents.
 *
 * Delta convention (shared by the one- and two-hand paths): a delta is the
 * world-space affine map
 *
 *     pos'  = deltaQuat * (scaleFactor * pos) + deltaPos
 *     quat' = deltaQuat * quat
 *
 * with `deltaPos` chosen so the grab point (hand position / grip midpoint)
 * maps exactly onto its new location. Applying the map to an object's world
 * pose therefore rotates and scales the object about the grab point — not
 * about the object's own origin — which is what makes a held molecule feel
 * rigidly attached to the hand.
 */

import * as THREE from 'three';

export interface GripPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface RigidDelta {
  deltaPos: THREE.Vector3;
  deltaQuat: THREE.Quaternion;
}

export interface TwoHandDelta extends RigidDelta {
  /** Per-frame scale step, already clamped to the TWO_HAND_SCALE_STEP range. */
  scaleFactor: number;
  /**
   * Grip midpoints (world). Exposed so a caller that clamps the *total*
   * accumulated scale can recompute deltaPos for its adjusted factor and
   * keep the midpoint mapping exact.
   */
  prevMid: THREE.Vector3;
  curMid: THREE.Vector3;
}

export function makeGripPose(): GripPose {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
}

export function makeRigidDelta(): RigidDelta {
  return { deltaPos: new THREE.Vector3(), deltaQuat: new THREE.Quaternion() };
}

export function makeTwoHandDelta(): TwoHandDelta {
  return {
    deltaPos: new THREE.Vector3(),
    deltaQuat: new THREE.Quaternion(),
    scaleFactor: 1,
    prevMid: new THREE.Vector3(),
    curMid: new THREE.Vector3(),
  };
}

// Per-frame scale steps outside this band are tracking glitches (a lost
// joint jumping meters), not intent — a real pinch-zoom at 90 Hz moves a few
// percent per frame at most.
export const TWO_HAND_SCALE_STEP_MIN = 0.97;
export const TWO_HAND_SCALE_STEP_MAX = 1.03;

const EPS = 1e-8;

const _swing = new THREE.Quaternion();
const _avg = new THREE.Quaternion();
const _residual = new THREE.Quaternion();
const _dir0 = new THREE.Vector3();
const _dir1 = new THREE.Vector3();

/**
 * Incremental rigid motion of a single hand between two frames. Applying the
 * returned delta (see module header) moves an object exactly as if welded to
 * the hand: rotation happens about the hand's previous position, so a wrist
 * twist spins the object around the pinch point.
 */
export function oneHandDelta(
  prevHandPos: THREE.Vector3,
  prevHandQuat: THREE.Quaternion,
  handPos: THREE.Vector3,
  handQuat: THREE.Quaternion,
  out: RigidDelta,
): RigidDelta {
  // deltaQuat = handQuat * prevHandQuat⁻¹
  out.deltaQuat.copy(prevHandQuat).invert().premultiply(handQuat).normalize();
  // deltaPos = handPos - deltaQuat * prevHandPos  →  prev grab point maps to cur grab point
  out.deltaPos.copy(prevHandPos).applyQuaternion(out.deltaQuat).negate().add(handPos);
  return out;
}

/**
 * Twist component of `q` about a unit `axis` (swing/twist decomposition).
 * Falls back to identity when the twist is numerically degenerate (near-180°
 * swing) — for grab roll that reads as "no roll this frame", which is the
 * safe behavior.
 */
export function twistAround(
  q: THREE.Quaternion,
  axis: THREE.Vector3,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const proj = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  out.set(axis.x * proj, axis.y * proj, axis.z * proj, q.w);
  const len2 = out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w;
  if (len2 < EPS) return out.identity();
  out.normalize();
  return out;
}

/**
 * Classic two-point grip transform between two frames:
 *  - translation: grip midpoint delta,
 *  - rotation: swing taking the prev A→B direction onto the current one,
 *    plus roll about that axis recovered from the average of the two hands'
 *    own rotation deltas (roll is unobservable from two points alone),
 *  - scale: grip separation ratio, clamped per-frame.
 */
export function twoHandTransform(
  prevA: GripPose,
  prevB: GripPose,
  curA: GripPose,
  curB: GripPose,
  out: TwoHandDelta,
): TwoHandDelta {
  out.prevMid.copy(prevA.position).add(prevB.position).multiplyScalar(0.5);
  out.curMid.copy(curA.position).add(curB.position).multiplyScalar(0.5);

  _dir0.copy(prevB.position).sub(prevA.position);
  _dir1.copy(curB.position).sub(curA.position);
  const len0 = _dir0.length();
  const len1 = _dir1.length();

  out.scaleFactor = THREE.MathUtils.clamp(
    len0 > EPS ? len1 / len0 : 1,
    TWO_HAND_SCALE_STEP_MIN,
    TWO_HAND_SCALE_STEP_MAX,
  );

  if (len0 > EPS && len1 > EPS) {
    _dir0.divideScalar(len0);
    _dir1.divideScalar(len1);
    _swing.setFromUnitVectors(_dir0, _dir1);
    // Average hand rotation delta: RA slerped halfway to RB.
    _avg.copy(prevA.quaternion).invert().premultiply(curA.quaternion);
    _residual.copy(prevB.quaternion).invert().premultiply(curB.quaternion);
    _avg.slerp(_residual, 0.5).normalize();
    // residual = avg * swing⁻¹; its twist about the current grip axis is the roll.
    _residual.copy(_swing).invert().premultiply(_avg);
    twistAround(_residual, _dir1, out.deltaQuat);
    out.deltaQuat.multiply(_swing).normalize();
  } else {
    out.deltaQuat.identity();
  }

  // deltaPos = curMid - deltaQuat * (scaleFactor * prevMid)
  out.deltaPos
    .copy(out.prevMid)
    .multiplyScalar(out.scaleFactor)
    .applyQuaternion(out.deltaQuat)
    .negate()
    .add(out.curMid);
  return out;
}

/**
 * Frame-rate-independent smoothing fraction for exponential damping toward a
 * target: two steps of dt/2 land exactly where one step of dt does.
 */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function dampScalar(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * dampFactor(rate, dt);
}

export function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  rate: number,
  dt: number,
): THREE.Vector3 {
  return current.lerp(target, dampFactor(rate, dt));
}

export function dampQuaternion(
  current: THREE.Quaternion,
  target: THREE.Quaternion,
  rate: number,
  dt: number,
): THREE.Quaternion {
  return current.slerp(target, dampFactor(rate, dt));
}

/**
 * Angular velocity (axis * rad/s, world space) implied by a per-frame
 * rotation delta. Used to carry spin into throw physics on release.
 */
export function angularVelocityFromDelta(
  deltaQuat: THREE.Quaternion,
  dt: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  if (dt <= 0) return out.set(0, 0, 0);
  let { x, y, z, w } = deltaQuat;
  if (w < 0) {
    // q and -q encode the same rotation; pick the short arc.
    x = -x; y = -y; z = -z; w = -w;
  }
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-6) return out.set(0, 0, 0);
  const angle = 2 * Math.acos(Math.min(1, w));
  return out.set(x, y, z).multiplyScalar(angle / (s * dt));
}
