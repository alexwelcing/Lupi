/**
 * displayMotion.ts — display-only motion (arrival, poke ripple, scatter) as a
 * GPU offset on atom and bond centres.
 *
 * One closed form, `lupiDisplayOffset(rest, rawPosition)`, is added to every
 * atom centre and to both bond ends before the view transform, so the cull,
 * the quad or box, the ray-cast hit and the depth all follow, and bonds stay
 * attached: a bond end is a bit-exact copy of its atom's position (the bond
 * upload copies the same Float32Array; `periodic` is never passed to Bonds in
 * the viewer), so the same rest point and the same position-bit seed give the
 * same offset. No new attribute, no material per toy.
 *
 * The uniforms are module singletons shared by every atom and bond material:
 * one write moves all of them. The whole body sits behind
 * `If(uMotionWeight > 0)`, so at rest the offset is an exact vec3(0) (even if
 * a term would be NaN) and the idle cost is one branch.
 *
 * Truth rules (plan-final WP5):
 * - The offset never reaches `frame.positions`, the store, URLs, saved views,
 *   specs or MCP output. Picking reads rest positions.
 * - Every capture render runs with `uMotionWeight = 0`: the capture guard
 *   registered below zeroes it inside `renderSceneToPixels` (after the live
 *   render of the same frame has used the live value; `uniform()` nodes are in
 *   three's object group, re-read per draw) and restores it afterwards.
 * - A video recording suspends it (`setDisplayMotionSuspended`), because it
 *   records the live canvas.
 * - The ripple is bounded (`uMaxRipple`, 0.3 Å), far under the picker's
 *   2.4 Å solid radius; the arrival is cancelled synchronously on any touch.
 *
 * Seeds: three r186's `hash` (PCG) of the raw position's float bits. On the
 * WebGL2 backend `floatBitsToUint` and uint multiply-wrap are GLSL ES 3.00
 * core; the `play@webgl2` testbed case proves the GPU seeds equal the CPU
 * twin's (displayMotionTwin.ts).
 */
import { Vector3, Vector4 } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  clamp,
  cos,
  dot,
  exp,
  float,
  floatBitsToUint,
  hash,
  length,
  max,
  min,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uint,
  uniform,
  vec3,
} from 'three/tsl';
import { registerCaptureGuard } from '../captureGuards';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** Tuning points (owner feedback): cloud, delays and ripple character. */
export const DISPLAY_MOTION_TUNING = {
  /** Cloud radius as a multiple of the molecule radius. */
  cloudScale: 1.6,
  /** Bottom-to-top landing stagger (s). */
  maxDelayS: 0.2,
  /** Per-atom landing jitter (s). */
  jitterS: 0.03,
  /** Front-to-back inflation stagger of the flat arrival (s). */
  flatFrontDelayS: 0.12,
  /** Scatter: time to puff out into the cloud before re-condensing (s). */
  scatterRiseS: 0.18,
  /** Ripple wave speed (Å/s). */
  rippleSpeed: 20,
  /** Ripple angular frequency (rad/s). */
  rippleOmega: 36,
  /** Ripple damping ratio. */
  rippleZeta: 0.28,
  /** Ripple amplitude falloff length (Å). */
  rippleFalloffA: 8,
  /** Ripple amplitude at full comfort (Å); also the hard bound. */
  rippleAmplitude: 0.3,
  /** The arrival's end fade: the offset reaches exactly zero over this window before D (s). */
  endFadeS: 0.08,
} as const;

/** Arrival modes (`uArrivalMode`). */
export const ARRIVAL_MODE = { none: 0, condense: 1, flat: 2, scatter: 3 } as const;

/** Ripple slots: four, as eight plain vec4 uniforms (no uniformArray). */
export const RIPPLE_SLOTS = 4;

/** The multipliers mixing the three position words into one seed. */
export const SEED_MIX_Y = 2654435769;
export const SEED_MIX_Z = 2246822507;

type FloatUniform = UniformNode<'float', number>;
type Vec3Uniform = UniformNode<'vec3', Vector3>;
type Vec4Uniform = UniformNode<'vec4', Vector4>;

export interface DisplayMotionUniforms {
  /** Master gate: exactly 0 at rest and during every capture render. */
  uMotionWeight: FloatUniform;
  /** Seconds since the driver epoch (rebased while idle). */
  uMotionNow: FloatUniform;
  uArrivalWeight: FloatUniform;
  /** 0 none, 1 condense, 2 flat, 3 scatter (ARRIVAL_MODE). */
  uArrivalMode: FloatUniform;
  uArrivalT0: FloatUniform;
  /** D (s): the arrival offset is exactly zero from t0 + D (scatter: t0 + rise + D). */
  uArrivalDuration: FloatUniform;
  uArrivalCenter: Vec3Uniform;
  uArrivalRadius: FloatUniform;
  /** World up for the bottom-up stagger. */
  uArrivalUp: Vec3Uniform;
  /** normalize(camera.position − centre) for the flat arrival. */
  uArrivalViewDir: Vec3Uniform;
  /** An integer < 2^24 stored as a float. */
  uArrivalSeed: FloatUniform;
  /** The arrival spring: ω = 2 / smoothTime and ζ of a motion token (ζ ≥ 0.9999 reads as critical). */
  uArrivalOmega: FloatUniform;
  uArrivalZeta: FloatUniform;
  /** Scales the landing stagger (Gentle's shorter D). */
  uArrivalDelayScale: FloatUniform;
  uRippleWeight: FloatUniform;
  /** Hard bound on the summed ripple (Å). */
  uMaxRipple: FloatUniform;
  /** A: origin.xyz, t0 (< 0 empty). B: amplitude Å, speed Å/s, ω rad/s, ζ. */
  uRipple0A: Vec4Uniform;
  uRipple0B: Vec4Uniform;
  uRipple1A: Vec4Uniform;
  uRipple1B: Vec4Uniform;
  uRipple2A: Vec4Uniform;
  uRipple2B: Vec4Uniform;
  uRipple3A: Vec4Uniform;
  uRipple3B: Vec4Uniform;
}

const f = (value: number) => uniform(value) as unknown as FloatUniform;
const v3 = (x: number, y: number, z: number) => uniform(new Vector3(x, y, z)) as unknown as Vec3Uniform;
const slotA = () => uniform(new Vector4(0, 0, 0, -1)) as unknown as Vec4Uniform;
const slotB = () => uniform(new Vector4(0, 0, 0, 0)) as unknown as Vec4Uniform;

/** The shared display-motion uniforms (module singletons). */
export const DISPLAY_MOTION: DisplayMotionUniforms = {
  uMotionWeight: f(0),
  uMotionNow: f(0),
  uArrivalWeight: f(0),
  uArrivalMode: f(ARRIVAL_MODE.none),
  uArrivalT0: f(0),
  uArrivalDuration: f(0.6),
  uArrivalCenter: v3(0, 0, 0),
  uArrivalRadius: f(1),
  uArrivalUp: v3(0, 1, 0),
  uArrivalViewDir: v3(0, 0, 1),
  uArrivalSeed: f(0),
  uArrivalOmega: f(16),
  uArrivalZeta: f(0.75),
  uArrivalDelayScale: f(1),
  uRippleWeight: f(0),
  uMaxRipple: f(DISPLAY_MOTION_TUNING.rippleAmplitude),
  uRipple0A: slotA(),
  uRipple0B: slotB(),
  uRipple1A: slotA(),
  uRipple1B: slotB(),
  uRipple2A: slotA(),
  uRipple2B: slotB(),
  uRipple3A: slotA(),
  uRipple3B: slotB(),
};

const RIPPLE_A = [DISPLAY_MOTION.uRipple0A, DISPLAY_MOTION.uRipple1A, DISPLAY_MOTION.uRipple2A, DISPLAY_MOTION.uRipple3A];
const RIPPLE_B = [DISPLAY_MOTION.uRipple0B, DISPLAY_MOTION.uRipple1B, DISPLAY_MOTION.uRipple2B, DISPLAY_MOTION.uRipple3B];

/** Slot `i`'s A (origin, t0) and B (amplitude, speed, ω, ζ) uniforms. */
export function rippleSlotUniforms(i: number): { a: Vec4Uniform; b: Vec4Uniform } {
  return { a: RIPPLE_A[i], b: RIPPLE_B[i] };
}

/**
 * The unit step response of a spring with runtime dials, mirrored from
 * `@atlas/core/motion/stepResponse`: critical for ζ ≥ 0.9999 (the core uses
 * |ζ−1| < 1e-4; display tokens never over-damp), under-damped below.
 * `t` must be ≥ 0; both branches give 0 at t = 0.
 */
function stepResponseNode(omega: N, zeta: N, t: N): N {
  const wt = omega.mul(t);
  const critical = float(1).sub(float(1).add(wt).mul(exp(wt.negate())));
  const z = min(zeta, 0.9999);
  const wd = omega.mul(sqrt(float(1).sub(z.mul(z))));
  const decay = exp(z.mul(wt).negate());
  const under = float(1).sub(decay.mul(cos(wd.mul(t)).add(z.mul(omega).div(wd).mul(sin(wd.mul(t))))));
  return select(zeta.greaterThanEqual(0.9999), critical, under);
}

const offsetFn = Fn(([rest, raw]: [N, N]) => {
  const M = DISPLAY_MOTION as unknown as Record<keyof DisplayMotionUniforms, N>;
  const T = DISPLAY_MOTION_TUNING;
  const off = vec3(0).toVar('lupiMotionOffset');

  If(M.uMotionWeight.greaterThan(0), () => {
    // ── Arrival ──────────────────────────────────────────────────────
    const arrival = vec3(0).toVar('lupiArrival');
    If(M.uArrivalWeight.greaterThan(0), () => {
      const C = M.uArrivalCenter;
      const R = max(M.uArrivalRadius, 1e-3).toVar();
      const rel = rest.sub(C).toVar();
      const elapsed = M.uMotionNow.sub(M.uArrivalT0).toVar();
      const D = M.uArrivalDuration;
      const isFlat = M.uArrivalMode.greaterThan(1.5).and(M.uArrivalMode.lessThan(2.5));
      const isScatter = M.uArrivalMode.greaterThan(2.5);

      If(isFlat, () => {
        // Flat: every atom starts on the centre plane facing the camera and
        // inflates into depth, the nearest side first.
        const v = M.uArrivalViewDir;
        const depth = dot(rel, v).toVar();
        const front = clamp(depth.div(R.mul(2)).add(0.5), 0, 1);
        const delay = float(T.flatFrontDelayS).mul(front.oneMinus()).mul(M.uArrivalDelayScale);
        const tau = max(elapsed.sub(delay), 0);
        const S = stepResponseNode(M.uArrivalOmega, M.uArrivalZeta, tau);
        const E = smoothstep(D.sub(T.endFadeS), D, elapsed).oneMinus();
        arrival.assign(v.mul(depth.negate()).mul(S.oneMinus()).mul(E));
      }).Else(() => {
        // Seeds from the raw position bits (no new attribute): bond ends
        // hash their bit-exact copies of the same floats.
        const bits = (x: N): N => floatBitsToUint(x) as N;
        const seed = bits(raw.x)
          .bitXor(bits(raw.y).mul(uint(SEED_MIX_Y)))
          .bitXor(bits(raw.z).mul(uint(SEED_MIX_Z)))
          .bitXor(uint(M.uArrivalSeed))
          .toVar('lupiSeed');
        const h0 = hash(seed);
        const h1 = hash(seed.add(uint(1)));
        const h2 = hash(seed.add(uint(2)));
        const h3 = hash(seed.add(uint(3)));
        // A uniform point in the ball of radius R·cloudScale around C.
        const z = h1.mul(2).sub(1).toVar();
        const phi = h2.mul(Math.PI * 2).toVar();
        const s = sqrt(max(float(1).sub(z.mul(z)), 0));
        const u = vec3(s.mul(cos(phi)), s.mul(sin(phi)), z);
        const cloud = R.mul(T.cloudScale).mul(pow(max(h0, 1e-6), 1 / 3));
        const toCloud = C.add(u.mul(cloud)).sub(rest).toVar();

        // Condense: the bottom lands first. Scatter condenses after its rise.
        const since = select(isScatter, elapsed.sub(T.scatterRiseS), elapsed).toVar();
        const height = clamp(dot(rel, M.uArrivalUp).div(R.mul(2)).add(0.5), 0, 1);
        const delay = float(T.maxDelayS).mul(height).add(float(T.jitterS).mul(h3)).mul(M.uArrivalDelayScale);
        const tau = max(since.sub(delay), 0);
        const S = stepResponseNode(M.uArrivalOmega, M.uArrivalZeta, tau);
        const E = smoothstep(D.sub(T.endFadeS), D, since).oneMinus();
        const condense = toCloud.mul(S.oneMinus()).mul(E);
        const rise = toCloud.mul(smoothstep(0, T.scatterRiseS, elapsed));
        arrival.assign(select(isScatter.and(elapsed.lessThan(T.scatterRiseS)), rise, condense));
      });
    });

    // ── Ripple (four slots) ──────────────────────────────────────────
    const ripple = vec3(0).toVar('lupiRipple');
    If(M.uRippleWeight.greaterThan(0), () => {
      for (let i = 0; i < RIPPLE_SLOTS; i += 1) {
        const A: N = RIPPLE_A[i];
        const B: N = RIPPLE_B[i];
        const d = rest.sub(A.xyz).toVar();
        const r = length(d).toVar();
        // Clamped at 0, where sin(0) = 0: the wave has not arrived yet (and
        // the exponent never grows).
        const tau = max(M.uMotionNow.sub(A.w).sub(r.div(max(B.y, 1e-3))), 0).toVar();
        const env = B.x
          .mul(sin(B.z.mul(tau)))
          .mul(exp(B.w.mul(B.z).mul(tau).negate()))
          .mul(select(A.w.greaterThanEqual(0), float(1), float(0)))
          .mul(exp(r.div(T.rippleFalloffA).negate()));
        // The poked atom itself (r = 0) stays still: no NaN direction.
        const dir = select(r.lessThan(1e-4), vec3(0), d.div(max(r, 1e-4)));
        ripple.addAssign(dir.mul(env));
      }
      ripple.mulAssign(min(float(1), M.uMaxRipple.div(max(length(ripple), 1e-6))));
    });

    off.assign(arrival.mul(M.uArrivalWeight).add(ripple.mul(M.uRippleWeight)).mul(M.uMotionWeight));
  });

  return off;
});

/**
 * The display offset (world space, Å) to add to a rest centre. `rest` is the
 * rest centre (vec3, after any trajectory lerp) and `rawPosition` the raw
 * instance attribute it came from (the seed source). Exactly vec3(0) while
 * `uMotionWeight` is 0.
 */
export function lupiDisplayOffset(rest: Node, rawPosition: Node): Node {
  return (offsetFn as N)(rest, rawPosition) as Node;
}

/** Save and zero the master weight for one capture render; returns the restore. */
export function suspendLupiDisplayMotion(): () => void {
  const saved = DISPLAY_MOTION.uMotionWeight.value;
  DISPLAY_MOTION.uMotionWeight.value = 0;
  return () => {
    DISPLAY_MOTION.uMotionWeight.value = saved;
  };
}

/** True while any display motion is live (weight > 0). */
export function isLupiDisplayMotionActive(): boolean {
  return DISPLAY_MOTION.uMotionWeight.value > 0;
}

let suspended = false;

/** Hold display motion at zero (for example while a video records). */
export function setDisplayMotionSuspended(on: boolean): void {
  suspended = on;
  if (on) DISPLAY_MOTION.uMotionWeight.value = 0;
}

export function isDisplayMotionSuspended(): boolean {
  return suspended;
}

/** Zero every display-motion weight, mode and ripple slot. */
export function resetLupiDisplayMotion(): void {
  const M = DISPLAY_MOTION;
  M.uMotionWeight.value = 0;
  M.uArrivalWeight.value = 0;
  M.uArrivalMode.value = ARRIVAL_MODE.none;
  M.uRippleWeight.value = 0;
  for (let i = 0; i < RIPPLE_SLOTS; i += 1) {
    RIPPLE_A[i].value.set(0, 0, 0, -1);
    RIPPLE_B[i].value.set(0, 0, 0, 0);
  }
}

// Every raster capture (exports, MCP rasters, thumbnails, the testbed)
// renders with the master weight at zero.
registerCaptureGuard({ begin: suspendLupiDisplayMotion });
