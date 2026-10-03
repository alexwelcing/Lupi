/**
 * objectFactsForFile.ts — Object Facts for the loaded structure's frame.
 *
 * Maps the frame's raw atom types to atomic numbers through the frame's own
 * type semantics (unresolved → 0, which Object Facts counts as mass 12 and
 * records in `provenance.unresolvedElements`) and computes the facts once.
 * Larger structures than `OBJECT_FACTS_MAX_ATOMS` get none: the rig then
 * keeps its isotropic coast and has no detents (the arrow keys step 15°).
 * `opts.bondPairs` (the molecular graph's covalent and coordination pairs)
 * replaces Object Facts' own distance bonds, so rings, symmetry detents and
 * face labels come from the drawn graph, never from a ring through an ion.
 */
import { resolveAtomicNumber } from '@atlas/core';
import { computeObjectFacts, type ObjectFactsV1 } from '@atlas/core/objectFacts';
import type { Frame } from '@atlas/core/types';

export const OBJECT_FACTS_MAX_ATOMS = 2000;

export function objectFactsForFile(
  frame: Pick<Frame, 'natoms' | 'types' | 'positions' | 'typeSemantics'> | null | undefined,
  opts?: { bondPairs?: ArrayLike<number> },
): ObjectFactsV1 | null {
  if (!frame) return null;
  const natoms = frame.natoms;
  if (!Number.isInteger(natoms) || natoms <= 0 || natoms > OBJECT_FACTS_MAX_ATOMS) return null;
  if (frame.types.length < natoms || frame.positions.length < 3 * natoms) return null;
  const atomicNumbers = new Uint16Array(natoms);
  const byType = new Map<number, number>();
  for (let i = 0; i < natoms; i += 1) {
    const type = frame.types[i];
    let z = byType.get(type);
    if (z === undefined) {
      z = resolveAtomicNumber(frame, type) ?? 0;
      byType.set(type, z);
    }
    atomicNumbers[i] = z;
  }
  return computeObjectFacts(
    { atomicNumbers, positions: frame.positions, natoms },
    { maxAtoms: OBJECT_FACTS_MAX_ATOMS, ...(opts?.bondPairs ? { bondPairs: opts.bondPairs } : {}) },
  );
}
