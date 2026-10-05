#!/usr/bin/env -S npx tsx
/**
 * write-scale-fixtures.mts — the golden fixtures of LupiScale v1.
 *
 * The TypeScript reference (packages/core/src/scale) computes every value of
 * docs/ar/scale-spec.md §12 and the intermediates the Swift implementation
 * (apps/apple/LupiScale) asserts byte for byte: records and NodeIDs, paths,
 * resolutions with counts, compositions, probes and copy keys, small
 * materialized leaves, formatting rows, packs, references and their text,
 * the partition bake, and inputs every reader must reject. It refuses to
 * write unless the §12 anchors reproduce.
 *
 *   pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts
 *   pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts --check   # exit 1 when stale
 *
 * tools/apple/export-scale-fixtures.mts copies the result to
 * apps/apple/LupiScale/Tests/Fixtures/scale-v1.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrameData, parseFrameIndex, parseHeader } from '../src/glimbin';
import { parseXyzText } from '../../parsers/src/xyzParser';
import { decompressGlimbinFrame } from '../../parsers/src/decompressGlimbinFrame';
import {
  addMagnitude,
  bakePartition,
  compareMagnitude,
  canonicalPath,
  crc32,
  decodePath,
  decodeRecord,
  decodeRef,
  encodePath,
  encodeRecord,
  encodeRef,
  formatMagnitude,
  formulaText,
  fromHex,
  hillFormula,
  levelsAlong,
  lnlnMagnitude,
  lnMagnitude,
  magnitude,
  magnitudeKey,
  massMicroDa,
  MemoryStore,
  MICRO_DA_V1,
  mix64,
  nodeId,
  readPack,
  refFromText,
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
  writePack,
  writeRef,
  Writer,
  type CrystalNode,
  type Leaf,
  type Magnitude,
  type Node,
  type NodeStore,
  type Step,
  type Vec3n,
  type View,
} from '../src/scale/index';
import { KG_PER_MICRO_DALTON, scientific } from '../src/scale/magnitude';
import { packContentId } from '../src/scale/pack';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'packages/core/src/scale/__fixtures__/scale-v1.json');
const GALLERY = 'apps/web/public/gallery/curated';
const MASSIVE = 'apps/web/public/gallery/trajectories/massive_1m.glimbin';
/** Materialized leaves up to this many atoms are written out in full. */
const LEAF_HEX_MAX = 1000;

// ─── JSON forms ───────────────────────────────────────────────────────

const big = (v: bigint) => v.toString();
const f32Hex = (positions: Float32Array) => toHex(new Uint8Array(positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.byteLength)));

function stepJson(s: Step): unknown {
  switch (s.tag) {
    case 'child':
      return { tag: 'child', index: s.index };
    case 'cells':
      return { tag: 'cells', octants: s.octants };
    case 'tower':
      return { tag: 'tower', levels: big(s.levels), runs: s.runs.map((axis) => axis.map((r) => [r.digit, big(r.length)])) };
    case 'atoms':
      return { tag: 'atoms', ranges: s.ranges.map((r) => [r.start, r.length]) };
  }
}

const pathJson = (steps: Step[]) => ({ hex: toHex(encodePath(steps, { unlimited: true })), steps: steps.map(stepJson) });

function nodeJson(n: Node): unknown {
  switch (n.kind) {
    case 'leaf':
      return { kind: 'leaf', z: Array.from(n.z), positionsF32Hex: f32Hex(n.positions) };
    case 'group':
      return { kind: 'group', children: n.children.map((c) => ({ id: toHex(c.id), rotation: c.rotation, translation: c.translation })) };
    case 'crystal':
      return {
        kind: 'crystal', structure: n.structure, termination: n.termination, a: n.a, b: n.b, quarter: n.quarter,
        cells: n.cells.map(big), capZ: n.capZ, capOffset: n.capOffset,
      };
    case 'tower':
      return {
        kind: 'tower', seed: toHex(n.seed), factor: n.factor, periods: n.periods.map((p) => p.map(big)), levels: big(n.levels),
        substitution: n.substitution ?? null,
      };
    case 'edit':
      return { kind: 'edit', base: toHex(n.base), removed: n.removed.map(pathJson) };
  }
}

function magJson(m: Magnitude) {
  return { text: formatMagnitude(m), key: magnitudeKey(m), displayBase: m.displayBase };
}

const countsJson = (counts: Map<number, bigint>) =>
  Object.fromEntries([...counts].sort((a, b) => a[0] - b[0]).map(([z, n]) => [String(z), big(n)]));

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ScaleError) return e.code;
    throw e;
  }
}

// ─── Records ──────────────────────────────────────────────────────────

const records = new Map<string, { name: string; bytes: Uint8Array }>();
function record(name: string, node: Node): Uint8Array {
  const bytes = encodeRecord(node);
  const id = toHex(nodeId(bytes));
  if (!records.has(id)) records.set(id, { name, bytes });
  return bytes;
}
const allRecords = () => new MemoryStore([...records.values()].map((r) => r.bytes));

function galleryLeaf(file: string): { leaf: Leaf; xyz: string } {
  const xyz = fs.readFileSync(path.join(ROOT, GALLERY, file), 'utf8');
  const frame = parseXyzText(xyz, { maxFrames: 1 }).frames[0];
  return { leaf: { kind: 'leaf', z: Uint8Array.from(frame.types), positions: Float32Array.from(frame.positions) }, xyz };
}

const water = galleryLeaf('popular/water.xyz');
const caffeine = galleryLeaf('popular/caffeine.xyz');
const waterRec = record('water', water.leaf);
const caffeineRec = record('caffeine', caffeine.leaf);

const SALT: CrystalNode = { kind: 'crystal', structure: 5, termination: 0, a: 11, b: 17, quarter: 92409, cells: [5n, 5n, 5n], capZ: 0, capOffset: 0 };
const saltRec = record('salt-seed', SALT);
const saltId = nodeId(saltRec);
const cu = (n: bigint, termination: 0 | 1): CrystalNode => ({ kind: 'crystal', structure: 3, termination, a: 29, b: 0, quarter: 59228, cells: [n, n, n], capZ: 0, capOffset: 0 });
const capped = (m: number): CrystalNode => ({
  kind: 'crystal', structure: 4, termination: 2, a: 6, b: 0, quarter: 58438, cells: [BigInt(m), BigInt(m), BigInt(m)], capZ: 1, capOffset: 41243,
});
const cuOpen = record('copper-630-open', cu(630n, 0));
const cuClosed = record('copper-630-closed', cu(630n, 1));
const cu63 = record('copper-63-open', cu(63n, 0));
const cu10 = record('copper-10-closed', cu(10n, 1));
const diamond2 = record('diamond-2-closed', { kind: 'crystal', structure: 4, termination: 1, a: 6, b: 0, quarter: 58438, cells: [2n, 2n, 2n], capZ: 0, capOffset: 0 });
const diamondoids = Array.from({ length: 12 }, (_, i) => record(`diamondoid-${i + 1}`, capped(i + 1)));

const A5 = 5n * 4n * 92409n;
const SALT_PERIODS: [Vec3n, Vec3n, Vec3n] = [[A5, 0n, 0n], [0n, A5, 0n], [0n, 0n, A5]];
const BROMIDE = { fromZ: 17, toZ: 35, perCopy: 1 };
const GOOGOLPLEX_L = 10n ** 100n - 3n;
const LADDER: Array<[string, bigint]> = [
  ['thousand', 0n], ['million', 3n], ['billion', 6n], ['e30', 27n], ['googol', 97n], ['googolplex', GOOGOLPLEX_L],
];
const rungs = LADDER.map(([name, levels]) =>
  record(`salt-${name}`, { kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels, substitution: BROMIDE }));
const gpRec = rungs[5];
const gpId = nodeId(gpRec);

const C = [0, 1, 2].map((a) => levelsAlong(a, GOOGOLPLEX_L));
const FIRST_COPY: Step = { tag: 'tower', levels: GOOGOLPLEX_L, runs: [[{ digit: 0, length: C[0] }], [{ digit: 0, length: C[1] }], [{ digit: 0, length: C[2] }]] };
const GRAIN: Step = {
  tag: 'tower', levels: GOOGOLPLEX_L,
  runs: [[{ digit: 5, length: 1n }, { digit: 0, length: C[0] - 1n }], [{ digit: 9, length: C[1] }], [{ digit: 5, length: 1n }, { digit: 0, length: C[2] - 1n }]],
};
const slab = (j: number): Step => ({ tag: 'tower', levels: 1n, runs: [[{ digit: j, length: 1n }], [], []] });
const edit9 = record('googolplex-without-child-9', { kind: 'edit', base: gpId, removed: [[slab(9)]] });
const edit9g = record('googolplex-without-child-9-and-grain', { kind: 'edit', base: gpId, removed: [[slab(9)], [GRAIN]] });

const plain3 = record('salt-tower-3-plain', { kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels: 3n });
const COPY0: Step = { tag: 'tower', levels: 3n, runs: [[{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] };
const PARTIAL: Step[] = [COPY0, { tag: 'cells', octants: [0] }];
const partialEdit = record('salt-tower-3-without-octant-0-of-copy-0', { kind: 'edit', base: nodeId(plain3), removed: [PARTIAL] });

// §4.4: an outer edit removes an ancestor of an inner edit's removal through a seed copy.
const innerEdit = record('salt-seed-without-cells-0-3', { kind: 'edit', base: saltId, removed: [[{ tag: 'cells', octants: [0, 3] }]] });
const overInner = record('salt-tower-3-over-the-edited-seed', { kind: 'tower', seed: nodeId(innerEdit), factor: 10, periods: SALT_PERIODS, levels: 3n });
const nestedEdit = record('nested-removals', { kind: 'edit', base: nodeId(overInner), removed: [PARTIAL] });

const P10 = SALT_PERIODS.map((p) => p.map((x) => 10n * x)) as [Vec3n, Vec3n, Vec3n];
const millionId = nodeId(rungs[1]);
const towerOfTowerBad = encodeRecord({ kind: 'tower', seed: millionId, factor: 2, periods: P10, levels: 1n });
const wrap = record('one-child-group-over-salt-million', { kind: 'group', children: [{ id: millionId, rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
const towerOfTower = record('tower-over-group-over-salt-million', { kind: 'tower', seed: nodeId(wrap), factor: 2, periods: P10, levels: 1n });
const intoTower = (digit: number): Step[] => canonicalPath([
  { tag: 'tower', levels: 1n, runs: [[{ digit, length: 1n }], [], []] },
  { tag: 'child', index: 0 },
  COPY0,
]);

/** §10.7: per axis, max ⌈x · 65536⌉ − min ⌊x · 65536⌋ + 150,733 Q16. */
function growPeriods(leaf: Leaf): bigint[] {
  return [0, 1, 2].map((a) => {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < leaf.z.length; i += 1) {
      hi = Math.max(hi, Math.ceil(leaf.positions[3 * i + a] * 65536));
      lo = Math.min(lo, Math.floor(leaf.positions[3 * i + a] * 65536));
    }
    return BigInt(hi - lo + 150733);
  });
}
const GROW = growPeriods(water.leaf);
const growPeriodsQ16: [Vec3n, Vec3n, Vec3n] = [[GROW[0], 0n, 0n], [0n, GROW[1], 0n], [0n, 0n, GROW[2]]];
const grow100 = record('water-grown-100', { kind: 'tower', seed: nodeId(waterRec), factor: 2, periods: growPeriodsQ16, levels: 100n });
const grow1 = record('water-grown-1', { kind: 'tower', seed: nodeId(waterRec), factor: 2, periods: growPeriodsQ16, levels: 1n });
const grow70000 = record('water-grown-70000', { kind: 'tower', seed: nodeId(waterRec), factor: 2, periods: growPeriodsQ16, levels: 70000n });
const CAFFEINE_GROW = growPeriods(caffeine.leaf);
const caffeineGrown = record('caffeine-grown-1', {
  kind: 'tower', seed: nodeId(caffeineRec), factor: 2, levels: 1n,
  periods: [[CAFFEINE_GROW[0], 0n, 0n], [0n, CAFFEINE_GROW[1], 0n], [0n, 0n, CAFFEINE_GROW[2]]],
});

// §4.4 counts: an outer edit removes, at the same view, an ancestor of an inner edit's removal.
const childEdit = record('one-child-group-over-the-edited-seed', { kind: 'group', children: [{ id: nodeId(innerEdit), rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] });
const sameView = record('nested-removals-at-one-view', { kind: 'edit', base: nodeId(childEdit), removed: [[{ tag: 'child', index: 0 }, { tag: 'cells', octants: [0] }]] });

// §3.4.6 with several dopants per copy: the swaps and their order.
const sevenBromides = record('salt-tower-1-seven-bromides', { kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels: 1n, substitution: { fromZ: 17, toZ: 35, perCopy: 7 } });

// §2.8 record depth: chain[k] is a one-child group over chain[k − 1], depth k + 1; chain[0] is water.
const chain: Uint8Array[] = [waterRec];
for (let k = 1; k <= 64; k += 1) {
  chain.push(record(`depth-${k + 1}`, { kind: 'group', children: [{ id: nodeId(chain[k - 1]), rotation: [0, 0, 0, 1], translation: [0, 0, 0] }] }));
}
const children = (n: number): Step[] => Array.from({ length: n }, () => ({ tag: 'child', index: 0 }));

// ─── Resolutions ──────────────────────────────────────────────────────

interface ViewCase {
  name: string;
  root: string;
  path: unknown;
  error?: string;
  view?: Record<string, unknown>;
}

function describeView(r: Resolver, v: View): Record<string, unknown> {
  const out: Record<string, unknown> = { type: v.type, count: magJson(r.count(v)) };
  if (v.type === 'level') {
    out.level = big(v.k);
    out.seedCopiesPerAxis = [0, 1, 2].map((a) => big(levelsAlong(a, v.k)));
  }
  if (v.type === 'copy') {
    out.copyKey = `0x${v.key.toString(16).padStart(16, '0')}`;
    out.firstSplitMix64 = `0x${new SplitMix64(v.key).next().toString(16).padStart(16, '0')}`;
    const seedLeaf = r.materialize(r.root(v.tower.seed));
    out.substituted = substitute(seedLeaf.z, v.tower.substitution!, v.key).chosen;
  }
  const c = r.composition(v);
  out.composition = {
    unit: countsJson(c.unit), copies: magJson(c.copies), removed: countsJson(c.removed),
    formula: hillFormula(c.unit), formulaText: formulaText(c), massMicroDa: magJson(massMicroDa(c)),
  };
  out.materializable = r.isMaterializable(v);
  if (r.isMaterializable(v)) {
    const leaf = r.materialize(v);
    out.probe = toHex(r.probe(v));
    out.materializedAtoms = leaf.z.length;
    if (leaf.z.length <= LEAF_HEX_MAX) out.materializedRecordHex = toHex(encodeRecord(leaf));
  }
  return out;
}

function viewCase(name: string, store: NodeStore, root: Uint8Array, steps: Step[]): ViewCase {
  const r = new Resolver(store);
  const base: ViewCase = { name, root: toHex(root), path: pathJson(steps) };
  try {
    return { ...base, view: describeView(r, r.resolve(root, steps)) };
  } catch (e) {
    if (e instanceof ScaleError) return { ...base, error: e.code };
    throw e;
  }
}

// ─── The §12 anchors the writer refuses to write without ──────────────

const ANCHORS: Array<[string, () => string, string]> = [];
const anchor = (what: string, value: () => string, expected: string) => ANCHORS.push([what, value, expected]);

// ─── Build ────────────────────────────────────────────────────────────

async function massive1m() {
  const bytes = fs.readFileSync(path.join(ROOT, MASSIVE));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const header = parseHeader(buf);
  const entry = parseFrameIndex(buf.slice(Number(header.frameIndexOffset)), header.totalFrames).entries[0];
  let raw = buf.slice(Number(entry.offset), Number(entry.offset) + entry.compressedSize);
  if (header.compressed) raw = await decompressGlimbinFrame(raw, entry.rawSize);
  const frame = parseFrameData(raw, entry.natoms, header.flags);
  const z = Uint8Array.from(frame.types);
  const positions = Float32Array.from(frame.positions);
  const part = bakePartition(z, positions);
  const pack = writePack(part.records, { roots: [{ name: 'massive_1m', id: part.root }] });
  const p = readPack(pack, { verifyAll: true });
  const r = new Resolver(p);
  const keepPath: Step[] = [{ tag: 'child', index: 0 }, { tag: 'child', index: 0 }, { tag: 'child', index: 0 }];
  const keep = writeRef({ root: part.root, path: keepPath, store: p });
  const probe = decodeRef(keep).probe;
  const byDep = encodeRef({ root: part.root, records: [], deps: [p.contentId], path: keepPath, probe });
  const lastLeaf = decodeRecord(part.records[part.leaves - 1]).node as Leaf;
  return {
    source: MASSIVE,
    atoms: z.length,
    elements: [...new Set(z)],
    leaves: part.leaves,
    lastLeafAtoms: lastLeaf.z.length,
    groups: part.groups,
    depth: part.depth,
    root: toHex(part.root),
    leafIds: part.records.slice(0, part.leaves).map((b) => toHex(nodeId(b))),
    groupIds: part.records.slice(part.leaves).map((b) => toHex(nodeId(b))),
    pack: { fileLength: pack.length, contentId: toHex(p.contentId), fileSha256: toHex(sha256(pack)) },
    count: formatMagnitude(r.count(r.root(part.root))),
    firstLeafKeep: {
      path: pathJson(keepPath),
      bytes: keep.length,
      textLength: refText(keep).length,
      embeddedRecordBytes: decodeRef(keep).records.map((x) => x.length).sort((a, b) => a - b),
      refKey: toHex(refKey(part.root, encodePath(keepPath))),
      probe: probe ? toHex(probe) : null,
      text: refText(keep),
      count: formatMagnitude(resolveRef(keep).count),
      byDependencyBytes: byDep.length,
      byDependencyHex: toHex(byDep),
    },
  };
}

/**
 * A partition input any implementation regenerates without data: SplitMix64
 * from the seed, per atom x, y, z = (Int(next() >> 40) − 2^23) / 1024 Å
 * (exact in Float32), then Z = 1 + next() mod 118.
 */
function proceduralPartition(seed: bigint, n: number) {
  const g = new SplitMix64(seed);
  const z = new Uint8Array(n);
  const positions = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < 3; a += 1) positions[3 * i + a] = (Number(g.next() >> 40n) - 2 ** 23) / 1024;
    z[i] = 1 + Number(g.next() % 118n);
  }
  const part = bakePartition(z, positions);
  const r = new Resolver(new MemoryStore(part.records));
  return {
    rule: 'SplitMix64(seed); per atom: x, y, z = Float32(Int(next() >> 40) - 8388608) / 1024; then Z = 1 + next() mod 118',
    seed: `0x${seed.toString(16)}`,
    atoms: n,
    positionsSha256: toHex(sha256(new Uint8Array(positions.buffer))),
    leaves: part.leaves,
    groups: part.groups,
    depth: part.depth,
    root: toHex(part.root),
    recordIds: part.records.map((b) => toHex(nodeId(b))),
    count: formatMagnitude(r.count(r.root(part.root))),
    composition: countsJson(r.plainCounts(r.root(part.root))),
  };
}

/** Patches from a to b; b may be longer, and a reads as zero past its end. */
function diffPatches(a: Uint8Array, b: Uint8Array): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const at = (k: number) => (k < a.length ? a[k] : 0);
  let i = 0;
  while (i < b.length) {
    if (at(i) === b[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < b.length && (at(j) !== b[j] || (j + 1 < b.length && at(j + 1) !== b[j + 1]))) j += 1;
    out.push([i, toHex(b.subarray(i, j))]);
    i = j;
  }
  return out;
}

function reseal(bytes: Uint8Array, sections: number[]): Uint8Array {
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

function rejections(smallPack: Uint8Array) {
  const recordCases: Array<{ name: string; hex: string; error: string | null }> = [];
  const rec = (name: string, bytes: Uint8Array) => recordCases.push({ name, hex: toHex(bytes), error: errorCode(() => decodeRecord(bytes)) });
  const patch = (bytes: Uint8Array, at: number, values: number[]) => {
    const out = bytes.slice();
    out.set(values, at);
    return out;
  };
  const f64 = (x: number) => [...new Uint8Array(new Float64Array([x]).buffer)];
  const groupRec = encodeRecord({ kind: 'group', children: [{ id: saltId, rotation: [0, 0, 0, 1], translation: [1, 2, 3] }] });
  rec('leaf: wrong magic', patch(waterRec, 0, [0x4d]));
  rec('leaf: truncated', waterRec.subarray(0, 50));
  rec('leaf: record flags', patch(waterRec, 6, [1]));
  rec('leaf: no atoms', patch(waterRec, 12, [0, 0, 0, 0]));
  rec('leaf: atomic number 0', patch(waterRec, 16, [0]));
  rec('leaf: atomic number 119', patch(waterRec, 16, [119]));
  rec('leaf: padding', patch(waterRec, 19, [1]));
  rec('leaf: negative zero', patch(waterRec, 20, [0, 0, 0, 0x80]));
  rec('leaf: NaN', patch(waterRec, 20, [0, 0, 0xc0, 0x7f]));
  rec('leaf: coordinate past 2^20', patch(waterRec, 20, [1, 0, 0x80, 0x49]));
  rec('leaf: coordinate exactly 2^20 is accepted', patch(waterRec, 20, [0, 0, 0x80, 0x49]));
  rec('unknown kind is opaque', patch(waterRec, 4, [9]));
  rec('unknown kindVersion is opaque', patch(waterRec, 5, [2]));
  rec('group: reserved', patch(groupRec, 14, [1]));
  rec('group: not unit', patch(groupRec, 72, f64(1 + 2 ** -29)));
  rec('group: within 2^-30 of unit is accepted', patch(groupRec, 72, f64(1 + 2 ** -31)));
  rec('group: qw negative', patch(groupRec, 72, f64(-1)));
  rec('group: qw zero, qx negative', patch(patch(groupRec, 48, f64(-1)), 72, f64(0)));
  rec('group: translation past 2^40', patch(groupRec, 80, f64(2 ** 41)));
  rec('crystal: reserved', patch(saltRec, 45, [1]));
  rec('crystal: rock salt without B', patch(saltRec, 15, [0]));
  rec('crystal: fcc with B', patch(cuOpen, 15, [17]));
  rec('crystal: aspect over 2^16', encodeAspect());
  rec('crystal: quarter 0', patch(saltRec, 16, [0, 0, 0, 0]));
  rec('crystal: capped size 13', patch(patch(patch(diamondoids[0], 20, [13]), 28, [13]), 36, [13]));
  const towerRec = rungs[1];
  rec('tower: unknown flag bit', patch(towerRec, 45, [3]));
  rec('tower: factor 17', patch(towerRec, 44, [17]));
  rec('tower: dependent periods', patch(towerRec, 72, [0x74, 0x33, 0x1c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  rec('tower: substitution to itself', patch(towerRec, 124, [17]));
  rec('edit: removals out of order', swapRemovals());
  rec('unknown kind with record flags is opaque', patch(waterRec, 4, [9, 1, 3, 0]));
  rec('leaf: 4,097 atoms', patch(waterRec, 12, [1, 16, 0, 0]));
  rec('group: no children', patch(groupRec, 12, [0, 0]));
  rec('group: 257 children', patch(groupRec, 12, [1, 1]));
  rec('crystal: capped fcc', patch(diamondoids[0], 12, [3]));
  rec('crystal: capped, not a cube', patch(diamondoids[1], 28, [3]));
  rec('crystal: cap fields on an open crystal', patch(saltRec, 44, [1]));
  rec('crystal: cells 0', patch(saltRec, 20, [0]));
  rec('tower: slender periods', patch(patch(patch(towerRec, 48, [0, 0, 0, 0, 0, 1, 0, 0]), 80, [1, 0, 0, 0, 0, 0, 0, 0]), 112, [1, 0, 0, 0, 0, 0, 0, 0]));
  rec('tower: period past 2^40', patch(towerRec, 48, [0, 0, 0, 0, 0, 2, 0, 0]));
  rec('tower: substitution to element 119', patch(towerRec, 124, [119]));
  rec('tower: perCopy 0', patch(towerRec, 125, [0, 0]));
  rec('edit: no removals', patch(edit9, 44, [0, 0]));
  rec('edit: a removal of zero bytes', patch(edit9, 48, [0, 0, 0, 0]));

  // Raw bytes, written without the canonical checks the readers apply.
  const raw = (build: (w: Writer) => void) => {
    const w = new Writer();
    build(w);
    return toHex(w.finish());
  };
  const towerRaw = (w: Writer, levels: bigint, axes: Array<Array<[number, bigint]>>) => {
    w.u8(3).bigUInt(levels);
    for (const axis of axes) {
      w.u16(axis.length);
      for (const [digit, length] of axis) w.u8(digit).bigUInt(length);
    }
  };
  const pathCases = [
    ['adjacent cells steps', raw((w) => w.u16(2).u8(2).u8(1).u8(0).u8(2).u8(1).u8(1))],
    ['adjacent tower steps', raw((w) => { w.u16(2); towerRaw(w, 1n, [[[0, 1n]], [], []]); towerRaw(w, 1n, [[], [[0, 1n]], []]); })],
    ['adjacent atoms steps', raw((w) => w.u16(2).u8(4).u16(1).u16(0).u16(1).u8(4).u16(1).u16(0).u16(1))],
    ['adjacent equal digits', raw((w) => { w.u16(1); towerRaw(w, 2n, [[[1, 1n], [1, 1n]], [], []]); })],
    ['zero run length', raw((w) => { w.u16(1); towerRaw(w, 1n, [[[0, 0n]], [], []]); })],
    ['tower of no levels', raw((w) => { w.u16(1); towerRaw(w, 0n, [[], [], []]); })],
    ['non-minimal run length', raw((w) => w.u16(1).u8(3).u16(1).u8(1).u16(1).u8(0).u16(2).u8(1).u8(0).u16(0).u16(0))],
    ['touching ranges', raw((w) => w.u16(1).u8(4).u16(2).u16(0).u16(2).u16(2).u16(1))],
    ['overlapping ranges', raw((w) => w.u16(1).u8(4).u16(2).u16(0).u16(3).u16(2).u16(1))],
    ['range past 4096', raw((w) => w.u16(1).u8(4).u16(1).u16(4095).u16(2))],
    ['empty range', raw((w) => w.u16(1).u8(4).u16(1).u16(0).u16(0))],
    ['no ranges', raw((w) => w.u16(1).u8(4).u16(0))],
    ['empty cells', raw((w) => w.u16(1).u8(2).u8(0))],
    ['65 octants', raw((w) => { w.u16(1).u8(2).u8(65); for (let i = 0; i < 65; i += 1) w.u8(0); })],
    ['octant 8', raw((w) => w.u16(1).u8(2).u8(1).u8(8))],
    ['unknown tag', raw((w) => w.u16(1).u8(5))],
    ['trailing byte', raw((w) => w.u16(0).u8(0xff))],
    ['truncated', raw((w) => w.u16(1).u8(1))],
    ['adjacent child steps are fine', raw((w) => w.u16(2).u8(1).u16(0).u8(1).u16(1))],
    ['two ranges with a gap are fine', raw((w) => w.u16(1).u8(4).u16(2).u16(0).u16(2).u16(3).u16(1))],
  ].map(([name, hex]) => ({ name, hex, error: errorCode(() => encodePath(decodePathHex(hex))) }));

  const pack = smallPack;
  const packCase = (name: string, mutate: (b: Uint8Array, v: DataView) => void, sections: number[] = [], keepCrcs = false, pages = 0) => {
    const b = new Uint8Array(pack.length + pages * 16384);
    b.set(pack);
    mutate(b, new DataView(b.buffer));
    if (!keepCrcs) reseal(b, sections);
    return { name, fileLength: b.length, patches: diffPatches(pack, b), error: errorCode(() => readPack(b, { verifyAll: true })) };
  };
  /** The salt seed (the first record) with reserved byte 45 set, rehashed, still sorting first. */
  const badSeed = (b: Uint8Array, v: DataView) => {
    const nrec = 2 * 16384;
    const water = b.slice(16384 + 8 + 48, 16384 + 8 + 48 + 32);
    for (let x = 1; x < 256; x += 1) {
      const rec = b.slice(nrec, nrec + saltRec.length);
      rec[45] = x;
      const id = nodeId(rec);
      if (toHex(id) >= toHex(water)) continue;
      b.set(rec, nrec);
      b.set(id, 16384 + 8);
      const ids = [0, 1, 2].map((i) => b.slice(16384 + 8 + 48 * i, 16384 + 8 + 48 * i + 32));
      const root = b.subarray(3 * 16384, 3 * 16384 + Number(v.getBigUint64(128 + 64 + 16, true)));
      b.set(packContentId(ids, root, null), 32);
      return;
    }
    throw new Error('no reserved byte keeps the salt seed first');
  };
  const packCases = [
    packCase('versionMinor 1 is accepted', (_b, v) => v.setUint16(6, 1, true)),
    packCase('magic', (b) => { b[3] = 0x4c; }),
    packCase('versionMajor 2', (_b, v) => v.setUint16(4, 2, true)),
    packCase('headerSize', (_b, v) => v.setUint32(8, 64, true)),
    packCase('sectionCount 1', (_b, v) => v.setUint32(12, 1, true)),
    packCase('header reserved byte', (b) => { b[70] = 1; }),
    packCase('header flags', (_b, v) => v.setUint32(96, 1, true)),
    packCase('headerCrc', (b) => { b[124] ^= 1; }, [], true),
    packCase('tableCrc', (b, v) => { b[100] ^= 1; v.setUint32(124, crc32(b.subarray(0, 124)), true); }, [], true),
    packCase('bytes after the section table', (b) => { b[1000] = 1; }),
    packCase('section offset not page-aligned', (_b, v) => v.setBigUint64(128 + 8, 16000n, true)),
    packCase('sections overlap', (_b, v) => v.setBigUint64(128 + 32 + 8, 16384n, true)),
    packCase('section padding', (b) => { b[16384 + 2000] = 1; }),
    packCase('section CRC', (b) => { b[16384 + 9] ^= 1; }),
    packCase('a type twice', (b) => { b.set([0x4e, 0x49, 0x44, 0x58], 128 + 32); }),
    packCase('required section of an unknown version', (_b, v) => v.setUint16(128 + 28, 2, true)),
    packCase('NIDX missing', (b, v) => { b[128] = 0x58; v.setUint32(128 + 4, 0, true); }),
    packCase('NIDX not ascending', (b) => {
      const a = b.slice(16384 + 8, 16384 + 56);
      b.set(b.subarray(16384 + 56, 16384 + 104), 16384 + 8);
      b.set(a, 16384 + 56);
    }, [0]),
    packCase('NIDX kind disagrees with the record', (b) => { b[16384 + 8 + 44] = 2; }, [0]),
    packCase('a record that does not hash to its NodeID', (b) => { b[2 * 16384 + 20] ^= 1; }, [1]),
    packCase('contentId', (b) => { b[40] ^= 1; }),
    packCase('root name with a capital', (b) => { b[3 * 16384 + 8 + 34] = 0x57; }, [2]),
    packCase('a record that hashes to its NodeID but fails §2', badSeed, [0, 1]),
    packCase('a zero page between sections is accepted', (b, v) => {
      const root = b.slice(3 * 16384, 4 * 16384);
      b.fill(0, 3 * 16384, 4 * 16384);
      b.set(root, 4 * 16384);
      v.setBigUint64(128 + 64 + 8, BigInt(4 * 16384), true);
      v.setBigUint64(24, BigInt(b.length), true);
    }, [], false, 1),
    packCase('a zero page after the last section is accepted', (_b, v) => v.setBigUint64(24, BigInt(5 * 16384), true), [], false, 1),
  ];

  const ref = writeRef({ root: nodeId(waterRec), path: [], store: new MemoryStore([waterRec]) });
  const probe = decodeRef(ref).probe!;
  const wrongProbe = probe.slice();
  wrongProbe[0] ^= 1;
  const refCases = [
    { name: 'water, embedded, empty path, probe', hex: toHex(ref) },
    { name: 'wrong magic', hex: toHex(patch(ref, 0, [0x4d])) },
    { name: 'version 2', hex: toHex(patch(ref, 3, [2])) },
    { name: 'unknown flag', hex: toHex(patch(ref, 4, [3])) },
    { name: 'reserved byte', hex: toHex(patch(ref, 7, [1])) },
    { name: 'probe missing for a materializable target', hex: toHex(encodeRef({ root: nodeId(waterRec), records: [waterRec], deps: [], path: [], probe: null })) },
    { name: 'probe that does not match', hex: toHex(encodeRef({ root: nodeId(waterRec), records: [waterRec], deps: [], path: [], probe: wrongProbe })) },
    { name: 'probe on a target that is not materializable', hex: toHex(encodeRef({ root: nodeId(plain3), records: [saltRec, plain3], deps: [], path: [], probe })) },
  ].map((c) => ({ ...c, error: errorCode(() => resolveRef(fromHex(c.hex))) }));
  const text = refText(ref);
  const refTexts = [
    { name: 'water as text', text },
    { name: 'without the lsr1: prefix', text: text.slice(5) },
    { name: 'with padding', text: `${text}=` },
    { name: 'a character outside base64url', text: `${text.slice(0, -1)}+` },
    { name: 'nonzero trailing bits', text: withTrailingBit(text) },
    { name: 'a payload length of 4n + 1', text: `${text}${'A'.repeat((((1 - (text.length - 5)) % 4) + 4) % 4 || 4)}` },
  ].map((c) => ({ ...c, error: errorCode(() => resolveRef(refFromText(c.text))) }));

  // A case with its own store lists that store's records; the others use the fixture's records.
  const ownStore = (name: string, recs: Uint8Array[], root: Uint8Array, steps: Step[]) =>
    ({ ...viewCase(name, new MemoryStore(recs), root, steps), records: recs.map(toHex) });
  const editOfEdit = encodeRecord({ kind: 'edit', base: nodeId(edit9), removed: [[slab(1)]] });
  const containing = encodeRecord({ kind: 'edit', base: gpId, removed: [[slab(5)], [GRAIN]] });
  const tooMuchChlorine = encodeRecord({ kind: 'tower', seed: saltId, factor: 10, periods: SALT_PERIODS, levels: 1n, substitution: { fromZ: 17, toZ: 35, perCopy: 501 } });
  const contextual = [
    ownStore('a tower whose seed is a tower', [saltRec, rungs[1], towerOfTowerBad], nodeId(towerOfTowerBad), []),
    ownStore('an edit whose base is an edit', [saltRec, gpRec, edit9, editOfEdit], nodeId(editOfEdit), []),
    ownStore('a removal that contains another', [saltRec, gpRec, containing], nodeId(containing), []),
    ownStore('a substitution needing more chlorine than the seed holds', [saltRec, tooMuchChlorine], nodeId(tooMuchChlorine), []),
    viewCase('a tower step deeper than its level', allRecords(), nodeId(rungs[1]), [{ tag: 'tower', levels: 4n, runs: [[{ digit: 0, length: 2n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] }]),
    viewCase('a digit not below the factor', allRecords(), nodeId(rungs[1]), [{ tag: 'tower', levels: 1n, runs: [[], [], [{ digit: 10, length: 1n }]] }]),
    viewCase('run lengths on the wrong axis', allRecords(), nodeId(rungs[1]), [{ tag: 'tower', levels: 1n, runs: [[{ digit: 0, length: 1n }], [], []] }]),
    viewCase('an octant that does not exist', allRecords(), saltId, [{ tag: 'cells', octants: [7, 7, 0] }]),
    viewCase('an atoms range past the materialization', allRecords(), nodeId(waterRec), [{ tag: 'atoms', ranges: [{ start: 2, length: 2 }] }]),
    viewCase('a child step on a crystal', allRecords(), saltId, [{ tag: 'child', index: 0 }]),
  ];
  return { records: recordCases, paths: pathCases, pack: { base: 'packs.small', cases: packCases }, references: refCases, referenceTexts: refTexts, resolutions: contextual };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The same text with the lowest unused bit of its last character set (its payload is not 4n long). */
function withTrailingBit(text: string): string {
  const last = B64.indexOf(text[text.length - 1]);
  return `${text.slice(0, -1)}${B64[last | 1]}`;
}

function encodeAspect(): Uint8Array {
  const b = encodeRecord({ ...cu(1n, 0), cells: [65536n, 1n, 1n] } as Node).slice();
  new DataView(b.buffer).setBigUint64(20, 65537n, true);
  return b;
}

function swapRemovals(): Uint8Array {
  const two = encodeRecord({ kind: 'edit', base: gpId, removed: [[slab(3)], [slab(5)]] });
  const out = two.slice();
  out.set(two.subarray(68, 88), 48);
  out.set(two.subarray(48, 68), 68);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function stepBytesOf(step: Step): Uint8Array {
  return encodePath([step]).subarray(2);
}

const decodePathHex = (hex: string): Step[] => decodePath(fromHex(hex));

export async function buildScaleFixtures(): Promise<Record<string, unknown>> {
  const store = allRecords();

  // §12.1
  const splitmix = [0n, 0x0123456789abcdefn, 0x9df8af3f7edb268en].map((seed) => {
    const g = new SplitMix64(seed);
    return { seed: `0x${seed.toString(16).padStart(16, '0')}`, outputs: Array.from({ length: 5 }, () => `0x${g.next().toString(16).padStart(16, '0')}`) };
  });
  const bigUInts = [0n, 1n, 255n, 256n, 65535n, 65536n, 10n ** 100n, 10n ** 100n - 3n, (1n << 65536n) - 1n].map((v) => {
    const hex = toHex(new Writer().bigUInt(v).finish());
    return { value: big(v), hex: hex.length > 200 ? null : hex, bytes: hex.length / 2, sha256: toHex(sha256(fromHex(hex))) };
  });
  const concatHex = toHex([0n, 1n, 255n, 256n, 10n ** 100n].reduce((w, v) => w.bigUInt(v), new Writer()).finish());

  // Records, every one.
  const recordList = [...records.entries()].map(([id, r]) => ({
    name: r.name, id, kind: r.bytes[4], bytes: r.bytes.length, crc32: crc32(r.bytes).toString(16).padStart(8, '0'), hex: toHex(r.bytes),
    node: nodeJson(decodeRecord(r.bytes).node!),
  }));

  // Resolutions.
  const views: ViewCase[] = [
    viewCase('water', store, nodeId(waterRec), []),
    viewCase('caffeine', store, nodeId(caffeineRec), []),
    viewCase('caffeine, atoms [0, 4) and [10, 12)', store, nodeId(caffeineRec), [{ tag: 'atoms', ranges: [{ start: 0, length: 4 }, { start: 10, length: 2 }] }]),
    viewCase('salt seed', store, saltId, []),
    viewCase('salt seed, octant 7 then 0', store, saltId, [{ tag: 'cells', octants: [7, 0] }]),
    viewCase('copper 630 open', store, nodeId(cuOpen), []),
    viewCase('copper 630 open, 9 octants down', store, nodeId(cuOpen), [{ tag: 'cells', octants: [0, 1, 2, 3, 4, 5, 6, 7, 0] }]),
    viewCase('copper 630 closed', store, nodeId(cuClosed), []),
    viewCase('copper 630 closed, the far corner 9 octants down', store, nodeId(cuClosed), [{ tag: 'cells', octants: [7, 7, 7, 7, 7, 7, 7, 7, 7] }]),
    viewCase('copper 63 open', store, nodeId(cu63), []),
    viewCase('copper 10 closed', store, nodeId(cu10), []),
    viewCase('copper 10 closed, octant 7', store, nodeId(cu10), [{ tag: 'cells', octants: [7] }]),
    viewCase('diamond 2 closed', store, nodeId(diamond2), []),
    ...diamondoids.map((d, i) => viewCase(`diamondoid ${i + 1}`, store, nodeId(d), [])),
    ...LADDER.map(([name], i) => viewCase(`salt ${name}`, store, nodeId(rungs[i]), [])),
    viewCase('googolplex, first copy', store, gpId, [FIRST_COPY]),
    viewCase('googolplex, the grain', store, gpId, [GRAIN]),
    viewCase('googolplex, a fragment of the grain', store, gpId, canonicalPath([GRAIN, { tag: 'atoms', ranges: [{ start: 0, length: 8 }] }])),
    viewCase('googolplex, child 3', store, gpId, [slab(3)]),
    viewCase('googolplex, child 3 then its child 7', store, gpId, canonicalPath([slab(3), { tag: 'tower', levels: 1n, runs: [[], [], [{ digit: 7, length: 1n }]] }])),
    viewCase('googolplex without child 9', store, nodeId(edit9), []),
    viewCase('googolplex without child 9: child 9', store, nodeId(edit9), [slab(9)]),
    viewCase('googolplex without child 9 and the grain', store, nodeId(edit9g), []),
    viewCase('googolplex without child 9 and the grain: the grain', store, nodeId(edit9g), [GRAIN]),
    viewCase('googolplex without child 9 and the grain: child 5', store, nodeId(edit9g), [slab(5)]),
    viewCase('salt tower 3 plain', store, nodeId(plain3), []),
    viewCase('removal inside a seed copy', store, nodeId(partialEdit), []),
    viewCase('removal inside a seed copy: copy (0, 0, 0)', store, nodeId(partialEdit), [COPY0]),
    viewCase('removal inside a seed copy: copy (0, 0, 0), octant 1', store, nodeId(partialEdit), PARTIAL.slice(0, 1).concat([{ tag: 'cells', octants: [1] }])),
    viewCase('removal inside a seed copy: copy (0, 0, 0), octant 0', store, nodeId(partialEdit), PARTIAL),
    viewCase('removal inside a seed copy: copy (0, 0, 0), octant 0 then 7', store, nodeId(partialEdit), [COPY0, { tag: 'cells', octants: [0, 7] }]),
    viewCase('removal inside a seed copy: copy (1, 0, 0)', store, nodeId(partialEdit), [{ tag: 'tower', levels: 3n, runs: [[{ digit: 1, length: 1n }], [{ digit: 0, length: 1n }], [{ digit: 0, length: 1n }]] }]),
    viewCase('nested removals through a seed copy', store, nodeId(nestedEdit), []),
    viewCase('nested removals through a seed copy: copy (0, 0, 0)', store, nodeId(nestedEdit), [COPY0]),
    viewCase('nested removals at one view', store, nodeId(sameView), []),
    viewCase('nested removals at one view: child 0', store, nodeId(sameView), [{ tag: 'child', index: 0 }]),
    viewCase('seven bromides per copy: copy 3', store, nodeId(sevenBromides), [{ tag: 'tower', levels: 1n, runs: [[{ digit: 3, length: 1n }], [], []] }]),
    viewCase('a group 64 records deep', store, nodeId(chain[63]), []),
    viewCase('a group 64 records deep: 63 children down', store, nodeId(chain[63]), children(63)),
    viewCase('a group 65 records deep', store, nodeId(chain[64]), []),
    viewCase('a group 65 records deep: child 0', store, nodeId(chain[64]), children(1)),
    viewCase('a group 65 records deep: 63 children down', store, nodeId(chain[64]), children(63)),
    viewCase('a group 65 records deep: 64 children down', store, nodeId(chain[64]), children(64)),
    viewCase('tower of towers', store, nodeId(towerOfTower), []),
    viewCase('tower of towers, copy 0 inside outer copy 0', store, nodeId(towerOfTower), intoTower(0)),
    viewCase('tower of towers, copy 0 inside outer copy 1', store, nodeId(towerOfTower), intoTower(1)),
    viewCase('water grown 100 times', store, nodeId(grow100), []),
    viewCase('water grown once', store, nodeId(grow1), []),
    viewCase('water grown 70,000 times', store, nodeId(grow70000), []),
  ];

  // §12.5 and more formatting rows.
  const gp = towerMagnitude(1000n, 10, GOOGOLPLEX_L);
  const tenth = towerMagnitude(1000n, 10, GOOGOLPLEX_L - 1n);
  const plainRow = (v: bigint) => ({ op: 'plain', value: big(v) });
  const towerRow = (s: bigint, f: number, l: bigint) => ({ op: 'tower', seed: big(s), factor: f, levels: big(l) });
  const formatting: Array<{ name: string; value: unknown; m: Magnitude }> = [
    { name: '953312', value: plainRow(953312n), m: magnitude(953312) },
    { name: '1000188000', value: plainRow(1000188000n), m: magnitude(1000188000) },
    { name: '10^15', value: plainRow(10n ** 15n), m: magnitude(10n ** 15n) },
    { name: '1234567890123456789', value: plainRow(1234567890123456789n), m: magnitude(1234567890123456789n) },
    { name: '1000188 × 10^15', value: plainRow(1000188n * 10n ** 15n), m: magnitude(1000188n * 10n ** 15n) },
    { name: '1234567890123456789012345', value: plainRow(1234567890123456789012345n), m: magnitude(1234567890123456789012345n) },
    { name: '25 × 10^30 + 7', value: plainRow(25n * 10n ** 30n + 7n), m: magnitude(25n * 10n ** 30n + 7n) },
    { name: 'googol', value: plainRow(10n ** 100n), m: magnitude(10n ** 100n) },
    { name: 'googol − 1', value: plainRow(10n ** 100n - 1n), m: magnitude(10n ** 100n - 1n) },
    { name: 'googolplex', value: towerRow(1000n, 10, GOOGOLPLEX_L), m: gp },
    { name: 'googolplex ÷ 10', value: towerRow(1000n, 10, GOOGOLPLEX_L - 1n), m: tenth },
    { name: 'googolplex − googolplex ÷ 10', value: { op: 'sub', a: towerRow(1000n, 10, GOOGOLPLEX_L), b: towerRow(1000n, 10, GOOGOLPLEX_L - 1n) }, m: subMagnitude(gp, tenth) },
    { name: 'googolplex − 1000', value: { op: 'sub', a: towerRow(1000n, 10, GOOGOLPLEX_L), b: plainRow(1000n) }, m: subMagnitude(gp, magnitude(1000)) },
    { name: 'googolplex + 5', value: { op: 'add', a: towerRow(1000n, 10, GOOGOLPLEX_L), b: plainRow(5n) }, m: addMagnitude(gp, magnitude(5)) },
    { name: '3 × 2^100', value: towerRow(3n, 2, 100n), m: towerMagnitude(3n, 2, 100n) },
    { name: '3 × 2^70000', value: towerRow(3n, 2, 70000n), m: towerMagnitude(3n, 2, 70000n) },
    { name: '24 × 16^40', value: towerRow(24n, 16, 40n), m: towerMagnitude(24n, 16, 40n) },
    // Beyond §12.5: every rule of §5.4.1 and §5.4.2, and the edges between them.
    { name: '0', value: plainRow(0n), m: magnitude(0) },
    { name: '999999999999999', value: plainRow(10n ** 15n - 1n), m: magnitude(10n ** 15n - 1n) },
    { name: '10^24 − 1 (24 digits, rule 3)', value: plainRow(10n ** 24n - 1n), m: magnitude(10n ** 24n - 1n) },
    { name: '10^24 + 1 (rule 4a)', value: plainRow(10n ** 24n + 1n), m: magnitude(10n ** 24n + 1n) },
    { name: '12345 × 10^30 + 1 (head 12345 ≥ 10,000: rule 5)', value: plainRow(12345n * 10n ** 30n + 1n), m: magnitude(12345n * 10n ** 30n + 1n) },
    { name: '10^40 − 10^15 (r = 10^15: rule 5)', value: plainRow(10n ** 40n - 10n ** 15n), m: magnitude(10n ** 40n - 10n ** 15n) },
    { name: '12345 × 10^20 rounded half to even', value: plainRow(1234500000000000000000001n * 10n), m: magnitude(1234500000000000000000001n * 10n) },
    { name: '1.2345 × 10^25 exactly: half to even keeps 4', value: plainRow(12345n * 10n ** 21n + 1n), m: magnitude(12345n * 10n ** 21n + 1n) },
    { name: '9.9995 × 10^30 + 1: rounds to 10,000', value: plainRow(99995n * 10n ** 26n + 1n), m: magnitude(99995n * 10n ** 26n + 1n) },
    { name: '1000 × 10^(10^100) − 1 (rule 4b at K + 1)', value: { op: 'sub', a: towerRow(1000n, 10, 10n ** 100n), b: plainRow(1n) }, m: subMagnitude(towerMagnitude(1000n, 10, 10n ** 100n), magnitude(1)) },
    { name: '2^60 (display base 2)', value: towerRow(1n, 2, 60n), m: towerMagnitude(1n, 2, 60n) },
    { name: '1000 × 2^100 (factors of 2 move into z)', value: towerRow(1000n, 2, 100n), m: towerMagnitude(1000n, 2, 100n) },
    { name: '3 × 2^100 + 1 (display base 2, plain, rule 2 of §5.4.2)', value: { op: 'add', a: towerRow(3n, 2, 100n), b: plainRow(1n) }, m: addMagnitude(towerMagnitude(3n, 2, 100n), magnitude(1)) },
    { name: '3 × 2^70000 + 1 (rule 3 of §5.4.2)', value: { op: 'add', a: towerRow(3n, 2, 70000n), b: plainRow(1n) }, m: addMagnitude(towerMagnitude(3n, 2, 70000n), magnitude(1)) },
    { name: '7 × 3^50000 (base 3)', value: towerRow(7n, 3, 50000n), m: towerMagnitude(7n, 3, 50000n) },
    { name: '5 × 9^30000 (base 9 over root 3)', value: towerRow(5n, 9, 30000n), m: towerMagnitude(5n, 9, 30000n) },
    { name: '1000 × 10^(2^65535)', value: towerRow(1000n, 10, 1n << 65535n), m: towerMagnitude(1000n, 10, 1n << 65535n) },
  ];
  const formattingRows = formatting.map(({ name, value, m }) => ({ name, value, ...magJson(m) }));

  // §5.2 arithmetic across forms and families, and its errors.
  const p70 = towerRow(3n, 2, 70000n);
  const gpRow = towerRow(1000n, 10, GOOGOLPLEX_L);
  const evalRow = (v: { op: string; value?: string; seed?: string; factor?: number; levels?: string; a?: unknown; b?: unknown }): Magnitude => {
    switch (v.op) {
      case 'plain': return magnitude(BigInt(v.value!));
      case 'tower': return towerMagnitude(BigInt(v.seed!), v.factor!, BigInt(v.levels!));
      case 'add': return addMagnitude(evalRow(v.a as never), evalRow(v.b as never));
      default: return subMagnitude(evalRow(v.a as never), evalRow(v.b as never));
    }
  };
  const arithmeticRow = (name: string, value: { op: string; a: unknown; b: unknown }) => {
    try {
      return { name, value, ...magJson(evalRow(value)) };
    } catch (e) {
      if (e instanceof ScaleError) return { name, value, error: e.code };
      throw e;
    }
  };
  const arithmetic = [
    arithmeticRow('10 + 3 × 2^70000: a plain value joins the base-2 family, and the sum prints in base 2', { op: 'add', a: plainRow(10n), b: p70 }),
    arithmeticRow('3 × 2^70000 + 10', { op: 'add', a: p70, b: plainRow(10n) }),
    arithmeticRow('3 × 2^70000 − 3 × 2^70000', { op: 'sub', a: p70, b: p70 }),
    arithmeticRow('googolplex − googolplex', { op: 'sub', a: gpRow, b: gpRow }),
    arithmeticRow('7 × 3^50000 + 5 × 9^30000: one family, root 3', { op: 'add', a: towerRow(7n, 3, 50000n), b: towerRow(5n, 9, 30000n) }),
    arithmeticRow('5 × 9^30000 + 7 × 3^50000: the left display base wins', { op: 'add', a: towerRow(5n, 9, 30000n), b: towerRow(7n, 3, 50000n) }),
    arithmeticRow('24 × 16^40 + 3 × 2^100: plain values of two families', { op: 'add', a: towerRow(24n, 16, 40n), b: towerRow(3n, 2, 100n) }),
    arithmeticRow('googolplex + 3 × 2^70000: two families above 2^65536', { op: 'add', a: gpRow, b: p70 }),
    arithmeticRow('1000 − googolplex: negative', { op: 'sub', a: plainRow(1000n), b: gpRow }),
    arithmeticRow('3 × 2^100 − 3 × 2^70000: negative', { op: 'sub', a: towerRow(3n, 2, 100n), b: p70 }),
  ];
  const comparisonRow = (name: string, a: unknown, b: unknown) => {
    try {
      return { name, a, b, result: compareMagnitude(evalRow(a as never), evalRow(b as never)) };
    } catch (e) {
      if (e instanceof ScaleError) return { name, a, b, error: e.code };
      throw e;
    }
  };
  const comparisons = [
    comparisonRow('googol < googolplex', plainRow(10n ** 100n), gpRow),
    comparisonRow('googolplex = googolplex', gpRow, { op: 'add', a: towerRow(1000n, 10, GOOGOLPLEX_L - 1n), b: { op: 'sub', a: gpRow, b: towerRow(1000n, 10, GOOGOLPLEX_L - 1n) } }),
    comparisonRow('googolplex − 1 < googolplex', { op: 'sub', a: gpRow, b: plainRow(1n) }, gpRow),
    comparisonRow('3 × 2^70000 > 3 × 2^100', p70, towerRow(3n, 2, 100n)),
    comparisonRow('7 × 3^50000 < 5 × 9^30000', towerRow(7n, 3, 50000n), towerRow(5n, 9, 30000n)),
    comparisonRow('2^60 = 16^15', towerRow(1n, 2, 60n), towerRow(1n, 16, 15n)),
    comparisonRow('googolplex against 3 × 2^70000: two families', gpRow, p70),
  ];

  const approximations = ['googolplex', '3 × 2^100', '3 × 2^70000', '1000 × 10^(2^65535)', '953312'].map((name) => {
    const row = formatting.find((f) => f.name === name)!;
    return { name, value: row.value, lnM: lnMagnitude(row.m), lnlnM: lnlnMagnitude(row.m) };
  });

  const gpComposition = new Resolver(store).composition(new Resolver(store).root(gpId));
  const waterTower = new Resolver(store);
  const scientificRows = [
    { name: 'the googolplex, in kg', root: toHex(gpId), mass: magJson(massMicroDa(gpComposition)), kgPerMicroDalton: KG_PER_MICRO_DALTON, text: scientific(massMicroDa(gpComposition), KG_PER_MICRO_DALTON) },
    {
      name: 'water grown 70,000 times, in kg', root: toHex(nodeId(grow70000)), mass: magJson(massMicroDa(waterTower.composition(waterTower.root(nodeId(grow70000))))),
      kgPerMicroDalton: KG_PER_MICRO_DALTON, text: scientific(massMicroDa(waterTower.composition(waterTower.root(nodeId(grow70000)))), KG_PER_MICRO_DALTON),
    },
  ];

  // §12.6 packs.
  const small = writePack([waterRec, saltRec, gpRec], { roots: [{ name: 'water', id: nodeId(waterRec) }, { name: 'salt-googolplex', id: gpId }] });
  const bundledRoots = LADDER.map(([name], i) => ({ name: `salt-${name}`, id: nodeId(rungs[i]) }));
  bundledRoots.push({ name: 'copper-billion', id: nodeId(cuOpen) }, { name: 'copper-billion-closed', id: nodeId(cuClosed) });
  diamondoids.forEach((d, i) => bundledRoots.push({ name: `diamondoid-${i + 1}`, id: nodeId(d) }));
  const bundled = writePack([saltRec, ...rungs, cuOpen, cuClosed, ...diamondoids], { roots: bundledRoots });
  const withDeps = writePack([caffeineRec], { roots: [{ name: 'caffeine', id: nodeId(caffeineRec) }], deps: [readPack(small).contentId, readPack(bundled).contentId] });
  const packJson = (name: string, file: Uint8Array) => {
    const p = readPack(file, { verifyAll: true });
    return {
      name, fileLength: file.length, contentId: toHex(p.contentId), fileSha256: toHex(sha256(file)),
      headerCrc: new DataView(file.buffer).getUint32(124, true).toString(16).padStart(8, '0'),
      roots: p.roots.map((r) => ({ name: r.name, id: toHex(r.id) })), deps: p.deps.map(toHex), records: p.ids.map(toHex),
      sections: p.sections.map((s) => ({ type: s.type, offset: s.offset, length: s.length, crc32: s.crc.toString(16).padStart(8, '0') })),
      hex: toHex(file),
    };
  };

  // §7 references.
  const refCase = (name: string, root: Uint8Array, steps: Step[], refStore: NodeStore) => {
    const bytes = writeRef({ root, path: steps, store: refStore });
    const d = decodeRef(bytes);
    const resolved = resolveRef(bytes);
    return {
      name, root: toHex(root), path: pathJson(steps), bytes: bytes.length, hex: toHex(bytes), text: refText(bytes), refKey: toHex(d.key),
      embedded: d.records.map((r) => toHex(nodeId(r))), probe: d.probe ? toHex(d.probe) : null, count: formatMagnitude(resolved.count),
    };
  };
  const references = [
    refCase('caffeine', nodeId(caffeineRec), [], store),
    refCase('the salt rung 10³', nodeId(rungs[0]), [], store),
    refCase('the grain of the googolplex', gpId, [GRAIN], store),
    refCase('a fragment of the grain', gpId, canonicalPath([GRAIN, { tag: 'atoms', ranges: [{ start: 0, length: 8 }] }]), store),
    refCase('child 3 of the googolplex', gpId, [slab(3)], store),
    refCase('the googolplex without child 9 and the grain', nodeId(edit9g), [], store),
    refCase('copy (0, 0, 0) inside the edit of the salt tower', nodeId(partialEdit), [COPY0], store),
    refCase('copper 630 closed, the far corner', nodeId(cuClosed), [{ tag: 'cells', octants: [7, 7, 7, 7, 7, 7, 7, 7, 7] }], store),
    refCase('the tower of towers, copy 0 inside outer copy 1', nodeId(towerOfTower), intoTower(1), store),
  ];

  const m1 = await massive1m();
  const fixtures = {
    schema: 'lupi.scale-fixtures.v1',
    generator: 'packages/core/scripts/write-scale-fixtures.mts',
    spec: 'docs/ar/scale-spec.md',
    changelog: 'docs/ar/scale-spec.md §13.1',
    notes: [
      'Hex is lowercase; NodeIDs are SHA-256 in hex; integers beyond 2^53 are decimal strings.',
      'A Magnitude is given as its §5.4 text, its display base and its canonical key: "p:<hex>" for a plain value, else "r<root>:" and its digit runs (digit and length in hex, most significant first).',
      'Leaf positions are the little-endian Float32 bytes (positionsF32Hex).',
      'A view case either resolves (view) or fails with the §4.7 code (error).',
      'Approximations are [V] (scale-spec §5.5): compare with its tolerances; null is +infinity.',
      'Approximations and scientific rows: the value is built as in formatting, or is the mass of the root record\'s composition.',
      'A contextual rejection with records resolves in a store of exactly those records; without, in a store of every fixture record.',
      'Pack rejection cases are patches ([offset, hex]) to packs.small, with the CRCs already resealed where the case is not about a CRC.',
      'The bundled pack lupi-scale-r1 uses the root names scale-spec §12.6 lists: salt-<rung>, copper-billion, copper-billion-closed and diamondoid-<m>.',
    ],
    primitives: {
      crc32: [
        { ascii: '123456789', crc32: crc32(new TextEncoder().encode('123456789')).toString(16).padStart(8, '0') },
        { ascii: '', crc32: crc32(new Uint8Array(0)).toString(16).padStart(8, '0') },
        { hex: toHex(waterRec), crc32: crc32(waterRec).toString(16).padStart(8, '0') },
      ],
      sha256: [
        { ascii: 'abc', sha256: toHex(sha256(new TextEncoder().encode('abc'))) },
        { ascii: '', sha256: toHex(sha256(new Uint8Array(0))) },
        { ascii: 'lupi.scale.copy.v1', sha256: toHex(sha256(new TextEncoder().encode('lupi.scale.copy.v1'))) },
      ],
      splitMix64: splitmix,
      mix64: [0n, 1n, 0x9e3779b97f4a7c15n].map((s) => ({ input: `0x${s.toString(16).padStart(16, '0')}`, output: `0x${mix64(s).toString(16).padStart(16, '0')}` })),
      bigUInt: bigUInts,
      bigUIntConcatenatedHex: concatHex,
      q16ToF32: [0, 1, -1, 41243, 116876, 184818, 2 ** 36 - 1, -(2 ** 36 - 1)].map((q) => ({ q16: q, f32Hex: f32Hex(Float32Array.of(q / 65536)) })),
    },
    massMicroDaltons: MICRO_DA_V1.slice(1),
    gallery: [
      { file: `${GALLERY}/popular/water.xyz`, xyz: water.xyz, record: toHex(waterRec), id: toHex(nodeId(waterRec)) },
      { file: `${GALLERY}/popular/caffeine.xyz`, xyz: caffeine.xyz, record: toHex(caffeineRec), id: toHex(nodeId(caffeineRec)) },
    ],
    records: recordList,
    resolutions: views,
    formatting: formattingRows,
    arithmetic,
    comparisons,
    approximations,
    scientific: scientificRows,
    packs: { small: packJson('small', small), bundled: packJson('lupi-scale-r1', bundled), withDependencies: packJson('caffeine with two dependencies', withDeps) },
    references,
    grow: [
      { name: 'water, the first tap', seed: toHex(nodeId(waterRec)), record: toHex(grow1), periods: GROW.map(big) },
      { name: 'caffeine, the first tap', seed: toHex(nodeId(caffeineRec)), record: toHex(caffeineGrown), periods: CAFFEINE_GROW.map(big) },
    ],
    partition: {
      single: (() => {
        const part = bakePartition(Uint8Array.from([8, 1, 1]), water.leaf.positions);
        return { input: 'the water leaf', root: toHex(part.root), records: part.records.length };
      })(),
      procedural: proceduralPartition(0x5ca1en, 4096 * 10 + 123),
      massive1m: m1,
    },
    rejections: rejections(small),
  };

  anchor('CRC-32', () => fixtures.primitives.crc32[0].crc32, 'cbf43926');
  anchor('SplitMix64', () => splitmix[0].outputs[2], '0x06c45d188009454f');
  anchor('BigUInt concatenation', () => concatHex, '00000100010100ff020000012a00000000000000000000000000108f2ea80843b2aa7c1a218e40ce8af30bcec484270beb7cc39425ad4912');
  anchor('water', () => toHex(nodeId(waterRec)), '8985f649ff0866084daa120d8b4a02db7124823d408d32487a63bb870b3a553a');
  anchor('caffeine', () => toHex(nodeId(caffeineRec)), '54c3bbfb50de8c1f7a11af255980822b2be57d1eff18908046ccabee382fcc84');
  anchor('salt seed', () => toHex(saltId), '2ef8502fcd22e4b098c57e85c0bd1b6793ff8be13f9b330d0017f1c9561e3f3e');
  anchor('copper billion', () => toHex(nodeId(cuOpen)), '42e22db697e0f938556fc8249e423ed986daa0c0ec08aa391afa67d4ad3cf421');
  anchor('diamondoid 12 leaf', () => String(views.find((v) => v.name === 'diamondoid 12')?.view?.probe), 'a58f2906169bd197fb51a4b19dae430a3f5a6b304c5880f6ebe7d99e3c8a5acc');
  anchor('googolplex', () => toHex(gpId), 'a10e2103622970045012eb530843be4ef0a080b1c21e5265e294cb440c3e5759');
  anchor('grain probe', () => String(views.find((v) => v.name === 'googolplex, the grain')?.view?.probe), '449611ace7889516d11722ee8da078a5e4b697c89e4ef7854dd9118497df80ad');
  anchor('grain refKey', () => references[2].refKey, 'ebfdf60d1a694e092141c1c6d2838e2af7e7194f711e66855110a0186ce7ad1d');
  anchor('edit with the grain removed', () => toHex(nodeId(edit9g)), '29beccfd91e84c70e305e6f1743c57d7b7c5bac0b21354ddbd7b3d44d265a254');
  anchor('removal inside a seed copy', () => toHex(nodeId(partialEdit)), 'ee3b568af6b6583687b1efe9e65f7e472541e052eb03ec54935a56becfb6c4d2');
  anchor('tower of towers', () => toHex(nodeId(towerOfTower)), '6bff9b557dcb5058dcb4126f001f7415a617e43e3bf31e3922c6adeea4d3bfa6');
  anchor('Grow ×2, 100', () => toHex(nodeId(grow100)), '56f05f1af0f47e8b00834c5742f6e6e7b4ad7a1f63b31cadb476ed79a5610aac');
  anchor('format googolplex − 1000', () => String(formattingRows[12].text), '10^(10^100) − 1,000');
  anchor('small pack', () => fixtures.packs.small.contentId, 'a91476434956a8fc564e9328db078a20864d0053e674734e89da55b4675f6256');
  anchor('bundled pack', () => fixtures.packs.bundled.fileSha256, 'd5f1d7ba69da089b970e7f1cdfe1f6e530c17d006c268ceee4bad0cd795a2794');
  anchor('massive_1m root', () => m1.root, '08588107c1be69ef9816bb4226c25e65b2dae3d2da2edf3fb9420fff76664cca');
  anchor('massive_1m pack', () => m1.pack.fileSha256, 'b12f3e7a79ac58774e4b79b0066b08f91f79a669816c672d3748b978177e9b85');
  anchor('massive_1m keep', () => String(m1.firstLeafKeep.bytes), '55171');
  for (const [what, value, expected] of ANCHORS) {
    const got = value();
    if (got !== expected) throw new Error(`§12 anchor ${what}: got ${got}, expected ${expected}`);
  }
  return fixtures;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = `${JSON.stringify(await buildScaleFixtures(), null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error(`${path.relative(ROOT, OUT)} is stale: run pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${(text.length / 1024).toFixed(0)} KB, ${ANCHORS.length} §12 anchors reproduced)`);
  }
}
