// LupiScale v1 byte layer (docs/ar/scale-spec.md §1): little-endian Writer
// and Reader, BigUInt as bigint, hex and base64url, and the error codes of
// §4.7 and §6.6. Everything here is [B]: the Swift port reads the fixtures
// this module helps write.

export type ScaleErrorCode =
  | 'truncated'
  | 'canonical'
  | 'range'
  | 'limit'
  | 'magic'
  | 'version'
  | 'missing'
  | 'unsupported'
  | 'path'
  | 'validity'
  | 'materialize'
  | 'mismatch'
  | 'base'
  | 'pack'
  | 'crc';

export class ScaleError extends Error {
  readonly code: ScaleErrorCode;
  constructor(code: ScaleErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.code = code;
    this.name = 'ScaleError';
  }
}

export function fail(code: ScaleErrorCode, message?: string): never {
  throw new ScaleError(code, message);
}

/** §1.9: a BigUInt holds at most 65,536 bits. */
export const BIGUINT_MAX_BYTES = 8192;
export const BIGUINT_LIMIT = 1n << 65536n;

const U64 = (1n << 64n) - 1n;

export function bitLength(value: bigint): number {
  if (value < 0n) fail('range', 'negative BigUInt');
  if (value === 0n) return 0;
  // toString(16) is linear in the size, so this stays cheap at 65,536 bits.
  const hexText = value.toString(16);
  return (hexText.length - 1) * 4 + (32 - Math.clz32(parseInt(hexText[0], 16)));
}

/** Little-endian magnitude bytes, minimal (empty for zero). */
export function bigUIntBytes(value: bigint): Uint8Array {
  if (value < 0n) fail('range', 'negative BigUInt');
  if (value === 0n) return new Uint8Array(0);
  let hexText = value.toString(16);
  if (hexText.length % 2 === 1) hexText = `0${hexText}`;
  const n = hexText.length / 2;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[n - 1 - i] = parseInt(hexText.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

export function bigUIntFromBytes(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  let hexText = '';
  for (let i = bytes.length - 1; i >= 0; i -= 1) hexText += HEX[bytes[i]];
  return BigInt(`0x${hexText}`);
}

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private reserve(n: number): number {
    const at = this.length;
    const need = at + n;
    if (need > this.buf.length) {
      let size = this.buf.length * 2;
      while (size < need) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buf.subarray(0, this.length));
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
    this.length = need;
    return at;
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) fail('range', `u8 ${value}`);
    const at = this.reserve(1);
    this.buf[at] = value;
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) fail('range', `u16 ${value}`);
    const at = this.reserve(2);
    this.view.setUint16(at, value, true);
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail('range', `u32 ${value}`);
    const at = this.reserve(4);
    this.view.setUint32(at, value, true);
    return this;
  }

  u64(value: bigint): this {
    if (value < 0n || value > U64) fail('range', `u64 ${value}`);
    const at = this.reserve(8);
    this.view.setBigUint64(at, value, true);
    return this;
  }

  i64(value: bigint): this {
    if (value < -(1n << 63n) || value >= 1n << 63n) fail('range', `i64 ${value}`);
    const at = this.reserve(8);
    this.view.setBigInt64(at, value, true);
    return this;
  }

  /** §1.3: finite, and every zero written as +0. */
  f32(value: number): this {
    if (!Number.isFinite(value)) fail('range', 'non-finite f32');
    const at = this.reserve(4);
    this.view.setFloat32(at, value === 0 ? 0 : value, true);
    return this;
  }

  f64(value: number): this {
    if (!Number.isFinite(value)) fail('range', 'non-finite f64');
    const at = this.reserve(8);
    this.view.setFloat64(at, value === 0 ? 0 : value, true);
    return this;
  }

  bytes(data: Uint8Array): this {
    // reserve() may replace the buffer, so it runs before this.buf is read.
    const at = this.reserve(data.length);
    this.buf.set(data, at);
    return this;
  }

  zeros(n: number): this {
    const at = this.reserve(n);
    this.buf.fill(0, at, this.length);
    return this;
  }

  /** §1.2: u16 byte count, then the minimal little-endian magnitude. */
  bigUInt(value: bigint): this {
    const mag = bigUIntBytes(value);
    if (mag.length > BIGUINT_MAX_BYTES) fail('limit', 'BigUInt over 65,536 bits');
    this.u16(mag.length);
    return this.bytes(mag);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  offset: number;
  readonly end: number;

  constructor(bytes: Uint8Array, offset = 0, end = bytes.length) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
    this.end = end;
  }

  get remaining(): number {
    return this.end - this.offset;
  }

  private take(n: number): number {
    if (n < 0 || this.offset + n > this.end) fail('truncated');
    const at = this.offset;
    this.offset += n;
    return at;
  }

  u8(): number {
    return this.bytes[this.take(1)];
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true);
  }

  i64(): bigint {
    return this.view.getBigInt64(this.take(8), true);
  }

  /** §1.3: readers reject non-finite values and −0. */
  f32(): number {
    const at = this.take(4);
    if (this.view.getUint32(at, true) === 0x80000000) fail('canonical', 'negative zero');
    const value = this.view.getFloat32(at, true);
    if (!Number.isFinite(value)) fail('range', 'non-finite f32');
    return value;
  }

  f64(): number {
    const at = this.take(8);
    if (this.view.getBigUint64(at, true) === 0x8000000000000000n) fail('canonical', 'negative zero');
    const value = this.view.getFloat64(at, true);
    if (!Number.isFinite(value)) fail('range', 'non-finite f64');
    return value;
  }

  raw(n: number): Uint8Array {
    const at = this.take(n);
    return this.bytes.subarray(at, at + n);
  }

  zeros(n: number, what = 'reserved'): void {
    const at = this.take(n);
    for (let i = at; i < at + n; i += 1) {
      if (this.bytes[i] !== 0) fail('canonical', `nonzero ${what} byte`);
    }
  }

  /** §1.2: rejects a non-minimal encoding. */
  bigUInt(): bigint {
    const n = this.u16();
    if (n > BIGUINT_MAX_BYTES) fail('limit', 'BigUInt over 65,536 bits');
    const mag = this.raw(n);
    if (n > 0 && mag[n - 1] === 0) fail('canonical', 'non-minimal BigUInt');
    return bigUIntFromBytes(mag);
  }

  done(): void {
    if (this.offset !== this.end) fail('canonical', 'trailing bytes');
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += HEX[bytes[i]];
  return out;
}

export function fromHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text)) fail('canonical', 'not lowercase hex');
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = new Map(Array.from(B64, (c, i) => [c, i]));

/** RFC 4648 §5 without padding (§1.8). */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out += B64[v >> 18] + B64[(v >> 12) & 63];
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63];
  }
  return out;
}

/** Strict: no padding, no stray characters, and zero trailing bits. */
export function fromBase64url(text: string): Uint8Array {
  if (text.length % 4 === 1) fail('canonical', 'base64url length');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const c of text) {
    const v = B64_INDEX.get(c);
    if (v === undefined) fail('canonical', 'base64url character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (acc >> bits) & 0xff;
      o += 1;
      acc &= (1 << bits) - 1;
    }
  }
  if (acc !== 0) fail('canonical', 'base64url trailing bits');
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Byte order with a proper prefix first (§2.6, §6.4). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return compareBytes(a, b) === 0;
}

export const ASCII = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
