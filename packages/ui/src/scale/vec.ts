// Binary64 vector and similarity helpers for the page (scale-spec §8.2
// composes placements in binary64 and casts to Float32 once).

import type { Mat3, Vec3 } from '@atlas/core/scale';

export interface Sim {
  s: number;
  r: Mat3;
  t: Vec3;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

export const mulVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const mulMat = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const applySim = (a: Sim, x: Vec3): Vec3 => add(scale(mulVec(a.r, x), a.s), a.t);

/** a ∘ b: b first. */
export const composeSim = (a: Sim, b: Sim): Sim => ({ s: a.s * b.s, r: mulMat(a.r, b.r), t: add(scale(mulVec(a.r, b.t), a.s), a.t) });

export function axisAngle(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Re-orthonormalizes a rotation that has collected rounding from many small turns. */
export function orthonormalize(m: Mat3): Mat3 {
  const x = normalize([m[0], m[3], m[6]]);
  let y: Vec3 = [m[1], m[4], m[7]];
  y = normalize(sub(y, scale(x, dot(x, y))));
  const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** Ray against an oriented box given as worldFromBox (unit box [min, max] in box units); the hit distance or null. */
export function rayBox(origin: Vec3, dir: Vec3, worldFromBox: Sim, min: Vec3, max: Vec3): number | null {
  return rayBoxFace(origin, dir, worldFromBox, min, max)?.t ?? null;
}

/** As rayBox, with the face the ray enters by: its axis and outward sign in box units (axis −1 from inside). */
export function rayBoxFace(origin: Vec3, dir: Vec3, worldFromBox: Sim, min: Vec3, max: Vec3): { t: number; axis: number; sign: 1 | -1 } | null {
  // Into box units: x = Rᵀ (p − t) / s.
  const rt = transpose(worldFromBox.r);
  const o = scale(mulVec(rt, sub(origin, worldFromBox.t)), 1 / worldFromBox.s);
  const d = scale(mulVec(rt, dir), 1 / worldFromBox.s);
  let t0 = -Infinity;
  let t1 = Infinity;
  let axis = -1;
  let sign: 1 | -1 = 1;
  for (let a = 0; a < 3; a += 1) {
    if (Math.abs(d[a]) < 1e-300) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    const ta = (min[a] - o[a]) / d[a];
    const tb = (max[a] - o[a]) / d[a];
    const near = Math.min(ta, tb);
    if (near > t0) {
      t0 = near;
      axis = a;
      // Entering through the min face moves along +a, so its outward normal is −a.
      sign = d[a] > 0 ? -1 : 1;
    }
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return t0 >= 0 ? { t: t0, axis, sign } : { t: 0, axis: -1, sign: 1 };
}

/** Ray against a sphere; the near hit distance or null. */
export function raySphere(origin: Vec3, dir: Vec3, centre: Vec3, radius: number): number | null {
  const oc = sub(origin, centre);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -b + Math.sqrt(h) >= 0 ? 0 : null;
}
