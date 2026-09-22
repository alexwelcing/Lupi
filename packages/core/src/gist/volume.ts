/**
 * Shape from the photo itself, in the rawest form there is: a grid of bits.
 *
 * No vocabulary, no named parts. The object's silhouette (a mask at pixel
 * resolution, made on the device) is puffed into a volume the way a paper
 * cut-out is inflated: how far a point is from the silhouette's edge decides
 * how deep the shape is there. The result is a bit per cell, occupied or
 * not, and a signed distance field over the same grid for the particles to
 * settle onto. A tree comes out as that tree's crown and trunk; a person as
 * that person; a bottle as that bottle. Everything here is plain TypeScript
 * with typed arrays so it runs in the page, in a worker, or in Node.
 *
 * Three depth models, chosen per photo (by Jev, from measured features):
 * - inflate: depth grows with distance from the edge (organic things);
 * - extrude: a constant thickness (flat things: a book, a phone, a leaf);
 * - revolve: each row is a disc as wide as the silhouette there (things
 *   that are the same all the way around: bottles, cups, lamps).
 */
export type DepthModel = 'inflate' | 'extrude' | 'revolve';

export interface MaskImage {
  width: number;
  height: number;
  /** 1 where the pixel belongs to the object. */
  data: Uint8Array;
}

export interface MaskFeatures {
  width: number;
  height: number;
  /** Object pixels over all pixels. */
  fill: number;
  /** Bounding box in pixel fractions of the image. */
  box: { left: number; top: number; right: number; bottom: number };
  /** Bounding-box height over width. */
  aspect: number;
  /** Silhouette width per band, top to bottom, as a fraction of the object's height. */
  profile: number[];
  /** Object mass per column band, left to right, as a fraction of the total. */
  columns: number[];
  /** Object mass per row band, top to bottom, as a fraction of the total. */
  rows: number[];
  /** Connected pieces before keeping the largest. */
  components: number;
  /** Left-right symmetry of the row profile, 0..1. */
  symmetry: number;
  /** Edge pixels over object pixels: 0.05 is a blob, 0.4 is a bush. */
  edginess: number;
}

export interface Volume {
  /** Cells per side. */
  n: number;
  /** World-space corner of cell (0, 0, 0) and the size of one cell. */
  origin: [number, number, number];
  cell: number;
  /** One bit per cell, x fastest, then y, then z. The shape, and nothing else. */
  bits: Uint8Array;
  /** Signed distance in world units at each cell centre, negative inside. */
  sdf: Float32Array;
  /** Occupied cells. */
  filled: number;
  depth: DepthModel;
  fatness: number;
}

export const VOLUME_SIZE = 64;
export const PROFILE_BANDS_MASK = 12;

/* ─── Masks ─── */

/** Keep only the largest 4-connected piece; the rest is usually the table's edge or a shadow. */
export function largestComponent(mask: MaskImage): { mask: MaskImage; components: number } {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height);
  const sizes: number[] = [0];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || labels[start]) continue;
    const label = next++;
    sizes[label] = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length) {
      const index = stack.pop()!;
      sizes[label] += 1;
      const x = index % width;
      const y = (index - x) / width;
      const neighbours = [index - 1, index + 1, index - width, index + width];
      const valid = [x > 0, x < width - 1, y > 0, y < height - 1];
      for (let k = 0; k < 4; k += 1) {
        const at = neighbours[k];
        if (valid[k] && data[at] && !labels[at]) {
          labels[at] = label;
          stack.push(at);
        }
      }
    }
  }
  const components = next - 1;
  if (components <= 1) return { mask, components };
  let best = 1;
  for (let label = 2; label < next; label += 1) if (sizes[label] > sizes[best]) best = label;
  const out = new Uint8Array(width * height);
  for (let index = 0; index < out.length; index += 1) out[index] = labels[index] === best ? 1 : 0;
  return { mask: { width, height, data: out }, components };
}

/** Fill enclosed holes (a mug's handle opening stays because it touches the background... unless it does not; small holes are noise). */
export function fillSmallHoles(mask: MaskImage, maxHoleFraction = 0.01): MaskImage {
  const { width, height, data } = mask;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (index: number) => {
    if (!data[index] && !outside[index]) {
      outside[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }
  // Every background pixel not reachable from the border is a hole.
  const holes = new Int32Array(width * height);
  const holeSizes: number[] = [0];
  let next = 1;
  for (let start = 0; start < data.length; start += 1) {
    if (data[start] || outside[start] || holes[start]) continue;
    const label = next++;
    holeSizes[label] = 0;
    stack.push(start);
    holes[start] = label;
    while (stack.length) {
      const index = stack.pop()!;
      holeSizes[label] += 1;
      const x = index % width;
      const y = (index - x) / width;
      for (const at of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (at >= 0 && !data[at] && !outside[at] && !holes[at]) {
          holes[at] = label;
          stack.push(at);
        }
      }
    }
  }
  const out = new Uint8Array(data);
  const limit = width * height * maxHoleFraction;
  for (let index = 0; index < out.length; index += 1) {
    if (holes[index] && holeSizes[holes[index]] <= limit) out[index] = 1;
  }
  return { width, height, data: out };
}

/** Measured features of a silhouette, for Jev to judge without seeing it. */
export function maskFeatures(mask: MaskImage, components = 1, bands = PROFILE_BANDS_MASK): MaskFeatures {
  const { width, height, data } = mask;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let count = 0;
  let edges = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!data[index]) continue;
      count += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !data[index - 1] || !data[index + 1] || !data[index - width] || !data[index + width]) edges += 1;
    }
  }
  if (count === 0) {
    return { width, height, fill: 0, box: { left: 0, top: 0, right: 0, bottom: 0 }, aspect: 1, profile: new Array(bands).fill(0), columns: new Array(bands).fill(0), rows: new Array(bands).fill(0), components, symmetry: 1, edginess: 0 };
  }
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const profile = new Array<number>(bands).fill(0);
  const rows = new Array<number>(bands).fill(0);
  const columns = new Array<number>(bands).fill(0);
  const leftAt = new Array<number>(bands).fill(0);
  const rightAt = new Array<number>(bands).fill(0);
  for (let band = 0; band < bands; band += 1) {
    const y0 = top + Math.floor((band / bands) * boxHeight);
    const y1 = top + Math.max(y0 - top + 1, Math.floor(((band + 1) / bands) * boxHeight));
    let bandLeft = width;
    let bandRight = -1;
    for (let y = y0; y < y1 && y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (!data[y * width + x]) continue;
        rows[band] += 1;
        bandLeft = Math.min(bandLeft, x);
        bandRight = Math.max(bandRight, x);
      }
    }
    profile[band] = bandRight >= bandLeft ? (bandRight - bandLeft + 1) / boxHeight : 0;
    leftAt[band] = bandLeft;
    rightAt[band] = bandRight;
  }
  for (let band = 0; band < bands; band += 1) {
    const x0 = left + Math.floor((band / bands) * boxWidth);
    const x1 = left + Math.max(x0 - left + 1, Math.floor(((band + 1) / bands) * boxWidth));
    for (let x = x0; x < x1 && x <= right; x += 1) for (let y = top; y <= bottom; y += 1) if (data[y * width + x]) columns[band] += 1;
  }
  const axis = (left + right) / 2;
  let asym = 0;
  let bandsCounted = 0;
  for (let band = 0; band < bands; band += 1) {
    if (rightAt[band] < leftAt[band]) continue;
    const l = axis - leftAt[band];
    const r = rightAt[band] - axis;
    asym += Math.abs(l - r) / Math.max(l + r, 1);
    bandsCounted += 1;
  }
  return {
    width,
    height,
    fill: count / (width * height),
    box: { left: left / width, top: top / height, right: (right + 1) / width, bottom: (bottom + 1) / height },
    aspect: boxHeight / boxWidth,
    profile,
    columns: columns.map((value) => value / count),
    rows: rows.map((value) => value / count),
    components,
    symmetry: bandsCounted ? 1 - asym / bandsCounted : 1,
    edginess: edges / count,
  };
}

/* ─── Distance transforms (Felzenszwalb and Huttenlocher, squared, separable) ─── */

function edt1d(f: Float32Array, n: number, out: Float32Array, v: Int32Array, z: Float32Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance from every cell to the nearest cell where `inside` is set, on a 2D grid. */
export function squaredDistance2D(inside: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e12;
  const grid = new Float32Array(width * height);
  for (let index = 0; index < grid.length; index += 1) grid[index] = inside[index] ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float32Array(n);
  const out = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, height, out, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = out[y];
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x];
    edt1d(f, width, out, v, z);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = out[x];
  }
  return grid;
}

/** Squared distance to the nearest set cell on an n³ grid, in place on a float grid seeded 0/INF. */
function squaredDistance3D(grid: Float32Array, n: number): void {
  const f = new Float32Array(n);
  const out = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  const at = (x: number, y: number, zz: number) => x + n * (y + n * zz);
  for (let zz = 0; zz < n; zz += 1) {
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) f[x] = grid[at(x, y, zz)];
      edt1d(f, n, out, v, z);
      for (let x = 0; x < n; x += 1) grid[at(x, y, zz)] = out[x];
    }
  }
  for (let zz = 0; zz < n; zz += 1) {
    for (let x = 0; x < n; x += 1) {
      for (let y = 0; y < n; y += 1) f[y] = grid[at(x, y, zz)];
      edt1d(f, n, out, v, z);
      for (let y = 0; y < n; y += 1) grid[at(x, y, zz)] = out[y];
    }
  }
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      for (let zz = 0; zz < n; zz += 1) f[zz] = grid[at(x, y, zz)];
      edt1d(f, n, out, v, z);
      for (let zz = 0; zz < n; zz += 1) grid[at(x, y, zz)] = out[zz];
    }
  }
}

/* ─── Inflation ─── */

export interface VolumeOptions {
  depth?: DepthModel;
  /** How deep the shape is relative to how wide it is: 0.3 thin, 0.7 rounded, 1.1 fat. */
  fatness?: number;
  n?: number;
  /**
   * Where the mask's pixels sit in the world: the same sheet the particles
   * were born on, so a particle's pixel and its place on the shape agree.
   * `sheet` is the world size of the whole mask image; `zoom` and `centre`
   * frame the object.
   */
  sheet?: { width: number; height: number };
  zoom?: number;
  centre?: [number, number];
}

/** Frame the object: the zoom and centre that put its bounding box about 2 units tall or wide. */
export function frameMask(features: MaskFeatures, sheet: { width: number; height: number }, target = 2.0): { zoom: number; centre: [number, number] } {
  const boxWidth = (features.box.right - features.box.left) * sheet.width;
  const boxHeight = (features.box.bottom - features.box.top) * sheet.height;
  const zoom = Math.max(0.5, Math.min(3, target / Math.max(boxWidth, boxHeight, 1e-3)));
  const centre: [number, number] = [
    ((features.box.left + features.box.right) / 2 - 0.5) * sheet.width,
    (0.5 - (features.box.top + features.box.bottom) / 2) * sheet.height,
  ];
  return { zoom, centre };
}

/**
 * Inflate a silhouette into a volume. The grid covers the object's framed
 * bounding box with room for depth; `sdf` is in world units.
 */
export function buildVolume(mask: MaskImage, options: VolumeOptions = {}): Volume {
  const n = options.n ?? VOLUME_SIZE;
  const depth = options.depth ?? 'inflate';
  const fatness = options.fatness ?? 0.7;
  const sheet = options.sheet ?? { width: (2.6 * mask.width) / Math.max(mask.height, 1), height: 2.6 };
  const zoom = options.zoom ?? 1;
  const centre = options.centre ?? [0, 0];
  const { width, height, data } = mask;
  const pixel = (sheet.height / Math.max(height, 1)) * zoom;

  // The world box: the framed object, padded, made cubic so one cell size serves all axes.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!data[y * width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) {
    return { n, origin: [-1, -1, -1], cell: 2 / n, bits: new Uint8Array((n * n * n) >> 3), sdf: new Float32Array(n * n * n).fill(2), filled: 0, depth, fatness };
  }
  const worldX = (x: number) => ((x + 0.5) / width - 0.5) * sheet.width * zoom - centre[0] * zoom;
  const worldY = (y: number) => (0.5 - (y + 0.5) / height) * sheet.height * zoom - centre[1] * zoom;
  const objectWidth = (right - left + 1) * pixel;
  const objectHeight = (bottom - top + 1) * pixel;
  const span = Math.max(objectWidth, objectHeight) * 1.25;
  const cell = span / n;
  const origin: [number, number, number] = [
    (worldX(left) + worldX(right)) / 2 - span / 2,
    (worldY(bottom) + worldY(top)) / 2 - span / 2,
    -span / 2,
  ];

  // Distance to the silhouette's edge, in pixels, for the inflation.
  const edge = squaredDistance2D(data.map((value) => (value ? 0 : 1)) as Uint8Array, width, height);
  const inside = squaredDistance2D(data, width, height);
  let maxEdge = 0;
  for (let index = 0; index < data.length; index += 1) if (data[index]) maxEdge = Math.max(maxEdge, edge[index]);
  maxEdge = Math.sqrt(maxEdge) || 1;

  // Per row: the silhouette's axis and half-width, for revolving.
  const rowLeft = new Float32Array(height).fill(width);
  const rowRight = new Float32Array(height).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!data[y * width + x]) continue;
      rowLeft[y] = Math.min(rowLeft[y], x);
      rowRight[y] = Math.max(rowRight[y], x);
    }
  }
  const halfDepthAt = (x: number, y: number): number => {
    const index = y * width + x;
    if (!data[index]) return 0;
    switch (depth) {
      case 'extrude':
        return Math.max(pixel, objectHeight * 0.05 * fatness);
      case 'revolve': {
        const half = (rowRight[y] - rowLeft[y] + 1) / 2;
        const axis = (rowLeft[y] + rowRight[y]) / 2;
        const dx = x - axis;
        return Math.sqrt(Math.max(0, half * half - dx * dx)) * pixel * Math.max(0.3, Math.min(1.4, fatness / 0.7));
      }
      default: {
        // A rounded profile: deep in the middle, shallow at the edge, capped by the object's width.
        const d = Math.sqrt(edge[index]);
        const rounded = Math.sqrt(Math.max(0, d * (2 * maxEdge - d)));
        return Math.min(rounded * pixel * fatness, objectWidth * 0.6);
      }
    }
  };

  // Voxelize: every cell whose (x, y) lands on an object pixel and whose z is within the depth there.
  const bits = new Uint8Array((n * n * n) >> 3);
  const grid = new Float32Array(n * n * n);
  const INF = 1e12;
  let filled = 0;
  const px = new Int32Array(n);
  const py = new Int32Array(n);
  for (let gx = 0; gx < n; gx += 1) {
    const wx = origin[0] + (gx + 0.5) * cell;
    px[gx] = Math.round(((wx + centre[0] * zoom) / (sheet.width * zoom) + 0.5) * width - 0.5);
  }
  for (let gy = 0; gy < n; gy += 1) {
    const wy = origin[1] + (gy + 0.5) * cell;
    py[gy] = Math.round((0.5 - (wy + centre[1] * zoom) / (sheet.height * zoom)) * height - 0.5);
  }
  for (let gy = 0; gy < n; gy += 1) {
    const y = py[gy];
    for (let gx = 0; gx < n; gx += 1) {
      const x = px[gx];
      const half = x >= 0 && x < width && y >= 0 && y < height ? halfDepthAt(x, y) : 0;
      for (let gz = 0; gz < n; gz += 1) {
        const wz = origin[2] + (gz + 0.5) * cell;
        const index = gx + n * (gy + n * gz);
        const occupied = half > 0 && Math.abs(wz) < half;
        grid[index] = occupied ? 0 : INF;
        if (occupied) {
          bits[index >> 3] |= 1 << (index & 7);
          filled += 1;
        }
      }
    }
  }

  // Signed distance: outside cells measure to the shape, inside cells to the outside.
  const outsideDistance = grid;
  squaredDistance3D(outsideDistance, n);
  const insideDistance = new Float32Array(n * n * n);
  for (let index = 0; index < insideDistance.length; index += 1) insideDistance[index] = bits[index >> 3] & (1 << (index & 7)) ? INF : 0;
  squaredDistance3D(insideDistance, n);
  const sdf = new Float32Array(n * n * n);
  for (let index = 0; index < sdf.length; index += 1) {
    const occupied = bits[index >> 3] & (1 << (index & 7));
    sdf[index] = (occupied ? -Math.sqrt(insideDistance[index]) : Math.sqrt(outsideDistance[index])) * cell;
  }
  void inside;
  return { n, origin, cell, bits, sdf, filled, depth, fatness };
}

/** Signed distance of the volume at a world point, trilinear; the shader's `sdVolume` on the CPU. */
export function volumeDistance(volume: Volume, point: [number, number, number]): number {
  const { n, origin, cell, sdf } = volume;
  const gx = (point[0] - origin[0]) / cell - 0.5;
  const gy = (point[1] - origin[1]) / cell - 0.5;
  const gz = (point[2] - origin[2]) / cell - 0.5;
  const cx = Math.max(0, Math.min(n - 1.001, gx));
  const cy = Math.max(0, Math.min(n - 1.001, gy));
  const cz = Math.max(0, Math.min(n - 1.001, gz));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fy = cy - y0;
  const fz = cz - z0;
  const at = (x: number, y: number, z: number) => sdf[x + n * (y + n * z)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const inner = lerp(
    lerp(lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), fx), lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx), fy),
    lerp(lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx), lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx), fy),
    fz,
  );
  // Outside the grid, add the distance to the grid box.
  const outside = Math.hypot(Math.max(0, gx - cx), Math.max(0, gy - cy), Math.max(0, gz - cz), Math.max(0, cx - gx), Math.max(0, cy - gy), Math.max(0, cz - gz)) * cell;
  return inner + outside;
}
