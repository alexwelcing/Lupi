// lupi.scale-ref.v1 (scale-spec §7): one piece named by a root and a path,
// with the records its resolution reads embedded, so a trophy regenerates
// identically on any device, forever.

import { base64url, compareBytes, concatBytes, fail, fromBase64url, Reader, ScaleError, toHex, Writer } from './bytes';
import { DOMAIN_REF, sha256 } from './hash';
import type { Magnitude } from './magnitude';
import { encodePath, readPath, type Step } from './paths';
import { decodeRecord, encodeRecord, nodeId, type DecodedRecord, type NodeID } from './records';
import { ChainStore, MemoryStore, Resolver, TrackingStore, type NodeStore, type View } from './resolve';

export const REF_MAX_BYTES = 163840;
export const REF_MAX_RECORDS = 255;
export const REF_MAX_DEPS = 255;
export const REF_TEXT_PREFIX = 'lsr1:';

export interface ScaleRef {
  root: NodeID;
  /** Embedded records (any order; encodeRef sorts them by NodeID). */
  records: Uint8Array[];
  /** contentIds of packs that hold the other records. */
  deps: NodeID[];
  path: Step[];
  probe: NodeID | null;
}

/** refKey = SHA-256("lupi.scale.ref.v1" ‖ 0x00 ‖ rootID ‖ path bytes): the piece, whatever is embedded. */
export function refKey(root: NodeID, pathBytes: Uint8Array): NodeID {
  return sha256(concatBytes([DOMAIN_REF, root, pathBytes]));
}

export function encodeRef(ref: ScaleRef): Uint8Array {
  if (ref.root.length !== 32) fail('range', 'root NodeID');
  const byId = new Map<string, { id: NodeID; bytes: Uint8Array }>();
  for (const bytes of ref.records) byId.set(toHex(nodeId(bytes)), { id: nodeId(bytes), bytes });
  const records = [...byId.values()].sort((a, b) => compareBytes(a.id, b.id));
  const deps = [...new Map(ref.deps.map((d) => [toHex(d), d])).values()].sort(compareBytes);
  if (records.length > REF_MAX_RECORDS) fail('limit', 'more than 255 embedded records');
  if (deps.length > REF_MAX_DEPS) fail('limit', 'more than 255 dependencies');
  const w = new Writer(256);
  w.u8(0x4c).u8(0x53).u8(0x52).u8(1).u8(ref.probe ? 1 : 0).u8(records.length).u8(deps.length).u8(0);
  w.bytes(ref.root);
  for (const r of records) w.u32(r.bytes.length).bytes(r.bytes);
  for (const d of deps) w.bytes(d);
  w.bytes(encodePath(ref.path));
  if (ref.probe) w.bytes(ref.probe);
  const bytes = w.finish();
  if (bytes.length > REF_MAX_BYTES) fail('limit', 'reference over 163,840 bytes');
  return bytes;
}

export interface DecodedRef extends ScaleRef {
  decoded: DecodedRecord[];
  pathBytes: Uint8Array;
  key: NodeID;
}

/** §7.3 step 1: canonical layout, sorted records and dependencies, canonical path, nothing trailing. */
export function decodeRef(bytes: Uint8Array): DecodedRef {
  if (bytes.length > REF_MAX_BYTES) fail('limit', 'reference over 163,840 bytes');
  const r = new Reader(bytes);
  if (bytes.length < 8) fail('truncated', 'reference header');
  if (bytes[0] !== 0x4c || bytes[1] !== 0x53 || bytes[2] !== 0x52) fail('magic', 'not LSR');
  r.offset = 3;
  if (r.u8() !== 1) fail('version', 'reference version');
  const flags = r.u8();
  if (flags & ~1) fail('canonical', 'reference flags');
  const recordCount = r.u8();
  const depCount = r.u8();
  r.zeros(1);
  const root = r.raw(32).slice();
  const decoded: DecodedRecord[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const n = r.u32();
    const d = decodeRecord(r.raw(n).slice());
    if (i > 0 && compareBytes(decoded[i - 1].id, d.id) >= 0) fail('canonical', 'embedded records not strictly ascending');
    decoded.push(d);
  }
  const deps: NodeID[] = [];
  for (let i = 0; i < depCount; i += 1) {
    const d = r.raw(32).slice();
    if (i > 0 && compareBytes(deps[i - 1], d) >= 0) fail('canonical', 'dependencies not strictly ascending');
    deps.push(d);
  }
  const pathStart = r.offset;
  const path = readPath(r);
  const pathBytes = bytes.slice(pathStart, r.offset);
  const probe = flags & 1 ? r.raw(32).slice() : null;
  r.done();
  return {
    root,
    records: decoded.map((d) => d.bytes),
    deps,
    path,
    probe,
    decoded,
    pathBytes,
    key: refKey(root, pathBytes),
  };
}

export const refText = (bytes: Uint8Array): string => `${REF_TEXT_PREFIX}${base64url(bytes)}`;

export function refFromText(text: string): Uint8Array {
  if (!text.startsWith(REF_TEXT_PREFIX)) fail('magic', 'not lsr1:');
  const bytes = fromBase64url(text.slice(REF_TEXT_PREFIX.length));
  if (bytes.length > REF_MAX_BYTES) fail('limit', 'reference over 163,840 bytes');
  return bytes;
}

/** §7.3: decode, build the store, resolve, and check the probe. */
export function resolveRef(bytes: Uint8Array, extra?: NodeStore): { view: View; count: Magnitude; resolver: Resolver; ref: DecodedRef } {
  const ref = decodeRef(bytes);
  const embedded = new MemoryStore(ref.decoded);
  const resolver = new Resolver(extra ? new ChainStore([embedded, extra]) : embedded);
  const view = resolver.resolve(ref.root, ref.path);
  const count = resolver.count(view);
  const materializable = resolver.isMaterializable(view);
  if (materializable !== (ref.probe !== null)) fail('mismatch', 'the probe is present exactly when the target is materializable');
  if (ref.probe && compareBytes(resolver.probe(view), ref.probe) !== 0) fail('mismatch', 'probe');
  return { view, count, resolver, ref };
}

/**
 * §7.2: embeds every record that resolving the reference reads. With
 * `deps`, a target of more than 4,096 atoms may leave its leaves and groups
 * to those packs; generator records are always embedded. A reference that
 * would not fit falls back to the target's own leaf, or fails with `limit`.
 */
export function writeRef(opts: { root: NodeID; path: Step[]; store: NodeStore; deps?: NodeID[] }): Uint8Array {
  const tracking = new TrackingStore(opts.store);
  const resolver = new Resolver(tracking);
  const view = resolver.resolve(opts.root, opts.path);
  const count = resolver.count(view);
  const materializable = resolver.isMaterializable(view);
  const probe = materializable ? resolver.probe(view) : null;
  const small = count.plain !== null && count.plain <= 4096n;
  const leaveToPacks = !small && (opts.deps?.length ?? 0) > 0;
  const records = [...tracking.read.values()]
    .filter((d) => !leaveToPacks || !(d.kind === 1 || d.kind === 2))
    .map((d) => d.bytes);
  try {
    encodePath(opts.path);
    return encodeRef({ root: opts.root, records, deps: leaveToPacks ? opts.deps! : [], path: opts.path, probe });
  } catch (e) {
    if (!(e instanceof ScaleError && e.code === 'limit')) throw e;
    if (!(small && materializable)) fail('limit', 'This piece is too intricate to keep');
    const leaf = encodeRecord(resolver.materialize(view));
    return encodeRef({ root: nodeId(leaf), records: [leaf], deps: [], path: [], probe: nodeId(leaf) });
  }
}

