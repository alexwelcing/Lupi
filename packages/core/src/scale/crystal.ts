// lupi.gen.crystal@1 (scale-spec §3.3): site tables, boxes and their
// closed-form counts, the octree of boxes, and the capped diamondoids.
// Geometry is integer (quarter-grid points × quarter, Q16); the one float
// step is f32(q) of §1.4.

import { fail } from './bytes';
import type { CrystalNode, LeafNode } from './records';
import type { Vec3n } from './records';

/** (sx, sy, sz, sublattice) per structure, in table order (§3.3.1). */
export const SITES: Record<number, ReadonlyArray<readonly [number, number, number, number]>> = {
  1: [[0, 0, 0, 0]],
  2: [[0, 0, 0, 0], [2, 2, 2, 1]],
  3: [[0, 0, 0, 0], [0, 2, 2, 0], [2, 0, 2, 0], [2, 2, 0, 0]],
  4: [[0, 0, 0, 0], [0, 2, 2, 0], [2, 0, 2, 0], [2, 2, 0, 0], [1, 1, 1, 1], [1, 3, 3, 1], [3, 1, 3, 1], [3, 3, 1, 1]],
  5: [[0, 0, 0, 0], [0, 2, 2, 0], [2, 0, 2, 0], [2, 2, 0, 0], [2, 0, 0, 1], [0, 2, 0, 1], [0, 0, 2, 1], [2, 2, 2, 1]],
};

export interface Box {
  lo: Vec3n;
  hi: Vec3n;
}

export const species = (c: CrystalNode, sublattice: number): number => (sublattice === 1 && c.b !== 0 ? c.b : c.a);

export const rootBox = (c: CrystalNode): Box => ({ lo: [0n, 0n, 0n], hi: [...c.cells] as Vec3n });

/** The cell extents of a box, plus the closed far-face layer it owns. */
function extents(c: CrystalNode, box: Box, sx: readonly number[]): bigint[] {
  return [0, 1, 2].map((a) => {
    const e = box.hi[a] - box.lo[a];
    return c.termination === 1 && sx[a] === 0 && box.hi[a] === c.cells[a] ? e + 1n : e;
  });
}

/** §3.3.2: atoms of a box, closed-form. */
export function boxCount(c: CrystalNode, box: Box): bigint {
  let n = 0n;
  for (const s of SITES[c.structure]) {
    const e = extents(c, box, s);
    n += e[0] * e[1] * e[2];
  }
  return n;
}

/** Per-element counts of a box, closed-form like its count. */
export function boxComposition(c: CrystalNode, box: Box): Map<number, bigint> {
  const out = new Map<number, bigint>();
  for (const s of SITES[c.structure]) {
    const e = extents(c, box, s);
    const z = species(c, s[3]);
    out.set(z, (out.get(z) ?? 0n) + e[0] * e[1] * e[2]);
  }
  return out;
}

export function boxEquals(a: Box, b: Box): boolean {
  return [0, 1, 2].every((i) => a.lo[i] === b.lo[i] && a.hi[i] === b.hi[i]);
}

/** §3.3.3: children of a box, in increasing octant. */
export function boxChildren(box: Box): Array<{ octant: number; box: Box }> {
  const split: (bigint | null)[] = [0, 1, 2].map((a) => {
    const e = box.hi[a] - box.lo[a];
    return e >= 2n ? box.lo[a] + (e + 1n) / 2n : null;
  });
  if (split.every((m) => m === null)) return [];
  const out: Array<{ octant: number; box: Box }> = [];
  for (let o = 0; o < 8; o += 1) {
    let ok = true;
    const lo = [...box.lo] as Vec3n;
    const hi = [...box.hi] as Vec3n;
    for (let a = 0; a < 3; a += 1) {
      const upper = (o >> a) & 1;
      const mid = split[a];
      if (mid === null) {
        if (upper) ok = false;
      } else if (upper) {
        lo[a] = mid;
      } else {
        hi[a] = mid;
      }
    }
    if (ok) out.push({ octant: o, box: { lo, hi } });
  }
  return out;
}

export function boxChild(box: Box, octant: number): Box {
  const child = boxChildren(box).find((c) => c.octant === octant);
  if (!child) fail('path', `octant ${octant} does not exist`);
  return child.box;
}

/** The atoms of one materialization: element and Q16 position per atom. */
export interface Q16Atoms {
  z: number[];
  /** x, y, z per atom, Q16. */
  q: number[];
}

const BIG = 2n ** 40n;
const clampNum = (v: bigint): number => Number(v > BIG ? BIG : v < -BIG ? -BIG : v);

/**
 * §3.3.2 materialization, in its frozen order, with Q16 positions relative
 * to the box corner. Atoms whose owner cell lies in a removed sub-box are
 * dropped (§3.5); the others keep their order.
 */
export function materializeBox(c: CrystalNode, box: Box, removed: readonly Box[] = []): Q16Atoms {
  const sites = SITES[c.structure];
  const e = [0, 1, 2].map((a) => Number(box.hi[a] - box.lo[a]));
  const ext = [0, 1, 2].map((a) => (c.termination === 1 && box.hi[a] === c.cells[a] ? 1 : 0));
  // Local cell index of the crystal's last cell, n − 1 − lo (the owner of the far face).
  const lastLocal = [0, 1, 2].map((a) => clampNum(c.cells[a] - 1n - box.lo[a]));
  const removedLocal = removed.map((r) => ({
    lo: [0, 1, 2].map((a) => clampNum(r.lo[a] - box.lo[a])),
    hi: [0, 1, 2].map((a) => clampNum(r.hi[a] - box.lo[a])),
  }));
  const z: number[] = [];
  const q: number[] = [];
  const quarter = c.quarter;
  for (let k = 0; k < e[2] + ext[2]; k += 1) {
    for (let j = 0; j < e[1] + ext[1]; j += 1) {
      for (let i = 0; i < e[0] + ext[0]; i += 1) {
        const cell = [i, j, k];
        for (const s of sites) {
          // In the extra (closed) layer only the face sites exist: g ≤ 4n.
          let skip = false;
          for (let a = 0; a < 3; a += 1) if (cell[a] === e[a] && s[a] > 0) skip = true;
          if (skip) continue;
          if (removedLocal.length > 0) {
            const owner = [0, 1, 2].map((a) => Math.min(cell[a], lastLocal[a]));
            if (removedLocal.some((r) => owner.every((o, a) => o >= r.lo[a] && o < r.hi[a]))) continue;
          }
          z.push(species(c, s[3]));
          q.push((4 * i + s[0]) * quarter, (4 * j + s[1]) * quarter, (4 * k + s[2]) * quarter);
        }
      }
    }
  }
  return { z, q };
}

/** §3.3.4: the H-capped diamondoid of size m, Q16 from the crystal origin. */
export function materializeCapped(c: CrystalNode): Q16Atoms {
  const m = Number(c.cells[0]);
  const centre = 2 * m;
  const radius = 2 * m + 1;
  const span = 4 * m + 3;
  const key = (x: number, y: number, z: number) => ((z + 1) * span + (y + 1)) * span + (x + 1);
  const isLattice = (x: number, y: number, z: number): boolean => {
    const even = (v: number) => (v & 1) === 0;
    if (even(x) && even(y) && even(z)) return (((x + y + z) % 4) + 4) % 4 === 0;
    if (!even(x) && !even(y) && !even(z)) return (((x + y + z - 3) % 4) + 4) % 4 === 0;
    return false;
  };
  const sites: Array<[number, number, number]> = [];
  const siteSet = new Set<number>();
  for (let gz = centre - radius; gz <= centre + radius; gz += 1) {
    for (let gy = centre - radius; gy <= centre + radius; gy += 1) {
      for (let gx = centre - radius; gx <= centre + radius; gx += 1) {
        if (Math.abs(gx - centre) + Math.abs(gy - centre) + Math.abs(gz - centre) > radius) continue;
        if (!isLattice(gx, gy, gz)) continue;
        sites.push([gx, gy, gz]);
        siteSet.add(key(gx, gy, gz));
      }
    }
  }
  const DIRS = [
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[-1, -1, -1], [-1, 1, 1], [1, -1, 1], [1, 1, -1]],
  ];
  const sub = (g: readonly number[]) => ((g[0] & 1) === 1 ? 1 : 0);
  const inSites = (x: number, y: number, z: number) =>
    Math.abs(x - centre) + Math.abs(y - centre) + Math.abs(z - centre) <= radius && siteSet.has(key(x, y, z));
  const kept = new Set<number>();
  for (const g of sites) {
    let n = 0;
    for (const d of DIRS[sub(g)]) if (inSites(g[0] + d[0], g[1] + d[1], g[2] + d[2])) n += 1;
    if (n >= 2) kept.add(key(g[0], g[1], g[2]));
  }
  const z: number[] = [];
  const q: number[] = [];
  const quarter = c.quarter;
  for (const g of sites) {
    if (!kept.has(key(g[0], g[1], g[2]))) continue;
    const s = sub(g);
    z.push(species(c, s));
    q.push(g[0] * quarter, g[1] * quarter, g[2] * quarter);
    for (const d of DIRS[s]) {
      const nx = g[0] + d[0];
      const ny = g[1] + d[1];
      const nz = g[2] + d[2];
      const neighbourKept = Math.abs(nx - centre) + Math.abs(ny - centre) + Math.abs(nz - centre) <= radius
        && kept.has(key(nx, ny, nz));
      if (!neighbourKept) {
        z.push(c.capZ);
        q.push(g[0] * quarter + d[0] * c.capOffset, g[1] * quarter + d[1] * c.capOffset, g[2] * quarter + d[2] * c.capOffset);
      }
    }
  }
  return { z, q };
}

/** §1.4: the one rounding, Float32(Double(q) / 65536). */
export const q16ToF32 = (q: number): number => Math.fround(q / 65536);

export function leafFromQ16(atoms: Q16Atoms): LeafNode {
  return {
    kind: 'leaf',
    z: Uint8Array.from(atoms.z),
    positions: Float32Array.from(atoms.q, q16ToF32),
  };
}
