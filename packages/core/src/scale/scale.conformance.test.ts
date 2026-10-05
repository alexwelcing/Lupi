// What readers must reject (scale-spec §1.2, §1.3, §2, §4.2, §4.3, §6.6, §7.3),
// and what they must accept: every rule here is [B], so both implementations
// fail the same inputs with the same codes.
import { describe, expect, it } from 'vitest';
import {
  canonicalPath,
  crc32,
  decodePath,
  decodeRecord,
  decodeRef,
  encodePath,
  encodeRecord,
  encodeRef,
  fromBase64url,
  MemoryStore,
  nodeId,
  readPack,
  Reader,
  refFromText,
  refText,
  resolveRef,
  Resolver,
  ScaleError,
  toHex,
  writePack,
  writeRef,
  Writer,
  type CrystalNode,
  type Node,
  type Step,
  type Vec3n,
} from './index';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScaleError) return e.code;
    throw e;
  }
  return 'accepted';
};

const SALT: CrystalNode = { kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [5n, 5n, 5n], capZ: 0, capOffset: 0 };
const saltRec = encodeRecord(SALT);
const saltId = nodeId(saltRec);
const A5 = 5n * 4n * 92409n;
const PERIODS: [Vec3n, Vec3n, Vec3n] = [[A5, 0n, 0n], [0n, A5, 0n], [0n, 0n, A5]];
const WATER: Node = { kind: 'leaf', z: Uint8Array.from([8, 1, 1]), positions: Float32Array.from([0, 0, 0.1173, 0, 0.7572, -0.4692, 0, -0.7572, -0.4692]) };
const waterRec = encodeRecord(WATER);

/** A copy of a record with bytes patched and bodyLength kept. */
function patched(record: Uint8Array, at: number, values: number[]): Uint8Array {
  const out = record.slice();
  out.set(values, at);
  return out;
}

function f64Bytes(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
}

describe('§1 primitives readers reject', () => {
  it('a non-minimal BigUInt', () => {
    expect(code(() => new Reader(Uint8Array.from([2, 0, 1, 0])).bigUInt())).toBe('canonical');
  });
  it('a BigUInt over 65,536 bits', () => {
    expect(code(() => new Reader(Uint8Array.from([1, 0x20, 1])).bigUInt())).toBe('limit');
  });
  it('256 is 02 00 00 01', () => {
    expect(toHex(new Writer().bigUInt(256n).finish())).toBe('02000001');
  });
  it('−0 as f32 and f64, and writers write +0', () => {
    expect(code(() => new Reader(Uint8Array.from([0, 0, 0, 0x80])).f32())).toBe('canonical');
    expect(code(() => new Reader(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0x80])).f64())).toBe('canonical');
    expect(toHex(new Writer().f32(-0).f64(-0).finish())).toBe('000000000000000000000000');
  });
  it('non-finite floats', () => {
    expect(code(() => new Reader(Uint8Array.from([0, 0, 0xc0, 0x7f])).f32())).toBe('range');
    expect(code(() => new Writer().f64(Infinity))).toBe('range');
  });
  it('base64url with padding, stray characters or trailing bits', () => {
    expect(code(() => fromBase64url('TFNS='))).toBe('canonical');
    expect(code(() => fromBase64url('TF+S'))).toBe('canonical');
    expect(code(() => fromBase64url('TFNT'))).toBe('accepted');
    expect(code(() => fromBase64url('TR'))).toBe('canonical');
  });
});

describe('§2 records readers reject', () => {
  it('a wrong magic, a short record, a bodyLength that disagrees', () => {
    expect(code(() => decodeRecord(patched(waterRec, 0, [0x4d])))).toBe('magic');
    expect(code(() => decodeRecord(waterRec.subarray(0, 10)))).toBe('truncated');
    expect(code(() => decodeRecord(waterRec.subarray(0, 50)))).toBe('truncated');
    const longer = new Uint8Array(waterRec.length + 4);
    longer.set(waterRec);
    expect(code(() => decodeRecord(longer))).toBe('canonical');
  });
  it('nonzero record flags', () => {
    expect(code(() => decodeRecord(patched(waterRec, 6, [1])))).toBe('canonical');
  });
  it('keeps an unknown kind or version opaque, and resolving through it is unsupported', () => {
    const opaque = patched(waterRec, 4, [9]);
    const newer = patched(waterRec, 5, [2]);
    expect([decodeRecord(opaque).node, decodeRecord(newer).node, toHex(decodeRecord(opaque).id)]).toEqual([null, null, toHex(nodeId(opaque))]);
    expect(code(() => new Resolver(new MemoryStore([opaque])).root(nodeId(opaque)))).toBe('unsupported');
  });
  it('a record over 65,536 bytes', () => {
    expect(code(() => decodeRecord(new Uint8Array(65537)))).toBe('limit');
  });
  describe('leaf', () => {
    it('an atom count of 0 or 4,097', () => {
      expect(code(() => decodeRecord(patched(waterRec, 12, [0, 0, 0, 0])))).toBe('range');
      expect(code(() => encodeRecord({ kind: 'leaf', z: new Uint8Array(4097).fill(1), positions: new Float32Array(3 * 4097) }))).toBe('range');
    });
    it('atomic numbers 0 and 119', () => {
      expect(code(() => decodeRecord(patched(waterRec, 16, [0])))).toBe('range');
      expect(code(() => decodeRecord(patched(waterRec, 16, [119])))).toBe('range');
    });
    it('a nonzero padding byte', () => {
      expect(code(() => decodeRecord(patched(waterRec, 19, [1])))).toBe('canonical');
    });
    it('−0, a non-finite value, and a coordinate past 2^20 Å', () => {
      expect(code(() => decodeRecord(patched(waterRec, 20, [0, 0, 0, 0x80])))).toBe('canonical');
      expect(code(() => decodeRecord(patched(waterRec, 20, [0, 0, 0x80, 0x7f])))).toBe('range');
      expect(code(() => decodeRecord(patched(waterRec, 20, [1, 0, 0x80, 0x49])))).toBe('range');
      expect(code(() => decodeRecord(patched(waterRec, 20, [0, 0, 0x80, 0x49])))).toBe('accepted');
    });
    it('writes −0 as +0, and the record round-trips', () => {
      const rec = encodeRecord({ kind: 'leaf', z: Uint8Array.from([6]), positions: Float32Array.from([-0, 0, 1.5]) });
      expect([toHex(rec.subarray(20, 24)), toHex(encodeRecord(decodeRecord(rec).node!))]).toEqual(['00000000', toHex(rec)]);
    });
  });
  describe('group', () => {
    const child = { id: saltId, rotation: [0, 0, 0, 1] as [number, number, number, number], translation: [1, 2, 3] as [number, number, number] };
    const groupRec = encodeRecord({ kind: 'group', children: [child] });
    it('no children, and a nonzero reserved field', () => {
      expect(code(() => decodeRecord(patched(groupRec, 12, [0, 0])))).toBe('range');
      expect(code(() => decodeRecord(patched(groupRec, 14, [1])))).toBe('canonical');
    });
    it('a quaternion that is not unit within 2^-30', () => {
      expect(code(() => decodeRecord(patched(groupRec, 72, f64Bytes(1 + 2 ** -29))))).toBe('validity');
      expect(code(() => decodeRecord(patched(groupRec, 72, f64Bytes(1 + 2 ** -31))))).toBe('accepted');
    });
    it('a quaternion with the wrong sign: qw < 0, or qw = 0 and the first nonzero negative', () => {
      expect(code(() => decodeRecord(patched(groupRec, 72, f64Bytes(-1))))).toBe('canonical');
      const flipped = patched(patched(groupRec, 48, f64Bytes(-1)), 72, f64Bytes(0));
      expect(code(() => decodeRecord(flipped))).toBe('canonical');
    });
    it('writers negate a non-canonical quaternion', () => {
      const rec = encodeRecord({ kind: 'group', children: [{ ...child, rotation: [0, 0, 0, -1] }] });
      expect(toHex(rec)).toBe(toHex(groupRec));
    });
    it('a translation past 2^40 Å, and −0', () => {
      expect(code(() => decodeRecord(patched(groupRec, 80, f64Bytes(2 ** 41))))).toBe('range');
      expect(code(() => decodeRecord(patched(groupRec, 80, [0, 0, 0, 0, 0, 0, 0, 0x80])))).toBe('canonical');
    });
  });
  describe('crystal', () => {
    const bad = (patch: Partial<CrystalNode>) => code(() => encodeRecord({ ...SALT, ...patch }));
    it('B on sc and fcc; no B on rock salt', () => {
      expect([bad({ structure: 3, b: 17 }), bad({ structure: 1, b: 17 }), bad({ b: 0 })]).toEqual(['validity', 'validity', 'validity']);
    });
    it('quarter and cells out of range', () => {
      expect([bad({ quarter: 0 }), bad({ quarter: 2 ** 20 + 1 }), bad({ cells: [0n, 1n, 1n] }), bad({ cells: [2n ** 60n + 1n, 2n ** 60n, 2n ** 60n] })])
        .toEqual(['range', 'range', 'range', 'range']);
    });
    it('an aspect over 2^16, compared exactly', () => {
      expect([bad({ cells: [65537n, 1n, 1n] }), bad({ cells: [65536n, 1n, 1n] })]).toEqual(['validity', 'accepted']);
    });
    it('capped needs a diamond cube of 1 to 12 cells and nonzero capZ and capOffset', () => {
      const cap: Partial<CrystalNode> = { structure: 4, termination: 2, a: 6, b: 0, capZ: 1, capOffset: 41243, cells: [3n, 3n, 3n] };
      expect([
        bad(cap), bad({ ...cap, structure: 3 }), bad({ ...cap, cells: [3n, 3n, 2n] }), bad({ ...cap, cells: [13n, 13n, 13n] }),
        bad({ ...cap, capZ: 0 }), bad({ ...cap, capOffset: 0 }), bad({ capZ: 1 }),
      ]).toEqual(['accepted', 'validity', 'validity', 'range', 'range', 'range', 'canonical']);
    });
    it('nonzero reserved bytes', () => {
      expect(code(() => decodeRecord(patched(saltRec, 45, [1])))).toBe('canonical');
    });
  });
  describe('tower', () => {
    const tower = (patch: Record<string, unknown>) => code(() => encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 3n, ...patch } as Node));
    const towerRec = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 3n });
    it('factors 1 and 17', () => {
      expect([tower({ factor: 1 }), tower({ factor: 17 }), tower({ factor: 16 })]).toEqual(['range', 'range', 'accepted']);
    });
    it('unknown flag bits and a nonzero reserved field', () => {
      expect(code(() => decodeRecord(patched(towerRec, 45, [2])))).toBe('canonical');
      expect(code(() => decodeRecord(patched(towerRec, 46, [1])))).toBe('canonical');
    });
    it('dependent periods, a component past 2^40, a cell more than 2^12 times longer than wide', () => {
      expect([
        tower({ periods: [[1n, 0n, 0n], [2n, 0n, 0n], [0n, 0n, 1n]] }),
        tower({ periods: [[2n ** 40n + 1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]] }),
        tower({ periods: [[4097n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]] }),
        tower({ periods: [[4096n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]] }),
      ]).toEqual(['validity', 'range', 'validity', 'accepted']);
    });
    it('a non-minimal levels BigUInt', () => {
      const rec = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 0n });
      const w = new Writer().bytes(rec.subarray(0, 120)).u16(1).u8(0);
      const bytes = w.finish();
      new DataView(bytes.buffer).setUint32(8, bytes.length - 12, true);
      expect(code(() => decodeRecord(bytes))).toBe('canonical');
    });
    it('a substitution to the same element, or of 0 or 4,097 per copy', () => {
      expect([
        tower({ substitution: { fromZ: 17, toZ: 17, perCopy: 1 } }),
        tower({ substitution: { fromZ: 17, toZ: 35, perCopy: 0 } }),
        tower({ substitution: { fromZ: 17, toZ: 35, perCopy: 4097 } }),
      ]).toEqual(['validity', 'range', 'range']);
    });
  });
  describe('edit', () => {
    const towerRec = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 3n });
    const slab = (j: number): Step[] => [{ tag: 'tower', levels: 1n, runs: [[{ digit: j, length: 1n }], [], []] }];
    it('no removals, and removals that do not ascend strictly', () => {
      const one = encodeRecord({ kind: 'edit', base: nodeId(towerRec), removed: [slab(3)] });
      expect(code(() => decodeRecord(patched(one, 44, [0, 0])))).toBe('range');
      const two = encodeRecord({ kind: 'edit', base: nodeId(towerRec), removed: [slab(3), slab(5)] });
      // Swap the two equal-length removals in place.
      const swapped = two.slice();
      swapped.set(two.subarray(48 + 20, 48 + 40), 48);
      swapped.set(two.subarray(48, 48 + 20), 48 + 20);
      expect(code(() => decodeRecord(swapped))).toBe('canonical');
      expect(code(() => encodeRecord({ kind: 'edit', base: nodeId(towerRec), removed: [slab(3), slab(3)] }))).toBe('canonical');
    });
    it('writers sort removals by their path bytes', () => {
      const a = encodeRecord({ kind: 'edit', base: nodeId(towerRec), removed: [slab(5), slab(3)] });
      const b = encodeRecord({ kind: 'edit', base: nodeId(towerRec), removed: [slab(3), slab(5)] });
      expect(toHex(a)).toBe(toHex(b));
    });
  });
});

describe('§2.8 rules that need context fail when resolved', () => {
  const towerRec = (seed: Uint8Array, patch: Record<string, unknown> = {}) =>
    encodeRecord({ kind: 'tower', seed: nodeId(seed), factor: 10, periods: PERIODS, levels: 3n, ...patch } as Node);
  const plain = towerRec(saltRec);
  const slab = (j: number): Step[] => [{ tag: 'tower', levels: 1n, runs: [[{ digit: j, length: 1n }], [], []] }];
  const resolveRoot = (records: Uint8Array[], id: Uint8Array) => code(() => new Resolver(new MemoryStore(records)).root(id));
  it('an edit whose base is an edit', () => {
    const e1 = encodeRecord({ kind: 'edit', base: nodeId(plain), removed: [slab(1)] });
    const e2 = encodeRecord({ kind: 'edit', base: nodeId(e1), removed: [slab(2)] });
    expect(resolveRoot([saltRec, plain, e1, e2], nodeId(e2))).toBe('validity');
  });
  it('a removal with an atoms step, one that does not resolve, and one containing another', () => {
    const copy: Step = { tag: 'tower', levels: 3n, runs: [[{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] };
    const box = encodeRecord(SALT);
    const atoms = encodeRecord({ kind: 'edit', base: nodeId(plain), removed: [[copy, { tag: 'cells', octants: [0] }, { tag: 'atoms', ranges: [{ start: 0, length: 1 }] }]] });
    const nowhere = encodeRecord({ kind: 'edit', base: nodeId(box), removed: [[{ tag: 'child', index: 0 }]] });
    const nested = encodeRecord({ kind: 'edit', base: nodeId(plain), removed: [slab(1), [{ tag: 'tower', levels: 2n, runs: [[{ digit: 1, length: 1n }], [{ digit: 0, length: 1n }], []] }]] });
    expect([
      resolveRoot([saltRec, plain, atoms], nodeId(atoms)),
      resolveRoot([saltRec, nowhere], nodeId(nowhere)),
      resolveRoot([saltRec, plain, nested], nodeId(nested)),
    ]).toEqual(['validity', 'validity', 'validity']);
  });
  it('a tower seed that is a tower, or an edit of a tower', () => {
    const outer = towerRec(plain);
    const edited = encodeRecord({ kind: 'edit', base: nodeId(plain), removed: [slab(1)] });
    const overEdit = towerRec(edited);
    expect([resolveRoot([saltRec, plain, outer], nodeId(outer)), resolveRoot([saltRec, plain, edited, overEdit], nodeId(overEdit))])
      .toEqual(['validity', 'validity']);
  });
  it('a substitution whose seed is not materializable, or holds too few atoms of fromZ', () => {
    const big = encodeRecord({ ...SALT, cells: [9n, 9n, 9n] } as Node);
    const notMat = towerRec(big, { substitution: { fromZ: 17, toZ: 35, perCopy: 1 } });
    const tooFew = towerRec(saltRec, { substitution: { fromZ: 17, toZ: 35, perCopy: 501 } });
    const none = towerRec(saltRec, { substitution: { fromZ: 6, toZ: 35, perCopy: 1 } });
    expect([
      resolveRoot([big, notMat], nodeId(notMat)),
      resolveRoot([saltRec, tooFew], nodeId(tooFew)),
      resolveRoot([saltRec, none], nodeId(none)),
    ]).toEqual(['validity', 'validity', 'validity']);
  });
  it('a group child of unit exponent above 0 (a tower of 4 levels), but 3 levels pass', () => {
    const four = towerRec(saltRec, { levels: 4n });
    const g4 = encodeRecord({ kind: 'group', children: [{ id: nodeId(four), rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
    const g3 = encodeRecord({ kind: 'group', children: [{ id: nodeId(plain), rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
    const r = new Resolver(new MemoryStore([saltRec, four, plain, g4, g3]));
    expect([code(() => r.count(r.root(nodeId(g4)))), code(() => r.resolve(nodeId(g4), [{ tag: 'child', index: 0 }])), code(() => r.count(r.root(nodeId(g3))))])
      .toEqual(['validity', 'validity', 'accepted']);
  });
  it('record depth above 64, checked lazily', () => {
    const records = [waterRec];
    let top = nodeId(waterRec);
    for (let d = 2; d <= 65; d += 1) {
      const g = encodeRecord({ kind: 'group', children: [{ id: top, rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
      records.push(g);
      top = nodeId(g);
    }
    const r = new Resolver(new MemoryStore(records));
    expect([code(() => r.root(top)), code(() => r.count(r.root(top)))]).toEqual(['accepted', 'limit']);
    const at64 = new Resolver(new MemoryStore(records.slice(0, 64)));
    expect(code(() => at64.count(at64.root(nodeId(records[63]))))).toBe('accepted');
  });
  it('a record not in the store is missing', () => {
    expect(code(() => new Resolver(new MemoryStore([plain])).root(nodeId(plain)))).toBe('missing');
  });
});

describe('§4 paths', () => {
  const tower = (levels: bigint, runs: Array<Array<[number, bigint]>>): Step => ({
    tag: 'tower', levels, runs: runs.map((axis) => axis.map(([digit, length]) => ({ digit, length }))) as never,
  });
  const reject = (hex: string) => code(() => decodePath(Uint8Array.from(hex.match(/../g)!.map((x) => parseInt(x, 16)))));
  it('adjacent cells, tower and atoms steps are not canonical; adjacent child steps are', () => {
    expect([
      reject('0200020100020101'),
      code(() => encodePath([tower(1n, [[[0, 1n]], [], []]), tower(1n, [[], [[0, 1n]], []])])),
      code(() => encodePath([{ tag: 'atoms', ranges: [{ start: 0, length: 1 }] }, { tag: 'atoms', ranges: [{ start: 0, length: 1 }] }])),
      code(() => encodePath([{ tag: 'child', index: 0 }, { tag: 'child', index: 1 }])),
    ]).toEqual(['canonical', 'canonical', 'canonical', 'accepted']);
  });
  it('runs: adjacent equal digits, a zero length, and a tower step of no levels', () => {
    expect([
      code(() => encodePath([tower(2n, [[[1, 1n], [1, 1n]], [], []])])),
      code(() => encodePath([tower(1n, [[[1, 0n]], [], []])])),
      code(() => encodePath([tower(0n, [[], [], []])])),
    ]).toEqual(['canonical', 'canonical', 'canonical']);
  });
  it('ranges: touching, overlapping, past 4,096, empty', () => {
    const atoms = (...ranges: Array<[number, number]>) => code(() => encodePath([{ tag: 'atoms', ranges: ranges.map(([start, length]) => ({ start, length })) }]));
    expect([atoms([0, 2], [2, 1]), atoms([0, 3], [2, 1]), atoms([4095, 2]), atoms([0, 0]), atoms(), atoms([0, 2], [3, 1])])
      .toEqual(['canonical', 'canonical', 'canonical', 'canonical', 'canonical', 'accepted']);
  });
  it('cells: no octants, more than 64, an octant past 7', () => {
    expect([reject('0100020000'), code(() => encodePath([{ tag: 'cells', octants: new Array(65).fill(0) }])), reject('0100020108')])
      .toEqual(['canonical', 'limit', 'range']);
  });
  it('an unknown tag, trailing bytes, and a truncated path', () => {
    expect([reject('010005'), reject('0000ff'), reject('01000100')]).toEqual(['unsupported', 'canonical', 'truncated']);
  });
  it('more than 1,024 steps in a record or reference', () => {
    const steps: Step[] = Array.from({ length: 1025 }, () => ({ tag: 'child', index: 0 }));
    expect([code(() => encodePath(steps)), code(() => encodePath(steps, { unlimited: true }))]).toEqual(['limit', 'accepted']);
  });
  it('canonicalPath merges: octants concatenate, towers add, selections compose', () => {
    const merged = canonicalPath([
      { tag: 'child', index: 2 },
      { tag: 'cells', octants: [1] }, { tag: 'cells', octants: [7, 0] },
      tower(1n, [[[3, 1n]], [], []]), tower(2n, [[], [[3, 1n]], [[4, 1n]]]),
      { tag: 'atoms', ranges: [{ start: 10, length: 5 }, { start: 20, length: 5 }] }, { tag: 'atoms', ranges: [{ start: 3, length: 4 }] },
    ]);
    expect(merged).toEqual([
      { tag: 'child', index: 2 },
      { tag: 'cells', octants: [1, 7, 0] },
      tower(3n, [[[3, 1n]], [[3, 1n]], [[4, 1n]]]),
      { tag: 'atoms', ranges: [{ start: 13, length: 2 }, { start: 20, length: 2 }] },
    ]);
  });
  it('decode and re-encode give the same bytes', () => {
    const steps = canonicalPath([{ tag: 'child', index: 7 }, tower(2n, [[[9, 1n]], [[0, 1n]], []]), { tag: 'atoms', ranges: [{ start: 1, length: 3 }] }]);
    const bytes = encodePath(steps);
    expect(toHex(encodePath(decodePath(bytes)))).toBe(toHex(bytes));
  });

  describe('§4.3 validity while walking', () => {
    const plain = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 3n });
    const group = encodeRecord({ kind: 'group', children: [{ id: saltId, rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
    const one = encodeRecord({ ...SALT, cells: [1n, 1n, 1n] } as Node);
    const r = new Resolver(new MemoryStore([saltRec, plain, group, one]));
    const walk = (id: Uint8Array, steps: Step[]) => code(() => r.resolve(id, steps));
    it('a child index past the count; a step that does not apply', () => {
      expect([walk(nodeId(group), [{ tag: 'child', index: 1 }]), walk(nodeId(group), [{ tag: 'cells', octants: [0] }])]).toEqual(['path', 'path']);
    });
    it('an octant that does not exist', () => {
      expect([walk(nodeId(one), [{ tag: 'cells', octants: [0] }]), walk(saltId, [{ tag: 'cells', octants: [7, 7] }]), walk(saltId, [{ tag: 'cells', octants: [7, 7, 0] }])])
        .toEqual(['path', 'accepted', 'path']);
    });
    it('a tower step deeper than the level, a digit not below f, run lengths that do not sum', () => {
      expect([
        walk(nodeId(plain), [tower(4n, [[[0, 2n]], [[0, 1n]], [[0, 1n]]])]),
        walk(nodeId(plain), [tower(1n, [[[10, 1n]], [], []])]),
        walk(nodeId(plain), [tower(1n, [[], [[0, 1n]], []])]),
        walk(nodeId(plain), [tower(2n, [[], [[1, 1n]], [[2, 1n]]])]),
      ]).toEqual(['path', 'path', 'path', 'accepted']);
    });
    it('an atoms range outside the materialization, and atoms on what is not materializable', () => {
      expect([
        walk(nodeId(one), [{ tag: 'atoms', ranges: [{ start: 0, length: 9 }] }]),
        walk(nodeId(one), [{ tag: 'atoms', ranges: [{ start: 0, length: 8 }] }]),
        walk(nodeId(group), [{ tag: 'atoms', ranges: [{ start: 0, length: 1 }] }]),
      ]).toEqual(['path', 'accepted', 'path']);
    });
  });
});

// ─── §6.6 packs ──────────────────────────────────────────────────────

const PAGE = 16384;
const smallPack = () => writePack([waterRec, saltRec], { roots: [{ name: 'water', id: nodeId(waterRec) }], deps: [new Uint8Array(32).fill(7)] });

/** Recomputes the section CRCs listed, then tableCrc and headerCrc, so one rule is tested at a time. */
function reseal(bytes: Uint8Array, sections: number[] = []): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint32(12, true);
  for (const i of sections) {
    const e = 128 + 32 * i;
    const off = Number(v.getBigUint64(e + 8, true));
    const len = Number(v.getBigUint64(e + 16, true));
    v.setUint32(e + 24, crc32(bytes.subarray(off, off + len)), true);
  }
  v.setUint32(100, crc32(bytes.subarray(128, 128 + 32 * count)), true);
  v.setUint32(124, crc32(bytes.subarray(0, 124)), true);
  return bytes;
}

/** Appends one section of the given type, flags and version after the last. */
function withSection(pack: Uint8Array, type: string, flags: number, version = 1): Uint8Array {
  const v = new DataView(pack.buffer);
  const count = v.getUint32(12, true);
  const out = new Uint8Array(pack.length + PAGE);
  out.set(pack);
  const ov = new DataView(out.buffer);
  const data = Uint8Array.from([1, 2, 3]);
  out.set(data, pack.length);
  const e = 128 + 32 * count;
  out.set([...type].map((c) => c.charCodeAt(0)), e);
  ov.setUint32(e + 4, flags, true);
  ov.setBigUint64(e + 8, BigInt(pack.length), true);
  ov.setBigUint64(e + 16, 3n, true);
  ov.setUint32(e + 24, crc32(data), true);
  ov.setUint16(e + 28, version, true);
  ov.setUint32(12, count + 1, true);
  ov.setBigUint64(24, BigInt(out.length), true);
  return reseal(out);
}

describe('§6.6 packs readers reject', () => {
  const ok = smallPack();
  const mutate = (fn: (b: Uint8Array, v: DataView) => void, sections?: number[]) => {
    const b = ok.slice();
    fn(b, new DataView(b.buffer));
    return code(() => readPack(reseal(b, sections), { verifyAll: true }));
  };
  it('accepts the pack as written, and a versionMinor above 0', () => {
    expect([code(() => readPack(ok, { verifyAll: true })), mutate((_b, v) => v.setUint16(6, 1, true))]).toEqual(['accepted', 'accepted']);
  });
  it('1. header: magic, versionMajor, headerSize, sectionTableOffset, fileLength, sectionCount, reserved, flags', () => {
    expect([
      mutate((b) => { b[3] = 0x4c; }),
      mutate((_b, v) => v.setUint16(4, 2, true)),
      mutate((_b, v) => v.setUint32(8, 64, true)),
      mutate((_b, v) => v.setBigUint64(16, 160n, true)),
      mutate((_b, v) => v.setBigUint64(24, 16384n, true)),
      mutate((_b, v) => v.setUint32(12, 1, true)),
      mutate((_b, v) => v.setUint32(12, 17, true)),
      mutate((b) => { b[70] = 1; }),
      mutate((_b, v) => v.setUint32(96, 1, true)),
      mutate((b) => { b[110] = 1; }),
    ]).toEqual(['pack', 'version', 'pack', 'pack', 'pack', 'pack', 'pack', 'pack', 'pack', 'pack']);
  });
  it('1. a file length that is not a multiple of 16,384, and a headerCrc that does not match', () => {
    const trimmed = ok.slice(0, ok.length - 1);
    const badCrc = ok.slice();
    badCrc[124] ^= 1;
    expect([code(() => readPack(trimmed)), code(() => readPack(badCrc))]).toEqual(['pack', 'crc']);
  });
  it('2. the section table: its CRC, and nonzero bytes after it in the first page', () => {
    const b = ok.slice();
    b[100] ^= 1;
    new DataView(b.buffer).setUint32(124, crc32(b.subarray(0, 124)), true);
    expect([code(() => readPack(b)), mutate((bytes) => { bytes[1000] = 1; })]).toEqual(['crc', 'pack']);
  });
  it('3. sections: alignment, order, extent, padding, CRC, duplicates', () => {
    expect([
      mutate((_b, v) => v.setBigUint64(128 + 8, 16000n, true)),
      mutate((_b, v) => v.setBigUint64(128 + 32 + 8, 16384n, true)),
      mutate((_b, v) => v.setBigUint64(128 + 16, 1n << 20n, true)),
      mutate((b) => { b[PAGE + 2000] = 1; }),
      mutate((b) => { b[PAGE + 9] ^= 1; }),
      mutate((b) => { b.set([0x4e, 0x49, 0x44, 0x58], 128 + 32); }, []),
    ]).toEqual(['pack', 'pack', 'pack', 'pack', 'crc', 'pack']);
  });
  it('3. an unknown section is skipped when optional and rejected when required; so is an unknown sectionVersion', () => {
    expect([
      code(() => readPack(withSection(ok, 'XTRA', 0), { verifyAll: true })),
      code(() => readPack(withSection(ok, 'XTRA', 1))),
      code(() => readPack(withSection(ok, 'XTRA', 0, 7))),
    ]).toEqual(['accepted', 'unsupported', 'accepted']);
    expect(mutate((_b, v) => v.setUint16(128 + 28, 2, true))).toBe('unsupported');
  });
  it('4. NIDX and NREC: present, exact, ascending, packed, kinds that match', () => {
    const nidx = PAGE;
    expect([
      mutate((b, v) => { b.set([0x58], 128); v.setUint32(128 + 4, 0, true); }, []),
      mutate((_b, v) => v.setUint32(nidx, 3, true), [0]),
      mutate((b) => { const a = b.slice(nidx + 8, nidx + 56); b.set(b.subarray(nidx + 56, nidx + 104), nidx + 8); b.set(a, nidx + 56); }, [0]),
      mutate((_b, v) => v.setBigUint64(nidx + 8 + 48 + 32, 60n, true), [0]),
      mutate((b) => { b[nidx + 8 + 44] = 2; }, [0]),
    ]).toEqual(['pack', 'pack', 'pack', 'pack', 'pack']);
  });
  it('5. a record whose SHA-256 is not its NodeID', () => {
    expect(mutate((b) => { b[2 * PAGE + 20] ^= 1; }, [1])).toBe('mismatch');
  });
  it('6. a contentId that does not match', () => {
    expect(mutate((b) => { b[40] ^= 1; })).toBe('mismatch');
  });
  it('7. ROOT and DEPS: names, order, membership', () => {
    const root = 3 * PAGE;
    const deps = 4 * PAGE;
    expect([
      mutate((b) => { b[root + 8 + 34] = 0x57; }, [2]),
      mutate((b) => { b.set(new Uint8Array(32).fill(9), root + 8); }, [2]),
      mutate((_b, v) => v.setUint32(deps, 0, true), [3]),
    ]).toEqual(['pack', 'pack', 'pack']);
  });
  it('writers refuse bad root names and roots missing from the pack', () => {
    expect([
      code(() => writePack([waterRec], { roots: [{ name: 'Water', id: nodeId(waterRec) }] })),
      code(() => writePack([waterRec], { roots: [{ name: 'salt', id: saltId }] })),
    ]).toEqual(['range', 'missing']);
  });
  it('the contentId ignores layout but not roots or dependencies', () => {
    const a = readPack(writePack([saltRec, waterRec], { roots: [{ name: 'water', id: nodeId(waterRec) }] })).contentId;
    const b = readPack(writePack([waterRec, saltRec, waterRec], { roots: [{ name: 'water', id: nodeId(waterRec) }] })).contentId;
    const c = readPack(writePack([waterRec, saltRec], { roots: [{ name: 'h2o', id: nodeId(waterRec) }] })).contentId;
    expect([toHex(a) === toHex(b), toHex(a) === toHex(c)]).toEqual([true, false]);
  });
});

describe('§7 references', () => {
  const store = new MemoryStore([waterRec]);
  const ref = writeRef({ root: nodeId(waterRec), path: [], store });
  const patch = (at: number, values: number[]) => code(() => decodeRef(patched(ref, at, values)));
  it('round-trips through bytes and text', () => {
    expect(toHex(refFromText(refText(ref)))).toBe(toHex(ref));
    expect(toHex(encodeRef(decodeRef(ref)))).toBe(toHex(ref));
  });
  it('rejects a wrong magic, version, flags, reserved byte, and trailing bytes', () => {
    const longer = new Uint8Array(ref.length + 1);
    longer.set(ref);
    expect([patch(0, [0x4d]), patch(3, [2]), patch(4, [3]), patch(7, [1]), code(() => decodeRef(longer))])
      .toEqual(['magic', 'version', 'canonical', 'canonical', 'canonical']);
  });
  it('rejects embedded records that are not strictly ascending', () => {
    const two = encodeRef({ root: saltId, records: [saltRec, waterRec], deps: [], path: [], probe: null });
    const first = 40;
    const len1 = new DataView(two.buffer).getUint32(first, true);
    const a = two.subarray(first, first + 4 + len1);
    const b = two.subarray(first + 4 + len1, two.length - 2);
    const swapped = Uint8Array.from([...two.subarray(0, first), ...b, ...a, ...two.subarray(two.length - 2)]);
    expect(code(() => decodeRef(swapped))).toBe('canonical');
  });
  it('requires the probe exactly when the target is materializable, and equal to it', () => {
    const r = new Resolver(store);
    const probe = r.probe(r.root(nodeId(waterRec)));
    const wrong = probe.slice();
    wrong[0] ^= 1;
    const tower = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: PERIODS, levels: 3n });
    expect([
      code(() => resolveRef(encodeRef({ root: nodeId(waterRec), records: [waterRec], deps: [], path: [], probe: null }))),
      code(() => resolveRef(encodeRef({ root: nodeId(waterRec), records: [waterRec], deps: [], path: [], probe: wrong }))),
      code(() => resolveRef(encodeRef({ root: nodeId(tower), records: [saltRec, tower], deps: [], path: [], probe }))),
      code(() => resolveRef(ref)),
    ]).toEqual(['mismatch', 'mismatch', 'mismatch', 'accepted']);
  });
  it('the text form needs its prefix and canonical base64url', () => {
    expect([code(() => refFromText('lsr2:AAAA')), code(() => refFromText(`${refText(ref)}=`))]).toEqual(['magic', 'canonical']);
  });
  it('the refKey names the piece whatever is embedded', () => {
    const embedded = decodeRef(ref);
    const fetched = decodeRef(encodeRef({ root: nodeId(waterRec), records: [], deps: [new Uint8Array(32)], path: [], probe: embedded.probe }));
    expect(toHex(fetched.key)).toBe(toHex(embedded.key));
  });
  it('a reference past 163,840 bytes falls back to the target leaf when it has at most 4,096 atoms, else fails with limit', () => {
    // A tower whose seed is a group of four full leaves: resolving reads all four (213 KB).
    const leaves = [0, 1, 2, 3].map((k) => encodeRecord({ kind: 'leaf', z: new Uint8Array(4096).fill(6 + k), positions: new Float32Array(3 * 4096) }));
    const group = encodeRecord({ kind: 'group', children: leaves.map((l) => ({ id: nodeId(l), rotation: [0, 0, 0, 1] as [number, number, number, number], translation: [0, 0, 0] as [number, number, number] })) });
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(group), factor: 2, periods: [[65536n, 0n, 0n], [0n, 65536n, 0n], [0n, 0n, 65536n]], levels: 1n });
    const store = new MemoryStore([...leaves, group, tower]);
    const toSeed: Step = { tag: 'tower', levels: 1n, runs: [[{ digit: 0, length: 1n }], [], []] };
    const kept = decodeRef(writeRef({ root: nodeId(tower), path: [toSeed, { tag: 'child', index: 0 }], store }));
    expect([toHex(kept.root), kept.path.length, toHex(kept.probe!)]).toEqual([toHex(nodeId(leaves[0])), 0, toHex(nodeId(leaves[0]))]);
    expect(code(() => writeRef({ root: nodeId(tower), path: [toSeed], store }))).toBe('limit');
  });
});
