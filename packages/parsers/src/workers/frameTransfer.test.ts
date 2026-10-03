import { describe, expect, it } from 'vitest';
import {
  extractFrameDistanceSemantics,
  extractFrameIdentity,
  extractFrameProperties,
  extractFrameTypeSemantics,
  frameProvenanceFields,
  lammpsDataSemantics,
  xyzFrameMetadata,
} from './frameTransfer';
import { hydrateWorkerFrame } from '../index';
import { parseXyzText } from '../xyzParser';

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

  it('round-trips chemistry, sourceRecord and periodic through a structured clone and hydration', () => {
    const text = '1\nOMol25 validation-preview row=2 | collection=validation-preview | method=ωB97M-V | charge=1 | '
      + 'multiplicity=3 | charge_source=record | data_id=metal_complexes | max_force_eV_per_A=0.41 | license=CC-BY-4.0\nPr 0 0 0\n';
    const parsed = parseXyzText(text).frames[0];
    const message = structuredClone({
      ...parsed,
      properties: extractFrameProperties(parsed, []),
      ...frameProvenanceFields(parsed),
    });
    const hydrated = hydrateWorkerFrame(message);
    expect(hydrated.chemistry).toEqual({ totalCharge: 1, spinMultiplicity: 3, source: 'record', domain: 'metal_complexes' });
    expect(hydrated.sourceRecord).toEqual(parsed.sourceRecord);
    expect(hydrated.sourceRecord?.maxForceEvPerA).toBe(0.41);
    expect(hydrated.periodic).toBe(false);
  });

  it('drops malformed provenance and leaves frames from other parsers without the fields', () => {
    expect(frameProvenanceFields({})).toEqual({});
    expect(frameProvenanceFields({
      chemistry: { totalCharge: 0, spinMultiplicity: 1, source: 'guessed', domain: null },
      sourceRecord: { dataset: 'qm9' },
      periodic: 'no',
    })).toEqual({});
    expect(frameProvenanceFields({ periodic: true })).toEqual({ periodic: true });
    expect(frameProvenanceFields({
      chemistry: { totalCharge: 1.5, spinMultiplicity: '2', source: 'file-declared', domain: 7 },
    })).toEqual({ chemistry: { totalCharge: null, spinMultiplicity: null, source: 'file-declared', domain: null } });
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
