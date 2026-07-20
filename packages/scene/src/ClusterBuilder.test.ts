import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core/types';
import { buildClusters } from './ClusterBuilder';

function frame(): Frame {
  return {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([6, 8]),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    positions: new Float32Array([1, 1, 1, 9, 9, 9]),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('cluster visibility parity', () => {
  it('never aggregates atoms whose raw type is hidden', () => {
    const clusters = buildClusters(frame(), { hiddenAtomTypes: new Set([8]) });
    expect(Array.from(clusters.atomCounts)).toEqual([1]);
    expect(Array.from(clusters.positions)).toEqual([1, 1, 1]);
  });
});
