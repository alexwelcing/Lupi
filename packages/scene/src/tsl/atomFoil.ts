/**
 * atomFoil.ts — Foil finishes: Holo, Gold leaf and Pearl, the rare cosmetic
 * finishes a Remix code can carry (ui/src/remix/code.ts).
 *
 * A finish lives on the rims, the highlights and the sheen; the element
 * colour stays the base of every sphere, and nothing moves. Each is a
 * view-dependent term in the atom and bond impostors, so it shows itself as
 * the molecule turns:
 *
 * - **Holo:** a thin-film rim whose hue follows the surface's world-space
 *   orientation and the viewing angle, so the colour slides across the rims
 *   as you rotate. No scanlines, flicker, chromatic aberration or extra
 *   shells.
 * - **Gold leaf:** a gold Fresnel rim and a gold key highlight, gilded bond
 *   edges and a slightly warm key, with CPK cores kept, so it never reads as
 *   gold atoms.
 * - **Pearl:** an opaque nacre sheen: a milky lift with a faint pink-to-
 *   green play of colour toward the rims.
 *
 * The reveal is one sweep across the molecule from the key-light side (about
 * 900 ms, driven by the viewer): atoms take the finish as a bright band
 * passes. Far atoms (a few pixels across) keep only a faint sheen.
 *
 * Module singletons like atomGlow's: one write reaches every impostor.
 * Truth rules: a finish is a cosmetic look, never part of an artifact. The
 * capture guard zeroes the master weight inside every capture render
 * (exports, MCP rasters, thumbnails) and an ordinary video recording holds it
 * at zero; only an illustrative recording (Instant Replay's clip) keeps it.
 * With the master at zero every finish adds exactly vec3(0) and blends
 * nothing (a select, not a product).
 */
import { Color, Vector2, Vector3 } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  max,
  mix,
  modelViewMatrix,
  normalize,
  pow,
  select,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { registerCaptureGuard, registerRecordingGuard } from '../captureGuards';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** Finish ids the shader reads (0 = none). */
export const FOIL_FINISH_ID = { none: 0, holo: 1, gold: 2, pearl: 3 } as const;
export type FoilFinishName = keyof typeof FOIL_FINISH_ID;

export const ATOM_FOIL_TUNING = {
  /** Holo: rim gain, face sheen and how far the hue travels per turn. */
  holoRim: 0.95,
  holoSheen: 0.1,
  holoHueTravel: 1.6,
  /** Gold: Fresnel rim gain, key highlight gain and sharpness, warm key tint. */
  goldRim: 1.15,
  goldSpecular: 0.85,
  goldShininess: 70,
  goldWarmth: 0.07,
  /** Pearl: milky lift, rim sheen gain, play-of-colour saturation. */
  pearlLift: 0.16,
  pearlSheen: 0.32,
  pearlPlay: 0.24,
  /** The reveal band: its half-width (fraction of the molecule) and glint gain. */
  sweepBand: 0.16,
  glint: 0.7,
  /** Atoms under this many pixels across keep only the faint sheen. */
  lodPixels: 5,
} as const;

type FloatUniform = UniformNode<'float', number>;

export interface AtomFoilUniforms {
  /** Master gate: 1 live, exactly 0 inside every capture render and ordinary recording. */
  uFoilWeight: FloatUniform;
  /** FOIL_FINISH_ID of the finish shown (0 none). */
  uFoilFinish: FloatUniform;
  /** The finish's strength 0..1 (fades in and out). */
  uFoilLevel: FloatUniform;
  /** The reveal sweep 0..1 (1 = revealed everywhere). */
  uFoilSweep: FloatUniform;
  /** Screen direction the sweep travels (unit, view space xy), from the key-light side. */
  uFoilSweepDir: UniformNode<'vec2', Vector2>;
  /** The molecule's bounding sphere in model space (the sweep's extent). */
  uFoilCenter: UniformNode<'vec3', Vector3>;
  uFoilRadius: FloatUniform;
  uGoldColor: UniformNode<'color', Color>;
}

const f = (value: number) => uniform(value) as unknown as FloatUniform;

/** The shared foil uniforms (module singletons). */
export const ATOM_FOIL: AtomFoilUniforms = {
  uFoilWeight: f(1),
  uFoilFinish: f(0),
  uFoilLevel: f(0),
  uFoilSweep: f(1),
  uFoilSweepDir: uniform(new Vector2(-1, 0)) as unknown as UniformNode<'vec2', Vector2>,
  uFoilCenter: uniform(new Vector3()) as unknown as UniformNode<'vec3', Vector3>,
  uFoilRadius: f(1),
  // Linear gold leaf (F0-like), warm but not orange.
  uGoldColor: uniform(new Color(1.0, 0.74, 0.34)) as unknown as UniformNode<'color', Color>,
};

const F = ATOM_FOIL as unknown as Record<keyof AtomFoilUniforms, N>;

/** The live strength gate (0 at rest, in captures and with no finish). */
function foilGate(): N {
  return F.uFoilWeight.mul(F.uFoilLevel).mul(select(F.uFoilFinish.greaterThan(0.5), float(1), float(0)));
}

/**
 * Vertex stage: the reveal for an instance at `viewCenter` (view space):
 * `x` how revealed it is (0..1), `y` the glint of the passing band. Both are
 * 1 and 0 once the sweep is done.
 */
export function lupiFoilSweep(viewCenter: Node): Node {
  const T = ATOM_FOIL_TUNING;
  const center: N = modelViewMatrix.mul(vec4(F.uFoilCenter, 1.0)).xyz;
  const offset: N = (viewCenter as N).xy.sub(center.xy).div(max(F.uFoilRadius, 1e-4));
  // −1 on the key-light side, +1 on the far side → 0..1.
  const s: N = clamp(dot(offset, F.uFoilSweepDir).mul(0.5).add(0.5), 0, 1);
  const w = T.sweepBand;
  const front: N = F.uFoilSweep.mul(1 + 2 * w).sub(w);
  const revealed: N = smoothstep(s.sub(w), s.add(w * 0.25), front);
  const d: N = front.sub(s).div(w);
  const glint: N = select(F.uFoilSweep.lessThan(0.999), exp(d.mul(d).negate().mul(2.2)), float(0));
  return vec4(revealed, glint, 0, 0) as Node;
}

function toView(worldDir: N): N {
  return normalize(cameraViewMatrix.mul(vec4(worldDir, 0.0)).xyz);
}

function toWorld(viewDir: N): N {
  return normalize(cameraWorldMatrix.mul(vec4(viewDir, 0.0)).xyz);
}

/** A soft cosine rainbow (thin-film-like) for a phase. */
function filmHue(phase: N): N {
  const tau = 6.283185307;
  return vec3(0.5).add(vec3(0.5).mul(cos(vec3(phase).add(vec3(0.0, 0.33, 0.67)).mul(tau))));
}

export interface LupiFoilInput {
  /** The lit colour (linear) the finish goes over. */
  lit: Node;
  /** View-space unit normal at the hit. */
  normal: Node;
  /** dot(normal, toward the eye), 1 at the centre of the disc, 0 at the rim. */
  facing: Node;
  /** The key light direction, world space (toward the light). */
  keyLightDir: Node;
  /** The impostor's pixel radius (LOD). */
  pixelRadius: Node;
  /** `lupiFoilSweep(...)` from the vertex stage (a varying). */
  sweep: Node;
  /** Bonds take a slightly stronger gold edge (gilded bond edges). */
  bond?: boolean;
}

/**
 * Fragment: the lit colour with the finish applied. Exactly `lit` (the same
 * node value, through a select) with no finish, at rest and in every capture.
 */
export function lupiFoilFinish(input: LupiFoilInput): Node {
  const T = ATOM_FOIL_TUNING;
  return (Fn(() => {
    const lit: N = (input.lit as N).toVar();
    const out: N = lit.toVar();
    const gate: N = foilGate().toVar();
    If(gate.greaterThan(0.0), () => {
      const n: N = input.normal as N;
      const facing: N = clamp(input.facing as N, 0, 1);
      const rimEdge: N = float(1).sub(facing);
      const sweep: N = input.sweep as N;
      const lod: N = mix(0.35, 1.0, smoothstep(1.5, T.lodPixels, input.pixelRadius as N));
      const strength: N = gate.mul(sweep.x).mul(lod).toVar();
      const glint: N = gate.mul(sweep.y).mul(T.glint);
      const nWorld: N = toWorld(n);
      const finish: N = F.uFoilFinish;

      If(finish.lessThan(1.5), () => {
        // Holo: thin film on the rims; the hue follows orientation and angle.
        const phase = dot(nWorld, vec3(0.577, 0.577, 0.577)).mul(T.holoHueTravel).add(rimEdge.mul(1.4));
        const film = mix(vec3(1.0), filmHue(phase), 0.82);
        const rim = pow(rimEdge, 1.8).mul(T.holoRim).add(T.holoSheen);
        const band = filmHue(phase.add(0.5)).mul(glint);
        out.assign(lit.add(film.mul(rim).mul(strength)).add(band));
      }).ElseIf(finish.lessThan(2.5), () => {
        // Gold leaf: a gold Fresnel rim and a gold key highlight over CPK cores.
        const gold = vec3(F.uGoldColor);
        const L = toView(input.keyLightDir as N);
        const H = normalize(L.add(vec3(0, 0, 1)));
        const highlight = pow(max(dot(n, H), 0.0), T.goldShininess).mul(T.goldSpecular);
        const rimGain = input.bond ? T.goldRim * 1.25 : T.goldRim;
        const fresnel = pow(rimEdge, 3.0).mul(rimGain);
        const warm = mix(vec3(1.0), vec3(1.0 + T.goldWarmth, 1.0, 1.0 - T.goldWarmth * 1.4), strength);
        out.assign(lit.mul(warm).add(gold.mul(fresnel.add(highlight).add(0.03)).mul(strength)).add(gold.mul(glint)));
      }).Else(() => {
        // Pearl: a milky lift and a faint play of colour toward the rims.
        const phase = dot(nWorld, vec3(0.2, 0.9, 0.4)).mul(0.9).add(rimEdge.mul(0.6));
        const tint = mix(vec3(1.0, 0.965, 0.975), filmHue(phase), T.pearlPlay);
        const sheen = pow(rimEdge, 1.2).mul(T.pearlSheen).add(0.06);
        const milky = mix(lit, lit.mul(0.86).add(tint.mul(T.pearlLift)), strength);
        out.assign(milky.add(tint.mul(sheen).mul(strength)).add(vec3(1.0, 0.97, 0.98).mul(glint.mul(0.8))));
      });
    });
    return out;
  }) as N)() as Node;
}

/** True while a finish could show (none, a capture or an ordinary recording hide it). */
export function isLupiFoilLive(): boolean {
  return !recording && ATOM_FOIL.uFoilWeight.value > 0 && ATOM_FOIL.uFoilFinish.value > 0.5 && ATOM_FOIL.uFoilLevel.value > 0;
}

/** Point the reveal sweep along a screen direction (normalized; a zero vector sweeps right to left). */
export function setLupiFoilSweepDirection(x: number, y: number): void {
  const length = Math.hypot(x, y);
  if (length < 1e-6) ATOM_FOIL.uFoilSweepDir.value.set(-1, 0);
  else ATOM_FOIL.uFoilSweepDir.value.set(x / length, y / length);
}

let recording = false;

// Every raster capture renders without a finish; an ordinary recording holds
// it off; an illustrative clip (Instant Replay) keeps it, like the toys.
registerCaptureGuard({
  begin: () => {
    const saved = ATOM_FOIL.uFoilWeight.value;
    ATOM_FOIL.uFoilWeight.value = 0;
    return () => {
      ATOM_FOIL.uFoilWeight.value = saved;
    };
  },
});
registerRecordingGuard((options) => {
  if (options.illustrative) return () => {};
  recording = true;
  ATOM_FOIL.uFoilWeight.value = 0;
  return () => {
    recording = false;
    ATOM_FOIL.uFoilWeight.value = 1;
  };
});
