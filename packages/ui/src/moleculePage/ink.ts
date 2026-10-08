/**
 * ink.ts — the Lupi ink drawing of any small molecule, as numbers.
 *
 * The home hero's buckyball (landing/hero/buckyStage.ts), generalised and
 * drawn in the viewer's Illustrate look (scene/src/tsl/inkLook.ts, flat): each
 * atom a toon ball in its CPK colour, lifted toward paper, in three hard
 * bands from the viewer's world-fixed key light (shade, colour, lit) with a
 * cel catchlight and an ink outline; each bond a toon stick, the same bands
 * across it, ink along both edges and a colour per half; the back fading
 * toward the plate. All of it projected from a camera at (azimuth,
 * elevation) about world +Y, orthographic or from the viewer's camera
 * distance (the relay), and painted back to front. The camera convention is
 * the viewer's, so a pose read off the drawing opens the 3D view at the same
 * angle, and the 3D view's first ink frame is the same picture.
 *
 * `INK_DRAWING_STYLE = 'lit'` brings back the older drawing: CPK balls shaded
 * by one radial gradient per element, plate-coloured rims and grey ink bonds.
 *
 * Pure: no DOM, no three, no imports. The /m page's stage (inkStage.ts)
 * mutates SVG nodes from an InkLayout; the build-time page and card generator
 * (scripts/molecule-pages) prints the same layout as an SVG string, so the
 * static first paint, the share card and the spinnable drawing agree.
 */

/** A face-on or principal view on the turntable, from Object Facts. */
export interface InkDetent {
  /** Camera azimuth about world +Y (rad). */
  azimuth: number;
  /** The view's own elevation (rad): a detent is exactly face-on. */
  elevation: number;
  label: string;
}

export interface InkPose {
  azimuth: number;
  elevation: number;
}

/** One element present in the molecule. */
export interface InkKind {
  /** Element symbol. */
  s: string;
  /** CPK colour, #rrggbb. */
  c: string;
  /** Drawn atom radius (Å). */
  r: number;
}

/** Everything the drawing needs; embedded as JSON in each /m page. */
export interface InkModel {
  /** x, y, z per atom (Å), centred on the bounds centre (the viewer's fit target). */
  p: number[];
  /** Per atom: index into `kinds`. */
  k: number[];
  kinds: InkKind[];
  /** Bonded atom index pairs, flat. */
  b: number[];
  /**
   * Bond kind per pair in `b` (BondKindCode: 0 covalent, 1 metal coordination,
   * 2 ionic contact). Absent means every pair is a covalent stick.
   */
  bk?: number[];
  /** Largest distance from the centre to an atom's drawn surface (Å). */
  radius: number;
  /** Turntable detents, ascending azimuth; may be empty. */
  detents: InkDetent[];
  /** The pose the page, the card and the static drawing open on. */
  opening: InkPose;
}

/** viewBox units; the SVG scales to its box. */
export const INK_VIEW = 200;
const CENTER = INK_VIEW / 2;
/** Share of the box the molecule's widest turn fills. */
const FILL = 0.88;
/** Bond width (Å). */
const BOND_W = 0.14;
/** Bonds sort just behind atoms at the same depth, so every bond tucks under its atoms. */
const BOND_DEPTH_BIAS = 0.35;
export const INK_PLATE = '#101817';
export const INK_BOND = '#a3aaa6';
/** Stroke width and dashes per bond kind: the viewer's BOND_KIND_RADIUS_SCALE, dashed coordination, dotted contacts. */
const KIND_WIDTH = [1, 0.6, 0.45];
const KIND_DASH = [null, '4 3', '1 3'];
const HIGHLIGHT = '#f3f5ef';
const SHADE = '#1a2321';

export type InkDrawingStyle = 'toon' | 'lit';
/**
 * The drawing's style everywhere (pages, cards, tiles, the relay, the
 * Daily's named drawing): 'toon', the viewer's Illustrate look, or 'lit',
 * the older gradient balls.
 */
export const INK_DRAWING_STYLE: InkDrawingStyle = 'toon';

/**
 * The Illustrate look the toon drawing follows (flat colour): the bands,
 * fills, line widths (ink units) and depth cue of INK_LOOK_TUNING and the
 * palette of INK_LOOK_COLORS in packages/scene/src/tsl/inkLook.ts.
 * ink.test.ts keeps them equal.
 */
export const INK_TOON = {
  shadeBand: 0.36,
  lightBand: 0.74,
  highlight: 0.968,
  flatLift: 0.08,
  flatShade: 0.46,
  lightLift: 0.26,
  highlightLift: 0.82,
  occlusionGain: 0.55,
  atomLine: 1.5,
  bondLine: 1.15,
  bondSolidFrom: 1.1,
  bondSolidTo: 2.1,
  depthCue: 0.4,
  depthCueFrom: 0.15,
  ink: '#0c1211',
  paper: HIGHLIGHT,
  shade: SHADE,
} as const;
/**
 * viewBox units per ink unit. An ink unit is a CSS pixel on a 900 px
 * picture (0.85 of one below about 765 px), and the relay draws the 200-unit
 * box at about 0.8 of the window's short side, so an ink unit there is 0.3
 * to 0.35 viewBox units: the outline hands over at the 3D view's weight.
 */
const INK_UNIT = 0.32;
/** The viewer's stick radius (Å): scene/src/Bonds.tsx `radius`. */
const STICK_R = 0.12;

/** The viewer's key light, lightDirection(40, 45): world-fixed. */
const KEY_LIGHT = (() => {
  const az = (40 * Math.PI) / 180;
  const el = (45 * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)] as const;
})();

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0);
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** Radial-gradient stops (offset, colour) for one element: a lit ball in its CPK colour. */
export function inkGradientStops(color: string): Array<[string, string]> {
  return [
    ['0', mixHex(color, HIGHLIGHT, 0.85)],
    ['0.2', mixHex(color, HIGHLIGHT, 0.42)],
    ['0.58', color],
    ['1', mixHex(color, SHADE, 0.62)],
  ];
}

/** The unit view direction normalize(camera − target) for a pose. */
export function inkViewDir(pose: InkPose): [number, number, number] {
  const c = Math.cos(pose.elevation);
  return [c * Math.sin(pose.azimuth), Math.sin(pose.elevation), c * Math.cos(pose.azimuth)];
}

/**
 * Screen positions for one pose, in viewBox units. Allocated once per model;
 * `update` reuses every array, so a spinning drawing allocates nothing.
 */
export class InkLayout {
  readonly atomCount: number;
  readonly bondCount: number;
  readonly itemCount: number;
  /** viewBox units per Å (at the centre plane, in perspective). */
  readonly scale: number;
  readonly bondWidth: number;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly r: Float64Array;
  readonly opacity: Float64Array;
  /** View-space position per atom (Å; x right, y up, z toward the camera). */
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  /** Perspective magnification per atom (1 orthographic). */
  readonly k: Float64Array;
  readonly x1: Float64Array;
  readonly y1: Float64Array;
  readonly x2: Float64Array;
  readonly y2: Float64Array;
  readonly bondOpacity: Float64Array;
  /** Item indices back to front: below atomCount an atom, else bond (index − atomCount). */
  readonly order: number[];
  /** The gradients' focus (0..1): the highlight slides as the molecule turns under the light. */
  lightX = 0.4;
  lightY = 0.35;
  /** The key light in view space (unit). */
  readonly light: [number, number, number] = [0, 0, 1];
  /** Camera distance (Å) for a perspective drawing; 0 orthographic. */
  perspective = 0;

  private readonly depth: Float64Array;
  private readonly byDepth: (a: number, b: number) => number;

  constructor(
    readonly model: InkModel,
    opts: { fill?: number } = {},
  ) {
    this.atomCount = model.k.length;
    this.bondCount = model.b.length / 2;
    this.itemCount = this.atomCount + this.bondCount;
    this.scale = (CENTER * (opts.fill ?? FILL)) / Math.max(0.5, model.radius);
    this.bondWidth = BOND_W * this.scale;
    this.cx = new Float64Array(this.atomCount);
    this.cy = new Float64Array(this.atomCount);
    this.r = new Float64Array(this.atomCount);
    this.opacity = new Float64Array(this.atomCount);
    this.vx = new Float64Array(this.atomCount);
    this.vy = new Float64Array(this.atomCount);
    this.vz = new Float64Array(this.atomCount);
    this.k = new Float64Array(this.atomCount).fill(1);
    this.x1 = new Float64Array(this.bondCount);
    this.y1 = new Float64Array(this.bondCount);
    this.x2 = new Float64Array(this.bondCount);
    this.y2 = new Float64Array(this.bondCount);
    this.bondOpacity = new Float64Array(this.bondCount);
    this.depth = new Float64Array(this.itemCount);
    this.order = Array.from({ length: this.itemCount }, (_, i) => i);
    const depth = this.depth;
    this.byDepth = (a, b) => depth[a] - depth[b];
  }

  /**
   * Draw in perspective from `distance` Å (the viewer's fitted camera
   * distance: the relay hands the drawing over to the 3D view in its shape),
   * or orthographic (null, the default). Takes effect on the next update.
   */
  setPerspective(distance: number | null): void {
    this.perspective = distance && distance > 0 ? distance : 0;
  }

  /** Screen x, y (viewBox units) and the magnification of a view-space point (Å). */
  project(x: number, y: number, z: number, out: [number, number, number]): [number, number, number] {
    const d = this.perspective;
    const k = d > 0 ? d / Math.max(1e-3, d - z) : 1;
    out[0] = CENTER + this.scale * k * x;
    out[1] = CENTER - this.scale * k * y;
    out[2] = k;
    return out;
  }

  update(pose: InkPose): void {
    const { model, scale } = this;
    const positions = model.p;
    const sa = Math.sin(pose.azimuth);
    const ca = Math.cos(pose.azimuth);
    const se = Math.sin(pose.elevation);
    const ce = Math.cos(pose.elevation);
    // The camera basis of lookAt(viewDir, up +Y): right (x), up (y), and viewDir (z, toward the camera).
    const xx = ca;
    const xz = -sa;
    const yx = -se * sa;
    const yy = ce;
    const yz = -se * ca;
    const zx = ce * sa;
    const zy = se;
    const zz = ce * ca;
    const span = Math.max(1e-6, 2 * model.radius);
    const d = this.perspective;
    for (let i = 0; i < this.atomCount; i += 1) {
      const px = positions[3 * i];
      const py = positions[3 * i + 1];
      const pz = positions[3 * i + 2];
      const x = px * xx + pz * xz;
      const y = px * yx + py * yy + pz * yz;
      const z = px * zx + py * zy + pz * zz;
      this.vx[i] = x;
      this.vy[i] = y;
      this.vz[i] = z;
      this.depth[i] = z;
      const k = d > 0 ? d / Math.max(1e-3, d - z) : 1;
      this.k[i] = k;
      this.cx[i] = CENTER + scale * k * x;
      this.cy[i] = CENTER - scale * k * y;
      const near = Math.min(1, Math.max(0, (z + model.radius) / span)); // 0 at the back, 1 at the front
      // Orthographic drawings swell the front a little; in perspective the camera does.
      this.r[i] = scale * model.kinds[model.k[i]].r * (d > 0 ? k : 0.9 + 0.16 * near);
      this.opacity[i] = 0.42 + 0.58 * near;
    }
    const bonds = model.b;
    for (let b = 0; b < this.bondCount; b += 1) {
      const i = bonds[2 * b];
      const j = bonds[2 * b + 1];
      const mid = (this.vz[i] + this.vz[j]) / 2;
      this.depth[this.atomCount + b] = mid - BOND_DEPTH_BIAS;
      this.x1[b] = this.cx[i];
      this.y1[b] = this.cy[i];
      this.x2[b] = this.cx[j];
      this.y2[b] = this.cy[j];
      this.bondOpacity[b] = 0.2 + 0.68 * Math.min(1, Math.max(0, (mid + model.radius) / span));
    }
    // The key light in view space, and on screen for the gradients.
    const lx = KEY_LIGHT[0] * xx + KEY_LIGHT[2] * xz;
    const ly = KEY_LIGHT[0] * yx + KEY_LIGHT[1] * yy + KEY_LIGHT[2] * yz;
    this.light[0] = lx;
    this.light[1] = ly;
    this.light[2] = KEY_LIGHT[0] * zx + KEY_LIGHT[1] * zy + KEY_LIGHT[2] * zz;
    this.lightX = 0.5 + 0.3 * lx;
    this.lightY = 0.5 - 0.3 * ly;
    this.order.sort(this.byDepth);
  }
}

const fmt = (value: number) => {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** A toon coordinate: a tenth of a unit, under a pixel at any size the drawing is shown (sizes keep fmt's hundredths). */
const at = (value: number) => {
  const rounded = Number(value.toFixed(1));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── The toon drawing ────────────────────────────────────────────────

type Linear = [number, number, number];

function linearOf(hex: string): Linear {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(16), channel(8), channel(0)];
}

function hexOf(color: Linear): string {
  let value = 0;
  for (const linear of color) {
    const c = Math.min(1, Math.max(0, linear));
    const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    value = (value << 8) | Math.round(encoded * 255);
  }
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** Mixed in linear light, as the shaders mix. */
function mixLinear(a: Linear, b: Linear, t: number): Linear {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** One element's toon fills (linear light). */
export interface InkToonFills {
  shade: Linear;
  color: Linear;
  light: Linear;
  highlight: Linear;
}

/**
 * The fills as `lupiInkSurface` mixes them: the CPK colour lifted toward
 * paper, the shade band toward the shade tint, the lit band and the
 * catchlight toward paper.
 */
export function inkToonFills(color: string): InkToonFills {
  const T = INK_TOON;
  const paper = linearOf(T.paper);
  const lifted = mixLinear(linearOf(color), paper, T.flatLift);
  return {
    shade: mixLinear(lifted, linearOf(T.shade), T.flatShade),
    color: lifted,
    light: mixLinear(lifted, paper, T.lightLift),
    highlight: mixLinear(lifted, paper, T.highlightLift),
  };
}

/**
 * How open a drawn face is (1 open, 0 buried): the drawing's stand-in for the
 * viewer's baked contact occlusion, which shades a ball-and-stick atom a
 * little where its neighbours and bond stubs sit. Measured offline against
 * the 3D view's Illustrate frames of C60 and caffeine, 0.8 came a little
 * closer than 1 (a smaller lit band); 1 keeps the drawing's bands where the
 * light alone puts them.
 */
const TOON_OPEN = 1;

/** The N·L where the half-Lambert light value, pulled down by the occlusion as the shaders pull it, crosses `band`. */
const bandDot = (band: number) => (2 * band) / (1 - INK_TOON.occlusionGain * (1 - TOON_OPEN)) - 1;

/** SVG arc flags for the arc from a to b through `via`, on a conic centred at c. */
function arcFlags(ax: number, ay: number, viaX: number, viaY: number, bx: number, by: number, cx: number, cy: number): string {
  const chordX = bx - ax;
  const chordY = by - ay;
  const sideVia = chordX * (viaY - ay) - chordY * (viaX - ax);
  const sideCentre = chordX * (cy - ay) - chordY * (cx - ax);
  // The longer arc passes the centre's side of the chord; sweep 1 turns from +x toward +y (y down).
  const large = sideVia * sideCentre > 0 ? 1 : 0;
  const sweep = (viaX - ax) * (by - ay) - (viaY - ay) * (bx - ax) > 0 ? 1 : 0;
  return `${large} ${sweep}`;
}

/** inkCapPath: the whole visible face. */
export const INK_CAP_FULL = 'full';

/**
 * Where N·dir > c on a ball's visible face, as SVG path data: '' for none,
 * INK_CAP_FULL for the whole disc. `dir` is a unit view-space direction
 * (y up, z toward the camera); the ball is a disc at (x, y) of `radius` in
 * SVG units (y down). The edge of a band is a circle on the sphere, which
 * projects to an ellipse (orthographic); where it runs over the silhouette,
 * its front arc and the silhouette on the light's side bound the band.
 */
export function inkCapPath(x: number, y: number, radius: number, dir: readonly number[], c: number): string {
  if (c >= 1 || !(radius > 0)) return '';
  if (c <= -1) return INK_CAP_FULL;
  let lx = dir[0];
  let ly = dir[1];
  const lz = dir[2];
  let s = Math.hypot(lx, ly);
  if (s < 1e-4) {
    // Along the view axis: any screen direction will do.
    lx = 1e-4;
    ly = 0;
    s = 1e-4;
  }
  const ux = lx / s;
  const uy = ly / s;
  const rc = Math.sqrt(1 - c * c);
  // A point of the unit disc (a along u, b along v = u turned +90°), in SVG units.
  const sx = (a: number, b: number) => x + radius * (a * ux - b * uy);
  const sy = (a: number, b: number) => y - radius * (a * uy + b * ux);
  // The edge's ellipse: centred c·s along u, semi-axes rc·|lz| along u and rc along v.
  const rx = fmt(radius * rc * Math.abs(lz));
  const ry = fmt(radius * rc);
  const rot = at((Math.atan2(-uy, ux) * 180) / Math.PI);
  if (Math.abs(c) < s) {
    // The edge meets the silhouette at u = c / s.
    const t = c / s;
    const w = Math.sqrt(1 - t * t);
    const ax = sx(t, w);
    const ay = sy(t, w);
    const bx = sx(t, -w);
    const by = sy(t, -w);
    // The ellipse's front arc passes its point on the far side; the silhouette's, the light's side.
    const front = c * s - rc * lz;
    const ellipse = arcFlags(ax, ay, sx(front, 0), sy(front, 0), bx, by, sx(c * s, 0), sy(c * s, 0));
    const rim = arcFlags(bx, by, sx(1, 0), sy(1, 0), ax, ay, x, y);
    const R = fmt(radius);
    return `M${at(ax)} ${at(ay)}A${rx} ${ry} ${rot} ${ellipse} ${at(bx)} ${at(by)}A${R} ${R} 0 ${rim} ${at(ax)} ${at(ay)}Z`;
  }
  if (c * lz <= 0) return lz > c ? INK_CAP_FULL : '';
  // The whole edge is in front: inside the ellipse when the light faces the camera, else around it.
  const ellipse = (sweep: number) => {
    const top = `${at(sx(c * s, rc))} ${at(sy(c * s, rc))}`;
    const bottom = `${at(sx(c * s, -rc))} ${at(sy(c * s, -rc))}`;
    return `M${top}A${rx} ${ry} ${rot} 0 ${sweep} ${bottom}A${rx} ${ry} ${rot} 0 ${sweep} ${top}Z`;
  };
  if (lz > 0) return ellipse(1);
  const R = fmt(radius);
  const right = `${at(x + radius)} ${at(y)}`;
  const left = `${at(x - radius)} ${at(y)}`;
  // The disc one way round and the ellipse the other: a hole under the nonzero rule.
  return `M${right}A${R} ${R} 0 0 1 ${left}A${R} ${R} 0 0 1 ${right}Z${ellipse(0)}`;
}

/**
 * Where N·dir > c across a stick, as spans of w = sin φ (−1..1 across its
 * width): φ turns the normal from the one facing the camera (`e` = that
 * normal · dir) toward the side normal (`q` = side · dir). At most two
 * spans (a light from behind lights both edges).
 */
export function inkBandSpans(e: number, q: number, c: number): Array<[number, number]> {
  const reach = Math.hypot(e, q);
  if (reach < 1e-9) return c < 0 ? [[-1, 1]] : [];
  const ratio = c / reach;
  if (ratio >= 1) return [];
  if (ratio <= -1) return [[-1, 1]];
  const alpha = Math.acos(ratio);
  const centre = Math.atan2(q, e);
  const spans: Array<[number, number]> = [];
  for (const turn of [-2 * Math.PI, 0, 2 * Math.PI]) {
    const from = Math.max(-Math.PI / 2, centre + turn - alpha);
    const to = Math.min(Math.PI / 2, centre + turn + alpha);
    if (to > from) spans.push([Math.sin(from), Math.sin(to)]);
  }
  return spans;
}

/** One SVG shape of the toon drawing (viewBox units). */
export type InkShape =
  | { tag: 'circle'; cx: number; cy: number; r: number; fill: string; stroke?: string; width?: number; strokeOpacity?: number }
  | { tag: 'path'; d: string; fill: string }
  | {
    tag: 'line';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: string;
    width: number;
    round?: boolean;
    dash?: string;
    dashOffset?: number;
  };

/** A shape's attributes, in the order they are written. */
export function inkShapeAttrs(shape: InkShape): Array<[string, string]> {
  if (shape.tag === 'circle') {
    const attrs: Array<[string, string]> = [['cx', at(shape.cx)], ['cy', at(shape.cy)], ['r', fmt(shape.r)], ['fill', shape.fill]];
    if (shape.stroke) {
      attrs.push(['stroke', shape.stroke], ['stroke-width', fmt(shape.width ?? 1)]);
      if (shape.strokeOpacity !== undefined && shape.strokeOpacity < 0.995) attrs.push(['stroke-opacity', fmt(shape.strokeOpacity)]);
    }
    return attrs;
  }
  if (shape.tag === 'path') return [['d', shape.d], ['fill', shape.fill]];
  const attrs: Array<[string, string]> = [
    ['x1', at(shape.x1)],
    ['y1', at(shape.y1)],
    ['x2', at(shape.x2)],
    ['y2', at(shape.y2)],
    ['stroke', shape.stroke],
    ['stroke-width', fmt(shape.width)],
  ];
  if (shape.round) attrs.push(['stroke-linecap', 'round']);
  if (shape.dash) attrs.push(['stroke-dasharray', shape.dash]);
  if (shape.dashOffset) attrs.push(['stroke-dashoffset', fmt(shape.dashOffset)]);
  return attrs;
}

function shapeMarkup(shape: InkShape): string {
  let out = `<${shape.tag}`;
  for (const [key, value] of inkShapeAttrs(shape)) out += ` ${key}="${value}"`;
  return `${out}/>`;
}

const FILL_SLOT: Record<keyof InkToonFills, number> = { shade: 0, color: 1, light: 2, highlight: 3 };
/** Cue steps between none and full (the cached colours). */
const CUE_STEPS = 200;

/**
 * The toon drawing's colours: per element, its fills mixed toward the plate
 * by the depth cue, in linear light as the shaders mix. Hex strings are
 * cached per element, fill and cue step, so a spinning drawing reuses them.
 */
export class InkToonPalette {
  private readonly fills: InkToonFills[];
  private readonly ink: Linear;
  private readonly plate: Linear;
  private readonly cache = new Map<number, string>();

  constructor(model: InkModel, plate = INK_PLATE) {
    this.fills = model.kinds.map((kind) => inkToonFills(kind.c));
    this.ink = linearOf(INK_TOON.ink);
    this.plate = linearOf(plate);
  }

  /**
   * The depth cue of a surface at view-space depth `z` (Å, toward the
   * camera) in a molecule of `radius`: 0 at the front of its sphere, up to
   * INK_TOON.depthCue at the back (`lupiInkSurface`'s cue).
   */
  cue(radius: number, z: number): number {
    const across = Math.min(1, Math.max(0, (radius - z) / Math.max(1e-3, 2 * radius)));
    return smoothstep(INK_TOON.depthCueFrom, 1, across) * INK_TOON.depthCue;
  }

  /** A fill of element `kind` (−1: the ink) at a cue, as #rrggbb. */
  color(kind: number, fill: keyof InkToonFills, cue: number): string {
    const step = Math.round(Math.min(1, Math.max(0, cue)) * CUE_STEPS);
    const key = ((kind + 1) * 4 + FILL_SLOT[fill]) * (CUE_STEPS + 1) + step;
    let hex = this.cache.get(key);
    if (hex === undefined) {
      const base = kind < 0 ? this.ink : this.fills[kind][fill];
      hex = hexOf(mixLinear(base, this.plate, step / CUE_STEPS));
      this.cache.set(key, hex);
    }
    return hex;
  }
}

/** The colour and lit bands, as the N·L they start at. */
const TOON_BANDS: ReadonlyArray<{ fill: keyof InkToonFills; at: number }> = [
  { fill: 'color', at: bandDot(INK_TOON.shadeBand) },
  { fill: 'light', at: bandDot(INK_TOON.lightBand) },
];

/** The halfway vector between the key light and the camera (orthographic), for the catchlight. */
function halfway(light: readonly number[]): [number, number, number] {
  const hx = light[0];
  const hy = light[1];
  const hz = light[2] + 1;
  const length = Math.hypot(hx, hy, hz) || 1;
  return [hx / length, hy / length, hz / length];
}

/**
 * The toon shapes of one item of a laid-out pose (an atom, or the bond
 * `item − atomCount`), back to front, appended to `out`.
 */
export function inkToonShapes(layout: InkLayout, palette: InkToonPalette, item: number, out: InkShape[]): void {
  if (item < layout.atomCount) toonAtom(layout, palette, item, out);
  else toonBond(layout, palette, item - layout.atomCount, out);
}

/** A ball: the disc in the shade fill with its ink outline, the colour and lit bands, and the catchlight. */
function toonAtom(layout: InkLayout, palette: InkToonPalette, i: number, out: InkShape[]): void {
  const { model } = layout;
  const kind = model.k[i];
  const x = layout.cx[i];
  const y = layout.cy[i];
  const r = layout.r[i];
  const line = INK_TOON.atomLine * INK_UNIT;
  // Atoms too small to carry a line lose it (the shaders' lineFade).
  const outline = smoothstep(1.4, 3.2, r / line);
  const inner = outline > 0 ? r - line : r;
  const cue = palette.cue(model.radius, layout.vz[i] + model.kinds[kind].r);
  // The highest band over the whole face is the disc's own fill.
  let base: keyof InkToonFills = 'shade';
  const bands: Array<[keyof InkToonFills, string]> = [];
  for (const band of TOON_BANDS) {
    const d = inkCapPath(x, y, inner, layout.light, band.at);
    if (d === INK_CAP_FULL) {
      base = band.fill;
      bands.length = 0;
    } else if (d) {
      bands.push([band.fill, d]);
    }
  }
  const disc: InkShape = { tag: 'circle', cx: x, cy: y, r: outline > 0 ? r - line / 2 : r, fill: palette.color(kind, base, cue) };
  if (outline > 0) {
    disc.stroke = palette.color(-1, 'shade', cue);
    disc.width = line;
    disc.strokeOpacity = outline;
  }
  out.push(disc);
  for (const [fill, d] of bands) out.push({ tag: 'path', d, fill: palette.color(kind, fill, cue) });
  const catchlight = inkCapPath(x, y, inner, halfway(layout.light), INK_TOON.highlight);
  if (catchlight && catchlight !== INK_CAP_FULL) out.push({ tag: 'path', d: catchlight, fill: palette.color(kind, 'highlight', cue) });
}

/** The narrowest band stripe drawn on a stick (viewBox units). */
const STRIPE_MIN = 0.15;

const startScratch: [number, number, number] = [0, 0, 0];
const endScratch: [number, number, number] = [0, 0, 0];
const midScratch: [number, number, number] = [0, 0, 0];

/**
 * A stick: from where it leaves one ball to where it enters the other, ink
 * along both edges, and the bands across it in each half's colour. Dashed
 * and dotted kinds are outlined dashes; sticks too thin for two lines are
 * one ink stroke.
 */
function toonBond(layout: InkLayout, palette: InkToonPalette, b: number, out: InkShape[]): void {
  const { model } = layout;
  const i = model.b[2 * b];
  const j = model.b[2 * b + 1];
  const style = model.bk?.[b] ?? 0;
  let ax = layout.vx[j] - layout.vx[i];
  let ay = layout.vy[j] - layout.vy[i];
  let az = layout.vz[j] - layout.vz[i];
  const length = Math.hypot(ax, ay, az);
  if (length < 1e-6) return;
  ax /= length;
  ay /= length;
  az /= length;
  const p = Math.hypot(ax, ay);
  if (p < 1e-3) return; // end-on: the balls cover it
  const stick = STICK_R * (style === 1 || style === 2 ? KIND_WIDTH[style] : 1);
  const ri = model.kinds[model.k[i]].r;
  const rj = model.kinds[model.k[j]].r;
  const leaveI = Math.sqrt(Math.max(0, ri * ri - stick * stick));
  const leaveJ = Math.sqrt(Math.max(0, rj * rj - stick * stick));
  if (leaveI + leaveJ >= length) return;
  const [sx, sy, sk] = layout.project(layout.vx[i] + ax * leaveI, layout.vy[i] + ay * leaveI, layout.vz[i] + az * leaveI, startScratch);
  const [ex, ey, ek] = layout.project(layout.vx[j] - ax * leaveJ, layout.vy[j] - ay * leaveJ, layout.vz[j] - az * leaveJ, endScratch);
  const midZ = (layout.vz[i] + layout.vz[j]) / 2;
  const [mx, my] = layout.project((layout.vx[i] + layout.vx[j]) / 2, (layout.vy[i] + layout.vy[j]) / 2, midZ, midScratch);
  const half = layout.scale * stick * ((sk + ek) / 2);
  const cue = palette.cue(model.radius, midZ + stick);
  const ink = palette.color(-1, 'shade', cue);
  const line = INK_TOON.bondLine * INK_UNIT;
  const ki = model.k[i];
  const kj = model.k[j];
  // A colour per half (one stroke when both atoms are alike).
  const halves: Array<[number, number, number, number, number]> = ki === kj
    ? [[sx, sy, ex, ey, ki]]
    : [[sx, sy, mx, my, ki], [mx, my, ex, ey, kj]];
  const dash = style === 1 || style === 2 ? KIND_DASH[style]! : undefined;
  // Thinner than about two lines: the ink stroke is the stick (the shaders' thinSolid), a pen line.
  if (half < line * ((INK_TOON.bondSolidFrom + INK_TOON.bondSolidTo) / 2)) {
    out.push({ tag: 'line', x1: sx, y1: sy, x2: ex, y2: ey, stroke: ink, width: 2 * half, round: true, dash });
    return;
  }
  // A full stick ends square where it meets each ball, its ink only along the edges (dashes stay round).
  out.push({ tag: 'line', x1: sx, y1: sy, x2: ex, y2: ey, stroke: ink, width: 2 * half, round: dash !== undefined, dash });
  const inner = half - line;
  if (dash) {
    // Coordination dashed, ionic contacts dotted: each dash outlined, the pattern running on into the second half.
    let offset = 0;
    for (const [x1, y1, x2, y2, kind] of halves) {
      out.push({ tag: 'line', x1, y1, x2, y2, stroke: palette.color(kind, 'color', cue), width: 2 * inner, round: true, dash, dashOffset: offset });
      offset += Math.hypot(x2 - x1, y2 - y1);
    }
    return;
  }
  // The normals across the stick: E faces the camera, S is the side (in the screen plane).
  const L = layout.light;
  const H = halfway(L);
  const facing = (d: readonly number[]) => (-az * ax * d[0] - az * ay * d[1] + p * p * d[2]) / p;
  const side = (d: readonly number[]) => (-ay * d[0] + ax * d[1]) / p;
  const bands: Array<[keyof InkToonFills, Array<[number, number]>]> = [
    ['color', inkBandSpans(facing(L), side(L), TOON_BANDS[0].at)],
    ['light', inkBandSpans(facing(L), side(L), TOON_BANDS[1].at)],
    ['highlight', inkBandSpans(facing(H), side(H), INK_TOON.highlight)],
  ];
  // The highest band across the whole width (but a sliver under a tenth of a
  // pixel or so) is the stick's own fill; narrower stripes are left out too.
  let base: keyof InkToonFills = 'shade';
  let first = 0;
  for (let k = 0; k < 2; k += 1) {
    const spans = bands[k][1];
    if (spans.length === 1 && (2 - (spans[0][1] - spans[0][0])) * inner < STRIPE_MIN) {
      base = bands[k][0];
      first = k + 1;
    }
  }
  // S on screen (SVG, y down): +w runs this way across the stick.
  const dx = ex - sx;
  const dy = ey - sy;
  const run = Math.hypot(dx, dy) || 1;
  const nx = dy / run;
  const ny = -dx / run;
  for (const [x1, y1, x2, y2, kind] of halves) {
    out.push({ tag: 'line', x1, y1, x2, y2, stroke: palette.color(kind, base, cue), width: 2 * inner });
    for (let k = first; k < bands.length; k += 1) {
      const [fill, spans] = bands[k];
      for (const [from, to] of spans) {
        const width = (to - from) * inner;
        if (width < STRIPE_MIN) continue;
        const shift = ((from + to) / 2) * inner;
        out.push({
          tag: 'line',
          x1: x1 + nx * shift,
          y1: y1 + ny * shift,
          x2: x2 + nx * shift,
          y2: y2 + ny * shift,
          stroke: palette.color(kind, fill, cue),
          width,
        });
      }
    }
  }
}

export interface InkSvgOptions {
  /** Prefix for gradient ids; must be unique within the document. */
  idPrefix: string;
  /** Attributes on the root <svg> (already escaped values are not expected; they are escaped here). */
  attrs?: Record<string, string>;
  /** Accessible title (role=img is added when present). */
  title?: string;
  /** The plate behind the drawing: the lit balls' rims, the toon drawing's depth cue. */
  rim?: string;
}

/** The <defs> gradients for a model (one per element; the lit style only). */
export function inkGradientDefs(model: InkModel, idPrefix: string, layout?: InkLayout): string {
  if (INK_DRAWING_STYLE === 'toon') return '';
  const fx = fmt(layout?.lightX ?? 0.4);
  const fy = fmt(layout?.lightY ?? 0.35);
  return model.kinds
    .map((kind) => {
      const stops = inkGradientStops(kind.c)
        .map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`)
        .join('');
      return `<radialGradient id="${idPrefix}-${kind.s}" cx="0.5" cy="0.5" r="0.5" fx="${fx}" fy="${fy}">${stops}</radialGradient>`;
    })
    .join('');
}

/** The painted items (bonds and atoms, back to front) for a laid-out pose. */
export function inkItemsMarkup(layout: InkLayout, idPrefix: string, rim = INK_PLATE): string {
  const { model } = layout;
  if (INK_DRAWING_STYLE === 'toon') {
    const palette = new InkToonPalette(model, rim);
    const shapes: InkShape[] = [];
    for (const item of layout.order) inkToonShapes(layout, palette, item, shapes);
    return `<g>${shapes.map(shapeMarkup).join('')}</g>`;
  }
  let out = `<g stroke="${INK_BOND}" stroke-linecap="round" stroke-width="${fmt(layout.bondWidth)}">`;
  for (const item of layout.order) {
    if (item < layout.atomCount) {
      const kind = model.kinds[model.k[item]];
      out += `<circle cx="${fmt(layout.cx[item])}" cy="${fmt(layout.cy[item])}" r="${fmt(layout.r[item])}" opacity="${fmt(layout.opacity[item])}" fill="url(#${idPrefix}-${kind.s})" stroke="${rim}" stroke-width="0.6"/>`;
    } else {
      const b = item - layout.atomCount;
      const kind = model.bk?.[b] ?? 0;
      const dash = kind === 1 || kind === 2
        ? ` stroke-width="${fmt(layout.bondWidth * KIND_WIDTH[kind])}" stroke-dasharray="${KIND_DASH[kind]}"`
        : '';
      out += `<line x1="${fmt(layout.x1[b])}" y1="${fmt(layout.y1[b])}" x2="${fmt(layout.x2[b])}" y2="${fmt(layout.y2[b])}" stroke-opacity="${fmt(layout.bondOpacity[b])}"${dash}/>`;
    }
  }
  return `${out}</g>`;
}

/** A standalone SVG of the molecule at `pose` (static pages, thumbnails, cards). */
export function inkSvgMarkup(model: InkModel, pose: InkPose, opts: InkSvgOptions): string {
  const layout = new InkLayout(model);
  layout.update(pose);
  const attrs: Record<string, string> = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${INK_VIEW} ${INK_VIEW}`,
    ...(opts.title ? { role: 'img' } : { 'aria-hidden': 'true' }),
    ...opts.attrs,
  };
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  const defs = inkGradientDefs(model, opts.idPrefix, layout);
  return `<svg${attrText}>${title}${defs ? `<defs>${defs}</defs>` : ''}${inkItemsMarkup(layout, opts.idPrefix, opts.rim)}</svg>`;
}
