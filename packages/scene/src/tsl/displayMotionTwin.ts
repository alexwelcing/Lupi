/**
 * displayMotionTwin.ts — a CPU twin of `lupiDisplayOffset` (displayMotion.ts).
 *
 * The same formulas, term for term, in double precision, with three r186's
 * PCG `hash` mirrored exactly through `Math.imul` and `>>> 0` and the seed
 * built from the same float32 bits. Every term is mirrored: the arrival
 * (condense, flat, scatter and the morph), the ripple and the Play verbs Tug,
 * Burst and Heat.
 *
 * The morph reads per-atom starts the GPU reads from its texture. The twin
 * finds the atom by its rest point: the point's float32 bits are a key into
 * the morph's own positions array (an overlay hangs on its atom's frame
 * position, as a bond end copies it), so it reads the same texel.
 *
 * Used by:
 * - the unit tests;
 * - the live view's overlays (labels, selection rings, the atom card's
 *   anchor, measurements, trails: `@atlas/ui` play/displayFollow), which ride
 *   with their atoms while display motion runs. Only the handful of atoms
 *   that carry an overlay are evaluated, once per drawn frame, and only while
 *   the master weight is above 0; at rest the twin is an exact zero.
 */
import {
  ARRIVAL_MODE,
  BURST_SALT,
  BURST_SLOTS,
  DISPLAY_MOTION,
  DISPLAY_MOTION_TUNING,
  HEAT_SALT,
  MORPH_TEXEL_STRIDE,
  RIPPLE_SLOTS,
  SEED_MIX_Y,
  SEED_MIX_Z,
  burstSlotUniforms,
  displayMorph,
  rippleSlotUniforms,
  type DisplayMorphData,
} from './displayMotion';

export type TwinVec3 = [number, number, number];

export interface DisplayMotionTwinRipple {
  /** origin x, y, z, t0 (< 0 empty) */
  a: [number, number, number, number];
  /** amplitude Å, speed Å/s, ω rad/s, ζ */
  b: [number, number, number, number];
}

export interface DisplayMotionTwinBurst {
  /** origin x, y, z, t0 (< 0 empty) */
  a: [number, number, number, number];
  /** amplitude / peak (Å), falloff length Å, ω rad/s, ζ */
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
  /** The morph frame: the anchor and the axes (each times the anchor depth). */
  morphOrigin: TwinVec3;
  morphAxisX: TwinVec3;
  morphAxisY: TwinVec3;
  morphAxisZ: TwinVec3;
  morphCount: number;
  /** The morph's starts (the GPU's texture), or null. */
  morph: DisplayMorphData | null;
  rippleWeight: number;
  maxRipple: number;
  ripples: DisplayMotionTwinRipple[];
  tugWeight: number;
  /** The grab point (rest, Å) and the Gaussian falloff radius (Å). */
  tugGrab: [number, number, number, number];
  tugCore: TwinVec3;
  tugHalo: TwinVec3;
  burstWeight: number;
  maxBurst: number;
  bursts: DisplayMotionTwinBurst[];
  heatWeight: number;
  heatAmplitude: number;
}

/**
 * Per-term multipliers on top of the uniforms' own weights (all 1 when left
 * out). Overlays that carry text pass `{ heat: … }` below 1, so a label keeps
 * to its atom's mean position instead of shivering illegibly with Heat.
 */
export interface TwinTermScales {
  arrival?: number;
  ripple?: number;
  tug?: number;
  burst?: number;
  heat?: number;
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
    morphOrigin: [0, 0, 0],
    morphAxisX: [1, 0, 0],
    morphAxisY: [0, 1, 0],
    morphAxisZ: [0, 0, 1],
    morphCount: 0,
    morph: null,
    rippleWeight: 0,
    maxRipple: DISPLAY_MOTION_TUNING.rippleAmplitude,
    ripples: Array.from({ length: RIPPLE_SLOTS }, () => ({ a: [0, 0, 0, -1], b: [0, 0, 0, 0] })),
    tugWeight: 0,
    tugGrab: [0, 0, 0, 1],
    tugCore: [0, 0, 0],
    tugHalo: [0, 0, 0],
    burstWeight: 0,
    maxBurst: 6,
    bursts: Array.from({ length: BURST_SLOTS }, () => ({ a: [0, 0, 0, -1], b: [0, 0, 0, 0] })),
    heatWeight: 0,
    heatAmplitude: 0,
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
    morphOrigin: v(M.uMorphOrigin.value),
    morphAxisX: v(M.uMorphAxisX.value),
    morphAxisY: v(M.uMorphAxisY.value),
    morphAxisZ: v(M.uMorphAxisZ.value),
    morphCount: M.uMorphCount.value,
    morph: displayMorph(),
    rippleWeight: M.uRippleWeight.value,
    maxRipple: M.uMaxRipple.value,
    ripples: Array.from({ length: RIPPLE_SLOTS }, (_, i) => {
      const { a, b } = rippleSlotUniforms(i);
      return { a: [a.value.x, a.value.y, a.value.z, a.value.w], b: [b.value.x, b.value.y, b.value.z, b.value.w] };
    }),
    tugWeight: M.uTugWeight.value,
    tugGrab: [M.uTugGrab.value.x, M.uTugGrab.value.y, M.uTugGrab.value.z, M.uTugGrab.value.w],
    tugCore: v(M.uTugCore.value),
    tugHalo: v(M.uTugHalo.value),
    burstWeight: M.uBurstWeight.value,
    maxBurst: M.uMaxBurst.value,
    bursts: Array.from({ length: BURST_SLOTS }, (_, i) => {
      const { a, b } = burstSlotUniforms(i);
      return { a: [a.value.x, a.value.y, a.value.z, a.value.w], b: [b.value.x, b.value.y, b.value.z, b.value.w] };
    }),
    heatWeight: M.uHeatWeight.value,
    heatAmplitude: M.uHeatAmplitude.value,
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

const morphIndexes = new WeakMap<DisplayMorphData, Map<string, number>>();

function pointKey(x: number, y: number, z: number): string {
  return `${floatBits(x)}:${floatBits(y)}:${floatBits(z)}`;
}

/** The atom whose rest point `rest` is, in the morph's positions (float32 bits), or -1. */
export function twinMorphAtom(morph: DisplayMorphData, rest: TwinVec3): number {
  let index = morphIndexes.get(morph);
  if (!index) {
    index = new Map();
    const p = morph.positions;
    for (let i = 0; i < morph.count; i += 1) {
      const key = pointKey(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      if (!index.has(key)) index.set(key, i);
    }
    morphIndexes.set(morph, index);
  }
  return index.get(pointKey(rest[0], rest[1], rest[2])) ?? -1;
}

/** The morph branch of the arrival: from the atom's texel toward its rest point. */
function twinMorph(state: DisplayMotionTwinState, rest: TwinVec3, elapsed: number, D: number): TwinVec3 {
  const morph = state.morph;
  if (!morph?.texels) return [0, 0, 0];
  const atom = twinMorphAtom(morph, rest);
  if (!(atom > -0.5 && atom < state.morphCount - 0.5)) return [0, 0, 0];
  const t = morph.texels;
  const o = atom * MORPH_TEXEL_STRIDE;
  const O = state.morphOrigin;
  const X = state.morphAxisX;
  const Y = state.morphAxisY;
  const Z = state.morphAxisZ;
  const start: TwinVec3 = [
    O[0] + X[0] * t[o] + Y[0] * t[o + 1] + Z[0] * t[o + 2],
    O[1] + X[1] * t[o] + Y[1] * t[o + 1] + Z[1] * t[o + 2],
    O[2] + X[2] * t[o] + Y[2] * t[o + 1] + Z[2] * t[o + 2],
  ];
  const tau = Math.max(elapsed - t[o + 3] * state.arrivalDelayScale, 0);
  const S = twinStepResponse(state.arrivalOmega, state.arrivalZeta, tau);
  const E = 1 - smoothstep(D - DISPLAY_MOTION_TUNING.endFadeS, D, elapsed);
  return scale(sub(start, rest), (1 - S) * E);
}

/** The arrival term (before its weights). */
export function twinArrival(state: DisplayMotionTwinState, rest: TwinVec3, raw: TwinVec3 = rest): TwinVec3 {
  const T = DISPLAY_MOTION_TUNING;
  const C = state.arrivalCenter;
  const R = Math.max(state.arrivalRadius, 1e-3);
  const rel = sub(rest, C);
  const elapsed = state.now - state.arrivalT0;
  const D = state.arrivalDuration;
  const mode = state.arrivalMode;
  const isMorph = mode > 3.5;
  const isFlat = mode > 1.5 && mode < 2.5;
  const isScatter = mode > 2.5 && mode < 3.5;

  if (isMorph) return twinMorph(state, rest, elapsed, D);

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

/** The tug term (before its weight): a Gaussian neighbourhood between the halo and the core spring. */
export function twinTug(state: DisplayMotionTwinState, rest: TwinVec3): TwinVec3 {
  const G = state.tugGrab;
  const rf = Math.max(G[3], 1e-3);
  const d = sub(rest, [G[0], G[1], G[2]]);
  const w = Math.exp(-dot(d, d) / (rf * rf));
  const w2 = w * w;
  const t = w2 * w2;
  const halo = state.tugHalo;
  const core = state.tugCore;
  return [
    (halo[0] + (core[0] - halo[0]) * t) * w,
    (halo[1] + (core[1] - halo[1]) * t) * w,
    (halo[2] + (core[2] - halo[2]) * t) * w,
  ];
}

/** The summed, jittered, bounded burst term (before its weight). */
export function twinBurst(state: DisplayMotionTwinState, rest: TwinVec3, raw: TwinVec3 = rest): TwinVec3 {
  const T = DISPLAY_MOTION_TUNING;
  const jitter = 1 - T.burstJitter / 2 + pcgHash(positionSeed(raw, BURST_SALT)) * T.burstJitter;
  const out: TwinVec3 = [0, 0, 0];
  for (const { a, b } of state.bursts) {
    const d = sub(rest, [a[0], a[1], a[2]]);
    const r = len(d);
    const tau = Math.max(state.now - a[3] - r / T.burstSpeed, 0);
    const zeta = Math.min(Math.max(b[3], 0), 0.9999);
    const wd = b[2] * Math.sqrt(1 - zeta * zeta);
    const env = b[0]
      * Math.exp(-zeta * b[2] * tau)
      * Math.sin(wd * tau)
      * Math.exp(-r / Math.max(b[1], 1e-3))
      * smoothstep(0, T.burstCoreA, r)
      * (a[3] >= 0 ? 1 : 0);
    if (r < 1e-4) continue;
    const k = env / Math.max(r, 1e-4);
    out[0] += d[0] * k;
    out[1] += d[1] * k;
    out[2] += d[2] * k;
  }
  const scaled = scale(out, jitter);
  const clampScale = Math.min(1, state.maxBurst / Math.max(len(scaled), 1e-6));
  return scale(scaled, clampScale);
}

const fract = (x: number) => x - Math.floor(x);

/** The heat term (before its weight): two seeded bands of sines per axis. */
export function twinHeat(state: DisplayMotionTwinState, raw: TwinVec3): TwinVec3 {
  const T = DISPLAY_MOTION_TUNING;
  const seed = positionSeed(raw, HEAT_SALT);
  const t = state.now;
  const [a0, a1] = T.heatBandA;
  const [b0, b1] = T.heatBandB;
  const axis = (k: number): number => {
    const hf = pcgHash((seed + k) >>> 0);
    const hp = pcgHash((seed + k + 3) >>> 0);
    const fa = a0 + (a1 - a0) * hf;
    const fb = b0 + (b1 - b0) * fract(hf * 13.7);
    const pa = hp * Math.PI * 2;
    const pb = fract(hp * 7.3) * Math.PI * 2;
    return Math.sin(t * fa + pa) + Math.sin(t * fb + pb) * T.heatBandBWeight;
  };
  const k = state.heatAmplitude / (1 + T.heatBandBWeight);
  return [axis(0) * k, axis(1) * k, axis(2) * k];
}

const ZERO: Readonly<TwinVec3> = [0, 0, 0];

/**
 * The display offset `lupiDisplayOffset` computes for one rest point (`raw`,
 * the seed source, defaults to `rest`). `terms` scales single terms for
 * overlays (see TwinTermScales); left out, it is the GPU's offset.
 */
export function displayOffsetTwin(
  state: DisplayMotionTwinState,
  rest: TwinVec3,
  raw: TwinVec3 = rest,
  terms?: TwinTermScales,
): TwinVec3 {
  if (!(state.motionWeight > 0)) return [0, 0, 0];
  const aw = state.arrivalWeight * (terms?.arrival ?? 1);
  const rw = state.rippleWeight * (terms?.ripple ?? 1);
  const tw = state.tugWeight * (terms?.tug ?? 1);
  const bw = state.burstWeight * (terms?.burst ?? 1);
  const hw = state.heatWeight * (terms?.heat ?? 1);
  const arrival = aw > 0 ? twinArrival(state, rest, raw) : ZERO;
  const ripple = rw > 0 ? twinRipple(state, rest) : ZERO;
  const tug = tw > 0 ? twinTug(state, rest) : ZERO;
  const burst = bw > 0 ? twinBurst(state, rest, raw) : ZERO;
  const heat = hw > 0 ? twinHeat(state, raw) : ZERO;
  return [0, 1, 2].map(
    (i) => (arrival[i] * aw + ripple[i] * rw + tug[i] * tw + burst[i] * bw + heat[i] * hw) * state.motionWeight,
  ) as TwinVec3;
}
