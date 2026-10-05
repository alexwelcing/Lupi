// Frames and the camera (scale-spec §8) [V]: placements from child to parent,
// node geometry in each node's own units, body frames and rebasing, and
// the magnification λ with its scale axis φ. Everything is binary64 and
// relative to a node near the camera; no position is absolute across
// levels, and nothing here is hashed or persisted.

import { ELEMENT_DATA } from '../elements';
import { fail, toHex } from './bytes';
import { boxChildren, SITES, type Box } from './crystal';
import { lnBig } from './magnitude';
import { canonicalPath, encodePath, splitRuns, runsLength, type AxisRuns, type DigitRun, type Step } from './paths';
import { periodDeterminant, type CrystalNode, type TowerNode, type Vec3n } from './records';
import { Resolver, type View } from './resolve';
import { levelsAlong, towerAxis, unitExponent } from './tower';

export type Vec3 = [number, number, number];
/** Row-major 3 × 3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** A rigid transform in binary64: x' = r · x + t. */
export interface RigidD {
  r: Mat3;
  t: Vec3;
}

/** A similarity: x' = s · r · x + t (§8.2). */
export interface Similarity {
  s: number;
  r: Mat3;
  t: Vec3;
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const IDENTITY_SIM: Similarity = { s: 1, r: IDENTITY3, t: [0, 0, 0] };
export const IDENTITY_RIGID: RigidD = { r: IDENTITY3, t: [0, 0, 0] };

export const mulMat = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
export const mulVec = (a: Mat3, v: Vec3): Vec3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];
export const transpose = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** a ∘ b: first b, then a. */
export function composeSim(a: Similarity, b: Similarity): Similarity {
  return { s: a.s * b.s, r: mulMat(a.r, b.r), t: add3(scale3(mulVec(a.r, b.t), a.s), a.t) };
}

export function invertSim(a: Similarity): Similarity {
  const rt = transpose(a.r);
  return { s: 1 / a.s, r: rt, t: scale3(mulVec(rt, a.t), -1 / a.s) };
}

export const applySim = (a: Similarity, x: Vec3): Vec3 => add3(scale3(mulVec(a.r, x), a.s), a.t);

export const applyRigid = (a: RigidD, x: Vec3): Vec3 => add3(mulVec(a.r, x), a.t);

export function invertRigid(a: RigidD): RigidD {
  const rt = transpose(a.r);
  return { r: rt, t: scale3(mulVec(rt, a.t), -1) };
}

export const composeRigid = (a: RigidD, b: RigidD): RigidD => ({ r: mulMat(a.r, b.r), t: add3(mulVec(a.r, b.t), a.t) });

/** R(q) for a unit quaternion (qx, qy, qz, qw). */
export function quaternionMatrix(q: readonly number[]): Mat3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

// ─── Node geometry ────────────────────────────────────────────────────

const idHexes = new WeakMap<Uint8Array, string>();
/** A NodeID's hex, cached on the id's bytes: keys are built every visit. */
export function hexOf(id: Uint8Array): string {
  let h = idHexes.get(id);
  if (!h) {
    h = toHex(id);
    idHexes.set(id, h);
  }
  return h;
}

/** A node's geometry in its own frame (units of f^u Å). Derived data, never identity. */
export interface Geometry {
  /** Bounds of the atom centres. */
  min: Vec3;
  max: Vec3;
  /** The toy radius of its largest element, in the node's units (§9.2). */
  rAtom: number;
  /** Local centre c(X) and bounding radius r(X) of the atom envelope. */
  centre: Vec3;
  radius: number;
  /** Narrowest width w(X) (§8.4). */
  width: number;
}

/** clamp(0.75 r_cov, 0.32, 0.90) Å (plan §3.6). */
export function toyRadius(z: number): number {
  const spec = ELEMENT_DATA[z];
  return Math.min(0.9, Math.max(0.32, 0.75 * (spec ? spec.radius : 1)));
}

/** The unit exponent of a view: u(k) for a tower level, 0 for everything else (§2.8). */
export const viewUnitExponent = (v: View): bigint => (v.type === 'level' ? unitExponent(v.k) : 0n);

/** f^(−u) as a binary64, 0 once it underflows. */
const unitScale = (f: number, u: bigint): number => (u > 2000n ? 0 : f ** -Number(u));

function envelope(min: Vec3, max: Vec3, rAtom: number, width: number): Geometry {
  const lo = sub3(min, [rAtom, rAtom, rAtom]);
  const hi = add3(max, [rAtom, rAtom, rAtom]);
  const centre = scale3(add3(lo, hi), 0.5);
  return { min, max, rAtom, centre, radius: len3(sub3(hi, centre)), width };
}

/**
 * The bounding sphere also covers the node's cell region [0, cells) (axis-aligned periods), so a
 * point of the region is never culled with a sphere that misses it.
 */
function withCells(g: Geometry, cells: Vec3): Geometry {
  if (cells.some((c) => !(c > 0))) return g;
  const corners = [sub3(g.min, [g.rAtom, g.rAtom, g.rAtom]), add3(g.max, [g.rAtom, g.rAtom, g.rAtom]), [0, 0, 0] as Vec3, cells];
  const min = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a]))) as Vec3;
  const max = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a]))) as Vec3;
  const centre = scale3(add3(min, max), 0.5);
  return { ...g, centre, radius: len3(sub3(max, centre)) };
}

function bboxOfPositions(positions: Float32Array): [Vec3, Vec3] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  return [min, max];
}

const shortestSide = (min: Vec3, max: Vec3, rAtom: number) => Math.min(...[0, 1, 2].map((a) => max[a] - min[a] + 2 * rAtom));

/** Q16 period vectors in Å. */
export const periodVectors = (periods: readonly Vec3n[]): Vec3[] => periods.map((p) => p.map((v) => Number(v) / 65536) as Vec3);

/** ω_a = |det| / |p_b × p_c|, the period cell's width across the faces spanned by the other two (§8.4), Å. */
export function periodWidths(periods: readonly Vec3n[]): Vec3 {
  const det = Math.abs(Number(periodDeterminant(periods))) / 65536 ** 3;
  const p = periodVectors(periods);
  return [0, 1, 2].map((a) => {
    const b = p[(a + 1) % 3];
    const c = p[(a + 2) % 3];
    const cross: Vec3 = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
    return det / len3(cross);
  }) as Vec3;
}

/** Number of seed copies along axis a in a level-k node, divided by its unit: f^(C(a,k) − u(k)), always 1 or f. */
export const levelSpan = (f: number, a: number, k: bigint): number => (k === 0n ? 1 : f ** Number(levelsAlong(a, k) - unitExponent(k)));

export class Geometries {
  private readonly memo = new Map<string, Geometry>();
  /** Boxes by crystal, then by shape. */
  private readonly boxes = new WeakMap<CrystalNode, Map<number | string, Geometry>>();
  /** Levels by tower, then by k (bigint keys compare by value). */
  private readonly levels = new Map<string, Map<bigint, Geometry>>();
  constructor(readonly resolver: Resolver) {}

  /** Geometry of a view in its own frame; memoized under the §9.6 aggregate keys. */
  of(v: View): Geometry {
    switch (v.type) {
      case 'level':
        return this.level(v.id, v.tower, v.k);
      case 'copy':
        return this.level(v.id, v.tower, 0n);
      case 'box':
        return this.box(v.id, v.crystal, v.box);
      default: {
        const key = v.type === 'selection' ? null : `n${hexOf(v.id)}`;
        const memo = key ? this.memo.get(key) : undefined;
        if (memo) return memo;
        const g = v.type === 'group' ? this.group(v) : this.atoms(v);
        if (key) this.memo.set(key, g);
        return g;
      }
    }
  }

  /** A crystal box's geometry: by (crystal, extents, far faces), as §9.6 keys box aggregates. */
  box(id: Uint8Array, c: CrystalNode, box: Box): Geometry {
    const e = [box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]];
    const far = (box.hi[0] === c.cells[0] ? 1 : 0) | (box.hi[1] === c.cells[1] ? 2 : 0) | (box.hi[2] === c.cells[2] ? 4 : 0);
    let byShape = this.boxes.get(c);
    if (!byShape) {
      byShape = new Map();
      this.boxes.set(c, byShape);
    }
    // Extents below 2^16 pack into one exact number; larger ones fall back to a string.
    const small = e[0] < 65536n && e[1] < 65536n && e[2] < 65536n;
    const key = small ? Number(e[0]) + 65536 * Number(e[1]) + 65536 ** 2 * Number(e[2]) + 65536 ** 3 * far : `${e.join(',')}:${far}`;
    const memo = byShape.get(key);
    if (memo) return memo;
    const q = c.quarter / 65536;
    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a += 1) {
      const sites = SITES[c.structure].map((site) => site[a]);
      min[a] = Math.min(...sites) * q;
      max[a] = c.termination === 1 && (far >> a) & 1 ? 4 * Number(e[a]) * q : (4 * (Number(e[a]) - 1) + Math.max(...sites)) * q;
    }
    const rAtom = Math.max(toyRadius(c.a), toyRadius(c.b || c.a));
    const g = withCells(envelope(min, max, rAtom, Math.min(...e.map((x) => 4 * Number(x) * q))), e.map((x) => 4 * Number(x) * q) as Vec3);
    byShape.set(key, g);
    void id;
    return g;
  }

  /** A tower level's geometry in its own units, by (tower, k); level 0 is a seed copy's, with the substitution's element. */
  level(id: Uint8Array, t: TowerNode, k: bigint): Geometry {
    const tower = hexOf(id);
    let byLevel = this.levels.get(tower);
    if (!byLevel) {
      byLevel = new Map();
      this.levels.set(tower, byLevel);
    }
    const memo = byLevel.get(k);
    if (memo) return memo;
    const seed = this.of(this.resolver.root(t.seed));
    const toZ = t.substitution ? toyRadius(t.substitution.toZ) : 0;
    let g: Geometry;
    const p0 = periodVectors(t.periods);
    const aligned = t.periods.every((p, a) => p.every((x, i) => i === a || x === 0n));
    const cellsOf = (span: (a: number) => number): Vec3 => (aligned ? ([0, 1, 2].map((a) => span(a) * p0[a][a]) as Vec3) : [0, 0, 0]);
    if (k === 0n) {
      g = withCells({ ...seed, rAtom: Math.max(seed.rAtom, toZ) }, cellsOf(() => 1));
    } else {
      const u = unitExponent(k);
      const shrink = unitScale(t.factor, u);
      const p = periodVectors(t.periods);
      const min = scale3(seed.min, shrink);
      const max = scale3(seed.max, shrink);
      for (let a = 0; a < 3; a += 1) {
        const reach = levelSpan(t.factor, a, k) - shrink;
        for (let i = 0; i < 3; i += 1) {
          const d = reach * p[a][i];
          if (d < 0) min[i] += d;
          else max[i] += d;
        }
      }
      const omega = periodWidths(t.periods);
      const width = Math.min(...[0, 1, 2].map((a) => levelSpan(t.factor, a, k) * omega[a]));
      g = withCells(envelope(min, max, Math.max(seed.rAtom, toZ) * shrink, width), cellsOf((a) => levelSpan(t.factor, a, k)));
    }
    byLevel.set(k, g);
    return g;
  }

  private atoms(v: View): Geometry {
    const leaf = this.resolver.materialize(v);
    const [min, max] = bboxOfPositions(leaf.positions);
    let rAtom = 0.32;
    for (let i = 0; i < leaf.z.length; i += 1) rAtom = Math.max(rAtom, toyRadius(leaf.z[i]));
    return envelope(min, max, rAtom, shortestSide(min, max, rAtom));
  }

  private group(v: Extract<View, { type: 'group' }>): Geometry {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    let rAtom = 0.32;
    v.group.children.forEach((child, i) => {
      const g = this.of(this.resolver.step(stripRemovals(v), { tag: 'child', index: i }));
      rAtom = Math.max(rAtom, g.rAtom);
      const R = quaternionMatrix(child.rotation);
      for (const corner of corners(g.min, g.max)) {
        const x = add3(mulVec(R, corner), child.translation);
        for (let a = 0; a < 3; a += 1) {
          min[a] = Math.min(min[a], x[a]);
          max[a] = Math.max(max[a], x[a]);
        }
      }
    });
    return envelope(min, max, rAtom, shortestSide(min, max, rAtom));
  }
}

const stripRemovals = (v: View): View => ({ ...v, removals: [] }) as View;

export function corners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) out.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  return out;
}

// ─── Placements (§8.2) ────────────────────────────────────────────────

/** One level of descent: a child selector and its placement into the parent. */
export interface ChildStep {
  step: Step;
  /** The octant, tower digit or group child index (§9.7's i). */
  index: number;
  placement: Similarity;
  /** For a box's octant, the child box. */
  box?: Box;
}

/** A level's children depend only on its tower, its axis and whether it changes unit (§8.2). Treat as immutable. */
const levelChildren = new WeakMap<TowerNode, Map<number, ChildStep[]>>();

/** The children of a view one level down, with their placements. Leaves of the hierarchy have none. */
export function childSteps(v: View): ChildStep[] {
  switch (v.type) {
    case 'group':
      return v.group.children.map((c, i) => ({
        step: { tag: 'child', index: i },
        index: i,
        placement: { s: 1, r: quaternionMatrix(c.rotation), t: [...c.translation] as Vec3 },
      }));
    case 'box': {
      const q = v.crystal.quarter / 65536;
      return boxChildren(v.box).map(({ octant, box }) => ({
        step: { tag: 'cells', octants: [octant] },
        index: octant,
        box,
        placement: { s: 1, r: IDENTITY3, t: [0, 1, 2].map((a) => Number(4n * (box.lo[a] - v.box.lo[a])) * q) as Vec3 },
      }));
    }
    case 'level': {
      const t = v.tower;
      const axis = towerAxis(v.k);
      const shrinks = v.k % 3n === 1n && v.k >= 4n;
      let byTower = levelChildren.get(t);
      if (!byTower) {
        byTower = new Map();
        levelChildren.set(t, byTower);
      }
      const key = axis * 2 + (shrinks ? 1 : 0);
      let steps = byTower.get(key);
      if (!steps) {
        const p = periodVectors(t.periods)[axis];
        const s = shrinks ? 1 / t.factor : 1;
        steps = Array.from({ length: t.factor }, (_, j) => {
          const runs: AxisRuns = [[], [], []];
          runs[axis] = [{ digit: j, length: 1n }];
          return { step: { tag: 'tower', levels: 1n, runs }, index: j, placement: { s, r: IDENTITY3, t: scale3(p, j) } };
        });
        byTower.set(key, steps);
      }
      return steps;
    }
    default:
      return [];
  }
}

const powF = (f: number, e: bigint): number => (e < -1100n ? 0 : e > 1100n ? Infinity : f ** Number(e));

/**
 * A whole step's placement in its parent's units, for a step of any length:
 * a tower step's digit runs sum as geometric series, so 10¹⁰⁰ levels cost
 * their runs. Binary64: digits far below the parent's unit vanish.
 */
export function stepPlacement(resolver: Resolver, parent: View, step: Step): { view: View; placement: Similarity } {
  const view = resolver.step(parent, step);
  if (step.tag === 'child' && parent.type === 'group') {
    const c = parent.group.children[step.index];
    return { view, placement: { s: 1, r: quaternionMatrix(c.rotation), t: [...c.translation] as Vec3 } };
  }
  if (step.tag === 'cells' && parent.type === 'box' && view.type === 'box') {
    const q = parent.crystal.quarter / 65536;
    return { view, placement: { s: 1, r: IDENTITY3, t: [0, 1, 2].map((a) => Number(4n * (view.box.lo[a] - parent.box.lo[a])) * q) as Vec3 } };
  }
  if (step.tag === 'tower' && parent.type === 'level') {
    const f = parent.tower.factor;
    const uK = unitExponent(parent.k);
    const p = periodVectors(parent.tower.periods);
    let t: Vec3 = [0, 0, 0];
    for (let a = 0; a < 3; a += 1) {
      // A digit at a level of unit exponent u moves its copy u − u(K) parent units' worth of periods.
      let u = levelsAlong(a, parent.k) - 1n;
      for (const run of step.runs[a]) {
        const hi = u - uK;
        if (run.digit !== 0) t = add3(t, scale3(p[a], (run.digit * (powF(f, hi + 1n) - powF(f, hi - run.length + 1n))) / (f - 1)));
        u -= run.length;
      }
    }
    return { view, placement: { s: powF(f, unitExponent(parent.k - step.levels) - uK), r: IDENTITY3, t } };
  }
  return fail('path', 'no placement for this step');
}

// ─── From a point to a step (§4.8) ────────────────────────────────────

/** The child of `v` that holds the point x (in v's frame), or null. */
export function childToward(geometries: Geometries, v: View, x: Vec3): ChildStep | null {
  switch (v.type) {
    case 'group': {
      let best: ChildStep | null = null;
      let bestDistance = Infinity;
      for (const c of childSteps(v)) {
        const g = geometries.of(geometries.resolver.step(stripRemovals(v), c.step));
        const local = applySim(invertSim(c.placement), x);
        const inside = [0, 1, 2].every((a) => local[a] >= g.centre[a] - (g.centre[a] - g.min[a]) - g.rAtom && local[a] <= g.max[a] + g.rAtom);
        if (!inside) continue;
        const d = len3(sub3(local, g.centre));
        if (d < bestDistance) {
          best = c;
          bestDistance = d;
        }
      }
      return best;
    }
    case 'box': {
      const q = v.crystal.quarter / 65536;
      let o = 0;
      for (let a = 0; a < 3; a += 1) {
        const e = v.box.hi[a] - v.box.lo[a];
        if (e < 2n) continue;
        const mid = Number((e + 1n) / 2n) * 4 * q;
        if (x[a] >= mid) o |= 1 << a;
      }
      return childSteps(v).find((c) => c.index === o) ?? null;
    }
    case 'level': {
      const t = v.tower;
      const p = periodVectors(t.periods);
      const c = solveBasis(p, x);
      const axis = towerAxis(v.k);
      const j = Math.min(t.factor - 1, Math.max(0, Math.floor(c[axis])));
      return childSteps(v)[j];
    }
    default:
      return null;
  }
}

/** Coordinates of x in the basis of the three period vectors (binary64). */
export function solveBasis(p: Vec3[], x: Vec3): Vec3 {
  const m: Mat3 = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], p[0][2], p[1][2], p[2][2]];
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const inv: Mat3 = [
    (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det,
  ];
  return mulVec(inv, x);
}

// ─── Body frames and rebasing (§8.3, §8.4) ────────────────────────────

export interface BodyFrame {
  /** The body's piece: a root and a path (§7). */
  root: Uint8Array;
  path: Step[];
  /** From the body's node to its anchor A: runtime state, unlimited, canonical. */
  anchorPath: Step[];
  worldFromAnchor: RigidD;
  /** σ_A, metres per anchor unit. */
  metresPerAnchorUnit: number;
  /** Runtime: the resolver the body's records live in. */
  resolver: Resolver;
}

export const REBASE = { descendWidth: 40, ascendWidth: 20, radiusCap: 1e8, stepsPerFrame: 2 } as const;

export function bodyView(frame: BodyFrame): View {
  return frame.resolver.resolve(frame.root, frame.path);
}

export function anchorView(frame: BodyFrame): View {
  return frame.resolver.walk(bodyView(frame), frame.anchorPath);
}

/**
 * Removes the deepest level of an anchor path, the inverse of one descent:
 * the last octant of a cells step, the last child step, or the lowest level
 * of a tower step (whose digit is the last on the parent level's axis).
 */
export function popLevel(path: Step[], anchor: View): Step[] {
  const out = [...path];
  const last = out[out.length - 1];
  if (!last) fail('path', 'the anchor is the body node');
  if (last.tag === 'cells' && last.octants.length > 1) {
    out[out.length - 1] = { tag: 'cells', octants: last.octants.slice(0, -1) };
    return out;
  }
  if (last.tag !== 'tower' || last.levels === 1n) return out.slice(0, -1);
  // The anchor is a level k ≥ 1, or level 0 (a copy, or the seed's own view).
  const axis = towerAxis((anchor.type === 'level' ? anchor.k : 0n) + 1n);
  const runs = last.runs.map((r) => r.map((x) => ({ ...x }))) as AxisRuns;
  runs[axis] = splitRuns(runs[axis], runsLength(runs[axis]) - 1n)[0];
  out[out.length - 1] = { tag: 'tower', levels: last.levels - 1n, runs };
  return out;
}

/**
 * §8.4: descend toward the focus while the child is at least 40 m wide (or
 * the anchor's radius passes 10⁸ m), ascend while the anchor is under 20 m
 * wide, at most two steps. A rebase changes the representation, not the
 * state: worldFromAnchor and σ follow every step.
 */
export function rebase(frame: BodyFrame, focusWorld: Vec3, geometries = new Geometries(frame.resolver)): BodyFrame {
  let f = { ...frame };
  for (let n = 0; n < REBASE.stepsPerFrame; n += 1) {
    const a = anchorView(f);
    const g = geometries.of(a);
    const sigma = f.metresPerAnchorUnit;
    const local = scale3(applyRigid(invertRigid(f.worldFromAnchor), focusWorld), 1 / sigma);
    const toward = childToward(geometries, a, local);
    if (toward) {
      const child = f.resolver.step(a, toward.step);
      const cw = geometries.of(child).width * sigma * toward.placement.s;
      if (cw >= REBASE.descendWidth || g.radius * sigma > REBASE.radiusCap) {
        f = descend(f, toward);
        continue;
      }
    }
    if (g.width * sigma < REBASE.ascendWidth && f.anchorPath.length > 0) {
      f = ascend(f);
      continue;
    }
    break;
  }
  return f;
}

export function descend(frame: BodyFrame, toward: ChildStep): BodyFrame {
  const p = toward.placement;
  const sigma = frame.metresPerAnchorUnit;
  return {
    ...frame,
    anchorPath: canonicalPath([...frame.anchorPath, toward.step]),
    worldFromAnchor: {
      r: mulMat(frame.worldFromAnchor.r, p.r),
      t: add3(frame.worldFromAnchor.t, mulVec(frame.worldFromAnchor.r, scale3(p.t, sigma))),
    },
    metresPerAnchorUnit: sigma * p.s,
  };
}

/** The inverse of a descent: the anchor's placement in its parent, found by re-walking to the parent. */
export function ascend(frame: BodyFrame): BodyFrame {
  const anchor = anchorView(frame);
  const parentPath = popLevel(frame.anchorPath, anchor);
  const parent = frame.resolver.walk(bodyView(frame), parentPath);
  const last = frame.anchorPath[frame.anchorPath.length - 1];
  const child = childSteps(parent).find((c) => sameChild(c.step, last, parent));
  if (!child) fail('path', 'the anchor is not a child of its parent');
  const p = child.placement;
  const sigmaParent = frame.metresPerAnchorUnit / p.s;
  // worldFromParent = worldFromAnchor ∘ placement⁻¹.
  const rParent = mulMat(frame.worldFromAnchor.r, transpose(p.r));
  return {
    ...frame,
    anchorPath: parentPath,
    worldFromAnchor: { r: rParent, t: sub3(frame.worldFromAnchor.t, mulVec(rParent, scale3(p.t, sigmaParent))) },
    metresPerAnchorUnit: sigmaParent,
  };
}

function sameChild(candidate: Step, last: Step, parent: View): boolean {
  if (candidate.tag !== last.tag) return false;
  if (candidate.tag === 'child' && last.tag === 'child') return candidate.index === last.index;
  if (candidate.tag === 'cells' && last.tag === 'cells') return candidate.octants[0] === last.octants[last.octants.length - 1];
  if (candidate.tag === 'tower' && last.tag === 'tower' && parent.type === 'level') {
    const axis = towerAxis(parent.k);
    const digits: DigitRun[] = last.runs[axis];
    return candidate.runs[axis][0].digit === digits[digits.length - 1].digit;
  }
  return false;
}

// ─── Magnification and the scale axis (§8.7, §8.8) ────────────────────

/** λ held as the pair (u(A), ℓ): λ = ℓ − u · log10 f, ℓ = log10 σ_A + 10. */
export interface Magnification {
  u: bigint;
  f: number;
  ell: number;
}

export function magnification(frame: BodyFrame, anchor = anchorView(frame)): Magnification {
  const f = anchor.type === 'level' ? anchor.tower.factor : 10;
  return { u: viewUnitExponent(anchor), f, ell: Math.log10(frame.metresPerAnchorUnit) + 10 };
}

/** λ in binary64 while u · log10 f < 2⁵⁰; beyond, use phi() which works from the pair. */
export const lambdaOf = (m: Magnification): number => m.ell - Number(m.u) * Math.log10(m.f);

/** φ(λ) of §8.8, finite for every v1 tower: from the pair once u · log10 f passes 2⁵⁰ (§8.7). */
export function phi(m: Magnification): number {
  const big = Number(m.u) * Math.log10(m.f) >= 2 ** 50;
  if (!big) {
    const lambda = lambdaOf(m);
    return Math.abs(lambda) <= 32 ? lambda : Math.sign(lambda) * 32 * (1 + Math.log(Math.abs(lambda) / 32));
  }
  const lnAbs = lnBig(m.u) + Math.log(Math.log10(m.f));
  return -32 * (1 + lnAbs - Math.log(32));
}

export const phiOfLambda = (lambda: number): number =>
  Math.abs(lambda) <= 32 ? lambda : Math.sign(lambda) * 32 * (1 + Math.log(Math.abs(lambda) / 32));

// ─── Drawing relative to a nearby origin (§8.5) ───────────────────────

/** A Float32 3 × 4 (row-major rotation·scale | translation), cast once from binary64. */
export function toFloat32x34(s: Similarity): Float32Array {
  const out = new Float32Array(12);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) out[4 * i + j] = s.s * s.r[3 * i + j];
    out[4 * i + 3] = s.t[i];
  }
  return out;
}

/** A stable display string of a path from a body node, for hysteresis and residency keys. */
export const pathKey = (steps: Step[]): string => toHex(encodePath(steps, { unlimited: true }));
