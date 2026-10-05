// LupiPack v1 (scale-spec §6): an immutable, content-addressed bundle of
// node records in 16 KiB pages. The writer is deterministic (§6.5) and the
// reader enforces every rule of §6.6.

import { ASCII, compareBytes, concatBytes, fail, idKey, Reader, ScaleError, toHex, Writer } from './bytes';
import { crc32, DOMAIN_PACK, sha256, Sha256 } from './hash';
import { decodeRecord, nodeId, type DecodedRecord, type NodeID } from './records';
import type { NodeStore } from './resolve';

export const PAGE = 16384;
export const PACK_HEADER_SIZE = 128;
export const PACK_MAX_RECORDS = 1 << 22;
export const PACK_MAX_ROOTS = 4096;
export const PACK_MAX_DEPS = 256;
export const PACK_MAX_SECTIONS = 16;
export const PACK_MAX_BYTES = 2 ** 40;

export interface PackRoot {
  name: string;
  id: NodeID;
}

export interface PackSection {
  type: string;
  flags: number;
  offset: number;
  length: number;
  crc: number;
  version: number;
}

interface IndexEntry {
  id: NodeID;
  offset: number;
  length: number;
  kind: number;
  kindVersion: number;
}

const ROOT_NAME = /^[a-z0-9._-]{1,64}$/;

const pagesFor = (length: number): number => Math.max(1, Math.ceil(length / PAGE));

function rootSection(roots: readonly PackRoot[]): Uint8Array {
  const w = new Writer(64);
  w.u32(roots.length).u32(0);
  for (const r of roots) {
    const name = ASCII(r.name);
    w.bytes(r.id).u16(name.length).bytes(name);
    w.zeros((4 - ((34 + name.length) % 4)) % 4);
  }
  return w.finish();
}

function depsSection(deps: readonly NodeID[]): Uint8Array {
  const w = new Writer(8 + 32 * deps.length);
  w.u32(deps.length).u32(0);
  for (const d of deps) w.bytes(d);
  return w.finish();
}

/** §6.2.1: from the NodeIDs, ROOT and DEPS; never the layout. */
export function packContentId(ids: readonly NodeID[], root: Uint8Array | null, deps: Uint8Array | null): NodeID {
  const h = new Sha256();
  const u32 = (v: number) => new Writer(4).u32(v).finish();
  h.update(DOMAIN_PACK).update(u32(ids.length));
  for (const id of ids) h.update(id);
  h.update(u32(root ? root.length : 0));
  if (root) h.update(root);
  h.update(u32(deps ? deps.length : 0));
  if (deps) h.update(deps);
  return h.digest();
}

/** §6.5: identical bytes from the same records, roots and dependencies. */
export function writePack(
  records: readonly Uint8Array[],
  opts: { roots?: readonly PackRoot[]; deps?: readonly NodeID[] } = {},
): Uint8Array {
  const byId = new Map<string, { id: NodeID; bytes: Uint8Array; d: DecodedRecord }>();
  for (const bytes of records) {
    const d = decodeRecord(bytes);
    const key = toHex(d.id);
    const prior = byId.get(key);
    if (prior && compareBytes(prior.bytes, bytes) !== 0) fail('mismatch', 'two records share a NodeID');
    byId.set(key, { id: d.id, bytes, d });
  }
  const sorted = [...byId.values()].sort((a, b) => compareBytes(a.id, b.id));
  if (sorted.length < 1 || sorted.length > PACK_MAX_RECORDS) fail('limit', 'pack record count');

  const roots = [...(opts.roots ?? [])].sort((a, b) => compareBytes(ASCII(a.name), ASCII(b.name)));
  if (roots.length > PACK_MAX_ROOTS) fail('limit', 'more than 4,096 roots');
  for (let i = 0; i < roots.length; i += 1) {
    if (!ROOT_NAME.test(roots[i].name)) fail('range', `root name ${roots[i].name}`);
    if (i > 0 && roots[i].name === roots[i - 1].name) fail('canonical', 'duplicate root name');
    if (!byId.has(toHex(roots[i].id))) fail('missing', `root ${roots[i].name} is not in the pack`);
  }
  const deps = [...(opts.deps ?? [])].sort(compareBytes);
  if (deps.length > PACK_MAX_DEPS) fail('limit', 'more than 256 dependencies');
  for (let i = 1; i < deps.length; i += 1) if (compareBytes(deps[i - 1], deps[i]) === 0) fail('canonical', 'duplicate dependency');

  const nrecParts: Uint8Array[] = [];
  const nidx = new Writer(8 + 48 * sorted.length);
  nidx.u32(sorted.length).u32(0);
  let at = 0;
  sorted.forEach((r, i) => {
    if (i > 0) {
      const pad = (8 - (at % 8)) % 8;
      nrecParts.push(new Uint8Array(pad));
      at += pad;
    }
    nidx.bytes(r.id).u64(BigInt(at)).u32(r.bytes.length).u8(r.d.kind).u8(r.d.kindVersion).u16(0);
    nrecParts.push(r.bytes);
    at += r.bytes.length;
  });
  const sections: Array<{ type: string; data: Uint8Array }> = [
    { type: 'NIDX', data: nidx.finish() },
    { type: 'NREC', data: concatBytes(nrecParts) },
  ];
  const rootBytes = roots.length > 0 ? rootSection(roots) : null;
  const depBytes = deps.length > 0 ? depsSection(deps) : null;
  if (rootBytes) sections.push({ type: 'ROOT', data: rootBytes });
  if (depBytes) sections.push({ type: 'DEPS', data: depBytes });

  let offset = PAGE;
  const placed = sections.map((s) => {
    const p = { ...s, offset };
    offset += pagesFor(s.data.length) * PAGE;
    return p;
  });
  const fileLength = offset;
  if (fileLength > PACK_MAX_BYTES) fail('limit', 'pack over 2^40 bytes');
  const file = new Uint8Array(fileLength);
  const view = new DataView(file.buffer);

  const table = new Writer(32 * placed.length);
  for (const s of placed) {
    table.bytes(ASCII(s.type)).u32(1).u64(BigInt(s.offset)).u64(BigInt(s.data.length)).u32(crc32(s.data)).u16(1).u16(0);
    file.set(s.data, s.offset);
  }
  const tableBytes = table.finish();
  file.set(tableBytes, PACK_HEADER_SIZE);

  const contentId = packContentId(sorted.map((r) => r.id), rootBytes, depBytes);
  file.set(ASCII('LUPK'), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, PACK_HEADER_SIZE, true);
  view.setUint32(12, placed.length, true);
  view.setBigUint64(16, BigInt(PACK_HEADER_SIZE), true);
  view.setBigUint64(24, BigInt(fileLength), true);
  file.set(contentId, 32);
  view.setUint32(100, crc32(tableBytes), true);
  view.setUint32(124, crc32(file.subarray(0, 124)), true);
  return file;
}

export class Pack implements NodeStore {
  readonly bytes: Uint8Array;
  readonly contentId: NodeID;
  readonly versionMinor: number;
  readonly sections: PackSection[];
  readonly roots: PackRoot[];
  readonly deps: NodeID[];
  readonly ids: NodeID[];
  private readonly entries: IndexEntry[];
  private readonly byHex = new Map<string, number>();
  private readonly decoded = new Map<number, DecodedRecord>();
  private readonly nrecOffset: number;

  /** @internal: use readPack. */
  constructor(bytes: Uint8Array, parts: {
    contentId: NodeID; versionMinor: number; sections: PackSection[]; roots: PackRoot[]; deps: NodeID[];
    entries: IndexEntry[]; nrecOffset: number;
  }) {
    this.bytes = bytes;
    this.contentId = parts.contentId;
    this.versionMinor = parts.versionMinor;
    this.sections = parts.sections;
    this.roots = parts.roots;
    this.deps = parts.deps;
    this.entries = parts.entries;
    this.nrecOffset = parts.nrecOffset;
    this.ids = parts.entries.map((e) => e.id);
    parts.entries.forEach((e, i) => this.byHex.set(toHex(e.id), i));
  }

  has(id: NodeID): boolean {
    return this.byHex.has(idKey(id));
  }

  /** The record's bytes, its SHA-256 verified before first use (§6.6 rule 5). */
  recordBytes(id: NodeID): Uint8Array {
    return this.record(id).bytes;
  }

  record(id: NodeID): DecodedRecord {
    const i = this.byHex.get(idKey(id));
    if (i === undefined) fail('missing', `node ${toHex(id).slice(0, 16)}…`);
    return this.recordAt(i);
  }

  recordAt(i: number): DecodedRecord {
    const memo = this.decoded.get(i);
    if (memo) return memo;
    const e = this.entries[i];
    const start = this.nrecOffset + e.offset;
    const bytes = this.bytes.subarray(start, start + e.length);
    if (compareBytes(nodeId(bytes), e.id) !== 0) fail('mismatch', 'a record does not hash to its NodeID');
    const d = decodeRecord(bytes);
    this.decoded.set(i, d);
    return d;
  }

  /** Hashes and decodes every record (allowed at open time, §6.6 rule 5). */
  verifyAll(): this {
    for (let i = 0; i < this.entries.length; i += 1) this.recordAt(i);
    return this;
  }

  rootId(name: string): NodeID {
    const r = this.roots.find((x) => x.name === name);
    if (!r) fail('missing', `root ${name}`);
    return r.id;
  }
}

const isZero = (bytes: Uint8Array, from: number, to: number): boolean => {
  for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
  return true;
};

/** §6.6: rejects the pack unless every rule holds. Records are hashed on first use. */
export function readPack(bytes: Uint8Array, opts: { verifyAll?: boolean } = {}): Pack {
  if (bytes.length < PACK_HEADER_SIZE) fail('pack', 'shorter than its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new Reader(bytes);
  // 1. Header.
  if (bytes[0] !== 0x4c || bytes[1] !== 0x55 || bytes[2] !== 0x50 || bytes[3] !== 0x4b) fail('pack', 'not LUPK');
  if (view.getUint16(4, true) !== 1) fail('version', 'versionMajor');
  const versionMinor = view.getUint16(6, true);
  if (view.getUint32(8, true) !== PACK_HEADER_SIZE) fail('pack', 'headerSize');
  const sectionCount = view.getUint32(12, true);
  if (view.getBigUint64(16, true) !== BigInt(PACK_HEADER_SIZE)) fail('pack', 'sectionTableOffset');
  const fileLength = view.getBigUint64(24, true);
  if (fileLength !== BigInt(bytes.length) || bytes.length % PAGE !== 0) fail('pack', 'fileLength');
  if (sectionCount < 2 || sectionCount > PACK_MAX_SECTIONS) fail('pack', 'sectionCount');
  if (!isZero(bytes, 64, 100) || !isZero(bytes, 104, 124)) fail('pack', 'reserved bytes or flags');
  if (crc32(bytes.subarray(0, 124)) !== view.getUint32(124, true)) fail('crc', 'headerCrc');
  const contentId = bytes.slice(32, 64);

  // 2. Section table.
  const tableEnd = PACK_HEADER_SIZE + 32 * sectionCount;
  if (tableEnd > PAGE) fail('pack', 'section table past the first page');
  if (crc32(bytes.subarray(PACK_HEADER_SIZE, tableEnd)) !== view.getUint32(100, true)) fail('crc', 'tableCrc');
  if (!isZero(bytes, tableEnd, PAGE)) fail('pack', 'bytes after the section table');

  // 3. Each section.
  const sections: PackSection[] = [];
  const seen = new Set<string>();
  let end = PAGE;
  r.offset = PACK_HEADER_SIZE;
  for (let i = 0; i < sectionCount; i += 1) {
    const type = String.fromCharCode(...r.raw(4));
    const flags = r.u32();
    const offset = r.u64();
    const length = r.u64();
    const crc = r.u32();
    const version = r.u16();
    if (r.u16() !== 0) fail('pack', 'section reserved');
    if (offset % BigInt(PAGE) !== 0n || offset < BigInt(end)) fail('pack', `section ${type} offset`);
    if (offset + length > BigInt(bytes.length)) fail('pack', `section ${type} past the file`);
    const o = Number(offset);
    const n = Number(length);
    const pagesEnd = o + pagesFor(n) * PAGE;
    if (pagesEnd > bytes.length) fail('pack', `section ${type} pages past the file`);
    if (!isZero(bytes, end, o)) fail('pack', 'bytes between sections');
    if (!isZero(bytes, o + n, pagesEnd)) fail('pack', `section ${type} padding`);
    if (crc32(bytes.subarray(o, o + n)) !== crc) fail('crc', `section ${type}`);
    if (seen.has(type)) fail('pack', `section ${type} twice`);
    seen.add(type);
    sections.push({ type, flags, offset: o, length: n, crc, version });
    end = pagesEnd;
  }
  // §6.6 permits zero pages after the last section (§6.1: bytes between sections are zero).
  if (!isZero(bytes, end, bytes.length)) fail('pack', 'bytes after the last section');
  const known = new Map<string, PackSection>();
  for (const s of sections) {
    const isKnown = ['NIDX', 'NREC', 'ROOT', 'DEPS'].includes(s.type) && s.version === 1;
    if (isKnown) known.set(s.type, s);
    else if (s.flags & 1) fail('unsupported', `required section ${s.type} v${s.version}`);
  }

  // 4. NIDX and NREC.
  const nidx = known.get('NIDX');
  const nrec = known.get('NREC');
  if (!nidx || !nrec) fail('pack', 'NIDX and NREC are required');
  const ir = new Reader(bytes, nidx.offset, nidx.offset + nidx.length);
  const nodeCount = ir.u32();
  ir.zeros(4);
  if (nodeCount < 1 || nodeCount > PACK_MAX_RECORDS) fail('pack', 'nodeCount');
  if (nidx.length !== 8 + 48 * nodeCount) fail('pack', 'NIDX length');
  const entries: IndexEntry[] = [];
  let expect = 0;
  let prevEnd = 0;
  for (let i = 0; i < nodeCount; i += 1) {
    const id = ir.raw(32).slice();
    const offset = ir.u64();
    const length = ir.u32();
    const kind = ir.u8();
    const kindVersion = ir.u8();
    ir.zeros(2);
    if (i > 0 && compareBytes(entries[i - 1].id, id) >= 0) fail('pack', 'NIDX not strictly ascending');
    if (offset !== BigInt(expect)) fail('pack', 'records not packed in NIDX order');
    if (length < 12 || expect + length > nrec.length) fail('pack', 'record past NREC');
    if (!isZero(bytes, nrec.offset + prevEnd, nrec.offset + expect)) fail('pack', 'record padding');
    const rs = nrec.offset + expect;
    if (bytes[rs + 4] !== kind || bytes[rs + 5] !== kindVersion) fail('pack', 'NIDX kind or version');
    entries.push({ id, offset: expect, length, kind, kindVersion });
    prevEnd = expect + length;
    expect = i + 1 < nodeCount ? prevEnd + ((8 - (prevEnd % 8)) % 8) : prevEnd;
  }
  if (expect !== nrec.length) fail('pack', 'bytes after the last record');

  // 7. ROOT and DEPS.
  const rootSec = known.get('ROOT');
  const depSec = known.get('DEPS');
  const roots: PackRoot[] = [];
  const index = new Set(entries.map((e) => toHex(e.id)));
  if (rootSec) {
    const rr = new Reader(bytes, rootSec.offset, rootSec.offset + rootSec.length);
    const count = rr.u32();
    rr.zeros(4);
    if (count < 1 || count > PACK_MAX_ROOTS) fail('pack', 'rootCount');
    let prev: Uint8Array | null = null;
    for (let i = 0; i < count; i += 1) {
      const id = rr.raw(32).slice();
      const n = rr.u16();
      const nameBytes = rr.raw(n);
      rr.zeros((4 - ((34 + n) % 4)) % 4, 'root padding');
      const name = String.fromCharCode(...nameBytes);
      if (!ROOT_NAME.test(name)) fail('pack', `root name ${JSON.stringify(name)}`);
      if (prev && compareBytes(prev, nameBytes) >= 0) fail('pack', 'roots not strictly ascending');
      prev = nameBytes;
      if (!index.has(toHex(id))) fail('pack', `root ${name} is not in NIDX`);
      roots.push({ name, id });
    }
    rr.done();
  }
  const deps: NodeID[] = [];
  if (depSec) {
    const dr = new Reader(bytes, depSec.offset, depSec.offset + depSec.length);
    const count = dr.u32();
    dr.zeros(4);
    if (count < 1 || count > PACK_MAX_DEPS) fail('pack', 'depCount');
    for (let i = 0; i < count; i += 1) {
      const id = dr.raw(32).slice();
      if (i > 0 && compareBytes(deps[i - 1], id) >= 0) fail('pack', 'dependencies not strictly ascending');
      deps.push(id);
    }
    dr.done();
  }

  // 6. contentId.
  const recomputed = packContentId(
    entries.map((e) => e.id),
    rootSec ? bytes.subarray(rootSec.offset, rootSec.offset + rootSec.length) : null,
    depSec ? bytes.subarray(depSec.offset, depSec.offset + depSec.length) : null,
  );
  if (compareBytes(recomputed, contentId) !== 0) fail('mismatch', 'contentId');

  const pack = new Pack(bytes, { contentId, versionMinor, sections, roots, deps, entries, nrecOffset: nrec.offset });
  if (opts.verifyAll) pack.verifyAll();
  return pack;
}

/** The SHA-256 of a whole pack file: a further check, never an identity (§6.2.1). */
export const packFileHash = (bytes: Uint8Array): NodeID => sha256(bytes);

export function isPackError(e: unknown): e is ScaleError {
  return e instanceof ScaleError && ['pack', 'crc', 'version', 'unsupported', 'mismatch'].includes(e.code);
}
