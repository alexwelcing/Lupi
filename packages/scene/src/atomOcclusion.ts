/**
 * atomOcclusion — per-atom ambient occlusion from local neighbor density.
 *
 * Screen-space AO needs a depth pre-pass and per-pixel sampling, and it fades
 * out once atoms shrink below a few pixels — exactly where dense million-atom
 * systems live. The classic alternative (QuteMol, VMD "ambient occlusion")
 * bakes occlusion per atom: an atom buried under many neighbors receives
 * less ambient light than one on a surface, a crack, or a defect. That
 * reads at every zoom level, costs nothing per pixel, and makes grain
 * boundaries, voids and surfaces pop out of an otherwise uniform crystal.
 *
 * This module is pure (no DOM, no Three) so it runs inside a Web Worker.
 * Density is accumulated with a smooth kernel w = 1 - (d/R)² over a uniform
 * grid (counting sort, no per-atom allocation), normalized against a high
 * percentile of the scene so surfaces map to "open" and bulk to "buried".
 */

export interface AtomOcclusionInput {
  positions: Float32Array;
  natoms: number;
  /** Kernel radius in the frame's distance units. */
  radius: number;
  /** Percentile (0..1) of the density distribution treated as fully buried.
   *  Default 0.97 keeps rare hyper-dense spots from washing out the scene. */
  referencePercentile?: number;
}

export interface AtomOcclusionResult {
  /** 255 = fully exposed, 0 = fully buried. */
  occlusion: Uint8Array;
  /** Kernel density at the reference percentile (diagnostics). */
  referenceDensity: number;
}

/**
 * Kernel radius heuristic: roughly 1.6 typical bond lengths so the kernel
 * spans first and second neighbor shells without ballooning cost.
 */
export function suggestOcclusionRadius(
  maxCovalentRadius: number | undefined,
  positions: Float32Array,
  natoms: number,
): number {
  if (maxCovalentRadius !== undefined && Number.isFinite(maxCovalentRadius) && maxCovalentRadius > 0) {
    return Math.max(1e-3, 1.6 * 2 * maxCovalentRadius);
  }
  // Unknown chemistry (neutral units): estimate the mean spacing from the
  // bounding-box volume per atom.
  const count = Math.min(natoms, Math.floor(positions.length / 3));
  if (count < 2) return 1;
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
  return Number.isFinite(spacing) && spacing > 0 ? 2.2 * spacing : 1;
}

export function computeAtomOcclusion(input: AtomOcclusionInput): AtomOcclusionResult {
  const { positions } = input;
  const count = Math.max(0, Math.min(Math.trunc(input.natoms) || 0, Math.floor(positions.length / 3)));
  const occlusion = new Uint8Array(count);
  occlusion.fill(255);
  const radius = Number.isFinite(input.radius) && input.radius > 0 ? input.radius : 0;
  if (count < 2 || radius === 0) {
    return { occlusion, referenceDensity: 0 };
  }

  // Bounds.
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
  if (!Number.isFinite(minX + maxX + minY + maxY + minZ + maxZ)) {
    return { occlusion, referenceDensity: 0 };
  }

  // Grid with cell = kernel radius; coarsen if the box is huge relative to
  // the kernel so the cell array stays bounded.
  let cellSize = radius;
  const MAX_CELLS = 16_000_000;
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

  // Kernel density per atom. Each pair is visited once (j > i) and
  // contributes to both atoms.
  const density = new Float32Array(count);
  const r2 = radius * radius;
  const invR2 = 1 / r2;
  const reach = Math.max(1, Math.ceil(radius * invCell));
  for (let cz = 0; cz < dimZ; cz++) {
    for (let cy = 0; cy < dimY; cy++) {
      for (let cx = 0; cx < dimX; cx++) {
        const cell = cx + cy * strideY + cz * strideZ;
        const start = cellStart[cell];
        const end = cellStart[cell + 1];
        if (start === end) continue;
        const nz1 = Math.min(dimZ - 1, cz + reach);
        const ny0 = Math.max(0, cy - reach), ny1 = Math.min(dimY - 1, cy + reach);
        const nx0 = Math.max(0, cx - reach), nx1 = Math.min(dimX - 1, cx + reach);
        for (let k = start; k < end; k++) {
          const i = cellItems[k];
          const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
          let sum = 0;
          // Forward half-space of cells (nz >= cz), plus the same cell handled
          // with a j > i test, so each pair is evaluated once.
          for (let nz = cz; nz <= nz1; nz++) {
            for (let ny = nz === cz ? cy : ny0; ny <= ny1; ny++) {
              for (let nx = (nz === cz && ny === cy) ? cx : nx0; nx <= nx1; nx++) {
                if (nz === cz && ny === cy && nx < cx) continue;
                const nCell = nx + ny * strideY + nz * strideZ;
                const sameCell = nCell === cell;
                for (let m = cellStart[nCell], mEnd = cellStart[nCell + 1]; m < mEnd; m++) {
                  const j = cellItems[m];
                  if (sameCell && j <= i) continue;
                  const dx = positions[j * 3] - ix;
                  const dy = positions[j * 3 + 1] - iy;
                  const dz = positions[j * 3 + 2] - iz;
                  const d2 = dx * dx + dy * dy + dz * dz;
                  if (d2 >= r2) continue;
                  const w = 1 - d2 * invR2;
                  sum += w;
                  density[j] += w;
                }
              }
            }
          }
          density[i] += sum;
        }
      }
    }
  }

  // Reference density: a high percentile via a 1024-bin histogram.
  let maxDensity = 0;
  for (let i = 0; i < count; i++) if (density[i] > maxDensity) maxDensity = density[i];
  if (maxDensity <= 0) {
    return { occlusion, referenceDensity: 0 };
  }
  const BINS = 1024;
  const histogram = new Int32Array(BINS);
  const binScale = (BINS - 1) / maxDensity;
  for (let i = 0; i < count; i++) histogram[Math.floor(density[i] * binScale)]++;
  const percentile = Math.min(1, Math.max(0, input.referencePercentile ?? 0.97));
  const target = percentile * count;
  let cumulative = 0;
  let referenceBin = BINS - 1;
  for (let b = 0; b < BINS; b++) {
    cumulative += histogram[b];
    if (cumulative >= target) { referenceBin = b; break; }
  }
  const referenceDensity = Math.max(1e-6, (referenceBin + 1) / binScale);

  const invRef = 1 / referenceDensity;
  for (let i = 0; i < count; i++) {
    const buried = Math.min(1, density[i] * invRef);
    // Keep a little light on bulk atoms: fully buried maps to ~18% openness so
    // interior color stays legible under strong occlusion.
    const openness = 1 - buried * 0.82;
    occlusion[i] = Math.round(openness * 255);
  }
  return { occlusion, referenceDensity };
}
