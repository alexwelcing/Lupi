import { quat } from 'math';
import { ELEMENT_DATA } from '../elements';
import { jacobiEigenSymmetric3, type SymMat3 } from './jacobi';
import type { ObjectFactsRotor, Vec3 } from './types';

/** Mass used for an atomic number the element table does not resolve (carbon-like). */
export const UNRESOLVED_MASS = 12;
/** Two moments closer than this relative gap are treated as equal. */
const MOMENT_GAP = 0.01;
/** Ia below this fraction of Ic is a linear rotor. */
const LINEAR_RATIO = 1e-3;

export interface InertiaFacts {
  masses: Float64Array;
  unresolvedElements: number;
  com: Vec3;
  /** Positions relative to `com`, flat xyz. */
  rel: Float64Array;
  moments: Vec3;
  axes: [Vec3, Vec3, Vec3];
  principalQuat: [number, number, number, number];
  rotor: ObjectFactsRotor;
  kappa: number;
  /** Per principal axis: its moment is within 1% of another one. */
  degenerate: [boolean, boolean, boolean];
}

export interface PlanarityFacts {
  planar: boolean;
  planarityRms: number;
  planeNormal: Vec3 | null;
}

export function atomMass(z: number): number | null {
  const mass = ELEMENT_DATA[z]?.mass;
  return mass !== undefined && mass > 0 ? mass : null;
}

/** Point-mass inertia tensor about the centre of mass, its principal frame and rotor class. */
export function computeInertia(atomicNumbers: ArrayLike<number>, positions: ArrayLike<number>, natoms: number): InertiaFacts {
  const masses = new Float64Array(natoms);
  let unresolvedElements = 0;
  let total = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < natoms; i += 1) {
    let m = atomMass(atomicNumbers[i]);
    if (m === null) {
      m = UNRESOLVED_MASS;
      unresolvedElements += 1;
    }
    masses[i] = m;
    total += m;
    cx += m * positions[3 * i];
    cy += m * positions[3 * i + 1];
    cz += m * positions[3 * i + 2];
  }
  const com: Vec3 = [cx / total, cy / total, cz / total];

  const rel = new Float64Array(3 * natoms);
  let ixx = 0;
  let iyy = 0;
  let izz = 0;
  let ixy = 0;
  let ixz = 0;
  let iyz = 0;
  for (let i = 0; i < natoms; i += 1) {
    const x = positions[3 * i] - com[0];
    const y = positions[3 * i + 1] - com[1];
    const z = positions[3 * i + 2] - com[2];
    rel[3 * i] = x;
    rel[3 * i + 1] = y;
    rel[3 * i + 2] = z;
    const m = masses[i];
    ixx += m * (y * y + z * z);
    iyy += m * (x * x + z * z);
    izz += m * (x * x + y * y);
    ixy -= m * x * y;
    ixz -= m * x * z;
    iyz -= m * y * z;
  }
  const tensor: SymMat3 = [
    [ixx, ixy, ixz],
    [ixy, iyy, iyz],
    [ixz, iyz, izz],
  ];
  const { values, vectors } = jacobiEigenSymmetric3(tensor);
  // Round-off can leave a tiny negative moment for a line or a point.
  const moments: Vec3 = [Math.max(0, values[0]), Math.max(0, values[1]), Math.max(0, values[2])];
  const [a, b, c] = vectors;
  const q: [number, number, number, number] = [0, 0, 0, 1];
  // Column-major rotation with columns a, b, c: body x, y, z → world a, b, c.
  quat.fromMat3(q, [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]]);
  quat.normalize(q, q);

  const [ia, ib, ic] = moments;
  const near = (lo: number, hi: number) => hi - lo <= MOMENT_GAP * hi;
  let rotor: ObjectFactsRotor;
  if (natoms === 1 || ic <= 1e-9) rotor = 'atom';
  else if (ia < LINEAR_RATIO * ic) rotor = 'linear';
  else if (near(ia, ib) && near(ib, ic)) rotor = 'spherical';
  else if (near(ia, ib)) rotor = 'oblate';
  else if (near(ib, ic)) rotor = 'prolate';
  else rotor = 'asymmetric';

  const degenerate: [boolean, boolean, boolean] =
    rotor === 'atom' || rotor === 'spherical'
      ? [true, true, true]
      : [near(ia, ib), near(ia, ib) || near(ib, ic), near(ib, ic)];

  return {
    masses,
    unresolvedElements,
    com,
    rel,
    moments,
    axes: [a, b, c],
    principalQuat: q,
    rotor,
    kappa: rayKappa(moments, rotor),
    degenerate,
  };
}

/**
 * Ray's asymmetry parameter from rotational constants A ≥ B ≥ C ∝ 1/I:
 * κ = (2B − A − C) / (A − C); −1 prolate, +1 oblate. Linear rotors are the
 * prolate limit; atoms and spherical tops have no asymmetry (0).
 */
function rayKappa([ia, ib, ic]: Vec3, rotor: ObjectFactsRotor): number {
  if (rotor === 'atom' || rotor === 'spherical') return 0;
  if (rotor === 'linear' || ia <= 0) return -1;
  const A = 1 / ia;
  const B = 1 / ib;
  const C = 1 / ic;
  const span = A - C;
  if (!(span > 1e-12 * A)) return 0;
  return Math.max(-1, Math.min(1, (2 * B - A - C) / span));
}

/**
 * RMS distance of the atoms to their best-fit plane (the smallest principal
 * extent of the unweighted covariance). A line or a point has no unique
 * plane, so it is never `planar`.
 */
export function computePlanarity(rel: Float64Array, natoms: number, axes: [Vec3, Vec3, Vec3], threshold = 0.05): PlanarityFacts {
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let i = 0; i < natoms; i += 1) {
    gx += rel[3 * i];
    gy += rel[3 * i + 1];
    gz += rel[3 * i + 2];
  }
  gx /= natoms;
  gy /= natoms;
  gz /= natoms;
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (let i = 0; i < natoms; i += 1) {
    const x = rel[3 * i] - gx;
    const y = rel[3 * i + 1] - gy;
    const z = rel[3 * i + 2] - gz;
    xx += x * x;
    yy += y * y;
    zz += z * z;
    xy += x * y;
    xz += x * z;
    yz += y * z;
  }
  const { values, vectors } = jacobiEigenSymmetric3([
    [xx / natoms, xy / natoms, xz / natoms],
    [xy / natoms, yy / natoms, yz / natoms],
    [xz / natoms, yz / natoms, zz / natoms],
  ]);
  const planarityRms = Math.sqrt(Math.max(0, values[0]));
  const collinear = natoms < 3 || Math.max(0, values[1]) <= 1e-6 * Math.max(values[2], 1e-12);
  const planar = !collinear && planarityRms < threshold;
  if (!planar) return { planar, planarityRms, planeNormal: null };
  // Sign convention: the plane normal agrees with the principal c axis.
  const n = vectors[0];
  const c = axes[2];
  const s = n[0] * c[0] + n[1] * c[1] + n[2] * c[2] < 0 ? -1 : 1;
  return { planar, planarityRms, planeNormal: [s * n[0], s * n[1], s * n[2]] };
}
