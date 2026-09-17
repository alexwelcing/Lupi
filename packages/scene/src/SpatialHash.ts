/**
 * SpatialHash3D — O(1) atom lookup for raycasting and neighbor queries
 *
 * Used for:
 * - Atom picking (hover/click in viewport)
 * - Bond detection (find neighbors within cutoff)
 * - Selection queries (box select, radius select)
 *
 * Implementation: a uniform grid over the positions' bounding box stored as a
 * counting sort (`cellStart` prefix sums + `cellItems`). Building it touches
 * every atom twice with no per-atom allocation and no string keys, so a
 * million-atom build costs tens of milliseconds and a few MB — cheap enough
 * to keep atom picking alive on very large scenes.
 */

/** Upper bound on grid cells; the cell size grows to respect it so a sparse
 *  point cloud cannot allocate an enormous empty grid. */
const MAX_GRID_CELLS = 8_000_000;

export class SpatialHash3D {
  private cellSize: number;
  private invCellSize: number;
  private positions: Float32Array = new Float32Array(0);
  private count = 0;
  private minX = 0;
  private minY = 0;
  private minZ = 0;
  private dimX = 0;
  private dimY = 0;
  private dimZ = 0;
  private cellStart: Int32Array = new Int32Array(1);
  private cellItems: Int32Array = new Int32Array(0);

  constructor(cellSize: number = 3.0) {
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 3.0;
    this.invCellSize = 1 / this.cellSize;
  }

  /**
   * Build spatial hash from atom positions
   * Call whenever atom positions change (new frame)
   */
  build(positions: Float32Array, natoms: number) {
    const count = Math.max(0, Math.min(Math.trunc(natoms) || 0, Math.floor(positions.length / 3)));
    this.positions = positions;
    this.count = count;

    if (count === 0) {
      this.dimX = this.dimY = this.dimZ = 0;
      this.cellStart = new Int32Array(1);
      this.cellItems = new Int32Array(0);
      return;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0, end = count * 3; i < end; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)
      || !Number.isFinite(minY) || !Number.isFinite(maxY)
      || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
      // Non-finite coordinates cannot be binned; degrade to a single cell so
      // queries still scan every finite atom.
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }

    // Choose the cell size: the configured size unless the grid would exceed
    // the cell budget, in which case coarsen uniformly.
    let cellSize = this.cellSize;
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    for (let attempt = 0; attempt < 32; attempt++) {
      const dx = Math.floor(extentX / cellSize) + 1;
      const dy = Math.floor(extentY / cellSize) + 1;
      const dz = Math.floor(extentZ / cellSize) + 1;
      if (dx * dy * dz <= MAX_GRID_CELLS) break;
      cellSize *= 2;
    }
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.dimX = Math.floor(extentX * this.invCellSize) + 1;
    this.dimY = Math.floor(extentY * this.invCellSize) + 1;
    this.dimZ = Math.floor(extentZ * this.invCellSize) + 1;

    const numCells = this.dimX * this.dimY * this.dimZ;
    const cellStart = new Int32Array(numCells + 1);
    const cellOf = new Int32Array(count);

    // Pass 1: histogram.
    for (let i = 0; i < count; i++) {
      const cell = this.cellIndexOf(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      cellOf[i] = cell;
      cellStart[cell + 1]++;
    }
    // Prefix sums.
    for (let c = 0; c < numCells; c++) cellStart[c + 1] += cellStart[c];
    // Pass 2: scatter (cursor array reuses a copy of the starts).
    const cursor = cellStart.slice(0, numCells);
    const cellItems = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const cell = cellOf[i];
      cellItems[cursor[cell]++] = i;
    }
    this.cellStart = cellStart;
    this.cellItems = cellItems;
  }

  private cellIndexOf(x: number, y: number, z: number): number {
    let cx = Math.floor((x - this.minX) * this.invCellSize);
    let cy = Math.floor((y - this.minY) * this.invCellSize);
    let cz = Math.floor((z - this.minZ) * this.invCellSize);
    if (!(cx >= 0)) cx = 0; else if (cx >= this.dimX) cx = this.dimX - 1;
    if (!(cy >= 0)) cy = 0; else if (cy >= this.dimY) cy = this.dimY - 1;
    if (!(cz >= 0)) cz = 0; else if (cz >= this.dimZ) cz = this.dimZ - 1;
    return cx + cy * this.dimX + cz * this.dimX * this.dimY;
  }

  /**
   * Query atoms within radius of point
   * Returns sorted by distance (closest first)
   */
  query(x: number, y: number, z: number, radius: number): Array<{ index: number; dist: number }> {
    const results: Array<{ index: number; dist: number }> = [];
    if (this.count === 0 || !(radius > 0)) return results;

    const positions = this.positions;
    const r2 = radius * radius;
    const cx0 = Math.max(0, Math.floor((x - radius - this.minX) * this.invCellSize));
    const cx1 = Math.min(this.dimX - 1, Math.floor((x + radius - this.minX) * this.invCellSize));
    const cy0 = Math.max(0, Math.floor((y - radius - this.minY) * this.invCellSize));
    const cy1 = Math.min(this.dimY - 1, Math.floor((y + radius - this.minY) * this.invCellSize));
    const cz0 = Math.max(0, Math.floor((z - radius - this.minZ) * this.invCellSize));
    const cz1 = Math.min(this.dimZ - 1, Math.floor((z + radius - this.minZ) * this.invCellSize));
    if (cx0 > cx1 || cy0 > cy1 || cz0 > cz1) return results;

    const cellStart = this.cellStart;
    const cellItems = this.cellItems;
    const strideY = this.dimX;
    const strideZ = this.dimX * this.dimY;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        let cell = cx0 + cy * strideY + cz * strideZ;
        for (let cx = cx0; cx <= cx1; cx++, cell++) {
          for (let k = cellStart[cell], end = cellStart[cell + 1]; k < end; k++) {
            const idx = cellItems[k];
            const dx = positions[idx * 3] - x;
            const dy = positions[idx * 3 + 1] - y;
            const dz = positions[idx * 3 + 2] - z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < r2) {
              results.push({ index: idx, dist: Math.sqrt(distSq) });
            }
          }
        }
      }
    }

    // Sort by distance
    return results.sort((a, b) => a.dist - b.dist);
  }

  /**
   * Find closest atom to point
   * Returns null if no atoms within maxRadius
   */
  closest(x: number, y: number, z: number, maxRadius: number = 10): { index: number; dist: number } | null {
    // Search in expanding spheres for efficiency
    let searchRadius = this.cellSize;

    while (searchRadius <= maxRadius) {
      const found = this.query(x, y, z, searchRadius);
      if (found.length > 0) {
        return found[0];
      }
      searchRadius *= 2;
    }

    return null;
  }

  /**
   * Get all atoms in cell containing point
   * Fast O(1) lookup for exact cell matches
   */
  getCell(x: number, y: number, z: number): number[] {
    if (this.count === 0) return [];
    const cx = Math.floor((x - this.minX) * this.invCellSize);
    const cy = Math.floor((y - this.minY) * this.invCellSize);
    const cz = Math.floor((z - this.minZ) * this.invCellSize);
    if (cx < 0 || cx >= this.dimX || cy < 0 || cy >= this.dimY || cz < 0 || cz >= this.dimZ) return [];
    const cell = cx + cy * this.dimX + cz * this.dimX * this.dimY;
    return Array.from(this.cellItems.subarray(this.cellStart[cell], this.cellStart[cell + 1]));
  }

  /**
   * Generate bond pairs based on distance cutoff
   * Returns array of [atom1, atom2] pairs
   */
  findBonds(maxBondLength: number, typeCutoffs?: Map<string, number>): Array<[number, number]> {
    void typeCutoffs;
    const bonds: Array<[number, number]> = [];
    if (this.count === 0 || !(maxBondLength > 0)) return bonds;
    const positions = this.positions;
    const cutoffSq = maxBondLength * maxBondLength;
    const reach = Math.ceil(maxBondLength * this.invCellSize);
    const strideY = this.dimX;
    const strideZ = this.dimX * this.dimY;

    for (let cz = 0; cz < this.dimZ; cz++) {
      for (let cy = 0; cy < this.dimY; cy++) {
        for (let cx = 0; cx < this.dimX; cx++) {
          const cell = cx + cy * strideY + cz * strideZ;
          const start = this.cellStart[cell];
          const end = this.cellStart[cell + 1];
          if (start === end) continue;
          const nz0 = Math.max(0, cz - reach), nz1 = Math.min(this.dimZ - 1, cz + reach);
          const ny0 = Math.max(0, cy - reach), ny1 = Math.min(this.dimY - 1, cy + reach);
          const nx0 = Math.max(0, cx - reach), nx1 = Math.min(this.dimX - 1, cx + reach);
          for (let k = start; k < end; k++) {
            const i = this.cellItems[k];
            const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
            for (let nz = nz0; nz <= nz1; nz++) {
              for (let ny = ny0; ny <= ny1; ny++) {
                for (let nx = nx0; nx <= nx1; nx++) {
                  const nCell = nx + ny * strideY + nz * strideZ;
                  for (let m = this.cellStart[nCell], mEnd = this.cellStart[nCell + 1]; m < mEnd; m++) {
                    const j = this.cellItems[m];
                    if (i >= j) continue; // canonical i < j, each pair once
                    const dx = positions[j * 3] - ix;
                    const dy = positions[j * 3 + 1] - iy;
                    const dz = positions[j * 3 + 2] - iz;
                    if (dx * dx + dy * dy + dz * dz < cutoffSq) {
                      bonds.push([i, j]);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return bonds;
  }

  /** Clear all data */
  clear() {
    this.positions = new Float32Array(0);
    this.count = 0;
    this.dimX = this.dimY = this.dimZ = 0;
    this.cellStart = new Int32Array(1);
    this.cellItems = new Int32Array(0);
  }

  /** Get statistics */
  stats() {
    const numCells = this.dimX * this.dimY * this.dimZ;
    let populated = 0;
    let maxInCell = 0;
    for (let c = 0; c < numCells; c++) {
      const n = this.cellStart[c + 1] - this.cellStart[c];
      if (n > 0) populated++;
      if (n > maxInCell) maxInCell = n;
    }

    return {
      numCells: populated,
      totalAtoms: this.count,
      avgPerCell: this.count / (populated || 1),
      maxInCell,
    };
  }
}
