import { cloneGist, gistBody, gistBounds, type Gist, type GistPrimitive } from './types';

/**
 * Silhouettes as numbers. The photo's outline (traced by the vision call as
 * a polygon in image coordinates) and the gist (evaluated here on the CPU
 * with the same signed distance functions the compute shader uses) are both
 * reduced to a width-per-height profile: `bands` numbers from the top of the
 * object to the bottom, each the silhouette's width at that height as a
 * fraction of the object's total height. Two profiles are comparable no
 * matter the image size or the gist's scale, and small enough to sit in
 * Jev's state as a couple of lines of digits.
 */
export const PROFILE_BANDS = 12;

export type OutlinePoint = [number, number];

/** Width profile of a closed polygon, top band first. Points are (x, y) with y down or up alike. */
export function outlineProfile(points: OutlinePoint[], bands = PROFILE_BANDS): number[] | null {
  if (points.length < 3) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const height = maxY - minY;
  if (!(height > 1e-6)) return null;
  const profile: number[] = [];
  for (let band = 0; band < bands; band += 1) {
    const y = minY + ((band + 0.5) / bands) * height;
    // Scanline: every edge crossing y contributes an x; the width is the outermost span.
    let left = Infinity;
    let right = -Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const [x0, y0] = points[index];
      const [x1, y1] = points[(index + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    profile.push(Number.isFinite(left) && Number.isFinite(right) ? (right - left) / height : 0);
  }
  return profile;
}

/**
 * The body's own width profile, with one-sided protrusions removed. A mug's
 * handle or a teapot's spout sticks out on one side only, so at each band
 * the radius is the shorter of the two half-widths around the object's
 * axis; revolving that gives the body without the handle, and the parts
 * the model named add it back. Returns widths as fractions of height, top
 * band first, like `outlineProfile`.
 */
export function outlineBodyProfile(points: OutlinePoint[], bands = PROFILE_BANDS): number[] | null {
  if (points.length < 3) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const height = maxY - minY;
  if (!(height > 1e-6)) return null;
  const spans: Array<[number, number] | null> = [];
  for (let band = 0; band < bands; band += 1) {
    const y = minY + ((band + 0.5) / bands) * height;
    let left = Infinity;
    let right = -Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const [x0, y0] = points[index];
      const [x1, y1] = points[(index + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    spans.push(Number.isFinite(left) && Number.isFinite(right) ? [left, right] : null);
  }
  // The axis is the median of the band midpoints: a handle shifts a few bands' midpoints, not most.
  const midpoints = spans.filter((span): span is [number, number] => span !== null).map(([left, right]) => (left + right) / 2).sort((a, b) => a - b);
  if (midpoints.length === 0) return null;
  const axis = midpoints[Math.floor(midpoints.length / 2)];
  return spans.map((span) => {
    if (!span) return 0;
    const radius = Math.max(0, Math.min(axis - span[0], span[1] - axis));
    return (2 * radius) / height;
  });
}

/* ─── CPU signed distance functions, mirroring gist-step.wgsl ─── */

type Vec3 = [number, number, number];

const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function rotationRows(rotation: [number, number, number]): [Vec3, Vec3, Vec3] {
  const [ax, ay, az] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function sdPrimitive(primitive: GistPrimitive, rows: [Vec3, Vec3, Vec3], world: Vec3): number {
  const d: Vec3 = [world[0] - primitive.center[0], world[1] - primitive.center[1], world[2] - primitive.center[2]];
  // Columns of the shader matrix are the rows here, so the product is the inverse rotation.
  const p: Vec3 = [
    rows[0][0] * d[0] + rows[1][0] * d[1] + rows[2][0] * d[2],
    rows[0][1] * d[0] + rows[1][1] * d[1] + rows[2][1] * d[2],
    rows[0][2] * d[0] + rows[1][2] * d[1] + rows[2][2] * d[2],
  ];
  const [a, b, c] = primitive.size;
  switch (primitive.kind) {
    case 'sphere':
      return length(p) - a;
    case 'ellipsoid': {
      const k0 = Math.hypot(p[0] / a, p[1] / b, p[2] / c);
      const k1 = Math.hypot(p[0] / (a * a), p[1] / (b * b), p[2] / (c * c));
      return (k0 * (k0 - 1)) / Math.max(k1, 1e-5);
    }
    case 'box': {
      const q: Vec3 = [Math.abs(p[0]) - a, Math.abs(p[1]) - b, Math.abs(p[2]) - c];
      return length([Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)]) + Math.min(Math.max(q[0], q[1], q[2]), 0);
    }
    case 'cylinder': {
      const dx = Math.abs(Math.hypot(p[0], p[2])) - a;
      const dy = Math.abs(p[1]) - b;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    }
    case 'capsule': {
      const y = p[1] - Math.max(-b, Math.min(b, p[1]));
      return Math.hypot(p[0], y, p[2]) - a;
    }
    case 'cone': {
      const qx = Math.hypot(p[0], p[2]);
      const qy = p[1];
      const rb = a;
      const h = b;
      const rt = c;
      const k1 = [rt, h];
      const k2 = [rt - rb, 2 * h];
      const ca = [qx - Math.min(qx, qy < 0 ? rb : rt), Math.abs(qy) - h];
      const t = Math.max(0, Math.min(1, ((k1[0] - qx) * k2[0] + (k1[1] - qy) * k2[1]) / Math.max(k2[0] * k2[0] + k2[1] * k2[1], 1e-6)));
      const cb = [qx - k1[0] + k2[0] * t, qy - k1[1] + k2[1] * t];
      const s = cb[0] < 0 && ca[1] < 0 ? -1 : 1;
      return s * Math.sqrt(Math.min(ca[0] * ca[0] + ca[1] * ca[1], cb[0] * cb[0] + cb[1] * cb[1]));
    }
    case 'torus': {
      const qx = Math.hypot(p[0], p[2]) - a;
      return Math.hypot(qx, p[1]) - b;
    }
    case 'lathe': {
      const radii = primitive.profile ?? [];
      if (radii.length === 0) return 1e5;
      const t = Math.max(0, Math.min(1, (b - p[1]) / Math.max(2 * b, 1e-5))) * (radii.length - 1);
      const lower = Math.floor(t);
      const upper = Math.min(radii.length - 1, lower + 1);
      const radius = (radii[lower] + (radii[upper] - radii[lower]) * (t - lower)) * a;
      const dr = Math.hypot(p[0], p[2]) - radius;
      const dy = Math.abs(p[1]) - b;
      return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
    }
    case 'arc': {
      // A tube bent along a circular arc of radius a in the XY plane, opening upward, half angle c.
      const qx = Math.abs(p[0]);
      const qy = p[1];
      const sx = Math.sin(c);
      const sy = Math.cos(c);
      const d = sy * qx > sx * qy ? Math.hypot(qx - sx * a, qy - sy * a, p[2]) : Math.hypot(Math.hypot(qx, qy) - a, p[2]);
      return d - b;
    }
  }
}

function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/**
 * Signed distance of the whole gist at a world point; the shader's `sdScene`,
 * on the CPU. `solidOnly` skips the carved parts: a hollow or a dimple is
 * interior detail that leaves the outer silhouette alone, and a thin wall
 * would otherwise slip between grid samples and read as a hole.
 */
export function gistDistance(gist: Gist, point: Vec3, rows = gist.primitives.map((primitive) => rotationRows(primitive.rotation)), solidOnly = false): number {
  let d = 1e5;
  gist.primitives.forEach((primitive, index) => {
    if (!primitive.subtract) d = smin(d, sdPrimitive(primitive, rows[index], point), primitive.blend);
  });
  if (!solidOnly) {
    gist.primitives.forEach((primitive, index) => {
      if (primitive.subtract) d = Math.max(d, -sdPrimitive(primitive, rows[index], point));
    });
  }
  return d;
}

/**
 * Width profile of the gist seen from the front (looking along -Z), top
 * band first, widths as a fraction of the gist's height, from the solid
 * parts only. A coarse grid is enough: the profile is for comparing
 * proportions, not for rendering.
 */
export function gistProfile(gist: Gist, bands = PROFILE_BANDS, samples = 48): number[] {
  const bounds = gistBounds(gist);
  const rows = gist.primitives.map((primitive) => rotationRows(primitive.rotation));
  const height = Math.max(bounds.max[1] - bounds.min[1], 1e-3);
  const pad = 0.15;
  const x0 = bounds.min[0] - pad;
  const x1 = bounds.max[0] + pad;
  const z0 = bounds.min[2] - pad;
  const z1 = bounds.max[2] + pad;
  const profile: number[] = [];
  for (let band = 0; band < bands; band += 1) {
    // Top band first, to match the outline profile's image order.
    const y = bounds.max[1] - ((band + 0.5) / bands) * height;
    let left = Infinity;
    let right = -Infinity;
    for (let ix = 0; ix < samples; ix += 1) {
      const x = x0 + ((ix + 0.5) / samples) * (x1 - x0);
      let inside = false;
      for (let iz = 0; iz < samples && !inside; iz += 1) {
        const z = z0 + ((iz + 0.5) / samples) * (z1 - z0);
        if (gistDistance(gist, [x, y, z], rows, true) <= 0) inside = true;
      }
      if (inside) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    profile.push(Number.isFinite(left) ? (right - left) / height : 0);
  }
  return profile;
}

/** Mean absolute difference between two profiles; 0 is a perfect match. */
export function profileMismatch(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let sum = 0;
  for (let index = 0; index < n; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / n;
}

/**
 * The free move: scale the body sideways so the gist's overall aspect
 * (widest width over height) matches the photo's. No judgment needed; it
 * runs once when the outline arrives, before Jev is asked anything.
 */
export function fitProportions(gist: Gist, photoProfile: number[]): Gist {
  const target = Math.max(...photoProfile);
  const current = Math.max(...gistProfile(gist, PROFILE_BANDS, 32));
  if (!(target > 0.05) || !(current > 0.05)) return gist;
  const factor = Math.max(0.6, Math.min(1.7, target / current));
  if (Math.abs(factor - 1) < 0.08) return gist;
  const next = cloneGist(gist);
  const body = gistBody(next);
  body.size[0] = Math.max(0.03, Math.min(1.6, body.size[0] * factor));
  if (body.kind !== 'cylinder' && body.kind !== 'capsule' && body.kind !== 'cone' && body.kind !== 'sphere') {
    body.size[2] = Math.max(0.03, Math.min(1.6, body.size[2] * factor));
  }
  if (body.kind === 'cone') body.size[2] = Math.min(1.6, body.size[2] * factor);
  return next;
}

/** Profiles as short strings for Jev's state: two decimals, top to bottom. */
export function profileWords(profile: number[]): string {
  return profile.map((value) => value.toFixed(2)).join(' ');
}
