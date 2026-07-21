import { describe, expect, it } from 'vitest';
import type { AtomTypeSemantics, DistanceSemantics, Frame } from '@atlas/core/types';
import { ELEMENT_DATA, NEUTRAL_TYPE_DISPLAY_RADIUS, hexToRgb } from '@atlas/core';
import {
  MAX_RENDER_TYPE_SLOTS,
  buildTypeRenderTable,
  typeRenderTablesEqual,
} from './typeRenderTable';

function frame(
  types: number[],
  typeSemantics?: AtomTypeSemantics,
  distanceSemantics?: DistanceSemantics,
): Frame {
  return {
    timestep: 0,
    natoms: types.length,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['type', 'x', 'y', 'z'],
    ids: Int32Array.from(types, (_, index) => index + 1),
    types: new Int32Array(types),
    typeSemantics,
    distanceSemantics,
    positions: new Float32Array(types.length * 3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('type render table', () => {
  it('renders opaque types categorically with one neutral physical radius', () => {
    const table = buildTypeRenderTable(frame(
      [2, 1, 2],
      { kind: 'opaque', provenance: 'lammps-type-id' },
      { kind: 'unknown', provenance: 'lammps-dump' },
    ));

    expect(table.entries.map((entry) => entry.rawType)).toEqual([1, 2]);
    expect(table.entries.map((entry) => entry.slot)).toEqual([0, 1]);
    expect(table.entries.every((entry) => entry.atomicNumber === undefined)).toBe(true);
    expect(table.entries.every((entry) => entry.displayRadius === NEUTRAL_TYPE_DISPLAY_RADIUS)).toBe(true);
    expect(table.entries[0].color).not.toEqual(table.entries[1].color);
  });

  it('resolves explicit mappings only when coordinates are in angstroms', () => {
    const semantics: AtomTypeSemantics = {
      kind: 'explicit-element-map',
      provenance: 'user-type-map',
      elementMap: { 1: 29, 300: 8 },
    };
    const table = buildTypeRenderTable(frame(
      [300, 1],
      semantics,
      { kind: 'angstrom', provenance: 'source-declared' },
    ));

    expect(table.byRawType.get(1)).toMatchObject({ slot: 0, atomicNumber: 29 });
    expect(table.byRawType.get(300)).toMatchObject({ slot: 1, atomicNumber: 8 });
    expect(table.byRawType.get(1)?.color).toEqual(hexToRgb(ELEMENT_DATA[29].color));
    expect(table.byRawType.get(300)?.displayRadius).toBe(ELEMENT_DATA[8].displayRadius);
  });

  it('maps raw IDs above 255 to dense slots without collapsing them', () => {
    const table = buildTypeRenderTable(frame(
      [300, 1, 999],
      { kind: 'opaque', provenance: 'lammps-type-id' },
      { kind: 'unknown', provenance: 'lammps-dump' },
    ));
    expect(table.byRawType.get(1)?.slot).toBe(0);
    expect(table.byRawType.get(300)?.slot).toBe(1);
    expect(table.byRawType.get(999)?.slot).toBe(2);
  });

  it('fails rather than aliasing more types than the shader palette can represent', () => {
    const types = Array.from({ length: MAX_RENDER_TYPE_SLOTS + 1 }, (_, index) => index + 1);
    expect(() => buildTypeRenderTable(frame(types))).toThrow(/at most 256 distinct types/i);
  });

  it('keeps palette identity only while render semantics are unchanged', () => {
    const first = buildTypeRenderTable(frame(
      [1, 8, 1],
      { kind: 'atomic-number', provenance: 'xyz-element-token' },
      { kind: 'angstrom', provenance: 'format-convention' },
    ));
    const sameDomain = buildTypeRenderTable(frame(
      [8, 1, 8],
      { kind: 'atomic-number', provenance: 'xyz-element-token' },
      { kind: 'angstrom', provenance: 'format-convention' },
    ));
    const changedDomain = buildTypeRenderTable(frame(
      [1, 6, 8],
      { kind: 'atomic-number', provenance: 'xyz-element-token' },
      { kind: 'angstrom', provenance: 'format-convention' },
    ));

    expect(typeRenderTablesEqual(first, sameDomain)).toBe(true);
    expect(typeRenderTablesEqual(first, changedDomain)).toBe(false);
  });
});
