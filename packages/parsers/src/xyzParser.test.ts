import { describe, expect, it } from 'vitest';
import { XyzParseError, parseXyzBytes, parseXyzProperties, parseXyzText, xyzElementToType } from './xyzParser';

describe('xyzParser', () => {
  it('parses plain XYZ into typed arrays with padded bounds and synthetic row ids', () => {
    const { frames, stats } = parseXyzText('3\nwater\nO 0.0 0.0 0.1\nH 0.76 0.0 -0.48\nh -0.76 0.0 -0.48\n');
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.natoms).toBe(3);
    expect(frame.positions).toBeInstanceOf(Float32Array);
    expect(Array.from(frame.types)).toEqual([8, 1, 1]);
    expect(Array.from(frame.ids)).toEqual([1, 2, 3]);
    expect(frame.positions[3]).toBeCloseTo(0.76, 6);
    // Padded box is derived from the stored float32 coordinates.
    [-2.76, 2.76, -2, 2, -2.48, 2.1].forEach((value, index) => expect(frame.boxBounds[index]).toBeCloseTo(value, 6));
    expect(frame.identity).toEqual({ kind: 'synthetic-row', unique: true });
    expect(frame.typeSemantics).toEqual({ kind: 'atomic-number', provenance: 'xyz-element-token' });
    expect(frame.distanceSemantics).toEqual({ kind: 'angstrom', provenance: 'format-convention' });
    expect(stats[0].types).toEqual([1, 8]);
    [-0.76, 0.76, 0, 0, -0.48, 0.1].forEach((value, index) => expect(stats[0].bounds[index]).toBeCloseTo(value, 6));
  });

  it('accepts atomic numbers, rejects unknown tokens instead of inventing hydrogen', () => {
    expect(xyzElementToType('Og')).toBe(118);
    expect(xyzElementToType('cu')).toBe(29);
    expect(xyzElementToType('79')).toBe(79);
    expect(() => xyzElementToType('Xx')).toThrow(/unknown element/);
    expect(() => xyzElementToType('0')).toThrow(/outside/);
    expect(() => xyzElementToType('119')).toThrow(/outside/);
    expect(() => parseXyzText('1\nunknown\nXx 0 0 0\n')).toThrow(XyzParseError);
    expect(() => parseXyzText('1\nbad coordinate\nC 0 abc 0\n')).toThrow(/Invalid y coordinate at line 3/);
    expect(() => parseXyzText('2\ntruncated\nC 0 0 0\n')).toThrow(/Unexpected end of file/);
    expect(() => parseXyzText('')).toThrow(/No valid XYZ frames/);
  });

  it('parses multi-frame trajectories with CRLF, blank separators, BOM and numeric comments', () => {
    const text = '﻿1\r\n100\r\nC 0 0 0\r\n\r\n1\r\n200\r\nC 1 0 0\r\n1\r\nstep=7 note\r\nC 2 0 0\r\n';
    const { frames } = parseXyzText(text);
    expect(frames.map((f) => f.timestep)).toEqual([100, 200, 7]);
    expect(frames.map((f) => f.positions[0])).toEqual([0, 1, 2]);
    expect(parseXyzText('1\nplain comment\nC 0 0 0\n1\nanother\nC 0 0 0\n').frames.map((f) => f.timestep)).toEqual([0, 1]);
  });

  it('honors extended-XYZ Lattice and Properties layouts', () => {
    const text = [
      '2',
      'Lattice="10.0 0.0 0.0 0.0 12.0 0.0 0.0 0.0 14.0" Properties=id:I:1:species:S:1:pos:R:3:vel:R:3:c_pe:R:1 Time=1.5',
      '1 Cu 0.5 0.5 0.5 1 2 3 -3.5',
      '2 Ni 5.0 6.0 7.0 4 5 6 -4.25e0',
      '',
    ].join('\n');
    const { frames, stats } = parseXyzText(text);
    const frame = frames[0];
    expect(Array.from(frame.boxBounds)).toEqual([0, 10, 0, 12, 0, 14]);
    expect(Array.from(frame.types)).toEqual([29, 28]);
    expect(Array.from(frame.positions)).toEqual([0.5, 0.5, 0.5, 5, 6, 7]);
    expect(Array.from(frame.properties.get('vx')!)).toEqual([1, 4]);
    expect(Array.from(frame.properties.get('vz')!)).toEqual([3, 6]);
    expect(Array.from(frame.properties.get('c_pe')!)).toEqual([-3.5, -4.25]);
    expect(Array.from(frame.properties.get('id')!)).toEqual([1, 2]);
    expect(frame.columns).toEqual(['id', 'type', 'x', 'y', 'z', 'id', 'vx', 'vy', 'vz', 'c_pe']);
    expect(stats[0].types).toEqual([28, 29]);
  });

  it('falls back to padded bounds for non-orthogonal lattices and tolerates extra columns', () => {
    const text = '1\nLattice="10 1 0 0 10 0 0 0 10"\nC 1 2 3 extra tokens here\n';
    const { frames } = parseXyzText(text);
    expect(Array.from(frames[0].boxBounds)).toEqual([-1, 3, 0, 4, 1, 5]);
  });

  it('describes Properties layouts, including generic 3-vectors and missing species', () => {
    const layout = parseXyzProperties('species:S:1:pos:R:3:forces:R:3:dipole:R:3:flag:L:1');
    expect(layout.speciesToken).toBe(0);
    expect(layout.posToken).toBe(1);
    expect(layout.requiredTokens).toBe(11);
    expect(layout.propertyTokens.map((p) => p.name)).toEqual(['fx', 'fy', 'fz', 'dipole[1]', 'dipole[2]', 'dipole[3]']);
    const generic = parseXyzProperties('element:S:1:coords:R:3');
    expect(generic.posToken).toBe(1);
    expect(generic.propertyTokens).toEqual([]);
    expect(() => parseXyzProperties('pos:R:3')).toThrow(/no species/);
    expect(() => parseXyzProperties('species:S')).toThrow(/malformed/);
  });

  it('parses bytes with e-notation and signed values exactly like Number()', () => {
    const rows = ['-1.5e-3 2E+2 +0.25', '7 .5 -0.', '1e5 -2.75e-1 3'];
    const text = `3\nnumbers\n${rows.map((r) => `C ${r}`).join('\n')}\n`;
    const { frames } = parseXyzBytes(new TextEncoder().encode(text));
    const expected = rows.flatMap((r) => r.split(' ').map(Number));
    expected.forEach((value, index) => expect(frames[0].positions[index]).toBeCloseTo(value, 6));
  });

  it('reports progress per frame and honors maxFrames', () => {
    const seen: number[] = [];
    const { frames } = parseXyzText('1\na\nC 0 0 0\n1\nb\nC 1 0 0\n1\nc\nC 2 0 0\n', {
      maxFrames: 2,
      onFrame: (index) => seen.push(index),
    });
    expect(frames).toHaveLength(2);
    expect(seen).toEqual([0, 1]);
  });
});
