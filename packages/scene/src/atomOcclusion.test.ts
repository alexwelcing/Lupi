import { describe, expect, it } from 'vitest';
import { computeAtomOcclusion, suggestOcclusionRadius } from './atomOcclusion';

/** Simple cubic lattice of `n` cells per axis, spacing `a`. */
function cubicLattice(n: number, a: number): Float32Array {
  const positions = new Float32Array(n * n * n * 3);
  let k = 0;
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        positions[k++] = x * a;
        positions[k++] = y * a;
        positions[k++] = z * a;
      }
    }
  }
  return positions;
}

function bruteForceDensity(positions: Float32Array, natoms: number, radius: number): Float32Array {
  const density = new Float32Array(natoms);
  const r2 = radius * radius;
  for (let i = 0; i < natoms; i++) {
    for (let j = i + 1; j < natoms; j++) {
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const w = 1 - d2 / r2;
      density[i] += w;
      density[j] += w;
    }
  }
  return density;
}

describe('computeAtomOcclusion', () => {
  it('darkens interior atoms more than corners and faces of a crystal', () => {
    const n = 7;
    const a = 2.5;
    const positions = cubicLattice(n, a);
    const natoms = n * n * n;
    const { occlusion } = computeAtomOcclusion({ positions, natoms, radius: 1.6 * a });

    const index = (x: number, y: number, z: number) => x + y * n + z * n * n;
    const corner = occlusion[index(0, 0, 0)];
    const face = occlusion[index(3, 3, 0)];
    const interior = occlusion[index(3, 3, 3)];
    expect(corner).toBeGreaterThan(face);
    expect(face).toBeGreaterThan(interior);
    // Interior stays legible (never fully black).
    expect(interior).toBeGreaterThanOrEqual(Math.round(0.18 * 255) - 1);
    expect(corner).toBeGreaterThan(160);
  });

  it('matches a brute-force kernel density ordering', () => {
    let state = 11;
    const next = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const natoms = 600;
    const positions = new Float32Array(natoms * 3);
    for (let i = 0; i < natoms * 3; i++) positions[i] = next() * 20;
    const radius = 3;
    const expected = bruteForceDensity(positions, natoms, radius);
    const { occlusion } = computeAtomOcclusion({ positions, natoms, radius, referencePercentile: 1 });

    // Openness must be monotone non-increasing in density (allowing for the
    // 8-bit quantization of the output).
    const order = Array.from({ length: natoms }, (_, i) => i).sort((p, q) => expected[p] - expected[q]);
    for (let k = 1; k < order.length; k++) {
      expect(occlusion[order[k]]).toBeLessThanOrEqual(occlusion[order[k - 1]] + 2);
    }
    const densest = order[order.length - 1];
    const sparsest = order[0];
    expect(occlusion[densest]).toBeLessThan(occlusion[sparsest]);
  });

  it('returns fully open atoms for degenerate input', () => {
    expect(Array.from(computeAtomOcclusion({ positions: new Float32Array(3), natoms: 1, radius: 2 }).occlusion)).toEqual([255]);
    expect(Array.from(computeAtomOcclusion({ positions: new Float32Array(6), natoms: 2, radius: 0 }).occlusion)).toEqual([255, 255]);
    expect(computeAtomOcclusion({ positions: new Float32Array(0), natoms: 0, radius: 2 }).occlusion.length).toBe(0);
  });

  it('suggests a kernel from covalent radii, or from mean spacing without chemistry', () => {
    expect(suggestOcclusionRadius(1.32, new Float32Array(0), 0)).toBeCloseTo(1.6 * 2 * 1.32);
    const lattice = cubicLattice(4, 2);
    const radius = suggestOcclusionRadius(undefined, lattice, 64);
    expect(radius).toBeGreaterThan(2);
    expect(radius).toBeLessThan(8);
  });
});
