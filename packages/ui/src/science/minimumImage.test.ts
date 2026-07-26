import { describe, expect, it } from 'vitest';

import { minimumImageUnwrapFrame, minimumImageUnwrapTrajectory, latticeFromFrame } from './minimumImage';
import type { Frame } from '@atlas/core/types';

function makeFrame(positions: number[], boxBounds?: number[]): Frame {
  return {
    timestep: 0,
    natoms: positions.length / 3,
    boxBounds: new Float64Array(boxBounds ?? [0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: [],
    ids: new Int32Array(positions.length / 3),
    types: new Int32Array(positions.length / 3),
    positions: new Float32Array(positions),
    bonds: new Int32Array(0),
    properties: new Map(),
  } as unknown as Frame;
}

describe('latticeFromFrame', () => {
  it('builds an orthorhombic lattice from box bounds', () => {
    const m = latticeFromFrame(makeFrame([0, 0, 0]))!;
    expect(m).toEqual([10, 0, 0, 0, 10, 0, 0, 0, 10]);
  });
  it('returns null for a degenerate box', () => {
    expect(latticeFromFrame(makeFrame([0, 0, 0], [0, 0, 0, 10, 0, 10]))).toBeNull();
  });
});

describe('minimumImageUnwrapFrame', () => {
  it('an atom crossing +x takes the short path (10 Å cell)', () => {
    const prev = new Float32Array([9.5, 5, 5]);
    const frame = makeFrame([0.5, 5, 5]); // naive: −9 Å; minimum-image: +1 Å
    const out = minimumImageUnwrapFrame(prev, frame);
    expect(out[0]).toBeCloseTo(10.5, 5);
  });

  it('leaves in-cell motion untouched', () => {
    const prev = new Float32Array([5, 5, 5]);
    const frame = makeFrame([6, 5, 5]);
    const out = minimumImageUnwrapFrame(prev, frame);
    expect(out[0]).toBeCloseTo(6, 5);
  });

  it('handles a triclinic (tilted) cell with a real boundary crossing', () => {
    // a = (10,0,0), b = (2,10,0), c = (0,0,10)
    const tilted = makeFrame([1.5, 0.5, 5], [0, 10, 0, 10, 0, 10]);
    tilted.boxTilt = new Float64Array([2, 0, 0]);
    const prev = new Float32Array([9.5, 9.5, 5]);
    const out = minimumImageUnwrapFrame(prev, tilted);
    // Minimum image: prev→out is (4,1,0) ≈ 4.1 Å, not the naive (−8,−9,0) ≈ 12 Å.
    expect(out[0]).toBeCloseTo(13.5, 4);
    expect(out[1]).toBeCloseTo(10.5, 4);
    expect(out[2]).toBeCloseTo(5, 4);
  });

  it('handles a triclinic (tilted) cell without shifting valid hops', () => {
    const prev = new Float32Array([1, 1, 5]);
    const frame = makeFrame([2, 1, 5]);
    const out = minimumImageUnwrapFrame(prev, frame);
    expect(Array.from(out)).toEqual([2, 1, 5]);
  });
});

describe('minimumImageUnwrapTrajectory', () => {
  it('chains unwraps so a multi-frame boundary crossing stays short', () => {
    const trajectory = {
      frames: [
        makeFrame([9.0, 5, 5]),
        makeFrame([0.2, 5, 5]), // crosses → 10.2
        makeFrame([1.0, 5, 5]), // relative to unwrapped 10.2 → 11.0
      ],
      totalFrames: 3,
      atomTypes: [1],
      globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    } as never;
    const out = minimumImageUnwrapTrajectory(trajectory);
    expect(out.frames[0]!.positions[0]).toBeCloseTo(9.0, 5);
    expect(out.frames[1]!.positions[0]).toBeCloseTo(10.2, 5);
    expect(out.frames[2]!.positions[0]).toBeCloseTo(11.0, 5);
  });
});
