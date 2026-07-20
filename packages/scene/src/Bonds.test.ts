import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core/types';
import { filterHiddenTypeBonds } from './Bonds';

function frame(): Frame {
  return {
    timestep: 0,
    natoms: 4,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2, 3, 4]),
    types: new Int32Array([6, 8, 6, 1]),
    positions: new Float32Array(12),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('live bond visibility parity', () => {
  it('removes every pair touching a hidden raw type and keeps distance alignment', () => {
    const result = filterHiddenTypeBonds(
      frame(),
      new Int32Array([0, 1, 0, 2, 2, 3]),
      new Float32Array([1.1, 1.2, 1.3]),
      new Set([8]),
    );
    expect(Array.from(result.pairs)).toEqual([0, 2, 2, 3]);
    expect(Array.from(result.distances)).toEqual([Math.fround(1.2), Math.fround(1.3)]);
  });
});
