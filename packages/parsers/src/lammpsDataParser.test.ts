// Ported from the Rust unit tests in wasm/src/data.rs plus a parity check
// against the committed WASM artifact on the same fixtures.
/// <reference types="node" />
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, parseDataFile as wasmParseDataFile } from '../pkg/atlas_parsers.js';
import {
  LammpsDataParseError,
  elementFromLabel,
  elementFromMass,
  parseLammpsDataText,
  resolveElement,
} from './lammpsDataParser';

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  initSync({ module: readFileSync(join(HERE, '..', 'pkg', 'atlas_parsers_bg.wasm')) });
});

const FULL_FIXTURE = `LAMMPS data file — R32-like fixture

4 atoms
2 bonds
3 atom types

-10.0 10.0 xlo xhi
-10.0 10.0 ylo yhi
-10.0 10.0 zlo zhi
1.5 0.0 0.0 xy xz yz

Masses

1   12.011  # c3 r32
2   18.998  # f r32
3   1.008   # h2 r32

Pair Coeffs

1  0.1094  3.3996
2  0.0255  3.1181
3  0.0157  2.2931

Velocities

1  0.1  0.2  0.3
2 -0.1 -0.2 -0.3
3  0.0  0.5  0.0
4  0.5  0.0  0.0

Atoms # full

1 1 1  0.405467  -2.002  -2.788   2.299  # c3 C1 r32 1
2 1 2 -0.25      -1.0    -2.0     2.0    # f F1 r32 1
3 1 3  0.05       0.0     0.0     0.0    # h2 H1 r32 1
4 2 3  0.05       1.0     1.0     1.0    # h2 H1 r32 2

Bonds

1 1 1 2  # r32 1 C1 F1
2 2 1 3  # r32 1 C1 H1
`;

const HEADER = 'title\n\n2 atoms\n2 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n';

const FIXTURES: Record<string, string> = {
  full: FULL_FIXTURE,
  labelFallback: 'title\n\n2 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n\nMasses\n\n1  13.5  # c3\n\nAtoms # full\n\n1 1 1 0.1 1.0 1.0 1.0\n2 1 1 -0.1 2.0 2.0 2.0\n',
  twoLetter: `${HEADER}\nMasses\n\n1  36.5  # cl1\n2  17.0  # ow\n\nAtoms # atomic\n\n1 1 1.0 1.0 1.0\n2 2 2.0 2.0 2.0\n`,
  exotic: `${HEADER}\nMasses\n\n1  12.011\n2  999.0\n\nAtoms # atomic\n\n1 1 1.0 1.0 1.0\n2 2 2.0 2.0 2.0\n`,
  molecular: 'title\n\n1 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n\nAtoms # molecular\n\n1 7 1 1.0 2.0 3.0\n',
  charge: 'title\n\n1 atoms\n1 atom types\n\n0.0 5.0 xlo xhi\n0.0 5.0 ylo yhi\n0.0 5.0 zlo zhi\n\nAtoms # charge\n\n1 1 -0.5 1.0 2.0 3.0\n',
  accelerator: 'title\n\n2 atoms\n2 atom types\n\n0.0 10.0 xlo xhi\n0.0 10.0 ylo yhi\n-5.0 5.0 zlo zhi\n\nMasses\n\n1 10.811\n2 14.0067\n\nAtoms # atomic/kk\n\n7 2 3.2 2.6 -0.1 0 0 0\n6 1 1.9 3.4 -0.2 0 0 0\n',
  unhinted: `${HEADER}\nAtoms\n\n1 1 1.0 2.0 3.0\n2 1 4.0 5.0 6.0\n`,
  velocitiesAfter: `${HEADER}\nAtoms # atomic\n\n1 1 1.0 2.0 3.0\n2 1 4.0 5.0 6.0\n\nVelocities\n\n2 0.5 0.6 0.7\n1 0.1 0.2 0.3\n`,
  crlfAndBom: '﻿title\r\n\r\n2 atoms\r\n1 atom types\r\n\r\n0.0 5.0 xlo xhi\r\n0.0 5.0 ylo yhi\r\n0.0 5.0 zlo zhi\r\n\r\nAtoms # atomic\r\n\r\n1 1 1.0 2.0 3.0\r\n2 1 4.0 5.0 6.0\r\n',
};

const prop = (frame: { properties: Map<string, Float32Array> }, name: string) => {
  const values = frame.properties.get(name);
  return values ? Array.from(values) : undefined;
};

describe('lammpsDataParser', () => {
  it('remaps full-style types to elements by mass and keeps type_id', () => {
    const { frame, hasCompleteMassMapping, stats } = parseLammpsDataText(FULL_FIXTURE);
    expect(frame.natoms).toBe(4);
    expect(Array.from(frame.types)).toEqual([6, 9, 1, 1]);
    expect(prop(frame, 'type_id')).toEqual([1, 2, 3, 3]);
    expect(hasCompleteMassMapping).toBe(true);
    expect(stats.types).toEqual([1, 6, 9]);
    expect(stats.bounds[0]).toBeCloseTo(-2.002, 5);
  });

  it('exposes charge, molecule id and positions with trailing comments stripped', () => {
    const { frame } = parseLammpsDataText(FULL_FIXTURE);
    const q = prop(frame, 'q')!;
    expect(q[0]).toBeCloseTo(0.405467, 5);
    expect(q[1]).toBeCloseTo(-0.25, 5);
    expect(prop(frame, 'mol')).toEqual([1, 1, 1, 2]);
    expect(frame.positions[0]).toBeCloseTo(-2.002, 5);
    expect(frame.positions[2]).toBeCloseTo(2.299, 5);
    expect(Array.from(frame.bonds)).toEqual([0, 1, 0, 2]);
  });

  it('accepts velocities before or after Atoms, keyed by atom id', () => {
    const before = parseLammpsDataText(FULL_FIXTURE).frame;
    expect(prop(before, 'vx')!.map((v) => Math.round(v * 10) / 10)).toEqual([0.1, -0.1, 0, 0.5]);
    expect(prop(before, 'vy')!.map((v) => Math.round(v * 10) / 10)).toEqual([0.2, -0.2, 0.5, 0]);
    const after = parseLammpsDataText(FIXTURES.velocitiesAfter).frame;
    expect(prop(after, 'vx')!.map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.5]);
    expect(prop(after, 'vz')!.map((v) => Math.round(v * 10) / 10)).toEqual([0.3, 0.7]);
  });

  it('parses the triclinic tilt line', () => {
    const { frame } = parseLammpsDataText(FULL_FIXTURE);
    expect(frame.triclinic).toBe(true);
    expect(Array.from(frame.boxTilt)).toEqual([1.5, 0, 0]);
    expect(Array.from(frame.boxBounds)).toEqual([-10, 10, -10, 10, -10, 10]);
  });

  it('falls back to labels for exotic masses and prefers two-letter symbols', () => {
    expect(Array.from(parseLammpsDataText(FIXTURES.labelFallback).frame.types)).toEqual([6, 6]);
    expect(Array.from(parseLammpsDataText(FIXTURES.twoLetter).frame.types)).toEqual([17, 8]);
    const exotic = parseLammpsDataText(FIXTURES.exotic);
    expect(Array.from(exotic.frame.types)).toEqual([1, 2]);
    expect(exotic.frame.properties.has('type_id')).toBe(false);
    expect(exotic.hasCompleteMassMapping).toBe(false);
  });

  it('honors style hints over the token-count heuristic, including accelerator suffixes', () => {
    const molecular = parseLammpsDataText(FIXTURES.molecular).frame;
    expect(prop(molecular, 'mol')).toEqual([7]);
    expect(molecular.properties.has('q')).toBe(false);
    expect(molecular.positions[0]).toBe(1);
    const charge = parseLammpsDataText(FIXTURES.charge).frame;
    expect(prop(charge, 'q')).toEqual([-0.5]);
    expect(charge.properties.has('mol')).toBe(false);
    const accelerator = parseLammpsDataText(FIXTURES.accelerator).frame;
    expect(Array.from(accelerator.ids)).toEqual([7, 6]);
    expect(Array.from(accelerator.types)).toEqual([7, 5]);
    expect(prop(accelerator, 'type_id')).toEqual([2, 1]);
    expect(Array.from(accelerator.positions).map((v) => Math.round(v * 10) / 10)).toEqual([3.2, 2.6, -0.1, 1.9, 3.4, -0.2]);
    expect(accelerator.properties.has('mol')).toBe(false);
  });

  it('keeps raw types with no properties for unhinted files without Masses', () => {
    const { frame } = parseLammpsDataText(FIXTURES.unhinted);
    expect(frame.triclinic).toBe(false);
    expect(Array.from(frame.types)).toEqual([1, 1]);
    expect(frame.properties.size).toBe(0);
    expect(Array.from(parseLammpsDataText(FIXTURES.crlfAndBom).frame.positions)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects files with no Atoms section', () => {
    expect(() => parseLammpsDataText('title\n\n2 atoms\n\nMasses\n\n1 12.011\n')).toThrow(LammpsDataParseError);
  });

  it('resolves elements from masses and labels like the WASM implementation', () => {
    expect(elementFromMass(12.011)).toBe(6);
    expect(elementFromMass(1.008)).toBe(1);
    expect(elementFromMass(55.9)).toBe(26);
    expect(elementFromMass(13.0)).toBeUndefined();
    expect(elementFromLabel('c3 r32')).toBe(6);
    expect(elementFromLabel('ow')).toBe(8);
    expect(elementFromLabel('cl')).toBe(17);
    expect(elementFromLabel('123')).toBeUndefined();
    expect(resolveElement(14.026, 'CH2 backbone')).toBe(6);
    expect(resolveElement(16.023, 'NH2')).toBe(7);
    expect(resolveElement(12.011, 'ca aromatic')).toBe(6);
    expect(resolveElement(40.08, 'ca ion')).toBe(20);
    expect(resolveElement(12.011, null)).toBe(6);
    expect(resolveElement(13.0, null)).toBeUndefined();
  });

  it('matches the WASM parser on every fixture', () => {
    for (const [name, text] of Object.entries(FIXTURES)) {
      const ours = parseLammpsDataText(text).frame;
      const theirs = wasmParseDataFile(name === 'crlfAndBom' ? text.replace(/^﻿/, '') : text) as Record<string, any>;
      expect(ours.natoms, name).toBe(theirs.natoms);
      expect(Array.from(ours.ids), name).toEqual(Array.from(theirs.ids));
      expect(Array.from(ours.types), name).toEqual(Array.from(theirs.types));
      expect(Array.from(ours.positions), name).toEqual(Array.from(Float32Array.from(theirs.positions)));
      expect(Array.from(ours.bonds), name).toEqual(Array.from(theirs.bonds));
      expect(Array.from(ours.boxBounds), name).toEqual(Array.from(theirs.box_bounds));
      expect(Array.from(ours.boxTilt), name).toEqual(Array.from(theirs.box_tilt));
      expect(ours.triclinic, name).toBe(theirs.triclinic);
      const theirProps = (theirs.properties as [string, number[]][]).map(([k, v]) => [k, Array.from(Float32Array.from(v))]);
      const ourProps = Array.from(ours.properties, ([k, v]) => [k, Array.from(v)]);
      expect(ourProps, name).toEqual(theirProps);
    }
  });
});
