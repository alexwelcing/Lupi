import { describe, it, expect } from 'vitest';
import {
  detectVectorFields,
  detectFrameVectorFields,
  ensureVectorMagnitude,
  magnitudePercentile,
} from './vectorFields';
import type { Frame } from './types';

function frameWith(properties: Record<string, number[]>): Frame {
  const natoms = Object.values(properties)[0]?.length ?? 0;
  return {
    timestep: 0,
    natoms,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: [],
    ids: new Int32Array(natoms),
    types: new Int32Array(natoms),
    positions: new Float32Array(natoms * 3),
    bonds: new Int32Array(0),
    properties: new Map(Object.entries(properties).map(([k, v]) => [k, new Float32Array(v)])),
  };
}

describe('detectVectorFields', () => {
  it('recognizes velocity and force triplets from a research dump', () => {
    // Column set from MaginnGroup HFC-FFs style dumps:
    //   id mol type q x y z vx vy vz fx fy fz c_peatom c_keatom
    const fields = detectVectorFields(['q', 'vx', 'vy', 'vz', 'fx', 'fy', 'fz', 'c_peatom', 'c_keatom']);
    const ids = fields.map((f) => f.id);
    expect(ids).toContain('v');
    expect(ids).toContain('f');
    const v = fields.find((f) => f.id === 'v')!;
    expect(v.kind).toBe('velocity');
    expect(v.components).toEqual(['vx', 'vy', 'vz']);
    expect(v.magnitudeProperty).toBe('|v|');
  });

  it('does not fabricate fields from partial triplets', () => {
    expect(detectVectorFields(['vx', 'vy'])).toEqual([]);
    expect(detectVectorFields(['fx', 'fz'])).toEqual([]);
  });

  it('recognizes generic suffix and bracket triplets', () => {
    const suffix = detectVectorFields(['dispx', 'dispy', 'dispz']);
    expect(suffix).toHaveLength(1);
    expect(suffix[0].components).toEqual(['dispx', 'dispy', 'dispz']);

    const bracket = detectVectorFields(['c_flux[1]', 'c_flux[2]', 'c_flux[3]']);
    expect(bracket).toHaveLength(1);
    expect(bracket[0].magnitudeProperty).toBe('|c_flux|');
  });

  it('does not treat 6-component per-atom stress as a vector', () => {
    const cols = [1, 2, 3, 4, 5, 6].map((i) => `c_stress[${i}]`);
    expect(detectVectorFields(cols)).toEqual([]);
  });
});

describe('ensureVectorMagnitude', () => {
  it('computes and caches |v| on the frame', () => {
    const frame = frameWith({ vx: [3, 0], vy: [4, 0], vz: [0, 5] });
    const [spec] = detectFrameVectorFields(frame);
    const mag = ensureVectorMagnitude(frame, spec)!;
    expect(Array.from(mag)).toEqual([5, 5]);
    // Cached — same array object on second call.
    expect(ensureVectorMagnitude(frame, spec)).toBe(mag);
    // Available to the scalar-property machinery (coloring, legends).
    expect(frame.properties.get('|v|')).toBe(mag);
  });
});

describe('magnitudePercentile', () => {
  it('returns a robust scale reference immune to outliers', () => {
    const mag = new Float32Array(1000).fill(1);
    mag[0] = 1000; // one broken force spike
    const p95 = magnitudePercentile(mag, 0.95);
    expect(p95).toBeGreaterThan(0.9);
    expect(p95).toBeLessThan(10);
  });
  it('handles empty and all-zero arrays', () => {
    expect(magnitudePercentile(new Float32Array(0))).toBe(0);
    expect(magnitudePercentile(new Float32Array(16))).toBe(0);
  });
});
