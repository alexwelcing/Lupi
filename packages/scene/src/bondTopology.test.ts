import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core/types';
import {
  resolveBondTopologyMode,
  shouldUseGpuBondInference,
  validateSourceBondTopology,
} from './bondTopology';

function frame(bonds: number[], mapped: boolean, angstrom: boolean): Frame {
  return {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([1, 2]),
    typeSemantics: mapped
      ? { kind: 'explicit-element-map', provenance: 'user-type-map', elementMap: { 1: 6, 2: 8 } }
      : { kind: 'opaque', provenance: 'lammps-type-id' },
    distanceSemantics: angstrom
      ? { kind: 'angstrom', provenance: 'source-declared' }
      : { kind: 'unknown', provenance: 'lammps-dump' },
    positions: new Float32Array(6),
    bonds: new Int32Array(bonds),
    properties: new Map(),
  };
}

describe('bond topology backend ownership', () => {
  it('never sends authoritative source pairs through the GPU inference path', () => {
    const source = new Int32Array([7, 2]);
    expect(shouldUseGpuBondInference(10, source, true)).toBe(false);
    expect(shouldUseGpuBondInference(1_000_000, source, false)).toBe(false);
  });

  it('still honors requested and large-system GPU inference without source pairs', () => {
    expect(shouldUseGpuBondInference(10, new Int32Array(0), true)).toBe(true);
    expect(shouldUseGpuBondInference(200_001, undefined, false)).toBe(true);
    expect(shouldUseGpuBondInference(10, undefined, false)).toBe(false);
  });

  it('keeps source pairs but rejects unsupported covalent inference', () => {
    expect(resolveBondTopologyMode(frame([0, 1], false, false))).toBe('source');
    expect(resolveBondTopologyMode(frame([], false, false))).toBe('none');
    expect(resolveBondTopologyMode(frame([], true, false))).toBe('none');
    expect(resolveBondTopologyMode(frame([], true, true))).toBe('infer');
  });

  it('accepts an owner-scene inference result without overriding source pairs', () => {
    expect(resolveBondTopologyMode(frame([], true, true), false)).toBe('none');
    expect(resolveBondTopologyMode(frame([], false, false), true)).toBe('infer');
    expect(resolveBondTopologyMode(frame([0, 1], false, false), false)).toBe('source');
  });

  it('fails closed for malformed source pairs instead of indexing invalid atoms or inferring replacements', () => {
    const odd = frame([0, 1, 1], true, true);
    const outOfRange = frame([0, 2], true, true);
    const selfPair = frame([1, 1], true, true);

    expect(validateSourceBondTopology(odd)).toMatchObject({ valid: false });
    expect(validateSourceBondTopology(outOfRange)).toMatchObject({ valid: false });
    expect(validateSourceBondTopology(selfPair)).toMatchObject({ valid: false });
    expect(resolveBondTopologyMode(odd, true)).toBe('none');
    expect(resolveBondTopologyMode(outOfRange, true)).toBe('none');
    expect(resolveBondTopologyMode(selfPair, true)).toBe('none');
  });
});
