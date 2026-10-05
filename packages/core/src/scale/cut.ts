// The screen-space-error cut (scale-spec §9) [V]: what each node draws as
// when it is not refined, where the traversal starts, and the budgeted
// max-heap refinement. No step depends on the atom count: a frame costs
// what is on screen, for a water or a googolplex alike.

import { concatBytes, ScaleError, toHex } from './bytes';
import {
  add3,
  anchorView,
  hexOf,
  applyRigid,
  applySim,
  bodyView,
  childSteps,
  composeSim,
  Geometries,
  IDENTITY3,
  IDENTITY_SIM,
  len3,
  levelSpan,
  mulVec,
  periodVectors,
  scale3,
  sub3,
  toFloat32x34,
  viewUnitExponent,
  type BodyFrame,
  type ChildStep,
  type Geometry,
  type RigidD,
  type Similarity,
  type Vec3,
} from './frames';
import { DOMAIN_REF, leU64, mix64, sha256, SPLITMIX_GOLDEN } from './hash';
import type { Magnitude } from './magnitude';
import { canonicalPath, encodePath, runsLength, type AxisRuns, type DigitRun, type Step } from './paths';
import type { LeafNode } from './records';
import type { Resolver, View } from './resolve';
import { boxChild } from './crystal';
import { unitExponent } from './tower';

// ─── Budgets (§9.3) ───────────────────────────────────────────────────

export type ThermalLevel = 'fair' | 'serious' | 'critical';

export interface Budgets {
  tau: number;
  visits: number;
  items: number;
  /** Atoms drawn by RealityKit instancing (before LupiEngine). */
  instancedAtoms: number;
  engineAtoms: number;
  boxesAndSplats: number;
  /** Leaf materializations per frame (background). */
  materializations: number;
  meshBuilds: number;
  residentBytes: number;
}

const MB = 1024 * 1024;

/** §9.3's starting values for the iPhone 15 Pro (est.; spikes S1, S2, S7 and S10 replace them). */
export function iPhone15ProBudgets(thermal: ThermalLevel = 'fair'): Budgets {
  const t = {
    fair: [1.5, 8192, 4096, 5000, 150000, 32000, 8],
    serious: [1.5, 6144, 3072, 3000, 75000, 24000, 4],
    critical: [2.0, 4096, 2048, 2000, 50000, 16000, 2],
  }[thermal];
  return {
    tau: t[0], visits: t[1], items: t[2], instancedAtoms: t[3], engineAtoms: t[4], boxesAndSplats: t[5],
    materializations: t[6], meshBuilds: 1, residentBytes: 192 * MB,
  };
}

export function iPadProBudgets(): Budgets {
  return {
    tau: 1.5, visits: 12288, items: 8192, instancedAtoms: 8000, engineAtoms: 250000, boxesAndSplats: 48000,
    materializations: 12, meshBuilds: 2, residentBytes: 384 * MB,
  };
}

/** τ's thermal minimum (§9.3); the controllers keep τ in [TAU_MIN, 8]. */
export const TAU_MIN: Record<ThermalLevel, number> = { fair: 1.0, serious: 1.5, critical: 2.0 };

/**
 * §9.3's τ: the larger of a frame-time and a budget controller, each kept in
 * [τ_min, 8]. Both are evaluated over 0.5 s windows, except that an
 * overBudget cut raises the budget controller for the very next frame.
 * Times are in seconds, as `ARFrame` timestamps are.
 */
export class TauController {
  private frameTau: number;
  private budgetTau: number;
  private windowStart: number | null = null;
  private dropInWindow = false;
  private lastDrop: number | null = null;
  private lastTime: number | null = null;
  private calmSince: number | null = null;

  constructor(
    private tauMin: number = TAU_MIN.fair,
    start = 1.5,
  ) {
    this.frameTau = this.clamp(start);
    this.budgetTau = this.clamp(start);
  }

  get tau(): number {
    return Math.max(this.frameTau, this.budgetTau);
  }

  get controllers(): { frameTime: number; budget: number } {
    return { frameTime: this.frameTau, budget: this.budgetTau };
  }

  /** A thermal change moves the floor; τ itself only rises to meet it. */
  setMinimum(tauMin: number): void {
    this.tauMin = tauMin;
    this.frameTau = this.clamp(this.frameTau);
    this.budgetTau = this.clamp(this.budgetTau);
  }

  /** One drawn frame at time t with the display period, and the cut it drew. Returns the next frame's τ. */
  frame(t: number, period: number, cut: Pick<Cut, 'overBudget' | 'used' | 'visited'>, budgets: Budgets): number {
    if (this.lastTime !== null && t - this.lastTime > 1.5 * period) {
      this.dropInWindow = true;
      this.lastDrop = t;
    }
    this.lastTime = t;
    // The 2 s without a drop count from the first frame.
    this.lastDrop ??= t;
    this.windowStart ??= t;
    if (t - this.windowStart >= 0.5) {
      // The window's verdict: a dropped frame raises τ, 2 s without one lowers it.
      if (this.dropInWindow) this.frameTau = this.clamp(this.frameTau * 1.25);
      else if (t - this.lastDrop >= 2) this.frameTau = this.clamp(this.frameTau * 0.95);
      this.windowStart = t;
      this.dropInWindow = false;
    }
    const busy =
      cut.used.items >= 0.8 * budgets.items ||
      cut.used.boxesAndSplats >= 0.8 * budgets.boxesAndSplats ||
      cut.used.instancedAtoms >= 0.8 * budgets.instancedAtoms ||
      cut.visited >= 0.8 * budgets.visits;
    if (cut.overBudget) {
      this.budgetTau = this.clamp(this.budgetTau * 1.25);
      this.calmSince = null;
    } else if (busy) {
      this.calmSince = null;
    } else {
      this.calmSince ??= t;
      if (t - this.calmSince >= 0.5) {
        this.budgetTau = this.clamp(this.budgetTau * 0.9);
        this.calmSince = t;
      }
    }
    return this.tau;
  }

  /** LupiEngine (M3b): the pass's own GPU time, steered toward 8 ms. */
  gpuTime(ms: number): number {
    this.frameTau = this.clamp(this.frameTau * Math.exp((0.5 * (ms - 8)) / 8));
    return this.tau;
  }

  private clamp(tau: number): number {
    return Math.min(8, Math.max(this.tauMin, tau));
  }
}

// ─── View, items and the cut ──────────────────────────────────────────

export interface ViewState {
  cameraFromWorld: RigidD;
  /** Vertical field of view, radians. */
  fovY: number;
  viewportHeight: number;
  /** Width over height; 1 when absent. */
  aspect?: number;
  zNear: number;
  zFar: number;
  /** The excavation bubble's radius when the camera is inside solid terrain (§10.1), metres. */
  bubble?: number;
}

export type DrawKind = 'leafMesh' | 'atomInstances' | 'box' | 'splats' | 'facePlane' | 'atomsGPU' | 'clusterSplats';

export interface Splat {
  centre: Vec3;
  radius: number;
}

export interface DrawItem {
  kind: DrawKind;
  body: number;
  /** From the body's node. */
  path: Step[];
  /** entityFromItem (§8.5): Float32 3 × 4, cast once from binary64. */
  transform: Float32Array;
  fade: number;
  key32: number;
  /** Binary64 anchorFromItem, and the item's local centre c(X) in its units. */
  anchorFromItem: Similarity;
  centre: Vec3;
  extras: {
    /** A box: its corners in the item's units. */
    min?: Vec3;
    max?: Vec3;
    splats?: Splat[];
    /** The atoms drawn: all of a leaf's, or a solid node's exposed ones. */
    atoms?: number;
    atomIndices?: number[];
    /** A face plane in anchor units: n · x = offset, n outward. */
    normal?: Vec3;
    offset?: number;
  };
}

export interface CutUsage {
  items: number;
  boxesAndSplats: number;
  instancedAtoms: number;
}

export interface CutRegion {
  body: number;
  anchorFromNode: Similarity;
  min: Vec3;
  max: Vec3;
  why: 'enclosed' | 'culled';
}

export interface Cut {
  items: DrawItem[];
  /** Each body's exact count, for the HUD (it sums them when it can, §5.2). */
  bodyCounts: Magnitude[];
  drawnAtoms: number;
  visited: number;
  /** Every pop: emits and visits, at most items + visits (§9.5). */
  pops: number;
  overBudget: boolean;
  used: CutUsage;
  /** Nodes refined this frame, for next frame's hysteresis. */
  refined: Set<string>;
  /** Runtime: materialized leaves kept across frames (§9.6). */
  residency: Residency;
  /** Runtime: geometry and start keys kept across frames. */
  cache: CutCache;
  /** Materializations requested this frame and those done (at most the budget). */
  requested: number;
  materialized: number;
  /** With options.debug: the regions skipped as enclosed or culled. */
  skipped?: CutRegion[];
}

/** §9.6 residency: materialized leaves under their aggregate keys, LRU by bytes. */
export class Residency {
  private readonly map = new Map<string, LeafNode>();
  bytes = 0;
  constructor(readonly capacity = 192 * MB) {}
  get(key: string): LeafNode | undefined {
    const leaf = this.map.get(key);
    if (leaf) {
      this.map.delete(key);
      this.map.set(key, leaf);
    }
    return leaf;
  }
  set(key: string, leaf: LeafNode): void {
    if (this.map.has(key)) return;
    this.map.set(key, leaf);
    this.bytes += 13 * leaf.z.length;
    for (const [k, l] of this.map) {
      if (this.bytes <= this.capacity) break;
      this.map.delete(k);
      this.bytes -= 13 * l.z.length;
    }
  }
}

/** What a cut keeps for the next frame besides residency: aggregates, and start keys per anchor. */
export class CutCache {
  readonly geometries = new Map<Resolver, Geometries>();
  /** §9.7: a starting node's key64 is computed once when the anchor changes, here per anchor path object. */
  readonly startKeys = new WeakMap<Step[], WeakMap<Step[], Map<string, { pathKey: string; key64: bigint }>>>();
}

// ─── Nodes ────────────────────────────────────────────────────────────

const ALL_FACES = 63;

/** Where a node sits in a solid tower: its digits from the tower's top and the part above the body. */
interface TowerPlace {
  trail: AxisRuns;
  base: bigint[];
  f: number;
}

interface CutNode {
  body: number;
  view: View;
  /** The full path from the body's node; extended lazily as `parent` + `step`. */
  prefix: Step[] | null;
  parent: CutNode | null;
  step: Step | null;
  key: string;
  key64: bigint;
  /** anchorFromNode, in anchor units. */
  sim: Similarity;
  geometry: Geometry;
  epsilon: number;
  solid: boolean;
  standIn: 'box' | 'splats' | 'leafMesh';
  splats?: Splat[];
  /** Refines into its own atoms rather than into children. */
  atomic: boolean;
  /** A final atoms item. */
  atoms: boolean;
  atomIndices?: number[];
  atomCount: number;
  place: TowerPlace | null;
  /** Faces exposed by the enclosing solid frame: low x, high x, low y, … as bits 0–5. */
  context: number;
  removalsAbove: boolean;
  rho: number;
  area: number;
  cost: CutUsage;
}

const ZERO_USAGE: CutUsage = { items: 0, boxesAndSplats: 0, instancedAtoms: 0 };
const addUsage = (u: CutUsage, c: CutUsage, sign = 1): CutUsage => ({
  items: u.items + sign * c.items,
  boxesAndSplats: u.boxesAndSplats + sign * c.boxesAndSplats,
  instancedAtoms: u.instancedAtoms + sign * c.instancedAtoms,
});
const fits = (u: CutUsage, b: Budgets): boolean =>
  u.items <= b.items && u.boxesAndSplats <= b.boxesAndSplats && u.instancedAtoms <= b.instancedAtoms;

class Heap {
  private readonly a: CutNode[] = [];
  get size(): number {
    return this.a.length;
  }
  private better(x: CutNode, y: CutNode): boolean {
    if (x.rho !== y.rho) return x.rho > y.rho;
    if (x.area !== y.area) return x.area > y.area;
    return (x.key64 & 0xffffffffn) < (y.key64 & 0xffffffffn);
  }
  push(n: CutNode): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.better(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): CutNode {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.better(a[l], a[m])) m = l;
        if (r < a.length && this.better(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

// ─── Digit runs as indices (§9.4) ─────────────────────────────────────

/** ±1 on the number a digit-run list spells, most significant first; null past either end. */
export function stepIndex(runs: readonly DigitRun[], f: number, delta: 1 | -1): DigitRun[] | null {
  const out = runs.map((r) => ({ ...r }));
  const wrap = delta === 1 ? f - 1 : 0;
  const last = out[out.length - 1];
  if (!last) return null;
  let tail = 0n;
  if (last.digit === wrap) {
    tail = last.length;
    out.pop();
  }
  const prev = out[out.length - 1];
  if (!prev) return null;
  prev.length -= 1n;
  const changed = { digit: prev.digit + delta, length: 1n };
  if (prev.length === 0n) out.pop();
  const result: DigitRun[] = [];
  const push = (d: number, l: bigint) => {
    if (l <= 0n) return;
    const t = result[result.length - 1];
    if (t && t.digit === d) t.length += l;
    else result.push({ digit: d, length: l });
  };
  for (const r of out) push(r.digit, r.length);
  push(changed.digit, changed.length);
  push(delta === 1 ? 0 : f - 1, tail);
  return result;
}


/** The exposed faces of a tower node from its digits below the body (§9.4, §9.5): a face is exposed at the edge of the body. */
function towerFaces(place: TowerPlace): number {
  let mask = 0;
  for (let a = 0; a < 3; a += 1) {
    // Only the digits after the first base[a] count: those below the body.
    let skip = place.base[a];
    let low = true;
    let high = true;
    for (const r of place.trail[a]) {
      if (skip >= r.length) {
        skip -= r.length;
        continue;
      }
      skip = 0n;
      if (r.digit !== 0) low = false;
      if (r.digit !== place.f - 1) high = false;
      if (!low && !high) break;
    }
    if (low) mask |= 1 << (2 * a);
    if (high) mask |= 2 << (2 * a);
  }
  return mask;
}

// ─── The cut ──────────────────────────────────────────────────────────

interface BodyContext {
  index: number;
  frame: BodyFrame;
  resolver: Resolver;
  geometries: Geometries;
  anchor: View;
  /** worldFromAnchor with σ_A folded in: world = r · (σ_A x) + t. */
  sigma: number;
  anchorCentre: Vec3;
  bodyPlace: TowerPlace | null;
}

export interface CutOptions {
  /** Report the regions skipped as enclosed or culled (for coverage tests). */
  debug?: boolean;
  /** Caches to share when there is no previous cut. */
  cache?: CutCache;
}

/**
 * §9.5: the budgeted max-heap traversal. Budgets are never exceeded, every
 * frame makes at most items + visits pops, and a node is refined while
 * ρ > τ, or while ρ ≥ τ/2 if it was refined last frame.
 */
export function buildCut(bodies: BodyFrame[], view: ViewState, budgets: Budgets, previous?: Cut, options: CutOptions = {}): Cut {
  const residency = previous?.residency ?? new Residency(budgets.residentBytes);
  const cache = previous?.cache ?? options.cache ?? new CutCache();
  const geometryCache = cache.geometries;
  const K = view.viewportHeight / (2 * Math.tan(view.fovY / 2));
  const tanY = Math.tan(view.fovY / 2);
  const tanX = tanY * (view.aspect ?? 1);
  const planes: Vec3[] = [
    [0, 1, tanY], [0, -1, tanY], [1, 0, tanX], [-1, 0, tanX],
  ].map((n) => scale3(n as Vec3, 1 / len3(n as Vec3)));
  const skipped: CutRegion[] | undefined = options.debug ? [] : undefined;

  const contexts: BodyContext[] = bodies.map((frame, index) => {
    let geometries = geometryCache.get(frame.resolver);
    if (!geometries) {
      geometries = new Geometries(frame.resolver);
      geometryCache.set(frame.resolver, geometries);
    }
    const anchor = anchorView(frame);
    const body = bodyView(frame);
    const bodyPlace = body.type === 'level' || body.type === 'copy'
      ? { trail: body.trail, base: body.trail.map(runsLength), f: body.tower.factor }
      : null;
    return {
      index, frame, resolver: frame.resolver, geometries, anchor, sigma: frame.metresPerAnchorUnit,
      anchorCentre: geometries.of(anchor).centre, bodyPlace,
    };
  });

  const camOf = (ctx: BodyContext, xAnchor: Vec3): Vec3 =>
    applyRigid(view.cameraFromWorld, applyRigid(ctx.frame.worldFromAnchor, scale3(xAnchor, ctx.sigma)));

  const cameraInAnchor = (ctx: BodyContext): Vec3 => {
    // anchor = σ⁻¹ · worldFromAnchor⁻¹ · worldFromCamera · 0
    const camFromWorld = view.cameraFromWorld;
    const worldCam = scale3(mulVec(transposeOf(camFromWorld.r), camFromWorld.t), -1);
    const w = ctx.frame.worldFromAnchor;
    return scale3(mulVec(transposeOf(w.r), sub3(worldCam, w.t)), 1 / ctx.sigma);
  };

  /** Sphere of a node in camera space, metres. */
  const sphere = (n: { body: number; sim: Similarity; geometry: Geometry }) => {
    const ctx = contexts[n.body];
    return { c: camOf(ctx, applySim(n.sim, n.geometry.centre)), r: n.geometry.radius * n.sim.s * ctx.sigma };
  };

  const inFrustum = (c: Vec3, r: number): boolean => {
    const depth = -c[2];
    if (depth + r < view.zNear || depth - r > view.zFar) return false;
    return planes.every((n) => n[0] * c[0] + n[1] * c[1] + n[2] * c[2] <= r);
  };

  const meetsBubble = (c: Vec3, r: number): boolean => view.bubble !== undefined && len3(c) < r + view.bubble;

  const scoreOf = (n: CutNode) => {
    const s = sphere(n);
    const sigmaX = n.sim.s * contexts[n.body].sigma;
    const dist = Math.max(len3(s.c) - s.r, view.zNear);
    n.rho = (n.epsilon * sigmaX * K) / dist;
    n.area = ((s.r * K) / Math.max(len3(s.c), view.zNear)) ** 2;
  };

  // ─── Node construction ──────────────────────────────────────────

  const isSolid = (ctx: BodyContext, v: View): boolean =>
    v.type === 'box' || ((v.type === 'level' || v.type === 'copy') && towerSolid(ctx.resolver, v));

  const make = (
    ctx: BodyContext, v: View, sim: Similarity, key: string, key64: bigint, parent: CutNode | null, step: Step | null,
    prefix: Step[] | null, place: TowerPlace | null, context: number, removalsAbove: boolean,
  ): CutNode => {
    const geometry = ctx.geometries.of(v);
    const solid = isSolid(ctx, v);
    const isBodyLeaf = parent === null && prefix !== null && prefix.length === 0 && ctx.frame.anchorPath.length === 0
      && (v.type === 'leaf' || v.type === 'selection') && geometryAtoms(ctx, v) <= 2000;
    let epsilon: number;
    let standIn: CutNode['standIn'];
    let splats: Splat[] | undefined;
    let atomic: boolean;
    const u = viewUnitExponent(v);
    const shrink = u > 2000n ? 0 : (v.type === 'level' ? v.tower.factor : 10) ** -Number(u);
    if (solid) {
      epsilon = geometry.rAtom;
      standIn = 'box';
      atomic = v.type !== 'level' && ctx.resolver.isMaterializable(v);
    } else if (v.type === 'level') {
      const seed = ctx.geometries.of(ctx.resolver.root(v.tower.seed));
      const pmax = Math.max(...periodVectors(v.tower.periods).map(len3));
      epsilon = (seed.radius + pmax) * shrink;
      standIn = 'box';
      atomic = false;
    } else if (v.type === 'group') {
      splats = groupSplats(ctx, v);
      epsilon = groupEpsilon(ctx, v);
      standIn = 'splats';
      atomic = false;
    } else if (v.type === 'box') {
      epsilon = geometry.rAtom;
      standIn = 'box';
      atomic = ctx.resolver.isMaterializable(v);
    } else {
      const info = leafInfo(ctx, v);
      splats = info.splats;
      epsilon = info.epsilon;
      standIn = isBodyLeaf ? 'leafMesh' : 'splats';
      atomic = true;
    }
    const node: CutNode = {
      body: ctx.index, view: v, prefix, parent, step, key, key64, sim, geometry, epsilon, solid, standIn, splats, atomic,
      atoms: false, atomCount: 0, place, context, removalsAbove: removalsAbove || v.removals.length > 0, rho: 0, area: 0,
      cost: ZERO_USAGE,
    };
    node.cost = standInCost(node);
    scoreOf(node);
    return node;
  };

  const standInCost = (n: CutNode): CutUsage => {
    if (n.atoms) return { items: 1, boxesAndSplats: 0, instancedAtoms: n.standIn === 'leafMesh' ? 0 : n.atomCount };
    if (n.standIn === 'leafMesh') return { items: 1, boxesAndSplats: 0, instancedAtoms: 0 };
    return { items: 1, boxesAndSplats: n.standIn === 'box' ? 1 : Math.max(1, n.splats?.length ?? 1), instancedAtoms: 0 };
  };

  /** Exposed faces of a solid node (§9.5): at the body's edge, next to a removal, or meeting the bubble. */
  const facesOf = (ctx: BodyContext, n: CutNode): number => {
    if (n.removalsAbove) return ALL_FACES;
    let mask = n.context;
    const v = n.view;
    if (v.type === 'box') {
      let own = 0;
      for (let a = 0; a < 3; a += 1) {
        if (v.box.lo[a] === 0n) own |= 1 << (2 * a);
        if (v.box.hi[a] === v.crystal.cells[a]) own |= 2 << (2 * a);
      }
      mask &= own;
    } else if (n.place) {
      mask &= towerFaces(n.place);
    }
    if (view.bubble !== undefined) {
      const ext = sub3(n.geometry.max, n.geometry.min);
      for (let a = 0; a < 3; a += 1) {
        for (const side of [-1, 1]) {
          const offset: Vec3 = [0, 0, 0];
          offset[a] = side * Math.max(ext[a], 1e-12);
          const s = sphere({ body: n.body, sim: n.sim, geometry: { ...n.geometry, centre: add3(n.geometry.centre, offset) } });
          if (meetsBubble(s.c, s.r)) mask |= (side < 0 ? 1 : 2) << (2 * a);
        }
      }
      const s = sphere(n);
      if (meetsBubble(s.c, s.r)) mask = ALL_FACES;
    }
    return mask;
  };

  // ─── Children ───────────────────────────────────────────────────

  const childrenOf = (n: CutNode): CutNode[] => {
    const ctx = contexts[n.body];
    if (n.atomic) {
      const leaf = materialized(ctx, n.view);
      if (!leaf) return [];
      const atoms: CutNode = { ...n, atoms: true, key: `${n.key}#`, key64: mix64(n.key64 + SPLITMIX_GOLDEN) };
      if (n.solid && n.view.type !== 'leaf') {
        atoms.atomIndices = exposedAtoms(ctx, n, leaf, facesOf(ctx, n));
        atoms.atomCount = atoms.atomIndices.length;
      } else {
        atoms.atomCount = leaf.z.length;
      }
      atoms.cost = standInCost(atoms);
      return [atoms];
    }
    const out: CutNode[] = [];
    const v = n.view;
    const fast = v.removals.length === 0 && (v.type === 'level' || v.type === 'box');
    for (const c of childSteps(v)) {
      if (fast) {
        const child = fastChild(ctx, n, c);
        if (child) out.push(child);
        continue;
      }
      let w: View;
      try {
        w = ctx.resolver.step(v, c.step);
      } catch (e) {
        if (e instanceof ScaleError && e.code === 'path') continue; // a removed child
        throw e;
      }
      const child = childNode(ctx, n, c, w);
      if (child) out.push(child);
    }
    return out;
  };

  /**
   * A child of a level or box without removals, priced before it is
   * resolved: culled and enclosed children never build a view.
   */
  const fastChild = (ctx: BodyContext, n: CutNode, c: ChildStep): CutNode | null => {
    const v = n.view;
    const sim = composeSim(n.sim, c.placement);
    let geometry: Geometry;
    let place: TowerPlace | null = null;
    let context = n.context;
    let build: () => View;
    let faces = ALL_FACES;
    if (v.type === 'level') {
      const k = v.k - 1n;
      geometry = ctx.geometries.level(v.id, v.tower, k);
      const trail = [0, 1, 2].map((a) => concatRunList(v.trail[a], c.step.tag === 'tower' ? c.step.runs[a] : [])) as AxisRuns;
      const copyPlace: TowerPlace = { trail, base: n.place ? n.place.base : [0n, 0n, 0n], f: v.tower.factor };
      if (k > 0n || v.tower.substitution) place = copyPlace;
      else if (n.solid) context &= towerFaces(copyPlace);
      if (n.solid) faces = (n.removalsAbove ? ALL_FACES : context & towerFaces(copyPlace));
      build = k > 0n
        ? () => ({ type: 'level', id: v.id, tower: v.tower, k, trail, removals: [], chain: v.chain })
        : () => ctx.resolver.step(v, c.step);
    } else if (v.type === 'box') {
      const box = c.box ?? boxChild(v.box, c.index);
      geometry = ctx.geometries.box(v.id, v.crystal, box);
      let own = 0;
      for (let a = 0; a < 3; a += 1) {
        if (box.lo[a] === 0n) own |= 1 << (2 * a);
        if (box.hi[a] === v.crystal.cells[a]) own |= 2 << (2 * a);
      }
      faces = n.removalsAbove ? ALL_FACES : context & own;
      build = () => ({ ...v, box, removals: [] });
    } else {
      return null;
    }
    const centre = applySim(sim, geometry.centre);
    const s = { c: camOf(ctx, centre), r: geometry.radius * sim.s * ctx.sigma };
    if (view.bubble !== undefined && n.solid && faces !== ALL_FACES && meetsBubble(s.c, s.r + geometry.radius * sim.s * ctx.sigma * 2)) {
      faces = ALL_FACES; // near the bubble: let the full test decide
    }
    if (n.solid && faces === 0) {
      if (skipped) skipped.push({ body: n.body, anchorFromNode: sim, min: [0, 0, 0], max: solidCellMax(v, c.index), why: 'enclosed' });
      return null;
    }
    if (!inFrustum(s.c, s.r)) {
      if (skipped) skipped.push({ body: n.body, anchorFromNode: sim, min: n.solid ? [0, 0, 0] : geometry.min, max: n.solid ? solidCellMax(v, c.index) : geometry.max, why: 'culled' });
      return null;
    }
    return childNode(ctx, n, c, build(), place, context);
  };

  const childNode = (ctx: BodyContext, n: CutNode, c: ChildStep, v: View, knownPlace?: TowerPlace | null, knownContext?: number): CutNode | null => {
    let place: TowerPlace | null = knownPlace ?? null;
    let context = knownContext ?? n.context;
    if (knownPlace === undefined) {
      if (v.type === 'level' || v.type === 'copy') {
        const base = n.view.type === 'level' && n.view.id === v.id && n.place ? n.place.base : [0n, 0n, 0n];
        place = { trail: v.trail, base, f: v.tower.factor };
      } else if (n.view.type === 'level' && n.place && n.solid) {
        // The seed's own view of a solid seed copy: its exposure is the copy's.
        const trail = [0, 1, 2].map((a) => concatRunList(n.place!.trail[a], c.step.tag === 'tower' ? c.step.runs[a] : [])) as AxisRuns;
        context &= towerFaces({ trail, base: n.place.base, f: n.place.f });
      }
    }
    const sim = composeSim(n.sim, c.placement);
    const key64 = mix64(n.key64 + SPLITMIX_GOLDEN * BigInt(c.index + 1));
    const child = make(ctx, v, sim, `${n.key}/${c.step.tag[0]}${c.index}`, key64, n, c.step, null, place, context, n.removalsAbove);
    if (child.solid && !child.removalsAbove && facesOf(ctx, child) === 0) {
      skipped?.push(region(child, 'enclosed'));
      return null;
    }
    const s = sphere(child);
    if (!inFrustum(s.c, s.r)) {
      skipped?.push(region(child, 'culled'));
      return null;
    }
    return child;
  };

  const region = (n: CutNode, why: CutRegion['why']): CutRegion => ({
    body: n.body, anchorFromNode: n.sim, min: cellMin(n), max: cellMax(n), why,
  });

  // ─── Materialization and residency ──────────────────────────────

  let requested: Array<{ ctx: BodyContext; view: View; key: string; rho: number }> = [];

  const materialized = (ctx: BodyContext, v: View): LeafNode | null => {
    if (v.type === 'leaf') return v.leaf;
    const key = residencyKey(v);
    if (key) {
      const leaf = residency.get(key);
      if (leaf) return leaf;
      return null;
    }
    return ctx.resolver.materialize(v);
  };

  const resident = (n: CutNode): boolean => {
    if (!n.atomic) return true;
    return materialized(contexts[n.body], n.view) !== null;
  };

  // ─── Starting nodes (§9.4) ──────────────────────────────────────

  const starts: CutNode[] = [];
  const faces: DrawItem[] = [];
  for (const ctx of contexts) {
    for (const s of startNodes(ctx)) starts.push(s);
  }

  function startNodes(ctx: BodyContext): CutNode[] {
    const frame = ctx.frame;
    const anchor = ctx.anchor;
    const bodyKey = `${ctx.index}:`;
    let byPath = cache.startKeys.get(frame.path);
    if (!byPath) {
      byPath = new WeakMap();
      cache.startKeys.set(frame.path, byPath);
    }
    let keys = byPath.get(frame.anchorPath);
    if (!keys) {
      keys = new Map();
      byPath.set(frame.anchorPath, keys);
    }
    const startKeys = keys;
    const keysOf = (path: Step[]) => {
      const tag = `${hexOf(frame.root)}:${path.length}:${path.length > 0 ? stepTag(path[path.length - 1]) : ''}`;
      let k = startKeys.get(tag);
      if (!k) {
        const full = encodePath(canonicalPath([...frame.path, ...path]), { unlimited: true });
        k = { pathKey: pathKeyOf(path), key64: leU64(sha256(concatBytes([DOMAIN_REF, frame.root, full]))) };
        startKeys.set(tag, k);
      }
      return k;
    };
    const key64Of = (path: Step[]) => keysOf(path).key64;
    const out: CutNode[] = [];
    const last = frame.anchorPath[frame.anchorPath.length - 1];
    const placeOf = (v: View, base: bigint[]) => (v.type === 'level' || v.type === 'copy' ? { trail: v.trail, base, f: v.tower.factor } : null);
    if (frame.anchorPath.length === 0) {
      out.push(make(ctx, anchor, IDENTITY_SIM, `${bodyKey}`, key64Of([]), null, null, [], ctx.bodyPlace, ALL_FACES, false));
      return out;
    }
    if (last.tag === 'tower') {
      // The 3 × 3 × 3 index neighbourhood at the anchor's level.
      const parentPath = frame.anchorPath.slice(0, -1);
      const parent = ctx.resolver.walk(bodyView(frame), parentPath);
      if (parent.type !== 'level') return [make(ctx, anchor, IDENTITY_SIM, bodyKey, key64Of(frame.anchorPath), null, null, frame.anchorPath, null, ALL_FACES, false)];
      const f = parent.tower.factor;
      const k = parent.k - last.levels;
      const p = periodVectors(parent.tower.periods);
      const ext = [0, 1, 2].map((a) => scale3(p[a], levelSpan(f, a, k))) as Vec3[];
      const base = parentPath.length === 0 && ctx.bodyPlace ? ctx.bodyPlace.base : parent.trail.map(runsLength);
      for (let dz = -1; dz <= 1; dz += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const runs = last.runs.map((r) => r.map((x) => ({ ...x }))) as AxisRuns;
        let ok = true;
        [dx, dy, dz].forEach((d, a) => {
          if (!ok || d === 0) return;
          const next = stepIndex(runs[a], f, d as 1 | -1);
          if (next) runs[a] = next;
          else ok = false;
        });
        if (!ok) continue;
        const step: Step = { tag: 'tower', levels: last.levels, runs };
        let v: View;
        try {
          v = ctx.resolver.step(parent, step);
        } catch (e) {
          if (e instanceof ScaleError && e.code === 'path') continue; // removed
          throw e;
        }
        const offset = add3(add3(scale3(ext[0], dx), scale3(ext[1], dy)), scale3(ext[2], dz));
        const path = [...parentPath, step];
        const node = make(ctx, v, { s: 1, r: IDENTITY3, t: offset }, `${bodyKey}${keysOf(path).pathKey}`, key64Of(path), null, null, path,
          placeOf(v, base), ALL_FACES, false);
        if (node.solid && facesOf(ctx, node) === 0) {
          skipped?.push(region(node, 'enclosed'));
          continue;
        }
        out.push(node);
      }
      faces.push(...towerFacePlanes(ctx, parent, last, ext));
      return out;
    }
    if (last.tag === 'cells' && anchor.type === 'box') {
      return crystalNeighbourhood(ctx, anchor, frame.anchorPath.slice(0, -1), last, key64Of);
    }
    out.push(make(ctx, anchor, IDENTITY_SIM, `${bodyKey}${keysOf(frame.anchorPath).pathKey}`, key64Of(frame.anchorPath), null, null,
      frame.anchorPath, placeOf(anchor, [0n, 0n, 0n]), ALL_FACES, anchor.removals.length > 0));
    return out;
  }

  function crystalNeighbourhood(ctx: BodyContext, anchor: Extract<View, { type: 'box' }>, crystalPath: Step[], last: Extract<Step, { tag: 'cells' }>,
    key64Of: (p: Step[]) => bigint): CutNode[] {
    const root = ctx.resolver.walk(bodyView(ctx.frame), crystalPath);
    if (root.type !== 'box') return [];
    const q = anchor.crystal.quarter / 65536;
    const cellMetres = 4 * q * ctx.sigma;
    const m = BigInt(Math.max(1, Math.ceil(view.zFar / cellMetres)));
    const lo = anchor.box.lo.map((x, a) => (x - m < root.box.lo[a] ? root.box.lo[a] : x - m));
    const hi = anchor.box.hi.map((x, a) => (x + m > root.box.hi[a] ? root.box.hi[a] : x + m));
    const out: CutNode[] = [];
    const depth = last.octants.length;
    const visit = (v: Extract<View, { type: 'box' }>, octants: number[]) => {
      if (octants.length === depth) {
        const path = [...crystalPath, { tag: 'cells', octants } as Step];
        const offset = [0, 1, 2].map((a) => Number(4n * (v.box.lo[a] - anchor.box.lo[a])) * q) as Vec3;
        const node = make(ctx, v, { s: 1, r: IDENTITY3, t: offset }, `${ctx.index}:${pathKeyOf(path)}`, key64Of(path), null, null, path,
          null, ALL_FACES, v.removals.length > 0);
        if (facesOf(ctx, node) === 0 && !node.removalsAbove) skipped?.push(region(node, 'enclosed'));
        else out.push(node);
        return;
      }
      for (const c of childSteps(v)) {
        const child = c.step.tag === 'cells' ? c.step.octants[0] : -1;
        let w: View;
        try {
          w = ctx.resolver.step(v, c.step);
        } catch {
          continue;
        }
        if (w.type !== 'box') continue;
        const box = w.box;
        if ([0, 1, 2].every((a) => box.hi[a] > lo[a] && box.lo[a] < hi[a])) visit(w, [...octants, child]);
      }
    };
    visit(root, []);
    return out;
  }

  /** §9.4: a face plane for each outer face of the root within z_far; its distance from the digits, converted only when small. */
  function towerFacePlanes(ctx: BodyContext, parent: Extract<View, { type: 'level' }>, last: Extract<Step, { tag: 'tower' }>, ext: Vec3[]): DrawItem[] {
    const out: DrawItem[] = [];
    const cam = cameraInAnchor(ctx);
    const f = parent.tower.factor;
    for (let a = 0; a < 3; a += 1) {
      const b = ext[(a + 1) % 3];
      const c = ext[(a + 2) % 3];
      let n = normalize([b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]]);
      if (n[0] * ext[a][0] + n[1] * ext[a][1] + n[2] * ext[a][2] < 0) n = scale3(n, -1);
      const width = n[0] * ext[a][0] + n[1] * ext[a][1] + n[2] * ext[a][2];
      const below = last.runs[a];
      const low = smallValue(below, f);
      const high = smallValue(below.map((r) => ({ digit: f - 1 - r.digit, length: r.length })), f);
      const sides: Array<[Vec3, number | null]> = [
        [scale3(n, -1), low === null ? null : low * width],
        [n, high === null ? null : (high + 1) * width],
      ];
      for (const [normal, offset] of sides) {
        if (offset === null) continue;
        const distance = Math.abs(normal[0] * cam[0] + normal[1] * cam[1] + normal[2] * cam[2] - offset) * ctx.sigma;
        if (distance > view.zFar) continue;
        out.push({
          kind: 'facePlane', body: ctx.index, path: ctx.frame.anchorPath, transform: new Float32Array(12), fade: 1, key32: 0,
          anchorFromItem: IDENTITY_SIM, centre: [0, 0, 0], extras: { normal, offset },
        });
      }
    }
    return out;
  }

  // ─── The heap (§9.5) ────────────────────────────────────────────

  const heap = new Heap();
  let used: CutUsage = ZERO_USAGE;
  let overBudget = false;
  starts.sort((x, y) => y.rho - x.rho);
  used = { items: faces.length, boxesAndSplats: 0, instancedAtoms: 0 };
  if (!fits(used, budgets)) {
    faces.length = 0;
    used = ZERO_USAGE;
    overBudget = true;
  }
  for (const s of starts) {
    const sp = sphere(s);
    if (!inFrustum(sp.c, sp.r)) {
      skipped?.push(region(s, 'culled'));
      continue;
    }
    const next = addUsage(used, s.cost);
    if (fits(next, budgets)) {
      heap.push(s);
      used = next;
    } else overBudget = true;
  }
  const items: DrawItem[] = [...faces];
  const refined = new Set<string>();
  let visited = 0;
  let pops = 0;
  let drawnAtoms = 0;
  const tau = budgets.tau;

  const emit = (n: CutNode) => {
    items.push(drawItem(contexts[n.body], n));
    if (n.atoms) drawnAtoms += n.atomCount;
  };

  while (heap.size > 0) {
    const x = heap.pop();
    pops += 1;
    if (visited === budgets.visits) {
      emit(x);
      continue;
    }
    visited += 1;
    const mustSplit = x.view.removals.length > 0 && !x.atoms && !x.atomic;
    const wantRefine = mustSplit || x.rho > tau || (previous?.refined.has(x.key) === true && x.rho >= tau / 2);
    if (!wantRefine || x.atoms || x.standIn === 'leafMesh') {
      emit(x);
      continue;
    }
    if (!resident(x)) {
      const key = residencyKey(x.view);
      if (key) requested.push({ ctx: contexts[x.body], view: x.view, key, rho: x.rho });
      emit(x);
      continue;
    }
    const kids = childrenOf(x);
    let next = addUsage(used, x.cost, -1);
    for (const k of kids) next = addUsage(next, k.cost);
    if (!fits(next, budgets)) {
      overBudget = true;
      emit(x);
      continue;
    }
    used = next;
    refined.add(x.key);
    for (const k of kids) heap.push(k);
  }

  // Background materializations, highest ρ first, at most the frame's budget (§9.3).
  requested = requested.sort((a, b) => b.rho - a.rho);
  let materializedCount = 0;
  for (const r of requested) {
    if (materializedCount >= budgets.materializations) break;
    residency.set(r.key, r.ctx.resolver.materialize(r.view));
    materializedCount += 1;
  }

  return {
    items,
    bodyCounts: contexts.map((ctx) => ctx.resolver.count(bodyView(ctx.frame))),
    drawnAtoms,
    visited,
    pops,
    overBudget,
    used,
    refined,
    residency,
    cache,
    requested: requested.length,
    materialized: materializedCount,
    skipped,
  };

  // ─── Helpers that read the frame's state ────────────────────────

  function drawItem(ctx: BodyContext, n: CutNode): DrawItem {
    const c = n.geometry.centre;
    // entityFromItem = Scale(σ_A) · T(−c(A)) · T(A ← X) · T(c(X)), composed in binary64 and cast once.
    const entity: Similarity = {
      s: ctx.sigma * n.sim.s,
      r: n.sim.r,
      t: scale3(sub3(add3(scale3(mulVec(n.sim.r, c), n.sim.s), n.sim.t), ctx.anchorCentre), ctx.sigma),
    };
    const kind: DrawKind = n.atoms ? (n.standIn === 'leafMesh' ? 'leafMesh' : 'atomInstances') : n.standIn === 'leafMesh' ? 'leafMesh' : n.standIn;
    return {
      kind,
      body: n.body,
      path: fullPath(n),
      transform: toFloat32x34(entity),
      fade: 1,
      key32: Number(n.key64 & 0xffffffffn),
      anchorFromItem: n.sim,
      centre: c,
      // Every item names the region it stands for: the cell region of a solid node, else its atom bounds.
      extras: n.atoms
        ? { atoms: n.atomCount, atomIndices: n.atomIndices, min: cellMin(n), max: cellMax(n) }
        : n.standIn === 'box' ? { min: cellMin(n), max: cellMax(n) } : { splats: n.splats, min: cellMin(n), max: cellMax(n) },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

const transposeOf = (r: readonly number[]): [number, number, number, number, number, number, number, number, number] =>
  [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];

const normalize = (v: Vec3): Vec3 => scale3(v, 1 / len3(v));

/** The value of a short digit string (at most 2⁵³), or null when it is larger. */
function smallValue(runs: readonly DigitRun[], f: number): number | null {
  let v = 0;
  for (const r of runs) {
    if (r.digit === 0 && v === 0) continue;
    if (r.length > 64n) return null;
    for (let i = 0n; i < r.length; i += 1n) {
      v = v * f + r.digit;
      if (v > 2 ** 53) return null;
    }
  }
  return v;
}

function concatRunList(a: readonly DigitRun[], b: readonly DigitRun[]): DigitRun[] {
  if (b.length === 0) return a as DigitRun[];
  const out = a.map((r) => ({ ...r }));
  for (const r of b) {
    const t = out[out.length - 1];
    if (t && t.digit === r.digit) t.length += r.length;
    else out.push({ ...r });
  }
  return out;
}

/** The cell region of a solid child (a level k − 1 node or an octant), in its own units. */
function solidCellMax(parent: View, index: number): Vec3 {
  if (parent.type === 'box') {
    const q = parent.crystal.quarter / 65536;
    const b = boxChild(parent.box, index);
    return [0, 1, 2].map((a) => 4 * Number(b.hi[a] - b.lo[a]) * q) as Vec3;
  }
  if (parent.type === 'level') {
    const p = periodVectors(parent.tower.periods);
    return [0, 1, 2].map((a) => levelSpan(parent.tower.factor, a, parent.k - 1n) * p[a][a]) as Vec3;
  }
  return [0, 0, 0];
}


/** A short tag for a start node's last step, distinct among one anchor's neighbours. */
function stepTag(step: Step): string {
  switch (step.tag) {
    case 'tower':
      return step.runs.map((axis) => axis.map((r) => `${r.digit}x${r.length.toString(36)}`).join('.')).join('|');
    case 'cells':
      return step.octants.join('');
    case 'child':
      return String(step.index);
    case 'atoms':
      return 'a';
  }
}

const pathKeyOf = (path: Step[]): string => toHex(encodePath(canonicalPath(path), { unlimited: true }));

function fullPath(n: CutNode): Step[] {
  const tail: Step[] = [];
  let m: CutNode | null = n;
  while (m && m.prefix === null) {
    if (m.step) tail.push(m.step);
    m = m.parent;
  }
  return canonicalPath([...(m?.prefix ?? []), ...tail.reverse()]);
}

const residencyKey = (v: View): string | null => {
  switch (v.type) {
    case 'copy':
      return `c${hexOf(v.id)}:${v.key.toString(16)}`;
    case 'capped':
      return `n${hexOf(v.id)}`;
    case 'box':
      // A box with removals is cheap to cut again; only bare boxes are kept.
      return v.removals.length === 0 ? `b${hexOf(v.id)}:${v.box.lo.join(',')}:${v.box.hi.join(',')}` : null;
    default:
      return null;
  }
};

/** A tower level or copy is solid when its seed is an open crystal box whose periods are its extents (§9.2). */
export function towerSolid(r: Resolver, v: View): boolean {
  if (v.type !== 'level' && v.type !== 'copy') return false;
  const seed = r.store.record(v.tower.seed).node;
  if (!seed || seed.kind !== 'crystal' || seed.termination !== 0) return false;
  return v.tower.periods.every((p, a) => p.every((x, i) => x === (i === a ? 4n * seed.cells[a] * BigInt(seed.quarter) : 0n)));
}

/** The cell region of a node in its own units: what it stands for in space. */
function cellMin(n: CutNode): Vec3 {
  return n.solid || n.view.type === 'box' ? [0, 0, 0] : n.geometry.min;
}

function cellMax(n: CutNode): Vec3 {
  const v = n.view;
  if (v.type === 'box') {
    const q = v.crystal.quarter / 65536;
    return [0, 1, 2].map((a) => 4 * Number(v.box.hi[a] - v.box.lo[a]) * q) as Vec3;
  }
  if (n.solid && (v.type === 'level' || v.type === 'copy')) {
    const p = periodVectors(v.tower.periods);
    const k = v.type === 'level' ? v.k : 0n;
    return [0, 1, 2].map((a) => levelSpan(v.tower.factor, a, k) * p[a][a]) as Vec3;
  }
  return n.geometry.max;
}

function geometryAtoms(ctx: BodyContext, v: View): number {
  return v.type === 'leaf' ? v.leaf.z.length : Number(ctx.resolver.count(v).plain ?? 4097n);
}

const leafInfoMemo = new WeakMap<Geometries, Map<string, { epsilon: number; splats: Splat[] }>>();

/** ε of a leaf-like view: the radius of its largest 64-atom cluster; its stand-in, up to 8 splats (§9.2). */
function leafInfo(ctx: BodyContext, v: View): { epsilon: number; splats: Splat[] } {
  let memo = leafInfoMemo.get(ctx.geometries);
  if (!memo) {
    memo = new Map();
    leafInfoMemo.set(ctx.geometries, memo);
  }
  const key = v.type === 'leaf' || v.type === 'capped' ? `n${toHex(v.id)}` : v.type === 'copy' ? `c${toHex(v.id)}:${v.key}` : null;
  const hit = key ? memo.get(key) : undefined;
  if (hit) return hit;
  const leaf = ctx.resolver.materialize(v);
  const clusters = clusterSpheres(leaf, ctx.geometries.of(v).rAtom);
  const info = { epsilon: Math.max(...clusters.map((c) => c.radius)), splats: mergeSpheres(clusters) };
  if (key) memo.set(key, info);
  return info;
}

const groupMemo = new WeakMap<Geometries, Map<string, { epsilon: number; splats: Splat[] }>>();

function groupInfo(ctx: BodyContext, v: Extract<View, { type: 'group' }>): { epsilon: number; splats: Splat[] } {
  let memo = groupMemo.get(ctx.geometries);
  if (!memo) {
    memo = new Map();
    groupMemo.set(ctx.geometries, memo);
  }
  const key = toHex(v.id);
  const hit = memo.get(key);
  if (hit) return hit;
  const spheres: Splat[] = [];
  let epsilon = 0;
  for (const c of childSteps(v)) {
    const w = ctx.resolver.step({ ...v, removals: [] }, c.step);
    const g = ctx.geometries.of(w);
    spheres.push({ centre: applySim(c.placement, g.centre), radius: g.radius * c.placement.s });
    epsilon = Math.max(epsilon, childEpsilon(ctx, w) * c.placement.s);
  }
  const info = { epsilon: Math.max(epsilon, ctx.geometries.of(v).radius / 2), splats: mergeSpheres(spheres) };
  memo.set(key, info);
  return info;
}

/** ε of any view, in its units (the monotone rule of §9.2). */
export function childEpsilon(ctx: { resolver: Resolver; geometries: Geometries }, v: View): number {
  const g = ctx.geometries.of(v);
  if (v.type === 'box' || ((v.type === 'level' || v.type === 'copy') && towerSolid(ctx.resolver, v))) return g.rAtom;
  if (v.type === 'level') {
    const u = unitExponent(v.k);
    const shrink = u > 2000n ? 0 : v.tower.factor ** -Number(u);
    const seed = ctx.geometries.of(ctx.resolver.root(v.tower.seed));
    return (seed.radius + Math.max(...periodVectors(v.tower.periods).map(len3))) * shrink;
  }
  if (v.type === 'group') return groupInfo(ctx as BodyContext, v).epsilon;
  return leafInfo(ctx as BodyContext, v).epsilon;
}

const groupSplats = (ctx: BodyContext, v: Extract<View, { type: 'group' }>) => groupInfo(ctx, v).splats;
const groupEpsilon = (ctx: BodyContext, v: Extract<View, { type: 'group' }>) => groupInfo(ctx, v).epsilon;

/** Morton-ordered 64-atom clusters' bounding spheres (derived data). */
function clusterSpheres(leaf: LeafNode, rAtom: number): Splat[] {
  const n = leaf.z.length;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  for (let i = 0; i < n; i += 1) for (let a = 0; a < 3; a += 1) min[a] = Math.min(min[a], leaf.positions[3 * i + a]);
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let k = 0;
    for (let a = 0; a < 3; a += 1) {
      const v = Math.min(1023, Math.floor((leaf.positions[3 * i + a] - min[a]) * 2));
      for (let b = 0; b < 10; b += 1) k += ((v >> b) & 1) * 2 ** (3 * b + a);
    }
    keys[i] = k;
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
  const out: Splat[] = [];
  for (let s = 0; s < n; s += 64) {
    const chunk = idx.slice(s, s + 64);
    const c: Vec3 = [0, 0, 0];
    for (const i of chunk) for (let a = 0; a < 3; a += 1) c[a] += leaf.positions[3 * i + a] / chunk.length;
    let r = 0;
    for (const i of chunk) r = Math.max(r, len3(sub3([leaf.positions[3 * i], leaf.positions[3 * i + 1], leaf.positions[3 * i + 2]], c)));
    out.push({ centre: c, radius: r + rAtom });
  }
  return out;
}

/** Merges spheres into at most 8, consecutive in their order. */
function mergeSpheres(spheres: Splat[], max = 8): Splat[] {
  if (spheres.length <= max) return spheres;
  const per = Math.ceil(spheres.length / max);
  const out: Splat[] = [];
  for (let s = 0; s < spheres.length; s += per) {
    const group = spheres.slice(s, s + per);
    const c = scale3(group.reduce<Vec3>((acc, g) => add3(acc, g.centre), [0, 0, 0]), 1 / group.length);
    out.push({ centre: c, radius: Math.max(...group.map((g) => len3(sub3(g.centre, c)) + g.radius)) });
  }
  return out;
}

const exposedMemo = new WeakMap<Geometries, Map<string, number[]>>();

/**
 * §9.5: a solid node refined into atoms draws only the atoms of its
 * outermost cell layer on each exposed face, in materialization order.
 */
function exposedAtoms(ctx: BodyContext, n: CutNode, leaf: LeafNode, mask: number): number[] {
  const v = n.view;
  const crystal = v.type === 'box' ? v.crystal : v.type === 'copy' ? seedCrystal(ctx, v) : null;
  if (!crystal) return Array.from({ length: leaf.z.length }, (_, i) => i);
  const key = `${v.type === 'box' ? `b${toHex(v.id)}:${v.box.lo}:${v.box.hi}:${v.removals.length > 0 ? pathKeyOf(v.removals.flat()) : ''}` : residencyKey(v)}:${mask}`;
  let memo = exposedMemo.get(ctx.geometries);
  if (!memo) {
    memo = new Map();
    exposedMemo.set(ctx.geometries, memo);
  }
  const hit = memo.get(key);
  if (hit) return hit;
  const extent = v.type === 'box' ? v.box.hi.map((h, a) => Number(h - v.box.lo[a])) : crystal.cells.map(Number);
  const out: number[] = [];
  for (let i = 0; i < leaf.z.length; i += 1) {
    let show = false;
    for (let a = 0; a < 3 && !show; a += 1) {
      const g = Math.round((leaf.positions[3 * i + a] * 65536) / crystal.quarter);
      const cell = Math.min(Math.floor(g / 4), extent[a] - 1);
      if ((mask >> (2 * a)) & 1 && cell === 0) show = true;
      if ((mask >> (2 * a + 1)) & 1 && cell === extent[a] - 1) show = true;
    }
    if (show) out.push(i);
  }
  memo.set(key, out);
  return out;
}

function seedCrystal(ctx: BodyContext, v: Extract<View, { type: 'copy' }>) {
  const seed = ctx.resolver.store.record(v.tower.seed).node;
  return seed && seed.kind === 'crystal' ? seed : null;
}
