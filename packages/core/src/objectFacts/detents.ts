import type { RingFace } from './rings';
import type { SymmetryAxis } from './symmetry';
import type { ObjectFactsDetentKind, Vec3 } from './types';

export interface Detent {
  dir: Vec3;
  kind: ObjectFactsDetentKind;
  label: string;
  order?: number;
}

export interface DetentInput {
  rings: RingFace[];
  symmetryAxes: SymmetryAxis[];
  planeNormal: Vec3 | null;
  axes: [Vec3, Vec3, Vec3];
  /** Per principal axis: its moment is within 1% of another one (the axis is arbitrary). */
  degenerate: [boolean, boolean, boolean];
  /** Positions relative to the centre of mass, flat xyz. */
  rel: Float64Array;
  natoms: number;
}

const DEG = Math.PI / 180;
/** Detents closer than this are one detent; the first one added wins. */
const DETENT_MERGE_DEG = 2;
/** A symmetry axis labels a ring when it lies this close to the ring normal... */
const AXIS_LABEL_DEG = 1;
/** ...and passes this close to the ring centre (Å). */
const AXIS_THROUGH_RING_A = 0.15;
/**
 * Edge-on detents of a planar molecule are kept at least this far apart.
 * Feel call beyond the spec's 2°: an atom-by-atom ring of edge-on views 2°
 * apart (graphene, long chains) would make the arrow keys crawl and every
 * edge-on coast capture; the farthest atoms are taken first.
 */
const EDGE_SPACING_DEG = 10;
/** Atoms this close to the centre give no edge-on direction (Å). */
const EDGE_MIN_ARM = 0.3;
const FIBONACCI_DIRECTIONS = 2000;
const ASCENT_STARTS = 12;
const COMPASS_COS = Array.from({ length: 8 }, (_, k) => Math.cos((k * Math.PI) / 4));
const COMPASS_SIN = Array.from({ length: 8 }, (_, k) => Math.sin((k * Math.PI) / 4));
const CAPTURE_MAX_DEG = 24;
const CAPTURE_FALLBACK_DEG = 12;

const POLYGON: Record<number, string> = {
  3: 'Triangle',
  4: 'Square',
  5: 'Pentagon',
  6: 'Hexagon',
  7: 'Heptagon',
  8: 'Octagon',
};

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function neg(a: Vec3): Vec3 {
  return [-a[0], -a[1], -a[2]];
}

/** The verified axis along `normal` that passes through `center`, if any. */
function axisThrough(axes: SymmetryAxis[], normal: Vec3, center: Vec3): SymmetryAxis | undefined {
  const cosLimit = Math.cos(AXIS_LABEL_DEG * DEG);
  for (const axis of axes) {
    if (Math.abs(dot(axis.dir, normal)) < cosLimit) continue;
    const along = dot(center, axis.dir);
    const off = Math.hypot(
      center[0] - along * axis.dir[0],
      center[1] - along * axis.dir[1],
      center[2] - along * axis.dir[2],
    );
    if (off <= AXIS_THROUGH_RING_A) return axis;
  }
  return undefined;
}

/**
 * View detents, in priority order (a later detent within 2° of an earlier one
 * is dropped): ring faces (both signs), then the face and edge views of a
 * planar skeleton, then principal axes. A principal axis whose moment is
 * degenerate is arbitrary (any axis of a spherical top, the in-plane pair of
 * benzene), so it is only a detent when nothing else is.
 */
export function buildDetents(input: DetentInput): Detent[] {
  const detents: Detent[] = [];
  const cosMerge = Math.cos(DETENT_MERGE_DEG * DEG);
  const add = (d: Detent): boolean => {
    for (const e of detents) if (dot(e.dir, d.dir) >= cosMerge) return false;
    detents.push(d);
    return true;
  };

  const labelled = input.rings.map((ring) => ({ ring, axis: axisThrough(input.symmetryAxes, ring.normal, ring.center) }));
  labelled.sort((p, q) => (q.axis?.order ?? 0) - (p.axis?.order ?? 0) || q.ring.size - p.ring.size);
  for (const { ring, axis } of labelled) {
    const polygon = POLYGON[ring.size];
    const label = axis && polygon ? `${polygon} face-on · ${axis.order}-fold axis` : 'Ring face-on';
    for (const dir of [ring.normal, neg(ring.normal)]) {
      add(axis ? { dir, kind: 'ring-face', label, order: axis.order } : { dir, kind: 'ring-face', label });
    }
  }

  const plane = input.planeNormal;
  if (plane) {
    const axis = axisThrough(input.symmetryAxes, plane, [0, 0, 0]);
    for (const dir of [plane, neg(plane)]) {
      add(
        axis
          ? { dir, kind: 'plane-face', label: 'Face-on · planar', order: axis.order }
          : { dir, kind: 'plane-face', label: 'Face-on · planar' },
      );
    }
    const { rel, natoms } = input;
    const inPlane: Array<{ dir: Vec3; arm: number }> = [];
    for (let i = 0; i < natoms; i += 1) {
      const x = rel[3 * i];
      const y = rel[3 * i + 1];
      const z = rel[3 * i + 2];
      const h = x * plane[0] + y * plane[1] + z * plane[2];
      const px = x - h * plane[0];
      const py = y - h * plane[1];
      const pz = z - h * plane[2];
      const arm = Math.hypot(px, py, pz);
      if (arm >= EDGE_MIN_ARM) inPlane.push({ dir: [px / arm, py / arm, pz / arm], arm });
    }
    inPlane.sort((p, q) => q.arm - p.arm);
    const cosEdge = Math.cos(EDGE_SPACING_DEG * DEG);
    const edges: Vec3[] = [];
    for (const { dir } of inPlane) {
      if (edges.some((e) => dot(e, dir) >= cosEdge)) continue;
      if (add({ dir, kind: 'plane-edge', label: 'Edge-on · planar' })) edges.push(dir);
    }
  }

  const alone = detents.length === 0;
  input.axes.forEach((axis, i) => {
    if (input.degenerate[i] && !alone) return;
    add({ dir: axis, kind: 'principal', label: 'Principal axis' });
    add({ dir: neg(axis), kind: 'principal', label: 'Principal axis' });
  });

  return detents;
}

/**
 * The largest angle from any view direction to its nearest detent: a max over
 * 2000 Fibonacci directions, then a short local ascent from the worst few so
 * the estimate does not sit below the true covering radius by the lattice spacing.
 */
export function coveringRadiusDeg(dirs: Vec3[]): number {
  if (dirs.length === 0) return 180;
  // Largest dot product to any detent: the nearest detent's cosine.
  const nearestCos = (x: number, y: number, z: number): number => {
    let best = -1;
    for (const d of dirs) {
      const c = d[0] * x + d[1] * y + d[2] * z;
      if (c > best) best = c;
    }
    return best;
  };

  const golden = Math.PI * (3 - Math.sqrt(5));
  const samples: Array<{ x: number; y: number; z: number; cos: number }> = [];
  for (let i = 0; i < FIBONACCI_DIRECTIONS; i += 1) {
    const y = 1 - (2 * i + 1) / FIBONACCI_DIRECTIONS;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const x = r * Math.cos(i * golden);
    const z = r * Math.sin(i * golden);
    samples.push({ x, y, z, cos: nearestCos(x, y, z) });
  }
  samples.sort((p, q) => p.cos - q.cos);
  let worst = samples[0].cos;

  // Local descent of the nearest-detent cosine from the worst few samples.
  for (const start of samples.slice(0, ASCENT_STARTS)) {
    let { x: px, y: py, z: pz, cos: value } = start;
    let step = 2 * DEG;
    while (step > 0.01 * DEG) {
      const hx = Math.abs(px) < 0.9 ? 1 : 0;
      const hy = 1 - hx;
      // Tangent basis u = p × h, v = p × u at the current point.
      let ux = -pz * hy;
      let uy = pz * hx;
      let uz = px * hy - py * hx;
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const vx = py * uz - pz * uy;
      const vy = pz * ux - px * uz;
      const vz = px * uy - py * ux;
      let moved = false;
      for (let k = 0; k < 8; k += 1) {
        const ca = COMPASS_COS[k] * step;
        const sa = COMPASS_SIN[k] * step;
        let x = px + ca * ux + sa * vx;
        let y = py + ca * uy + sa * vy;
        let z = pz + ca * uz + sa * vz;
        const len = Math.hypot(x, y, z);
        x /= len;
        y /= len;
        z /= len;
        const c = nearestCos(x, y, z);
        if (c < value) {
          value = c;
          px = x;
          py = y;
          pz = z;
          moved = true;
        }
      }
      if (!moved) step /= 2;
    }
    if (value < worst) worst = value;
  }
  return Math.acos(Math.max(-1, Math.min(1, worst))) / DEG;
}

/**
 * Capture cone for the detents: the covering radius plus 1°, rounded up to a
 * whole degree and capped at 24°, so every view direction lies inside some
 * detent's cone; 12° when the detents are too sparse to cover the sphere.
 */
export function captureRadiusFor(coveringDeg: number): number {
  return coveringDeg <= CAPTURE_MAX_DEG ? Math.min(CAPTURE_MAX_DEG, Math.ceil(coveringDeg + 1)) : CAPTURE_FALLBACK_DEG;
}
