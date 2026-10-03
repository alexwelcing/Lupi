/**
 * keyframes.ts — the camera curve of a replay: how the player reads a pose
 * between keys, and how the recorder picks the fewest keys that still play
 * back what the sender saw.
 *
 * A pose is 8 numbers: the orientation quaternion, ln(distance) and the
 * target. Between keys each runs on a cubic Hermite curve whose tangents are
 * the three-point (non-uniform Catmull-Rom) slopes, zero at the ends and next
 * to a hold, so a coast flows through its keys and a still pose stays still.
 * The quaternion is normalised after interpolation.
 *
 * Decimation starts from a pose snapshot every 0.5 s (plus the edges of every
 * hold), then keeps adding, in each stretch that misses, the dense sample the
 * curve misses most, until every recorded frame is within the tolerance.
 */
import type { Vec3 } from '../camera/rigApi';
import { frameOfReference, quantizeKey, type Quat, type TapeKey } from './tape';

/** How close the replayed camera stays to the recorded one. */
export const KEY_TOLERANCE = {
  /** Orientation (degrees). */
  angleDeg: 0.35,
  /** Relative distance. */
  distance: 0.004,
  /** Target drift as a fraction of the distance. */
  target: 0.003,
} as const;

/** The pose snapshot cadence (s): every replay has a key at least this often. */
export const SNAPSHOT_S = 0.5;
/** A tape never carries more keys than this (the codec's budget is larger). */
export const MAX_KEYS = 360;

const DIM = 8;

function toVector(key: TapeKey, out: Float64Array, offset: number): void {
  out[offset] = key.q[0];
  out[offset + 1] = key.q[1];
  out[offset + 2] = key.q[2];
  out[offset + 3] = key.q[3];
  out[offset + 4] = Math.log(Math.max(1e-9, key.d));
  out[offset + 5] = key.target[0];
  out[offset + 6] = key.target[1];
  out[offset + 7] = key.target[2];
}

/**
 * Keys made ready to sample: quaternions on one hemisphere (each the same
 * sign as the one before) and per-key tangents.
 */
export interface KeyCurve {
  times: Float64Array;
  values: Float64Array;
  tangents: Float64Array;
  length: number;
}

function isHold(values: Float64Array, a: number, b: number): boolean {
  for (let k = 0; k < DIM; k += 1) {
    if (Math.abs(values[a * DIM + k] - values[b * DIM + k]) > 1e-7) return false;
  }
  return true;
}

export function buildCurve(keys: readonly TapeKey[]): KeyCurve {
  const n = keys.length;
  const times = new Float64Array(n);
  const values = new Float64Array(n * DIM);
  const tangents = new Float64Array(n * DIM);
  for (let i = 0; i < n; i += 1) {
    times[i] = keys[i].t;
    toVector(keys[i], values, i * DIM);
    if (i > 0) {
      const o = i * DIM;
      const p = (i - 1) * DIM;
      const dot = values[o] * values[p] + values[o + 1] * values[p + 1] + values[o + 2] * values[p + 2] + values[o + 3] * values[p + 3];
      if (dot < 0) for (let k = 0; k < 4; k += 1) values[o + k] = -values[o + k];
    }
  }
  for (let i = 1; i < n - 1; i += 1) {
    const h0 = times[i] - times[i - 1];
    const h1 = times[i + 1] - times[i];
    if (!(h0 > 1e-6) || !(h1 > 1e-6) || isHold(values, i - 1, i) || isHold(values, i, i + 1)) continue;
    for (let k = 0; k < DIM; k += 1) {
      const s0 = (values[i * DIM + k] - values[(i - 1) * DIM + k]) / h0;
      const s1 = (values[(i + 1) * DIM + k] - values[i * DIM + k]) / h1;
      tangents[i * DIM + k] = (s0 * h1 + s1 * h0) / (h0 + h1);
    }
  }
  return { times, values, tangents, length: n };
}

/** The segment holding time t (index of its first key), by binary search. */
function segmentAt(curve: KeyCurve, t: number): number {
  const { times, length } = curve;
  if (length < 2 || t <= times[0]) return 0;
  if (t >= times[length - 1]) return length - 1;
  let lo = 0;
  let hi = length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Scratch pose written by samplePose. */
export interface PoseSample {
  q: Quat;
  d: number;
  target: Vec3;
}

export function createPoseSample(): PoseSample {
  return { q: [0, 0, 0, 1], d: 1, target: [0, 0, 0] };
}

const scratch = new Float64Array(DIM);

/** The pose at time t (clamped to the curve's ends), into `out`. */
export function samplePose(curve: KeyCurve, t: number, out: PoseSample): PoseSample {
  const v = scratch;
  const { times, values, tangents, length } = curve;
  if (length === 0) return out;
  const i = segmentAt(curve, t);
  if (i >= length - 1 || length === 1) {
    for (let k = 0; k < DIM; k += 1) v[k] = values[(length - 1) * DIM + k];
  } else if (t <= times[0]) {
    for (let k = 0; k < DIM; k += 1) v[k] = values[k];
  } else {
    const h = times[i + 1] - times[i];
    const s = h > 1e-9 ? (t - times[i]) / h : 1;
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const a = i * DIM;
    const b = (i + 1) * DIM;
    for (let k = 0; k < DIM; k += 1) {
      v[k] = h00 * values[a + k] + h10 * h * tangents[a + k] + h01 * values[b + k] + h11 * h * tangents[b + k];
    }
  }
  const n = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
  out.q[0] = v[0] / n;
  out.q[1] = v[1] / n;
  out.q[2] = v[2] / n;
  out.q[3] = v[3] / n;
  out.d = Math.exp(v[4]);
  out.target[0] = v[5];
  out.target[1] = v[6];
  out.target[2] = v[7];
  return out;
}

function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/** How far a pose misses its sample, in tolerances (≤ 1 is close enough); `looseness` widens them. */
export function poseError(sample: TapeKey, pose: PoseSample, looseness = 1): number {
  const angle = (angleBetween(sample.q, pose.q) * 180) / Math.PI / KEY_TOLERANCE.angleDeg;
  const distance = Math.abs(Math.log(pose.d / sample.d)) / KEY_TOLERANCE.distance;
  const dx = pose.target[0] - sample.target[0];
  const dy = pose.target[1] - sample.target[1];
  const dz = pose.target[2] - sample.target[2];
  const target = Math.hypot(dx, dy, dz) / Math.max(1e-9, sample.d) / KEY_TOLERANCE.target;
  return Math.max(angle, distance, target) / Math.max(1, looseness);
}

function sameKey(a: TapeKey, b: TapeKey): boolean {
  return (
    a.q[0] === b.q[0] &&
    a.q[1] === b.q[1] &&
    a.q[2] === b.q[2] &&
    a.q[3] === b.q[3] &&
    a.d === b.d &&
    a.target[0] === b.target[0] &&
    a.target[1] === b.target[1] &&
    a.target[2] === b.target[2]
  );
}

/**
 * The fewest keys that play `samples` back within KEY_TOLERANCE × looseness
 * (at most MAX_KEYS). `samples` are in time order, starting at t = 0; the
 * result is quantised exactly as the codec will carry it.
 */
export function decimate(samples: readonly TapeKey[], looseness = 1): TapeKey[] {
  if (samples.length === 0) return [];
  const ref = frameOfReference(samples);
  const dense = samples.map((sample) => quantizeKey(sample, ref));
  // Drop samples that land on the same millisecond as the one before.
  const clean: TapeKey[] = [];
  for (const sample of dense) {
    const last = clean[clean.length - 1];
    if (last && sample.t <= last.t) clean[clean.length - 1] = { ...sample, t: last.t };
    else clean.push(sample);
  }
  const n = clean.length;
  if (n <= 2) return clean;
  const chosen = new Uint8Array(n);
  chosen[0] = 1;
  chosen[n - 1] = 1;
  // A snapshot every SNAPSHOT_S, and both edges of every hold.
  let nextSnapshot = SNAPSHOT_S;
  for (let i = 1; i < n - 1; i += 1) {
    if (clean[i].t >= nextSnapshot) {
      chosen[i] = 1;
      while (nextSnapshot <= clean[i].t) nextSnapshot += SNAPSHOT_S;
    }
    const holdBefore = sameKey(clean[i - 1], clean[i]);
    const holdAfter = sameKey(clean[i], clean[i + 1]);
    if (holdBefore !== holdAfter) chosen[i] = 1;
  }
  const pose = createPoseSample();
  for (let pass = 0; pass < 64; pass += 1) {
    const indices: number[] = [];
    for (let i = 0; i < n; i += 1) if (chosen[i]) indices.push(i);
    if (indices.length >= MAX_KEYS) break;
    const curve = buildCurve(indices.map((i) => clean[i]));
    let added = 0;
    let seg = 0;
    let worst = -1;
    let worstError = 1;
    for (let i = 1; i < n; i += 1) {
      while (seg < indices.length - 1 && i > indices[seg + 1]) seg += 1;
      const end = indices[seg + 1];
      if (i !== end) {
        const error = poseError(clean[i], samplePose(curve, clean[i].t, pose), looseness);
        if (error > worstError) {
          worstError = error;
          worst = i;
        }
      }
      if (i === end) {
        if (worst >= 0 && indices.length + added < MAX_KEYS) {
          chosen[worst] = 1;
          added += 1;
        }
        worst = -1;
        worstError = 1;
      }
    }
    if (added === 0) break;
  }
  const keys: TapeKey[] = [];
  for (let i = 0; i < n; i += 1) if (chosen[i]) keys.push(clean[i]);
  return keys;
}
