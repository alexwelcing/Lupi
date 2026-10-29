import { describe, expect, it } from 'vitest';
import { FUSE_HOPS, centreFrontAtom, computeFuseHops, fuseEdgeParams } from './fuseHops';

/** Atoms on a line, `step` apart along x. */
function line(count: number, step = 1.5): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) out[i * 3] = i * step;
  return out;
}

/** A regular ring of `count` atoms, bond length about 1.4. */
function ring(count: number): { positions: Float32Array; pairs: Int32Array } {
  const radius = 1.4 / (2 * Math.sin(Math.PI / count));
  const positions = new Float32Array(count * 3);
  const pairs = new Int32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const a = (2 * Math.PI * i) / count;
    positions[i * 3] = radius * Math.cos(a);
    positions[i * 3 + 1] = radius * Math.sin(a);
    pairs[i * 2] = i;
    pairs[i * 2 + 1] = (i + 1) % count;
  }
  return { positions, pairs };
}

function chainPairs(count: number): Int32Array {
  const pairs = new Int32Array((count - 1) * 2);
  for (let i = 0; i + 1 < count; i += 1) {
    pairs[i * 2] = i;
    pairs[i * 2 + 1] = i + 1;
  }
  return pairs;
}

const close = (values: ArrayLike<number>, expected: number[]) =>
  expected.forEach((value, i) => expect(values[i]).toBeCloseTo(value, 5));

describe('computeFuseHops', () => {
  it('counts bond steps along a chain, normalised by the seed eccentricity', () => {
    const result = computeFuseHops({ positions: line(5), natoms: 5, seed: 0, pairs: chainPairs(5) });
    expect(result.mode).toBe('graph');
    expect(result.span).toBe(4);
    expect(result.bondLength).toBeCloseTo(1.5);
    close(result.hops, [0, 0.25, 0.5, 0.75, 1]);
  });

  it('runs both ways from a seed in the middle', () => {
    const result = computeFuseHops({ positions: line(5), natoms: 5, seed: 2, pairs: chainPairs(5) });
    expect(result.span).toBe(2);
    close(result.hops, [1, 0.5, 0, 0.5, 1]);
  });

  it('goes round a ring both ways and meets opposite the seed', () => {
    const { positions, pairs } = ring(6);
    const result = computeFuseHops({ positions, natoms: 6, seed: 0, pairs });
    expect(result.span).toBe(3);
    close(result.hops, [0, 1 / 3, 2 / 3, 1, 2 / 3, 1 / 3]);
  });

  it('follows the bonds, not space: a folded chain is not a shortcut', () => {
    // A U: atoms 0 and 5 sit next to each other but are five bonds apart.
    const positions = new Float32Array([0, 0, 0, 0, 1.5, 0, 0, 3, 0, 1.5, 3, 0, 1.5, 1.5, 0, 1.5, 0, 0]);
    const result = computeFuseHops({ positions, natoms: 6, seed: 0, pairs: chainPairs(6) });
    expect(result.hops[5]).toBeCloseTo(1);
    expect(result.hops[1]).toBeCloseTo(0.2);
  });

  it('branches: every branch is reached by its own steps', () => {
    // A star: 0 at the centre, 1-2-3 one arm, 4 a short arm, 5-6 another.
    const positions = new Float32Array(7 * 3);
    for (let i = 0; i < 7; i += 1) positions[i * 3] = i;
    const pairs = new Int32Array([0, 1, 1, 2, 2, 3, 0, 4, 0, 5, 5, 6]);
    const result = computeFuseHops({ positions, natoms: 7, seed: 0, pairs });
    expect(result.span).toBe(3);
    close(result.hops, [0, 1 / 3, 2 / 3, 1, 1 / 3, 1 / 3, 2 / 3]);
  });

  it('lights disconnected fragments from their distance to the nearest reached atom', () => {
    // A two-atom molecule (bond 1.5) and, 3 Å past its end, another two-atom
    // molecule, plus a lone ion 1.5 Å past that.
    const positions = new Float32Array([0, 0, 0, 1.5, 0, 0, 4.5, 0, 0, 6, 0, 0, 7.5, 0, 0]);
    const pairs = new Int32Array([0, 1, 2, 3]);
    const result = computeFuseHops({ positions, natoms: 5, seed: 0, pairs });
    expect(result.mode).toBe('graph');
    // Raw steps: 0, 1; the gap of 3 Å is two bond lengths: 3; its partner 4; the ion one more: 5.
    expect(result.span).toBeCloseTo(5);
    close(result.hops, [0, 0.2, 0.6, 0.8, 1]);
    for (const hop of result.hops) expect(Number.isFinite(hop)).toBe(true);
  });

  it('keeps the seed molecule on its bonds even when another fragment would be a shortcut', () => {
    // A U-shaped chain 0..5 with a lone ion between its two ends.
    const positions = new Float32Array([0, 0, 0, 0, 1.5, 0, 0, 3, 0, 1.5, 3, 0, 1.5, 1.5, 0, 1.5, 0, 0, 0.75, 0, 0]);
    const result = computeFuseHops({ positions, natoms: 7, seed: 0, pairs: chainPairs(6) });
    // Atom 5 is five bonds from the seed, never 0 → ion → 5 (two half-bond gaps).
    expect(result.hops[5]).toBeCloseTo(1);
    expect(result.hops[6]).toBeLessThan(result.hops[1]);
  });

  it('a single atom has no span and burns by the noise alone', () => {
    const result = computeFuseHops({ positions: new Float32Array([1, 2, 3]), natoms: 1, seed: 0, pairs: null });
    expect(result.span).toBe(0);
    expect(Array.from(result.hops)).toEqual([0]);
    const edge = fuseEdgeParams(result.span, result.bondLength);
    expect(edge.noise).toBe(1);
  });

  it('bonds hidden (no pairs): a spherical wavefront from the seed', () => {
    const positions = new Float32Array([0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, -6]);
    const result = computeFuseHops({ positions, natoms: 4, seed: 0, pairs: null });
    expect(result.mode).toBe('spatial');
    expect(result.bondLength).toBe(FUSE_HOPS.defaultBondLength);
    expect(result.span).toBeCloseTo(6 / 1.5);
    close(result.hops, [0, 0.5, 4 / 6, 1]);
  });

  it('above the graph limit it measures distance, whatever bonds are given', () => {
    const count = FUSE_HOPS.graphMaxAtoms + 1;
    const result = computeFuseHops({ positions: line(count), natoms: count, seed: 0, pairs: chainPairs(count), bondLength: 1.5 });
    expect(result.mode).toBe('spatial');
    expect(result.hops[count - 1]).toBeCloseTo(1);
    expect(result.hops[(count - 1) / 2]).toBeCloseTo(0.5);
  });

  it('clamps a seed outside the frame and ignores pairs that point outside it', () => {
    const result = computeFuseHops({ positions: line(3), natoms: 3, seed: 99, pairs: new Int32Array([0, 1, 1, 2, 2, 7, 1, 1]) });
    expect(result.seed).toBe(2);
    close(result.hops, [1, 0.5, 0]);
  });
});

describe('fuseEdgeParams', () => {
  it('narrows the edge and the noise as the fuse gets longer', () => {
    const short = fuseEdgeParams(2, 1.4);
    const long = fuseEdgeParams(9, 1.4);
    expect(long.edge).toBeLessThan(short.edge);
    expect(long.noise).toBeLessThan(short.noise);
    expect(long.scale).toBeCloseTo(short.scale);
    const huge = fuseEdgeParams(10_000, 1.4);
    expect(huge.edge).toBeGreaterThan(0);
    expect(huge.noise).toBeGreaterThan(0);
  });
});

describe('centreFrontAtom', () => {
  // A cage-like pair of layers seen from +z: a front layer at z = 2, a back one at z = -2.
  const positions = new Float32Array([
    1, 0, 2, -1, 0, 2, 0, 1.2, 2, // front, around the centre line
    0, 0, -2, // back, exactly on the centre line
    6, 0, 4, // nearer the eye, but far off centre
  ]);
  const eye = [0, 0, 20];
  const forward = [0, 0, -1];

  it('takes the front layer at the centre over an atom behind it on the line', () => {
    const seed = centreFrontAtom({ positions, natoms: 5, eye, forward });
    expect([0, 1]).toContain(seed);
  });

  it('skips hidden atoms', () => {
    const seed = centreFrontAtom({ positions, natoms: 5, eye, forward, skip: (i) => i < 3 });
    expect(seed).toBe(3);
  });

  it('falls back to the nearest atom when nothing is in front of the eye', () => {
    const seed = centreFrontAtom({ positions, natoms: 5, eye: [0, 0, 20], forward: [0, 0, 1] });
    expect(seed).toBe(4);
    expect(centreFrontAtom({ positions: new Float32Array(0), natoms: 0, eye, forward })).toBeNull();
  });
});
