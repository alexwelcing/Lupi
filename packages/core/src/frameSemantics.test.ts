import { describe, expect, it } from 'vitest';
import { ELEMENT_DATA } from './elements';
import {
  LEGACY_ATOM_TYPE_SEMANTICS,
  LEGACY_DISTANCE_SEMANTICS,
  NEUTRAL_TYPE_DISPLAY_RADIUS,
  canInferCovalentBonds,
  hasAngstromDistances,
  hasCompleteElementMapping,
  normalizeAtomTypeSemantics,
  normalizeDistanceSemantics,
  resolveAtomicNumber,
  resolveTypeColor,
  resolveTypeDisplayRadius,
  resolveTypeLabel,
  stableCategoricalColor,
} from './frameSemantics';
import type { AtomTypeSemantics, DistanceSemantics, Frame } from './types';

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
    ids: new Int32Array(types.length),
    identity: { kind: 'synthetic-row', unique: true },
    types: new Int32Array(types),
    typeSemantics,
    distanceSemantics,
    positions: new Float32Array(types.length * 3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

describe('frame type and distance semantics', () => {
  it('normalizes missing legacy metadata to fail-closed semantics', () => {
    expect(normalizeAtomTypeSemantics(undefined)).toEqual(LEGACY_ATOM_TYPE_SEMANTICS);
    expect(normalizeDistanceSemantics(undefined)).toEqual(LEGACY_DISTANCE_SEMANTICS);
    expect(normalizeAtomTypeSemantics(null)).toEqual({
      kind: 'opaque',
      provenance: 'legacy-unknown',
    });
    expect(normalizeDistanceSemantics(null)).toEqual({
      kind: 'unknown',
      provenance: 'legacy-unknown',
    });
  });

  it('resolves only real ELEMENT_DATA entries under declared element semantics', () => {
    const atomic = frame([6], { kind: 'atomic-number', provenance: 'source-element-symbol' });
    const mapped = frame([4], {
      kind: 'explicit-element-map',
      provenance: 'user-type-map',
      elementMap: { 4: 29, 5: 119 },
    });

    expect(resolveAtomicNumber(atomic, 6)).toBe(6);
    expect(resolveAtomicNumber(atomic, 119)).toBeUndefined();
    expect(resolveAtomicNumber(mapped, 4)).toBe(29);
    expect(resolveAtomicNumber(mapped, 5)).toBeUndefined();
    expect(resolveAtomicNumber(frame([6]), 6)).toBeUndefined();
  });

  it('requires a known element mapping for every used frame type', () => {
    expect(
      hasCompleteElementMapping(
        frame([1, 2, 1], {
          kind: 'explicit-element-map',
          provenance: 'lammps-element-column',
          elementMap: { 1: 6, 2: 8 },
        }),
      ),
    ).toBe(true);
    expect(
      hasCompleteElementMapping(
        frame([1, 2], {
          kind: 'explicit-element-map',
          provenance: 'user-type-map',
          elementMap: { 1: 6 },
        }),
      ),
    ).toBe(false);
    expect(
      hasCompleteElementMapping(
        frame([6, 119], { kind: 'atomic-number', provenance: 'procedural-symbol' }),
      ),
    ).toBe(false);
    expect(hasCompleteElementMapping(frame([1, 2]))).toBe(false);
  });

  it('uses stable categorical colors and raw labels when chemistry is opaque', () => {
    const opaque = frame(
      [29],
      { kind: 'opaque', provenance: 'lammps-type-id' },
      { kind: 'unknown', provenance: 'lammps-dump' },
    );
    expect(stableCategoricalColor(29)).toBe(stableCategoricalColor(29));
    expect(stableCategoricalColor(29)).toMatch(/^#[0-9a-f]{6}$/);
    expect(stableCategoricalColor(29)).not.toBe(stableCategoricalColor(30));
    expect(stableCategoricalColor(-1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(resolveTypeLabel(opaque, 29)).toBe('Type 29');
    expect(resolveTypeColor(opaque, 29)).toBe(stableCategoricalColor(29));
  });

  it('uses element labels/colors but only Ångström-scaled element radii', () => {
    const types: AtomTypeSemantics = {
      kind: 'explicit-element-map',
      provenance: 'user-type-map',
      elementMap: { 4: 6 },
    };
    const unknownDistance = frame([4], types, {
      kind: 'unknown',
      provenance: 'lammps-dump',
    });
    const angstromDistance = frame([4], types, {
      kind: 'angstrom',
      provenance: 'source-declared',
    });

    expect(resolveTypeLabel(angstromDistance, 4)).toBe('C');
    expect(resolveTypeColor(angstromDistance, 4)).toBe(ELEMENT_DATA[6].color);
    expect(resolveTypeDisplayRadius(unknownDistance, 4)).toBe(NEUTRAL_TYPE_DISPLAY_RADIUS);
    expect(resolveTypeDisplayRadius(angstromDistance, 4)).toBe(ELEMENT_DATA[6].displayRadius);
    expect(resolveTypeDisplayRadius(angstromDistance, 99)).toBe(NEUTRAL_TYPE_DISPLAY_RADIUS);
  });

  it('permits covalent inference only for complete mappings in Ångström', () => {
    const mapped: AtomTypeSemantics = {
      kind: 'explicit-element-map',
      provenance: 'lammps-element-column',
      elementMap: { 1: 6, 2: 8 },
    };
    const angstrom: DistanceSemantics = {
      kind: 'angstrom',
      provenance: 'format-convention',
    };

    expect(hasAngstromDistances(frame([1], mapped, angstrom))).toBe(true);
    expect(canInferCovalentBonds(frame([1, 2], mapped, angstrom))).toBe(true);
    expect(
      canInferCovalentBonds(
        frame([1, 2], mapped, { kind: 'unknown', provenance: 'lammps-dump' }),
      ),
    ).toBe(false);
    expect(canInferCovalentBonds(frame([1, 3], mapped, angstrom))).toBe(false);
    expect(canInferCovalentBonds(frame([6], undefined, angstrom))).toBe(false);
  });
});
