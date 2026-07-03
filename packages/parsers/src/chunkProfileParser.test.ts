import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseChunkProfile,
  looksLikeChunkProfile,
} from './chunkProfileParser';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');

const SYNTHETIC = `# Chunk-averaged data for fix tprof and group all
# Timestep Number-of-chunks Total-count
# Chunk Coord1 Ncount v_temp
100 3 30
  1 0.25 10 270.5
  2 0.5 12 275.0
  3 0.75 8 280.25
200 3 30
  1 0.25 11 271.0
  2 0.5 10 274.5
  3 0.75 9 279.75
`;

describe('looksLikeChunkProfile', () => {
  it('recognizes the ave/chunk header', () => {
    expect(looksLikeChunkProfile(SYNTHETIC)).toBe(true);
  });
  it('rejects dumps, logs, and data files', () => {
    expect(looksLikeChunkProfile('ITEM: TIMESTEP\n0\n')).toBe(false);
    expect(looksLikeChunkProfile('Step Temp PotEng\n0 300 -5.0\n')).toBe(false);
    expect(looksLikeChunkProfile('LAMMPS data file\n\n3 atom types\n')).toBe(false);
  });
});

describe('parseChunkProfile (synthetic)', () => {
  it('parses snapshots, coords, counts, and values', () => {
    const p = parseChunkProfile(SYNTHETIC);
    expect(p.fixName).toBe('tprof');
    expect(p.coordColumns).toEqual(['Coord1']);
    expect(p.valueColumns).toEqual(['v_temp']);
    expect(p.snapshots).toHaveLength(2);

    const s0 = p.snapshots[0];
    expect(s0.timestep).toBe(100);
    expect(s0.nchunks).toBe(3);
    expect(s0.totalCount).toBe(30);
    expect(Array.from(s0.coords[0])).toEqual([0.25, 0.5, 0.75]);
    expect(Array.from(s0.counts)).toEqual([10, 12, 8]);
    expect(Array.from(s0.values[0])).toEqual([270.5, 275.0, 280.25]);

    expect(p.snapshots[1].timestep).toBe(200);
  });

  it('computes global value ranges across snapshots', () => {
    const p = parseChunkProfile(SYNTHETIC);
    expect(p.valueRanges[0].min).toBeCloseTo(270.5);
    expect(p.valueRanges[0].max).toBeCloseTo(280.25);
  });

  it('drops a truncated final snapshot instead of failing', () => {
    const truncated = SYNTHETIC.split('\n').slice(0, -3).join('\n');
    const p = parseChunkProfile(truncated);
    expect(p.snapshots).toHaveLength(1);
    expect(p.snapshots[0].timestep).toBe(100);
  });

  it('handles multiple value columns and 2d coords', () => {
    const twoD = `# Chunk-averaged data for fix flow and group all
# Timestep Number-of-chunks Total-count
# Chunk Coord1 Coord2 Ncount vx vy density/mass
50 2 20
  1 0.25 0.5 10 0.1 -0.2 1.05
  2 0.75 0.5 10 0.3 0.4 1.10
`;
    const p = parseChunkProfile(twoD);
    expect(p.coordColumns).toEqual(['Coord1', 'Coord2']);
    expect(p.valueColumns).toEqual(['vx', 'vy', 'density/mass']);
    expect(p.snapshots[0].coords).toHaveLength(2);
    expect(Array.from(p.snapshots[0].values[2])).toEqual([1.05, 1.1]);
    expect(p.valueRanges[0]).toEqual({ min: 0.1, max: 0.3 });
  });

  it('throws on non-profile content', () => {
    expect(() => parseChunkProfile('Step Temp\n0 300\n')).toThrow(/Not a LAMMPS ave\/chunk profile/);
  });
});

describe('parseChunkProfile (real research payloads — MaginnGroup HFC-FFs)', () => {
  it('parses the R32 thermal-conductivity temperature profile', () => {
    const p = parseChunkProfile(readFixture('hfc-r32-temp-profile-excerpt.txt'));
    expect(p.fixName).toBe('temp_profile');
    expect(p.valueColumns).toEqual(['v_temp']);
    expect(p.snapshots).toHaveLength(3);
    for (const s of p.snapshots) {
      expect(s.nchunks).toBe(20);
      expect(s.totalCount).toBe(10000);
      // Reduced coords span (0, 1) with bin width 0.05.
      expect(s.coords[0][0]).toBeCloseTo(0.025);
      expect(s.coords[0][19]).toBeCloseTo(0.975);
    }
    // Liquid R32 around 273 K — every chunk temperature should be physical.
    const { min, max } = p.valueRanges[0];
    expect(min).toBeGreaterThan(150);
    expect(max).toBeLessThan(400);
  });

  it('parses the R32 viscosity velocity profile', () => {
    const p = parseChunkProfile(readFixture('hfc-r32-velocity-profile-excerpt.txt'));
    expect(p.fixName).toBe('velocity_profile');
    expect(p.valueColumns).toEqual(['vx']);
    expect(p.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(p.snapshots[0].timestep).toBe(1000);
  });
});
