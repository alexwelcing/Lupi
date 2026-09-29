import { PointGrid } from './bonds';
import type { Vec3 } from './types';

export interface SymmetryAxis {
  order: number;
  /** Unit axis through the centre of mass, sign-canonical (largest component positive). */
  dir: Vec3;
  toleranceA: number;
}

const DEG = Math.PI / 180;
/** Candidate axes closer than this are one axis. */
const CANDIDATE_MERGE_DEG = 1;
/** Verified axes closer than this are one axis (the highest order wins). */
const AXIS_MERGE_DEG = 3;
/** Atoms, pairs and midpoints closer than this to the centre give no direction (Å). */
const MIN_ARM = 0.05;

/**
 * Unit directions deduplicated as undirected axes within an angle: a hash grid
 * over the unit sphere, probed at both d and −d.
 */
export class AxisSet {
  private readonly cells = new Map<number, number[]>();
  readonly dirs: Vec3[] = [];
  private readonly cell: number;
  private readonly cosLimit: number;

  constructor(angleDeg: number) {
    this.cosLimit = Math.cos(angleDeg * DEG);
    this.cell = 2 * Math.sin((angleDeg * DEG) / 2) + 1e-9;
  }

  /** Adds `d` (unit) unless an axis within the angle exists; returns the index of the axis it joined or created. */
  add(d: Vec3): { index: number; created: boolean } {
    const hit = this.find(d);
    if (hit >= 0) return { index: hit, created: false };
    const index = this.dirs.length;
    this.dirs.push(d);
    const key = this.key(d[0], d[1], d[2], 0, 0, 0);
    const list = this.cells.get(key);
    if (list) list.push(index);
    else this.cells.set(key, [index]);
    return { index, created: true };
  }

  find(d: Vec3): number {
    for (const s of [1, -1]) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const list = this.cells.get(this.key(s * d[0], s * d[1], s * d[2], dx, dy, dz));
            if (!list) continue;
            for (const i of list) {
              const e = this.dirs[i];
              if (Math.abs(e[0] * d[0] + e[1] * d[1] + e[2] * d[2]) >= this.cosLimit) return i;
            }
          }
        }
      }
    }
    return -1;
  }

  private key(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
    const ix = Math.floor(x / this.cell) + dx;
    const iy = Math.floor(y / this.cell) + dy;
    const iz = Math.floor(z / this.cell) + dz;
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }
}

export function canonicalAxis(d: Vec3): Vec3 {
  let k = 0;
  if (Math.abs(d[1]) > Math.abs(d[k])) k = 1;
  if (Math.abs(d[2]) > Math.abs(d[k])) k = 2;
  return d[k] < 0 ? [-d[0], -d[1], -d[2]] : [d[0], d[1], d[2]];
}

function unitOrNull(x: number, y: number, z: number): Vec3 | null {
  const len = Math.hypot(x, y, z);
  return len > MIN_ARM ? [x / len, y / len, z / len] : null;
}

/**
 * Proper rotation axes Cn (n ∈ {2,3,4,5,6,8}) through the centre of mass.
 * Candidates are the principal axes, ring normals, atom directions, bond
 * midpoints, and pair midpoints of two reference atoms: every C2 axis either
 * passes through reference atom a, or swaps a with a same-element atom (their
 * midpoint lies on the axis), or is perpendicular to a; the second reference
 * atom b and a × b cover the last case. An axis is Cn when the 2π/n rotation
 * maps every atom onto a same-element atom within `tolerance`. A linear
 * molecule's axis reports the highest order tried (8), not C∞.
 */
export function findSymmetryAxes(
  rel: Float64Array,
  atomicNumbers: ArrayLike<number>,
  natoms: number,
  extraCandidates: Vec3[],
  bonds: ReadonlyArray<readonly [number, number]>,
  tolerance: number,
): SymmetryAxis[] {
  if (natoms < 2) return [];
  const radius = new Float64Array(natoms);
  for (let i = 0; i < natoms; i += 1) {
    radius[i] = Math.hypot(rel[3 * i], rel[3 * i + 1], rel[3 * i + 2]);
  }

  const candidates = new AxisSet(CANDIDATE_MERGE_DEG);
  for (const d of extraCandidates) candidates.add(d);
  for (let i = 0; i < natoms; i += 1) {
    const d = unitOrNull(rel[3 * i], rel[3 * i + 1], rel[3 * i + 2]);
    if (d) candidates.add(d);
  }
  const midpoint = (i: number, j: number): void => {
    if (atomicNumbers[i] !== atomicNumbers[j]) return;
    if (Math.abs(radius[i] - radius[j]) > 2 * tolerance) return;
    const d = unitOrNull(rel[3 * i] + rel[3 * j], rel[3 * i + 1] + rel[3 * j + 1], rel[3 * i + 2] + rel[3 * j + 2]);
    if (d) candidates.add(d);
  };
  for (const [i, j] of bonds) midpoint(i, j);

  // Farthest atoms first: they move the most, so a wrong axis fails fastest.
  const order = Array.from({ length: natoms }, (_, i) => i).sort((p, q) => radius[q] - radius[p]);
  const a = order[0];
  const ra: Vec3 = [rel[3 * a], rel[3 * a + 1], rel[3 * a + 2]];
  let b = -1;
  for (const i of order) {
    const cx = ra[1] * rel[3 * i + 2] - ra[2] * rel[3 * i + 1];
    const cy = ra[2] * rel[3 * i] - ra[0] * rel[3 * i + 2];
    const cz = ra[0] * rel[3 * i + 1] - ra[1] * rel[3 * i];
    if (Math.hypot(cx, cy, cz) > 0.1 * radius[a] * radius[i] && radius[i] > MIN_ARM) {
      b = i;
      const d = unitOrNull(cx, cy, cz);
      if (d) candidates.add(d);
      break;
    }
  }
  for (let j = 0; j < natoms; j += 1) {
    if (j !== a) midpoint(a, j);
    if (b >= 0 && j !== b) midpoint(b, j);
  }

  const grid = new PointGrid(rel, natoms, Math.max(2 * tolerance, 0.25));
  const tol2 = tolerance * tolerance;

  const holds = (k: Vec3, n: number): number => {
    const cos = Math.cos((2 * Math.PI) / n);
    const sin = Math.sin((2 * Math.PI) / n);
    let worst = 0;
    for (const i of order) {
      const x = rel[3 * i];
      const y = rel[3 * i + 1];
      const z = rel[3 * i + 2];
      const kp = k[0] * x + k[1] * y + k[2] * z;
      // Rodrigues: p cosθ + (k × p) sinθ + k (k·p)(1 − cosθ).
      const px = x * cos + (k[1] * z - k[2] * y) * sin + k[0] * kp * (1 - cos);
      const py = y * cos + (k[2] * x - k[0] * z) * sin + k[1] * kp * (1 - cos);
      const pz = z * cos + (k[0] * y - k[1] * x) * sin + k[2] * kp * (1 - cos);
      const zi = atomicNumbers[i];
      let best = Infinity;
      grid.within(px, py, pz, tolerance, (j) => {
        if (atomicNumbers[j] !== zi) return false;
        const dx = rel[3 * j] - px;
        const dy = rel[3 * j + 1] - py;
        const dz = rel[3 * j + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= tol2) {
          best = d2;
          return true;
        }
        return false;
      });
      if (best === Infinity) return -1;
      if (best > worst) worst = best;
    }
    return Math.sqrt(worst);
  };

  // Cn implies Ck for k | n: test the primes, then only the multiples they allow.
  const verified: Array<{ order: number; dir: Vec3; residual: number }> = [];
  for (const dir of candidates.dirs) {
    const c2 = holds(dir, 2);
    const c3 = holds(dir, 3);
    const c5 = holds(dir, 5);
    const c4 = c2 >= 0 ? holds(dir, 4) : -1;
    const c8 = c4 >= 0 ? holds(dir, 8) : -1;
    const c6 = c2 >= 0 && c3 >= 0 ? holds(dir, 6) : -1;
    const found = ([[8, c8], [6, c6], [5, c5], [4, c4], [3, c3], [2, c2]] as const).find(([, r]) => r >= 0);
    if (found) verified.push({ order: found[0], dir, residual: found[1] });
  }

  // One axis per direction: the highest order, then the tightest fit.
  verified.sort((p, q) => q.order - p.order || p.residual - q.residual);
  const merged = new AxisSet(AXIS_MERGE_DEG);
  const axes: SymmetryAxis[] = [];
  for (const axis of verified) {
    if (!merged.add(axis.dir).created) continue;
    axes.push({ order: axis.order, dir: canonicalAxis(axis.dir), toleranceA: tolerance });
  }
  axes.sort((p, q) => q.order - p.order || q.dir[2] - p.dir[2] || q.dir[1] - p.dir[1] || q.dir[0] - p.dir[0]);
  return axes;
}
