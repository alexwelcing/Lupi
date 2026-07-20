import { describe, expect, it } from 'vitest';
import { createMockFrame } from '@atlas/core/test-utils';
import { trackedAtomOrderIsStable } from './AtomTrails';

describe('trackedAtomOrderIsStable', () => {
  it('keeps a trail only when verified source IDs retain the tracked row identity', () => {
    const previous = createMockFrame({ natoms: 3 });
    previous.identity = { kind: 'source-id', unique: true };
    previous.ids = new Int32Array([10, 20, 30]);
    const sameOrder = createMockFrame({ natoms: 3 });
    sameOrder.identity = { kind: 'source-id', unique: true };
    sameOrder.ids = new Int32Array([10, 20, 30]);
    const reordered = createMockFrame({ natoms: 3 });
    reordered.identity = { kind: 'source-id', unique: true };
    reordered.ids = new Int32Array([20, 10, 30]);

    expect(trackedAtomOrderIsStable(previous, sameOrder, [0, 2])).toBe(true);
    expect(trackedAtomOrderIsStable(previous, reordered, [0])).toBe(false);
  });

  it('fails closed for synthetic or unknown cross-frame identity', () => {
    const previous = createMockFrame({ natoms: 1 });
    previous.identity = { kind: 'synthetic-row', unique: true };
    const current = createMockFrame({ natoms: 1 });
    current.identity = { kind: 'synthetic-row', unique: true };
    expect(trackedAtomOrderIsStable(previous, current, [0])).toBe(false);
  });

  it('accepts a source-order trajectory contract', () => {
    const previous = createMockFrame({ natoms: 2 });
    const current = createMockFrame({ natoms: 2 });
    previous.identity = { kind: 'source-order', unique: true };
    current.identity = { kind: 'source-order', unique: true };
    expect(trackedAtomOrderIsStable(previous, current, [0, 1])).toBe(true);
  });
});
