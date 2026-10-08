/**
 * inkLook.ts — the Illustrate look on the ray-cast impostors: flat (cel),
 * hatched, engraved or halftone toon shading with ink outlines, or a chalk
 * drawing on the dark plate, the house ink drawing's voice (the home hero,
 * the /m pages and their cards, Lupi Daily) inside the 3D view.
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
 *   supersampled export draws them seamlessly across its tiles;
 * - engraving (`uInkEngrave`): a banknote line cut. Three line plates (the
 *   base, +72° in the shade, −38° in the deepest shade) whose lines swell
 *   with the shade until they merge, cut about each atom's centre (each
 *   bond's midpoint) and bowed over its form like a tilted globe's
 *   parallels, so every ball reads as an engraved ball. Adapted from Shaders
 *   (MIT), Engraving, packages/core/src/std/effects/stylize.ts (`hatchPlate`,
 *   `makeLineworkComposite`);
 * - halftone (`uInkHalftone`): ink dots on a 45° screen that grow with the
 *   shade over the lifted colour, a comic or riso print. Adapted from Shaders
 *   (MIT), Halftone, packages/core/src/gpu/kit/patternPaints.ts
 *   (`halftonePlateGrid`). Engraving and halftone use the same full-picture
 *   pixels as the hatching, so exports keep their weight and tile seamlessly;
 * - chalk (`uInkChalk`): a chalkboard drawing, light on dark. The element
 *   colour is a pastel rubbed over the board (the plate), thicker toward the
 *   light; three families of chalk strokes (±45° and level) come in as the
 *   light rises, value-noise dust breaks strokes and outlines, and the ink
 *   itself turns to chalk (`inkLookInkColor`, which the contour draws in
 *   too). Strokes and dust are laid out about each atom's centre (each
 *   bond's midpoint) in full-picture pixels, so they travel with the ball
 *   and tile seamlessly. Adapted from Shaders (MIT), Chalkboard,
 *   packages/core/src/std/effects/stylize.ts (`chalkSketch`) and
 *   packages/core/src/gpu/kit/stylizePaints.ts (`chalkHatchLine`,
 *   `chalkVnoise`, `chalkboardCompose`);
 * - each shading has its own weight, so a change between any two of them
 *   crossfades like lit ⇄ ink. Nothing in them reads time: a still view
 *   draws no frames;
 * - depth cue: the far side of the molecule fades toward the plate, as the
 *   drawings fade their back atoms (ink.ts opacity 0.42..1). The molecule's
 *   bounding sphere is a world-space uniform and its depth is taken through
 *   the rendering camera, so a capture's camera cues exactly as it draws.
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
import { Color, Vector2, Vector3 } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  acos,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  luminance,
  max,
  mix,
  mx_noise_float,
  normalize,
  screenSize,
  select,
  smoothstep,
  step,
  uniform,
  vec2,
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
  /** Chalk's ink: Shaders Chalkboard's chalk, a warm off-white. */
  chalk: '#eceadb',
  /** The board chalk draws on over a light plate (the sage plate); a dark plate is its own board. */
  board: '#101817',
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
  /** How far the far side of the molecule fades toward the plate, and where across its depth the fade starts. */
  depthCue: 0.4,
  depthCueFrom: 0.15,
  /** Engrave: fills lifted toward paper, and the shade band toward the shade tint. */
  engraveLift: 0.3,
  engraveShade: 0.1,
  /** Engrave: distance between the base plate's lines (the shade plates are 0.92× and 1.13× as dense, as in Shaders). */
  engraveSpacing: 4,
  /** Engrave: the base plate's line direction (degrees, view y up); the shade plates run at +72° and −38° to it. */
  engraveAngle: 8,
  /** Engrave: how far each plate's axis leans toward the viewer (degrees), bowing the lines over every ball and stick. */
  engraveTilt: 14,
  /** Engrave: tone contrast about mid-grey before cutting (Shaders `contrast`, 1.15 there). */
  engraveContrast: 1.6,
  /** Engrave: the lightest the tone reaches into the shade, so the darkest faces keep some colour between the lines. */
  engraveFloor: 0.12,
  /** Engrave: how far brightness shifts the lines, in 1.5-period steps (Shaders `relief`). */
  engraveRelief: 0.35,
  /** Engrave: the burin's meander, in spacings, and the noise wavelength it follows, in spacings (Shaders `waviness`). */
  engraveWobble: 0.7,
  engraveWobbleScale: 30,
  /** Engrave: ink opacity of the lines. */
  engraveInk: 0.92,
  /** Halftone: fills lifted toward paper, and the shade band toward the shade tint. */
  halftoneLift: 0.16,
  halftoneShade: 0.06,
  /** Halftone: the dot pitch, and the screen angle (degrees). */
  halftoneSpacing: 5.6,
  halftoneAngle: 45,
  /** Halftone: dots appear and reach their largest across this darkness (0..1). */
  halftoneDots: [0.28, 0.86] as const,
  /** Halftone: the largest dot's radius as a share of the pitch (0.5 touch, 0.71 solid). */
  halftoneMaxDot: 0.64,
  /** Halftone: ink opacity of the dots. */
  halftoneInk: 0.88,
  /** Chalk: how far the element colour lifts toward chalk for its pastel. */
  chalkPastel: 0.42,
  /** Chalk: how much pastel is rubbed over the board, from the shade band to the lit band. */
  chalkRub: [0.1, 0.42] as const,
  /** Chalk: distance between strokes, and the share of a period a stroke's soft core spans (Shaders 0.35). */
  chalkSpacing: 5,
  chalkLine: 0.35,
  /** Chalk: the light values at which the +45°, −45° and level families come in (Shaders' darkness gates 0.22, 0.5, 0.78, read from the light), each over ± the gate. */
  chalkFamilies: [0.3, 0.52, 0.76] as const,
  chalkGate: 0.05,
  /** Chalk: stroke opacity, and how far a stroke lifts from the pastel toward chalk white. */
  chalkStroke: 0.8,
  chalkStrokeLift: 0.4,
  /** Chalk: dust (Shaders `grain`) on strokes, half of it on outlines; noise cells per ink unit. */
  chalkGrain: 0.45,
  chalkDustScale: 0.55,
  /** Chalk: the rubbed pastel's smudge, its depth and its noise cells per ink unit. */
  chalkSmudge: 0.35,
  chalkSmudgeScale: 0.12,
  /** Chalk: the catchlight dab, toward chalk. */
  chalkHighlight: 0.9,
} as const;

type FloatUniform = UniformNode<'float', number>;

export interface InkLookUniforms {
  /** 0 = the lit Specimen surface, 1 = Illustrate. Live; every capture renders at the target. */
  uInkMix: FloatUniform;
  /** 0 = flat colour, 1 = hatched. */
  uInkHatch: FloatUniform;
  /** 0 = flat colour, 1 = engraved. */
  uInkEngrave: FloatUniform;
  /** 0 = flat colour, 1 = halftone dots. */
  uInkHalftone: FloatUniform;
  /** 0 = flat colour, 1 = chalk on the board. */
  uInkChalk: FloatUniform;
  /** Line weight multiplier (the store's ink weight). */
  uInkWeight: FloatUniform;
  /** Device (or capture texel) pixels per ink unit, recomputed per render. */
  uInkPx: FloatUniform;
  uInkColor: UniformNode<'color', Color>;
  uPaperColor: UniformNode<'color', Color>;
  uShadeColor: UniformNode<'color', Color>;
  /** Chalk's ink, its strokes' white and its catchlight. */
  uChalkColor: UniformNode<'color', Color>;
  /** The board chalk draws on over a light plate. */
  uBoardColor: UniformNode<'color', Color>;
  /** The plate the drawing sits on (the far side fades toward it). */
  uPlateColor: UniformNode<'color', Color>;
  /** The molecule's bounding sphere in world space (the depth cue's range); radius 0 turns the cue off. */
  uInkCenter: UniformNode<'vec3', Vector3>;
  uInkRadius: FloatUniform;
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
  uInkEngrave: f(0),
  uInkHalftone: f(0),
  uInkChalk: f(0),
  uInkWeight: f(1),
  uInkPx: (uniform(1) as unknown as N).onRenderUpdate((frame: FrameLike) => inkPixelsForFrame(frame)) as FloatUniform,
  uInkColor: uniform(new Color(INK_LOOK_COLORS.ink)) as unknown as UniformNode<'color', Color>,
  uPaperColor: uniform(new Color(INK_LOOK_COLORS.paper)) as unknown as UniformNode<'color', Color>,
  uShadeColor: uniform(new Color(INK_LOOK_COLORS.shade)) as unknown as UniformNode<'color', Color>,
  uChalkColor: uniform(new Color(INK_LOOK_COLORS.chalk)) as unknown as UniformNode<'color', Color>,
  uBoardColor: uniform(new Color(INK_LOOK_COLORS.board)) as unknown as UniformNode<'color', Color>,
  uPlateColor: uniform(new Color('#101817')) as unknown as UniformNode<'color', Color>,
  uInkCenter: uniform(new Vector3()) as unknown as UniformNode<'vec3', Vector3>,
  uInkRadius: f(0),
};

const I = INK_LOOK as unknown as Record<keyof InkLookUniforms, N>;

export interface InkLookTarget {
  /** 0 lit, 1 Illustrate. */
  mix: number;
  /** 0 flat, 1 hatched. */
  hatch: number;
  /** 0 flat, 1 engraved. */
  engrave: number;
  /** 0 flat, 1 halftone. */
  halftone: number;
  /** 0 flat, 1 chalk. */
  chalk: number;
  /** Line weight multiplier. */
  weight: number;
}

let target: InkLookTarget = { mix: 0, hatch: 0, engrave: 0, halftone: 0, chalk: 0, weight: 1 };

const unitWeight = (value: number | undefined) => (value !== undefined && value > 0 ? Math.min(1, value) : 0);

/** The configured look (what every capture renders), set by the viewer's ink driver. Absent shadings are 0. */
export function setInkLookTarget(next: Omit<InkLookTarget, 'engrave' | 'halftone' | 'chalk'> & Partial<InkLookTarget>): void {
  target = {
    mix: unitWeight(next.mix),
    hatch: unitWeight(next.hatch),
    engrave: unitWeight(next.engrave),
    halftone: unitWeight(next.halftone),
    chalk: unitWeight(next.chalk),
    weight: Number.isFinite(next.weight) && next.weight > 0 ? next.weight : 1,
  };
}

export function inkLookTarget(): InkLookTarget {
  return { ...target };
}

/** True while the live uniforms differ from the target (a fade is running). */
export function isInkLookFading(): boolean {
  return INK_LOOK.uInkMix.value !== target.mix
    || INK_LOOK.uInkHatch.value !== target.hatch
    || INK_LOOK.uInkEngrave.value !== target.engrave
    || INK_LOOK.uInkHalftone.value !== target.halftone
    || INK_LOOK.uInkChalk.value !== target.chalk;
}

/** The colour a drawing draws its lines in (the spec's `view.ink.ink`): chalk for Chalk, the house ink otherwise. */
export function inkLookInkHex(shading: string): string {
  return shading === 'chalk' ? INK_LOOK_COLORS.chalk : INK_LOOK_COLORS.ink;
}

// Every capture renders the configured look, never a fade in progress.
registerCaptureGuard({
  begin: () => {
    const saved = {
      mix: INK_LOOK.uInkMix.value,
      hatch: INK_LOOK.uInkHatch.value,
      engrave: INK_LOOK.uInkEngrave.value,
      halftone: INK_LOOK.uInkHalftone.value,
      chalk: INK_LOOK.uInkChalk.value,
      weight: INK_LOOK.uInkWeight.value,
    };
    INK_LOOK.uInkMix.value = target.mix;
    INK_LOOK.uInkHatch.value = target.hatch;
    INK_LOOK.uInkEngrave.value = target.engrave;
    INK_LOOK.uInkHalftone.value = target.halftone;
    INK_LOOK.uInkChalk.value = target.chalk;
    INK_LOOK.uInkWeight.value = target.weight;
    return () => {
      INK_LOOK.uInkMix.value = saved.mix;
      INK_LOOK.uInkHatch.value = saved.hatch;
      INK_LOOK.uInkEngrave.value = saved.engrave;
      INK_LOOK.uInkHalftone.value = saved.halftone;
      INK_LOOK.uInkChalk.value = saved.chalk;
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
  /**
   * The view-space point the engraving is cut about (an atom's centre, a
   * bond's midpoint), so its lines travel with the ball or stick. Absent:
   * the view axis.
   */
  center?: Node;
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
 * A view-space point in full-picture device pixels about the view axis.
 * |P[1][1]| × target height / 2 is the same in every tile of a capture, so
 * strokes and dots laid out in these pixels cross tile seams unbroken.
 */
function picturePixels(point: N, isOrtho: N): N {
  const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y).mul(screenSize.y).mul(0.5);
  const projected: N = select(isOrtho, point.xy, point.xy.div(max(point.z.negate(), 1e-4)));
  return projected.mul(pixelScale);
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * One line plate of the engraving (Shaders `hatchPlate`). The crests of a
 * cosine across the lines are inked, and the tone `level` (0 ink, 1 paper)
 * slides the threshold `mix(−1.15, 1.15, level)` across it, so a darker
 * tone cuts wider lines until they merge. Here the threshold becomes a line
 * width (acos), and both the line and the paper between lines are smoothed
 * over one device pixel through the coordinate's own slope (`slope`:
 * coordinate units per device pixel), so the cut stays crisp where lines
 * crowd toward a silhouette, on screen and in a supersampled export alike.
 */
function engravePlate(coord: N, slope: N, spacing: N, shift: N, level: N): N {
  const threshold = mix(float(-1.15), float(1.15), clamp(level, 0.0, 1.0));
  // Half the inked share of a period: 0 none, 0.5 solid.
  const half = acos(clamp(threshold, -1.0, 1.0)).div(TAU).toVar();
  const fromCrest = abs(fract(coord.div(spacing).add(shift).add(0.5)).sub(0.5)).toVar();
  const period = spacing.div(max(slope, 1e-3)).toVar();
  const linePx = half.mul(period);
  const gapPx = float(0.5).sub(half).mul(period);
  // A line (or a gap) thinner than a pixel fades by its width.
  const line = clamp(linePx.mul(2.0), 0.0, 1.0)
    .mul(float(1).sub(smoothstep(linePx.sub(0.5), linePx.add(0.5), fromCrest.mul(period))));
  const gap = clamp(gapPx.mul(2.0), 0.0, 1.0)
    .mul(float(1).sub(smoothstep(gapPx.sub(0.5), gapPx.add(0.5), float(0.5).sub(fromCrest).mul(period))));
  return select(half.lessThan(0.25), line, float(1).sub(gap));
}

/**
 * A plate's axis: square to its lines (which run `angle` degrees from view
 * x), leaning `INK_LOOK_TUNING.engraveTilt` toward the viewer. Its lines are
 * the parallels of a globe about that axis, bowed over every ball.
 */
function engraveAxis(angle: number): [number, number, number] {
  const tilt = INK_LOOK_TUNING.engraveTilt * DEG;
  return [-Math.sin(angle * DEG) * Math.cos(tilt), Math.cos(angle * DEG) * Math.cos(tilt), Math.sin(tilt)];
}

/**
 * One family of chalk strokes (Shaders `chalkHatchLine`): a triangle wave
 * across lines `spacing` device pixels apart, 0 midway between them, whose
 * soft core spans `T.chalkLine` of a period (at least about a pixel either
 * side, so a dense family never shimmers).
 */
function chalkStrokes(coord: N, spacing: N): N {
  const across = abs(fract(coord.div(spacing)).sub(0.5)).mul(2.0);
  const core = max(float(INK_LOOK_TUNING.chalkLine), float(2.0).div(spacing));
  return float(1).sub(smoothstep(0.0, core, across));
}

/** A hash of a lattice cell, 0..1 (Hoskins' hash without sine: float only, any sign). */
function chalkHash(cell: N): N {
  const p3: N = fract(vec3(cell.x, cell.y, cell.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}

/** Smooth value noise, 0..1 (Shaders `chalkVnoise`): the chalk's dust and smudge. */
function chalkNoise(at: N): N {
  const cell: N = floor(at).toVar();
  const t: N = fract(at).toVar();
  const u: N = t.mul(t).mul(t.mul(-2.0).add(3.0)).toVar();
  const a = chalkHash(cell);
  const b = chalkHash(cell.add(vec2(1.0, 0.0)));
  const c = chalkHash(cell.add(vec2(0.0, 1.0)));
  const d = chalkHash(cell.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/**
 * The drawing's ink (linear): the house ink, or chalk under the Chalk
 * drawing, mixed by its weight so the outlines crossfade with the drawing.
 * The impostors' outlines and the screen-space contour (ui
 * postprocess/inkContour.ts) both draw in it, live and in every capture.
 */
export function inkLookInkColor(): Node {
  return mix(vec3(I.uInkColor), vec3(I.uChalkColor), clamp(I.uInkChalk, 0.0, 1.0));
}

/**
 * The Illustrate surface (linear RGB): toon fill, hatching, engraving,
 * halftone dots or chalk, and ink. View space with V = +z, like `lupiSurface`; the
 * key light's direction is the light uniforms', so the bands follow the
 * Light controls.
 */
export function lupiInkSurface(s: LupiInkInput, lights: LupiLightUniforms): Node {
  return (Fn(() => {
    const T = INK_LOOK_TUNING;
    const Nrm = (s.normal as N).toVar();
    const base = (s.baseColor as N).toVar();
    const hatch = clamp(I.uInkHatch, 0.0, 1.0).toVar();
    const engrave = clamp(I.uInkEngrave, 0.0, 1.0).toVar();
    const halftone = clamp(I.uInkHalftone, 0.0, 1.0).toVar();
    const chalk = clamp(I.uInkChalk, 0.0, 1.0).toVar();
    // A tuning value per shading, weighted by the shadings' shares (they sum
    // to at most 1 through any crossfade; the rest is flat colour).
    const byShading = (flat: number, hatched: number, engraved: number, dotted: number): N =>
      mix(float(flat), float(hatched), hatch).add(engrave.mul(engraved - flat)).add(halftone.mul(dotted - flat));
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
    const lifted = mix(base, paper, byShading(T.flatLift, T.hatchLift, T.engraveLift, T.halftoneLift)).toVar();
    const shadeColor = mix(lifted, vec3(I.uShadeColor), byShading(T.flatShade, T.hatchShade, T.engraveShade, T.halftoneShade));
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
    // A uniform branch: flat colour never pays for the strokes.
    const hit: N = (s.hit as N).toVar();
    const strokeInk = float(0).toVar();
    If(hatch.greaterThan(0.0), () => {
      const screen: N = picturePixels(hit, s.isOrtho).toVar();
      const spacing = max(unit.mul(T.hatchSpacing), 2.0).toVar();
      const dark = float(1).sub(value).toVar();
      // A right hand's hatching: single strokes run "/" (view y is up), the
      // cross strokes "\\" over them in the deepest shade.
      const single = strokes(
        screen.x.sub(screen.y).mul(0.70710678),
        smoothstep(T.hatchSingle[0], T.hatchSingle[1], dark),
        spacing,
      );
      const cross = strokes(
        screen.x.add(screen.y).mul(0.70710678),
        smoothstep(T.hatchCross[0], T.hatchCross[1], dark),
        spacing,
      );
      // No strokes on atoms too small to hold two of them.
      const hatchFade = smoothstep(spacing.mul(0.9), spacing.mul(2.2), px);
      strokeInk.assign(max(single, cross).mul(hatch).mul(hatchFade).mul(T.hatchInk));
    });

    // Engraving: three line plates cut about the atom's centre (the bond's
    // midpoint) in full-picture device pixels, each bowed over the form by
    // its axis leaning toward the viewer, so the lines travel with the ball
    // as the molecule turns. A uniform branch, like the hatching.
    If(engrave.greaterThan(0.0), () => {
      const screen: N = picturePixels(hit, s.isOrtho).toVar();
      const anchor: N = s.center ? picturePixels(s.center as N, s.isOrtho) : vec2(0.0, 0.0);
      const eye: N = select(s.isOrtho as N, vec3(0.0, 0.0, 1.0), normalize(hit.negate()));
      const facing = max(dot(Nrm, eye), 0.0).toVar();
      const spacing = max(unit.mul(T.engraveSpacing), 2.0).toVar();
      // The burin's meander (Shaders' domain warp): two decorrelated Perlin channels.
      const wobbleAt: N = screen.div(spacing.mul(T.engraveWobbleScale)).toVar();
      const wobble = vec2(mx_noise_float(wobbleAt), mx_noise_float(wobbleAt.add(vec2(7.31, 3.77))));
      const offset: N = screen.sub(anchor).add(wobble.mul(spacing.mul(T.engraveWobble))).toVar();
      const bulge = px.mul(facing).toVar();
      // How the bulge steepens the coordinate toward the silhouette (per pixel).
      const lean: N = Nrm.xy.div(max(facing, 0.08)).toVar();
      // Tone (0 ink, 1 paper): the light value through Shaders' contrast
      // curve, never darker than the floor; brightness shifts the lines.
      const tone = clamp(value.sub(0.5).mul(T.engraveContrast).add(0.5), 0.0, 1.0);
      const level = mix(float(T.engraveFloor), float(1), tone).toVar();
      const shift = level.mul(T.engraveRelief * 1.5).toVar();
      const plate = (angle: number, density: number, relief: number, reach: number): N => {
        const [ax, ay, az] = engraveAxis(angle);
        const across = vec2(ax, ay);
        const coord = dot(offset, across).add(bulge.mul(az));
        const slope = length(across.sub(lean.mul(az)));
        return engravePlate(coord, slope, spacing.div(density), shift.mul(relief), level.div(reach));
      };
      // The base plate, a +72° plate in the shade and a −38° plate in the
      // deepest shade, each a little denser or sparser (Shaders' cross-hatch).
      const lines = max(
        plate(T.engraveAngle, 1, 1, 1),
        max(plate(T.engraveAngle + 72, 0.92, 0.7, 0.55), plate(T.engraveAngle - 38, 1.13, 0.5, 0.28)),
      );
      // No lines on atoms too small to hold two of them.
      const engraveFade = smoothstep(spacing.mul(0.9), spacing.mul(2.2), px);
      strokeInk.assign(max(strokeInk, lines.mul(engrave).mul(engraveFade).mul(T.engraveInk)));
    });

    // Halftone: ink dots on a rotated screen in full-picture device pixels,
    // growing with the shade over the lifted colour (Shaders' dot plate).
    If(halftone.greaterThan(0.0), () => {
      const screen: N = picturePixels(hit, s.isOrtho).toVar();
      const pitch = max(unit.mul(T.halftoneSpacing), 3.0).toVar();
      const c = Math.cos(T.halftoneAngle * DEG);
      const sn = Math.sin(T.halftoneAngle * DEG);
      const grid = vec2(dot(screen, vec2(c, -sn)), dot(screen, vec2(sn, c)));
      const fromCentre = length(fract(grid.div(pitch)).sub(0.5)).mul(pitch);
      const dark = float(1).sub(value);
      const radius = smoothstep(T.halftoneDots[0], T.halftoneDots[1], dark).mul(pitch.mul(T.halftoneMaxDot)).toVar();
      // A dot smaller than a pixel fades rather than flickering.
      const dots = float(1).sub(smoothstep(radius.sub(0.5), radius.add(0.5), fromCentre)).mul(smoothstep(0.2, 0.9, radius));
      // No dots on atoms too small to hold two of them.
      const halftoneFade = smoothstep(pitch.mul(0.9), pitch.mul(2.2), px);
      strokeInk.assign(max(strokeInk, dots.mul(halftone).mul(halftoneFade).mul(T.halftoneInk)));
    });

    // Chalk: a pastel of the element colour rubbed over the board, thicker
    // toward the light, then three families of chalk strokes coming in as
    // the light rises (Shaders' Chalkboard, read from the light: the lit
    // side carries the most chalk, the shade shows the board). Laid out
    // about the atom's centre (the bond's midpoint) in full-picture device
    // pixels, so strokes and dust travel with the ball. A uniform branch.
    const outlineDust = float(1).toVar();
    If(chalk.greaterThan(0.0), () => {
      const screen: N = picturePixels(hit, s.isOrtho).toVar();
      const anchor: N = s.center ? picturePixels(s.center as N, s.isOrtho) : vec2(0.0, 0.0);
      const offset: N = screen.sub(anchor).toVar();
      // In ink units, so the dust has the same grain on screen and in an export.
      const inUnits: N = offset.div(max(unit, 1e-3)).toVar();
      const chalkWhite = vec3(I.uChalkColor);
      // A light plate gets a board of its own: chalk needs the dark.
      const plate = vec3(I.uPlateColor);
      const board = mix(plate, vec3(I.uBoardColor), smoothstep(0.12, 0.4, luminance(plate)));
      const pastel = mix(base, chalkWhite, T.chalkPastel).toVar();
      const smudge = mix(float(1 - T.chalkSmudge), float(1), chalkNoise(inUnits.mul(T.chalkSmudgeScale)));
      const rub = mix(float(T.chalkRub[0]), float(T.chalkRub[1]), smoothstep(float(T.shadeBand), float(T.lightBand), value)).mul(smudge);
      const chalked = mix(board, pastel, rub).toVar();
      const spacing = max(unit.mul(T.chalkSpacing), 2.5).toVar();
      const gate = (from: number): N => smoothstep(float(from - T.chalkGate), float(from + T.chalkGate), value);
      const diagonal = 0.70710678;
      const families = max(
        max(
          chalkStrokes(offset.x.add(offset.y).mul(diagonal), spacing).mul(gate(T.chalkFamilies[0])),
          chalkStrokes(offset.y.sub(offset.x).mul(diagonal), spacing).mul(gate(T.chalkFamilies[1])),
        ),
        chalkStrokes(offset.y, spacing).mul(gate(T.chalkFamilies[2])),
      );
      // Dust (Shaders' grain) breaks the strokes, and half as much the outline.
      const grain = chalkNoise(inUnits.mul(T.chalkDustScale)).toVar();
      const dust = mix(float(1 - T.chalkGrain), float(1), grain);
      outlineDust.assign(mix(float(1 - T.chalkGrain * 0.5), float(1), grain));
      // No strokes on atoms too small to hold two of them.
      const chalkFade = smoothstep(spacing.mul(0.9), spacing.mul(2.2), px);
      const strokeColor = mix(pastel, chalkWhite, T.chalkStrokeLift);
      chalked.assign(mix(chalked, strokeColor, families.mul(dust).mul(chalkFade).mul(T.chalkStroke)));
      chalked.assign(mix(chalked, chalkWhite, highlightT.mul(dust).mul(T.chalkHighlight)));
      if (s.emission) chalked.addAssign((s.emission as N).mul(0.6));
      fill.assign(mix(fill, chalked, chalk));
    });

    const ink = clamp(max(outline, strokeInk), 0.0, 1.0).mul(mix(float(1), outlineDust, chalk));
    const drawn = mix(fill, inkLookInkColor() as N, ink);

    // Depth cue: 0 at the front of the bounding sphere, 1 at its back, seen
    // through the camera rendering now (view space looks down −z).
    const radius = I.uInkRadius.toVar();
    const centreDepth = (cameraViewMatrix as N).mul(vec4(I.uInkCenter, 1.0)).z.negate();
    const across = hit.z.negate().sub(centreDepth.sub(radius)).div(max(radius.mul(2.0), 1e-3));
    const cue = smoothstep(T.depthCueFrom, 1.0, clamp(across, 0.0, 1.0)).mul(T.depthCue).mul(step(1e-3, radius));
    return mix(drawn, vec3(I.uPlateColor), cue);
  }) as N)();
}
