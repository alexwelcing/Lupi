/**
 * atomFoil.ts — Foil finishes: Holo, Gold leaf and Pearl, the rare cosmetic
 * finishes a Remix code can carry (ui/src/remix/code.ts).
 *
 * Adapted from Shaders (MIT), Holographic, packages/core/src/shaders/
 * Holographic/index.ts; Chrome, packages/core/src/shaders/Chrome/index.ts
 * (`chromeStudio`); and ThinFilm, packages/core/src/gpu/kit/effects/
 * thinFilm.ts. Ported by hand from flat stickers to the ray-cast spheres and
 * sticks: the hit normal stands in for the shape field, and nothing runs on
 * time.
 *
 * A finish lives on the rims, the highlights and the sheen; the element
 * colour stays the base of every sphere, and nothing moves. Each is a
 * view-dependent term in the atom and bond impostors, so it shows itself as
 * the molecule turns:
 *
 * - **Holo** (Shaders Holographic): a holographic laminate. The hue is a
 *   blotch field, a ramp over the surface's world orientation, the tilt
 *   toward the key light and the viewing angle, cosine-rainbow mixed with
 *   silver. Laminate wrinkles bend the normal the sheen and the hue read.
 *   Blinn sheen and specular, and glitter flakes: cells locked to each ball
 *   (its world-space normal and a per-atom seed), each a tilted facet that
 *   glints when it mirrors the key light or the overhead strip to the eye.
 *   Bonds take the rainbow and the sheen, not the flakes or wrinkles.
 * - **Gold leaf** (Shaders Chrome's studio): the rims and the catchlights
 *   mirror a procedural photo studio, tinted gold: a floor-to-ceiling
 *   gradient around world up, black flags at the sides, an amber glow at the
 *   softbox edge and a cool wash below the horizon, and the Specimen rig's
 *   own panels (impostorKit's ANALYTIC_SOFTBOX_RIG): the key softbox as a
 *   rounded rectangle along the key light, the overhead strip and the floor
 *   card. The softbox edge splits slightly into red and blue toward the rims.
 *   The CPK core stays, so it never reads as gold atoms.
 * - **Pearl** (Shaders ThinFilm): an opaque nacre. A milky lift, and a
 *   thin-film rim, `pow(1 − n·v, k)`, whose phase is the angle around the
 *   disc from the key light plus a thickness term that rings in toward the
 *   centre; the IQ cosine palette is whitened, so it reads as pink, green
 *   and lilac, not a rainbow.
 *
 * The reveal is one sweep across the molecule from the key-light side (about
 * 900 ms, driven by the viewer): atoms take the finish as a bright band
 * passes. Far atoms (a few pixels across) keep only a faint sheen, and
 * glitter cells under about a pixel and a half fade out rather than shimmer.
 *
 * Quiet Idle: no term reads a clock. Glitter, sheen and colour change only
 * as the view or the molecule turns (and with the reveal sweep), so a still
 * view draws the same picture every time.
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
  abs,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  hash,
  instanceIndex,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { registerCaptureGuard, registerRecordingGuard } from '../captureGuards';
import { ANALYTIC_SOFTBOX_RIG, lightDirection } from './impostorKit';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** Finish ids the shader reads (0 = none). */
export const FOIL_FINISH_ID = { none: 0, holo: 1, gold: 2, pearl: 3 } as const;
export type FoilFinishName = keyof typeof FOIL_FINISH_ID;

export const ATOM_FOIL_TUNING = {
  /** Holo: rim gain (power 1.8) and the face sheen under it. */
  holoRim: 0.95,
  holoSheen: 0.1,
  /**
   * Holo hue, in rainbow turns: blotch weight (Shaders 0.45), the ramp over
   * world orientation, the key-light tilt (Shaders 1.4 over a flat sticker;
   * a sphere turns through all of n·L) and the viewing angle.
   */
  holoBlotch: 0.45,
  holoHueTravel: 0.55,
  holoTilt: 0.5,
  holoAngle: 0.6,
  holoHueShift: 0.0,
  /** Holo: silver ↔ spectrum (Shaders saturation × 0.85). */
  holoSaturation: 0.8,
  /** Holo: blotch and wrinkle frequency over the unit normal, and the wrinkles' tilt. */
  holoBlotchScale: 3.2,
  holoCrinkle: 0.3,
  /** Holo: foil roughness (Blinn exponent 42 → 12) and the sheen/specular gain. */
  holoRoughness: 0.25,
  holoSpecular: 0.45,
  /** Glitter: cells across the unit normal, facet tilt, glint sharpness and gain. */
  flakeCells: 9,
  flakeTilt: 0.6,
  flakeSharpness: 10,
  flakeGain: 1.1,
  /** Gold leaf: rim leaf gain and power (bonds ×1.25), studio exposure, catchlight gain. */
  goldRim: 1.5,
  goldRimPower: 3,
  goldExposure: 1.3,
  goldCatch: 0.3,
  /** Gold leaf studio (Shaders Chrome defaults): edge softness, accent lights, flags, dispersion. */
  goldSoftness: 0.3,
  goldSpectral: 0.9,
  goldShadows: 0.7,
  goldDispersion: 0.3,
  goldWarmth: 0.07,
  /** Pearl: milky lift, rim sheen gain, play of colour in the lift. */
  pearlLift: 0.16,
  pearlSheen: 0.4,
  pearlPlay: 0.24,
  /** Pearl thin film (Shaders ThinFilm): rim power, dispersion, thickness rings, saturation, hue shift, light angle. */
  pearlRimPower: 1.5,
  pearlDispersion: 0.5,
  pearlThickness: 0.8,
  pearlSaturation: 0.5,
  pearlHueShift: 0.9,
  pearlAngleDeg: 300,
  /** The reveal band: its half-width (fraction of the molecule) and glint gain. */
  sweepBand: 0.16,
  glint: 0.7,
  /** Atoms under this many pixels across keep only the faint sheen. */
  lodPixels: 5,
} as const;

/** Chrome's accent lights (linear #ffa94d and #82a7e6) and the studio's grey levels. */
const STUDIO = {
  warm: [1.0, 0.397, 0.074],
  cool: [0.223, 0.386, 0.791],
  floor: [0.17, 0.175, 0.19],
  ceiling: [0.56, 0.57, 0.6],
  softbox: [2.9, 2.87, 2.82],
  card: [0.5, 0.5, 0.52],
} as const;

/** Silver under Holo's spectrum (Shaders Holographic). */
const HOLO_SILVER = [0.72, 0.73, 0.76] as const;
/** Pearl's nacre body tint. */
const NACRE = [1.0, 0.965, 0.975] as const;

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
 * 1 and 0 once the sweep is done. `z` is the instance's seed (0..1, constant
 * per atom or bond), which places its blotches, wrinkles and glitter.
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
  return vec4(revealed, glint, hash(instanceIndex), 0) as Node;
}

function toView(worldDir: N): N {
  return normalize(cameraViewMatrix.mul(vec4(worldDir, 0.0)).xyz);
}

function toWorld(viewDir: N): N {
  return normalize(cameraWorldMatrix.mul(vec4(viewDir, 0.0)).xyz);
}

/** IQ's cosine palette: a smooth rainbow that wraps every 1, channel phases as given. */
function cosinePalette(phase: N, phases: readonly [number, number, number]): N {
  const tau = 6.283185307;
  return vec3(0.5).add(vec3(0.5).mul(cos(vec3(phase).add(vec3(...phases)).mul(tau))));
}

/** Holographic's spectrum (exact thirds) and ThinFilm's (the truncated thirds it has always used). */
const HOLO_PHASES = [0, 1 / 3, 2 / 3] as const;
const FILM_PHASES = [0, 0.3333, 0.6667] as const;

/**
 * The eye direction at a hit with view-space normal `n` and n·eye = `facing`,
 * rebuilt in the plane of the normal and the view axis: exact at the centre
 * and grazing at the silhouette, so reflections agree with the rims.
 */
function eyeDirection(n: N, facing: N): N {
  const along: N = vec3(0, 0, 1).sub(n.mul(n.z));
  const tangent: N = along.div(max(length(along), 1e-4));
  const across: N = sqrt(max(float(1).sub(facing.mul(facing)), 0));
  return normalize(n.mul(facing).add(tangent.mul(across)));
}

/**
 * Holo's blotch and laminate-wrinkle field: three crossed sine waves over a
 * point (−1..1) and their exact gradient. Shaders samples Perlin noise three
 * times for the wrinkles' finite differences; the waves give both for six
 * trig calls and no texture.
 */
const WAVES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.93, 0.31, -0.19, 0.0],
  [-0.37, 1.21, 0.53, 1.7],
  [0.36, -0.62, 1.57, 4.1],
];

function waveField(p: N): { value: N; gradient: N } {
  let value: N = float(0);
  let gradient: N = vec3(0);
  for (const [x, y, z, phase] of WAVES) {
    const k: N = vec3(x, y, z);
    const t: N = dot(p, k).add(phase);
    value = value.add(sin(t));
    gradient = gradient.add(k.mul(cos(t)));
  }
  return { value: value.div(WAVES.length), gradient: gradient.div(WAVES.length) };
}

/** Where view-space `dir` crosses a panel facing the origin from `toPanel`: gnomonic (x, y) and dir·toPanel. */
function panelCoordinates(dir: N, toPanel: N, up: N): N {
  const z: N = dot(dir, toPanel);
  // A panel straight overhead (or below) has no horizon: nudge the cross
  // product so the frame never collapses (as impostorKit's softboxPanel).
  const side: N = normalize(cross(up, toPanel).add(vec3(0, 0, 1e-4)));
  const lift: N = cross(toPanel, side);
  const inverse: N = float(1).div(max(z, 1e-3));
  const x: N = dot(dir, side);
  const y: N = dot(dir, lift);
  return vec3(x.mul(inverse), y.mul(inverse), z);
}

/** Chrome's projected rounded rectangle: signed distance in panel units (negative inside). */
function roundedRect(x: N, y: N, halfWidth: number, halfHeight: number): N {
  const bx: N = abs(x).sub(halfWidth);
  const by: N = abs(y).sub(halfHeight);
  return length(max(vec2(bx, by), vec2(0))).add(min(max(bx, by), 0));
}

/** Glitter cell ids mix their coordinates like displayMotion's position seeds. */
const CELL_MIX_Y = 2654435769;
const CELL_MIX_Z = 2246822507;

/** The Specimen rig's fixed panels, world space, toward the panel. */
const STRIP_DIR = lightDirection(ANALYTIC_SOFTBOX_RIG.strip.azimuthDeg, ANALYTIC_SOFTBOX_RIG.strip.elevationDeg);
const FLOOR_DIR = lightDirection(ANALYTIC_SOFTBOX_RIG.floor.azimuthDeg, ANALYTIC_SOFTBOX_RIG.floor.elevationDeg);

/**
 * Gold leaf's studio: Shaders Chrome's `chromeStudio` radiance (linear,
 * HDR) along the view-space reflection `R`, with its softbox moved onto the
 * Specimen rig's key panel and the rig's overhead strip and floor card added,
 * so the leaf mirrors the lights the atoms are lit by. `R` and `B` read the
 * softbox `delta` higher and lower (Chrome's spectral taps): the edge splits
 * into red and blue where the reflection moves fast.
 */
function goldStudio(R: N, up: N, key: N, delta: N): { env: N; catchlight: N } {
  const T = ATOM_FOIL_TUNING;
  const rig = ANALYTIC_SOFTBOX_RIG;
  const warm: N = vec3(...STUDIO.warm);
  const cool: N = vec3(...STUDIO.cool);
  const ex: N = R.x;
  const ey: N = dot(R, up);

  // Warm accents on the key light's side of the screen, cool on the other.
  const keySide: N = select(key.x.greaterThanEqual(0.0), float(1), float(-1));
  const horiz: N = ex.div(length(vec2(ex, ey)).add(1e-4)).mul(keySide);
  const warmSide: N = smoothstep(-0.7, 0.7, horiz).mul(0.65).add(0.35);
  const coolSide: N = smoothstep(-0.7, 0.7, horiz.negate()).mul(0.55).add(0.45);

  // Vertical surround: graphite floor → grey middle → pale ceiling.
  const rise: N = smoothstep(-0.65, 1.0, ey);
  const graphite: N = cool.mul(0.03).add(vec3(0.003, 0.003, 0.004));
  const low: N = mix(vec3(...STUDIO.floor), graphite, T.goldShadows);
  const env: N = mix(low, vec3(...STUDIO.ceiling), rise.mul(rise))
    .add(vec3(0.55, 0.55, 0.56).mul(smoothstep(0.3, 0.9, ey)))
    .toVar();

  // Cool wash below the horizon.
  const cd: N = ey.add(0.45).div(0.2);
  env.addAssign(cool.mul(exp(cd.mul(cd).negate()).mul(T.goldSpectral * 0.2).mul(coolSide)));

  // The key softbox: a rounded rectangle along the key light, three taps.
  const soft: N = float(0.05 + T.goldSoftness * 0.4);
  const panel: N = panelCoordinates(R, key, up).toVar();
  const facing: N = smoothstep(0.05, 0.3, panel.z);
  const shift: N = delta.div(max(panel.z, 1e-3));
  const boxG: N = roundedRect(panel.x, panel.y, rig.key.halfWidth, rig.key.halfHeight).toVar();
  const boxR: N = roundedRect(panel.x, panel.y.add(shift), rig.key.halfWidth, rig.key.halfHeight);
  const boxB: N = roundedRect(panel.x, panel.y.sub(shift), rig.key.halfWidth, rig.key.halfHeight);
  // Chrome's smoothstep(soft, −0.6·soft, d), with the edges in order (GLSL leaves reversed edges undefined).
  const lit = (d: N): N => float(1).sub(smoothstep(soft.mul(-0.6), soft, d));
  const box: N = vec3(lit(boxR), lit(boxG), lit(boxB)).mul(facing);
  const softbox: N = vec3(...STUDIO.softbox).mul(box);

  // Black flags either side: continuous sideways darkening, before the strips.
  const flag: N = smoothstep(0.5, 0.92, abs(ex));
  env.mulAssign(mix(float(1), float(0.55 + (0.07 - 0.55) * T.goldShadows), flag));

  // Amber glow hugging the softbox edge, and a faint warm bounce at the horizon.
  const gw: N = float(0.065 + T.goldSoftness * 0.05);
  const outside: N = max(boxG, 0).div(gw);
  const glow: N = exp(outside.mul(outside).negate()).mul(smoothstep(-0.06, 0.1, boxG));
  env.addAssign(warm.mul(glow.mul(T.goldSpectral * 1.3).mul(warmSide).mul(facing)));
  const fb: N = ey.add(0.12).div(0.05);
  env.addAssign(warm.mul(exp(fb.mul(fb).negate()).mul(T.goldSpectral * 0.5).mul(warmSide).mul(float(1).sub(facing))));

  // The rig's overhead strip and its floor card (Chrome's low bounce card).
  const strip: N = panelCoordinates(R, toView(vec3(STRIP_DIR.x, STRIP_DIR.y, STRIP_DIR.z)), up);
  const stripLit: N = lit(roundedRect(strip.x, strip.y, rig.strip.halfWidth, rig.strip.halfHeight))
    .mul(smoothstep(0.05, 0.3, strip.z));
  const card: N = panelCoordinates(R, toView(vec3(FLOOR_DIR.x, FLOOR_DIR.y, FLOOR_DIR.z)), up);
  const cardLit: N = lit(roundedRect(card.x, card.y, rig.floor.halfWidth, rig.floor.halfHeight))
    .mul(smoothstep(0.05, 0.3, card.z));
  const catchlight: N = softbox.add(vec3(1.6).mul(stripLit));
  env.addAssign(vec3(...STUDIO.card).mul(cardLit));
  return { env: env.add(catchlight), catchlight };
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
  /** Bonds take a slightly stronger gold edge (gilded bond edges), and no glitter. */
  bond?: boolean;
  /**
   * 0..1: how far the finish steps aside (the Illustrate look's `uInkMix`: a
   * drawing carries no foil). At 1 the result is exactly `lit`.
   */
  mute?: Node;
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
    const muted: N = input.mute ? foilGate().mul(float(1).sub(clamp(input.mute as N, 0, 1))) : foilGate();
    const gate: N = muted.toVar();
    If(gate.greaterThan(0.0), () => {
      const n: N = (input.normal as N).toVar();
      const facing: N = clamp(input.facing as N, 0, 1).toVar();
      const rimEdge: N = float(1).sub(facing).toVar();
      const sweep: N = (input.sweep as N).toVar();
      const lod: N = mix(0.35, 1.0, smoothstep(1.5, T.lodPixels, input.pixelRadius as N));
      const strength: N = gate.mul(sweep.x).mul(lod).toVar();
      const glint: N = gate.mul(sweep.y).mul(T.glint).toVar();
      const eye: N = eyeDirection(n, facing).toVar();
      const nWorld: N = toWorld(n).toVar();
      const finish: N = F.uFoilFinish;

      If(finish.lessThan(1.5), () => {
        // Holo (Shaders Holographic): laminate, rainbow, sheen and glitter.
        const keyWorld: N = normalize(input.keyLightDir as N).toVar();
        const eyeWorld: N = toWorld(eye).toVar();
        const seed: N = vec3(sweep.z).mul(vec3(173.3, 291.7, 247.9)).toVar();
        const field = waveField(nWorld.mul(T.holoBlotchScale).add(seed));
        // Laminate wrinkles: the field's slope in the tangent plane tilts the normal.
        const slope: N = field.gradient.sub(nWorld.mul(dot(nWorld, field.gradient)));
        const wrinkled: N = (input.bond ? nWorld : normalize(nWorld.add(slope.mul(T.holoCrinkle)))).toVar();
        const tilt: N = dot(wrinkled, keyWorld).toVar();
        const hue: N = field.value
          .mul(T.holoBlotch)
          .add(dot(nWorld, vec3(0.577, 0.577, 0.577)).mul(T.holoHueTravel))
          .add(tilt.mul(T.holoTilt))
          .add(float(1).sub(clamp(dot(wrinkled, eyeWorld), 0, 1)).mul(T.holoAngle))
          .add(T.holoHueShift)
          .toVar();
        const tint: N = mix(vec3(...HOLO_SILVER), cosinePalette(hue, HOLO_PHASES), T.holoSaturation).toVar();

        // Sheen and specular on the wrinkled foil (Blinn, exponent 42 → 12 with roughness).
        const r = T.holoRoughness;
        const half: N = normalize(keyWorld.add(eyeWorld));
        const ndh: N = clamp(dot(wrinkled, half), 0, 1);
        const diffuse: N = clamp(tilt.mul(0.5).add(0.5), 0, 1).toVar();
        const sheen: N = pow(ndh, 7).mul(0.45 * (1 - 0.35 * r));
        const core: N = pow(ndh, 42 + (12 - 42) * r).mul(0.85 * (1 - 0.55 * r));
        const specular: N = tint.mul(sheen).add(mix(tint, vec3(1), 0.6).mul(core)).mul(T.holoSpecular);
        const rim: N = pow(rimEdge, 1.8).mul(T.holoRim).add(T.holoSheen);
        const foil: N = tint.mul(rim).add(specular).toVar();

        if (!input.bond) {
          // Glitter: cells locked to the ball, each a tilted facet with its own
          // hue. It glints when it mirrors the key light or the overhead strip
          // to the eye (Shaders twinkles flakes on a clock; here the view turns
          // them). Cells under ~1.5 px and at the grazing rim fade out.
          const cellPoint: N = nWorld.mul(T.flakeCells).add(seed).add(512.0);
          const cell: N = floor(cellPoint);
          const id: N = uint(cell.x)
            .bitXor(uint(cell.y).mul(uint(CELL_MIX_Y)))
            .bitXor(uint(cell.z).mul(uint(CELL_MIX_Z)))
            .toVar();
          const h0: N = hash(id);
          const scatter: N = vec3(hash(id.add(uint(1))), hash(id.add(uint(2))), hash(id.add(uint(3)))).toVar();
          const facet: N = normalize(wrinkled.add(scatter.sub(0.5).mul(2 * T.flakeTilt)));
          const strip: N = vec3(STRIP_DIR.x, STRIP_DIR.y, STRIP_DIR.z);
          const keyGlint: N = pow(max(dot(facet, half), 0), T.flakeSharpness);
          const stripGlint: N = pow(max(dot(facet, normalize(strip.add(eyeWorld))), 0), T.flakeSharpness).mul(0.6);
          const twinkle: N = clamp(keyGlint.add(stripGlint), 0, 1);
          const flakeN: N = h0.sub(0.5).mul(1.2);
          const cellPixels: N = (input.pixelRadius as N).div(T.flakeCells);
          const visible: N = smoothstep(1.0, 2.0, cellPixels).mul(smoothstep(0.12, 0.4, facing));
          const mask: N = smoothstep(0.52, 0.62, flakeN.mul(0.75).add(twinkle.mul(0.3))).mul(visible);
          const flake: N = cosinePalette(hue.add(0.33).add(scatter.z.mul(0.5)), HOLO_PHASES)
            .mul(twinkle.mul(0.55).add(0.85))
            .mul(diffuse.mul(0.6).add(0.7));
          foil.addAssign(flake.mul(mask).mul(T.flakeGain));
        }

        const band = cosinePalette(hue.add(0.5), HOLO_PHASES).mul(glint);
        out.assign(lit.add(foil.mul(strength)).add(band));
      }).ElseIf(finish.lessThan(2.5), () => {
        // Gold leaf (Shaders Chrome's studio): the rims mirror the studio in
        // gold, the face keeps its CPK core and the rig's catchlights.
        const gold: N = vec3(F.uGoldColor);
        const up: N = toView(vec3(0, 1, 0));
        const key: N = toView(input.keyLightDir as N);
        const reflected: N = n.mul(facing.mul(2)).sub(eye);
        const delta: N = rimEdge.mul(rimEdge).mul(0.06).add(0.004).mul(T.goldDispersion);
        const studio = goldStudio(reflected, up, key, delta);
        const rimGain = input.bond ? T.goldRim * 1.25 : T.goldRim;
        const leaf: N = clamp(pow(rimEdge, T.goldRimPower).mul(rimGain), 0, 0.92).mul(strength);
        const warm: N = mix(vec3(1.0), vec3(1.0 + T.goldWarmth, 1.0, 1.0 - T.goldWarmth * 1.4), strength);
        const mirrored: N = studio.env.mul(gold).mul(T.goldExposure);
        const catchlight: N = studio.catchlight.mul(gold).mul(T.goldCatch).mul(strength).mul(float(1).sub(leaf));
        out.assign(mix(lit.mul(warm), mirrored, leaf).add(catchlight).add(gold.mul(glint)));
      }).Else(() => {
        // Pearl (Shaders ThinFilm): a milky nacre and a whitened thin-film rim.
        const key: N = toView(input.keyLightDir as N);
        const rim: N = pow(rimEdge, T.pearlRimPower);
        // The angle around the disc from the key light, turned by a fixed angle (ThinFilm's lightAngle).
        const around: N = n.xy.div(max(length(n.xy), 1e-4));
        const light: N = key.xy.div(max(length(key.xy), 1e-4));
        const angle = (T.pearlAngleDeg * Math.PI) / 180;
        const baseCos: N = dot(around, light);
        const baseSin: N = around.y.mul(light.x).sub(around.x.mul(light.y));
        const rotated: N = baseCos.mul(Math.cos(angle)).add(baseSin.mul(Math.sin(angle)));
        const phase: N = rotated.mul(T.pearlDispersion).add(facing.mul(T.pearlThickness)).add(T.pearlHueShift);
        const film: N = mix(vec3(1.0), cosinePalette(phase, FILM_PHASES), T.pearlSaturation).toVar();
        const tint: N = mix(vec3(...NACRE), film, T.pearlPlay);
        const half: N = normalize(key.add(eye));
        const lustre: N = pow(clamp(dot(n, half), 0, 1), 16).mul(0.14);
        const sheen: N = film.mul(rim.mul(T.pearlSheen).add(0.06).add(lustre));
        const milky: N = mix(lit, lit.mul(0.86).add(tint.mul(T.pearlLift)), strength);
        out.assign(milky.add(sheen.mul(strength)).add(vec3(1.0, 0.97, 0.98).mul(glint.mul(0.8))));
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
