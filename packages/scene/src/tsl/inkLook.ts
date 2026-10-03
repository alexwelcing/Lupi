/**
 * inkLook.ts — the Illustrate look on the ray-cast impostors: flat (cel) or
 * hatched toon shading with ink outlines, the house ink drawing's voice (the
 * home hero, the /m pages and their cards, Lupi Daily) inside the 3D view.
 *
 * One closed form, `lupiInkSurface`, that the atom and bond impostors mix
 * over their lit surface by a shared weight (`uInkMix`):
 * - fills: the CPK colour lifted toward paper, in three bands from the key
 *   light (shade, colour, lit) plus a cel catchlight. The baked contact
 *   occlusion pushes crevices into the shade band, so the drawing keeps its
 *   depth without screen-space AO (it holds still while it spins);
 * - ink: an outline of constant width at every atom's and bond's silhouette,
 *   measured analytically from the hit normal (no edge pass, no MRT, the same
 *   on WebGPU and WebGL2). Atoms too small to carry a line lose it; bonds
 *   thinner than about two lines become one ink stroke, as in the drawings;
 * - hatching (`uInkHatch`): pen strokes in the shade, crossed in the deepest
 *   shade, at a fixed spacing in picture pixels. Stroke coordinates come from
 *   the view-space hit and the full picture's projection, so a tiled,
 *   supersampled export draws them seamlessly across its tiles.
 *
 * Line weight is in "ink units": CSS pixels on a 900 px picture, scaled with
 * the picture's short side (within limits) and the device or capture texel
 * scale (`uInkPx`, recomputed on every render), so an export draws the same
 * weight relative to the picture as the screen does.
 *
 * Truth rules: Illustrate is a Look, not toy motion. It never moves an atom
 * and exports carry it. The weight can fade between looks (the Ink-to-Light
 * hand-off, a toggle); the capture guard below renders every capture at the
 * configured target instead (`setInkLookTarget`), so no artifact carries a
 * half-faded look.
 *
 * Module singletons, like displayMotion's and atomGlow's: one write reaches
 * every impostor material. At `uInkMix = 0` the impostors skip this code
 * (a uniform branch), and at 1 they skip the lit surface.
 */
import { Color, Vector2 } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  normalize,
  screenSize,
  select,
  smoothstep,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { captureTexelScale, registerCaptureGuard } from '../captureGuards';
import type { LupiLightUniforms } from './impostorKit';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** The house ink palette (moleculePage/ink.ts, daily/art.ts). */
export const INK_LOOK_COLORS = {
  /** The Daily's ink: near black with a sage cast. */
  ink: '#0c1211',
  /** The drawings' highlight paper. */
  paper: '#f3f5ef',
  /** The drawings' shade tint. */
  shade: '#1a2321',
} as const;

/** Tuning points (owner feedback). Widths and spacing are in ink units. */
export const INK_LOOK_TUNING = {
  /** Outline width at an atom's silhouette. */
  atomLine: 1.5,
  /** Outline width along a bond's two edges. */
  bondLine: 1.15,
  /** Distance between hatch strokes. */
  hatchSpacing: 4.4,
  /** The widest a stroke grows, as a share of the spacing. */
  hatchMaxWidth: 0.52,
  /** The picture short side (CSS px) at which an ink unit is one CSS pixel. */
  referenceShortSide: 900,
  minPictureScale: 0.85,
  maxPictureScale: 2.6,
  /** Light value (half-Lambert × occlusion) below which a face is in shade, and above which it is lit. */
  shadeBand: 0.36,
  lightBand: 0.74,
  /** N·H above which the cel catchlight shows. */
  highlight: 0.968,
  /** How far fills lift toward paper: flat colour, and watercolour under hatching. */
  flatLift: 0.08,
  hatchLift: 0.4,
  /** How far the shade band darkens toward the shade tint (flat, hatched). */
  flatShade: 0.46,
  hatchShade: 0.14,
  /** The lit band and the catchlight, toward paper. */
  lightLift: 0.26,
  highlightLift: 0.82,
  /** How far fully buried baked occlusion pulls the light value down. */
  occlusionGain: 0.55,
  /** Bonds thinner than this many outline widths (radius) turn to solid ink, fully by the first. */
  bondSolidFrom: 1.1,
  bondSolidTo: 2.1,
  /** Hatch strokes fade in the shade: single from/to, crossed from/to (darkness 0..1). */
  hatchSingle: [0.4, 0.78] as const,
  hatchCross: [0.62, 0.93] as const,
  /** Ink opacity of the strokes (outlines are full ink). */
  hatchInk: 0.85,
} as const;

type FloatUniform = UniformNode<'float', number>;

export interface InkLookUniforms {
  /** 0 = the lit Specimen surface, 1 = Illustrate. Live; every capture renders at the target. */
  uInkMix: FloatUniform;
  /** 0 = flat colour, 1 = hatched. */
  uInkHatch: FloatUniform;
  /** Line weight multiplier (the store's ink weight). */
  uInkWeight: FloatUniform;
  /** Device (or capture texel) pixels per ink unit, recomputed per render. */
  uInkPx: FloatUniform;
  uInkColor: UniformNode<'color', Color>;
  uPaperColor: UniformNode<'color', Color>;
  uShadeColor: UniformNode<'color', Color>;
}

const f = (value: number) => uniform(value) as unknown as FloatUniform;

const sizeScratch = new Vector2();

/**
 * Device pixels per ink unit for one picture: the device (or capture texel)
 * scale times the picture's short side over the reference, clamped. Pure.
 */
export function inkPixelsPerUnit(input: {
  /** Device pixels (or capture texels) per CSS (or output) pixel. */
  pixelScale: number;
  /** The picture's size in CSS (or output) pixels. */
  width: number;
  height: number;
}): number {
  const T = INK_LOOK_TUNING;
  const scale = Number.isFinite(input.pixelScale) && input.pixelScale > 0 ? input.pixelScale : 1;
  const short = Math.min(input.width, input.height);
  const picture = Number.isFinite(short) && short > 0
    ? Math.min(T.maxPictureScale, Math.max(T.minPictureScale, short / T.referenceShortSide))
    : 1;
  return scale * picture;
}

interface FrameLike {
  renderer?: {
    getRenderTarget?(): unknown;
    getPixelRatio?(): number;
    getSize?(target: Vector2): Vector2;
  } | null;
  camera?: { view?: { enabled?: boolean; fullWidth?: number; fullHeight?: number } | null } | null;
}

/** `uInkPx` for the render a node frame describes: a capture tile, or the live canvas. */
function inkPixelsForFrame(frame: FrameLike): number {
  const renderer = frame.renderer;
  if (!renderer) return 1;
  const target = renderer.getRenderTarget?.() as { width?: number; height?: number } | null | undefined;
  const texel = captureTexelScale(target);
  if (texel !== null) {
    // A capture: the full supersampled picture (a tile's camera carries it in its view offset).
    const view = frame.camera?.view;
    const width = view?.enabled && view.fullWidth ? view.fullWidth : (target?.width ?? 0);
    const height = view?.enabled && view.fullHeight ? view.fullHeight : (target?.height ?? 0);
    return inkPixelsPerUnit({ pixelScale: texel, width: width / texel, height: height / texel });
  }
  const size = renderer.getSize?.(sizeScratch);
  return inkPixelsPerUnit({
    pixelScale: renderer.getPixelRatio?.() ?? 1,
    width: size?.x ?? 0,
    height: size?.y ?? 0,
  });
}

/** The shared Illustrate uniforms (module singletons). */
export const INK_LOOK: InkLookUniforms = {
  uInkMix: f(0),
  uInkHatch: f(0),
  uInkWeight: f(1),
  uInkPx: (uniform(1) as unknown as N).onRenderUpdate((frame: FrameLike) => inkPixelsForFrame(frame)) as FloatUniform,
  uInkColor: uniform(new Color(INK_LOOK_COLORS.ink)) as unknown as UniformNode<'color', Color>,
  uPaperColor: uniform(new Color(INK_LOOK_COLORS.paper)) as unknown as UniformNode<'color', Color>,
  uShadeColor: uniform(new Color(INK_LOOK_COLORS.shade)) as unknown as UniformNode<'color', Color>,
};

const I = INK_LOOK as unknown as Record<keyof InkLookUniforms, N>;

export interface InkLookTarget {
  /** 0 lit, 1 Illustrate. */
  mix: number;
  /** 0 flat, 1 hatched. */
  hatch: number;
  /** Line weight multiplier. */
  weight: number;
}

let target: InkLookTarget = { mix: 0, hatch: 0, weight: 1 };

/** The configured look (what every capture renders), set by the viewer's ink driver. */
export function setInkLookTarget(next: InkLookTarget): void {
  target = {
    mix: next.mix > 0 ? Math.min(1, next.mix) : 0,
    hatch: next.hatch > 0 ? Math.min(1, next.hatch) : 0,
    weight: Number.isFinite(next.weight) && next.weight > 0 ? next.weight : 1,
  };
}

export function inkLookTarget(): InkLookTarget {
  return { ...target };
}

/** True while the live uniforms differ from the target (a fade is running). */
export function isInkLookFading(): boolean {
  return INK_LOOK.uInkMix.value !== target.mix || INK_LOOK.uInkHatch.value !== target.hatch;
}

// Every capture renders the configured look, never a fade in progress.
registerCaptureGuard({
  begin: () => {
    const saved = {
      mix: INK_LOOK.uInkMix.value,
      hatch: INK_LOOK.uInkHatch.value,
      weight: INK_LOOK.uInkWeight.value,
    };
    INK_LOOK.uInkMix.value = target.mix;
    INK_LOOK.uInkHatch.value = target.hatch;
    INK_LOOK.uInkWeight.value = target.weight;
    return () => {
      INK_LOOK.uInkMix.value = saved.mix;
      INK_LOOK.uInkHatch.value = saved.hatch;
      INK_LOOK.uInkWeight.value = saved.weight;
    };
  },
});

export interface LupiInkInput {
  /** View-space unit normal. */
  normal: Node;
  /** Linear base colour (CPK, uniform or property colour). */
  baseColor: Node;
  /** Baked openness, 0 (buried) to 1. */
  occlusion: Node;
  /** The impostor's radius in device pixels. */
  pixelRadius: Node;
  /** Device pixels from this fragment to the silhouette (large where there is none). */
  edgePx: Node;
  /** Outline width in ink units. */
  lineWidth: number;
  /** The view-space hit point. */
  hit: Node;
  /** 1 while an orthographic camera renders (impostorKit `orthographicFlag`). */
  isOrtho: Node;
  /** Linear light the surface emits (property glow), added to the fill. */
  emission?: Node;
  /** Bonds: below about two outline widths the whole stroke is ink. */
  thinSolid?: boolean;
}

/** A world-space direction in view space. */
function toView(worldDir: Node): N {
  return normalize(cameraViewMatrix.mul(vec4(worldDir as N, 0.0)).xyz);
}

/** Coverage of a family of parallel strokes along `coord` (device px), `amount` 0..1 of the widest. */
function strokes(coord: N, amount: N, spacing: N): N {
  const width = amount.mul(spacing.mul(INK_LOOK_TUNING.hatchMaxWidth)).toVar();
  const fromCentre = abs(fract(coord.div(spacing)).sub(0.5)).mul(spacing);
  const half = width.mul(0.5);
  return float(1)
    .sub(smoothstep(half.sub(0.5), half.add(0.5), fromCentre))
    .mul(smoothstep(0.15, 0.6, width));
}

/**
 * The Illustrate surface (linear RGB): toon fill, hatching and ink. View
 * space with V = +z, like `lupiSurface`; the key light's direction is the
 * light uniforms', so the bands follow the Light controls.
 */
export function lupiInkSurface(s: LupiInkInput, lights: LupiLightUniforms): Node {
  return (Fn(() => {
    const T = INK_LOOK_TUNING;
    const Nrm = (s.normal as N).toVar();
    const base = (s.baseColor as N).toVar();
    const hatch = clamp(I.uInkHatch, 0.0, 1.0).toVar();
    const px = max(s.pixelRadius as N, 1.0).toVar();
    const L = toView(lights.lightDir).toVar();
    const ndl = dot(Nrm, L).toVar();

    // Light value: half-Lambert, pulled into the shade where the bake says buried.
    const open = clamp(s.occlusion as N, 0.0, 1.0);
    const value = ndl.mul(0.5).add(0.5).mul(mix(float(1 - T.occlusionGain), float(1), open)).toVar();
    // Band edges a pixel or so wide on screen, whatever the size.
    const aa = clamp(float(1.6).div(px), 0.008, 0.18).toVar();
    const shadeT = smoothstep(float(T.shadeBand).sub(aa), float(T.shadeBand).add(aa), value);
    const lightT = smoothstep(float(T.lightBand).sub(aa), float(T.lightBand).add(aa), value);
    const ndh = dot(Nrm, normalize(L.add(vec3(0, 0, 1))));
    const halfAa = aa.mul(0.35);
    const highlightT = smoothstep(float(T.highlight).sub(halfAa), float(T.highlight).add(halfAa), ndh).mul(step(0.0, ndl));

    const paper = vec3(I.uPaperColor);
    const lifted = mix(base, paper, mix(float(T.flatLift), float(T.hatchLift), hatch)).toVar();
    const shadeColor = mix(lifted, vec3(I.uShadeColor), mix(float(T.flatShade), float(T.hatchShade), hatch));
    const lightColor = mix(lifted, paper, T.lightLift);
    const highlightColor = mix(lifted, paper, T.highlightLift);
    const fill = mix(shadeColor, lifted, shadeT).toVar();
    fill.assign(mix(fill, lightColor, lightT));
    fill.assign(mix(fill, highlightColor, highlightT));
    if (s.emission) fill.addAssign((s.emission as N).mul(0.6));

    // One ink unit in device pixels, and this surface's outline.
    const unit = I.uInkPx.mul(I.uInkWeight).toVar();
    const line = unit.mul(s.lineWidth).toVar();
    const lineFade = smoothstep(1.4, 3.2, px.div(max(line, 0.5)));
    const outline = float(1).sub(smoothstep(line.sub(0.6), line.add(0.6), s.edgePx as N)).mul(lineFade).toVar();
    if (s.thinSolid) {
      const solid = float(1).sub(smoothstep(line.mul(T.bondSolidFrom), line.mul(T.bondSolidTo), px));
      outline.assign(max(outline, solid));
    }

    // Hatching: strokes in full-picture device pixels about the view axis.
    // |P[1][1]| × target height / 2 is the same in every tile of a capture.
    const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y).mul(screenSize.y).mul(0.5);
    const hit: N = (s.hit as N).toVar();
    const projected: N = select(s.isOrtho as N, hit.xy, hit.xy.div(max(hit.z.negate(), 1e-4)));
    const screen: N = projected.mul(pixelScale).toVar();
    const spacing = max(unit.mul(T.hatchSpacing), 2.0).toVar();
    const dark = float(1).sub(value).toVar();
    const single = strokes(
      screen.x.add(screen.y).mul(0.70710678),
      smoothstep(T.hatchSingle[0], T.hatchSingle[1], dark),
      spacing,
    );
    const cross = strokes(
      screen.x.sub(screen.y).mul(0.70710678),
      smoothstep(T.hatchCross[0], T.hatchCross[1], dark),
      spacing,
    );
    // No strokes on atoms too small to hold two of them.
    const hatchFade = smoothstep(spacing.mul(0.9), spacing.mul(2.2), px);
    const strokeInk = max(single, cross).mul(hatch).mul(hatchFade).mul(T.hatchInk);

    const ink = clamp(max(outline, strokeInk), 0.0, 1.0);
    return mix(fill, vec3(I.uInkColor), ink);
  }) as N)();
}
