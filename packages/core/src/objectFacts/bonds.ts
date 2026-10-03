import { ELEMENT_DATA } from '../elements';

/** Bond when d ≤ (r_cov,i + r_cov,j) · BOND_SLACK. */
export const BOND_SLACK = 1.15;
/** Covalent radius for an atomic number the element table does not resolve (carbon). */
const UNRESOLVED_COVALENT = 0.76;
/** Coincident atoms are not bonded. */
const MIN_BOND = 0.1;

export function covalentRadius(z: number): number {
  const r = ELEMENT_DATA[z]?.radius;
  return r !== undefined && r > 0 ? r : UNRESOLVED_COVALENT;
}

/**
 * Uniform hash grid over flat xyz positions. Cells are keyed by a hash of the
 * integer cell coordinates, so sparse or far-flung inputs never allocate a
 * dense lattice; a hash collision only adds candidates, which every caller
 * filters by true distance.
 */
export class PointGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly seen: number[] = [];
  readonly cell: number;

  constructor(
    readonly positions: ArrayLike<number>,
    readonly count: number,
    cell: number,
  ) {
    this.cell = cell;
    for (let i = 0; i < count; i += 1) {
      const key = this.key(
        Math.floor(positions[3 * i] / cell),
        Math.floor(positions[3 * i + 1] / cell),
        Math.floor(positions[3 * i + 2] / cell),
      );
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private key(ix: number, iy: number, iz: number): number {
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }

  /**
   * Calls `visit(j)` for every point in the 27 cells around (x, y, z), which
   * covers every point within `cell` of it. Stops early when `visit` returns true.
   */
  near(x: number, y: number, z: number, visit: (j: number) => boolean | void): boolean {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const iz = Math.floor(z / this.cell);
    const seen = this.seen;
    seen.length = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const key = this.key(ix + dx, iy + dy, iz + dz);
          if (seen.includes(key)) continue;
          seen.push(key);
          const list = this.cells.get(key);
          if (!list) continue;
          for (const j of list) if (visit(j) === true) return true;
        }
      }
    }
    return false;
  }

  /**
   * Calls `visit(j)` for the points in the cells a ball of radius `r` around
   * (x, y, z) touches: at most 2×2×2 cells when `r ≤ cell / 2`. A hash
   * collision may visit a point twice. Stops early when `visit` returns true.
   */
  within(x: number, y: number, z: number, r: number, visit: (j: number) => boolean | void): boolean {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        for (let iz = z0; iz <= z1; iz += 1) {
          const list = this.cells.get(this.key(ix, iy, iz));
          if (!list) continue;
          for (const j of list) if (visit(j) === true) return true;
        }
      }
    }
    return false;
  }
}

export interface BondGraph {
  /** Bonded pairs, i < j. */
  pairs: Array<[number, number]>;
  /** Sorted neighbour lists. */
  adjacency: number[][];
}

/**
 * A bond graph from caller-supplied flat pairs. Out-of-range, self and
 * repeated pairs are dropped; the result is canonical (i < j, sorted).
 */
export function bondGraphFromPairs(pairs: ArrayLike<number>, natoms: number): BondGraph {
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = pairs[k];
    const b = pairs[k + 1];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue;
    if (a < 0 || b < 0 || a >= natoms || b >= natoms) continue;
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const key = i * natoms + j;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([i, j]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const adjacency: number[][] = Array.from({ length: natoms }, () => []);
  for (const [i, j] of out) {
    adjacency[i].push(j);
    adjacency[j].push(i);
  }
  for (const list of adjacency) list.sort((p, q) => p - q);
  return { pairs: out, adjacency };
}

/** Covalent bonds from a uniform grid: d ≤ (r_cov,i + r_cov,j) · 1.15. */
export function computeBonds(atomicNumbers: ArrayLike<number>, positions: ArrayLike<number>, natoms: number): BondGraph {
  const radii = new Float64Array(natoms);
  let maxR = 0;
  for (let i = 0; i < natoms; i += 1) {
    radii[i] = covalentRadius(atomicNumbers[i]);
    if (radii[i] > maxR) maxR = radii[i];
  }
  const reach = 2 * maxR * BOND_SLACK;
  const grid = new PointGrid(positions, natoms, reach);
  const pairs: Array<[number, number]> = [];
  const adjacency: number[][] = Array.from({ length: natoms }, () => []);
  for (let i = 0; i < natoms; i += 1) {
    const xi = positions[3 * i];
    const yi = positions[3 * i + 1];
    const zi = positions[3 * i + 2];
    grid.near(xi, yi, zi, (j) => {
      if (j <= i) return;
      const cut = (radii[i] + radii[j]) * BOND_SLACK;
      const dx = positions[3 * j] - xi;
      const dy = positions[3 * j + 1] - yi;
      const dz = positions[3 * j + 2] - zi;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= cut * cut && d2 >= MIN_BOND * MIN_BOND) {
        pairs.push([i, j]);
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    });
  }
  for (const list of adjacency) list.sort((p, q) => p - q);
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { pairs, adjacency };
}
