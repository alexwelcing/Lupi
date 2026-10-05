// SHA-256 (FIPS 180-4), CRC-32/ISO-HDLC and SplitMix64 (scale-spec §1.5–§1.7).
// SHA-256 is written out here because crypto.subtle is asynchronous and every
// NodeID must be computable synchronously, in the browser and in node alike.

import { ASCII } from './bytes';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly w = new Uint32Array(64);
  private readonly block = new Uint8Array(64);
  private fill = 0;
  private total = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update after digest');
    this.total += data.length;
    let i = 0;
    if (this.fill > 0) {
      const n = Math.min(64 - this.fill, data.length);
      this.block.set(data.subarray(0, n), this.fill);
      this.fill += n;
      i = n;
      if (this.fill < 64) return this;
      this.compress(this.block, 0);
      this.fill = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    if (i < data.length) {
      this.block.set(data.subarray(i), 0);
      this.fill = data.length - i;
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: digest twice');
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    // The message length in bits as a big-endian u64 (below 2^53 here).
    view.setUint32(pad.length - 8, Math.floor(bits / 0x100000000), false);
    view.setUint32(pad.length - 4, bits >>> 0, false);
    this.update(pad);
    this.finished = true;
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let j = 0; j < 8; j += 1) outView.setUint32(4 * j, this.h[j], false);
    return out;
  }

  private compress(data: Uint8Array, at: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t += 1) {
      const j = at + 4 * t;
      w[t] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
}

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const hasher = new Sha256();
  for (const part of parts) hasher.update(part);
  return hasher.digest();
}

/** §1.5: the ASCII domain string followed by one 0x00 byte. */
export function domain(name: string): Uint8Array {
  const bytes = new Uint8Array(name.length + 1);
  bytes.set(ASCII(name));
  return bytes;
}

export const DOMAIN_COPY = domain('lupi.scale.copy.v1');
export const DOMAIN_REF = domain('lupi.scale.ref.v1');
export const DOMAIN_PACK = domain('lupi.pack.v1');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/ISO-HDLC (§1.6), the CRC of zlib and PNG. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const MASK64 = 0xffffffffffffffffn;
const GOLDEN = 0x9e3779b97f4a7c15n;

/** SplitMix64's output function: the steps of next() after z ← s (§1.7, §9.7). */
export function mix64(s: bigint): bigint {
  let z = s & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return z ^ (z >> 31n);
}

/** SplitMix64 (Steele, Lea and Flood 2014), the only PRNG in v1 (§1.7). */
export class SplitMix64 {
  private s: bigint;
  constructor(seed: bigint) {
    this.s = seed & MASK64;
  }
  next(): bigint {
    this.s = (this.s + GOLDEN) & MASK64;
    return mix64(this.s);
  }
}

/** The first 8 bytes of a hash, read as a little-endian u64 (§3.4.5, §9.7). */
export function leU64(bytes: Uint8Array): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
}

export { GOLDEN as SPLITMIX_GOLDEN };
