/**
 * atomPick.ts — the atom under a client point, as it is drawn.
 *
 * The rule (taps, clicks, the desktop hover and the toys all pick by it):
 *
 * 1. **Exact.** The pointer ray is tested against every drawn atom sphere and,
 *    when the bond layer reports them, every drawn bond (up to
 *    `PICK_MAX_BONDS`). An atom is drawn at
 *    display radius × atomScale × its per-type scale (`resolveSlotRadius`,
 *    the rule the impostor's radius palette uses), swollen exactly like the
 *    impostor while it is hovered or grabbed. The impostor draws an atom only
 *    inside its billboard quad (±1.3 radii about the centre, on the sphere's
 *    near tangent plane), which cuts off the inner edge of an atom more than
 *    about 15° off the view axis; the picker cuts it the same way (not for
 *    the glass layer's sphere meshes). A bond is a flat-capped
 *    cylinder from atom centre to atom centre, at the layer's radius × its
 *    kind's scale (dash gaps count as solid). The front-most hit wins, ties
 *    to the lower index. A bond hit picks the atom whose half was hit, since
 *    each half is drawn in its own atom's colour, so a stick in front of an
 *    atom occludes it. What the renderer does not draw is neither picked nor
 *    an occluder: hidden types (radius 0), indices past the drawn count,
 *    non-finite positions, spheres whose impostor quad the near or far plane
 *    clips (a camera inside a sphere included), atoms and bonds under the
 *    sub-pixel cull, and bonds faded out by distance.
 * 2. **Soft, only on an exact miss.** The atom whose drawn outline is
 *    nearest the pointer within `PICK_TOLERANCE_PX` (CSS px: mouse 5, pen 8,
 *    touch 14), nearer depth first, provided an exact pick just inside its
 *    outline toward the pointer returns it. A near miss therefore never
 *    picks an atom hidden behind another. The gap is measured along the line
 *    from the atom's projected centre through the pointer to the outline as
 *    drawn: the projected tangent cone (an ellipse stretched away from the
 *    view centre in perspective, a circle in orthographic), cut by the quad.
 *
 * The search marches the ray through the spatial hash, clipped to the hash's
 * bounds grown by the query reach (no distance limit), in steps of the
 * largest drawn radius (0.5 Å to one cell); each step visits the atoms within
 * the reach of the largest drawn atom (or bond half) plus half a step, and
 * the march stops once nothing nearer than the best hit can remain. Bonds
 * that reach farther from their end atoms than `PICK_LONG_BOND_REACH` (a
 * stick across the box of a wrapped periodic file) are tested once per ray
 * instead, so one long stick does not widen every query. The soft phase
 * widens each query by the tolerance at that depth. When the hash was
 * built from other positions than the drawn frame's, or from fewer atoms
 * (it is rebuilt on idle, up to 750 ms after an upload or a streamed chunk),
 * the drawn atoms are tested one by one up to `PICK_BRUTE_FORCE_MAX_ATOMS`,
 * and larger frames report the pick unavailable until it catches up.
 *
 * Pure (no React), CPU-only (the same on WebGPU and WebGL2) and
 * allocation-free per pick: the geometry is built once per frame, look and
 * bond set, and a pick works in module scratch. Positions are rest
 * positions; display motion is not followed. The near-miss tolerance covers a
 * poke's ripple (at most 0.3 Å) only where the displaced rim lies over empty
 * space. Hover during an arrival or a morph, and the Tug, Burst and Heat
 * offsets, pick where the atoms rest (a press cancels an arrival before its
 * tap picks).
 */

import * as THREE from 'three';
import { resolveTypeDisplayRadius } from '@atlas/core';
import { BOND_KIND_RADIUS_SCALE } from '@atlas/core/bonds';
import type { Frame } from '@atlas/core/types';
import type { PointerKind } from './intents';
import type { SpatialHash3D } from './SpatialHash';
import { resolveSlotRadius } from './typeRenderTable';

// ─── Public constants ────────────────────────────────────────────────

/**
 * How far (CSS px) from an atom's drawn silhouette a pointer that hits
 * nothing still picks it, by pointer: a fingertip is coarser than a cursor.
 */
export const PICK_TOLERANCE_PX: Readonly<Record<PointerKind, number>> = Object.freeze({
  mouse: 5,
  pen: 8,
  touch: 14,
});

/** The soft-pick tolerance (CSS px) for a pointer type; anything unknown is a mouse. */
export function pickTolerancePx(pointerType?: string | null): number {
  return pointerType === 'touch' || pointerType === 'pen' ? PICK_TOLERANCE_PX[pointerType] : PICK_TOLERANCE_PX.mouse;
}

/** Drawn atoms tested one by one while the spatial hash is stale; above this a stale hash makes the pick unavailable. */
export const PICK_BRUTE_FORCE_MAX_ATOMS = 200_000;

/**
 * Drawn bonds the picker tests at most. Past this (multi-million-atom scenes,
 * where a 0.12 Å stick is far under a pixel) bonds neither pick nor occlude,
 * which spares their per-atom adjacency (4 bytes per atom and 8 per bond).
 */
export const PICK_MAX_BONDS = 2_000_000;

/**
 * A bond whose half length plus radius exceeds this (Å) is "long" (a stick
 * across the box of a wrapped periodic file): it is tested once per ray, not
 * from its end atoms, so it does not widen every query of the march.
 */
export const PICK_LONG_BOND_REACH = 3;

/**
 * Long bonds tested per ray at most. When more bonds than this reach past
 * `PICK_LONG_BOND_REACH`, the cut rises (in steps of 2^(1/8)) until at most
 * this many are long; the rest are found from their end atoms.
 */
export const PICK_MAX_LONG_BONDS = 4096;

/**
 * The impostor billboard's half-size in radii: the atom is drawn only where
 * the view ray crosses this square on the sphere's near tangent plane. It
 * mirrors ATOM_IMPOSTOR_QUAD_SCALE (tsl/atomImpostorMaterial.ts; a test pins
 * the two together) without importing the shader into this pure module.
 */
export const PICK_IMPOSTOR_QUAD_SCALE = 1.3;

/** Smallest march step (Å). */
const MIN_STEP = 0.5;
/** Most samples one march takes; a longer ray takes longer steps (and wider queries). */
const MAX_SAMPLES = 4096;
/** Soft candidates kept per pick (the nearest silhouettes). */
const SOFT_CANDIDATES = 24;
/** Long-bond cut classes: 8 per octave above PICK_LONG_BOND_REACH. */
const LONG_BINS_PER_OCTAVE = 8;
const LONG_BINS = 256;

const KIND_NONE = 0;
const KIND_ATOM = 1;
const KIND_BOND = 2;

// ─── Inputs ──────────────────────────────────────────────────────────

/** The bonds the bond layer draws, as `Bonds` reports them (`onDrawnBonds`). */
export interface PickBonds {
  /** Drawn pairs `[a0, b0, a1, b1, …]`; pairs touching hidden types (and hidden contacts) are already gone. */
  readonly pairs: Int32Array;
  /** Per-bond kind (0 covalent, 1 coordination, 2 ionic contact); null draws every bond as covalent. */
  readonly kinds?: ArrayLike<number> | null;
  /** The layer's radius: bond k is drawn at `radius × BOND_KIND_RADIUS_SCALE[kind]`. */
  readonly radius: number;
  /**
   * Per-bond drawn radius where it varies by bond (property colour mode, a
   * collapsed stale bond at 0); overrides `radius`. Read once, when the
   * picker builds its bond set (it may be a lazy getter).
   */
  readonly radii?: ArrayLike<number> | null;
  /** View depths over which bonds fade out; a hit as faded as the shader discards is a miss. */
  readonly fadeStart?: number;
  readonly fadeEnd?: number;
}

/** What makes the drawn atoms: the frame the atom layer draws and the look's scale controls. */
export interface AtomPickGeometryInput {
  frame: Pick<Frame, 'natoms' | 'positions' | 'types' | 'typeSemantics' | 'distanceSemantics'>;
  /** Streamed atoms resident so far (the atom layer draws only these). */
  loadedAtomCount?: number;
  /** The atom layer's capacity clamp (the device's max atoms). */
  maxAtoms?: number;
  /** The store's atomScale. */
  atomScale?: number;
  /** Per raw type radius multipliers. */
  atomTypeScales?: Readonly<Record<number, number>> | null;
  /** Raw types not drawn. */
  hiddenAtomTypes?: { has(type: number): boolean } | null;
  /** The impostor's sub-pixel cull (device px; 0 = none). */
  cullPixelRadius?: number;
  /**
   * Atoms are ray-cast impostors (default), drawn only inside their billboard
   * quad; false for the glass layer's sphere meshes, which draw the whole
   * sphere.
   */
  impostor?: boolean;
  /** The drawn bonds, or null when none are drawn. */
  bonds?: PickBonds | null;
  /**
   * The drawn bonds already built by `buildPickBondSet` for this frame's
   * positions (it wins over `bonds`): a caller that rebuilds the geometry on
   * every look change keeps the bond set, which depends only on the bonds.
   */
  bondSet?: PickBondSet | null;
}

/** The drawn bonds with their per-atom adjacency (`buildPickBondSet`). */
export interface PickBondSet {
  readonly pairs: Int32Array;
  readonly count: number;
  /** The drawn radius of every bond, unless `radii` gives one per bond (kinds, property mode). */
  readonly radius: number;
  /** Drawn radius per bond (0 = not drawn), or null when every bond draws at `radius`. */
  readonly radii: Float32Array | null;
  /** How far from an end atom's centre a bond in the adjacency reaches (half length + radius, at most). */
  readonly reach: number;
  readonly fadeStart: number;
  readonly fadeEnd: number;
  /** CSR adjacency of the short bonds: the bonds of atom i are `ids[start[i] .. start[i + 1])`. */
  readonly atomCount: number;
  readonly start: Int32Array;
  readonly ids: Int32Array;
  /** The long bonds, tested once per ray. */
  readonly longIds: Int32Array;
  /** The positions the lengths were measured on, and their atom count (the caller's cache key). */
  readonly positions: Float32Array;
  readonly source: PickBonds;
}

/** The drawn atoms (and bonds) of one frame and look, built once and reused by every pick. */
export interface AtomPickGeometry {
  readonly positions: Float32Array;
  readonly types: ArrayLike<number>;
  /** Atoms drawn: min(natoms, loaded, capacity, positions, types). */
  readonly count: number;
  /** The largest drawn radius (before the hover swell). */
  readonly maxRadius: number;
  readonly cullPixelRadius: number;
  /** The impostor quad's half-size in radii, or 0 where atoms are whole sphere meshes. */
  readonly quadScale: number;
  /** Drawn radius per raw type: dense from `typeBase`, or a map for a sparse type domain. */
  readonly typeBase: number;
  readonly radiusByType: Float32Array | null;
  readonly radiusMap: ReadonlyMap<number, number> | null;
  readonly bonds: PickBondSet | null;
}

/**
 * The impostor's hover and grab swell (atomGlow.ts): the hovered atom draws at
 * `hoverScale` × its radius and the grabbed one at `focusScale` ×, the larger
 * when they coincide. Omit it (or pass null) where nothing swells (glass).
 */
export interface AtomPickSwell {
  hoverAtom: number;
  hoverScale: number;
  focusAtom: number;
  focusScale: number;
}

export interface AtomPickOptions {
  /** Picks the soft tolerance (default mouse). */
  pointerType?: PointerKind | string | null;
  /** Fall back to the near-miss rule when nothing is hit (default true). */
  soft?: boolean;
  swell?: AtomPickSwell | null;
  /** The drawing buffer's height in device px, for the sub-pixel cull (default the rect's CSS height). */
  bufferHeight?: number;
  /**
   * While the hash is stale, test the drawn atoms one by one only up to this
   * many (default PICK_BRUTE_FORCE_MAX_ATOMS); above it the pick is
   * unavailable. The per-frame hover passes less than a tap does.
   */
  bruteForceMaxAtoms?: number;
}

export interface PickRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How a pick resolved (optional out-parameter of `pickAtom`). */
export interface AtomPickResult {
  index: number;
  /**
   * 'atom' (a sphere), 'bond' (a stick's half), 'soft' (a near miss), 'miss',
   * or 'unavailable': the spatial hash is stale and the frame too large to
   * test one by one, so nothing can be said about the point (not a miss).
   */
  via: 'atom' | 'bond' | 'soft' | 'miss' | 'unavailable';
  /** Ray distance of the hit (world units; NaN for a soft pick or a miss). */
  t: number;
}

// ─── Building the geometry ───────────────────────────────────────────

const uniqueTypesCache = new WeakMap<object, { count: number; types: Int32Array }>();

/** The distinct raw types among the first `count` atoms (cached per type buffer). */
function uniqueTypes(types: ArrayLike<number>, count: number): Int32Array {
  const key = types as unknown as object;
  const cached = uniqueTypesCache.get(key);
  if (cached && cached.count === count) return cached.types;
  const seen = new Set<number>();
  let last = Number.NaN;
  for (let i = 0; i < count; i += 1) {
    const t = types[i];
    if (t === last) continue;
    last = t;
    seen.add(t);
  }
  const out = Int32Array.from(seen).sort();
  uniqueTypesCache.set(key, { count, types: out });
  return out;
}

function atomsDrawn(input: AtomPickGeometryInput): number {
  const { frame, loadedAtomCount, maxAtoms } = input;
  let count = Number.isFinite(frame.natoms) ? Math.max(0, Math.trunc(frame.natoms)) : 0;
  if (loadedAtomCount !== undefined) {
    count = Number.isFinite(loadedAtomCount) ? Math.min(count, Math.max(0, Math.trunc(loadedAtomCount))) : 0;
  }
  if (maxAtoms !== undefined && Number.isFinite(maxAtoms)) count = Math.min(count, Math.max(0, Math.trunc(maxAtoms)));
  count = Math.min(count, Math.floor(frame.positions.length / 3), frame.types.length);
  return count;
}

/** The long-bond class of a reach (0 = short, k ≥ 1 the k-th 2^(1/8) step above PICK_LONG_BOND_REACH). */
function reachClass(reach: number): number {
  if (!(reach > PICK_LONG_BOND_REACH)) return 0;
  const step = Math.floor(Math.log2(reach / PICK_LONG_BOND_REACH) * LONG_BINS_PER_OCTAVE);
  return 1 + Math.min(LONG_BINS - 2, Math.max(0, step));
}

const bondClassCount = new Float64Array(LONG_BINS);
const bondClassReach = new Float64Array(LONG_BINS);

/**
 * The drawn bonds with their per-atom adjacency, measured on `positions`
 * (the frame they are drawn on; `natoms` bounds the indices). Null when no
 * bond is drawn, or past PICK_MAX_BONDS. Depends only on the bonds and the
 * positions, so a caller keeps it across look changes (`bondSet`).
 */
export function buildPickBondSet(bonds: PickBonds, positions: Float32Array, natoms: number): PickBondSet | null {
  const pairs = bonds.pairs;
  const count = pairs.length >> 1;
  if (count === 0 || count > PICK_MAX_BONDS) return null;
  const n = Math.min(Math.max(0, Math.trunc(natoms) || 0), Math.floor(positions.length / 3));
  const kinds = bonds.kinds ?? null;
  const given = bonds.radii ?? null;
  const uniform = !kinds && !given;
  const radius = bonds.radius;
  if (uniform && !(radius > 0 && radius < Infinity)) return null;
  const radii = uniform ? null : new Float32Array(count);
  // Per bond: 0 not drawn, else 1 + its reach class.
  const cls = new Uint8Array(count);
  bondClassCount.fill(0);
  bondClassReach.fill(0);
  for (let k = 0; k < count; k += 1) {
    const a = pairs[2 * k];
    const b = pairs[2 * k + 1];
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) continue;
    let r = radius;
    if (radii) {
      r = given ? given[k] : radius * (BOND_KIND_RADIUS_SCALE[kinds![k] as 0 | 1 | 2] ?? 1);
      if (!(r > 0 && r < Infinity)) continue;
    }
    const dx = positions[3 * b] - positions[3 * a];
    const dy = positions[3 * b + 1] - positions[3 * a + 1];
    const dz = positions[3 * b + 2] - positions[3 * a + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // The shader collapses a degenerate bond; a non-finite one draws nothing.
    if (!(len > 1e-6 && len < Infinity)) continue;
    if (radii) radii[k] = r;
    const reach = len / 2 + r;
    const c = reachClass(reach);
    cls[k] = c + 1;
    bondClassCount[c] += 1;
    if (reach > bondClassReach[c]) bondClassReach[c] = reach;
  }
  // The cut: classes 0..cut go in the adjacency, the rest are long. Raise it
  // until at most PICK_MAX_LONG_BONDS are long.
  let long = 0;
  for (let c = 1; c < LONG_BINS; c += 1) long += bondClassCount[c];
  let cut = 0;
  while (long > PICK_MAX_LONG_BONDS && cut < LONG_BINS - 1) {
    cut += 1;
    long -= bondClassCount[cut];
  }
  let reach = 0;
  let kept = 0;
  for (let c = 0; c <= cut; c += 1) {
    kept += bondClassCount[c];
    if (bondClassReach[c] > reach) reach = bondClassReach[c];
  }
  if (kept + long === 0) return null;
  const degree = new Int32Array(n + 1);
  const longIds = new Int32Array(long);
  let nLong = 0;
  for (let k = 0; k < count; k += 1) {
    const c = cls[k];
    if (c === 0) continue;
    if (c - 1 > cut) {
      longIds[nLong++] = k;
      continue;
    }
    degree[pairs[2 * k] + 1] += 1;
    degree[pairs[2 * k + 1] + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) degree[i + 1] += degree[i];
  const start = degree;
  const cursor = start.slice(0, n);
  const ids = new Int32Array(kept * 2);
  for (let k = 0; k < count; k += 1) {
    const c = cls[k];
    if (c === 0 || c - 1 > cut) continue;
    ids[cursor[pairs[2 * k]]++] = k;
    ids[cursor[pairs[2 * k + 1]]++] = k;
  }
  const fadeStart = Number.isFinite(bonds.fadeStart) ? bonds.fadeStart! : Infinity;
  const fadeEnd = Number.isFinite(bonds.fadeEnd) ? bonds.fadeEnd! : Infinity;
  return {
    pairs,
    count,
    radius,
    radii,
    reach,
    fadeStart,
    fadeEnd,
    atomCount: n,
    start,
    ids,
    longIds,
    positions,
    source: bonds,
  };
}

/**
 * The drawn atoms of a frame under the look's scale controls: per raw type
 * radius exactly as the atom layer resolves it, the drawn count, the cull,
 * the impostor's quad and (optionally) the drawn bonds with their per-atom
 * adjacency (`bondSet`, or built here from `bonds`).
 */
export function buildAtomPickGeometry(input: AtomPickGeometryInput): AtomPickGeometry {
  const { frame } = input;
  const positions = frame.positions;
  const count = atomsDrawn(input);
  const scale = input.atomScale ?? 1;
  const hidden = input.hiddenAtomTypes ?? null;
  const typeScales = input.atomTypeScales ?? null;
  const distinct = uniqueTypes(frame.types, count);

  let maxRadius = 0;
  let typeBase = 0;
  let radiusByType: Float32Array | null = null;
  let radiusMap: Map<number, number> | null = null;
  if (distinct.length > 0) {
    const lo = distinct[0];
    const hi = distinct[distinct.length - 1];
    if (hi - lo < 65_536) {
      typeBase = lo;
      radiusByType = new Float32Array(hi - lo + 1);
    } else {
      radiusMap = new Map();
    }
    for (let k = 0; k < distinct.length; k += 1) {
      const rawType = distinct[k];
      const r = resolveSlotRadius(
        { rawType, displayRadius: resolveTypeDisplayRadius(frame, rawType) },
        scale,
        hidden,
        typeScales as Record<number, number> | null,
      );
      if (radiusByType) radiusByType[rawType - typeBase] = r;
      else radiusMap!.set(rawType, r);
      if (r > maxRadius) maxRadius = r;
    }
  }

  let bonds: PickBondSet | null = null;
  if (input.bondSet !== undefined) {
    // A prebuilt set counts only when it was measured on these positions.
    bonds = input.bondSet && input.bondSet.positions === positions ? input.bondSet : null;
  } else if (input.bonds) {
    bonds = buildPickBondSet(input.bonds, positions, frame.natoms);
  }
  const cull = input.cullPixelRadius;
  return {
    positions,
    types: frame.types,
    count,
    maxRadius,
    cullPixelRadius: Number.isFinite(cull) && cull! > 0 ? cull! : 0,
    quadScale: input.impostor === false ? 0 : PICK_IMPOSTOR_QUAD_SCALE,
    typeBase,
    radiusByType,
    radiusMap,
    bonds,
  };
}

// ─── Per-pick state (module scratch: a pick allocates nothing) ───────

const EMPTY_GEOMETRY: AtomPickGeometry = {
  positions: new Float32Array(0),
  types: new Int32Array(0),
  count: 0,
  maxRadius: 0,
  cullPixelRadius: 0,
  quadScale: 0,
  typeBase: 0,
  radiusByType: null,
  radiusMap: null,
  bonds: null,
};

const scratchRaycaster = new THREE.Raycaster();
const scratchNdc = new THREE.Vector2();
const scratchPoint = new THREE.Vector3();

const S = {
  g: EMPTY_GEOMETRY,
  hash: null as SpatialHash3D | null,
  useHash: false,
  camera: null as THREE.Camera | null,
  ortho: false,
  near: 0,
  far: Infinity,
  // Rows 0-2 of the view matrix (view x, y; view depth = -(m2 x + m6 y + m10 z + m14)).
  m0: 0,
  m4: 0,
  m8: 0,
  m12: 0,
  m1: 0,
  m5: 0,
  m9: 0,
  m13: 0,
  m2: 0,
  m6: 0,
  m10: 0,
  m14: 0,
  // Projection P[0][0], P[1][1], P[0][2], P[1][2] (three's column-major 0, 5, 8, 9).
  p0: 1,
  p5: 1,
  p8: 0,
  p9: 0,
  /** CSS and device px per world unit at unit depth (|P[1][1]| × height / 2). */
  cssPx: 0,
  devicePx: 0,
  cullPx: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  hoverAtom: -1,
  hoverScale: 1,
  focusAtom: -1,
  focusScale: 1,
  maxSwell: 1,
  // The ray, in world space and in view space.
  ox: 0,
  oy: 0,
  oz: 0,
  dx: 0,
  dy: 0,
  dz: 0,
  vox: 0,
  voy: 0,
  voz: 0,
  vdx: 0,
  vdy: 0,
  vdz: 0,
  // The impostor quad's half-size in radii (0: whole spheres, or orthographic, where it never cuts).
  quad: 0,
  // The clipped march interval.
  t0: 0,
  t1: 0,
  // The exact result.
  best: -1,
  bestT: Infinity,
  bestKind: KIND_NONE,
  // The soft phase.
  px: 0,
  py: 0,
  tol: 0,
  softCount: 0,
};

const softIndex = new Int32Array(SOFT_CANDIDATES);
const softGap = new Float64Array(SOFT_CANDIDATES);
const softDepth = new Float64Array(SOFT_CANDIDATES);
const softCx = new Float64Array(SOFT_CANDIDATES);
const softCy = new Float64Array(SOFT_CANDIDATES);
/** The drawn outline's distance from the projected centre toward the pointer (CSS px). */
const softEdge = new Float64Array(SOFT_CANDIDATES);

/** Set the per-pick camera state (the ray is set per point by setRay). */
function setCamera(
  camera: THREE.Camera,
  rect: PickRect,
  options: Pick<AtomPickOptions, 'swell' | 'bufferHeight'> | undefined,
): void {
  S.camera = camera;
  const lens = camera as THREE.Camera & { near?: number; far?: number; isOrthographicCamera?: boolean };
  S.ortho = lens.isOrthographicCamera === true;
  S.near = typeof lens.near === 'number' && Number.isFinite(lens.near) ? lens.near : 0;
  S.far = typeof lens.far === 'number' && lens.far > S.near ? lens.far : Infinity;
  const m = camera.matrixWorldInverse.elements;
  S.m0 = m[0];
  S.m4 = m[4];
  S.m8 = m[8];
  S.m12 = m[12];
  S.m1 = m[1];
  S.m5 = m[5];
  S.m9 = m[9];
  S.m13 = m[13];
  S.m2 = m[2];
  S.m6 = m[6];
  S.m10 = m[10];
  S.m14 = m[14];
  const pe = camera.projectionMatrix.elements;
  S.p0 = pe[0];
  S.p5 = pe[5];
  S.p8 = pe[8];
  S.p9 = pe[9];
  // An orthographic silhouette (a circle of radius r) never leaves the ±1.3 r quad.
  S.quad = S.ortho ? 0 : S.g.quadScale;
  const p11 = Math.abs(pe[5]);
  S.cssPx = (p11 * rect.height) / 2;
  const buffer = options?.bufferHeight;
  S.devicePx = (p11 * (buffer !== undefined && buffer > 0 ? buffer : rect.height)) / 2;
  S.left = rect.left;
  S.top = rect.top;
  S.width = rect.width;
  S.height = rect.height;
  const swell = options?.swell;
  S.hoverAtom = swell && swell.hoverScale > 1 ? swell.hoverAtom : -1;
  S.hoverScale = swell ? swell.hoverScale : 1;
  S.focusAtom = swell && swell.focusScale > 1 ? swell.focusAtom : -1;
  S.focusScale = swell ? swell.focusScale : 1;
  S.maxSwell = Math.max(1, S.hoverAtom >= 0 ? S.hoverScale : 1, S.focusAtom >= 0 ? S.focusScale : 1);
}

const PICK_READY = 0;
const PICK_EMPTY = 1;
const PICK_UNAVAILABLE = 2;

/**
 * Set the per-pick state. PICK_EMPTY when nothing can be picked (an empty
 * rect or frame); PICK_UNAVAILABLE when the hash is stale and the frame is
 * over the brute-force limit.
 */
function beginPick(
  g: AtomPickGeometry,
  hash: SpatialHash3D | null,
  camera: THREE.Camera,
  rect: PickRect,
  options: AtomPickOptions | undefined,
): number {
  if (!(rect.width > 0) || !(rect.height > 0) || g.count === 0) return PICK_EMPTY;
  // The hash must hold exactly the drawn positions, every drawn atom binned
  // (it is rebuilt on idle after an upload or a streamed chunk).
  S.useHash = Boolean(
    hash
    && hash.positions === g.positions
    && hash.size >= g.count
    && hash.bounds !== null,
  );
  const bruteMax = options?.bruteForceMaxAtoms ?? PICK_BRUTE_FORCE_MAX_ATOMS;
  if (!S.useHash && g.count > bruteMax) return PICK_UNAVAILABLE;
  S.g = g;
  S.hash = S.useHash ? hash : null;
  S.cullPx = g.cullPixelRadius;
  setCamera(camera, rect, options);
  return PICK_READY;
}

/** Hold no frame, hash or camera between picks. */
function endPick(): void {
  S.g = EMPTY_GEOMETRY;
  S.hash = null;
  S.camera = null;
}

function setRay(clientX: number, clientY: number): void {
  scratchNdc.set(((clientX - S.left) / S.width) * 2 - 1, -((clientY - S.top) / S.height) * 2 + 1);
  scratchRaycaster.setFromCamera(scratchNdc, S.camera!);
  const { origin, direction } = scratchRaycaster.ray;
  S.ox = origin.x;
  S.oy = origin.y;
  S.oz = origin.z;
  S.dx = direction.x;
  S.dy = direction.y;
  S.dz = direction.z;
  if (S.quad > 0) {
    S.vox = S.m0 * S.ox + S.m4 * S.oy + S.m8 * S.oz + S.m12;
    S.voy = S.m1 * S.ox + S.m5 * S.oy + S.m9 * S.oz + S.m13;
    S.voz = S.m2 * S.ox + S.m6 * S.oy + S.m10 * S.oz + S.m14;
    S.vdx = S.m0 * S.dx + S.m4 * S.dy + S.m8 * S.dz;
    S.vdy = S.m1 * S.dx + S.m5 * S.dy + S.m9 * S.dz;
    S.vdz = S.m2 * S.dx + S.m6 * S.dy + S.m10 * S.dz;
  }
}

/**
 * True when the current ray crosses the impostor quad of an atom of drawn
 * radius r at (x, y, z): the square of half-size quad × r about the centre on
 * the sphere's near tangent plane (view z = cz + r). The impostor draws
 * nothing outside it.
 */
function insideQuad(x: number, y: number, z: number, r: number): boolean {
  const cx = S.m0 * x + S.m4 * y + S.m8 * z + S.m12;
  const cy = S.m1 * x + S.m5 * y + S.m9 * z + S.m13;
  const cz = S.m2 * x + S.m6 * y + S.m10 * z + S.m14;
  const t = (cz + r - S.voz) / S.vdz;
  if (!(t > 0)) return false;
  const half = S.quad * r;
  return Math.abs(S.vox + S.vdx * t - cx) <= half && Math.abs(S.voy + S.vdy * t - cy) <= half;
}

function viewDepth(x: number, y: number, z: number): number {
  return -(S.m2 * x + S.m6 * y + S.m10 * z + S.m14);
}

/** The drawn radius of atom i (0 when its type is not drawn), swollen while hovered or grabbed. */
function drawnRadius(g: AtomPickGeometry, i: number): number {
  const type = g.types[i];
  let r: number;
  if (g.radiusByType) {
    const k = type - g.typeBase;
    r = k >= 0 && k < g.radiusByType.length ? g.radiusByType[k] : 0;
  } else {
    r = g.radiusMap?.get(type) ?? 0;
  }
  if (!(r > 0)) return 0;
  if (i === S.hoverAtom || i === S.focusAtom) {
    let swell = i === S.hoverAtom ? S.hoverScale : 1;
    if (i === S.focusAtom && S.focusScale > swell) swell = S.focusScale;
    r *= swell;
  }
  return r;
}

/**
 * The view depth of an atom of drawn radius r at (x, y, z), or -1 when the
 * impostor does not draw it: its quad (on the sphere's near tangent plane)
 * is clipped by the near or far plane, or it projects under the cull.
 */
function drawnDepth(x: number, y: number, z: number, r: number): number {
  const depth = viewDepth(x, y, z);
  const front = depth - r;
  if (!(front > S.near) || !(front < S.far)) return -1;
  if (S.cullPx > 0) {
    const pixels = S.ortho ? r * S.devicePx : (r * S.devicePx) / Math.max(depth, 1e-4);
    if (pixels < S.cullPx) return -1;
  }
  return depth;
}

function offer(t: number, index: number, kind: number): void {
  if (t < S.bestT || (t === S.bestT && index < S.best)) {
    S.bestT = t;
    S.best = index;
    S.bestKind = kind;
  }
}

/** Exact ray-sphere test of atom i against the current ray. */
function testAtom(i: number): void {
  const g = S.g;
  if (i >= g.count) return;
  const r = drawnRadius(g, i);
  if (r <= 0) return;
  const p = g.positions;
  const x = p[3 * i];
  const y = p[3 * i + 1];
  const z = p[3 * i + 2];
  // x - x is 0 exactly when x is finite.
  if (x - x !== 0 || y - y !== 0 || z - z !== 0) return;
  if (drawnDepth(x, y, z, r) < 0) return;
  const ocx = S.ox - x;
  const ocy = S.oy - y;
  const ocz = S.oz - z;
  const b = ocx * S.dx + ocy * S.dy + ocz * S.dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  const disc = b * b - c;
  if (disc < 0) return;
  const t = -b - Math.sqrt(disc);
  if (!(t > 0) || t > S.bestT) return;
  if (S.quad > 0 && !insideQuad(x, y, z, r)) return;
  offer(t, i, KIND_ATOM);
}

/** 1 − smoothstep(start, end, depth): the bond shader's distance fade. */
function bondFade(bonds: PickBondSet, depth: number): number {
  if (bonds.fadeEnd === Infinity) return 1;
  const span = bonds.fadeEnd - bonds.fadeStart;
  let u = span > 0 ? (depth - bonds.fadeStart) / span : depth >= bonds.fadeEnd ? 1 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Exact ray test of bond k (a flat-capped cylinder, as rayCappedCylinder in
 * the impostor kit: the nearer side root inside the segment, else the entry
 * cap, else the exit cap; a hit behind the ray origin is a miss).
 */
function testBond(bonds: PickBondSet, k: number): void {
  const r = bonds.radii ? bonds.radii[k] : bonds.radius;
  if (!(r > 0)) return;
  const p = S.g.positions;
  const a = bonds.pairs[2 * k];
  const b = bonds.pairs[2 * k + 1];
  if (!(a >= 0 && a < bonds.atomCount && b >= 0 && b < bonds.atomCount)) return;
  const ax = p[3 * a];
  const ay = p[3 * a + 1];
  const az = p[3 * a + 2];
  const ex = p[3 * b] - ax;
  const ey = p[3 * b + 1] - ay;
  const ez = p[3 * b + 2] - az;
  const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (!(len > 1e-6)) return;
  // The vertex stage culls past the fade's end and under the cull (at the midpoint's depth).
  const midDepth = viewDepth(ax + ex / 2, ay + ey / 2, az + ez / 2);
  if (midDepth > bonds.fadeEnd) return;
  if (S.cullPx > 0) {
    const pixels = S.ortho ? r * S.devicePx : (r * S.devicePx) / Math.max(midDepth, 1e-4);
    if (pixels < S.cullPx) return;
  }
  const ux = ex / len;
  const uy = ey / len;
  const uz = ez / len;
  const ocx = S.ox - ax;
  const ocy = S.oy - ay;
  const ocz = S.oz - az;
  const card = ux * S.dx + uy * S.dy + uz * S.dz;
  const caoc = ux * ocx + uy * ocy + uz * ocz;
  const dpx = S.dx - ux * card;
  const dpy = S.dy - uy * card;
  const dpz = S.dz - uz * card;
  const opx = ocx - ux * caoc;
  const opy = ocy - uy * caoc;
  const opz = ocz - uz * caoc;
  const qa = dpx * dpx + dpy * dpy + dpz * dpz;
  const qb = dpx * opx + dpy * opy + dpz * opz;
  const qc = opx * opx + opy * opy + opz * opz - r * r;
  let t = -1;
  let axial = 0;
  let hit = false;
  if (qa > 1e-8) {
    const h = qb * qb - qa * qc;
    if (h >= 0) {
      const ts = (-qb - Math.sqrt(h)) / qa;
      const ys = caoc + ts * card;
      if (ys >= 0 && ys <= len) {
        t = ts;
        axial = ys;
        hit = true;
      }
    }
  }
  if (!hit && Math.abs(card) > 1e-6) {
    const tA = -caoc / card;
    const tB = (len - caoc) / card;
    const aFirst = tA < tB;
    const tNear = aFirst ? tA : tB;
    const tFar = aFirst ? tB : tA;
    const yNear = aFirst ? 0 : len;
    const yFar = aFirst ? len : 0;
    const r2 = r * r;
    // The hit on each cap plane, relative to that cap's centre.
    const nx = ocx + S.dx * tNear - ux * yNear;
    const ny = ocy + S.dy * tNear - uy * yNear;
    const nz = ocz + S.dz * tNear - uz * yNear;
    if (nx * nx + ny * ny + nz * nz <= r2) {
      t = tNear;
      axial = yNear;
      hit = true;
    } else {
      const fx = ocx + S.dx * tFar - ux * yFar;
      const fy = ocy + S.dy * tFar - uy * yFar;
      const fz = ocz + S.dz * tFar - uz * yFar;
      if (fx * fx + fy * fy + fz * fz <= r2) {
        t = tFar;
        axial = yFar;
        hit = true;
      }
    }
  }
  if (!hit || !(t > 0)) return;
  const depth = viewDepth(S.ox + S.dx * t, S.oy + S.dy * t, S.oz + S.dz * t);
  if (!(depth > S.near) || !(depth < S.far)) return;
  if (bondFade(bonds, depth) <= 0.001) return;
  // Split-coloured: each half belongs to its own end atom.
  offer(t, axial < len / 2 ? a : b, KIND_BOND);
}

function testBondsOf(i: number): void {
  const bonds = S.g.bonds;
  if (!bonds || i >= bonds.atomCount || bonds.start[i] === bonds.start[i + 1]) return;
  for (let k = bonds.start[i], end = bonds.start[i + 1]; k < end; k += 1) testBond(bonds, bonds.ids[k]);
}

function visitExact(i: number): void {
  testAtom(i);
  testBondsOf(i);
}

/** One slab of the box: narrows S.t0..S.t1; false once the interval is empty. */
function clipSlab(origin: number, dir: number, lo: number, hi: number): boolean {
  if (Math.abs(dir) < 1e-12) return origin >= lo && origin <= hi;
  let ta = (lo - origin) / dir;
  let tb = (hi - origin) / dir;
  if (ta > tb) {
    const swap = ta;
    ta = tb;
    tb = swap;
  }
  if (ta > S.t0) S.t0 = ta;
  if (tb < S.t1) S.t1 = tb;
  return S.t0 <= S.t1;
}

/**
 * Clip the current ray (t ≥ 0) to the hash's box grown by `grow` into
 * S.t0..S.t1. False when the ray misses it.
 */
function clipRay(box: Readonly<Float64Array>, grow: number): boolean {
  S.t0 = 0;
  S.t1 = Infinity;
  return clipSlab(S.ox, S.dx, box[0] - grow, box[3] + grow)
    && clipSlab(S.oy, S.dy, box[1] - grow, box[4] + grow)
    && clipSlab(S.oz, S.dz, box[2] - grow, box[5] + grow);
}

/** How far from a visited atom's centre a drawn surface it carries can reach (long bonds aside). */
function exactReach(g: AtomPickGeometry): number {
  let reach = g.maxRadius * S.maxSwell;
  const bonds = g.bonds;
  if (bonds && bonds.reach > reach) reach = bonds.reach;
  return reach;
}

/** The front-most drawn atom or bond half on the current ray, into S.best / S.bestT / S.bestKind. */
function marchExact(): void {
  S.best = -1;
  S.bestT = Infinity;
  S.bestKind = KIND_NONE;
  const g = S.g;
  if (!S.useHash) {
    for (let i = 0; i < g.count; i += 1) testAtom(i);
    const bonds = g.bonds;
    if (bonds) for (let k = 0; k < bonds.count; k += 1) testBond(bonds, k);
    return;
  }
  // Long bonds once per ray; the march then finds anything nearer.
  const bonds = g.bonds;
  if (bonds) for (let k = 0; k < bonds.longIds.length; k += 1) testBond(bonds, bonds.longIds[k]);
  const reach = exactReach(g);
  if (!(reach > 0)) return;
  const hash = S.hash!;
  const box = hash.bounds!;
  // Every surface within `reach` of its atom's centre is found from the
  // sample nearest the ray's closest approach to that centre.
  let step = Math.min(Math.max(g.maxRadius, MIN_STEP), Math.max(hash.cellSize, MIN_STEP));
  let query = reach + step / 2;
  if (!clipRay(box, query)) return;
  if ((S.t1 - S.t0) / step > MAX_SAMPLES) {
    step = (S.t1 - S.t0) / MAX_SAMPLES;
    query = reach + step / 2;
    if (!clipRay(box, query)) return;
  }
  const t0 = S.t0;
  const t1 = S.t1;
  for (let k = 0; ; k += 1) {
    const t = t0 + k * step;
    // Nothing nearer than the best hit can be found past here.
    if (S.best >= 0 && t > S.bestT + reach + step) break;
    hash.forEachNear(S.ox + S.dx * t, S.oy + S.dy * t, S.oz + S.dz * t, query, visitExact);
    if (t >= t1) break;
  }
}

// ─── The soft phase ──────────────────────────────────────────────────

/** Project atom (x, y, z) to client CSS px into scratchPoint.x/y. */
function projectToClient(x: number, y: number, z: number): void {
  scratchPoint.set(x, y, z).project(S.camera!);
  const ndcX = scratchPoint.x;
  const ndcY = scratchPoint.y;
  scratchPoint.x = S.left + ((ndcX + 1) / 2) * S.width;
  scratchPoint.y = S.top + ((1 - ndcY) / 2) * S.height;
}

/** The last outline measured (`outlineGap`): projected centre, unit direction to the pointer, edge distance. */
const OUTLINE = { cx: 0, cy: 0, ux: 1, uy: 0, edge: 0 };

/**
 * How far (CSS px) client point (px, py) lies outside the drawn outline of an
 * atom of drawn radius r at (x, y, z), view depth `depth` (negative inside).
 * Measured from the atom's projected centre along the line through the point:
 * to the projected tangent cone (perspective: the ray d(s) through c + s·u is
 * affine in s, and the cone (d·C)² = |d|²(|C|² − r²) is a quadratic in s; in
 * orthographic a circle of r px-per-unit), cut by the impostor quad's screen
 * square. Leaves the centre, direction and edge distance in OUTLINE.
 */
function outlineGap(x: number, y: number, z: number, r: number, depth: number, px: number, py: number): number {
  projectToClient(x, y, z);
  const cx = scratchPoint.x;
  const cy = scratchPoint.y;
  let ux = px - cx;
  let uy = py - cy;
  const dist = Math.hypot(ux, uy);
  if (dist > 1e-9) {
    ux /= dist;
    uy /= dist;
  } else {
    ux = 1;
    uy = 0;
  }
  let edge: number;
  if (S.ortho) {
    edge = r * S.cssPx;
  } else {
    // View-space centre C = (vx, vy, -depth); the direction through c + s·u,
    // scaled to equal C at s = 0, is C + s·w (three's perspective matrix:
    // ndc = P00·X/d − P02, P11·Y/d − P12).
    const vx = S.m0 * x + S.m4 * y + S.m8 * z + S.m12;
    const vy = S.m1 * x + S.m5 * y + S.m9 * z + S.m13;
    const wx = (2 * depth * ux) / (S.width * S.p0);
    const wy = (-2 * depth * uy) / (S.height * S.p5);
    const r2 = r * r;
    const l2 = vx * vx + vy * vy + depth * depth;
    const k = l2 - r2;
    const wc = wx * vx + wy * vy;
    // f(s) = a·s² + 2b·s + c0: positive inside, zero on the outline.
    const qa = wc * wc - k * (wx * wx + wy * wy);
    const qb = wc * r2;
    const qc = l2 * r2;
    if (qa < 0) {
      const sq = Math.sqrt(qb * qb - qa * qc);
      edge = qb >= 0 ? (qb + sq) / -qa : qc / (sq - qb);
    } else {
      edge = (r * S.cssPx) / depth;
    }
    if (S.quad > 0) {
      // The quad: view x, y within quad·r of the centre's, at view depth depth − r.
      const front = depth - r;
      const half = S.quad * r;
      const x0 = S.left + ((S.p0 * (vx - half)) / front - S.p8 + 1) * (S.width / 2);
      const x1 = S.left + ((S.p0 * (vx + half)) / front - S.p8 + 1) * (S.width / 2);
      const y0 = S.top + (1 - ((S.p5 * (vy + half)) / front - S.p9)) * (S.height / 2);
      const y1 = S.top + (1 - ((S.p5 * (vy - half)) / front - S.p9)) * (S.height / 2);
      if (!(cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) {
        edge = 0;
      } else {
        if (ux > 0) edge = Math.min(edge, (x1 - cx) / ux);
        else if (ux < 0) edge = Math.min(edge, (x0 - cx) / ux);
        if (uy > 0) edge = Math.min(edge, (y1 - cy) / uy);
        else if (uy < 0) edge = Math.min(edge, (y0 - cy) / uy);
      }
    }
  }
  OUTLINE.cx = cx;
  OUTLINE.cy = cy;
  OUTLINE.ux = ux;
  OUTLINE.uy = uy;
  OUTLINE.edge = edge;
  return dist - edge;
}

function insertSoft(i: number, gap: number, depth: number, cx: number, cy: number, edge: number): void {
  let n = S.softCount;
  for (let k = 0; k < n; k += 1) if (softIndex[k] === i) return;
  let at = n;
  while (at > 0 && (softGap[at - 1] > gap || (softGap[at - 1] === gap && softDepth[at - 1] > depth))) at -= 1;
  if (at >= SOFT_CANDIDATES) return;
  if (n === SOFT_CANDIDATES) n -= 1; // the worst falls off
  for (let k = n; k > at; k -= 1) {
    softIndex[k] = softIndex[k - 1];
    softGap[k] = softGap[k - 1];
    softDepth[k] = softDepth[k - 1];
    softCx[k] = softCx[k - 1];
    softCy[k] = softCy[k - 1];
    softEdge[k] = softEdge[k - 1];
  }
  softIndex[at] = i;
  softGap[at] = gap;
  softDepth[at] = depth;
  softCx[at] = cx;
  softCy[at] = cy;
  softEdge[at] = edge;
  S.softCount = n + 1;
}

function visitSoft(i: number): void {
  const g = S.g;
  if (i >= g.count) return;
  const r = drawnRadius(g, i);
  if (r <= 0) return;
  const p = g.positions;
  const x = p[3 * i];
  const y = p[3 * i + 1];
  const z = p[3 * i + 2];
  if (x - x !== 0 || y - y !== 0 || z - z !== 0) return;
  const depth = drawnDepth(x, y, z, r);
  if (depth < 0) return;
  const gap = outlineGap(x, y, z, r, depth, S.px, S.py);
  if (gap <= S.tol) insertSoft(i, gap, depth, OUTLINE.cx, OUTLINE.cy, OUTLINE.edge);
}

/** Collect the atoms whose silhouette is within the tolerance of the pointer (the ray is the pointer's). */
function collectSoft(): void {
  S.softCount = 0;
  const g = S.g;
  const radius = g.maxRadius * S.maxSwell;
  if (!(radius > 0)) return;
  if (!S.useHash) {
    for (let i = 0; i < g.count; i += 1) visitSoft(i);
    return;
  }
  const hash = S.hash!;
  const box = hash.bounds!;
  // Two rays tol px apart on screen are tol × Z / cssPx apart at view depth
  // Z (perspective; tol / cssPx in orthographic). An outline point within tol
  // of the pointer is a tangent point at depth Z ≤ D + r, so the atom's
  // centre lies within r + tol × Z / cssPx of the ray, and with
  // Z ≤ (t* + 2r) / (1 − tol / cssPx) (t* its closest approach along the
  // ray) that is at most r + perT × (t* + 2r).
  const f = S.cssPx;
  if (!(f > 0) || (!S.ortho && !(f > S.tol))) return;
  const perT = S.ortho ? 0 : S.tol / (f - S.tol);
  const flat = S.ortho ? S.tol / f : 2 * perT * radius;
  let step = Math.min(Math.max(g.maxRadius, MIN_STEP), Math.max(hash.cellSize, MIN_STEP));
  // The far corner of the box bounds every depth the cone can reach.
  let far = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const cx = box[corner & 1 ? 3 : 0] - S.ox;
    const cy = box[corner & 2 ? 4 : 1] - S.oy;
    const cz = box[corner & 4 ? 5 : 2] - S.oz;
    far = Math.max(far, Math.sqrt(cx * cx + cy * cy + cz * cz));
  }
  // The query about the sample at t: radius, half a step, and the tolerance
  // at the deepest depth an atom found from that sample can have.
  if (!clipRay(box, radius + step / 2 + flat + perT * (far + radius + step / 2))) return;
  if ((S.t1 - S.t0) / step > MAX_SAMPLES) {
    step = (S.t1 - S.t0) / MAX_SAMPLES;
    if (!clipRay(box, radius + step / 2 + flat + perT * (far + radius + step / 2))) return;
  }
  const t0 = S.t0;
  const t1 = S.t1;
  for (let k = 0; ; k += 1) {
    const t = t0 + k * step;
    const query = radius + step / 2 + flat + perT * (t + step / 2);
    hash.forEachNear(S.ox + S.dx * t, S.oy + S.dy * t, S.oz + S.dz * t, query, visitSoft);
    if (t >= t1) break;
  }
}

/**
 * The near-miss pick: the candidate nearest the pointer (then nearest the
 * eye) that an exact pick just inside its drawn outline toward the pointer
 * actually returns, or -1.
 */
function pickSoft(clientX: number, clientY: number): number {
  collectSoft();
  const n = S.softCount;
  for (let k = 0; k < n; k += 1) {
    const i = softIndex[k];
    const cx = softCx[k];
    const cy = softCy[k];
    const edge = softEdge[k];
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    let qx = cx;
    let qy = cy;
    if (dist > 1e-9) {
      // Just inside the drawn outline, toward the pointer.
      const along = Math.max(0, edge - Math.min(1, edge / 2));
      qx = cx + (dx / dist) * along;
      qy = cy + (dy / dist) * along;
    }
    setRay(qx, qy);
    marchExact();
    if (S.best === i) return i;
  }
  return -1;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * The index of the atom picked at a client point (CSS px, as on pointer
 * events), or -1. `rect` is the canvas's client rect; `camera` the camera that
 * drew the frame (its matrices as last rendered: this never updates them).
 * `hash` is the atom layer's spatial hash; a stale or missing one falls back
 * to testing the drawn atoms one by one (up to `bruteForceMaxAtoms`, default
 * PICK_BRUTE_FORCE_MAX_ATOMS). Past that the result is -1 with `out.via`
 * 'unavailable', which a caller should not treat as a tap on empty space.
 */
export function pickAtom(
  geometry: AtomPickGeometry,
  hash: SpatialHash3D | null,
  camera: THREE.Camera,
  rect: PickRect,
  clientX: number,
  clientY: number,
  options?: AtomPickOptions,
  out?: AtomPickResult,
): number {
  let index = -1;
  let via: AtomPickResult['via'] = 'miss';
  let t = Number.NaN;
  const status = beginPick(geometry, hash, camera, rect, options);
  if (status === PICK_UNAVAILABLE) via = 'unavailable';
  if (status === PICK_READY) {
    try {
      setRay(clientX, clientY);
      marchExact();
      if (S.best >= 0) {
        index = S.best;
        via = S.bestKind === KIND_BOND ? 'bond' : 'atom';
        t = S.bestT;
      } else if (options?.soft !== false) {
        S.px = clientX;
        S.py = clientY;
        S.tol = pickTolerancePx(options?.pointerType);
        index = pickSoft(clientX, clientY);
        if (index >= 0) via = 'soft';
      }
    } finally {
      endPick();
    }
  }
  if (out) {
    out.index = index;
    out.via = via;
    out.t = t;
  }
  return index;
}

/**
 * How far (CSS px) a client point lies outside atom `index`'s drawn outline
 * (negative inside), or +Infinity when the atom is not drawn. Measured as the
 * near-miss pick measures it: from the atom's projected centre along the line
 * through the point, to the projected tangent cone cut by the impostor quad.
 */
export function atomSilhouetteGapPx(
  geometry: AtomPickGeometry,
  camera: THREE.Camera,
  rect: PickRect,
  clientX: number,
  clientY: number,
  index: number,
  options?: Pick<AtomPickOptions, 'swell' | 'bufferHeight'>,
): number {
  if (!(index >= 0 && index < geometry.count) || !(rect.width > 0) || !(rect.height > 0)) return Infinity;
  // One atom, measured directly: no search, no hash.
  S.g = geometry;
  S.cullPx = geometry.cullPixelRadius;
  setCamera(camera, rect, options);
  try {
    const r = drawnRadius(geometry, index);
    if (r <= 0) return Infinity;
    const p = geometry.positions;
    const x = p[3 * index];
    const y = p[3 * index + 1];
    const z = p[3 * index + 2];
    if (x - x !== 0 || y - y !== 0 || z - z !== 0) return Infinity;
    const depth = drawnDepth(x, y, z, r);
    if (depth < 0) return Infinity;
    return outlineGap(x, y, z, r, depth, clientX, clientY);
  } finally {
    endPick();
  }
}
