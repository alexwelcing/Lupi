/** The grid cell never exceeds this; a longer reach scans more cells instead. */
export const GRID_MAX_CELL_A = 6;

/** Unordered atom pairs within a reach, i < j, sorted by (i, j), each once. */
export interface NeighborPairs {
  count: number;
  i: Int32Array;
  j: Int32Array;
  /** Squared distance in float64 from the (float32) input coordinates. */
  d2: Float64Array;
}

/**
 * Every pair (i < j) with d² ≤ reach², found on a uniform grid whose cell is
 * the reach (at most 6 Å). Cells are scanned in a fixed order and each atom's
 * partners are sorted, so the output does not depend on the order atoms were
 * inserted (`insertionOrder` exists to test exactly that). Atoms with
 * non-finite coordinates are never paired.
 */
export function neighborPairs(
  positions: ArrayLike<number>,
  natoms: number,
  reach: number,
  insertionOrder?: ArrayLike<number>,
): NeighborPairs {
  let capacity = Math.max(64, natoms * 16);
  let pi = new Int32Array(capacity);
  let pj = new Int32Array(capacity);
  let pd = new Float64Array(capacity);
  let count = 0;
  if (!(natoms >= 2) || !(reach > 0) || !Number.isFinite(reach)) return { count, i: pi.subarray(0, 0), j: pj.subarray(0, 0), d2: pd.subarray(0, 0) };

  const cell = Math.min(reach, GRID_MAX_CELL_A);
  const span = Math.ceil(reach / cell);
  const reach2 = reach * reach;
  const cx = new Float64Array(natoms);
  const cy = new Float64Array(natoms);
  const cz = new Float64Array(natoms);
  const finite = new Uint8Array(natoms);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let a = 0; a < natoms; a += 1) {
    const x = positions[3 * a];
    const y = positions[3 * a + 1];
    const z = positions[3 * a + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    finite[a] = 1;
    cx[a] = Math.floor(x / cell);
    cy[a] = Math.floor(y / cell);
    cz[a] = Math.floor(z / cell);
    if (cx[a] < minX) minX = cx[a];
    if (cx[a] > maxX) maxX = cx[a];
    if (cy[a] < minY) minY = cy[a];
    if (cy[a] > maxY) maxY = cy[a];
    if (cz[a] < minZ) minZ = cz[a];
    if (cz[a] > maxZ) maxZ = cz[a];
  }
  if (minX === Infinity) return { count, i: pi.subarray(0, 0), j: pj.subarray(0, 0), d2: pd.subarray(0, 0) };

  const nx = maxX - minX + 1;
  const ny = maxY - minY + 1;
  const nz = maxZ - minZ + 1;
  const dense = nx * ny * nz <= Math.max(4096, natoms * 8);

  // Dense: a head/next linked list per cell. Sparse (far-flung atoms): a Map
  // keyed by the exact integer cell, so there are no hash collisions to dedupe.
  const head = dense ? new Int32Array(nx * ny * nz).fill(-1) : null;
  const next = new Int32Array(natoms).fill(-1);
  const sparse = dense ? null : new Map<string, number>();
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const insert = (a: number) => {
    if (!finite[a]) return;
    if (head) {
      const c = (cx[a] - minX) + nx * ((cy[a] - minY) + ny * (cz[a] - minZ));
      next[a] = head[c];
      head[c] = a;
    } else {
      const key = cellKey(cx[a], cy[a], cz[a]);
      next[a] = sparse!.get(key) ?? -1;
      sparse!.set(key, a);
    }
  };
  if (insertionOrder) {
    for (let k = 0; k < insertionOrder.length; k += 1) insert(insertionOrder[k]);
  } else {
    for (let a = 0; a < natoms; a += 1) insert(a);
  }

  const firstIn = (x: number, y: number, z: number): number => {
    if (head) {
      const ox = x - minX;
      const oy = y - minY;
      const oz = z - minZ;
      if (ox < 0 || oy < 0 || oz < 0 || ox >= nx || oy >= ny || oz >= nz) return -1;
      return head[ox + nx * (oy + ny * oz)];
    }
    return sparse!.get(cellKey(x, y, z)) ?? -1;
  };

  for (let a = 0; a < natoms; a += 1) {
    if (!finite[a]) continue;
    const x = positions[3 * a];
    const y = positions[3 * a + 1];
    const z = positions[3 * a + 2];
    const start = count;
    for (let dz = -span; dz <= span; dz += 1) {
      for (let dy = -span; dy <= span; dy += 1) {
        for (let dx = -span; dx <= span; dx += 1) {
          for (let b = firstIn(cx[a] + dx, cy[a] + dy, cz[a] + dz); b >= 0; b = next[b]) {
            if (b <= a) continue;
            const ex = positions[3 * b] - x;
            const ey = positions[3 * b + 1] - y;
            const ez = positions[3 * b + 2] - z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > reach2) continue;
            if (count === capacity) {
              capacity *= 2;
              const ni = new Int32Array(capacity); ni.set(pi); pi = ni;
              const nj = new Int32Array(capacity); nj.set(pj); pj = nj;
              const nd = new Float64Array(capacity); nd.set(pd); pd = nd;
            }
            pi[count] = a;
            pj[count] = b;
            pd[count] = d2;
            count += 1;
          }
        }
      }
    }
    // Insertion sort of this atom's partners by j: short runs, and it makes
    // the output independent of cell-list order.
    for (let k = start + 1; k < count; k += 1) {
      const jk = pj[k];
      const dk = pd[k];
      let m = k - 1;
      while (m >= start && pj[m] > jk) {
        pj[m + 1] = pj[m];
        pd[m + 1] = pd[m];
        m -= 1;
      }
      pj[m + 1] = jk;
      pd[m + 1] = dk;
    }
  }
  return { count, i: pi.subarray(0, count), j: pj.subarray(0, count), d2: pd.subarray(0, count) };
}
