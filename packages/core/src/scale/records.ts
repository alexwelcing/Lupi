// Node records (scale-spec §2): the five kinds, their exact bytes, and the
// context-free rules a reader enforces. NodeID = SHA-256 of the record.

import { bigUIntBytes, bitLength, compareBytes, fail, Reader, ScaleError, toHex, Writer } from './bytes';
import { sha256 } from './hash';
import { decodePath, encodePath, type Step } from './paths';

export type NodeID = Uint8Array;

export const RECORD_MAX_BYTES = 65536;
export const LEAF_MAX_ATOMS = 4096;
export const LEAF_MAX_COORD = 2 ** 20;
export const GROUP_MAX_CHILDREN = 256;
export const GROUP_MAX_TRANSLATION = 2 ** 40;
export const CRYSTAL_MAX_CELLS = 1n << 60n;
export const CRYSTAL_MAX_ASPECT = 1n << 16n;
export const Q16_MAX = 2 ** 20;
export const CAPPED_MAX_SIZE = 12;
export const PERIOD_MAX = 1n << 40n;
export const EDIT_MAX_REMOVALS = 256;
export const MAX_Z = 118;

export const KIND = { leaf: 1, group: 2, crystal: 3, tower: 4, edit: 5 } as const;
export type KindName = keyof typeof KIND;

export interface LeafNode {
  kind: 'leaf';
  /** Atomic numbers, in source order. */
  z: Uint8Array;
  /** x, y, z per atom, in Å, Float32 as stored. */
  positions: Float32Array;
}

export interface GroupChild {
  id: NodeID;
  /** qx, qy, qz, qw: a unit quaternion, qw the scalar part. */
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

export interface GroupNode {
  kind: 'group';
  children: GroupChild[];
}

export type Structure = 1 | 2 | 3 | 4 | 5;
export const STRUCTURE = { sc: 1, bcc: 2, fcc: 3, diamond: 4, rocksalt: 5 } as const;
export const TERMINATION = { open: 0, closed: 1, capped: 2 } as const;

export interface CrystalNode {
  kind: 'crystal';
  structure: Structure;
  termination: 0 | 1 | 2;
  a: number;
  /** 0 means "same as A". */
  b: number;
  /** A quarter of the cubic lattice constant, Q16. */
  quarter: number;
  cells: [bigint, bigint, bigint];
  capZ: number;
  capOffset: number;
}

export interface Substitution {
  fromZ: number;
  toZ: number;
  perCopy: number;
}

export type Vec3n = [bigint, bigint, bigint];

export interface TowerNode {
  kind: 'tower';
  seed: NodeID;
  factor: number;
  /** p0, p1, p2 in Q16 of the seed's frame. */
  periods: [Vec3n, Vec3n, Vec3n];
  levels: bigint;
  substitution?: Substitution;
}

export interface EditNode {
  kind: 'edit';
  base: NodeID;
  removed: Step[][];
}

export type Node = LeafNode | GroupNode | CrystalNode | TowerNode | EditNode;

export interface DecodedRecord {
  bytes: Uint8Array;
  id: NodeID;
  kind: number;
  kindVersion: number;
  /** null: an unknown kind or version, kept opaque (§2.7). */
  node: Node | null;
}

export function nodeId(record: Uint8Array): NodeID {
  return sha256(record);
}

export const idHex = toHex;

export const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

// ─── Shared checks ────────────────────────────────────────────────────

/** §2.3: ((qx² + qy²) + qz²) + qw², left to right in binary64. */
export function quaternionNormOk(q: readonly number[]): boolean {
  const s = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  return Math.abs(s - 1) <= 2 ** -30;
}

export function quaternionCanonical(q: readonly number[]): boolean {
  if (q[3] > 0) return true;
  if (q[3] < 0) return false;
  for (let i = 0; i < 3; i += 1) {
    if (q[i] !== 0) return q[i] > 0;
  }
  return false;
}

/** Writers negate a non-canonical quaternion (§2.3). */
export function canonicalQuaternion(q: readonly number[]): [number, number, number, number] {
  const out = [q[0], q[1], q[2], q[3]].map((v) => (v === 0 ? 0 : v)) as [number, number, number, number];
  return quaternionCanonical(out) ? out : (out.map((v) => (v === 0 ? 0 : -v)) as [number, number, number, number]);
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

function cross(p: Vec3n, q: Vec3n): Vec3n {
  return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
}

const dot = (p: Vec3n, q: Vec3n): bigint => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** §2.5: det = p0 · (p1 × p2), exact. */
export function periodDeterminant(periods: readonly Vec3n[]): bigint {
  return dot(periods[0], cross(periods[1], periods[2]));
}

/** §2.5: the period cell is at most 2¹² times longer than it is wide. */
export function periodsSlenderOk(periods: readonly Vec3n[]): boolean {
  const det = periodDeterminant(periods);
  const det2 = det * det;
  let longest = 0n;
  for (const p of periods) {
    const l = dot(p, p);
    if (l > longest) longest = l;
  }
  for (let a = 0; a < 3; a += 1) {
    const c = cross(periods[(a + 1) % 3], periods[(a + 2) % 3]);
    if (longest * dot(c, c) > (1n << 24n) * det2) return false;
  }
  return true;
}

function checkZ(z: number, what: string): void {
  if (!Number.isInteger(z) || z < 1 || z > MAX_Z) fail('range', `${what} ${z}`);
}

function checkCrystal(c: CrystalNode): void {
  if (![1, 2, 3, 4, 5].includes(c.structure)) fail('range', 'crystal structure');
  if (![0, 1, 2].includes(c.termination)) fail('range', 'crystal termination');
  checkZ(c.a, 'species A');
  if (!Number.isInteger(c.b) || c.b < 0 || c.b > MAX_Z) fail('range', 'species B');
  if ((c.structure === 1 || c.structure === 3) && c.b !== 0) fail('validity', 'sc and fcc have one species');
  if (c.structure === 5 && c.b === 0) fail('validity', 'rock salt needs B');
  if (!Number.isInteger(c.quarter) || c.quarter < 1 || c.quarter > Q16_MAX) fail('range', 'quarter');
  for (const n of c.cells) if (n < 1n || n > CRYSTAL_MAX_CELLS) fail('range', 'crystal cells');
  const max = c.cells.reduce((m, n) => (n > m ? n : m));
  const min = c.cells.reduce((m, n) => (n < m ? n : m));
  if (max > CRYSTAL_MAX_ASPECT * min) fail('validity', 'crystal aspect over 2^16');
  if (c.termination === 2) {
    if (c.structure !== 4) fail('validity', 'capped needs diamond');
    if (c.cells[0] !== c.cells[1] || c.cells[1] !== c.cells[2]) fail('validity', 'capped needs a cube');
    if (c.cells[0] > BigInt(CAPPED_MAX_SIZE)) fail('range', 'capped size over 12');
    checkZ(c.capZ, 'capZ');
    if (!Number.isInteger(c.capOffset) || c.capOffset < 1 || c.capOffset > Q16_MAX) fail('range', 'capOffset');
  } else if (c.capZ !== 0 || c.capOffset !== 0) {
    fail('canonical', 'capZ and capOffset are 0 unless capped');
  }
}

function checkTower(t: TowerNode): void {
  if (t.seed.length !== 32) fail('range', 'seed NodeID');
  if (!Number.isInteger(t.factor) || t.factor < 2 || t.factor > 16) fail('range', 'tower factor');
  for (const p of t.periods) for (const v of p) if (abs(v) > PERIOD_MAX) fail('range', 'period component');
  if (periodDeterminant(t.periods) === 0n) fail('validity', 'periods are not independent');
  if (!periodsSlenderOk(t.periods)) fail('validity', 'period cell too slender');
  if (t.levels < 0n || bitLength(t.levels) > 65536) fail('limit', 'tower levels');
  const s = t.substitution;
  if (s) {
    checkZ(s.fromZ, 'fromZ');
    checkZ(s.toZ, 'toZ');
    if (s.fromZ === s.toZ) fail('validity', 'substitution to the same element');
    if (!Number.isInteger(s.perCopy) || s.perCopy < 1 || s.perCopy > 4096) fail('range', 'perCopy');
  }
}

// ─── Encoding ─────────────────────────────────────────────────────────

function header(w: Writer, kind: number, bodyLength: number): void {
  w.u8(0x4c).u8(0x55).u8(0x50).u8(0x4e).u8(kind).u8(1).u16(0).u32(bodyLength);
}

function finishRecord(w: Writer): Uint8Array {
  const bytes = w.finish();
  if (bytes.length > RECORD_MAX_BYTES) fail('limit', 'record over 65,536 bytes');
  return bytes;
}

export function encodeRecord(node: Node): Uint8Array {
  switch (node.kind) {
    case 'leaf': {
      const n = node.z.length;
      if (n < 1 || n > LEAF_MAX_ATOMS) fail('range', 'leaf atom count');
      if (node.positions.length !== 3 * n) fail('range', 'leaf positions');
      const pad = (4 - ((16 + n) % 4)) % 4;
      const w = new Writer(16 + n + pad + 12 * n);
      header(w, KIND.leaf, 4 + n + pad + 12 * n);
      w.u32(n);
      for (let i = 0; i < n; i += 1) checkZ(node.z[i], 'atomic number');
      w.bytes(node.z);
      w.zeros(pad);
      for (let i = 0; i < 3 * n; i += 1) {
        const x = node.positions[i];
        if (!(Math.abs(x) <= LEAF_MAX_COORD)) fail('range', 'leaf coordinate');
        w.f32(x);
      }
      return finishRecord(w);
    }
    case 'group': {
      const c = node.children.length;
      if (c < 1 || c > GROUP_MAX_CHILDREN) fail('range', 'group child count');
      const w = new Writer(16 + 88 * c);
      header(w, KIND.group, 4 + 88 * c);
      w.u16(c).u16(0);
      for (const child of node.children) {
        if (child.id.length !== 32) fail('range', 'child NodeID');
        const q = canonicalQuaternion(child.rotation);
        if (!quaternionNormOk(q)) fail('validity', 'rotation is not a unit quaternion');
        for (const t of child.translation) {
          if (!(Math.abs(t) <= GROUP_MAX_TRANSLATION)) fail('range', 'group translation');
        }
        w.bytes(child.id);
        for (const v of q) w.f64(v);
        for (const v of child.translation) w.f64(v);
      }
      return finishRecord(w);
    }
    case 'crystal': {
      checkCrystal(node);
      const w = new Writer(52);
      header(w, KIND.crystal, 40);
      w.u8(node.structure).u8(node.termination).u8(node.a).u8(node.b).u32(node.quarter);
      for (const n of node.cells) w.u64(n);
      w.u8(node.capZ).zeros(3).u32(node.capOffset);
      return finishRecord(w);
    }
    case 'tower': {
      checkTower(node);
      const k = bigUIntBytes(node.levels).length;
      const sub = node.substitution;
      const w = new Writer(122 + k + 4);
      header(w, KIND.tower, 110 + k + (sub ? 4 : 0));
      w.bytes(node.seed).u8(node.factor).u8(sub ? 1 : 0).u16(0);
      for (const p of node.periods) for (const v of p) w.i64(v);
      w.bigUInt(node.levels);
      if (sub) w.u8(sub.fromZ).u8(sub.toZ).u16(sub.perCopy);
      return finishRecord(w);
    }
    case 'edit': {
      const r = node.removed.length;
      if (r < 1 || r > EDIT_MAX_REMOVALS) fail('range', 'edit removal count');
      if (node.base.length !== 32) fail('range', 'base NodeID');
      const encoded = node.removed.map((p) => encodePath(p)).sort(compareBytes);
      for (let i = 1; i < encoded.length; i += 1) {
        if (compareBytes(encoded[i - 1], encoded[i]) === 0) fail('canonical', 'duplicate removal');
      }
      const body = 36 + encoded.reduce((s, e) => s + 4 + e.length, 0);
      const w = new Writer(12 + body);
      header(w, KIND.edit, body);
      w.bytes(node.base).u16(r).u16(0);
      for (const e of encoded) w.u32(e.length).bytes(e);
      return finishRecord(w);
    }
  }
}

// ─── Decoding ─────────────────────────────────────────────────────────

/** Decodes and validates a record under §2 (context-free rules). Throws ScaleError. */
export function decodeRecord(record: Uint8Array): DecodedRecord {
  if (record.length > RECORD_MAX_BYTES) fail('limit', 'record over 65,536 bytes');
  const r = new Reader(record);
  if (record.length < 12) fail('truncated', 'record header');
  if (record[0] !== 0x4c || record[1] !== 0x55 || record[2] !== 0x50 || record[3] !== 0x4e) fail('magic', 'not LUPN');
  r.offset = 4;
  const kind = r.u8();
  const kindVersion = r.u8();
  const flags = r.u16();
  const bodyLength = r.u32();
  if (12 + bodyLength !== record.length) fail(12 + bodyLength > record.length ? 'truncated' : 'canonical', 'bodyLength');
  const id = nodeId(record);
  const known = kind >= 1 && kind <= 5 && kindVersion === 1;
  if (!known) return { bytes: record, id, kind, kindVersion, node: null };
  if (flags !== 0) fail('canonical', 'record flags');
  const node = decodeBody(kind, r);
  r.done();
  return { bytes: record, id, kind, kindVersion, node };
}

function decodeBody(kind: number, r: Reader): Node {
  switch (kind) {
    case KIND.leaf: {
      const n = r.u32();
      if (n < 1 || n > LEAF_MAX_ATOMS) fail('range', 'leaf atom count');
      const z = r.raw(n).slice();
      for (const v of z) checkZ(v, 'atomic number');
      r.zeros((4 - ((16 + n) % 4)) % 4, 'padding');
      const positions = new Float32Array(3 * n);
      for (let i = 0; i < 3 * n; i += 1) {
        const x = r.f32();
        if (Math.abs(x) > LEAF_MAX_COORD) fail('range', 'leaf coordinate');
        positions[i] = x;
      }
      return { kind: 'leaf', z, positions };
    }
    case KIND.group: {
      const c = r.u16();
      if (c < 1 || c > GROUP_MAX_CHILDREN) fail('range', 'group child count');
      r.zeros(2);
      const children: GroupChild[] = [];
      for (let i = 0; i < c; i += 1) {
        const id = r.raw(32).slice();
        const rotation = [r.f64(), r.f64(), r.f64(), r.f64()] as [number, number, number, number];
        if (!quaternionNormOk(rotation)) fail('validity', 'rotation is not a unit quaternion');
        if (!quaternionCanonical(rotation)) fail('canonical', 'quaternion sign');
        const translation = [r.f64(), r.f64(), r.f64()] as [number, number, number];
        for (const t of translation) if (Math.abs(t) > GROUP_MAX_TRANSLATION) fail('range', 'group translation');
        children.push({ id, rotation, translation });
      }
      return { kind: 'group', children };
    }
    case KIND.crystal: {
      const structure = r.u8() as Structure;
      const termination = r.u8() as 0 | 1 | 2;
      const a = r.u8();
      const b = r.u8();
      const quarter = r.u32();
      const cells: [bigint, bigint, bigint] = [r.u64(), r.u64(), r.u64()];
      const capZ = r.u8();
      r.zeros(3);
      const capOffset = r.u32();
      const node: CrystalNode = { kind: 'crystal', structure, termination, a, b, quarter, cells, capZ, capOffset };
      checkCrystal(node);
      return node;
    }
    case KIND.tower: {
      const seed = r.raw(32).slice();
      const factor = r.u8();
      const flags = r.u8();
      if (flags & ~1) fail('canonical', 'tower flags');
      r.zeros(2);
      const periods = [0, 1, 2].map(() => [r.i64(), r.i64(), r.i64()]) as [Vec3n, Vec3n, Vec3n];
      const levels = r.bigUInt();
      const node: TowerNode = { kind: 'tower', seed, factor, periods, levels };
      if (flags & 1) node.substitution = { fromZ: r.u8(), toZ: r.u8(), perCopy: r.u16() };
      checkTower(node);
      return node;
    }
    case KIND.edit: {
      const base = r.raw(32).slice();
      const count = r.u16();
      if (count < 1 || count > EDIT_MAX_REMOVALS) fail('range', 'edit removal count');
      r.zeros(2);
      const removed: Step[][] = [];
      let previous: Uint8Array | null = null;
      for (let i = 0; i < count; i += 1) {
        const length = r.u32();
        const bytes = r.raw(length);
        const steps = decodePath(bytes);
        if (previous && compareBytes(previous, bytes) >= 0) fail('canonical', 'removals not strictly ascending');
        previous = bytes;
        removed.push(steps);
      }
      return { kind: 'edit', base, removed };
    }
    default:
      return fail('unsupported', `kind ${kind}`);
  }
}

/** Decode, and assert the bytes re-encode identically (a reader's simplest canonical check). */
export function roundTrips(record: Uint8Array): boolean {
  try {
    const d = decodeRecord(record);
    return d.node === null || compareBytes(encodeRecord(d.node), record) === 0;
  } catch (e) {
    if (e instanceof ScaleError) return false;
    throw e;
  }
}

