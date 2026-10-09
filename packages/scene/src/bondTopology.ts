import { canInferCovalentBonds } from '@atlas/core';
import { MOLECULAR_RECIPE_ID, type BondRecipeId, type PerceivedBonds } from '@atlas/core/bonds';
import type { Frame } from '@atlas/core/types';

export type BondTopologyMode = 'source' | 'infer' | 'none';

export type SourceBondTopologyValidation =
  | { valid: true; count: number }
  | { valid: false; reason: string };

/** Validate the same source-pair invariants used by model export before the
 * live worker is allowed to index position buffers. */
export function validateSourceBondTopology(frame: Frame): SourceBondTopologyValidation {
  const pairs = frame.bonds;
  if (pairs.length % 2 !== 0) {
    return { valid: false, reason: 'source bond topology has an incomplete atom-index pair' };
  }
  for (let pairIndex = 0; pairIndex < pairs.length / 2; pairIndex += 1) {
    const atomA = pairs[pairIndex * 2];
    const atomB = pairs[pairIndex * 2 + 1];
    if (atomA < 0 || atomA >= frame.natoms || atomB < 0 || atomB >= frame.natoms || atomA === atomB) {
      return {
        valid: false,
        reason: `source bond ${pairIndex} has invalid atom indices (${atomA}, ${atomB}) for ${frame.natoms} atoms`,
      };
    }
  }
  return { valid: true, count: pairs.length / 2 };
}

/** Source pairs remain authoritative regardless of chemical metadata. New
 * topology may be inferred only when element and distance semantics support
 * covalent radii in the frame's coordinate space. */
export function resolveBondTopologyMode(
  frame: Frame,
  inferenceAllowed?: boolean,
): BondTopologyMode {
  if (frame.bonds.length > 0) {
    return validateSourceBondTopology(frame).valid ? 'source' : 'none';
  }
  return (inferenceAllowed ?? canInferCovalentBonds(frame)) ? 'infer' : 'none';
}

/** CPU source pairs are authoritative; WebGPU is only an inference backend.
 * The molecular recipe runs on the main thread, never on the GPU. */
export function shouldUseGpuBondInference(
  natoms: number,
  sourceBonds: Int32Array | null | undefined,
  gpuRequested: boolean,
  forceGpuAtomThreshold = 200_000,
  recipe?: BondRecipeId | 'source' | null,
): boolean {
  if (sourceBonds && sourceBonds.length > 0) return false;
  if (recipe === MOLECULAR_RECIPE_ID) return false;
  return gpuRequested || natoms > forceGpuAtomThreshold;
}

/** What the drawn bond layer reports upward (store `lastBondDetail`, MCP status). */
export interface BondsUpdateDetail {
  recipe: BondRecipeId | 'source';
  /** Drawn bonds by kind, after hidden types and the contacts toggle. */
  kinds: { covalent: number; coordination: number; ionicContact: number };
  /** The recipe's evidence for the whole frame (zeros outside the molecular recipe). */
  evidence: { long: number; removed: number; nearMiss: number; clashes: number };
  tolerance: number;
}

const NO_EVIDENCE = { long: 0, removed: 0, nearMiss: 0, clashes: 0 } as const;

/**
 * The detail for one drawn bond set. `kinds` is per drawn bond (0 covalent,
 * 1 coordination, 2 ionic contact); without kinds every drawn bond is covalent.
 */
export function bondsUpdateDetail(
  recipe: BondRecipeId | 'source',
  drawnCount: number,
  tolerance: number,
  molecular?: { kinds: ArrayLike<number>; counts: PerceivedBonds['counts'] } | null,
): BondsUpdateDetail {
  if (!molecular) {
    return { recipe, kinds: { covalent: drawnCount, coordination: 0, ionicContact: 0 }, evidence: { ...NO_EVIDENCE }, tolerance };
  }
  const kinds = { covalent: 0, coordination: 0, ionicContact: 0 };
  for (let k = 0; k < drawnCount; k += 1) {
    const kind = molecular.kinds[k];
    if (kind === 1) kinds.coordination += 1;
    else if (kind === 2) kinds.ionicContact += 1;
    else kinds.covalent += 1;
  }
  const { long, removed, nearMiss, clashes } = molecular.counts;
  return { recipe, kinds, evidence: { long, removed, nearMiss, clashes }, tolerance };
}
