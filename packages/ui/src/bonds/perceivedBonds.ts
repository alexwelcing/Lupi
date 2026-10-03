/**
 * perceivedBonds.ts — one bond graph per frame for every viewer consumer
 * (strategy §2.8): the live bonds, the atom card, MCP, Object Facts and
 * model exports all read the same memoised `PerceivedBonds`, so they cannot
 * disagree. The molecular recipe runs here, synchronously on the main thread
 * (≤ 2,000 atoms, about a millisecond); it never uses the bond worker or the
 * GPU path.
 *
 * The result is unfiltered. Consumers that show drawn bonds apply
 * `filterPerceivedBonds` with the store's hidden types and `showBondContacts`.
 */
import { canInferCovalentBonds, resolveAtomicNumber } from '@atlas/core';
import {
  ELEMENT_CLASS,
  MOLECULAR_RECIPE_MAX_ATOMS,
  covalentRadius,
  elementClass,
  perceiveBonds,
  selectBondRecipe,
  type BondProfile,
  type BondRecipeId,
  type PerceivedBonds,
} from '@atlas/core/bonds';
import type { Frame } from '@atlas/core/types';

type RecipeFrame = Pick<
  Frame,
  'natoms' | 'types' | 'bonds' | 'typeSemantics' | 'distanceSemantics' | 'periodic' | 'chemistry' | 'sourceRecord'
>;

type PerceiveFrame = Pick<Frame, 'natoms' | 'types' | 'positions' | 'typeSemantics'>;

// canInferCovalentBonds scans every atom; a frame's answer never changes.
const inferenceAllowedCache = new WeakMap<object, { semantics: string; allowed: boolean }>();

function inferenceAllowedFor(frame: RecipeFrame): boolean {
  const semantics = JSON.stringify([frame.typeSemantics ?? null, frame.distanceSemantics ?? null]);
  const cached = inferenceAllowedCache.get(frame);
  if (cached && cached.semantics === semantics) return cached.allowed;
  const allowed = canInferCovalentBonds(frame);
  inferenceAllowedCache.set(frame, { semantics, allowed });
  return allowed;
}

/**
 * The bond rule this frame gets under the store's profile: 'source' when the
 * file supplies bonds, null when nothing may be inferred, otherwise a recipe
 * id (`selectBondRecipe`'s gate: molecular needs a non-periodic XYZ frame of
 * at most 2,000 atoms, and on auto declared chemistry and a single frame or
 * an OMol25 record).
 */
export function resolveFrameRecipe(
  frame: RecipeFrame,
  opts: { profile: BondProfile; frameCount: number },
): BondRecipeId | 'source' | null {
  return selectBondRecipe({
    natoms: frame.natoms,
    frameCount: opts.frameCount,
    sourceBondCount: frame.bonds.length >> 1,
    inferenceAllowed: frame.bonds.length > 0 ? false : inferenceAllowedFor(frame),
    periodic: frame.periodic,
    chemistry: frame.chemistry ?? null,
    isOmol25Record: frame.sourceRecord?.dataset === 'omol25',
    profile: opts.profile,
  });
}

interface CacheEntry {
  types: Int32Array;
  semantics: string;
  result: PerceivedBonds | null;
}

const perceivedCache = new WeakMap<Float32Array, Map<string, CacheEntry>>();

/** Atomic numbers per atom through the frame's type semantics; null when any type is unresolved. */
export function frameAtomicNumbers(frame: PerceiveFrame): Uint8Array | null {
  const out = new Uint8Array(frame.natoms);
  const byType = new Map<number, number | undefined>();
  for (let i = 0; i < frame.natoms; i += 1) {
    const type = frame.types[i];
    let z = byType.get(type);
    if (z === undefined && !byType.has(type)) {
      z = resolveAtomicNumber(frame, type);
      byType.set(type, z);
    }
    if (z === undefined || z <= 0 || z > 255) return null;
    out[i] = z;
  }
  return out;
}

/**
 * The frame's bonds under `recipe` at tolerance τ, memoised on the frame's
 * position buffer (inner key `${recipe}|${tolerance}`). Null above 2,000
 * atoms or when an atom type has no element.
 */
export function getPerceivedBonds(
  frame: PerceiveFrame,
  opts: { recipe: BondRecipeId; tolerance: number },
): PerceivedBonds | null {
  if (!Number.isInteger(frame.natoms) || frame.natoms > MOLECULAR_RECIPE_MAX_ATOMS) return null;
  if (frame.types.length < frame.natoms || frame.positions.length < frame.natoms * 3) return null;
  const key = `${opts.recipe}|${opts.tolerance}`;
  const semantics = JSON.stringify(frame.typeSemantics ?? null);
  let byKey = perceivedCache.get(frame.positions);
  const hit = byKey?.get(key);
  if (hit && hit.types === frame.types && hit.semantics === semantics) return hit.result;

  const atomicNumbers = frameAtomicNumbers(frame);
  const result = atomicNumbers
    ? perceiveBonds({
      atomicNumbers,
      positions: frame.positions,
      natoms: frame.natoms,
      tolerance: opts.tolerance,
      recipe: opts.recipe,
    })
    : null;
  if (!byKey) {
    byKey = new Map();
    perceivedCache.set(frame.positions, byKey);
  }
  byKey.set(key, { types: frame.types, semantics, result });
  return result;
}

/**
 * Contact-occlusion bond-stub reach for a molecular frame: twice the largest
 * covalent radius among the elements that can hold a stick (not s-block ions,
 * which only make dotted contacts, nor inert atoms), plus τ. Null when an
 * atom type has no element.
 */
export function molecularBondStubReach(frame: PerceiveFrame, tolerance: number): number | null {
  const atomicNumbers = frameAtomicNumbers(frame);
  if (!atomicNumbers) return null;
  const seen = new Set<number>();
  let maxR = 0;
  for (let i = 0; i < atomicNumbers.length; i += 1) {
    const z = atomicNumbers[i];
    if (seen.has(z)) continue;
    seen.add(z);
    const cls = elementClass(z);
    if (cls === ELEMENT_CLASS.ion || cls === ELEMENT_CLASS.inert) continue;
    maxR = Math.max(maxR, covalentRadius(z));
  }
  return 2 * maxR + tolerance;
}
