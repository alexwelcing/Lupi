import { describe, expect, it } from 'vitest';
import {
  extractFrameDistanceSemantics,
  extractFrameIdentity,
  extractFrameProperties,
  extractFrameTypeSemantics,
  lammpsDataSemantics,
  xyzFrameMetadata,
} from './frameTransfer';

describe('parser worker frame transfer', () => {
  it('serializes canonical Map properties and transfers their backing buffers', () => {
    const vx = new Float32Array([1, 2]);
    const pe = new Float32Array([-3.2, -3.1]);
    const transferables: Transferable[] = [];
    const result = extractFrameProperties(
      { properties: new Map([['vx', vx], ['c_pe', pe]]) },
      transferables,
    );
    expect(result).toEqual([{ name: 'vx', data: vx }, { name: 'c_pe', data: pe }]);
    expect(transferables).toEqual([vx.buffer, pe.buffer]);
  });

  it('retains compatibility with legacy WASM tuple properties', () => {
    const q = new Float32Array([0.1]);
    const transferables: Transferable[] = [];
    expect(extractFrameProperties({ properties: [['q', q]] }, transferables))
      .toEqual([{ name: 'q', data: q }]);
    expect(transferables).toEqual([q.buffer]);
  });

  it('preserves a declared descriptor and leaves legacy worker frames unknown', () => {
    expect(extractFrameIdentity({ identity: { kind: 'source-id', unique: true } }))
      .toEqual({ kind: 'source-id', unique: true });
    expect(extractFrameIdentity({ identity: { kind: 'source-order', unique: true } }))
      .toEqual({ kind: 'source-order', unique: true });
    expect(extractFrameIdentity({}))
      .toEqual({ kind: 'unknown', unique: false });
    expect(extractFrameIdentity({ identity: { kind: 'source-id' } }))
      .toEqual({ kind: 'unknown', unique: false });
  });

  it('preserves declared scientific semantics and normalizes legacy frames explicitly', () => {
    const declared = {
      typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' } as const,
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' } as const,
    };
    expect(extractFrameTypeSemantics(declared)).toEqual(declared.typeSemantics);
    expect(extractFrameDistanceSemantics(declared)).toEqual(declared.distanceSemantics);
    expect(extractFrameTypeSemantics({})).toEqual({
      kind: 'opaque',
      provenance: 'legacy-unknown',
    });
    expect(extractFrameDistanceSemantics({})).toEqual({
      kind: 'unknown',
      provenance: 'legacy-unknown',
    });
  });

  it('marks XYZ element tokens and conventional distance units without claiming source IDs', () => {
    expect(xyzFrameMetadata()).toEqual({
      identity: { kind: 'synthetic-row', unique: true },
      typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
      distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    });
  });

  it('keeps LAMMPS data distances unknown and distinguishes complete Masses inference', () => {
    expect(lammpsDataSemantics(true)).toEqual({
      typeSemantics: { kind: 'atomic-number', provenance: 'lammps-masses-inferred' },
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-data' },
    });
    expect(lammpsDataSemantics(false)).toEqual({
      typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' },
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-data' },
    });
  });
});
