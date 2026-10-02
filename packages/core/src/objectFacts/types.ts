export type Vec3 = [number, number, number];

export type ObjectFactsRotor =
  | 'atom'
  | 'linear'
  | 'spherical'
  | 'oblate'
  | 'prolate'
  | 'asymmetric';

export type ObjectFactsDetentKind = 'ring-face' | 'plane-face' | 'plane-edge' | 'principal';

export interface ObjectFactsInput {
  atomicNumbers: ArrayLike<number>;
  positions: ArrayLike<number>;
  natoms: number;
}

export interface ObjectFactsOptions {
  maxAtoms?: number;
  tolerance?: number;
}

/**
 * Rigid-body and symmetry facts of one static structure. Pure data: no three.js,
 * computed once per file, never per frame.
 */
export interface ObjectFactsV1 {
  version: 'lupi.object-facts.v1';
  atomCount: number;
  com: Vec3;
  /** Point-mass principal moments, ascending, amu·Å². */
  moments: [number, number, number];
  /** Unit axes a, b, c for `moments`; right-handed. */
  axes: [Vec3, Vec3, Vec3];
  /** Body (x, y, z) = (a, b, c) → world, as [x, y, z, w]. */
  principalQuat: [number, number, number, number];
  rotor: ObjectFactsRotor;
  kappa: number;
  planar: boolean;
  planarityRms: number;
  planeNormal: Vec3 | null;
  rings: Array<{ size: number; atoms: number[]; center: Vec3; normal: Vec3 }>;
  symmetryAxes: Array<{ order: number; dir: Vec3; toleranceA: number }>;
  detents: Array<{ dir: Vec3; kind: ObjectFactsDetentKind; label: string; order?: number }>;
  captureRadiusDeg: number;
  provenance: { method: string; tolerance: number; unresolvedElements: number };
}
