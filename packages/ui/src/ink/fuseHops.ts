/**
 * fuseHops.ts — when the Light Fuse reaches each atom: a hop per atom, 0 at
 * the seed and 1 at the last atom the front reaches (ink/InkLookDriver.tsx
 * runs the fuse, scene `tsl/inkFuse.ts` draws it).
 *
 * - Graph: bond steps through the drawn bond graph, breadth first from the
 *   seed. Atoms the bonds cannot reach (salts, solvent, ions, a second
 *   molecule) take a hop from their spatial distance to the nearest reached
 *   atom, in bond lengths (the drawn bonds' mean), and the front carries on
 *   through their own bonds from there: one shortest-path fill over bonds
 *   (one hop each) and the gaps between fragments (distance / bond length).
 *   Inside the seed's own molecule the front follows the bonds only.
 * - Spatial: the distance from the seed in bond lengths, a spherical
 *   wavefront (frames above the graph's limit, or bonds hidden).
 * Both are divided by the largest hop (the seed's eccentricity), so a fuse
 * takes one duration whatever the molecule's size.
 *
 * Pure: no store, no GPU.
 */

export type FuseMode = 'graph' | 'spatial' | 'uniform';

export const FUSE_HOPS = {
  /** The bond graph is followed up to this many atoms (the listed bond graph's limit); spatial above. */
  graphMaxAtoms: 2_000,
  /** Above this many atoms there are no per-atom hops: the look crossfades as one. */
  maxAtoms: 250_000,
  /** The bond length (world units, Å) a frame without drawn bonds measures distance in. */
  defaultBondLength: 1.5,
  /** The centre-front seed: how much depth behind the nearest atom counts against an atom, per unit off the centre line. */
  frontDepthWeight: 0.5,
} as const;

/** The burning edge (tuning points): widths in bond steps, turned into the shader's normalised units by `fuseEdgeParams`. */
export const FUSE_EDGE = {
  /** Half-width of the soft edge: narrow, so the edge reads crisp and ragged. */
  edgeHops: 0.3,
  minEdge: 0.02,
  maxEdge: 0.15,
  /** How far the noise moves the front: about a hop either way, so each ball burns across. */
  noiseHops: 2.5,
  minNoise: 0.05,
  /** Noise cells per bond length (a ball carries one or two). */
  cellsPerBond: 3,
} as const;

export interface FuseHopsInput {
  positions: ArrayLike<number>;
  natoms: number;
  seed: number;
  /** The drawn bond pairs, [a0, b0, a1, b1, …]; null or absent for a spatial fuse. */
  pairs?: ArrayLike<number> | null;
  /** The bond length a spatial fuse measures in (defaults to the drawn bonds' mean, or 1.5). */
  bondLength?: number;
}

export interface FuseHops {
  mode: 'graph' | 'spatial';
  /** Per atom: 0 at the seed to 1 at the last atom the front reaches. */
  hops: Float32Array;
  /** The seed's eccentricity in bond steps (what hop 1 is); 0 for a single atom. */
  span: number;
  /** The bond length the hops are counted in (world units). */
  bondLength: number;
  /** The seed actually used (clamped into the frame). */
  seed: number;
}

function distance(p: ArrayLike<number>, a: number, b: number): number {
  const dx = p[b * 3] - p[a * 3];
  const dy = p[b * 3 + 1] - p[a * 3 + 1];
  const dz = p[b * 3 + 2] - p[a * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The mean length of the valid pairs, or null when there are none. */
function meanBondLength(p: ArrayLike<number>, pairs: ArrayLike<number>, n: number): number | null {
  let sum = 0;
  let count = 0;
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = pairs[k];
    const b = pairs[k + 1];
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) continue;
    const d = distance(p, a, b);
    if (!(d > 0) || !Number.isFinite(d)) continue;
    sum += d;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/** Hops through the bonds, and across the gaps between fragments (see the header). */
function graphHops(p: ArrayLike<number>, n: number, seed: number, pairs: ArrayLike<number>, bondLength: number): Float64Array {
  // Compressed adjacency.
  const degree = new Int32Array(n + 1);
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = pairs[k];
    const b = pairs[k + 1];
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) continue;
    degree[a + 1] += 1;
    degree[b + 1] += 1;
  }
  for (let i = 0; i < n; i += 1) degree[i + 1] += degree[i];
  const offsets = degree;
  const fill = offsets.slice(0, n);
  const neighbours = new Int32Array(offsets[n]);
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = pairs[k];
    const b = pairs[k + 1];
    if (!(a >= 0 && a < n && b >= 0 && b < n) || a === b) continue;
    neighbours[fill[a]++] = b;
    neighbours[fill[b]++] = a;
  }

  // Fragments (connected components), labelled breadth first; the seed's is 0.
  const component = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  let fragments = 0;
  const label = (start: number, hopsFrom: boolean) => {
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    component[start] = fragments;
    if (hopsFrom) dist[start] = 0;
    while (head < tail) {
      const u = queue[head++];
      for (let e = offsets[u]; e < offsets[u + 1]; e += 1) {
        const v = neighbours[e];
        if (component[v] !== -1) continue;
        component[v] = fragments;
        if (hopsFrom) dist[v] = dist[u] + 1;
        queue[tail++] = v;
      }
    }
    fragments += 1;
  };
  label(seed, true);
  for (let i = 0; i < n; i += 1) if (component[i] === -1) label(i, false);
  if (fragments === 1) return dist;

  // The other fragments: a shortest-path fill over bonds (1 each) and gaps
  // between different fragments (distance / bond length), from the seed's
  // molecule outward. Dense (O(n²)): the graph path is capped at 2,000 atoms.
  const settled = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) if (component[i] === 0) settled[i] = 1;
  const relaxGaps = (u: number) => {
    for (let v = 0; v < n; v += 1) {
      if (settled[v] || component[v] === component[u]) continue;
      const d = distance(p, u, v);
      const via = dist[u] + (Number.isFinite(d) ? d / bondLength : Infinity);
      if (via < dist[v]) dist[v] = via;
    }
  };
  for (let i = 0; i < n; i += 1) if (settled[i]) relaxGaps(i);
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!settled[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    settled[u] = 1;
    for (let e = offsets[u]; e < offsets[u + 1]; e += 1) {
      const v = neighbours[e];
      if (!settled[v] && dist[u] + 1 < dist[v]) dist[v] = dist[u] + 1;
    }
    relaxGaps(u);
  }
  return dist;
}

/**
 * Per-atom hops for a fuse from `seed`: through `pairs` when given (and the
 * frame is within the graph's limit), otherwise by distance.
 */
export function computeFuseHops(input: FuseHopsInput): FuseHops {
  const p = input.positions;
  const n = Math.max(0, Math.min(Math.floor(input.natoms) || 0, Math.floor(p.length / 3)));
  const seed = n > 0 ? Math.max(0, Math.min(n - 1, Math.floor(input.seed) || 0)) : 0;
  const pairs = input.pairs && input.pairs.length >= 2 && n <= FUSE_HOPS.graphMaxAtoms ? input.pairs : null;
  const measured = pairs ? meanBondLength(p, pairs, n) : null;
  const given = input.bondLength !== undefined && Number.isFinite(input.bondLength) && input.bondLength > 0
    ? input.bondLength
    : null;
  const bondLength = measured ?? given ?? FUSE_HOPS.defaultBondLength;
  const mode: FuseHops['mode'] = pairs && measured !== null ? 'graph' : 'spatial';

  let dist: Float64Array;
  if (n === 0) {
    dist = new Float64Array(0);
  } else if (mode === 'graph') {
    dist = graphHops(p, n, seed, pairs!, bondLength);
  } else {
    dist = new Float64Array(n);
    for (let i = 0; i < n; i += 1) dist[i] = distance(p, seed, i) / bondLength;
  }

  // Normalise by the largest finite hop; anything unreachable (NaN positions) goes last.
  let span = 0;
  for (let i = 0; i < n; i += 1) if (Number.isFinite(dist[i]) && dist[i] > span) span = dist[i];
  const hops = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = dist[i];
    hops[i] = !Number.isFinite(d) ? 1 : span > 0 ? Math.min(1, d / span) : 0;
  }
  return { mode, hops, span, bondLength, seed };
}

/**
 * The shader's edge for a fuse of `span` bond steps: the soft edge's
 * half-width and the noise weight (normalised hops), and noise cells per
 * world unit. A long fuse gets a thin, slightly ragged front; a single atom
 * burns by the noise alone.
 */
export function fuseEdgeParams(span: number, bondLength: number): { edge: number; noise: number; scale: number } {
  const E = FUSE_EDGE;
  const steps = Number.isFinite(span) && span > 0 ? span : 0;
  const length = Number.isFinite(bondLength) && bondLength > 0 ? bondLength : FUSE_HOPS.defaultBondLength;
  return {
    edge: Math.min(E.maxEdge, Math.max(E.minEdge, E.edgeHops / (steps + 1))),
    noise: Math.min(1, Math.max(E.minNoise, E.noiseHops / (steps + E.noiseHops))),
    scale: E.cellsPerBond / length,
  };
}

/**
 * The atom nearest the viewer at the centre of the screen: closest to the
 * view's centre line, with depth behind the nearest atom counting against it
 * (`frontDepthWeight`), among atoms in front of the eye. Null when there is
 * none to pick.
 */
export function centreFrontAtom(input: {
  positions: ArrayLike<number>;
  natoms: number;
  eye: ArrayLike<number>;
  /** The view direction (unit). */
  forward: ArrayLike<number>;
  /** Atoms that cannot be the seed (hidden types). */
  skip?: (index: number) => boolean;
}): number | null {
  const p = input.positions;
  const n = Math.max(0, Math.min(Math.floor(input.natoms) || 0, Math.floor(p.length / 3)));
  const [ex, ey, ez] = [input.eye[0], input.eye[1], input.eye[2]];
  const [fx, fy, fz] = [input.forward[0], input.forward[1], input.forward[2]];
  let nearest = Infinity;
  let behindBest = -1;
  let behindDistance = Infinity;
  for (let i = 0; i < n; i += 1) {
    if (input.skip?.(i)) continue;
    const dx = p[i * 3] - ex;
    const dy = p[i * 3 + 1] - ey;
    const dz = p[i * 3 + 2] - ez;
    const t = dx * fx + dy * fy + dz * fz;
    if (t > 0 && t < nearest) nearest = t;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < behindDistance) {
      behindDistance = d;
      behindBest = i;
    }
  }
  if (!Number.isFinite(nearest)) return behindBest >= 0 ? behindBest : null;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < n; i += 1) {
    if (input.skip?.(i)) continue;
    const dx = p[i * 3] - ex;
    const dy = p[i * 3 + 1] - ey;
    const dz = p[i * 3 + 2] - ez;
    const t = dx * fx + dy * fy + dz * fz;
    if (!(t > 0)) continue;
    const off = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t));
    const score = off + FUSE_HOPS.frontDepthWeight * (t - nearest);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}
