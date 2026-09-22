/**
 * Turn a reconstructed object to face the way the photo saw it.
 *
 * A reconstruction may come back in the object's own canonical frame (a
 * mug with its handle wherever the model likes), while the photo, and the
 * particles born from it, know exactly where the handle was. Both are
 * silhouettes when projected, so: try every yaw about the vertical axis,
 * with and without a mirror, project the points onto the picture plane,
 * and keep the turn whose silhouette overlaps the photo's mask best. A
 * measurement, not a guess, and a few milliseconds.
 */
import type { MaskImage } from './volume';
import type { ColouredPoints } from './points';

export interface Alignment {
  /** Yaw applied, radians, about y. */
  yaw: number;
  mirrored: boolean;
  /** Intersection over union of the projected silhouette and the mask, 0..1. */
  overlap: number;
  /** Every candidate tried, for the dev panel. */
  tried: Array<{ yaw: number; mirrored: boolean; overlap: number }>;
}

const RASTER = 64;

/** Rasterise a mask into a square grid, scaled to its bounding box. */
function maskRaster(mask: MaskImage): { grid: Uint8Array; aspect: number } {
  const { width, height, data } = mask;
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
  const grid = new Uint8Array(RASTER * RASTER);
  if (right < left) return { grid, aspect: 1 };
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  for (let gy = 0; gy < RASTER; gy += 1) {
    const y = top + Math.min(boxHeight - 1, Math.floor(((gy + 0.5) / RASTER) * boxHeight));
    for (let gx = 0; gx < RASTER; gx += 1) {
      const x = left + Math.min(boxWidth - 1, Math.floor(((gx + 0.5) / RASTER) * boxWidth));
      grid[gy * RASTER + gx] = data[y * width + x] ? 1 : 0;
    }
  }
  return { grid, aspect: boxHeight / boxWidth };
}

/** Project turned points onto the picture plane, scaled to their own box. */
function pointsRaster(points: ColouredPoints, yaw: number, mirrored: boolean): { grid: Uint8Array; aspect: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sign = mirrored ? -1 : 1;
  const xs = new Float32Array(points.count);
  const ys = new Float32Array(points.count);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let n = 0; n < points.count; n += 1) {
    const x = points.positions[n * 3] * sign;
    const z = points.positions[n * 3 + 2];
    const turned = x * cos + z * sin;
    xs[n] = turned;
    ys[n] = points.positions[n * 3 + 1];
    minX = Math.min(minX, turned);
    maxX = Math.max(maxX, turned);
    minY = Math.min(minY, ys[n]);
    maxY = Math.max(maxY, ys[n]);
  }
  const grid = new Uint8Array(RASTER * RASTER);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  for (let n = 0; n < points.count; n += 1) {
    const gx = Math.min(RASTER - 1, Math.floor(((xs[n] - minX) / spanX) * RASTER));
    // Image rows run top to bottom; y runs up.
    const gy = Math.min(RASTER - 1, Math.floor(((maxY - ys[n]) / spanY) * RASTER));
    grid[gy * RASTER + gx] = 1;
  }
  // Close one-cell gaps so a sparse projection still reads as a silhouette.
  const closed = new Uint8Array(grid);
  for (let gy = 1; gy < RASTER - 1; gy += 1) {
    for (let gx = 1; gx < RASTER - 1; gx += 1) {
      const at = gy * RASTER + gx;
      if (grid[at]) continue;
      const around = grid[at - 1] + grid[at + 1] + grid[at - RASTER] + grid[at + RASTER];
      if (around >= 3) closed[at] = 1;
    }
  }
  return { grid: closed, aspect: spanY / spanX };
}

/** Per row, where the silhouette starts and ends, as fractions; -1 on an empty row. */
function rowEdges(grid: Uint8Array): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(RASTER).fill(-1);
  const right = new Float32Array(RASTER).fill(-1);
  for (let gy = 0; gy < RASTER; gy += 1) {
    for (let gx = 0; gx < RASTER; gx += 1) {
      if (!grid[gy * RASTER + gx]) continue;
      if (left[gy] < 0) left[gy] = gx / RASTER;
      right[gy] = (gx + 1) / RASTER;
    }
  }
  return { left, right };
}

function overlap(a: { grid: Uint8Array; aspect: number }, b: { grid: Uint8Array; aspect: number }): number {
  let inter = 0;
  let union = 0;
  for (let index = 0; index < a.grid.length; index += 1) {
    if (a.grid[index] && b.grid[index]) inter += 1;
    if (a.grid[index] || b.grid[index]) union += 1;
  }
  const iou = union ? inter / union : 0;
  // A silhouette stretched to its box hides its proportions, so the aspect
  // ratios are compared too: a mug turned handle-on is much narrower.
  const aspect = Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect, 1e-6);
  // Where each row starts and ends tells left from right: a cat facing the
  // wrong way overlaps almost as well but its head sits on the other edge.
  const edgesA = rowEdges(a.grid);
  const edgesB = rowEdges(b.grid);
  let edgeDiff = 0;
  let rows = 0;
  for (let gy = 0; gy < RASTER; gy += 1) {
    if (edgesA.left[gy] < 0 || edgesB.left[gy] < 0) continue;
    edgeDiff += Math.abs(edgesA.left[gy] - edgesB.left[gy]) + Math.abs(edgesA.right[gy] - edgesB.right[gy]);
    rows += 1;
  }
  edgeDiff = rows ? edgeDiff / rows : 1;
  return iou * (0.6 + 0.4 * aspect) - edgeDiff;
}

/**
 * Find the yaw (and mirror) that makes the points' silhouette match the
 * mask, and return the points turned that way. `steps` yaws are tried.
 */
export function alignPointsToMask(points: ColouredPoints, mask: MaskImage, steps = 24): { points: ColouredPoints; alignment: Alignment } {
  const target = maskRaster(mask);
  const tried: Alignment['tried'] = [];
  let best = { yaw: 0, mirrored: false, overlap: -Infinity };
  const consider = (yaw: number, mirrored: boolean) => {
    const score = overlap(pointsRaster(points, yaw, mirrored), target);
    tried.push({ yaw, mirrored, overlap: score });
    if (score > best.overlap) best = { yaw, mirrored, overlap: score };
  };
  for (const mirrored of [false, true]) for (let step = 0; step < steps; step += 1) consider((step / steps) * Math.PI * 2, mirrored);
  // Refine around the winner, to a couple of degrees.
  const coarse = (Math.PI * 2) / steps;
  const centre = best.yaw;
  const mirrored = best.mirrored;
  for (let fine = -4; fine <= 4; fine += 1) if (fine !== 0) consider(centre + (fine / 5) * coarse, mirrored);
  return { points: turnPoints(points, best.yaw, best.mirrored), alignment: { ...best, tried } };
}

/** The points rotated by `yaw` about y (after an optional mirror in x), normals too. */
export function turnPoints(points: ColouredPoints, yaw: number, mirrored: boolean): ColouredPoints {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const sign = mirrored ? -1 : 1;
  const positions = new Float32Array(points.count * 3);
  const normals = new Int8Array(points.count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < points.count; n += 1) {
    const x = points.positions[n * 3] * sign;
    const y = points.positions[n * 3 + 1];
    const z = points.positions[n * 3 + 2];
    const tx = x * cos + z * sin;
    const tz = -x * sin + z * cos;
    positions[n * 3] = tx;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = tz;
    const nx = points.normals[n * 3] * sign;
    const ny = points.normals[n * 3 + 1];
    const nz = points.normals[n * 3 + 2];
    normals[n * 3] = Math.round(nx * cos + nz * sin);
    normals[n * 3 + 1] = ny;
    normals[n * 3 + 2] = Math.round(-nx * sin + nz * cos);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[n * 3 + axis]);
      max[axis] = Math.max(max[axis], positions[n * 3 + axis]);
    }
  }
  // Far to near again, so the draw order still paints the back first.
  const order = Array.from({ length: points.count }, (_, index) => index).sort((a, b) => positions[a * 3 + 2] - positions[b * 3 + 2]);
  const sortedPositions = new Float32Array(points.count * 3);
  const sortedNormals = new Int8Array(points.count * 3);
  const sortedColors = new Uint8Array(points.count * 3);
  order.forEach((source, n) => {
    for (let axis = 0; axis < 3; axis += 1) {
      sortedPositions[n * 3 + axis] = positions[source * 3 + axis];
      sortedNormals[n * 3 + axis] = normals[source * 3 + axis];
      sortedColors[n * 3 + axis] = points.colors[source * 3 + axis];
    }
  });
  return { count: points.count, positions: sortedPositions, normals: sortedNormals, colors: sortedColors, min, max };
}
