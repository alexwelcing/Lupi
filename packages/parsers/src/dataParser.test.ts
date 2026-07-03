/**
 * Contract test for the committed WASM artifact (pkg/) against a real
 * research-style LAMMPS data file (MaginnGroup HFC-FF R32 shape:
 * atom_style full, annotated Masses/Atoms/Bonds, Pair Coeffs, Velocities).
 *
 * Vitest can't spin up parse.worker.ts (Web Worker + Vite URL imports), so
 * this initializes the wasm binary from disk and calls the same
 * `parseDataFile` export the worker uses. This also catches a stale pkg/
 * that no longer matches the Rust source in wasm/src/data.rs.
 */

/// <reference types="node" />
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync, parseDataFile } from '../pkg/atlas_parsers.js';

const HERE = dirname(fileURLToPath(import.meta.url));

beforeAll(() => {
  const wasmBytes = readFileSync(join(HERE, '..', 'pkg', 'atlas_parsers_bg.wasm'));
  initSync({ module: wasmBytes });
});

/** serde-wasm-bindgen emits properties as [name, values] tuples. */
function prop(frame: any, name: string): number[] | undefined {
  const entry = (frame.properties as [string, number[]][]).find(([k]) => k === name);
  return entry?.[1];
}

const R32_LIKE_DATA = `LAMMPS data file via write_data, R32-like fixture

4 atoms
2 bonds
3 atom types

-31.969 31.969 xlo xhi
-31.969 31.969 ylo yhi
-31.969 31.969 zlo zhi
1.5 0.0 0.0 xy xz yz

Masses

1   12.011  # c3 r32
2   18.998  # f r32
3   1.008   # h2 r32

Pair Coeffs

1  0.1094  3.3996
2  0.0255  3.1181
3  0.0157  2.2931

Atoms # full

1 1 1  0.405467  -22.00200  -27.78800    2.29900  # c3 C1 r32 1
2 1 2 -0.250000  -21.00000  -27.00000    2.00000  # f F1 r32 1
3 1 3  0.050000  -22.50000  -28.50000    1.50000  # h2 H1 r32 1
4 2 3  0.050000   10.00000   10.00000   10.00000  # h2 H1 r32 2

Velocities

1  0.1  0.2  0.3
2 -0.1 -0.2 -0.3
3  0.0  0.5  0.0
4  0.5  0.0  0.0

Bonds

1 1 1 2  # r32 1 C1 F1
2 2 1 3  # r32 1 C1 H1
`;

describe('parseDataFile (wasm) with research-style atom_style full data', () => {
  it('remaps types to atomic numbers via Masses and keeps type_id', () => {
    const f = parseDataFile(R32_LIKE_DATA);
    expect(f.natoms).toBe(4);
    expect(Array.from(f.types)).toEqual([6, 9, 1, 1]); // C F H H
    expect(prop(f, 'type_id')).toEqual([1, 2, 3, 3]);
  });

  it('exposes charge and molecule id as per-atom properties', () => {
    const f = parseDataFile(R32_LIKE_DATA);
    const q = prop(f, 'q')!;
    expect(q[0]).toBeCloseTo(0.405467, 5);
    expect(q[1]).toBeCloseTo(-0.25, 5);
    expect(prop(f, 'mol')).toEqual([1, 1, 1, 2]);
  });

  it('parses velocities into vx/vy/vz keyed by atom id', () => {
    const f = parseDataFile(R32_LIKE_DATA);
    const vx = prop(f, 'vx')!;
    const vz = prop(f, 'vz')!;
    expect(vx.length).toBe(4);
    expect(vx[0]).toBeCloseTo(0.1, 5);
    expect(vx[1]).toBeCloseTo(-0.1, 5);
    expect(vx[3]).toBeCloseTo(0.5, 5);
    expect(vz[0]).toBeCloseTo(0.3, 5);
    expect(vz[2]).toBe(0);
  });

  it('parses the triclinic tilt line', () => {
    const f = parseDataFile(R32_LIKE_DATA);
    expect(f.triclinic).toBe(true);
    expect(Array.from(f.box_tilt)).toEqual([1.5, 0, 0]);
    expect(f.box_bounds[0]).toBeCloseTo(-31.969, 5);
  });

  it('strips trailing comments so coordinates and bonds stay aligned', () => {
    const f = parseDataFile(R32_LIKE_DATA);
    expect(f.positions[0]).toBeCloseTo(-22.002, 4);
    expect(f.positions[2]).toBeCloseTo(2.299, 4);
    expect(Array.from(f.bonds)).toEqual([0, 1, 0, 2]);
  });

  it('keeps raw type ids when masses are exotic (no false chemistry)', () => {
    const data = `title

2 atoms
2 atom types

0.0 5.0 xlo xhi
0.0 5.0 ylo yhi
0.0 5.0 zlo zhi

Masses

1  12.011
2  999.0

Atoms # atomic

1 1 1.0 1.0 1.0
2 2 2.0 2.0 2.0
`;
    const f = parseDataFile(data);
    expect(Array.from(f.types)).toEqual([1, 2]);
    expect(prop(f, 'type_id')).toBeUndefined();
    expect(f.triclinic).toBe(false);
  });
});
