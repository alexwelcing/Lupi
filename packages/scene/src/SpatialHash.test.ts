import { describe, expect, it } from 'vitest';
import { SpatialHash3D } from './SpatialHash';

function seededPositions(count: number, extent: number, seed = 7): Float32Array {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) positions[i] = (next() - 0.5) * extent;
  return positions;
}

function bruteForce(positions: Float32Array, count: number, x: number, y: number, z: number, radius: number) {
  const out: Array<{ index: number; dist: number }> = [];
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - x;
    const dy = positions[i * 3 + 1] - y;
    const dz = positions[i * 3 + 2] - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < radius) out.push({ index: i, dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

describe('SpatialHash3D (typed-array grid)', () => {
  it('matches brute force radius queries, sorted by distance', () => {
    const count = 4000;
    const positions = seededPositions(count, 40);
    const hash = new SpatialHash3D(3.0);
    hash.build(positions, count);

    for (const [x, y, z, r] of [[0, 0, 0, 4], [12, -7, 3, 6], [-19.5, 19.5, 0, 2.5], [50, 50, 50, 5]]) {
      const expected = bruteForce(positions, count, x, y, z, r);
      const actual = hash.query(x, y, z, r);
      expect(actual.map((hit) => hit.index)).toEqual(expected.map((hit) => hit.index));
      for (let i = 0; i < actual.length; i++) {
        expect(actual[i].dist).toBeCloseTo(expected[i].dist, 5);
      }
    }
  });

  it('finds the closest atom by expanding search and respects the max radius', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0.5, 0.5, 0]);
    const hash = new SpatialHash3D(1.0);
    hash.build(positions, 3);
    expect(hash.closest(0.4, 0.4, 0, 5)?.index).toBe(2);
    expect(hash.closest(9.9, 0, 0, 5)?.index).toBe(1);
    expect(hash.closest(100, 100, 100, 5)).toBeNull();
  });

  it('returns exact cell membership and canonical bond pairs', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      5, 5, 5,
    ]);
    const hash = new SpatialHash3D(2.0);
    hash.build(positions, 4);
    expect(hash.getCell(0.2, 0.2, 0.2).sort()).toEqual([0, 1, 2]);
    expect(hash.getCell(5, 5, 5)).toEqual([3]);
    const bonds = hash.findBonds(1.2).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(bonds).toEqual([[0, 1], [0, 2]]);
    expect(hash.stats()).toMatchObject({ totalAtoms: 4, numCells: 2, maxInCell: 3 });
  });

  it('survives non-finite coordinates and empty input', () => {
    const empty = new SpatialHash3D();
    empty.build(new Float32Array(0), 0);
    expect(empty.query(0, 0, 0, 1)).toEqual([]);
    expect(empty.closest(0, 0, 0)).toBeNull();

    const nan = new SpatialHash3D(1.0);
    nan.build(new Float32Array([Number.NaN, 0, 0, 1, 1, 1]), 2);
    expect(nan.query(1, 1, 1, 0.5).map((hit) => hit.index)).toEqual([1]);
    nan.clear();
    expect(nan.query(1, 1, 1, 0.5)).toEqual([]);
  });

  it('coarsens the grid instead of allocating one cell per empty unit of a sparse cloud', () => {
    const positions = new Float32Array([0, 0, 0, 1e5, 1e5, 1e5]);
    const hash = new SpatialHash3D(0.001);
    hash.build(positions, 2);
    expect(hash.query(1e5, 1e5, 1e5, 1).map((hit) => hit.index)).toEqual([1]);
  });
});
