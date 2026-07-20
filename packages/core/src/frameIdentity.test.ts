import { describe, expect, it } from 'vitest';
import { framesShareAtomOrder, hasStableAtomIdentity, hasUsableSourceIds } from './frameIdentity';
import type { Frame, FrameIdentity } from './types';

function makeFrame(
  ids: number[],
  identity?: FrameIdentity,
  natoms = ids.length,
): Frame {
  return {
    timestep: 0,
    natoms,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array(ids),
    identity,
    types: new Int32Array(natoms),
    positions: new Float32Array(natoms * 3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('frame identity contract', () => {
  it('accepts only complete, uniqueness-verified source IDs', () => {
    expect(hasUsableSourceIds(makeFrame([8, 3], { kind: 'source-id', unique: true }))).toBe(true);
    expect(hasUsableSourceIds(makeFrame([8, 3]))).toBe(false);
    expect(hasUsableSourceIds(makeFrame([1, 2], { kind: 'synthetic-row', unique: true }))).toBe(false);
    expect(hasUsableSourceIds(makeFrame([8, 3], { kind: 'unknown', unique: true }))).toBe(false);
    expect(hasUsableSourceIds(makeFrame([8, 3], { kind: 'source-id', unique: false }))).toBe(false);
    expect(hasUsableSourceIds(makeFrame([8], { kind: 'source-id', unique: true }, 2))).toBe(false);
  });

  it('requires identical source-ID order in equal-sized frames', () => {
    const identity: FrameIdentity = { kind: 'source-id', unique: true };
    expect(framesShareAtomOrder(makeFrame([9, 4, 7], identity), makeFrame([9, 4, 7], identity))).toBe(true);
    expect(framesShareAtomOrder(makeFrame([9, 4, 7], identity), makeFrame([4, 9, 7], identity))).toBe(false);
    expect(framesShareAtomOrder(makeFrame([9, 4, 7], identity), makeFrame([9, 4], identity))).toBe(false);
  });

  it('accepts a source-order contract for cross-frame matching without calling it a source ID', () => {
    const identity: FrameIdentity = { kind: 'source-order', unique: true };
    expect(hasUsableSourceIds(makeFrame([1, 2], identity))).toBe(false);
    expect(hasStableAtomIdentity(makeFrame([1, 2], identity))).toBe(true);
    expect(framesShareAtomOrder(makeFrame([1, 2], identity), makeFrame([1, 2], identity))).toBe(true);
    expect(framesShareAtomOrder(makeFrame([1, 2], identity), makeFrame([2, 1], identity))).toBe(false);
  });

  it('does not reinterpret matching legacy or synthetic rows as shared atom order', () => {
    expect(framesShareAtomOrder(makeFrame([1, 2, 3]), makeFrame([1, 2, 3]))).toBe(false);
    expect(
      framesShareAtomOrder(
        makeFrame([1, 2, 3], { kind: 'synthetic-row', unique: true }),
        makeFrame([1, 2, 3], { kind: 'synthetic-row', unique: true }),
      ),
    ).toBe(false);
  });
});
