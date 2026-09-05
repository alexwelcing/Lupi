// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core';
import { snapshotForStudio, GPU_STUDIO_ATOM_LIMIT } from './snapshot';

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: [],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([6, 8]),
    positions: new Float32Array([1, 2, 3, 4, 5, 6]),
    bonds: new Int32Array([0, 1]),
    properties: new Map(),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    ...overrides,
  };
}
describe('GPU Studio source snapshot', () => {
  it('copies coordinates without modifying or retaining source buffers', () => {
    const source = frame();
    const copy = snapshotForStudio(source, 2, 'Sample', 3);
    expect(copy).toMatchObject({ name: 'Sample', frameNumber: 3, atomCount: 2 });
    expect(copy.groups.map(group => group.label)).toEqual(['C', 'O']);
    expect(copy.groups[0].positions).toEqual([1, 2, 3]);
    expect([...source.positions]).toEqual([1, 2, 3, 4, 5, 6]);
    source.positions[0] = 100;
    expect(copy.groups[0].positions[0]).toBe(1);
  });
  it('keeps opaque IDs as types instead of inventing element identity', () => {
    const copy = snapshotForStudio(frame({ typeSemantics: undefined }), 2, 'Types', 1);
    expect(copy.groups.map(group => group.label)).toEqual(['Type 6', 'Type 8']);
  });
  it('does not mislabel missing or partially resident frames as ready', () => {
    expect(() => snapshotForStudio(undefined, 0, '', 1)).toThrow(/still loading/);
    expect(() => snapshotForStudio(frame(), 1, '', 1)).toThrow(/still loading/);
    expect(() => snapshotForStudio(frame({ natoms: 0 }), 0, '', 1)).toThrow(/still loading/);
  });
  it('enforces the launch limit before copying a large frame', () => {
    expect(() =>
      snapshotForStudio(frame({ natoms: GPU_STUDIO_ATOM_LIMIT + 1 }), 9000, '', 1),
    ).toThrow(/5,000/);
  });
  it('rejects invalid and incomplete coordinate buffers', () => {
    expect(() => snapshotForStudio(frame({ positions: new Float32Array(2) }), 2, '', 1)).toThrow(
      /incomplete/,
    );
    expect(() =>
      snapshotForStudio(frame({ positions: new Float32Array([NaN, 0, 0, 0, 0, 0]) }), 2, '', 1),
    ).toThrow(/invalid/);
    expect(() => snapshotForStudio(frame({ types: new Int32Array(1) }), 2, '', 1)).toThrow(
      /incomplete/,
    );
  });
});
