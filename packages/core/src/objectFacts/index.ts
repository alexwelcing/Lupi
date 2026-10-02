import { computeBonds, type BondGraph } from './bonds';
import { buildDetents, captureRadiusFor, coveringRadiusDeg } from './detents';
import { computeInertia, computePlanarity } from './inertia';
import { findRingFaces, type RingFace } from './rings';
import { findSymmetryAxes, type SymmetryAxis } from './symmetry';
import type { ObjectFactsInput, ObjectFactsOptions, ObjectFactsV1, Vec3 } from './types';

export type * from './types';

/** Above this many atoms rings are skipped (inertia, planarity and principal detents only). */
export const OBJECT_FACTS_RING_LIMIT = 500;
/** Above this many atoms symmetry axes are skipped. */
export const OBJECT_FACTS_SYMMETRY_LIMIT = 200;

/**
 * Principal axes, rings, symmetry axes and view detents for a static structure.
 * Pure and synchronous; call it once per file, never per frame. Returns null
 * for an empty input, more than `maxAtoms` (2000) atoms, or non-finite
 * coordinates. Rings are computed up to 500 atoms and symmetry up to 200.
 * Ring centres and `com` are in input coordinates; directions are unit vectors.
 */
export function computeObjectFacts(input: ObjectFactsInput, options?: ObjectFactsOptions): ObjectFactsV1 | null {
  const maxAtoms = options?.maxAtoms ?? 2000;
  const tolerance = options?.tolerance ?? 0.05;
  const { atomicNumbers, positions, natoms } = input;
  if (!Number.isInteger(natoms) || natoms <= 0 || natoms > maxAtoms) return null;
  if (positions.length < 3 * natoms || atomicNumbers.length < natoms) return null;
  for (let i = 0; i < 3 * natoms; i += 1) if (!Number.isFinite(positions[i])) return null;

  const inertia = computeInertia(atomicNumbers, positions, natoms);
  const { rel, com, axes } = inertia;
  const planarity = computePlanarity(rel, natoms, axes);
  const methods = ['point-mass inertia (Jacobi)'];

  let rings: RingFace[] = [];
  let bonds: BondGraph = { pairs: [], adjacency: [] };
  if (natoms <= OBJECT_FACTS_RING_LIMIT) {
    bonds = computeBonds(atomicNumbers, rel, natoms);
    rings = findRingFaces(rel, bonds, { planeNormal: planarity.planeNormal, fallbackNormal: axes[2] });
    methods.push('ring faces (shortest cycles per bond)');
  }

  let symmetryAxes: SymmetryAxis[] = [];
  if (natoms <= OBJECT_FACTS_SYMMETRY_LIMIT && inertia.rotor !== 'atom') {
    const seeds = [...axes, ...rings.map((r) => r.normal)];
    symmetryAxes = findSymmetryAxes(rel, atomicNumbers, natoms, seeds, bonds.pairs, tolerance);
    methods.push(`Cn grid check (${tolerance} Å)`);
  }

  const detents = buildDetents({
    rings,
    symmetryAxes,
    planeNormal: planarity.planeNormal,
    axes,
    degenerate: inertia.degenerate,
    rel,
    natoms,
  });

  const toWorld = (c: Vec3): Vec3 => [c[0] + com[0], c[1] + com[1], c[2] + com[2]];
  return {
    version: 'lupi.object-facts.v1',
    atomCount: natoms,
    com,
    moments: inertia.moments,
    axes,
    principalQuat: inertia.principalQuat,
    rotor: inertia.rotor,
    kappa: inertia.kappa,
    planar: planarity.planar,
    planarityRms: planarity.planarityRms,
    planeNormal: planarity.planeNormal,
    rings: rings.map((r) => ({ size: r.size, atoms: r.atoms, center: toWorld(r.center), normal: r.normal })),
    symmetryAxes,
    detents,
    captureRadiusDeg: captureRadiusFor(coveringRadiusDeg(detents.map((d) => d.dir))),
    provenance: {
      method: methods.join(' · '),
      tolerance,
      unresolvedElements: inertia.unresolvedElements,
    },
  };
}
