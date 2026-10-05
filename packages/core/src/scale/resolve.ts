// Resolution (scale-spec §4.3–§4.7): views, steps, removals, counts,
// compositions, materialization and probes. Counts, compositions and depths
// are memoized by NodeID, so a DAG that repeats children costs its records,
// never its paths, and nothing is ever expanded to answer a count.

import { fail, ScaleError, toHex } from './bytes';
import { addCounts, countsOf, type Composition } from './composition';
import {
  boxChild,
  boxComposition,
  boxCount,
  leafFromQ16,
  materializeBox,
  materializeCapped,
  rootBox,
  type Box,
} from './crystal';
import {
  addMagnitude,
  magnitude,
  subMagnitude,
  toPlain,
  towerMagnitude,
  type Magnitude,
} from './magnitude';
import {
  composeRanges,
  concatRuns,
  pathContains,
  rangesCount,
  rangesIndices,
  runsEqual,
  runsLength,
  splitRuns,
  type AtomRange,
  type AxisRuns,
  type Step,
} from './paths';
import {
  decodeRecord,
  encodeRecord,
  KIND,
  LEAF_MAX_ATOMS,
  nodeId,
  type CrystalNode,
  type DecodedRecord,
  type GroupNode,
  type LeafNode,
  type NodeID,
  type TowerNode,
} from './records';
import { copyKey, fullTowerStep, levelsAlongSpan, substitute, unitExponent } from './tower';

export interface NodeStore {
  /** Throws ScaleError('missing') when the record is not held. */
  record(id: NodeID): DecodedRecord;
}

/** A store over decoded records, keyed by NodeID. */
export class MemoryStore implements NodeStore {
  private readonly map = new Map<string, DecodedRecord>();

  constructor(records: Iterable<Uint8Array | DecodedRecord> = []) {
    for (const r of records) this.add(r);
  }

  add(record: Uint8Array | DecodedRecord): NodeID {
    const d = record instanceof Uint8Array ? decodeRecord(record) : record;
    this.map.set(toHex(d.id), d);
    return d.id;
  }

  has(id: NodeID): boolean {
    return this.map.has(toHex(id));
  }

  record(id: NodeID): DecodedRecord {
    const d = this.map.get(toHex(id));
    if (!d) fail('missing', `node ${toHex(id).slice(0, 16)}…`);
    return d;
  }

  get size(): number {
    return this.map.size;
  }

  records(): DecodedRecord[] {
    return [...this.map.values()];
  }
}

/** Looks a NodeID up in each store in turn (§6.7: NodeIDs are global). */
export class ChainStore implements NodeStore {
  constructor(private readonly stores: NodeStore[]) {}
  record(id: NodeID): DecodedRecord {
    for (const s of this.stores) {
      try {
        return s.record(id);
      } catch (e) {
        if (!(e instanceof ScaleError && e.code === 'missing')) throw e;
      }
    }
    return fail('missing', `node ${toHex(id).slice(0, 16)}…`);
  }
}

/** Records every NodeID a resolution reads, so a reference can embed exactly those (§4.6, §7.2). */
export class TrackingStore implements NodeStore {
  readonly read = new Map<string, DecodedRecord>();
  constructor(private readonly inner: NodeStore) {}
  record(id: NodeID): DecodedRecord {
    const d = this.inner.record(id);
    this.read.set(toHex(id), d);
    return d;
  }
}

export type Removal = Step[];

/**
 * A node reached by a walk. `chain` counts the records entered from the
 * root, so record depth is checked lazily (§2.8): a walk that enters more
 * than 64 records, or a subtree evaluation whose chain plus subtree depth
 * passes 64, fails with `limit`.
 */
export type View =
  | { type: 'leaf'; id: NodeID; leaf: LeafNode; removals: Removal[]; chain: number }
  | { type: 'group'; id: NodeID; group: GroupNode; removals: Removal[]; chain: number }
  | { type: 'box'; id: NodeID; crystal: CrystalNode; box: Box; removals: Removal[]; chain: number }
  | { type: 'capped'; id: NodeID; crystal: CrystalNode; removals: Removal[]; chain: number }
  | { type: 'level'; id: NodeID; tower: TowerNode; k: bigint; trail: AxisRuns; removals: Removal[]; chain: number }
  | { type: 'copy'; id: NodeID; tower: TowerNode; trail: AxisRuns; key: bigint; removals: Removal[]; chain: number }
  | { type: 'selection'; base: View; ranges: AtomRange[]; removals: Removal[]; chain: number };

export type ViewType = View['type'];

const MAX_DEPTH = 64;
const SEED_COUNT_LIMIT = 1n << 256n;
const EMPTY_TRAIL = (): AxisRuns => [[], [], []];

function stripped(v: View): View {
  return { ...v, removals: [] } as View;
}

/** Removals that no other removal of the list contains: the disjoint ones a count subtracts. */
function maximalRemovals(removals: readonly Removal[]): Removal[] {
  return removals.filter((r, i) =>
    !removals.some((other, j) => j !== i && pathContains(other, r) && (!pathContains(r, other) || j < i)));
}

export class Resolver {
  readonly store: NodeStore;
  private readonly countMemo = new Map<string, Magnitude>();
  private readonly elementMemo = new Map<string, Map<number, bigint>>();
  private readonly depthMemo = new Map<string, number>();
  private readonly unitMemo = new Map<string, bigint>();
  private readonly checked = new Set<string>();
  private readonly cappedMemo = new Map<string, LeafNode>();

  constructor(store: NodeStore) {
    this.store = store;
  }

  private rec(id: NodeID): DecodedRecord {
    const d = this.store.record(id);
    if (d.node === null) fail('unsupported', `kind ${d.kind} version ${d.kindVersion}`);
    return d;
  }

  // ─── Record properties (memoized by NodeID) ─────────────────────────

  /** §2.8: leaf and crystal 1; group, tower and edit 1 + their deepest reference. */
  depth(id: NodeID, guard = 0): number {
    const key = toHex(id);
    const memo = this.depthMemo.get(key);
    if (memo !== undefined) return memo;
    if (guard > MAX_DEPTH) fail('limit', 'record depth above 64');
    const node = this.rec(id).node!;
    let d = 1;
    if (node.kind === 'group') {
      for (const c of node.children) d = Math.max(d, 1 + this.depth(c.id, guard + 1));
    } else if (node.kind === 'tower') d = 1 + this.depth(node.seed, guard + 1);
    else if (node.kind === 'edit') d = 1 + this.depth(node.base, guard + 1);
    if (d > MAX_DEPTH) fail('limit', 'record depth above 64');
    this.depthMemo.set(key, d);
    return d;
  }

  /** §2.8: the frame unit exponent of a record (towers u(L), edits their base's, else 0). */
  unitExponentOf(id: NodeID): bigint {
    const key = toHex(id);
    const memo = this.unitMemo.get(key);
    if (memo !== undefined) return memo;
    const node = this.rec(id).node!;
    const u = node.kind === 'tower' ? unitExponent(node.levels) : node.kind === 'edit' ? this.unitExponentOf(node.base) : 0n;
    this.unitMemo.set(key, u);
    return u;
  }

  /** The count of a whole record (its own edits applied). */
  recordCount(id: NodeID): Magnitude {
    const key = toHex(id);
    const memo = this.countMemo.get(key);
    if (memo) return memo;
    this.depth(id);
    const c = this.count(this.root(id));
    this.countMemo.set(key, c);
    return c;
  }

  /** Exact per-element counts of a finite record. */
  recordElements(id: NodeID): Map<number, bigint> {
    const key = toHex(id);
    const memo = this.elementMemo.get(key);
    if (memo) return memo;
    this.depth(id);
    const c = this.plainCounts(this.root(id));
    this.elementMemo.set(key, c);
    return c;
  }

  // ─── Views ──────────────────────────────────────────────────────────

  root(id: NodeID): View {
    return this.rootView(id, [], 1);
  }

  private rootView(id: NodeID, removals: Removal[], chain: number): View {
    if (chain > MAX_DEPTH) fail('limit', 'a walk through more than 64 records');
    const d = this.rec(id);
    const node = d.node!;
    switch (node.kind) {
      case 'leaf':
        if (removals.length > 0) fail('path', 'a removal inside a leaf');
        return { type: 'leaf', id, leaf: node, removals: [], chain };
      case 'group':
        return { type: 'group', id, group: node, removals, chain };
      case 'crystal':
        if (node.termination === 2) {
          if (removals.length > 0) fail('path', 'a removal inside a capped crystal');
          return { type: 'capped', id, crystal: node, removals: [], chain };
        }
        return { type: 'box', id, crystal: node, box: rootBox(node), removals, chain };
      case 'tower': {
        this.checkTower(id, node);
        const level: View = { type: 'level', id, tower: node, k: node.levels, trail: EMPTY_TRAIL(), removals, chain };
        return node.levels === 0n ? this.seedCopy(level) : level;
      }
      case 'edit': {
        this.checkEdit(id, node.base, node.removed);
        return this.rootView(node.base, [...removals, ...node.removed], chain + 1);
      }
    }
  }

  /** §2.8: an evaluation of a whole subtree checks its depth, counted from the walk's root. */
  private checkSubtree(v: View): void {
    const id = v.type === 'selection' ? null : v.type === 'group' || v.type === 'level' || v.type === 'copy' ? v.id : null;
    const depth = id ? this.depth(id) : 1;
    if (v.chain - 1 + depth > MAX_DEPTH) fail('limit', 'record depth above 64');
  }

  /** §2.8 tower seeds, checked once per tower. */
  private checkTower(id: NodeID, t: TowerNode): void {
    const key = toHex(id);
    if (this.checked.has(key)) return;
    const seed = this.rec(t.seed).node!;
    const seedBase = seed.kind === 'edit' ? this.rec(seed.base).node! : seed;
    if (seed.kind === 'tower' || seedBase.kind === 'tower') {
      fail('validity', 'a tower seed must not be a tower (wrap it in a one-child group)');
    }
    this.depth(id);
    if (this.unitExponentOf(t.seed) !== 0n) fail('validity', 'a tower seed has unit exponent 0');
    const count = this.recordCount(t.seed);
    if (count.plain === null || count.plain >= SEED_COUNT_LIMIT) fail('validity', 'seed count of 2^256 or more');
    if (t.substitution) {
      const seedView = this.root(t.seed);
      if (!this.isMaterializable(seedView)) fail('validity', 'a substituted seed must be materializable');
      const leaf = this.materialize(seedView);
      let n = 0;
      for (const z of leaf.z) if (z === t.substitution.fromZ) n += 1;
      if (n < t.substitution.perCopy) fail('validity', 'the seed holds fewer than perCopy atoms of fromZ');
    }
    this.checked.add(key);
  }

  /** §2.8 edits: a base that is no edit, and disjoint removals that resolve inside it. */
  private checkEdit(id: NodeID, base: NodeID, removed: Removal[]): void {
    const key = toHex(id);
    if (this.checked.has(key)) return;
    if (this.rec(base).node!.kind === 'edit') fail('validity', 'the base of an edit is an edit');
    for (const r of removed) {
      if (r.length === 0) fail('validity', 'the empty path is not a removal');
      if (r.some((s) => s.tag === 'atoms')) fail('validity', 'a removal holds an atoms step');
      try {
        this.walk(this.root(base), r);
      } catch (e) {
        if (e instanceof ScaleError && e.code === 'path') fail('validity', `a removal does not resolve: ${e.message}`);
        throw e;
      }
    }
    for (let i = 0; i < removed.length; i += 1) {
      for (let j = 0; j < removed.length; j += 1) {
        if (i !== j && pathContains(removed[i], removed[j])) fail('validity', 'a removal contains another');
      }
    }
    this.checked.add(key);
  }

  /** Level 0: a copy with a substitution, or the seed's own view (§3.4.4). */
  private seedCopy(level: Extract<View, { type: 'level' }>): View {
    const t = level.tower;
    if (t.substitution) {
      if (level.removals.length > 0) fail('path', 'a removal inside a substituted copy');
      const key = copyKey(level.id, fullTowerStep(t.levels, level.trail));
      return { type: 'copy', id: level.id, tower: t, trail: level.trail, key, removals: [], chain: level.chain };
    }
    return this.rootView(t.seed, level.removals, level.chain + 1);
  }

  resolve(id: NodeID, path: readonly Step[]): View {
    return this.walk(this.root(id), path);
  }

  walk(view: View, steps: readonly Step[]): View {
    let v = view;
    for (const s of steps) v = this.step(v, s);
    return v;
  }

  step(v: View, s: Step): View {
    switch (s.tag) {
      case 'child': {
        if (v.type !== 'group') fail('path', `a child step on a ${v.type}`);
        const child = v.group.children[s.index];
        if (!child) fail('path', 'child index out of range');
        const removals: Removal[] = [];
        for (const r of v.removals) {
          const h = r[0];
          if (h.tag !== 'child' || h.index !== s.index) continue;
          if (r.length === 1) fail('path', 'enters a removed node');
          removals.push(r.slice(1));
        }
        if (this.unitExponentOf(child.id) !== 0n) fail('validity', 'a group child has unit exponent 0');
        return this.rootView(child.id, removals, v.chain + 1);
      }
      case 'cells': {
        if (v.type !== 'box') fail('path', `a cells step on a ${v.type}`);
        let box = v.box;
        for (const o of s.octants) box = boxChild(box, o);
        const removals: Removal[] = [];
        for (const r of v.removals) {
          const h = r[0];
          if (h.tag !== 'cells') continue;
          const n = Math.min(h.octants.length, s.octants.length);
          let same = true;
          for (let i = 0; i < n; i += 1) if (h.octants[i] !== s.octants[i]) same = false;
          if (!same) continue;
          if (h.octants.length <= s.octants.length) fail('path', 'enters a removed node');
          removals.push([{ tag: 'cells', octants: h.octants.slice(s.octants.length) }, ...r.slice(1)]);
        }
        return { ...v, box, removals };
      }
      case 'tower': {
        if (v.type !== 'level') fail('path', `a tower step on a ${v.type}`);
        const k = v.k;
        if (s.levels > k) fail('path', 'a tower step below level 0');
        for (let a = 0; a < 3; a += 1) {
          for (const r of s.runs[a]) if (r.digit >= v.tower.factor) fail('path', 'a digit not below the factor');
          if (runsLength(s.runs[a]) !== levelsAlongSpan(a, k, s.levels)) fail('path', `axis ${a} has the wrong digit count`);
        }
        const removals: Removal[] = [];
        for (const r of v.removals) {
          const h = r[0];
          if (h.tag !== 'tower') continue;
          const shorter = h.levels < s.levels ? h.levels : s.levels;
          const cuts = [0, 1, 2].map((a) => levelsAlongSpan(a, k, shorter));
          const hs = [0, 1, 2].map((a) => splitRuns(h.runs[a], cuts[a]));
          const ss = [0, 1, 2].map((a) => splitRuns(s.runs[a], cuts[a]));
          if (![0, 1, 2].every((a) => runsEqual(hs[a][0], ss[a][0]))) continue;
          if (h.levels > s.levels) {
            removals.push([{ tag: 'tower', levels: h.levels - s.levels, runs: hs.map((x) => x[1]) as AxisRuns }, ...r.slice(1)]);
          } else if (r.length === 1 || h.levels < s.levels) {
            fail('path', 'enters a removed node');
          } else {
            // D_h = D = k: the removal continues inside the seed copy.
            removals.push(r.slice(1));
          }
        }
        const trail = [0, 1, 2].map((a) => concatRuns(v.trail[a], s.runs[a])) as AxisRuns;
        const next: Extract<View, { type: 'level' }> = { ...v, k: k - s.levels, trail, removals };
        return next.k === 0n ? this.seedCopy(next) : next;
      }
      case 'atoms': {
        if (!this.isMaterializable(v)) fail('path', `an atoms step on a ${v.type} that is not materializable`);
        const n = Number(toPlain(this.count(v)));
        for (const r of s.ranges) if (r.start + r.length > n) fail('path', 'atom range outside the materialization');
        if (v.type === 'selection') {
          return { type: 'selection', base: v.base, ranges: composeRanges(v.ranges, s.ranges), removals: [], chain: v.chain };
        }
        return { type: 'selection', base: v, ranges: s.ranges.map((r) => ({ ...r })), removals: [], chain: v.chain };
      }
    }
  }

  // ─── Counts (§3.4.7, §3.5, §4.4) ────────────────────────────────────

  private baseCount(v: View): Magnitude {
    switch (v.type) {
      case 'leaf':
        return magnitude(v.leaf.z.length);
      case 'group': {
        let sum = magnitude(0);
        for (const c of v.group.children) {
          if (this.unitExponentOf(c.id) !== 0n) fail('validity', 'a group child has unit exponent 0');
          sum = addMagnitude(sum, this.recordCount(c.id));
        }
        return sum;
      }
      case 'box':
        return magnitude(boxCount(v.crystal, v.box));
      case 'capped':
        return magnitude(this.cappedLeaf(v.id, v.crystal).z.length);
      case 'level':
        return towerMagnitude(toPlain(this.recordCount(v.tower.seed)), v.tower.factor, v.k);
      case 'copy':
        return this.recordCount(v.tower.seed);
      case 'selection':
        return magnitude(rangesCount(v.ranges));
    }
  }

  /** count = baseCount − Σ baseCount of each (outermost) removal (§4.4). */
  count(v: View): Magnitude {
    this.checkSubtree(v);
    let c = this.baseCount(v);
    if (v.removals.length === 0) return c;
    const bare = stripped(v);
    for (const r of maximalRemovals(v.removals)) c = subMagnitude(c, this.baseCount(this.walk(bare, r)));
    return c;
  }

  // ─── Composition (§5.3) ─────────────────────────────────────────────

  private substitutedUnit(t: TowerNode): Map<number, bigint> {
    const unit = new Map(this.recordElements(t.seed));
    if (t.substitution) {
      const s = t.substitution;
      addCounts(unit, new Map([[s.fromZ, BigInt(s.perCopy)]]), -1n);
      addCounts(unit, new Map([[s.toZ, BigInt(s.perCopy)]]));
    }
    return unit;
  }

  /** Exact counts without removals. */
  private baseElements(v: View): Map<number, bigint> {
    switch (v.type) {
      case 'leaf':
        return countsOf(v.leaf.z);
      case 'group': {
        const out = new Map<number, bigint>();
        for (const c of v.group.children) {
          if (this.unitExponentOf(c.id) !== 0n) fail('validity', 'a group child has unit exponent 0');
          addCounts(out, this.recordElements(c.id));
        }
        return out;
      }
      case 'box':
        return boxComposition(v.crystal, v.box);
      case 'capped':
        return countsOf(this.cappedLeaf(v.id, v.crystal).z);
      case 'level': {
        const f = BigInt(v.tower.factor);
        const copies = f ** v.k;
        const out = new Map<number, bigint>();
        for (const [z, n] of this.substitutedUnit(v.tower)) out.set(z, n * copies);
        return out;
      }
      case 'copy':
        return this.substitutedUnit(v.tower);
      case 'selection':
        return countsOf(this.materialize(v).z);
    }
  }

  /** Exact counts of a finite view, after its removals. */
  plainCounts(v: View): Map<number, bigint> {
    if (v.type === 'level' && v.k > 64n * 1024n) fail('range', 'counts of a level this deep are not plain');
    const out = this.baseElements(v);
    if (v.removals.length === 0 || v.type === 'selection') return out;
    const bare = stripped(v);
    for (const r of maximalRemovals(v.removals)) addCounts(out, this.baseElements(this.walk(bare, r)), -1n);
    return out;
  }

  composition(v: View): Composition {
    this.checkSubtree(v);
    if (v.type === 'level') {
      const t = v.tower;
      const f = t.factor;
      let copies = towerMagnitude(1n, f, v.k);
      const removed = new Map<number, bigint>();
      const bare = stripped(v);
      for (const r of maximalRemovals(v.removals)) {
        const h = r[0];
        if (h.tag !== 'tower') continue;
        if (r.length === 1) copies = subMagnitude(copies, towerMagnitude(1n, f, v.k - h.levels));
        else addCounts(removed, this.plainCounts(this.walk(bare, r)));
      }
      return { unit: this.substitutedUnit(t), copies, removed };
    }
    return { unit: this.plainCounts(v), copies: magnitude(1), removed: new Map() };
  }

  // ─── Materialization and probes (§4.5) ──────────────────────────────

  private cappedLeaf(id: NodeID, c: CrystalNode): LeafNode {
    const key = toHex(id);
    let leaf = this.cappedMemo.get(key);
    if (!leaf) {
      leaf = leafFromQ16(materializeCapped(c));
      this.cappedMemo.set(key, leaf);
    }
    return leaf;
  }

  isMaterializable(v: View): boolean {
    switch (v.type) {
      case 'leaf':
      case 'capped':
      case 'copy':
      case 'selection':
        return true;
      case 'box':
        // The box's own §3.3.2 count, before its removals (the table of §4.5).
        return boxCount(v.crystal, v.box) <= BigInt(LEAF_MAX_ATOMS);
      default:
        return false;
    }
  }

  materialize(v: View): LeafNode {
    this.checkSubtree(v);
    switch (v.type) {
      case 'leaf':
        return v.leaf;
      case 'capped':
        return this.cappedLeaf(v.id, v.crystal);
      case 'box': {
        if (!this.isMaterializable(v)) fail('materialize', 'a box of more than 4,096 atoms');
        const bare = stripped(v);
        const removed = v.removals.map((r) => {
          const w = this.walk(bare, r);
          if (w.type !== 'box') fail('validity', 'a removal inside a box that is not a box');
          return w.box;
        });
        return leafFromQ16(materializeBox(v.crystal, v.box, removed));
      }
      case 'copy': {
        const seed = this.materialize(this.root(v.tower.seed));
        return { kind: 'leaf', z: substitute(seed.z, v.tower.substitution!, v.key).z, positions: seed.positions };
      }
      case 'selection': {
        const base = this.materialize(v.base);
        const idx = rangesIndices(v.ranges);
        const positions = new Float32Array(3 * idx.length);
        idx.forEach((i, j) => positions.set(base.positions.subarray(3 * i, 3 * i + 3), 3 * j));
        return { kind: 'leaf', z: Uint8Array.from(idx, (i) => base.z[i]), positions };
      }
      default:
        return fail('materialize', `a ${v.type} is never materialized`);
    }
  }

  /** The NodeID of the leaf record of a view's materialization. */
  probe(v: View): NodeID {
    return nodeId(encodeRecord(this.materialize(v)));
  }

  /** The record NodeID a view stands on, or null for virtual views. */
  static recordOf(v: View): NodeID | null {
    return v.type === 'leaf' || v.type === 'group' ? v.id : v.type === 'capped' ? v.id : null;
  }
}

export const KIND_OF_VIEW: Record<ViewType, number | null> = {
  leaf: KIND.leaf,
  group: KIND.group,
  box: KIND.crystal,
  capped: KIND.crystal,
  level: KIND.tower,
  copy: KIND.tower,
  selection: null,
};
