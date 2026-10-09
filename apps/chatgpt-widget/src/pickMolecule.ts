/** Exact sphere/finite-cylinder hits for this bounded static molecule card.
 * R3F atom meshes are shader impostors, not raycastable sphere geometry. */
import { BOND_KIND_DASH, BOND_KIND_RADIUS_SCALE } from '@atlas/core/bonds';
import type { InspectionPair, InspectionTarget } from './inspection';

type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function sphereHit(origin: Vec3, direction: Vec3, center: Vec3, radius: number): number {
  const oc = sub(origin, center), b = dot(oc, direction), c = dot(oc, oc) - radius * radius;
  const d = b * b - c;
  if (d < 0) return Infinity;
  const near = -b - Math.sqrt(d), far = -b + Math.sqrt(d);
  return near >= 0 ? near : far >= 0 ? far : Infinity;
}

/** The cylinder's caps live inside its endpoint atoms, which are hit separately. */
export function cylinderHit(origin: Vec3, direction: Vec3, start: Vec3, end: Vec3, radius: number): { t: number; along: number } | null {
  const axis = sub(end, start), offset = sub(origin, start);
  const length2 = dot(axis, axis), axisRay = dot(axis, direction), axisOffset = dot(axis, offset);
  const a = length2 - axisRay * axisRay;
  if (length2 < 1e-12 || a < 1e-12) return null;
  const b = length2 * dot(direction, offset) - axisOffset * axisRay;
  const c = length2 * dot(offset, offset) - axisOffset * axisOffset - radius * radius * length2;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  for (const t of [(-b - Math.sqrt(discriminant)) / a, (-b + Math.sqrt(discriminant)) / a]) {
    const y = axisOffset + t * axisRay;
    if (t >= 0 && y >= 0 && y <= length2) return { t, along: y / Math.sqrt(length2) };
  }
  return null;
}

export function pickMolecule(input: {
  origin: Vec3; direction: Vec3; positions: ArrayLike<number>; radii: ArrayLike<number>;
  pairs: readonly InspectionPair[]; showBonds: boolean;
}): InspectionTarget | null {
  const { origin, direction, positions, radii } = input;
  const point = (i: number): Vec3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  let closest = Infinity, target: InspectionTarget | null = null;
  for (let index = 0; index < radii.length; index++) {
    const distance = sphereHit(origin, direction, point(index), radii[index]);
    if (distance < closest) { closest = distance; target = { kind: 'atom', index }; }
  }
  if (input.showBonds) for (const pair of input.pairs) {
    const kind = pair.kind === 'coordination' ? 1 : pair.kind === 'ionicContact' ? 2 : 0;
    const hit = cylinderHit(origin, direction, point(pair.a), point(pair.b), 0.105 * BOND_KIND_RADIUS_SCALE[kind]);
    if (!hit || hit.t >= closest) continue;
    const dash = BOND_KIND_DASH[kind];
    if (dash && (Math.min(hit.along, pair.distance - hit.along) / dash.periodA) % 1 > dash.duty) continue;
    closest = hit.t; target = { kind: 'bond', index: pair.index };
  }
  return target;
}

/** Maximum excursion matters: a drag returning to its start is still a drag. */
export function isInspectionTap(maxMovement: number, pointerCount: number, cancelled: boolean): boolean {
  return !cancelled && pointerCount === 1 && maxMovement <= 5;
}
