/**
 * atomContactOcclusion — the "Contact" bake: each atom's nearest neighbours,
 * so the impostor can shade analytic sphere occlusion per pixel.
 *
 * Screen-space AO is off on phones (the mobile post budget), shimmers while
 * rotating and halos the plate. The scalar density bake (atomOcclusion.ts)
 * reads voids in a million-atom crystal but is uniform on a symmetric
 * molecule: every C60 atom has the same density. Contact occlusion is the
 * small-molecule counterpart: the side of an atom that faces a neighbour
 * darkens exactly where they touch, so the cage, the ring and the crevices
 * read, with no noise, no halo and no per-frame cost while the scene rests.
 *
 * The bake keeps, per atom, the K nearest neighbours within `range` (ties
 * broken by index, so the result is a deterministic function of the
 * positions) as an offset (snorm8 of `range`) plus the neighbour's index.
 * The viewer turns the index into the neighbour's type slot when it uploads
 * the texture, and the shader reads the neighbour's radius from the live
 * radius palette, so atom scale, per-type scale and hidden types need no
 * re-bake. Per pixel, each neighbour sphere (centre c, radius r) occludes the
 * hit point p with normal n by
 *
 *   occ = (r / d)² · clamp((h + r) / (d + r), 0, 1),  v = c − p, d = |v|, h = n·v
 *
 * Quilez's sphere occlusion with a horizon term, so a neighbour partly below
 * the tangent plane still counts and one fully below counts zero. An empty
 * neighbour slot is a zero offset: its "centre" is the atom's own centre,
 * below every surface point, so it contributes nothing.
 *
 * Pure (no DOM, no Three): it runs on the main thread for small molecules
 * and in the scene-analysis worker for larger ones.
 */

/** Neighbours kept per atom (texels per atom in the contact texture). */
export const CONTACT_OCCLUSION_NEIGHBORS = 8;
/** Above this many atoms the bake is skipped (the density bake carries large scenes). */
export const CONTACT_OCCLUSION_MAX_ATOMS = 250_000;
/** At or below this many atoms the bake runs synchronously (no pop-in, export-ready at once). */
export const CONTACT_OCCLUSION_SYNC_ATOMS = 12_000;
/** Width of the contact texture in texels (rows hold 256 atoms). */
export const CONTACT_TEXTURE_WIDTH = 2048;

export interface ContactOcclusionInput {
  positions: Float32Array;
  natoms: number;
  /** Neighbour search radius, in the frame's distance units. */
  range: number;
}

export interface ContactOcclusionBake {
  natoms: number;
  /** Search radius the offsets are normalized by. */
  range: number;
  /** Neighbour index per slot (natoms × K), -1 for an empty slot. */
  neighbors: Int32Array;
  /** Neighbour − atom offsets as snorm8 of `range` (natoms × K × 3); zero for an empty slot. */
  offsets: Int8Array;
}

/**
 * Search radius for the bake: wide enough to reach bonded neighbours at ball-
 * and-stick radii (C–C 1.4–1.54 Å) and the second shell, and to cover touching
 * spheres at space-filling scales.
 */
export function suggestContactRange(
  maxDisplayRadius: number,
  angstrom: boolean,
  positions: Float32Array,
  natoms: number,
): number {
  const radius = Number.isFinite(maxDisplayRadius) && maxDisplayRadius > 0 ? maxDisplayRadius : 0.5;
  if (angstrom) return Math.min(8, Math.max(2.8, 4 * radius));
  // Unknown units: the mean spacing from the bounding-box volume per atom.
  const count = Math.min(natoms, Math.floor(positions.length / 3));
  if (count < 2) return 4 * radius;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const volume = Math.max(1e-9, (maxX - minX) * (maxY - minY) * (maxZ - minZ));
  const spacing = Math.cbrt(volume / count);
  const bySpacing = Number.isFinite(spacing) && spacing > 0 ? 1.8 * spacing : 0;
  return Math.max(4 * radius, bySpacing);
}

function emptyBake(natoms: number, range: number): ContactOcclusionBake {
  const k = CONTACT_OCCLUSION_NEIGHBORS;
  return {
    natoms,
    range,
    neighbors: new Int32Array(natoms * k).fill(-1),
    offsets: new Int8Array(natoms * k * 3),
  };
}

function snorm8(value: number): number {
  const q = Math.round(value * 127);
  return q > 127 ? 127 : q < -127 ? -127 : q;
}

export function computeContactOcclusion(input: ContactOcclusionInput): ContactOcclusionBake {
  const { positions } = input;
  const count = Math.max(0, Math.min(Math.trunc(input.natoms) || 0, Math.floor(positions.length / 3)));
  const range = Number.isFinite(input.range) && input.range > 0 ? input.range : 0;
  const bake = emptyBake(count, range);
  if (count < 2 || range === 0) return bake;
  const K = CONTACT_OCCLUSION_NEIGHBORS;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX + maxX + minY + maxY + minZ + maxZ)) return bake;

  // Grid with cell ≥ range (one-cell reach); coarsened for sparse huge boxes.
  let cellSize = range;
  const MAX_CELLS = 8_000_000;
  let dimX = 0, dimY = 0, dimZ = 0;
  for (let attempt = 0; attempt < 32; attempt++) {
    dimX = Math.floor((maxX - minX) / cellSize) + 1;
    dimY = Math.floor((maxY - minY) / cellSize) + 1;
    dimZ = Math.floor((maxZ - minZ) / cellSize) + 1;
    if (dimX * dimY * dimZ <= MAX_CELLS) break;
    cellSize *= 2;
  }
  const invCell = 1 / cellSize;
  const numCells = dimX * dimY * dimZ;
  const strideY = dimX;
  const strideZ = dimX * dimY;
  const cellStart = new Int32Array(numCells + 1);
  const cellOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.min(dimX - 1, Math.floor((positions[i * 3] - minX) * invCell));
    const cy = Math.min(dimY - 1, Math.floor((positions[i * 3 + 1] - minY) * invCell));
    const cz = Math.min(dimZ - 1, Math.floor((positions[i * 3 + 2] - minZ) * invCell));
    const cell = cx + cy * strideY + cz * strideZ;
    cellOf[i] = cell;
    cellStart[cell + 1]++;
  }
  for (let c = 0; c < numCells; c++) cellStart[c + 1] += cellStart[c];
  const cursor = cellStart.slice(0, numCells);
  const cellItems = new Int32Array(count);
  for (let i = 0; i < count; i++) cellItems[cursor[cellOf[i]]++] = i;

  const r2 = range * range;
  const invRange = 1 / range;
  // Per-atom top-K scratch, sorted by (d², index) ascending.
  const bestD2 = new Float64Array(K);
  const bestJ = new Int32Array(K);
  const { neighbors, offsets } = bake;

  for (let i = 0; i < count; i++) {
    const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
    const cell = cellOf[i];
    const cx = cell % dimX;
    const cy = Math.floor(cell / strideY) % dimY;
    const cz = Math.floor(cell / strideZ);
    let found = 0;
    for (let nz = Math.max(0, cz - 1); nz <= Math.min(dimZ - 1, cz + 1); nz++) {
      for (let ny = Math.max(0, cy - 1); ny <= Math.min(dimY - 1, cy + 1); ny++) {
        for (let nx = Math.max(0, cx - 1); nx <= Math.min(dimX - 1, cx + 1); nx++) {
          const nCell = nx + ny * strideY + nz * strideZ;
          for (let m = cellStart[nCell], mEnd = cellStart[nCell + 1]; m < mEnd; m++) {
            const j = cellItems[m];
            if (j === i) continue;
            const dx = positions[j * 3] - ix;
            const dy = positions[j * 3 + 1] - iy;
            const dz = positions[j * 3 + 2] - iz;
            const d2 = dx * dx + dy * dy + dz * dz;
            // Coincident atoms carry no direction; out-of-range ones no weight.
            if (d2 >= r2 || d2 < 1e-12) continue;
            if (found === K && (d2 > bestD2[K - 1] || (d2 === bestD2[K - 1] && j > bestJ[K - 1]))) continue;
            // Insertion into the sorted top-K.
            let slot = found < K ? found : K - 1;
            while (slot > 0 && (bestD2[slot - 1] > d2 || (bestD2[slot - 1] === d2 && bestJ[slot - 1] > j))) {
              bestD2[slot] = bestD2[slot - 1];
              bestJ[slot] = bestJ[slot - 1];
              slot--;
            }
            bestD2[slot] = d2;
            bestJ[slot] = j;
            if (found < K) found++;
          }
        }
      }
    }
    const base = i * K;
    for (let k = 0; k < found; k++) {
      const j = bestJ[k];
      neighbors[base + k] = j;
      const o = (base + k) * 3;
      offsets[o] = snorm8((positions[j * 3] - ix) * invRange);
      offsets[o + 1] = snorm8((positions[j * 3 + 1] - iy) * invRange);
      offsets[o + 2] = snorm8((positions[j * 3 + 2] - iz) * invRange);
    }
  }
  return bake;
}

/**
 * The CPU twin of the shader's per-pixel term, for one neighbour sphere:
 * occlusion of a surface point `p` with unit normal `n` by a sphere at `c`
 * of radius `r` (all world space).
 */
export function sphereContactOcclusion(
  p: readonly [number, number, number],
  n: readonly [number, number, number],
  c: readonly [number, number, number],
  r: number,
): number {
  if (!(r > 0)) return 0;
  const vx = c[0] - p[0], vy = c[1] - p[1], vz = c[2] - p[2];
  const d = Math.max(1e-4, Math.hypot(vx, vy, vz));
  const h = n[0] * vx + n[1] * vy + n[2] * vz;
  const horizon = Math.min(1, Math.max(0, (h + r) / (d + r)));
  return Math.min(1, (r / d) ** 2) * horizon;
}

/** Rows of the contact texture for `natoms` atoms. */
export function contactTextureRows(natoms: number): number {
  return Math.max(1, Math.ceil((natoms * CONTACT_OCCLUSION_NEIGHBORS) / CONTACT_TEXTURE_WIDTH));
}

/**
 * Fill the RGBA8 contact texture: texel (atom·K + k) = (offset as unorm of
 * snorm, neighbour type slot). `slotOf(j)` is the neighbour's type slot.
 */
export function writeContactTexture(
  out: Uint8Array,
  bake: ContactOcclusionBake,
  count: number,
  slotOf: (atomIndex: number) => number,
): void {
  const K = CONTACT_OCCLUSION_NEIGHBORS;
  const n = Math.min(count, bake.natoms) * K;
  for (let t = 0; t < n; t++) {
    const j = bake.neighbors[t];
    const o = t * 3;
    const b = t * 4;
    if (j < 0 || j >= count) {
      // Zero offset (128 = 0 in the shader's decode): contributes nothing.
      out[b] = 128;
      out[b + 1] = 128;
      out[b + 2] = 128;
      out[b + 3] = 0;
      continue;
    }
    out[b] = bake.offsets[o] + 128;
    out[b + 1] = bake.offsets[o + 1] + 128;
    out[b + 2] = bake.offsets[o + 2] + 128;
    out[b + 3] = slotOf(j);
  }
  for (let t = n * 4; t < out.length; t += 4) {
    out[t] = 128;
    out[t + 1] = 128;
    out[t + 2] = 128;
    out[t + 3] = 0;
  }
}
