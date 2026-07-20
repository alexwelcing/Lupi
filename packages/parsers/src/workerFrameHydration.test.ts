import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core/types';
import { addSourceIdDisplacement, hydrateWorkerFrame } from './index';

function frame(ids: number[], x: number[], identity: Frame['identity']): Frame {
  return {
    timestep: 0,
    natoms: ids.length,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array(ids),
    types: new Int32Array(ids.length).fill(1),
    positions: new Float32Array(x.flatMap((value) => [value, 0, 0])),
    bonds: new Int32Array(0),
    properties: new Map(),
    identity,
  };
}

describe('parser worker frame hydration', () => {
  it('preserves a structured-cloned identity descriptor without inferring from IDs', () => {
    const hydrated = hydrateWorkerFrame({
      ...frame([9, 4], [0, 1], { kind: 'synthetic-row', unique: true }),
      properties: [],
      typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' },
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' },
    });
    expect(hydrated.identity).toEqual({ kind: 'synthetic-row', unique: true });
    expect(hydrated.typeSemantics).toEqual({ kind: 'opaque', provenance: 'lammps-type-id' });
    expect(hydrated.distanceSemantics).toEqual({ kind: 'unknown', provenance: 'lammps-dump' });

    const legacy = hydrateWorkerFrame({
      ...frame([9, 4], [0, 1], undefined),
      properties: [],
    });
    expect(legacy.identity).toEqual({ kind: 'unknown', unique: false });
    expect(legacy.typeSemantics).toEqual({ kind: 'opaque', provenance: 'legacy-unknown' });
    expect(legacy.distanceSemantics).toEqual({ kind: 'unknown', provenance: 'legacy-unknown' });
  });

  it('joins shuffled source IDs when deriving displacement', () => {
    const first = frame([9, 4], [0, 10], { kind: 'source-id', unique: true });
    const shuffled = frame([4, 9], [13, 2], { kind: 'source-id', unique: true });
    addSourceIdDisplacement([first, shuffled]);
    expect(Array.from(first.properties.get('Displacement') ?? [])).toEqual([0, 0]);
    expect(Array.from(shuffled.properties.get('Displacement') ?? [])).toEqual([3, 2]);
  });

  it('does not invent displacement for synthetic, unknown, or partial identity joins', () => {
    const syntheticA = frame([1, 2], [0, 10], { kind: 'synthetic-row', unique: true });
    const syntheticB = frame([1, 2], [4, 15], { kind: 'synthetic-row', unique: true });
    addSourceIdDisplacement([syntheticA, syntheticB]);
    expect(syntheticA.properties.has('Displacement')).toBe(false);
    expect(syntheticB.properties.has('Displacement')).toBe(false);

    const sourceA = frame([9, 4], [0, 10], { kind: 'source-id', unique: true });
    const differentAtoms = frame([9, 7], [1, 12], { kind: 'source-id', unique: true });
    const subset = frame([9], [1], { kind: 'source-id', unique: true });
    addSourceIdDisplacement([sourceA, differentAtoms, subset]);
    expect(sourceA.properties.has('Displacement')).toBe(true);
    expect(differentAtoms.properties.has('Displacement')).toBe(false);
    expect(subset.properties.has('Displacement')).toBe(false);
  });
});
