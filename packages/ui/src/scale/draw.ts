// From a cut to what the GPU draws (scale-spec §8.5, §9.7): box items become
// instanced unit cubes with a lattice grid in their own units, splats
// become instanced spheres, and atom items become one impostor frame per
// body in the anchor's units (relative to its local centre), so moving the
// camera or the body only changes a matrix, never the atom buffer.

import { ELEMENT_DATA } from '@atlas/core/elements';
import {
  anchorView,
  bodyView,
  canonicalPath,
  encodePath,
  Geometries,
  toHex,
  unitExponent,
  type BodyFrame,
  type Cut,
  type DrawItem,
  type LeafNode,
  type Resolver,
  type Vec3,
  type View,
} from '@atlas/core/scale';
import { add, mulVec, scale, sub, type Sim } from './vec';
import { worldFromItem } from './world';

/** The lattice grid a box draws: lines every base^j grid units, j ≥ jMin (shader in boxMaterial.ts). */
export interface GridSpec {
  /** Item units per grid unit. */
  unit: number;
  base: number;
  jMin: number;
}

export interface BoxBuffers {
  count: number;
  /** Column-major 4 × 4 per instance (three's Matrix4 layout): the unit cube [0, 1]³ to world. */
  matrices: Float32Array;
  /** Linear RGB per instance. */
  colors: Float32Array;
  /** The box's size in grid units (x, y, z). */
  cells: Float32Array;
  /** base, jMin, 1 when the grid is on. */
  grid: Float32Array;
}

export interface SplatBuffers {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
}

export function allocBoxes(capacity: number): BoxBuffers {
  return { count: 0, matrices: new Float32Array(16 * capacity), colors: new Float32Array(3 * capacity), cells: new Float32Array(3 * capacity), grid: new Float32Array(3 * capacity) };
}

export function allocSplats(capacity: number): SplatBuffers {
  return { count: 0, matrices: new Float32Array(16 * capacity), colors: new Float32Array(3 * capacity) };
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexLinear(hex: string): Vec3 {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5];
  return [srgbToLinear(parseInt(m[1], 16) / 255), srgbToLinear(parseInt(m[2], 16) / 255), srgbToLinear(parseInt(m[3], 16) / 255)];
}

/** §9.2's aggregate colour: the count-weighted CPK mean of one copy, in linear light. */
export function aggregateColour(counts: ReadonlyMap<number, bigint>): Vec3 {
  let total = 0;
  let c: Vec3 = [0, 0, 0];
  for (const [z, n] of counts) {
    const w = Number(n);
    if (!(w > 0)) continue;
    c = add(c, scale(hexLinear(ELEMENT_DATA[z]?.color ?? '#999999'), w));
    total += w;
  }
  return total > 0 ? scale(c, 1 / total) : [0.4, 0.45, 0.42];
}

/** Per-body facts the buffers need, memoized by body key and path. */
interface BodyInfo {
  colour: Vec3;
  view: View;
}

export class DrawCache {
  private readonly bodies = new Map<string, BodyInfo>();
  /** Materialized leaves by body root and item path (§9.6 keeps them cheaper to regenerate than to store). */
  private readonly leaves = new Map<string, LeafNode>();
  private readonly geometries = new WeakMap<Resolver, Geometries>();

  geometriesOf(r: Resolver): Geometries {
    let g = this.geometries.get(r);
    if (!g) {
      g = new Geometries(r);
      this.geometries.set(r, g);
    }
    return g;
  }

  body(key: string, frame: BodyFrame): BodyInfo {
    const id = `${key}:${pathHex(frame.path)}`;
    let info = this.bodies.get(id);
    if (!info) {
      const view = bodyView(frame);
      info = { view, colour: aggregateColour(frame.resolver.composition(view).unit) };
      this.bodies.set(id, info);
    }
    return info;
  }

  leaf(frame: BodyFrame, item: DrawItem): LeafNode {
    const full = canonicalPath([...frame.path, ...item.path]);
    const id = `${toHex(frame.root)}:${pathHex(full)}`;
    let leaf = this.leaves.get(id);
    if (leaf) {
      this.leaves.delete(id);
      this.leaves.set(id, leaf);
      return leaf;
    }
    leaf = frame.resolver.materialize(frame.resolver.resolve(frame.root, full));
    this.leaves.set(id, leaf);
    if (this.leaves.size > 3000) {
      const oldest = this.leaves.keys().next().value;
      if (oldest !== undefined) this.leaves.delete(oldest);
    }
    return leaf;
  }
}

const pathHex = (path: DrawItem['path']): string => (path.length ? toHex(encodePath(path, { unlimited: true })) : '');

/**
 * The grid of a box item: a tower level draws its own periods and their
 * f-adic subdivisions down to the seed copies (in a level's own units its
 * period cell is the record's period, §2.8); a seed copy and a crystal box
 * draw their cells in decades.
 */
export function gridOf(body: View, item: DrawItem, resolver: Resolver): GridSpec | null {
  const cellOf = (quarter: number) => (4 * quarter) / 65536;
  if (body.type === 'box') return { unit: cellOf(body.crystal.quarter), base: 10, jMin: 0 };
  if (body.type !== 'level' && body.type !== 'copy') return null;
  const t = body.tower;
  const aligned = t.periods.every((p, a) => p.every((x, i) => i === a || x === 0n)) && t.periods.every((p, a) => p[a] === t.periods[0][0]);
  if (!aligned) return null;
  let k: bigint;
  if (body.type === 'copy') k = 0n;
  else if (item.path.length === 0) k = body.k;
  else if (item.path.length === 1 && item.path[0].tag === 'tower') k = body.k - item.path[0].levels;
  else return null;
  const period = Number(t.periods[0][0]) / 65536;
  if (k <= 0n) {
    // A seed copy: its crystal's cells, when the seed is a crystal whose period is whole cells.
    const seed = resolver.store.record(t.seed).node;
    if (!seed || seed.kind !== 'crystal' || seed.termination === 2) return null;
    return { unit: cellOf(seed.quarter), base: 10, jMin: 0 };
  }
  const u = unitExponent(k);
  return { unit: period, base: t.factor, jMin: -Number(u < 60n ? u : 60n) };
}

/** Fills box and splat buffers from a cut. Returns false when a buffer was too small. */
export function fillInstances(
  cut: Cut,
  frames: readonly BodyFrame[],
  keys: readonly string[],
  cache: DrawCache,
  boxes: BoxBuffers,
  splats: SplatBuffers,
): void {
  let nb = 0;
  let ns = 0;
  const boxCap = boxes.colors.length / 3;
  const splatCap = splats.colors.length / 3;
  for (const item of cut.items) {
    const frame = frames[item.body];
    if (!frame) continue;
    const info = cache.body(keys[item.body], frame);
    if (item.kind === 'box' && item.extras.min && item.extras.max) {
      if (nb >= boxCap) continue;
      const w = worldFromItem(frame, item);
      const size = sub(item.extras.max, item.extras.min);
      writeBoxMatrix(boxes.matrices, nb, w, item.extras.min, size);
      boxes.colors.set(info.colour, 3 * nb);
      const grid = gridOf(info.view, item, frame.resolver);
      if (grid) {
        boxes.cells[3 * nb] = size[0] / grid.unit;
        boxes.cells[3 * nb + 1] = size[1] / grid.unit;
        boxes.cells[3 * nb + 2] = size[2] / grid.unit;
        boxes.grid[3 * nb] = grid.base;
        boxes.grid[3 * nb + 1] = grid.jMin;
        boxes.grid[3 * nb + 2] = 1;
      } else {
        boxes.cells.fill(1, 3 * nb, 3 * nb + 3);
        boxes.grid.fill(0, 3 * nb, 3 * nb + 3);
      }
      nb += 1;
    } else if (item.kind === 'splats' && item.extras.splats) {
      const w = worldFromItem(frame, item);
      for (const s of item.extras.splats) {
        if (ns >= splatCap) break;
        const c = add(scale(mulVec(w.r, s.centre), w.s), w.t);
        writeSphereMatrix(splats.matrices, ns, c, s.radius * w.s);
        splats.colors.set(info.colour, 3 * ns);
        ns += 1;
      }
    }
  }
  boxes.count = nb;
  splats.count = ns;
}

/** M = [s R diag(size) | s R min + t], column-major. */
export function writeBoxMatrix(out: Float32Array, i: number, w: Sim, min: Vec3, size: Vec3): void {
  const o = 16 * i;
  const r = w.r;
  for (let c = 0; c < 3; c += 1) {
    out[o + 4 * c] = w.s * size[c] * r[c];
    out[o + 4 * c + 1] = w.s * size[c] * r[3 + c];
    out[o + 4 * c + 2] = w.s * size[c] * r[6 + c];
    out[o + 4 * c + 3] = 0;
  }
  const t = add(scale(mulVec(r, min), w.s), w.t);
  out[o + 12] = t[0];
  out[o + 13] = t[1];
  out[o + 14] = t[2];
  out[o + 15] = 1;
}

function writeSphereMatrix(out: Float32Array, i: number, c: Vec3, radius: number): void {
  const o = 16 * i;
  out.fill(0, o, o + 16);
  out[o] = radius;
  out[o + 5] = radius;
  out[o + 10] = radius;
  out[o + 12] = c[0];
  out[o + 13] = c[1];
  out[o + 14] = c[2];
  out[o + 15] = 1;
}

/** One body's atoms in its anchor's units, about the anchor's local centre. */
export interface AtomSet {
  /** The body's index and key in the world. */
  body: number;
  bodyKey: string;
  /** Changes exactly when the atoms change. */
  key: string;
  count: number;
  positions: Float32Array;
  types: Int32Array;
  /** The anchor's local centre c(A), anchor units: worldFromAtoms = worldFromAnchor · Scale(σ) · T(c(A)). */
  centre: Vec3;
  /** Ångström to anchor units, f^−u(A). */
  angstrom: number;
}

/**
 * Collects each body's atom items into one set (§9.5's exposed atoms only
 * for solid nodes). `signature` changes exactly when the set changes, so the
 * renderer re-uploads only then.
 */
export function collectAtoms(
  cut: Cut, frames: readonly BodyFrame[], keys: readonly string[], cache: DrawCache, previous: ReadonlyMap<string, AtomSet> = new Map(),
): AtomSet[] {
  const perBody = new Map<number, DrawItem[]>();
  for (const item of cut.items) {
    if (item.extras.atoms === undefined && item.kind !== 'leafMesh') continue;
    const list = perBody.get(item.body) ?? [];
    list.push(item);
    perBody.set(item.body, list);
  }
  const out: AtomSet[] = [];
  for (const [b, items] of perBody) {
    const frame = frames[b];
    // Positions are in the anchor's units: a rebase changes them, a zoom does not.
    const sig = [keys[b], pathHex(frame.anchorPath)];
    for (const item of items) sig.push(`${pathHex(item.path)}:${item.extras.atoms ?? 'all'}`);
    const signature = sig.join('|');
    const reuse = previous.get(keys[b]);
    if (reuse && reuse.key === signature) {
      out.push({ ...reuse, body: b });
      continue;
    }
    const anchor = anchorView(frame);
    const centre = cache.geometriesOf(frame.resolver).of(anchor).centre;
    const angstrom = anchor.type === 'level' ? anchor.tower.factor ** -Number(unitExponent(anchor.k)) : 1;
    let total = 0;
    const leaves = items.map((item) => {
      const leaf = cache.leaf(frame, item);
      const indices = item.extras.atomIndices ?? null;
      total += indices ? indices.length : leaf.z.length;
      return { item, leaf, indices };
    });
    const positions = new Float32Array(3 * total);
    const types = new Int32Array(total);
    let n = 0;
    for (const { item, leaf, indices } of leaves) {
      const a = item.anchorFromItem;
      const count = indices ? indices.length : leaf.z.length;
      for (let j = 0; j < count; j += 1) {
        const i = indices ? indices[j] : j;
        const x: Vec3 = [leaf.positions[3 * i], leaf.positions[3 * i + 1], leaf.positions[3 * i + 2]];
        // anchorFromItem in binary64, relative to c(A), cast once.
        const p = sub(add(scale(mulVec(a.r, x), a.s), a.t), centre);
        positions[3 * n] = p[0];
        positions[3 * n + 1] = p[1];
        positions[3 * n + 2] = p[2];
        types[n] = leaf.z[i];
        n += 1;
      }
    }
    out.push({ body: b, bodyKey: keys[b], key: signature, count: n, positions, types, centre, angstrom });
  }
  return out;
}
