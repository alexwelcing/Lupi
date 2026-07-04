import { describe, it, expect } from 'vitest';
import type { Frame } from '@atlas/core';
import {
  assignLook,
  buildDescriptor,
  computeFormula,
  deriveAccent,
  formulaString,
  LOOKS,
} from './artDirection';

/** Minimal frame with the given atomic numbers. */
function frameOf(types: number[]): Frame {
  return {
    timestep: 0,
    natoms: types.length,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: [],
    ids: new Int32Array(types.length),
    types: new Int32Array(types),
    positions: new Float32Array(types.length * 3),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

// Caffeine: C8 H10 N4 O2 (atomic numbers 6, 1, 7, 8)
const caffeine = frameOf([
  ...Array(8).fill(6), ...Array(10).fill(1), ...Array(4).fill(7), ...Array(2).fill(8),
]);

describe('computeFormula (Hill order)', () => {
  it('orders C, H, then other elements alphabetically', () => {
    const parts = computeFormula(caffeine);
    expect(parts.map((p) => p.symbol)).toEqual(['C', 'H', 'N', 'O']);
    expect(formulaString(parts)).toBe('C8H10N4O2');
  });
  it('lists alphabetically when there is no carbon (e.g. water)', () => {
    const water = frameOf([8, 1, 1]);
    expect(formulaString(computeFormula(water))).toBe('H2O');
  });
});

describe('deriveAccent', () => {
  it('keys the accent to the dominant heteroatom', () => {
    // Caffeine: 4×N vs 2×O → nitrogen's CPK blue family, not the H/C greys.
    const accent = deriveAccent(caffeine).toLowerCase();
    expect(accent).not.toBe('#5fb7c8'); // not the hydrocarbon fallback
  });
  it('falls back to the editorial cyan for pure hydrocarbons', () => {
    const benzene = frameOf([...Array(6).fill(6), ...Array(6).fill(1)]);
    expect(deriveAccent(benzene)).toBe('#5fb7c8');
  });
});

describe('buildDescriptor', () => {
  it('assembles name, formula, copy, and atom count', () => {
    const d = buildDescriptor('caffeine', 'CAF', caffeine);
    expect(d.name).toBe('Caffeine');
    expect(d.formula).toBe('C8H10N4O2');
    expect(d.atomCount).toBe(24);
    expect(d.iupac).toContain('purine');
    expect(d.tagline).toBeTruthy();
  });
});

describe('assignLook (the collection alternates extremes)', () => {
  it('gives caffeine the grand tee and dopamine the pocket tee', () => {
    expect(assignLook('caffeine', 'tee').name).toBe('grand');
    expect(assignLook('dopamine', 'tee').name).toBe('pocket');
  });
  it('plays poster extremes across the lineup', () => {
    expect(assignLook('caffeine', 'poster').name).toBe('specimen');
    expect(assignLook('adrenaline', 'poster').name).toBe('colossal');
  });
  it('is deterministic for unknown molecules and always a real look', () => {
    const a = assignLook('unobtainium', 'tee');
    const b = assignLook('unobtainium', 'tee');
    expect(a.name).toBe(b.name);
    expect(Object.keys(LOOKS.tee)).toContain(a.name);
  });
  it('handles MCP-prefixed viewer names', () => {
    expect(assignLook('MCP: Caffeine', 'tee').name).toBe('grand');
  });
});
