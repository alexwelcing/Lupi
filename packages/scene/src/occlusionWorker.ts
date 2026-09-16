/**
 * Scene-analysis Web Worker — per-atom occlusion and far-LOD cluster splats.
 *
 * Both jobs are pure O(atoms) passes that used to run on the main thread in
 * an idle callback (a visible hitch of hundreds of milliseconds after loading
 * or pausing a million-atom scene). They share this worker so the viewer
 * spins up one thread for large-scene analysis.
 *
 * Protocol:
 *   in : { kind: 'occlusion', requestId, positions (transferred), natoms, radius }
 *   out: { kind: 'occlusion', requestId, occlusion: Uint8Array (transferred), referenceDensity }
 *
 *   in : { kind: 'clusters', requestId, positions, types (transferred), natoms,
 *          boxBounds, typeSemantics, distanceSemantics, mobile, hiddenAtomTypes }
 *   out: { kind: 'clusters', requestId, clusters: Clusters (typed arrays transferred) }
 */

import type { Frame } from '@atlas/core/types';
import { computeAtomOcclusion } from './atomOcclusion';
import { buildClusters } from './ClusterBuilder';

interface OcclusionRequest {
  kind: 'occlusion';
  requestId: number;
  positions: Float32Array;
  natoms: number;
  radius: number;
}

interface ClusterRequest {
  kind: 'clusters';
  requestId: number;
  positions: Float32Array;
  types: Int32Array;
  natoms: number;
  boxBounds: Float64Array | null;
  typeSemantics: Frame['typeSemantics'];
  distanceSemantics: Frame['distanceSemantics'];
  mobile: boolean;
  hiddenAtomTypes: number[];
}

type SceneAnalysisRequest = OcclusionRequest | ClusterRequest;

const post = (self as unknown as { postMessage(message: unknown, transfer: ArrayBuffer[]): void }).postMessage.bind(self);

self.onmessage = (event: MessageEvent<SceneAnalysisRequest>) => {
  const request = event.data;
  if (request.kind === 'clusters') {
    const frame = {
      timestep: 0,
      natoms: request.natoms,
      boxBounds: request.boxBounds ?? new Float64Array(6),
      boxTilt: new Float64Array(3),
      triclinic: false,
      columns: [],
      ids: new Int32Array(0),
      types: request.types,
      positions: request.positions,
      bonds: new Int32Array(0),
      properties: new Map<string, Float32Array>(),
      typeSemantics: request.typeSemantics,
      distanceSemantics: request.distanceSemantics,
    } as Frame;
    // ClusterBuilder returns an empty set when the frame has no box.
    if (!request.boxBounds) (frame as { boxBounds?: Float64Array }).boxBounds = undefined;
    const clusters = buildClusters(frame, {
      mobile: request.mobile,
      hiddenAtomTypes: new Set(request.hiddenAtomTypes),
    });
    post(
      { kind: 'clusters', requestId: request.requestId, clusters },
      [
        clusters.positions.buffer as ArrayBuffer,
        clusters.radii.buffer as ArrayBuffer,
        clusters.colors.buffer as ArrayBuffer,
        clusters.atomCounts.buffer as ArrayBuffer,
      ],
    );
    return;
  }
  const result = computeAtomOcclusion({ positions: request.positions, natoms: request.natoms, radius: request.radius });
  post(
    { kind: 'occlusion', requestId: request.requestId, occlusion: result.occlusion, referenceDensity: result.referenceDensity },
    [result.occlusion.buffer as ArrayBuffer],
  );
};
