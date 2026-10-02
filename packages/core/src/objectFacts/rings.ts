import type { BondGraph } from './bonds';
import type { Vec3 } from './types';

export interface RingFace {
  size: number;
  /** Atom indices in cyclic order, starting at the smallest index. */
  atoms: number[];
  /** Ring centroid, relative to the centre of mass. */
  center: Vec3;
  /** Unit plane normal: away from the centre of mass, or +plane normal for a planar molecule. */
  normal: Vec3;
}

export interface RingOptions {
  minSize?: number;
  maxSize?: number;
  /** A ring is kept only if every atom lies within this distance of its plane (Å). */
  planarTolerance?: number;
  /** Plane normal of a planar molecule; ring normals then agree with it. */
  planeNormal: Vec3 | null;
  /** Tie-break for rings whose centre sits on the centre of mass. */
  fallbackNormal: Vec3;
}

/** Shortest cycles enumerated per edge are capped so dense metals stay cheap. */
const MAX_PATHS_PER_EDGE = 32;

/**
 * Ring faces: for every bond, all shortest cycles through it (3–8 atoms),
 * deduplicated by atom set and kept only when planar. A shortest cycle
 * through an edge is always chordless. This is face enumeration, not SSSR:
 * C60 has 12 pentagons and 20 hexagons, and SSSR returns only 19 of the
 * hexagons because the 32 faces are not linearly independent.
 */
export function findRingFaces(rel: Float64Array, graph: BondGraph, options: RingOptions): RingFace[] {
  const minSize = options.minSize ?? 3;
  const maxSize = options.maxSize ?? 8;
  const planarTolerance = options.planarTolerance ?? 0.1;
  const { adjacency, pairs } = graph;
  const n = adjacency.length;
  const dist = new Int32Array(n);
  const stamp = new Int32Array(n);
  const queue = new Int32Array(n);
  const seen = new Set<string>();
  const rings: RingFace[] = [];
  let generation = 0;

  for (const [u, v] of pairs) {
    // BFS from v without the edge (u, v), no deeper than a maxSize cycle needs.
    generation += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = v;
    stamp[v] = generation;
    dist[v] = 0;
    while (head < tail) {
      const cur = queue[head++];
      if (cur === u) break;
      const d = dist[cur];
      if (d + 1 > maxSize - 1) continue;
      for (const w of adjacency[cur]) {
        if (cur === v && w === u) continue;
        if (stamp[w] === generation) continue;
        stamp[w] = generation;
        dist[w] = d + 1;
        queue[tail++] = w;
      }
    }
    if (stamp[u] !== generation) continue;
    const size = dist[u] + 1;
    if (size < minSize || size > maxSize) continue;

    // Every shortest path u → v, walking down the BFS distances.
    const paths: number[][] = [];
    const path: number[] = [u];
    const walk = (cur: number): void => {
      if (paths.length >= MAX_PATHS_PER_EDGE) return;
      if (cur === v) {
        paths.push(path.slice());
        return;
      }
      const want = dist[cur] - 1;
      for (const w of adjacency[cur]) {
        if (stamp[w] !== generation || dist[w] !== want) continue;
        if (cur === u && w === v) continue;
        path.push(w);
        walk(w);
        path.pop();
      }
    };
    walk(u);

    for (const cycle of paths) {
      const key = cycle
        .slice()
        .sort((p, q) => p - q)
        .join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const face = planarFace(rel, cycle, planarTolerance, options);
      if (face) rings.push(face);
    }
  }

  rings.sort((p, q) => p.size - q.size || p.atoms[0] - q.atoms[0] || p.atoms[1] - q.atoms[1]);
  return rings;
}

function planarFace(rel: Float64Array, cycle: number[], tolerance: number, options: RingOptions): RingFace | null {
  const k = cycle.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of cycle) {
    cx += rel[3 * i];
    cy += rel[3 * i + 1];
    cz += rel[3 * i + 2];
  }
  cx /= k;
  cy /= k;
  cz /= k;
  // Newell's method: the area-weighted normal of the closed polygon.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t < k; t += 1) {
    const i = cycle[t];
    const j = cycle[(t + 1) % k];
    const xi = rel[3 * i];
    const yi = rel[3 * i + 1];
    const zi = rel[3 * i + 2];
    const xj = rel[3 * j];
    const yj = rel[3 * j + 1];
    const zj = rel[3 * j + 2];
    nx += (yi - yj) * (zi + zj);
    ny += (zi - zj) * (xi + xj);
    nz += (xi - xj) * (yi + yj);
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-9)) return null;
  nx /= len;
  ny /= len;
  nz /= len;
  for (const i of cycle) {
    const off = (rel[3 * i] - cx) * nx + (rel[3 * i + 1] - cy) * ny + (rel[3 * i + 2] - cz) * nz;
    if (Math.abs(off) > tolerance) return null;
  }

  let sign: number;
  const plane = options.planeNormal;
  if (plane) {
    sign = nx * plane[0] + ny * plane[1] + nz * plane[2] < 0 ? -1 : 1;
  } else {
    const outward = nx * cx + ny * cy + nz * cz;
    if (Math.abs(outward) > 1e-3) sign = outward < 0 ? -1 : 1;
    else {
      const f = options.fallbackNormal;
      sign = nx * f[0] + ny * f[1] + nz * f[2] < 0 ? -1 : 1;
    }
  }

  // Canonical cyclic order: start at the smallest index, toward its smaller ring neighbour.
  let start = 0;
  for (let t = 1; t < k; t += 1) if (cycle[t] < cycle[start]) start = t;
  const next = cycle[(start + 1) % k];
  const prev = cycle[(start - 1 + k) % k];
  const step = next < prev ? 1 : -1;
  const atoms: number[] = [];
  for (let t = 0; t < k; t += 1) atoms.push(cycle[(start + step * t + k * k) % k]);

  return {
    size: k,
    atoms,
    center: [cx, cy, cz],
    normal: [sign * nx, sign * ny, sign * nz],
  };
}
