// Properties of the generators, Magnitude, paths and the partition bake that
// no single vector pins down (docs/ar/scale.md §8.1): coverage, closed forms
// against materializations, towers against direct lattices, algebra against
// bigint, containment and flattening, memoization, and fuzzed decoders.
import { describe, expect, it } from 'vitest';
import { ELEMENT_DATA } from '../elements';
import {
  addMagnitude,
  boxChildren,
  boxComposition,
  boxCount,
  compareMagnitude,
  countsOf,
  decodePath,
  decodeRecord,
  decodeRef,
  encodePath,
  encodeRecord,
  formatMagnitude,
  formulaText,
  levelsAlong,
  lnlnMagnitude,
  lnMagnitude,
  magnitude,
  magnitudeKey,
  materializeBox,
  MemoryStore,
  MICRO_DA_V1,
  microDaltonsFromLiteral,
  mortonKeyBig,
  mulSmallMagnitude,
  nodeId,
  partitionOrder,
  bakePartition,
  pathContains,
  readPack,
  removeFrom,
  Resolver,
  rootBox,
  ScaleError,
  subMagnitude,
  toHex,
  toPlain,
  towerMagnitude,
  writePack,
  writeRef,
  type Box,
  type CrystalNode,
  type Step,
  type Vec3n,
} from './index';

/** mulberry32, as the web's fuzz tests. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScaleError) return e.code;
    throw e;
  }
  return 'accepted';
};

const crystal = (structure: CrystalNode['structure'], termination: 0 | 1, cells: Vec3n): CrystalNode => ({
  kind: 'crystal', structure, termination, a: 11, b: structure === 1 || structure === 3 ? 0 : 17, quarter: 92409, cells, capZ: 0, capOffset: 0,
});

/** Atoms of a box in the crystal's frame, as "Z@x,y,z" in Q16. */
function atomKeys(c: CrystalNode, box: Box, removed: Box[] = []): string[] {
  const m = materializeBox(c, box, removed);
  return m.z.map((z, i) => `${z}@${[0, 1, 2].map((a) => m.q[3 * i + a] + 4 * Number(box.lo[a]) * c.quarter).join(',')}`);
}

function leafBoxes(box: Box): Box[] {
  const kids = boxChildren(box);
  return kids.length === 0 ? [box] : kids.flatMap((k) => leafBoxes(k.box));
}

describe('crystals (§3.3)', () => {
  const STRUCTURES = [1, 2, 3, 4, 5] as const;
  it('the octree leaves of every structure and termination cover the crystal exactly once', () => {
    const rand = prng(11);
    for (const s of STRUCTURES) {
      for (const t of [0, 1] as const) {
        const cells: Vec3n = [BigInt(1 + Math.floor(rand() * 4)), BigInt(1 + Math.floor(rand() * 4)), BigInt(1 + Math.floor(rand() * 4))];
        const c = crystal(s, t, cells);
        const whole = atomKeys(c, rootBox(c)).sort();
        const parts = leafBoxes(rootBox(c)).flatMap((b) => atomKeys(c, b)).sort();
        expect(parts).toEqual(whole);
        expect(new Set(whole).size).toBe(whole.length);
      }
    }
  });
  it('closed-form counts and compositions equal the materialized ones for random boxes', () => {
    const rand = prng(12);
    for (let trial = 0; trial < 60; trial += 1) {
      const s = STRUCTURES[trial % 5];
      const c = crystal(s, (trial % 2) as 0 | 1, [5n, 4n, 6n]);
      const lo = c.cells.map((n) => BigInt(Math.floor(rand() * Number(n)))) as Vec3n;
      const hi = lo.map((l, a) => l + 1n + BigInt(Math.floor(rand() * Number(c.cells[a] - l)))) as Vec3n;
      const m = materializeBox(c, { lo, hi });
      expect([boxCount(c, { lo, hi }), boxComposition(c, { lo, hi })]).toEqual([BigInt(m.z.length), countsOf(m.z)]);
    }
  });
  it('the lower half of an odd extent takes the extra cell, and octants exist only on split axes', () => {
    const kids = boxChildren({ lo: [0n, 0n, 0n], hi: [5n, 1n, 2n] });
    expect(kids.map((k) => [k.octant, k.box.lo.map(Number), k.box.hi.map(Number)])).toEqual([
      [0, [0, 0, 0], [3, 1, 1]], [1, [3, 0, 0], [5, 1, 1]], [4, [0, 0, 1], [3, 1, 2]], [5, [3, 0, 1], [5, 1, 2]],
    ]);
  });
  it('a box minus removed sub-boxes drops exactly the atoms whose owner cell they hold (§3.5)', () => {
    for (const t of [0, 1] as const) {
      const c = crystal(5, t, [4n, 3n, 4n]);
      const box = rootBox(c);
      const removed: Box[] = [{ lo: [0n, 0n, 0n], hi: [2n, 2n, 2n] }, { lo: [3n, 2n, 2n], hi: [4n, 3n, 4n] }];
      const owner = (key: string) => key.split('@')[1].split(',').map((v, a) => Math.min(Math.floor(Number(v) / c.quarter / 4), Number(c.cells[a]) - 1));
      const inside = (o: number[], b: Box) => o.every((v, a) => v >= Number(b.lo[a]) && v < Number(b.hi[a]));
      const expected = atomKeys(c, box).filter((k) => !removed.some((b) => inside(owner(k), b)));
      expect(atomKeys(c, box, removed)).toEqual(expected);
    }
  });
});

describe('towers (§3.4)', () => {
  const seedCrystal = crystal(5, 0, [1n, 1n, 1n]);
  const seed = encodeRecord(seedCrystal);
  const cell = 4n * 92409n;
  const periods: [Vec3n, Vec3n, Vec3n] = [[cell, 0n, 0n], [0n, cell, 0n], [0n, 0n, cell]];
  it('a tower of one-cell seeds with f = 2 and 6 levels is the direct 4 × 4 × 4 lattice', () => {
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(seed), factor: 2, periods, levels: 6n });
    const r = new Resolver(new MemoryStore([seed, tower]));
    const keys: string[] = [];
    for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) for (let k = 0; k < 4; k += 1) {
      const bits = (v: number) => [{ digit: (v >> 1) & 1, length: 1n }, { digit: v & 1, length: 1n }].reduce<Array<{ digit: number; length: bigint }>>((out, run) => {
        const last = out[out.length - 1];
        if (last && last.digit === run.digit) last.length += 1n;
        else out.push({ ...run });
        return out;
      }, []);
      const v = r.resolve(nodeId(tower), [{ tag: 'tower', levels: 6n, runs: [bits(i), bits(j), bits(k)] }]);
      const leaf = r.materialize(v);
      for (let n = 0; n < leaf.z.length; n += 1) {
        const q = [0, 1, 2].map((a) => Math.round(leaf.positions[3 * n + a] * 65536) + [i, j, k][a] * Number(cell));
        keys.push(`${leaf.z[n]}@${q.join(',')}`);
      }
    }
    const direct = crystal(5, 0, [4n, 4n, 4n]);
    expect(keys.sort()).toEqual(atomKeys(direct, rootBox(direct)).sort());
  });
  it('counts are seed × f^k at every level, and a substitution changes no count', () => {
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(seed), factor: 3, periods, levels: 7n, substitution: { fromZ: 17, toZ: 35, perCopy: 2 } });
    const r = new Resolver(new MemoryStore([seed, tower]));
    let v = r.root(nodeId(tower));
    const counts = [formatMagnitude(r.count(v))];
    for (let k = 7; k > 0; k -= 1) {
      const axis = (k - 1) % 3;
      const runs = [[], [], []] as Array<Array<{ digit: number; length: bigint }>>;
      runs[axis].push({ digit: k % 3, length: 1n });
      v = r.step(v, { tag: 'tower', levels: 1n, runs: runs as never });
      counts.push(formatMagnitude(r.count(v)));
    }
    expect(counts).toEqual(['17,496', '5,832', '1,944', '648', '216', '72', '24', '8']);
    const leaf = r.materialize(v);
    expect([countsOf(leaf.z).get(35), countsOf(leaf.z).get(17)]).toEqual([2n, 2n]);
  });
  it("a copy's key depends on the tower and the copy, not on how the path was split or on edits around it", () => {
    const L = 9n;
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(seed), factor: 4, periods, levels: L, substitution: { fromZ: 17, toZ: 9, perCopy: 1 } });
    const full: Step = { tag: 'tower', levels: L, runs: [[{ digit: 3, length: 3n }], [{ digit: 1, length: 1n }, { digit: 2, length: 2n }], [{ digit: 0, length: 3n }]] };
    const r = new Resolver(new MemoryStore([seed, tower]));
    const once = r.resolve(nodeId(tower), [full]);
    let v = r.root(nodeId(tower));
    for (let k = Number(L); k > 0; k -= 1) {
      const runs = [[], [], []] as Array<Array<{ digit: number; length: bigint }>>;
      const axis = (k - 1) % 3;
      const digitIndex = Number(levelsAlong(axis, L) - levelsAlong(axis, BigInt(k)));
      const digits = [[3, 3, 3], [1, 2, 2], [0, 0, 0]][axis];
      runs[axis].push({ digit: digits[digitIndex], length: 1n });
      v = r.step(v, { tag: 'tower', levels: 1n, runs: runs as never });
    }
    const edit = encodeRecord({ kind: 'edit', base: nodeId(tower), removed: [[{ tag: 'tower', levels: 1n, runs: [[], [], [{ digit: 2, length: 1n }]] }]] });
    const re = new Resolver(new MemoryStore([seed, tower, edit]));
    const edited = re.walk(re.root(nodeId(edit)), [full]);
    const keyOf = (x: typeof v) => (x.type === 'copy' ? x.key : -1n);
    expect([keyOf(v), keyOf(edited)]).toEqual([keyOf(once), keyOf(once)]);
    expect(toHex(re.probe(edited))).toBe(toHex(r.probe(once)));
  });
});

describe('Magnitude (§5.1, §5.2)', () => {
  const rand = prng(51);
  const randomBig = (bits: number) => {
    let v = 0n;
    for (let i = 0; i < bits; i += 30) v = (v << 30n) | BigInt(Math.floor(rand() * 2 ** 30));
    return v >> BigInt(Math.max(0, Math.ceil(bits / 30) * 30 - bits));
  };
  it('agrees with bigint below 2^65536', () => {
    for (let i = 0; i < 200; i += 1) {
      const a = randomBig(1 + Math.floor(rand() * 400));
      const b = randomBig(1 + Math.floor(rand() * 400));
      const [hi, lo] = a >= b ? [a, b] : [b, a];
      expect([
        toPlain(addMagnitude(magnitude(a), magnitude(b))),
        toPlain(subMagnitude(magnitude(hi), magnitude(lo))),
        compareMagnitude(magnitude(a), magnitude(b)),
        toPlain(mulSmallMagnitude(magnitude(a), b % (1n << 256n))),
      ]).toEqual([a + b, hi - lo, a < b ? -1 : a > b ? 1 : 0, a * (b % (1n << 256n))]);
    }
  });
  it('runs arithmetic agrees with bigint near the 2^65536 boundary, and the result returns to plain', () => {
    const big = towerMagnitude(3n, 2, 65600n);
    const exact = 3n << 65600n;
    const small = randomBig(2000);
    const sum = addMagnitude(big, magnitude(small, 2));
    expect(sum.isPlain).toBe(false);
    expect(magnitudeKey(subMagnitude(sum, magnitude(small)))).toBe(magnitudeKey(big));
    const edge = towerMagnitude(1n, 2, 65536n);
    const down = subMagnitude(edge, magnitude(1));
    expect([edge.isPlain, down.isPlain, toPlain(down), formatMagnitude(subMagnitude(big, magnitude(exact - 7n, 2)))]).toEqual([false, true, (1n << 65536n) - 1n, '7']);
  });
  it('one family is one value: base 2, 4 and 16 towers that are equal have one key; the display base never matters', () => {
    expect(new Set([
      magnitudeKey(towerMagnitude(1n, 2, 280000n)), magnitudeKey(towerMagnitude(1n, 4, 140000n)), magnitudeKey(towerMagnitude(1n, 16, 70000n)),
    ]).size).toBe(1);
    expect(new Set([magnitudeKey(towerMagnitude(1n, 3, 50000n)), magnitudeKey(towerMagnitude(1n, 9, 25000n))]).size).toBe(1);
    expect(formatMagnitude(towerMagnitude(24n, 16, 70000n))).toBe('24 × 16^70000');
    expect(formatMagnitude(towerMagnitude(1n, 4, 140000n))).toBe('4^140000');
  });
  it('different families above 2^65536 are the error base; below it they are plain', () => {
    const two = towerMagnitude(1n, 2, 70000n);
    const three = towerMagnitude(1n, 3, 50000n);
    expect([code(() => addMagnitude(two, three)), code(() => compareMagnitude(two, three)), magnitudeKey(two) === magnitudeKey(three)])
      .toEqual(['base', 'base', false]);
    expect(toPlain(addMagnitude(towerMagnitude(1n, 2, 100n), towerMagnitude(1n, 3, 50n)))).toBe(2n ** 100n + 3n ** 50n);
  });
  it('a negative result is the error range', () => {
    expect([code(() => subMagnitude(magnitude(1), magnitude(2))), code(() => subMagnitude(towerMagnitude(1n, 10, 10n ** 100n), towerMagnitude(1n, 10, 10n ** 100n + 1n)))])
      .toEqual(['range', 'range']);
  });
  it('towers to levels 2^65535 print, compare and take logarithms in O(runs)', () => {
    const L = 1n << 65535n;
    const m = towerMagnitude(1000n, 10, L);
    const n = subMagnitude(m, towerMagnitude(1n, 10, L - 7n));
    const t0 = performance.now();
    expect([formatMagnitude(m), formatMagnitude(n)]).toEqual(['10^(≈ 1.002 × 10^19728)', '9.999999999 × 10^(≈ 1.002 × 10^19728)']);
    expect([compareMagnitude(n, m), Number.isFinite(lnlnMagnitude(m)), lnMagnitude(m)]).toEqual([-1, true, Infinity]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('§5.5: ln and lnln of the googolplex and of 3 × 2^100', () => {
    const gp = towerMagnitude(1000n, 10, 10n ** 100n - 3n);
    expect(lnMagnitude(gp) / Math.LN10).toBeCloseTo(1e100, -88);
    expect(lnlnMagnitude(gp)).toBeCloseTo(Math.log(1e100 * Math.LN10), 12);
    expect(lnMagnitude(towerMagnitude(3n, 2, 100n))).toBeCloseTo(Math.log(3) + 100 * Math.LN2, 9);
  });
});

describe('the mass table lupi.mass.v1 (§5.3)', () => {
  it('is every mass literal of elements.ts scaled by 10^6 exactly', () => {
    const zs = Object.keys(ELEMENT_DATA).map(Number).sort((a, b) => a - b);
    expect(zs.map((z) => microDaltonsFromLiteral(ELEMENT_DATA[z].mass))).toEqual(zs.map((z) => BigInt(MICRO_DA_V1[z])));
    expect(zs.length).toBe(118);
  });
});

describe('removals (§2.6, §4.4)', () => {
  const t = (levels: bigint, runs: number[][]): Step => ({
    tag: 'tower', levels, runs: runs.map((axis) => axis.map((digit) => ({ digit, length: 1n }))) as never,
  });
  it('containment of child, cells and tower steps', () => {
    expect([
      pathContains([{ tag: 'child', index: 1 }], [{ tag: 'child', index: 1 }, { tag: 'child', index: 0 }]),
      pathContains([{ tag: 'child', index: 1 }, { tag: 'child', index: 0 }], [{ tag: 'child', index: 1 }]),
      pathContains([{ tag: 'cells', octants: [3] }], [{ tag: 'cells', octants: [3, 1] }]),
      pathContains([{ tag: 'cells', octants: [3, 1] }], [{ tag: 'cells', octants: [3] }]),
      pathContains([{ tag: 'cells', octants: [3] }], [{ tag: 'cells', octants: [4] }]),
      pathContains([t(1n, [[2], [], []])], [t(3n, [[2], [5], [6]])]),
      pathContains([t(1n, [[2], [], []])], [t(3n, [[1], [5], [6]])]),
      pathContains([t(3n, [[2], [5], [6]])], [t(3n, [[2], [5], [6]]), { tag: 'cells', octants: [0] }]),
      pathContains([t(3n, [[2], [5], [6]])], [t(3n, [[2], [5], [6]])]),
    ]).toEqual([true, false, true, false, false, true, false, true, true]);
  });
  it('flattening: a removal swallows the removals it contains; one inside an existing removal is already gone; a full edit refuses', () => {
    const base = new Uint8Array(32).fill(1);
    let e = removeFrom({ base }, [t(3n, [[2], [5], [6]])]);
    e = removeFrom(e, [t(3n, [[2], [5], [7]])]);
    e = removeFrom(e, [t(1n, [[2], [], []])]);
    expect(e.removed).toEqual([[t(1n, [[2], [], []])]]);
    expect(code(() => removeFrom(e, [t(2n, [[2], [1], []])]))).toBe('path');
    let full = removeFrom({ base }, [{ tag: 'child', index: 0 }]);
    for (let i = 1; i < 256; i += 1) full = removeFrom(full, [{ tag: 'child', index: i }]);
    expect([full.removed.length, code(() => removeFrom(full, [{ tag: 'child', index: 999 }]))]).toEqual([256, 'limit']);
  });
  it('removals nested across a tower seed that is an edit subtract once', () => {
    const SALT = crystal(5, 0, [5n, 5n, 5n]);
    const salt = encodeRecord(SALT);
    const inner = encodeRecord({ kind: 'edit', base: nodeId(salt), removed: [[{ tag: 'cells', octants: [0, 3] }]] });
    const a5 = 20n * 92409n;
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(inner), factor: 10, periods: [[a5, 0n, 0n], [0n, a5, 0n], [0n, 0n, a5]], levels: 3n });
    const outer = encodeRecord({ kind: 'edit', base: nodeId(tower), removed: [[t(3n, [[0], [0], [0]]), { tag: 'cells', octants: [0] }]] });
    const r = new Resolver(new MemoryStore([salt, inner, tower, outer]));
    const copy = r.resolve(nodeId(outer), [t(3n, [[0], [0], [0]])]);
    const whole = r.root(nodeId(outer));
    // The literal §4.4 formula gives 1,000 − 216 − 16 = 768 and 984,000 − 216 = 983,784 here (scale-spec §4.4).
    expect([formatMagnitude(r.count(copy)), r.materialize(copy).z.length, formatMagnitude(r.count(whole)), formulaText(r.composition(whole))])
      .toEqual(['784', 784, '983,800', 'Cl492Na492 × 1,000 − Cl100Na100']);
  });
});

describe('memoization (§4.6)', () => {
  it('a 64-deep chain of 256-way groups counts 256^63 × 3 atoms from 64 records', () => {
    const water = encodeRecord({ kind: 'leaf', z: Uint8Array.from([8, 1, 1]), positions: Float32Array.from([0, 0, 0, 0.96, 0, 0, -0.24, 0.93, 0]) });
    const records = [water];
    let top = nodeId(water);
    for (let d = 2; d <= 64; d += 1) {
      const child = { id: top, rotation: [0, 0, 0, 1] as [number, number, number, number], translation: [0, 0, 0] as [number, number, number] };
      const g = encodeRecord({ kind: 'group', children: new Array(256).fill(child) });
      records.push(g);
      top = nodeId(g);
    }
    const r = new Resolver(new MemoryStore(records));
    const t0 = performance.now();
    const c = r.count(r.root(top));
    expect([toPlain(c), performance.now() - t0 < 1000]).toEqual([256n ** 63n * 3n, true]);
  });
});

describe('lupi.bake.partition@1 (§3.6)', () => {
  const rand = prng(36);
  it('the radix order is the bigint Morton order with ties in source order', () => {
    for (const spread of [3, 4000, 2 ** 20]) {
      const n = 5000;
      const positions = new Float32Array(3 * n);
      for (let i = 0; i < 3 * n; i += 1) positions[i] = Math.fround((rand() * 2 - 1) * spread);
      for (let i = 0; i < 50; i += 1) positions.set(positions.subarray(0, 3), 3 * (100 + i));
      const order = partitionOrder(positions, n);
      const q = [0, 1, 2].map((a) => Array.from({ length: n }, (_, i) => Math.floor(positions[3 * i + a] * 1024)));
      const u = q.map((axis) => { const lo = Math.min(...axis); return axis.map((v) => v - lo); });
      const max = Math.max(...u.flat());
      const bits = max === 0 ? 0 : max.toString(2).length;
      const keys = Array.from({ length: n }, (_, i) => mortonKeyBig([u[0][i], u[1][i], u[2][i]], Math.max(0, bits - 21)));
      const expected = Array.from({ length: n }, (_, i) => i).sort((x, y) => (keys[x] < keys[y] ? -1 : keys[x] > keys[y] ? 1 : x - y));
      expect(Array.from(order)).toEqual(expected);
    }
  });
  it('4,096 atoms or fewer stay one leaf in source order; more are leaves of 4,096 under groups of 8', () => {
    const small = bakePartition(Uint8Array.from([6, 1]), Float32Array.from([1, 2, 3, -1, -2, -3]));
    expect([small.records.length, small.leaves, small.groups, toHex(small.root)])
      .toEqual([1, 1, 0, toHex(nodeId(encodeRecord({ kind: 'leaf', z: Uint8Array.from([6, 1]), positions: Float32Array.from([1, 2, 3, -1, -2, -3]) })))]);
    const n = 4096 * 9 + 1;
    const positions = Float32Array.from({ length: 3 * n }, () => rand() * 100);
    const big = bakePartition(new Uint8Array(n).fill(26), positions);
    expect([big.leaves, big.groups, big.depth]).toEqual([10, 3, 3]);
    const r = new Resolver(new MemoryStore(big.records));
    expect(toPlain(r.count(r.root(big.root)))).toBe(BigInt(n));
  });
  it('fails with range past 2^20 Å', () => {
    expect(code(() => bakePartition(new Uint8Array(4097).fill(6), Float32Array.from({ length: 3 * 4097 }, (_, i) => (i === 7 ? 2 ** 21 : 0))))).toBe('range');
  });
});

describe('fuzzed decoders never fail except with a ScaleError', () => {
  const rand = prng(99);
  const salt = encodeRecord(crystal(5, 0, [5n, 5n, 5n]));
  const tower = encodeRecord({ kind: 'tower', seed: nodeId(salt), factor: 10, periods: [[1848180n, 0n, 0n], [0n, 1848180n, 0n], [0n, 0n, 1848180n]], levels: 10n ** 100n - 3n, substitution: { fromZ: 17, toZ: 35, perCopy: 1 } });
  const group = encodeRecord({ kind: 'group', children: [{ id: nodeId(salt), rotation: [0, 0, 0, 1], translation: [1, 2, 3] }] });
  const edit = encodeRecord({ kind: 'edit', base: nodeId(tower), removed: [[{ tag: 'tower', levels: 1n, runs: [[{ digit: 9, length: 1n }], [], []] }]] });
  const path = encodePath([{ tag: 'child', index: 3 }, { tag: 'tower', levels: 4n, runs: [[{ digit: 1, length: 2n }], [{ digit: 2, length: 1n }], [{ digit: 0, length: 1n }]] }, { tag: 'atoms', ranges: [{ start: 2, length: 3 }] }]);
  const pack = writePack([salt, tower, group, edit], { roots: [{ name: 'tower', id: nodeId(tower) }] });
  const ref = writeRef({ root: nodeId(tower), path: [{ tag: 'tower', levels: 1n, runs: [[{ digit: 4, length: 1n }], [], []] }], store: new MemoryStore([salt, tower]) });
  const mutate = (bytes: Uint8Array): Uint8Array => {
    const out = bytes.slice();
    const flips = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < flips; i += 1) out[Math.floor(rand() * out.length)] = Math.floor(rand() * 256);
    return rand() < 0.2 ? out.subarray(0, Math.floor(rand() * out.length)) : out;
  };
  const survive = (fn: () => unknown) => {
    try {
      fn();
      return true;
    } catch (e) {
      return e instanceof ScaleError;
    }
  };
  it('records, paths, packs and references', () => {
    let ok = true;
    for (let i = 0; i < 400; i += 1) {
      ok &&= survive(() => decodeRecord(mutate([salt, tower, group, edit][i % 4])));
      ok &&= survive(() => decodePath(mutate(path)));
      ok &&= survive(() => decodeRef(mutate(ref)));
    }
    for (let i = 0; i < 60; i += 1) ok &&= survive(() => readPack(mutate(pack), { verifyAll: true }));
    expect(ok).toBe(true);
  });
  it('every kind round-trips: decode, then encode, gives the same bytes', () => {
    expect([salt, tower, group, edit].map((r) => toHex(encodeRecord(decodeRecord(r).node!)))).toEqual([salt, tower, group, edit].map(toHex));
  });
});
