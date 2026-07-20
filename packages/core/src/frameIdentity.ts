import type { Frame } from './types';

/**
 * Whether a frame carries a complete, source-provided, uniqueness-verified
 * atom-ID vector. Legacy frames and synthesized row IDs deliberately fail
 * this check even when their numeric values look unique.
 */
export function hasUsableSourceIds(frame: Frame): boolean {
  return (
    frame.identity?.kind === 'source-id' &&
    frame.identity.unique === true &&
    frame.ids.length === frame.natoms
  );
}

/** Whether a frame has a source-backed atom identity suitable for matching
 * rows across trajectory frames. A source-order trajectory has generated row
 * numbers, but unlike a generic synthetic-row frame its format contract
 * guarantees that those rows continue to represent the same atoms. */
export function hasStableAtomIdentity(frame: Frame): boolean {
  return (
    (frame.identity?.kind === 'source-id' || frame.identity?.kind === 'source-order') &&
    frame.identity.unique === true &&
    frame.ids.length === frame.natoms
  );
}

/**
 * Whether two frames have the same atoms in the same array order according
 * to source-provided identifiers. Numeric row equality alone is insufficient:
 * both frames must first satisfy the source-ID contract.
 */
export function framesShareAtomOrder(a: Frame, b: Frame): boolean {
  if (a.natoms !== b.natoms || !hasStableAtomIdentity(a) || !hasStableAtomIdentity(b)) {
    return false;
  }

  for (let i = 0; i < a.natoms; i++) {
    if (a.ids[i] !== b.ids[i]) return false;
  }
  return true;
}
