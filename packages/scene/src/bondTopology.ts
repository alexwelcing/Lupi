import { canInferCovalentBonds } from '@atlas/core';
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

/** CPU source pairs are authoritative; WebGPU is only an inference backend. */
export function shouldUseGpuBondInference(
  natoms: number,
  sourceBonds: Int32Array | null | undefined,
  gpuRequested: boolean,
  forceGpuAtomThreshold = 200_000,
): boolean {
  if (sourceBonds && sourceBonds.length > 0) return false;
  return gpuRequested || natoms > forceGpuAtomThreshold;
}
