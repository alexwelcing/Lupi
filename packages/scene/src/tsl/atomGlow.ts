/**
 * atomGlow.ts — the hover, selection and grab glow of the atom impostor, and
 * the warm tint of the Heat toy.
 *
 * Module singletons like displayMotion's: one write reaches every atom
 * impostor material (the viewer has one atom layer). The material reads
 * them in two places:
 * - the vertex stage compares `instanceIndex` (instances map 1:1 onto atom
 *   indices) with the hovered, selected and grabbed atom, and passes one
 *   strength varying; the hovered and grabbed atoms also swell a little;
 * - the fragment adds a soft lime rim (strongest at the silhouette) scaled
 *   by that strength, plus the Heat tint on every atom.
 *
 * Truth rules: the glow is a pointer affordance, not part of the scene. The
 * capture guard below zeroes the master weight inside every capture render
 * (exports, MCP rasters, thumbnails) and a recording guard holds it at zero
 * for a video, so no artifact ever carries a hover, a selection glow, a swell
 * or the heat tint. With the master at zero the swell multiplies the radius by
 * exactly 1 and the glow adds exactly vec3(0).
 */
import { Color, Vector4 } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import { abs, clamp, float, max, pow, select, uniform, vec3 } from 'three/tsl';
import { registerCaptureGuard, registerRecordingGuard } from '../captureGuards';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** The house accent (lime) and the Heat tint (a warm ember). */
export const ATOM_GLOW_COLOR = '#d5ef9c';
export const ATOM_HEAT_COLOR = '#ff9a4a';

export const ATOM_GLOW_TUNING = {
  /** Strength of the hover glow (the selection is 1). */
  hover: 0.6,
  /** Strength of the grabbed atom's glow (Tug). */
  focus: 1.15,
  /** Radius swell of the hovered and grabbed atoms (fraction). */
  hoverSwell: 0.06,
  focusSwell: 0.08,
  /** Rim falloff exponent and gain; `fill` lifts the whole face a little. */
  rimPower: 2.2,
  rimGain: 1.2,
  fill: 0.12,
  /** Heat tint gain at full heat. */
  heat: 0.6,
} as const;

type FloatUniform = UniformNode<'float', number>;

export interface AtomGlowUniforms {
  /** Master gate: 1 live, exactly 0 inside every capture render and recording. */
  uGlowWeight: FloatUniform;
  /** Hovered atom index (−1 none) and its fade level 0..1. */
  uHoverAtom: FloatUniform;
  uHoverLevel: FloatUniform;
  /** Up to four selected atom indices (−1 empty) and their fade level 0..1. */
  uSelectAtoms: UniformNode<'vec4', Vector4>;
  uSelectLevel: FloatUniform;
  /** The atom a toy holds (Tug's grab), −1 none. */
  uFocusAtom: FloatUniform;
  /** Heat tint level 0..1 (all atoms). */
  uHeatGlow: FloatUniform;
  uGlowColor: UniformNode<'color', Color>;
  uHeatColor: UniformNode<'color', Color>;
}

const f = (value: number) => uniform(value) as unknown as FloatUniform;

/** The shared glow uniforms (module singletons). */
export const ATOM_GLOW: AtomGlowUniforms = {
  uGlowWeight: f(1),
  uHoverAtom: f(-1),
  uHoverLevel: f(0),
  uSelectAtoms: uniform(new Vector4(-1, -1, -1, -1)) as unknown as UniformNode<'vec4', Vector4>,
  uSelectLevel: f(0),
  uFocusAtom: f(-1),
  uHeatGlow: f(0),
  uGlowColor: uniform(new Color(ATOM_GLOW_COLOR)) as unknown as UniformNode<'color', Color>,
  uHeatColor: uniform(new Color(ATOM_HEAT_COLOR)) as unknown as UniformNode<'color', Color>,
};

const G = ATOM_GLOW as unknown as Record<keyof AtomGlowUniforms, N>;

function isAtom(atomId: N, index: N): N {
  return abs(atomId.sub(index)).lessThan(0.5);
}

/**
 * Vertex stage: the glow strength of this instance (0 for most atoms, and
 * exactly 0 for all of them while the master is 0).
 */
export function lupiAtomGlowStrength(atomId: Node): Node {
  const id = atomId as N;
  const T = ATOM_GLOW_TUNING;
  const sel = G.uSelectAtoms;
  const selected = isAtom(id, sel.x).or(isAtom(id, sel.y)).or(isAtom(id, sel.z)).or(isAtom(id, sel.w));
  const hover = select(isAtom(id, G.uHoverAtom), G.uHoverLevel.mul(T.hover), float(0));
  const picked = select(selected, G.uSelectLevel, float(0));
  const focus = select(isAtom(id, G.uFocusAtom), float(T.focus), float(0));
  return max(max(hover, picked), focus).mul(G.uGlowWeight) as Node;
}

/** Vertex stage: the radius multiplier (exactly 1 unless hovered or grabbed while live). */
export function lupiAtomSwell(atomId: Node): Node {
  const id = atomId as N;
  const T = ATOM_GLOW_TUNING;
  const hover = select(isAtom(id, G.uHoverAtom), G.uHoverLevel.mul(T.hoverSwell), float(0));
  const focus = select(isAtom(id, G.uFocusAtom), float(T.focusSwell), float(0));
  return float(1).add(max(hover, focus).mul(G.uGlowWeight)) as Node;
}

/**
 * Fragment: the light the glow adds (linear, before tone mapping). `facing`
 * is dot(normal, toward the eye) at the hit, 1 at the centre of the disc and
 * 0 at the silhouette; `strength` is the vertex stage's varying.
 */
export function lupiAtomGlow(strength: Node, facing: Node): Node {
  const T = ATOM_GLOW_TUNING;
  const rim = pow(float(1).sub(clamp(facing as N, 0, 1)), T.rimPower);
  const glow = vec3(G.uGlowColor).mul(rim.mul(T.rimGain).add(T.fill)).mul(strength as N);
  const heat = vec3(G.uHeatColor).mul(rim.mul(0.8).add(0.22)).mul(G.uHeatGlow.mul(T.heat).mul(G.uGlowWeight));
  return glow.add(heat) as Node;
}

/** Zero every glow channel (the master stays as it is). */
export function resetLupiAtomGlow(): void {
  const M = ATOM_GLOW;
  M.uHoverAtom.value = -1;
  M.uHoverLevel.value = 0;
  M.uSelectAtoms.value.set(-1, -1, -1, -1);
  M.uSelectLevel.value = 0;
  M.uFocusAtom.value = -1;
  M.uHeatGlow.value = 0;
}

let recording = false;

/** True while the glow could show (a recording holds it off). */
export function isLupiAtomGlowLive(): boolean {
  return !recording && ATOM_GLOW.uGlowWeight.value > 0;
}

// Every raster capture renders without the glow; a recording holds it off.
registerCaptureGuard({
  begin: () => {
    const saved = ATOM_GLOW.uGlowWeight.value;
    ATOM_GLOW.uGlowWeight.value = 0;
    return () => {
      ATOM_GLOW.uGlowWeight.value = saved;
    };
  },
});
registerRecordingGuard(() => {
  recording = true;
  ATOM_GLOW.uGlowWeight.value = 0;
  return () => {
    recording = false;
    ATOM_GLOW.uGlowWeight.value = 1;
  };
});
