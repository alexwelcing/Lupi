/**
 * Occlusion Web Worker — thin shell around `computeAtomOcclusion`.
 *
 * Protocol:
 *   in : { requestId, positions: Float32Array (transferred), natoms, radius }
 *   out: { requestId, occlusion: Uint8Array (transferred), referenceDensity }
 */

import { computeAtomOcclusion } from './atomOcclusion';

interface OcclusionWorkerInput {
  requestId: number;
  positions: Float32Array;
  natoms: number;
  radius: number;
}

self.onmessage = (event: MessageEvent<OcclusionWorkerInput>) => {
  const { requestId, positions, natoms, radius } = event.data;
  const result = computeAtomOcclusion({ positions, natoms, radius });
  (self as unknown as { postMessage(message: unknown, transfer: ArrayBuffer[]): void }).postMessage(
    { requestId, occlusion: result.occlusion, referenceDensity: result.referenceDensity },
    [result.occlusion.buffer as ArrayBuffer],
  );
};
