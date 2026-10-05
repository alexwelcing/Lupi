// lupi.bake.partition@1 (scale-spec §3.6): explicit atoms of any size into
// leaves and groups, integer-only so a web build and a device import
// produce the same NodeIDs. Positions are never re-centred or re-quantized.

import { fail, toHex } from './bytes';
import { encodeRecord, IDENTITY_ROTATION, LEAF_MAX_ATOMS, LEAF_MAX_COORD, MAX_Z, nodeId, type NodeID } from './records';

const GROUP_FAN = 8;

/** The 63-bit Morton key of §3.6 as a bigint, the reference form the radix sort below must match. */
export function mortonKeyBig(u: readonly number[], shift: number): bigint {
  let key = 0n;
  for (let a = 0; a < 3; a += 1) {
    const v = BigInt(Math.floor(u[a] / 2 ** shift));
    for (let b = 0; b < 21; b += 1) key |= ((v >> BigInt(b)) & 1n) << BigInt(3 * b + a);
  }
  return key;
}

/** Bit b of an 11-bit (or 10-bit) value moved to bit 3b: the per-axis Morton spread. */
const SPREAD = (() => {
  const t = new Uint32Array(1 << 11);
  for (let x = 0; x < t.length; x += 1) {
    let s = 0;
    for (let b = 0; b < 11; b += 1) if ((x >> b) & 1) s += 2 ** (3 * b);
    t[x] = s;
  }
  return t;
})();

/**
 * The source indices ordered by (Morton key, source index). The 63-bit key
 * is split exactly into a low 33-bit and a high 30-bit Number half, and a
 * stable LSD radix sort over both halves keeps equal keys in source order.
 * `u` never meets a 32-bit operator: it is scaled with Math.floor first.
 */
export function partitionOrder(positions: Float32Array, n: number): Uint32Array {
  const q = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const min = [Infinity, Infinity, Infinity];
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const x = positions[3 * i + a];
      if (!(Math.abs(x) <= LEAF_MAX_COORD)) fail('range', 'a bake position beyond 2^20 Å');
      // Exact: a Float32 value times a power of two, then floor.
      const v = Math.floor(x * 1024);
      q[a][i] = v;
      if (v < min[a]) min[a] = v;
    }
  }
  let max = 0;
  for (let a = 0; a < 3; a += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = q[a][i] - min[a];
      q[a][i] = u;
      if (u > max) max = u;
    }
  }
  // B, the exact bit length of the largest u (below 2^32, so powers of two are exact).
  let bits = 0;
  while (2 ** bits <= max) bits += 1;
  const scale = 2 ** Math.max(0, bits - 21);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let low = 0;
    let high = 0;
    for (let a = 0; a < 3; a += 1) {
      const v = Math.floor(q[a][i] / scale); // < 2^21
      const vLow = v % 2048;
      const vHigh = (v - vLow) / 2048;
      low += SPREAD[vLow] * 2 ** a;
      high += SPREAD[vHigh] * 2 ** a;
    }
    lo[i] = low; // bits 0…32 of the key
    hi[i] = high; // bits 33…62
  }
  let order = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;
  let next = new Uint32Array(n);
  const counts = new Uint32Array(2048);
  const passes: Array<[Float64Array, number, number]> = [
    [lo, 1, 2048], [lo, 2048, 2048], [lo, 2048 * 2048, 2048],
    [hi, 1, 1024], [hi, 1024, 1024], [hi, 1024 * 1024, 1024],
  ];
  for (const [keys, div, radix] of passes) {
    counts.fill(0);
    for (let i = 0; i < n; i += 1) counts[Math.floor(keys[order[i]] / div) % radix] += 1;
    let sum = 0;
    for (let d = 0; d < radix; d += 1) {
      const c = counts[d];
      counts[d] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i += 1) {
      const idx = order[i];
      const d = Math.floor(keys[idx] / div) % radix;
      next[counts[d]] = idx;
      counts[d] += 1;
    }
    [order, next] = [next, order];
  }
  return order;
}

export interface PartitionResult {
  /** Every distinct record, leaves then groups, in creation order. */
  records: Uint8Array[];
  root: NodeID;
  leaves: number;
  groups: number;
  depth: number;
}

/** §3.6: N ≤ 4,096 is one leaf in source order; else Morton-ordered leaves of 4,096, then groups of 8. */
export function bakePartition(z: Uint8Array, positions: Float32Array): PartitionResult {
  const n = z.length;
  if (n < 1) fail('range', 'nothing to bake');
  if (positions.length !== 3 * n) fail('range', 'positions do not match the atoms');
  for (let i = 0; i < n; i += 1) if (z[i] < 1 || z[i] > MAX_Z) fail('range', `atomic number ${z[i]}`);
  const records: Uint8Array[] = [];
  const seen = new Set<string>();
  const keep = (bytes: Uint8Array): NodeID => {
    const id = nodeId(bytes);
    const key = toHex(id);
    if (!seen.has(key)) {
      seen.add(key);
      records.push(bytes);
    }
    return id;
  };
  if (n <= LEAF_MAX_ATOMS) {
    const id = keep(encodeRecord({ kind: 'leaf', z, positions }));
    return { records, root: id, leaves: 1, groups: 0, depth: 1 };
  }
  const order = partitionOrder(positions, n);
  let level: NodeID[] = [];
  for (let start = 0; start < n; start += LEAF_MAX_ATOMS) {
    const count = Math.min(LEAF_MAX_ATOMS, n - start);
    const lz = new Uint8Array(count);
    const lp = new Float32Array(3 * count);
    for (let j = 0; j < count; j += 1) {
      const i = order[start + j];
      lz[j] = z[i];
      lp[3 * j] = positions[3 * i];
      lp[3 * j + 1] = positions[3 * i + 1];
      lp[3 * j + 2] = positions[3 * i + 2];
    }
    level.push(keep(encodeRecord({ kind: 'leaf', z: lz, positions: lp })));
  }
  const leaves = level.length;
  let groups = 0;
  let depth = 1;
  while (level.length > 1) {
    const up: NodeID[] = [];
    for (let i = 0; i < level.length; i += GROUP_FAN) {
      const children = level.slice(i, i + GROUP_FAN).map((id) => ({
        id,
        rotation: [...IDENTITY_ROTATION] as [number, number, number, number],
        translation: [0, 0, 0] as [number, number, number],
      }));
      up.push(keep(encodeRecord({ kind: 'group', children })));
      groups += 1;
    }
    level = up;
    depth += 1;
  }
  return { records, root: level[0], leaves, groups, depth };
}
