/**
 * displayMotionTwin.ts — a CPU twin of `lupiDisplayOffset` (displayMotion.ts).
 *
 * The same formulas, term for term, in double precision, with three r186's
 * PCG `hash` mirrored exactly through `Math.imul` and `>>> 0` and the seed
 * built from the same float32 bits. Used by the unit tests and by the
 * `play` testbed case, which puts probes where the twin says an atom is
 * mid-flight: a GPU that hashed or bit-cast differently (the WebGL2 risk)
 * would miss them. Never used to move anything on screen.
 */
import {
  ARRIVAL_MODE,
  DISPLAY_MOTION,
  DISPLAY_MOTION_TUNING,
  RIPPLE_SLOTS,
  SEED_MIX_Y,
  SEED_MIX_Z,
  rippleSlotUniforms,
} from './displayMotion';

export type TwinVec3 = [number, number, number];

export interface DisplayMotionTwinRipple {
  /** origin x, y, z, t0 (< 0 empty) */
  a: [number, number, number, number];
  /** amplitude Å, speed Å/s, ω rad/s, ζ */
  b: [number, number, number, number];
}

/** Plain values of every DISPLAY_MOTION uniform. */
export interface DisplayMotionTwinState {
  motionWeight: number;
  now: number;
  arrivalWeight: number;
  arrivalMode: number;
  arrivalT0: number;
  arrivalDuration: number;
  arrivalCenter: TwinVec3;
  arrivalRadius: number;
  arrivalUp: TwinVec3;
  arrivalViewDir: TwinVec3;
  arrivalSeed: number;
  arrivalOmega: number;
  arrivalZeta: number;
  arrivalDelayScale: number;
  rippleWeight: number;
  maxRipple: number;
  ripples: DisplayMotionTwinRipple[];
}

/** A rest state (every weight 0, every slot empty). */
export function restTwinState(): DisplayMotionTwinState {
  return {
    motionWeight: 0,
    now: 0,
    arrivalWeight: 0,
    arrivalMode: ARRIVAL_MODE.none,
    arrivalT0: 0,
    arrivalDuration: 0.6,
    arrivalCenter: [0, 0, 0],
    arrivalRadius: 1,
    arrivalUp: [0, 1, 0],
    arrivalViewDir: [0, 0, 1],
    arrivalSeed: 0,
    arrivalOmega: 16,
    arrivalZeta: 0.75,
    arrivalDelayScale: 1,
    rippleWeight: 0,
    maxRipple: DISPLAY_MOTION_TUNING.rippleAmplitude,
    ripples: Array.from({ length: RIPPLE_SLOTS }, () => ({ a: [0, 0, 0, -1], b: [0, 0, 0, 0] })),
  };
}

/** The live values of the shared uniforms. */
export function readTwinState(): DisplayMotionTwinState {
  const M = DISPLAY_MOTION;
  const v = (x: { x: number; y: number; z: number }): TwinVec3 => [x.x, x.y, x.z];
  return {
    motionWeight: M.uMotionWeight.value,
    now: M.uMotionNow.value,
    arrivalWeight: M.uArrivalWeight.value,
    arrivalMode: M.uArrivalMode.value,
    arrivalT0: M.uArrivalT0.value,
    arrivalDuration: M.uArrivalDuration.value,
    arrivalCenter: v(M.uArrivalCenter.value),
    arrivalRadius: M.uArrivalRadius.value,
    arrivalUp: v(M.uArrivalUp.value),
    arrivalViewDir: v(M.uArrivalViewDir.value),
    arrivalSeed: M.uArrivalSeed.value,
    arrivalOmega: M.uArrivalOmega.value,
    arrivalZeta: M.uArrivalZeta.value,
    arrivalDelayScale: M.uArrivalDelayScale.value,
    rippleWeight: M.uRippleWeight.value,
    maxRipple: M.uMaxRipple.value,
    ripples: Array.from({ length: RIPPLE_SLOTS }, (_, i) => {
      const { a, b } = rippleSlotUniforms(i);
      return { a: [a.value.x, a.value.y, a.value.z, a.value.w], b: [b.value.x, b.value.y, b.value.z, b.value.w] };
    }),
  };
}

// ─── PCG and the position-bit seed ─────────────────────────────────────

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** The float32 bit pattern of `x` (GLSL floatBitsToUint / WGSL bitcast<u32>). */
export function floatBits(x: number): number {
  F32[0] = x;
  return U32[0];
}

/** three r186 Hash.js (PCG), the uint word before the float conversion. */
export function pcgHashUint(seed: number): number {
  const state = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** three r186 `hash(seed)`: the PCG word as a float in [0, 1]. */
export function pcgHash(seed: number): number {
  return Math.fround(pcgHashUint(seed)) * 2 ** -32;
}

/** The per-atom seed from the raw position's float bits and the arrival seed. */
export function positionSeed(raw: TwinVec3, arrivalSeed: number): number {
  const x = floatBits(raw[0]);
  const y = Math.imul(floatBits(raw[1]), SEED_MIX_Y) >>> 0;
  const z = Math.imul(floatBits(raw[2]), SEED_MIX_Z) >>> 0;
  return (x ^ y ^ z ^ (Math.trunc(arrivalSeed) >>> 0)) >>> 0;
}

// ─── Formulas ──────────────────────────────────────────────────────────

/** The TSL mirror of stepResponse: critical for ζ ≥ 0.9999, under-damped below. */
export function twinStepResponse(omega: number, zeta: number, t: number): number {
  const wt = omega * t;
  if (zeta >= 0.9999) return 1 - (1 + wt) * Math.exp(-wt);
  const z = Math.min(zeta, 0.9999);
  const wd = omega * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * wt) * (Math.cos(wd * t) + ((z * omega) / wd) * Math.sin(wd * t));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const dot = (a: TwinVec3, b: TwinVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: TwinVec3, b: TwinVec3): TwinVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: TwinVec3, k: number): TwinVec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: TwinVec3) => Math.hypot(a[0], a[1], a[2]);

/** The arrival term (before its weights). */
export function twinArrival(state: DisplayMotionTwinState, rest: TwinVec3, raw: TwinVec3 = rest): TwinVec3 {
  const T = DISPLAY_MOTION_TUNING;
  const C = state.arrivalCenter;
  const R = Math.max(state.arrivalRadius, 1e-3);
  const rel = sub(rest, C);
  const elapsed = state.now - state.arrivalT0;
  const D = state.arrivalDuration;
  const mode = state.arrivalMode;
  const isFlat = mode > 1.5 && mode < 2.5;
  const isScatter = mode > 2.5;

  if (isFlat) {
    const v = state.arrivalViewDir;
    const depth = dot(rel, v);
    const front = clamp01(depth / (2 * R) + 0.5);
    const delay = T.flatFrontDelayS * (1 - front) * state.arrivalDelayScale;
    const tau = Math.max(elapsed - delay, 0);
    const S = twinStepResponse(state.arrivalOmega, state.arrivalZeta, tau);
    const E = 1 - smoothstep(D - T.endFadeS, D, elapsed);
    return scale(v, -depth * (1 - S) * E);
  }

  const seed = positionSeed(raw, state.arrivalSeed);
  const h0 = pcgHash(seed);
  const h1 = pcgHash((seed + 1) >>> 0);
  const h2 = pcgHash((seed + 2) >>> 0);
  const h3 = pcgHash((seed + 3) >>> 0);
  const z = h1 * 2 - 1;
  const phi = h2 * Math.PI * 2;
  const s = Math.sqrt(Math.max(1 - z * z, 0));
  const u: TwinVec3 = [s * Math.cos(phi), s * Math.sin(phi), z];
  const cloud = R * T.cloudScale * Math.pow(Math.max(h0, 1e-6), 1 / 3);
  const toCloud = sub([C[0] + u[0] * cloud, C[1] + u[1] * cloud, C[2] + u[2] * cloud], rest);

  const since = isScatter ? elapsed - T.scatterRiseS : elapsed;
  const height = clamp01(dot(rel, state.arrivalUp) / (2 * R) + 0.5);
  const delay = (T.maxDelayS * height + T.jitterS * h3) * state.arrivalDelayScale;
  const tau = Math.max(since - delay, 0);
  const S = twinStepResponse(state.arrivalOmega, state.arrivalZeta, tau);
  const E = 1 - smoothstep(D - T.endFadeS, D, since);
  if (isScatter && elapsed < T.scatterRiseS) return scale(toCloud, smoothstep(0, T.scatterRiseS, elapsed));
  return scale(toCloud, (1 - S) * E);
}

/** The summed, bounded ripple term (before its weights). */
export function twinRipple(state: DisplayMotionTwinState, rest: TwinVec3): TwinVec3 {
  const out: TwinVec3 = [0, 0, 0];
  for (const { a, b } of state.ripples) {
    const d = sub(rest, [a[0], a[1], a[2]]);
    const r = len(d);
    const tau = Math.max(state.now - a[3] - r / Math.max(b[1], 1e-3), 0);
    const env = b[0]
      * Math.sin(b[2] * tau)
      * Math.exp(-b[3] * b[2] * tau)
      * (a[3] >= 0 ? 1 : 0)
      * Math.exp(-r / DISPLAY_MOTION_TUNING.rippleFalloffA);
    if (r < 1e-4) continue;
    const k = env / Math.max(r, 1e-4);
    out[0] += d[0] * k;
    out[1] += d[1] * k;
    out[2] += d[2] * k;
  }
  const clampScale = Math.min(1, state.maxRipple / Math.max(len(out), 1e-6));
  return scale(out, clampScale);
}

/** The display offset `lupiDisplayOffset` computes for one rest point. */
export function displayOffsetTwin(state: DisplayMotionTwinState, rest: TwinVec3, raw: TwinVec3 = rest): TwinVec3 {
  if (!(state.motionWeight > 0)) return [0, 0, 0];
  const arrival = state.arrivalWeight > 0 ? twinArrival(state, rest, raw) : [0, 0, 0] as TwinVec3;
  const ripple = state.rippleWeight > 0 ? twinRipple(state, rest) : [0, 0, 0] as TwinVec3;
  return [0, 1, 2].map(
    (i) => (arrival[i] * state.arrivalWeight + ripple[i] * state.rippleWeight) * state.motionWeight,
  ) as TwinVec3;
}
