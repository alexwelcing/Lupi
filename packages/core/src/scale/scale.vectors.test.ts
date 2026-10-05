/// <reference types="node" />
// Every test vector of docs/ar/scale-spec.md §12, one assertion per row,
// plus the §3, §5.3, §5.5 and §7.2 values the spec states in passing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAtomicNumberBySymbol } from '../elements';
import {
  ASCII,
  crc32,
  decodeRef,
  encodePath,
  encodeRecord,
  encodeRef,
  formatMagnitude,
  formulaText,
  hillFormula,
  levelsAlong,
  magnitude,
  massMicroDa,
  MemoryStore,
  microDaltons,
  nodeId,
  readPack,
  refKey,
  refText,
  resolveRef,
  Resolver,
  ScaleError,
  sha256,
  SplitMix64,
  subMagnitude,
  substitute,
  toHex,
  towerMagnitude,
  addMagnitude,
  canonicalPath,
  writePack,
  writeRef,
  Writer,
  type CrystalNode,
  type Leaf,
  type Step,
  type Vec3n,
  type View,
} from './index';
import { KG_PER_MICRO_DALTON, scientific } from './magnitude';
import { loadMassive1m } from './scale.test-support';

const GALLERY = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/gallery/curated');

/** XYZ rows as the web parser stores them: file order, Number() then Float32. */
function galleryLeaf(file: string): Leaf {
  const lines = readFileSync(join(GALLERY, file), 'utf8').split(/\r?\n/);
  const n = Number(lines[0].trim());
  const z = new Uint8Array(n);
  const positions = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    const [symbol, x, y, w] = lines[2 + i].trim().split(/\s+/);
    z[i] = getAtomicNumberBySymbol(symbol)!;
    positions.set([Number(x), Number(y), Number(w)], 3 * i);
  }
  return { kind: 'leaf', z, positions };
}

const join64 = (text: string) => text.replace(/\s+/g, '');
const hex64 = (v: bigint) => `0x${v.toString(16).padStart(16, '0')}`;
const thrownCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScaleError) return e.code;
    throw e;
  }
  return 'resolved';
};

const SALT: CrystalNode = { kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [5n, 5n, 5n], capZ: 0, capOffset: 0 };
const saltRec = encodeRecord(SALT);
const saltId = nodeId(saltRec);
const A5 = 5n * 4n * 92409n;
const SALT_PERIODS: [Vec3n, Vec3n, Vec3n] = [[A5, 0n, 0n], [0n, A5, 0n], [0n, 0n, A5]];
const BROMIDE = { fromZ: 17, toZ: 35, perCopy: 1 };
const rung = (levels: bigint) => encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels, substitution: BROMIDE });
const GOOGOLPLEX_L = 10n ** 100n - 3n;
const gpRec = rung(GOOGOLPLEX_L);
const gpId = nodeId(gpRec);
const gpResolver = () => new Resolver(new MemoryStore([saltRec, gpRec]));
const C = [0, 1, 2].map((a) => levelsAlong(a, GOOGOLPLEX_L));
const FIRST_COPY: Step = {
  tag: 'tower', levels: GOOGOLPLEX_L,
  runs: [[{ digit: 0, length: C[0] }], [{ digit: 0, length: C[1] }], [{ digit: 0, length: C[2] }]],
};
const GRAIN: Step = {
  tag: 'tower', levels: GOOGOLPLEX_L,
  runs: [
    [{ digit: 5, length: 1n }, { digit: 0, length: C[0] - 1n }],
    [{ digit: 9, length: C[1] }],
    [{ digit: 5, length: 1n }, { digit: 0, length: C[2] - 1n }],
  ],
};
const slab = (j: number): Step => ({ tag: 'tower', levels: 1n, runs: [[{ digit: j, length: 1n }], [], []] });
const capped = (m: number): CrystalNode => ({
  kind: 'crystal', structure: 4, termination: 2, a: 6, b: 0, quarter: 58438,
  cells: [BigInt(m), BigInt(m), BigInt(m)], capZ: 1, capOffset: 41243,
});
const cu = (n: bigint, termination: 0 | 1): CrystalNode => ({
  kind: 'crystal', structure: 3, termination, a: 29, b: 0, quarter: 59228, cells: [n, n, n], capZ: 0, capOffset: 0,
});
const q16 = (leaf: Leaf, count: number) => Array.from({ length: count }, (_, i) =>
  [leaf.z[i], ...Array.from(leaf.positions.subarray(3 * i, 3 * i + 3), (x) => Math.round(x * 65536))]);

describe('§12.1 primitives', () => {
  it('CRC-32 of the ASCII bytes 123456789', () => {
    expect(crc32(ASCII('123456789')).toString(16)).toBe('cbf43926');
  });
  it('SplitMix64, seed 0, first three outputs', () => {
    const g = new SplitMix64(0n);
    expect([g.next(), g.next(), g.next()].map(hex64)).toEqual(['0xe220a8397b1dcdaf', '0x6e789e6aa1b965f4', '0x06c45d188009454f']);
  });
  it('SplitMix64, seed 0x0123456789abcdef, first three outputs', () => {
    const g = new SplitMix64(0x0123456789abcdefn);
    expect([g.next(), g.next(), g.next()].map(hex64)).toEqual(['0x157a3807a48faa9d', '0xd573529b34a1d093', '0x2f90b72e996dccbe']);
  });
  it('BigUInt encodings of 0, 1, 255, 256 and 10^100, concatenated', () => {
    const w = new Writer();
    for (const v of [0n, 1n, 255n, 256n, 10n ** 100n]) w.bigUInt(v);
    expect(toHex(w.finish())).toBe('00000100010100ff020000012a00000000000000000000000000108f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc39425ad4912');
  });
  it('SHA-256 against the FIPS 180-4 examples', () => {
    expect(toHex(sha256(ASCII('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(ASCII('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(toHex(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('§12.2 leaves from gallery files', () => {
  const water = encodeRecord(galleryLeaf('popular/water.xyz'));
  const caffeine = encodeRecord(galleryLeaf('popular/caffeine.xyz'));
  it('water: 3 atoms, 56 bytes, NodeID', () => {
    expect([galleryLeaf('popular/water.xyz').z.length, water.length, toHex(nodeId(water))])
      .toEqual([3, 56, '8985f649ff0866084daa120d8b4a02db7124823d408d32487a63bb870b3a553a']);
  });
  it('caffeine: 24 atoms, 328 bytes, NodeID', () => {
    expect([galleryLeaf('popular/caffeine.xyz').z.length, caffeine.length, toHex(nodeId(caffeine))])
      .toEqual([24, 328, '54c3bbfb50de8c1f7a11af255980822b2be57d1eff18908046ccabee382fcc84']);
  });
  it('the water record in full, and its CRC-32', () => {
    expect([toHex(water), crc32(water).toString(16)]).toEqual([
      join64(`4c55504e010100002c0000000300000008010100000000000000000000000000
              5f078e3e1895643fb840823e3f571b3fea0474bec28637bf`),
      '91dd48b2',
    ]);
  });
});

describe('§12.3 crystals', () => {
  const R = new Resolver(new MemoryStore([saltRec]));
  const seedView = R.root(saltId);
  it('the salt seed record', () => {
    expect(toHex(saltRec)).toBe(join64(`4c55504e030100002800000005000b11f9680100050000000000000005000000
                                        0000000005000000000000000000000000000000`));
  });
  it('the salt seed NodeID and its 1,000 atoms', () => {
    expect([toHex(saltId), formatMagnitude(R.count(seedView))])
      .toEqual(['2ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e', '1,000']);
  });
  it('its materialized leaf (box [0, 5)³)', () => {
    expect(toHex(R.probe(seedView))).toBe('1c017d69dbee61f3a8057626855ca149bec10e10bfbac66014c63871dd8d36e2');
  });
  it('the first nine atoms of that box, (Z, x, y, z) in Q16', () => {
    expect(q16(R.materialize(seedView), 9)).toEqual([
      [11, 0, 0, 0], [11, 0, 184818, 184818], [11, 184818, 0, 184818], [11, 184818, 184818, 0], [17, 184818, 0, 0],
      [17, 0, 184818, 0], [17, 0, 0, 184818], [17, 184818, 184818, 184818], [11, 369636, 0, 0],
    ]);
  });

  const crystalRow = (c: CrystalNode) => {
    const rec = encodeRecord(c);
    const r = new Resolver(new MemoryStore([rec]));
    return [toHex(rec), toHex(nodeId(rec)), formatMagnitude(r.count(r.root(nodeId(rec))))];
  };
  it('Cu FCC, open, 630³ cells (BillionAtomBlock)', () => {
    expect(crystalRow(cu(630n, 0))).toEqual([
      '4c55504e030100002800000003001d005ce700007602000000000000760200000000000076020000000000000000000000000000',
      '42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421', '1,000,188,000']);
  });
  it('Cu FCC, closed, 630³', () => {
    expect(crystalRow(cu(630n, 1))).toEqual([
      '4c55504e030100002800000003011d005ce700007602000000000000760200000000000076020000000000000000000000000000',
      '3d6fb40fa20087ff857d0c2d48dc1801cf55a388c840a8a566306fd7d9942911', '1,002,571,291']);
  });
  it('Cu FCC, open, 63³', () => {
    expect(crystalRow(cu(63n, 0))).toEqual([
      '4c55504e030100002800000003001d005ce700003f000000000000003f000000000000003f000000000000000000000000000000',
      '13bc69957235914287d68a9bed1a136158811dc35db3fbed45cfe415d5867bdf', '1,000,188']);
  });
  it('Cu FCC, closed, 10³', () => {
    expect(crystalRow(cu(10n, 1))).toEqual([
      '4c55504e030100002800000003011d005ce700000a000000000000000a000000000000000a000000000000000000000000000000',
      '5dc6df08fa5c36d6e1f2c39333933582ce2535bdb1b38c6dad2942d9d51601ee', '4,631']);
  });
  it('diamond, closed, 2³ cells: 95 atoms, crystal and leaf NodeIDs', () => {
    const rec = encodeRecord({ kind: 'crystal', structure: 4, termination: 1, a: 6, b: 0, quarter: 58438, cells: [2n, 2n, 2n], capZ: 0, capOffset: 0 });
    const r = new Resolver(new MemoryStore([rec]));
    const v = r.root(nodeId(rec));
    expect([r.materialize(v).z.length, toHex(nodeId(rec)), toHex(r.probe(v))]).toEqual([95,
      '6da1979dc30edc1232a92f59966899f376a2976bd8e8cfb491fb99f315c4804e',
      '9c58417edf7741fbf248f333c14e3aa6859e3c18d101e2191b1a61da220abd77']);
  });
  it("adamantane's record", () => {
    expect(toHex(encodeRecord(capped(1)))).toBe(join64(`4c55504e03010000280000000402060046e40000010000000000000001000000
                                                       000000000100000000000000010000001ba10000`));
  });
  it("adamantane's first six atoms, (Z, x, y, z) in Q16", () => {
    const rec = encodeRecord(capped(1));
    const r = new Resolver(new MemoryStore([rec]));
    expect(q16(r.materialize(r.root(nodeId(rec))), 6)).toEqual([
      [6, 116876, 116876, 0], [1, 158119, 75633, -41243], [1, 75633, 158119, -41243],
      [6, 58438, 58438, 58438], [1, 17195, 17195, 17195], [6, 175314, 175314, 58438],
    ]);
  });

  const DIAMONDOIDS: Array<[number, string, number, string, string]> = [
    [1, 'C10H16', 26, '52c36dc60407419030601a1ec30bddfbafa0867faaaf0699e79cd982129263eb', 'f74c5d0693dd6421a23fb664f7da9ba5af74e2d2cadfd997c63e22cce5fb9502'],
    [2, 'C35H36', 71, '0b45c04d5fd7f2a9e8527a5ade8f7f5dc6723b7756ca082fc261179ec003f45a', '78b0fb8f73a87c45a72354a1438297a28c12af6ce510a2439119b17d7c49bc63'],
    [3, 'C84H64', 148, '7353efe571661aad03ddab352cc8c039172e10b910ca24c5925ff72f202dfcef', '117d3d50457ca5655a76395d968c9fe219fea0474fe7bde6671efe28197f52b8'],
    [4, 'C165H100', 265, '2574a5846d192f258b549e0f0775f509604c8b9c50bb021cf781c7fb457080b9', 'fdfeb39413d49705d0aa9eb31bc99315baeb280cbc57e70f5bcf01c2cd43d380'],
    [5, 'C286H144', 430, '15d49908cb3caa4b80167cb0cd51b54791fb860c2431ad6315d227c2220c6e01', '5c90b6e191e7c9398b6d913932c7c92e3f03f57d41d1555739e4b4ac6615df89'],
    [6, 'C455H196', 651, '17004b5a55c0315069a2ba6de9882ed905e55a2f5fb12abfe989d6ad75e99856', 'd82b7ad03faa34bbff44391d480d23e0b75010c9992da711b698f80b857b3dc6'],
    [7, 'C680H256', 936, 'a0542377bd2af58fe0192486fcd45f7d993913c2b1fec97e0bc03cc484e4d168', 'c8657a51966d01c26b38b38fa87d3d0e034f9d10c1cef5729c853d998efd6692'],
    [8, 'C969H324', 1293, '064114ca4eb32256c75269d15c3fbdd54625247c379af0ab2bcf14c17963123c', 'beb780100b08c5329a7955eb66df0593f979749e5b964dfbf56d1758f55cc01a'],
    [9, 'C1330H400', 1730, '9b61ceda5193bbaef3b248c8d6ac2bafd8115d24231d900eb3efa55b3c8e7b14', '8be36eec9808dcfdf3ee9f21a9e525fc9649ad1567a89363e9aca6807e8b66a8'],
    [10, 'C1771H484', 2255, '3969240b4d7444ba2b6ebaf0e6067e298aab7c2fb87833476594b1c683b9571b', '1a43a4efe3a9a2c40cce5870efccd43b9e225aafb793daa6c276d19e01809c3a'],
    [11, 'C2300H576', 2876, '12b3efdff68034a3d86a30b92d21a42c5915b6f3ca28478aa31b0d8e2f417f77', 'f0c65fb8573710eeca766444799faafc4bab340190da07f77471ca52eb041228'],
    [12, 'C2925H676', 3601, 'f4d037ff369dc1e509ae78c3d922f244f0b41a628aaa1cc64d69c9db731c1778', 'a58f2906169bd197fb51a4b19dae430a3f5a6b304c5880f6ebe7d99e3c8a5acc'],
  ];
  it.each(DIAMONDOIDS)('capped diamondoid m = %i: formula, atoms, crystal and leaf NodeIDs', (m, formula, atoms, crystalId, leafId) => {
    const rec = encodeRecord(capped(m));
    const r = new Resolver(new MemoryStore([rec]));
    const v = r.root(nodeId(rec));
    expect([hillFormula(r.composition(v).unit), r.materialize(v).z.length, toHex(nodeId(rec)), toHex(r.probe(v))])
      .toEqual([formula, atoms, crystalId, leafId]);
  });
  it('§3.3.4: C(2m+3 choose 3) H(2m+2)² for every m', () => {
    const choose3 = (n: number) => (n * (n - 1) * (n - 2)) / 6;
    expect(DIAMONDOIDS.map(([, f]) => f)).toEqual(DIAMONDOIDS.map(([m]) => `C${choose3(2 * m + 3)}H${(2 * m + 2) ** 2}`));
  });
});

describe('§12.4 towers: the salt ladder', () => {
  const LADDER: Array<[string, bigint, number, string, string, string[]]> = [
    ['10³', 0n, 126, '1349a66011dc8c606efe01fb2b56362637560b205c37a0e87040041bc8933eb3', '1,000', ['0', '0', '0']],
    ['10⁶', 3n, 127, 'cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8', '1,000,000', ['1', '1', '1']],
    ['10⁹', 6n, 127, '8244914ffbe1dc2ef6fcc9d3d4dd33c7f904d8c9b06c6f760fa8224dd6244e27', '1,000,000,000', ['2', '2', '2']],
    ['10³⁰', 27n, 127, 'acf0aa4a9271023dff67a256fcfcd5993f767ccf3ded32b0bbd3995765fffc3f', '10^30', ['9', '9', '9']],
    ['10¹⁰⁰', 97n, 127, 'b6ea59ba7442ec18a606dffa157dba6bda89dbad3b27d427b24cef47012c167e', '10^100', ['33', '32', '32']],
    ['googolplex', GOOGOLPLEX_L, 168, 'a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759', '10^(10^100)',
      [(10n ** 100n - 1n) / 3n, (10n ** 100n - 4n) / 3n, (10n ** 100n - 4n) / 3n].map(String)],
  ];
  it.each(LADDER)('rung %s: levels, record bytes, NodeID, count, seed copies per axis', (_name, levels, bytes, id, count, perAxis) => {
    const rec = rung(levels);
    const r = new Resolver(new MemoryStore([saltRec, rec]));
    expect([rec.length, toHex(nodeId(rec)), formatMagnitude(r.count(r.root(nodeId(rec)))), [0, 1, 2].map((a) => String(levelsAlong(a, levels)))])
      .toEqual([bytes, id, count, perAxis]);
  });
  it('the googolplex record in full', () => {
    expect(toHex(gpRec)).toBe(join64(`4c55504e040100009c0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be1
      3f9b330d0017f1c9561e3f3e0a01000074331c00000000000000000000000000
      0000000000000000000000000000000074331c00000000000000000000000000
      0000000000000000000000000000000074331c00000000002a00fdffffffffff
      ffffffffffff0f8f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc394
      25ad491211230100`));
  });
  it('the 10³ rung is its own seed copy: copy key, Br at atom 836, probe', () => {
    const rec = rung(0n);
    const r = new Resolver(new MemoryStore([saltRec, rec]));
    const v = r.root(nodeId(rec));
    expect(v.type === 'copy' && [hex64(v.key), substitute(r.materialize(r.root(saltId)).z, BROMIDE, v.key).chosen, toHex(r.probe(v))])
      .toEqual(['0x5a39d7642495b059', [836], 'c5e72c9b3e1f4e05ade222824419e94114144d25015da1398e2f8ef437f2bfb8']);
  });
  it('the first copy of the googolplex: path, copy key, Br at atom 764, probe', () => {
    const r = gpResolver();
    const v = r.resolve(gpId, [FIRST_COPY]);
    expect(v.type === 'copy' && [toHex(encodePath([FIRST_COPY])), hex64(v.key), substitute(r.materialize(r.root(saltId)).z, BROMIDE, v.key).chosen, toHex(r.probe(v))])
      .toEqual([join64(`0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
        f30bcec484270beb7cc39425ad49120100002a00555555555555555555555555
        05850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f18060100
        002a0054555555555555555555555505850f385816e638d4080bda6aefd8fb03
        9a412c0d594ed4eb860c8f18060100002a005455555555555555555555550585
        0f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f1806`),
      '0xd2821aef089f3b51', [764], 'a4b81f1ada35de728dc1bc0e662d22e58d43c281bbc27e1662279dd639c30663']);
  });
  it("the grain's path", () => {
    expect(toHex(encodePath([GRAIN]))).toBe(join64(`0100032a00fdffffffffffffffffffffff0f8f2ea80843b2aa7c1a218e40ce8a
      f30bcec484270beb7cc39425ad4912020005010001002a005455555555555555
      5555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb860c8f
      18060100092a0054555555555555555555555505850f385816e638d4080bda6a
      efd8fb039a412c0d594ed4eb860c8f1806020005010001002a00535555555555
      55555555555505850f385816e638d4080bda6aefd8fb039a412c0d594ed4eb86
      0c8f1806`));
  });
  it('the grain: copy key, first SplitMix64 output, Br at atom 639', () => {
    const r = gpResolver();
    const v = r.resolve(gpId, [GRAIN]);
    expect(v.type === 'copy' && [hex64(v.key), hex64(new SplitMix64(v.key).next()), substitute(r.materialize(r.root(saltId)).z, BROMIDE, v.key).chosen])
      .toEqual(['0x9df8af3f7edb268e', '0xe7ad625697864313', [639]]);
  });
  it('the grain: probe and count', () => {
    const r = gpResolver();
    const v = r.resolve(gpId, [GRAIN]);
    expect([toHex(r.probe(v)), formatMagnitude(r.count(v))]).toEqual(['449611ace7889516d11722ee8da078a5e4b697c89e4ef7854dd9118497df80ad', '1,000']);
  });
  it("the grain's lupi.scale-ref.v1: 496 bytes, refKey and text form", () => {
    const ref = writeRef({ root: gpId, path: [GRAIN], store: new MemoryStore([saltRec, gpRec]) });
    expect([ref.length, toHex(refKey(gpId, encodePath([GRAIN]))), refText(ref)]).toEqual([496,
      'ebfdf60d1a694e092141c1c6d2838e2af7e7194f711e66855110a0186ce7ad1d',
      join64(`lsr1:TFNSAQECAAChDiEDYilwBFAS61MIQ75O8KCAscIeUmXilMtEDD5XWTQAAABMVVBOAwEAACg
        AAAAFAAsR-WgBAAUAAAAAAAAABQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAqAAAAExVUE4EAQAAnAA
        AAC74UC_NIuSwmMV-hcC9G2eT_4vhP5szDQAX8clWHj8-CgEAAHQzHAAAAAAAAAAAAAAAAAAAAAA
        AAAAAAAAAAAAAAAAAdDMcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0MxwAAAAAACoA_f_
        _____________D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSESMBAAEAAyoA_f_________
        _____D48uqAhDsqp8GiGOQM6K8wvOxIQnC-t8w5QlrUkSAgAFAQABACoAVFVVVVVVVVVVVVVVBYU
        POFgW5jjUCAvaau_Y-wOaQSwNWU7U64YMjxgGAQAJKgBUVVVVVVVVVVVVVVUFhQ84WBbmONQIC9p
        q79j7A5pBLA1ZTtTrhgyPGAYCAAUBAAEAKgBTVVVVVVVVVVVVVVUFhQ84WBbmONQIC9pq79j7A5p
        BLA1ZTtTrhgyPGAZElhGs54iVFtEXIu6NoHil5LaXyJ5O94VN2RGEl9-ArQ`)]);
  });
  it('a fragment of the grain, atoms [0, 8): elements and probe', () => {
    const r = gpResolver();
    const v = r.resolve(gpId, canonicalPath([GRAIN, { tag: 'atoms', ranges: [{ start: 0, length: 8 }] }]));
    expect([Array.from(r.materialize(v).z), toHex(r.probe(v))])
      .toEqual([[11, 11, 11, 11, 17, 17, 17, 17], '5d6b6718370227172746f478c065f25bc74c708d9c4a61257a5c42ee18f3d3ce']);
  });
  it('child 3 of the root: path, count, a cube, not materializable', () => {
    const r = gpResolver();
    const v = r.resolve(gpId, [slab(3)]);
    const extents = v.type === 'level' ? [0, 1, 2].map((a) => levelsAlong(a, v.k)) : [];
    expect([toHex(encodePath([slab(3)])), formatMagnitude(r.count(v)), extents[0] === extents[1] && extents[1] === extents[2], r.isMaterializable(v)])
      .toEqual(['01000301000101000301000100000000', '10^(10^100 − 1)', true, false]);
  });
  it('the googolplex with child 9 removed: edit record, NodeID, count', () => {
    const ed = encodeRecord({ kind: 'edit', base: gpId, removed: [[slab(9)]] });
    const r = new Resolver(new MemoryStore([saltRec, gpRec, ed]));
    expect([toHex(ed), toHex(nodeId(ed)), formatMagnitude(r.count(r.root(nodeId(ed))))]).toEqual([
      '4c55504e0501000038000000a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759010000001000000001000301000101000901000100000000',
      '825d98342ecdde760707b430acd8229a6eb7480fcaf5f0b2b4311bde4864e907', '9 × 10^(10^100 − 1)']);
  });
  it('with child 9 and the grain removed: NodeID, count, and the grain no longer resolves', () => {
    const ed = encodeRecord({ kind: 'edit', base: gpId, removed: [[slab(9)], [GRAIN]] });
    const r = new Resolver(new MemoryStore([saltRec, gpRec, ed]));
    const v = r.root(nodeId(ed));
    expect([toHex(nodeId(ed)), formatMagnitude(r.count(v)), thrownCode(() => r.walk(v, [GRAIN]))])
      .toEqual(['29beccfd91e84c70e305e6f1743c57d7b7c5bac0b21354ddbd7b3d44d265a254', '9 × 10^(10^100 − 1) − 1,000', 'path']);
  });
});

describe('§12.4 composition and mass', () => {
  it('googolplex: formula, formula text, mass', () => {
    const r = gpResolver();
    const c = r.composition(r.root(gpId));
    expect([hillFormula(c.unit), formulaText(c), formatMagnitude(massMicroDa(c))])
      .toEqual(['BrCl499Na500', 'BrCl499Na500 × 10^(10^100 − 3)', '2.9264454 × 10^(10^100 + 7)']);
  });
  it('the googolplex with child 9 and the grain removed: formula text', () => {
    const ed = encodeRecord({ kind: 'edit', base: gpId, removed: [[slab(9)], [GRAIN]] });
    const r = new Resolver(new MemoryStore([saltRec, gpRec, ed]));
    expect(formulaText(r.composition(r.root(nodeId(ed))))).toBe('BrCl499Na500 × (9 × 10^(10^100 − 4) − 1)');
  });
  it('caffeine leaf: formula and mass', () => {
    const rec = encodeRecord(galleryLeaf('popular/caffeine.xyz'));
    const r = new Resolver(new MemoryStore([rec]));
    const c = r.composition(r.root(nodeId(rec)));
    expect([hillFormula(c.unit), formulaText(c), formatMagnitude(massMicroDa(c))]).toEqual(['C8H10N4O2', 'C8H10N4O2', '194,194,000']);
  });
  it('µDa of S, Zn and Xe', () => {
    expect([16, 30, 54].map((z) => microDaltons(z))).toEqual([32060000n, 65380000n, 131290000n]);
  });
});

describe('§12.4 a removal inside a seed copy', () => {
  const plain = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels: 3n });
  const copy0: Step = { tag: 'tower', levels: 3n, runs: [[{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] };
  const removal: Step[] = [copy0, { tag: 'cells', octants: [0] }];
  const ed = encodeRecord({ kind: 'edit', base: nodeId(plain), removed: [removal] });
  const r = new Resolver(new MemoryStore([saltRec, plain, ed]));
  const v = r.root(nodeId(ed));
  it('the tower record and NodeID', () => {
    expect([toHex(plain), toHex(nodeId(plain))]).toEqual([
      '4c55504e040100006f0000002ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e0a00000074331c000000000000000000000000000000000000000000000000000000000074331c000000000000000000000000000000000000000000000000000000000074331c0000000000010003',
      '31e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27']);
  });
  it('the removal path', () => {
    expect(toHex(encodePath(removal))).toBe('020003010003010000010001010000010001010000010001020100');
  });
  it('the edit record and NodeID', () => {
    expect([toHex(ed), toHex(nodeId(ed))]).toEqual([
      '4c55504e050100004300000031e0ec4ca049b549f939cd0b170459cdca96f41a466824aec7eb58c53400ee27010000001b000000020003010003010000010001010000010001010000010001020100',
      'ee3b568af6b6583687b1efe9e65f7e472541e052eb03ec54935a56becfb6c4d2']);
  });
  it('count, formula, formula text, mass', () => {
    const c = r.composition(v);
    expect([formatMagnitude(r.count(v)), hillFormula(c.unit), formulaText(c), formatMagnitude(massMicroDa(c))])
      .toEqual(['999,784', 'Cl500Na500', 'Cl500Na500 × 1,000 − Cl108Na108', '29,213,688,480,000']);
  });
  it('copy (0, 0, 0) resolves with 784 atoms and its probe', () => {
    const c0 = r.walk(v, [copy0]);
    expect([formatMagnitude(r.count(c0)), r.materialize(c0).z.length, toHex(r.probe(c0))])
      .toEqual(['784', 784, 'e5d83bf7fcf5686f3ec7b398323feab9c4a43de3f89ac91b6909d3a6f4117fa5']);
  });
  it('its octant 1 resolves with 144 atoms; octant 0 and below fail with path', () => {
    const c0 = r.walk(v, [copy0]);
    expect([
      formatMagnitude(r.count(r.walk(c0, [{ tag: 'cells', octants: [1] }]))),
      thrownCode(() => r.walk(c0, [{ tag: 'cells', octants: [0] }])),
      thrownCode(() => r.walk(c0, [{ tag: 'cells', octants: [0, 7] }])),
    ]).toEqual(['144', 'path', 'path']);
  });
});

describe('§12.4 a tower of towers', () => {
  const million = rung(3n);
  const p10 = SALT_PERIODS.map((p) => p.map((x) => 10n * x)) as [Vec3n, Vec3n, Vec3n];
  const group = encodeRecord({ kind: 'group', children: [{ id: nodeId(million), rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
  const outer = encodeRecord({ kind: 'tower', seed: nodeId(group), factor: 2, periods: p10, levels: 1n });
  const r = new Resolver(new MemoryStore([saltRec, million, group, outer]));
  const into = (digit: number): Step[] => canonicalPath([
    { tag: 'tower', levels: 1n, runs: [[{ digit, length: 1n }], [], []] },
    { tag: 'child', index: 0 },
    { tag: 'tower', levels: 3n, runs: [[{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] },
  ]);
  it('a tower whose seed is the 10⁶ rung is rejected with validity', () => {
    const bad = encodeRecord({ kind: 'tower', seed: nodeId(million), factor: 2, periods: p10, levels: 1n });
    expect(thrownCode(() => new Resolver(new MemoryStore([saltRec, million, bad])).root(nodeId(bad)))).toBe('validity');
  });
  it('the one-child group record and NodeID', () => {
    expect([toHex(group), toHex(nodeId(group))]).toEqual([
      '4c55504e020100005c00000001000000cd481a1353e063838be8fc0c55f420b977465a8f1db3e959460aaa34ac4b8df8000000000000000000000000000000000000000000000000000000000000f03f000000000000000000000000000000000000000000000000',
      'bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa']);
  });
  it('the outer tower: record, NodeID, count', () => {
    expect([toHex(outer), toHex(nodeId(outer)), formatMagnitude(r.count(r.root(nodeId(outer))))]).toEqual([
      '4c55504e040100006f000000bdd05a247b85878be2d11bbd16470d62cdc722d182ec124f76aa212e898d0cfa0200000088021a010000000000000000000000000000000000000000000000000000000088021a010000000000000000000000000000000000000000000000000000000088021a0100000000010001',
      '6bff9b557dcb5058dcb4126f001f7415a617e43e3bf31e3922c6adeea4d3bfa6', '2,000,000']);
  });
  it('the path tower, child 0, tower, and its seed copy probe in both outer copies', () => {
    const probes = [0, 1].map((d) => toHex(r.probe(r.resolve(nodeId(outer), into(d)))));
    expect([toHex(encodePath(into(1))), r.resolve(nodeId(outer), into(1)).type, probes]).toEqual([
      '0300030100010100010100010000000001000003010003010000010001010000010001010000010001', 'copy',
      ['7e800b0105dba71bf11d993caf7b8a7c44c922cbe44ebfd766c57626118d7202', '7e800b0105dba71bf11d993caf7b8a7c44c922cbe44ebfd766c57626118d7202']]);
  });
});

describe('§12.4 Grow ×2', () => {
  const water = galleryLeaf('popular/water.xyz');
  const waterRec = encodeRecord(water);
  /** §10.7: per axis, max ⌈x · 65536⌉ − min ⌊x · 65536⌋ + 150,733 Q16 (exact on Float32). */
  const growPeriods = (leaf: Leaf): bigint[] => [0, 1, 2].map((a) => {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < leaf.z.length; i += 1) {
      const x = leaf.positions[3 * i + a] * 65536;
      hi = Math.max(hi, Math.ceil(x));
      lo = Math.min(lo, Math.floor(x));
    }
    return BigInt(hi - lo + 150733);
  });
  const grown = (levels: bigint) => {
    const p = growPeriods(water);
    return encodeRecord({ kind: 'tower', seed: nodeId(waterRec), factor: 2, periods: [[p[0], 0n, 0n], [0n, p[1], 0n], [0n, 0n, p[2]]], levels });
  };
  it('the periods', () => {
    expect(growPeriods(water)).toEqual([190501n, 224869n, 214389n]);
  });
  it('levels 100: 123-byte record, NodeID, count 3 × 2^100', () => {
    const rec = grown(100n);
    const r = new Resolver(new MemoryStore([waterRec, rec]));
    expect([rec.length, toHex(nodeId(rec)), formatMagnitude(r.count(r.root(nodeId(rec))))])
      .toEqual([123, '56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac', '3 × 2^100']);
  });
  it('levels 1 (the first tap): NodeID', () => {
    expect(toHex(nodeId(grown(1n)))).toBe('9a0d1fadcc862005945fb3a802e644fcb96ab88b7beccd45de8d2bb7889f8ddf');
  });
});

describe('§12.5 formatting', () => {
  const gp = towerMagnitude(1000n, 10, GOOGOLPLEX_L);
  const tenth = towerMagnitude(1000n, 10, GOOGOLPLEX_L - 1n);
  const ROWS: Array<[string, () => ReturnType<typeof magnitude>, string]> = [
    ['953312', () => magnitude(953312), '953,312'],
    ['1000188000', () => magnitude(1000188000), '1,000,188,000'],
    ['10^15', () => magnitude(10n ** 15n), '10^15'],
    ['1234567890123456789', () => magnitude(1234567890123456789n), '1,234,567,890,123,456,789'],
    ['1000188 × 10^15', () => magnitude(1000188n * 10n ** 15n), '1.000188 × 10^21'],
    ['1234567890123456789012345', () => magnitude(1234567890123456789012345n), '≈ 1.235 × 10^24'],
    ['25 × 10^30 + 7', () => magnitude(25n * 10n ** 30n + 7n), '2.5 × 10^31 + 7'],
    ['googol', () => magnitude(10n ** 100n), '10^100'],
    ['googol − 1', () => magnitude(10n ** 100n - 1n), '10^100 − 1'],
    ['googolplex', () => gp, '10^(10^100)'],
    ['googolplex ÷ 10', () => tenth, '10^(10^100 − 1)'],
    ['googolplex − googolplex ÷ 10', () => subMagnitude(gp, tenth), '9 × 10^(10^100 − 1)'],
    ['googolplex − 1000', () => subMagnitude(gp, magnitude(1000)), '10^(10^100) − 1,000'],
    ['googolplex + 5', () => addMagnitude(gp, magnitude(5)), '10^(10^100) + 5'],
    ['3 × 2^100', () => towerMagnitude(3n, 2, 100n), '3 × 2^100'],
    ['3 × 2^70000', () => towerMagnitude(3n, 2, 70000n), '3 × 2^70000'],
    ['24 × 16^40', () => towerMagnitude(24n, 16, 40n), '24 × 16^40'],
  ];
  it.each(ROWS)('%s', (_name, value, text) => {
    expect(formatMagnitude(value())).toBe(text);
  });
});

describe('§12.6 packs', () => {
  const water = encodeRecord(galleryLeaf('popular/water.xyz'));
  const small = writePack([water, saltRec, gpRec], { roots: [{ name: 'water', id: nodeId(water) }, { name: 'salt-googolplex', id: gpId }] });
  it('the small pack: length, contentId, header CRC, file SHA-256', () => {
    const p = readPack(small, { verifyAll: true });
    expect([small.length, toHex(p.contentId), new DataView(small.buffer).getUint32(124, true).toString(16), toHex(sha256(small))])
      .toEqual([65536, 'a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256', 'ac22309b', '64235b518944425f713f018008f94171525328d7627e00865cff8a5d9442c2a8']);
  });
  it('the small pack: its section table', () => {
    expect(readPack(small).sections.map((s) => [s.type, s.offset, s.length, s.crc.toString(16).padStart(8, '0')])).toEqual([
      ['NIDX', 16384, 152, '1acbd66a'], ['NREC', 32768, 280, 'b01bfc5e'], ['ROOT', 49152, 100, 'dde7474c']]);
  });
  it('the small pack: header (128 bytes) and section table bytes', () => {
    expect(toHex(small.subarray(0, 128 + 96))).toBe(join64(`
      4c55504b01000000800000000300000080000000000000000000010000000000
      a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256
      0000000000000000000000000000000000000000000000000000000000000000
      000000009fae118f00000000000000000000000000000000000000009b3022ac
      4e49445801000000004000000000000098000000000000006ad6cb1a01000000
      4e52454301000000008000000000000018010000000000005efc1bb001000000
      524f4f540100000000c000000000000064000000000000004c47e7dd01000000`));
  });
  it('the bundled scale pack lupi-scale-r1.lpk: 20 roots, 21 records, length, contentId, file SHA-256', () => {
    const names = ['thousand', 'million', 'billion', 'e30', 'googol', 'googolplex'];
    const records = [saltRec];
    const roots = [0n, 3n, 6n, 27n, 97n, GOOGOLPLEX_L].map((L, i) => {
      records.push(rung(L));
      return { name: `salt-${names[i]}`, id: nodeId(rung(L)) };
    });
    records.push(encodeRecord(cu(630n, 0)), encodeRecord(cu(630n, 1)));
    roots.push({ name: 'copper-billion', id: nodeId(encodeRecord(cu(630n, 0))) }, { name: 'copper-billion-closed', id: nodeId(encodeRecord(cu(630n, 1))) });
    for (let m = 1; m <= 12; m += 1) {
      records.push(encodeRecord(capped(m)));
      roots.push({ name: `diamondoid-${m}`, id: nodeId(encodeRecord(capped(m))) });
    }
    const file = writePack(records, { roots });
    const p = readPack(file, { verifyAll: true });
    expect([p.roots.length, p.ids.length, file.length, toHex(p.contentId), toHex(sha256(file))]).toEqual([20, 21, 65536,
      '4ec7833bd79b74af882a100e2ef121fa928a01c02dcc5dc66e2282a127377e97', 'd5f1d7ba69da089b970e7f1cdfe1f6e530c17d006c268ceee4bad0cd795a2794']);
  });
});

describe('§12.6 massive_1m.glimbin through lupi.bake.partition@1', () => {
  it('953,312 Cu atoms → 233 leaves (the last 3,040) and 35 groups, depth 4, root', async () => {
    const m = await loadMassive1m();
    const lastLeaf = m.part.records[m.part.leaves - 1];
    expect([m.z.length, m.part.leaves, new DataView(lastLeaf.buffer).getUint32(12, true), m.part.groups, m.part.depth, toHex(m.part.root)])
      .toEqual([953312, 233, 3040, 35, 4, '08588107c1be69ef9816bb4226c25e65b2dae3d2da2edf3fb9420fff76664cca']);
  });
  it('its pack (root massive_1m): length, contentId, file SHA-256, and the resolver counts 953,312', async () => {
    const m = await loadMassive1m();
    const p = readPack(m.pack);
    const r = new Resolver(p);
    expect([m.pack.length, toHex(p.contentId), toHex(sha256(m.pack)), formatMagnitude(r.count(r.root(p.rootId('massive_1m'))))]).toEqual([
      12484608, 'c760f77ae2225153e842d6f1dd164fe6470de5741a75f2bd9e0603f92b307f08',
      'b12f3e7a79ac58774e4b79b0066b08f91f79a669816c672d3748b978177e9b85', '953,312']);
  });
  it('keeping its first leaf: 55,171 bytes embedding the leaf and three groups, 73,567 characters, resolving with no pack', async () => {
    const m = await loadMassive1m();
    const p = readPack(m.pack);
    const path: Step[] = [{ tag: 'child', index: 0 }, { tag: 'child', index: 0 }, { tag: 'child', index: 0 }];
    const ref = writeRef({ root: m.part.root, path, store: p });
    const sizes = decodeRef(ref).records.map((r) => r.length).sort((a, b) => a - b);
    expect([ref.length, sizes, refText(ref).length, formatMagnitude(resolveRef(ref).count)]).toEqual([55171, [368, 720, 720, 53264], 73567, '4,096']);
  });
  it('by dependency alone it would be 115 bytes', async () => {
    const m = await loadMassive1m();
    const p = readPack(m.pack);
    const path: Step[] = [{ tag: 'child', index: 0 }, { tag: 'child', index: 0 }, { tag: 'child', index: 0 }];
    const probe = decodeRef(writeRef({ root: m.part.root, path, store: p })).probe;
    expect(encodeRef({ root: m.part.root, records: [], deps: [p.contentId], path, probe }).length).toBe(115);
  });
});

describe('values stated in §3, §5 and §7', () => {
  it('§3.3.4: C–C 1.5445 Å and C–H 1.0900 Å; every carbon has two carbon neighbours; H–H at least 1.78 Å', () => {
    const results = [1, 2, 3, 6].map((m) => {
      const rec = encodeRecord(capped(m));
      const rr = new Resolver(new MemoryStore([rec]));
      const leaf = rr.materialize(rr.root(nodeId(rec)));
      const d = (i: number, j: number) => Math.hypot(...[0, 1, 2].map((a) => leaf.positions[3 * i + a] - leaf.positions[3 * j + a]));
      let minHH = Infinity;
      let fewestCarbon = Infinity;
      const lengths = new Set<string>();
      for (let i = 0; i < leaf.z.length; i += 1) {
        let carbons = 0;
        for (let j = 0; j < leaf.z.length; j += 1) {
          if (i === j) continue;
          const dij = d(i, j);
          if (leaf.z[i] === 1 && leaf.z[j] === 1) minHH = Math.min(minHH, dij);
          if (dij < 1.7 && leaf.z[i] + leaf.z[j] >= 7) lengths.add(dij.toFixed(4));
          if (leaf.z[i] === 6 && leaf.z[j] === 6 && dij < 1.7) carbons += 1;
        }
        if (leaf.z[i] === 6) fewestCarbon = Math.min(fewestCarbon, carbons);
      }
      return [Number(minHH.toFixed(2)) >= 1.78, fewestCarbon >= 2, [...lengths].sort()];
    });
    expect(results.every(([hh, cc, lengths]) => hh && cc && JSON.stringify(lengths) === JSON.stringify(['1.0900', '1.5445']))).toBe(true);
  });
  it('§5.5: the googolplex weighs ≈ 4.859 × 10^(10^100 − 26) kg', () => {
    const r = gpResolver();
    expect(scientific(massMicroDa(r.composition(r.root(gpId))), KG_PER_MICRO_DALTON)).toBe('≈ 4.859 × 10^(10^100 − 26)');
  });
  it('§5.5: a water tower of levels 70,000 weighs ≈ 1.157 × 2^69915 kg', () => {
    const waterRec = encodeRecord(galleryLeaf('popular/water.xyz'));
    const tower = encodeRecord({ kind: 'tower', seed: nodeId(waterRec), factor: 2, periods: [[190501n, 0n, 0n], [0n, 224869n, 0n], [0n, 0n, 214389n]], levels: 70000n });
    const r = new Resolver(new MemoryStore([waterRec, tower]));
    const v = r.root(nodeId(tower));
    expect([formatMagnitude(r.count(v)), scientific(massMicroDa(r.composition(v)), KG_PER_MICRO_DALTON)]).toEqual(['3 × 2^70000', '≈ 1.157 × 2^69915']);
  });
  it('§7.2 typical sizes: caffeine 406 bytes, the salt rung 10³ 260 bytes', () => {
    const caffeine = encodeRecord(galleryLeaf('popular/caffeine.xyz'));
    const thousand = rung(0n);
    expect([
      writeRef({ root: nodeId(caffeine), path: [], store: new MemoryStore([caffeine]) }).length,
      writeRef({ root: nodeId(thousand), path: [], store: new MemoryStore([saltRec, thousand]) }).length,
    ]).toEqual([406, 260]);
  });
  it('§2.2: a 4,096-atom leaf is 53,264 bytes', () => {
    const leaf = { kind: 'leaf' as const, z: new Uint8Array(4096).fill(6), positions: new Float32Array(3 * 4096) };
    expect(encodeRecord(leaf).length).toBe(53264);
  });
  it('§3.4.7: the googolplex is BrCl499Na500 × 10^(10^100 − 3), its root a 10 : 1 : 1 bar', () => {
    const r = gpResolver();
    const v = r.root(gpId) as Extract<View, { type: 'level' }>;
    const perAxis = [0, 1, 2].map((a) => levelsAlong(a, v.k));
    expect([formatMagnitude(r.composition(v).copies), perAxis[0] - perAxis[1], perAxis[1] === perAxis[2]]).toEqual(['10^(10^100 − 3)', 1n, true]);
  });
});
