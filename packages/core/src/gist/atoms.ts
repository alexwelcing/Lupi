/**
 * A molecule as coloured points: the particles' homes when a molecule
 * arrives in the viewer.
 *
 * Each atom becomes a shell of points on its display sphere, coloured by
 * its element, with the shell's outward normal; the points are shared out
 * over atoms by surface area, so a big atom gets more than a small one and
 * a caffeine molecule at sixty thousand particles is twenty-odd dense
 * spheres. Past a few hundred thousand atoms there are fewer points than
 * atoms, and each point is one atom's centre, taken at an even stride.
 *
 * Positions stay in the frame's own units (ångström, usually); the stage
 * normalises them for the engine and builds a camera to match.
 */
import { ELEMENT_DATA, hexToRgb } from '../elements';
import { resolveAtomicNumber, resolveTypeDisplayRadius } from '../frameSemantics';
import type { Frame } from '../types';
import type { ColouredPoints } from './points';

export interface AtomPointsOptions {
  random?: () => number;
  /** Multiplies every display radius, as the viewer's atom scale does. */
  radiusScale?: number;
  /** Colour per raw type, when the caller has a scheme; otherwise the element's own. */
  colorFor?: (rawType: number) => [number, number, number];
}

const NEUTRAL_COLOR: [number, number, number] = [176, 190, 204];

function parseHsl(value: string): [number, number, number] | null {
  const match = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(value);
  if (!match) return null;
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}

/** The element's own colour for a raw type, or a neutral grey when the frame has no element identity. */
export function elementColorFor(frame: Pick<Frame, 'typeSemantics'>, rawType: number): [number, number, number] {
  const atomicNumber = resolveAtomicNumber(frame, rawType);
  const spec = atomicNumber === undefined ? null : ELEMENT_DATA[atomicNumber];
  if (!spec) return NEUTRAL_COLOR;
  if (spec.color.startsWith('#')) {
    const [r, g, b] = hexToRgb(spec.color);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  return parseHsl(spec.color) ?? NEUTRAL_COLOR;
}

/** Sample `count` coloured points over the frame's atoms. */
export function atomsToPoints(frame: Frame, count: number, options: AtomPointsOptions = {}): ColouredPoints {
  const random = options.random ?? Math.random;
  const radiusScale = options.radiusScale ?? 1;
  const natoms = Math.min(frame.natoms, Math.floor(frame.positions.length / 3));
  const empty: ColouredPoints = { count: 0, positions: new Float32Array(0), colors: new Uint8Array(0), normals: new Int8Array(0), min: [0, 0, 0], max: [0, 0, 0] };
  if (natoms === 0 || count <= 0) return empty;

  // Per raw type: radius and colour, resolved once.
  const radiusByType = new Map<number, number>();
  const colorByType = new Map<number, [number, number, number]>();
  const radiusOf = (type: number): number => {
    let radius = radiusByType.get(type);
    if (radius === undefined) {
      radius = resolveTypeDisplayRadius(frame, type) * radiusScale;
      radiusByType.set(type, radius);
    }
    return radius;
  };
  const colorOf = (type: number): [number, number, number] => {
    let color = colorByType.get(type);
    if (!color) {
      color = options.colorFor ? options.colorFor(type) : elementColorFor(frame, type);
      colorByType.set(type, color);
    }
    return color;
  };

  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const normals = new Int8Array(count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const place = (n: number, x: number, y: number, z: number, color: [number, number, number], nx: number, ny: number, nz: number) => {
    positions[n * 3] = x;
    positions[n * 3 + 1] = y;
    positions[n * 3 + 2] = z;
    colors[n * 3] = color[0];
    colors[n * 3 + 1] = color[1];
    colors[n * 3 + 2] = color[2];
    normals[n * 3] = Math.round(nx * 127);
    normals[n * 3 + 1] = Math.round(ny * 127);
    normals[n * 3 + 2] = Math.round(nz * 127);
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  };

  if (count < natoms) {
    // More atoms than points: one point per atom at an even stride, at the centre.
    for (let n = 0; n < count; n += 1) {
      const atom = Math.floor((n / count) * natoms);
      const type = frame.types[atom];
      const dir = randomDirection(random);
      place(n, frame.positions[atom * 3], frame.positions[atom * 3 + 1], frame.positions[atom * 3 + 2], colorOf(type), dir[0], dir[1], dir[2]);
    }
    return { count, positions, colors, normals, min, max };
  }

  // Share the points by surface area, every atom getting at least one.
  let totalArea = 0;
  const areas = new Float64Array(natoms);
  for (let atom = 0; atom < natoms; atom += 1) {
    const radius = radiusOf(frame.types[atom]);
    areas[atom] = radius * radius;
    totalArea += areas[atom];
  }
  let placed = 0;
  let carried = 0;
  for (let atom = 0; atom < natoms && placed < count; atom += 1) {
    const remainingAtoms = natoms - atom;
    const remainingPoints = count - placed;
    const share = (areas[atom] / Math.max(totalArea, 1e-9)) * count + carried;
    let take = Math.max(1, Math.round(share));
    take = Math.min(take, remainingPoints - (remainingAtoms - 1));
    carried = share - take;
    const type = frame.types[atom];
    const radius = radiusOf(type);
    const color = colorOf(type);
    const cx = frame.positions[atom * 3];
    const cy = frame.positions[atom * 3 + 1];
    const cz = frame.positions[atom * 3 + 2];
    for (let k = 0; k < take; k += 1) {
      const dir = randomDirection(random);
      place(placed, cx + dir[0] * radius, cy + dir[1] * radius, cz + dir[2] * radius, color, dir[0], dir[1], dir[2]);
      placed += 1;
    }
  }
  if (placed < count) {
    // Rounding left a few over: put them on the last atoms again.
    for (let n = placed; n < count; n += 1) {
      const atom = natoms - 1 - ((n - placed) % natoms);
      const type = frame.types[atom];
      const radius = radiusOf(type);
      const dir = randomDirection(random);
      place(n, frame.positions[atom * 3] + dir[0] * radius, frame.positions[atom * 3 + 1] + dir[1] * radius, frame.positions[atom * 3 + 2] + dir[2] * radius, colorOf(type), dir[0], dir[1], dir[2]);
    }
  }
  return { count, positions, colors, normals, min, max };
}

function randomDirection(random: () => number): [number, number, number] {
  const z = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(angle), r * Math.sin(angle), z];
}

/**
 * A particle disc sized to the atoms it sits on, in normalised units
 * (`scale` is world units per normalised unit). Many points per atom tile
 * the sphere with small discs; one point per atom makes the disc the atom.
 */
export function atomDiscSize(points: ColouredPoints, natoms: number, scale: number): number {
  const atom = 0.55 / Math.max(scale, 1e-6);
  const perAtom = points.count / Math.max(natoms, 1);
  return Math.max(0.003, Math.min(0.03, perAtom >= 8 ? atom * 0.3 : atom * 1.2));
}

export interface NormalizedPoints {
  points: ColouredPoints;
  /** World position of the normalised origin. */
  centre: [number, number, number];
  /** World units per normalised unit. */
  scale: number;
}

/**
 * Centre the points on their bounding box and scale the longest side to
 * `extent`, returning the transform so a camera can be built to match:
 * world = normalised × scale + centre.
 */
export function normalizePoints(points: ColouredPoints, extent = 1.8): NormalizedPoints {
  const centre: [number, number, number] = [(points.min[0] + points.max[0]) / 2, (points.min[1] + points.max[1]) / 2, (points.min[2] + points.max[2]) / 2];
  const longest = Math.max(points.max[0] - points.min[0], points.max[1] - points.min[1], points.max[2] - points.min[2], 1e-6);
  const scale = longest / extent;
  const positions = new Float32Array(points.count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < points.count; n += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = (points.positions[n * 3 + axis] - centre[axis]) / scale;
      positions[n * 3 + axis] = value;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { points: { count: points.count, positions, colors: points.colors, normals: points.normals, min, max }, centre, scale };
}
