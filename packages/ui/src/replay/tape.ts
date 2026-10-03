/**
 * tape.ts — Instant Replay's tape: one moment as camera keys plus toy inputs,
 * and its compact binary form for the `replay=` URL parameter.
 *
 * A tape stores what is needed to play a moment again in someone else's 3D
 * view, never pixels:
 * - **keys**: the camera pose (orientation quaternion, distance, target) at a
 *   pose snapshot every 0.5 s, plus the extra keys where the motion bends
 *   (keyframes.ts picks them so the replayed camera stays within a third of a
 *   degree of what the sender saw);
 * - **events**: the toy inputs (poke, ripple, burst, tug, heat, scatter,
 *   reset) and the pill's flashes (a detent's name, "Flip!", "Caught"),
 *   each at its time. The receiver's own Play layer re-runs the toys, at
 *   the receiver's Motion comfort.
 *
 * Wire format v1 (bytes, then base64url without padding), about 0.5–1.5 KB
 * for a few seconds of motion:
 *
 *   u8 version · u8 flags · u8 moment · u8 gesture · varint durationMs
 *   u8 fov° · u8 aspect×40 · [varint frame] · f32×3 T0 · f32 D0 · varint keys
 *   key: varint dtMs · 5 bytes (2-bit largest index, 3×12-bit smallest three,
 *        bit distance-changed, bit target-changed) · [zz ln(d/D0)·2048 delta]
 *        · [zz ((T−T0)/D0)·4096 delta ×3]
 *   varint events · event: varint dtMs · u8 kind · payload
 *
 * Decoding never throws past `decodeTape`, which returns null for anything
 * malformed, too long or from a newer version.
 */
import type { Vec3 } from '../camera/rigApi';

export const TAPE_VERSION = 1;
/** Longest tape the codec accepts (s). */
export const TAPE_MAX_SECONDS = 12;
/** Most keys and events a tape may carry. */
export const TAPE_MAX_KEYS = 600;
export const TAPE_MAX_EVENTS = 400;
/** A `replay=` value longer than this is refused unread (base64url chars). */
export const TAPE_MAX_TOKEN = 8192;

export type Quat = [number, number, number, number];

/** What made the moment (it names the offer and the receiver's "Your turn"). */
export type MomentKind = 'flick' | 'chain' | 'flip' | 'toy' | 'view';

/** The gesture the sender used, for the receiver's coach line. */
export type MomentGesture = 'flick' | 'drag' | 'keys' | 'spin' | 'poke' | 'tug' | 'burst' | 'heat' | 'scatter';

export interface TapeKey {
  /** Seconds from the start of the tape. */
  t: number;
  /** Camera orientation (world), unit. */
  q: Quat;
  /** Camera distance to the target. */
  d: number;
  target: Vec3;
}

export type FlashKind = 'detent' | 'flip' | 'catch' | 'info';

export type TapeEvent =
  | { t: number; kind: 'label'; flash: FlashKind; text: string }
  | { t: number; kind: 'poke'; atom: number }
  | { t: number; kind: 'ripple'; point: Vec3; amplitude: number }
  | { t: number; kind: 'burst'; point: Vec3 }
  | { t: number; kind: 'tugGrab'; atom: number; point: Vec3 }
  | { t: number; kind: 'tugPull'; d: Vec3 }
  | { t: number; kind: 'tugRelease' }
  | { t: number; kind: 'heatOn' }
  | { t: number; kind: 'heatOff' }
  | { t: number; kind: 'heatRub'; amount: number }
  | { t: number; kind: 'scatter'; seed: number }
  | { t: number; kind: 'reset' };

export type TapeEventKind = TapeEvent['kind'];

/** Toy events (everything but the pill's labels): any of them makes the replay illustrative. */
export function isToyEvent(event: TapeEvent): boolean {
  return event.kind !== 'label';
}

export interface Tape {
  version: typeof TAPE_VERSION;
  moment: MomentKind;
  gesture: MomentGesture | null;
  /** Length (s): the last key holds until then. */
  duration: number;
  /** The sender's vertical field of view (degrees). */
  fov: number;
  /** The sender's canvas aspect (width / height). */
  aspect: number;
  /** Trajectory frame the moment happened on (0 for a single structure). */
  frame: number;
  /** Motion: Still, or a moment with no motion: open on the last pose, play nothing. */
  still: boolean;
  keys: TapeKey[];
  events: TapeEvent[];
}

const MOMENTS: readonly MomentKind[] = ['flick', 'chain', 'flip', 'toy', 'view'];
const GESTURES: readonly MomentGesture[] = ['flick', 'drag', 'keys', 'spin', 'poke', 'tug', 'burst', 'heat', 'scatter'];
const FLASHES: readonly FlashKind[] = ['detent', 'flip', 'catch', 'info'];
const EVENT_KINDS: readonly TapeEventKind[] = [
  'label',
  'poke',
  'ripple',
  'burst',
  'tugGrab',
  'tugPull',
  'tugRelease',
  'heatOn',
  'heatOff',
  'heatRub',
  'scatter',
  'reset',
];

const FLAG_STILL = 1;
const FLAG_FRAME = 2;

/** Quantisation of the keys (shared with keyframes.ts so decimation sees what decodes). */
export const QUANT = {
  /** Smallest-three component bits. */
  quatBits: 12,
  /** ln(d / D0) steps per unit (0.05 % of the distance). */
  logDistance: 2048,
  /** Target steps per D0. */
  target: 4096,
  /** Event points: steps per Å. */
  point: 64,
} as const;

const QUAT_RANGE = Math.SQRT1_2;
const QUAT_MAX = (1 << QUANT.quatBits) - 1;

// ─── Byte writer / reader ─────────────────────────────────────────────

class Writer {
  private bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  varint(value: number): void {
    let v = Math.max(0, Math.floor(value));
    while (v >= 0x80) {
      this.bytes.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.bytes.push(v);
  }

  zigzag(value: number): void {
    const v = Math.round(value);
    this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  f32(value: number): void {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    for (let i = 0; i < 4; i += 1) this.bytes.push(view.getUint8(i));
  }

  raw(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i += 1) this.bytes.push(values[i] & 0xff);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class TapeFormatError extends Error {}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.bytes.length) throw new TapeFormatError('short tape');
    return this.bytes[this.offset++];
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 8; i += 1) {
      const byte = this.u8();
      result += (byte & 0x7f) * scale;
      if (byte < 0x80) return result;
      scale *= 0x80;
    }
    throw new TapeFormatError('varint too long');
  }

  zigzag(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  f32(): number {
    const view = new DataView(new ArrayBuffer(4));
    for (let i = 0; i < 4; i += 1) view.setUint8(i, this.u8());
    return view.getFloat32(0, true);
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new TapeFormatError('short tape');
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
}

// ─── Quaternion: smallest three ───────────────────────────────────────

/** The packed 38 bits of a unit quaternion: [largest index, a, b, c] (12-bit each). */
export function packQuat(q: Quat): [number, number, number, number] {
  let largest = 0;
  for (let i = 1; i < 4; i += 1) if (Math.abs(q[i]) > Math.abs(q[largest])) largest = i;
  const sign = q[largest] < 0 ? -1 : 1;
  const out: [number, number, number, number] = [largest, 0, 0, 0];
  let slot = 1;
  for (let i = 0; i < 4; i += 1) {
    if (i === largest) continue;
    const v = Math.max(-QUAT_RANGE, Math.min(QUAT_RANGE, q[i] * sign));
    out[slot] = Math.round(((v + QUAT_RANGE) / (2 * QUAT_RANGE)) * QUAT_MAX);
    slot += 1;
  }
  return out;
}

export function unpackQuat(packed: readonly [number, number, number, number]): Quat {
  const [largest, a, b, c] = packed;
  const small = [a, b, c].map((v) => (v / QUAT_MAX) * 2 * QUAT_RANGE - QUAT_RANGE);
  const sum = small[0] * small[0] + small[1] * small[1] + small[2] * small[2];
  const big = Math.sqrt(Math.max(0, 1 - sum));
  const q: Quat = [0, 0, 0, 0];
  let slot = 0;
  for (let i = 0; i < 4; i += 1) {
    if (i === largest) q[i] = big;
    else q[i] = small[slot++];
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** A quaternion as it will decode (for decimation against the wire's precision). */
export function quantizeQuat(q: Quat): Quat {
  return unpackQuat(packQuat(q));
}

function writeQuat(w: Writer, q: Quat, distanceChanged: boolean, targetChanged: boolean): void {
  const [largest, a, b, c] = packQuat(q);
  // 40 bits: [2 largest][12 a][12 b][12 c][1 distance][1 target]
  const hi = largest * 2 ** 36 + a * 2 ** 24 + b * 2 ** 12 + c;
  const value = hi * 4 + (distanceChanged ? 2 : 0) + (targetChanged ? 1 : 0);
  let v = value;
  const bytes = [0, 0, 0, 0, 0];
  for (let i = 4; i >= 0; i -= 1) {
    bytes[i] = v % 256;
    v = Math.floor(v / 256);
  }
  w.raw(bytes);
}

function readQuat(r: Reader): { q: Quat; distanceChanged: boolean; targetChanged: boolean } {
  const bytes = r.take(5);
  let value = 0;
  for (let i = 0; i < 5; i += 1) value = value * 256 + bytes[i];
  const flags = value % 4;
  let hi = Math.floor(value / 4);
  const c = hi % 4096;
  hi = Math.floor(hi / 4096);
  const b = hi % 4096;
  hi = Math.floor(hi / 4096);
  const a = hi % 4096;
  const largest = Math.floor(hi / 4096) % 4;
  return { q: unpackQuat([largest, a, b, c]), distanceChanged: (flags & 2) !== 0, targetChanged: (flags & 1) !== 0 };
}

// ─── Distance and target quantisation ─────────────────────────────────

export interface TapeFrameOfReference {
  /** Target origin. */
  t0: Vec3;
  /** Reference distance. */
  d0: number;
}

/** The tape's frame of reference: the first key's target and distance (as f32). */
export function frameOfReference(keys: readonly TapeKey[]): TapeFrameOfReference {
  const first = keys[0];
  const f = (v: number) => Math.fround(v);
  return {
    t0: first ? [f(first.target[0]), f(first.target[1]), f(first.target[2])] : [0, 0, 0],
    d0: first && first.d > 1e-6 ? f(first.d) : 1,
  };
}

export function quantizeDistance(d: number, ref: TapeFrameOfReference): number {
  return Math.round(Math.log(Math.max(1e-9, d) / ref.d0) * QUANT.logDistance);
}

export function dequantizeDistance(q: number, ref: TapeFrameOfReference): number {
  return ref.d0 * Math.exp(q / QUANT.logDistance);
}

export function quantizeTarget(t: Vec3, ref: TapeFrameOfReference): Vec3 {
  const s = QUANT.target / ref.d0;
  return [Math.round((t[0] - ref.t0[0]) * s), Math.round((t[1] - ref.t0[1]) * s), Math.round((t[2] - ref.t0[2]) * s)];
}

export function dequantizeTarget(q: Vec3, ref: TapeFrameOfReference): Vec3 {
  const s = ref.d0 / QUANT.target;
  return [ref.t0[0] + q[0] * s, ref.t0[1] + q[1] * s, ref.t0[2] + q[2] * s];
}

/** A key exactly as it will decode against `ref`. */
export function quantizeKey(key: TapeKey, ref: TapeFrameOfReference): TapeKey {
  return {
    t: Math.round(key.t * 1000) / 1000,
    q: quantizeQuat(key.q),
    d: dequantizeDistance(quantizeDistance(key.d, ref), ref),
    target: dequantizeTarget(quantizeTarget(key.target, ref), ref),
  };
}

// ─── Events ───────────────────────────────────────────────────────────

function writePoint(w: Writer, p: Vec3): void {
  for (let i = 0; i < 3; i += 1) w.zigzag(clampFinite(p[i], 1e6) * QUANT.point);
}

function readPoint(r: Reader): Vec3 {
  return [r.zigzag() / QUANT.point, r.zigzag() / QUANT.point, r.zigzag() / QUANT.point];
}

function clampFinite(value: number, limit: number): number {
  return Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

function writeEventPayload(w: Writer, event: TapeEvent): void {
  switch (event.kind) {
    case 'label': {
      w.u8(Math.max(0, FLASHES.indexOf(event.flash)));
      let bytes = encoder ? encoder.encode(event.text) : new Uint8Array(0);
      if (bytes.length > 80) bytes = bytes.subarray(0, 80);
      w.u8(bytes.length);
      w.raw(bytes);
      break;
    }
    case 'poke':
      w.varint(event.atom);
      break;
    case 'ripple':
      writePoint(w, event.point);
      w.u8(Math.round(Math.max(0, Math.min(2.55, event.amplitude)) * 100));
      break;
    case 'burst':
      writePoint(w, event.point);
      break;
    case 'tugGrab':
      w.varint(event.atom >= 0 ? event.atom + 1 : 0);
      if (event.atom < 0) writePoint(w, event.point);
      break;
    case 'tugPull':
      writePoint(w, event.d);
      break;
    case 'heatRub':
      w.u8(Math.round(Math.max(0, Math.min(0.255, event.amount)) * 1000));
      break;
    case 'scatter':
      w.varint(event.seed & 0xffffff);
      break;
    default:
      break;
  }
}

function readEvent(r: Reader, t: number, kind: TapeEventKind): TapeEvent {
  switch (kind) {
    case 'label': {
      const flash = FLASHES[r.u8()] ?? 'info';
      const length = r.u8();
      const bytes = r.take(length);
      const text = decoder ? decoder.decode(bytes) : '';
      return { t, kind, flash, text: text.slice(0, 80) };
    }
    case 'poke':
      return { t, kind, atom: r.varint() };
    case 'ripple': {
      const point = readPoint(r);
      return { t, kind, point, amplitude: r.u8() / 100 };
    }
    case 'burst':
      return { t, kind, point: readPoint(r) };
    case 'tugGrab': {
      const code = r.varint();
      return code > 0 ? { t, kind, atom: code - 1, point: [0, 0, 0] } : { t, kind, atom: -1, point: readPoint(r) };
    }
    case 'tugPull':
      return { t, kind, d: readPoint(r) };
    case 'heatRub':
      return { t, kind, amount: r.u8() / 1000 };
    case 'scatter':
      return { t, kind, seed: r.varint() };
    case 'tugRelease':
    case 'heatOn':
    case 'heatOff':
    case 'reset':
      return { t, kind };
    default:
      throw new TapeFormatError('unknown event');
  }
}

// ─── Encode / decode ──────────────────────────────────────────────────

function same3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The tape as bytes. Keys and events must be in time order. */
export function encodeTapeBytes(tape: Tape): Uint8Array {
  const w = new Writer();
  const keys = tape.keys.slice(0, TAPE_MAX_KEYS);
  const events = tape.events.slice(0, TAPE_MAX_EVENTS);
  const frame = Math.max(0, Math.floor(tape.frame || 0));
  w.u8(TAPE_VERSION);
  w.u8((tape.still ? FLAG_STILL : 0) | (frame > 0 ? FLAG_FRAME : 0));
  w.u8(Math.max(0, MOMENTS.indexOf(tape.moment)));
  w.u8(tape.gesture ? GESTURES.indexOf(tape.gesture) + 1 : 0);
  w.varint(Math.round(Math.min(TAPE_MAX_SECONDS, Math.max(0, tape.duration)) * 1000));
  w.u8(Math.round(Math.max(1, Math.min(179, tape.fov))));
  w.u8(Math.round(Math.max(0.2, Math.min(6, tape.aspect)) * 40));
  if (frame > 0) w.varint(frame);
  const ref = frameOfReference(keys);
  w.f32(ref.t0[0]);
  w.f32(ref.t0[1]);
  w.f32(ref.t0[2]);
  w.f32(ref.d0);
  w.varint(keys.length);
  let lastMs = 0;
  let lastDistance = 0;
  let lastTarget: Vec3 = [0, 0, 0];
  keys.forEach((key, index) => {
    const ms = Math.max(lastMs, Math.round(key.t * 1000));
    w.varint(index === 0 ? ms : ms - lastMs);
    lastMs = ms;
    const qd = quantizeDistance(key.d, ref);
    const qt = quantizeTarget(key.target, ref);
    const distanceChanged = index === 0 ? qd !== 0 : qd !== lastDistance;
    const targetChanged = index === 0 ? !same3(qt, [0, 0, 0]) : !same3(qt, lastTarget);
    writeQuat(w, key.q, distanceChanged, targetChanged);
    if (distanceChanged) w.zigzag(qd - lastDistance);
    if (targetChanged) {
      w.zigzag(qt[0] - lastTarget[0]);
      w.zigzag(qt[1] - lastTarget[1]);
      w.zigzag(qt[2] - lastTarget[2]);
    }
    lastDistance = qd;
    lastTarget = qt;
  });
  w.varint(events.length);
  let lastEventMs = 0;
  for (const event of events) {
    const ms = Math.max(lastEventMs, Math.round(event.t * 1000));
    w.varint(ms - lastEventMs);
    lastEventMs = ms;
    w.u8(EVENT_KINDS.indexOf(event.kind));
    writeEventPayload(w, event);
  }
  return w.finish();
}

export function decodeTapeBytes(bytes: Uint8Array): Tape {
  const r = new Reader(bytes);
  const version = r.u8();
  if (version !== TAPE_VERSION) throw new TapeFormatError(`unsupported tape version ${version}`);
  const flags = r.u8();
  const moment = MOMENTS[r.u8()] ?? 'view';
  const gestureCode = r.u8();
  const gesture = gestureCode > 0 ? GESTURES[gestureCode - 1] ?? null : null;
  const duration = Math.min(TAPE_MAX_SECONDS, r.varint() / 1000);
  const fov = r.u8();
  const aspect = r.u8() / 40;
  const frame = flags & FLAG_FRAME ? r.varint() : 0;
  const ref: TapeFrameOfReference = { t0: [r.f32(), r.f32(), r.f32()], d0: r.f32() };
  if (!(ref.d0 > 0) || !Number.isFinite(ref.d0) || !ref.t0.every(Number.isFinite)) {
    throw new TapeFormatError('bad frame of reference');
  }
  const keyCount = r.varint();
  if (keyCount < 1 || keyCount > TAPE_MAX_KEYS) throw new TapeFormatError('bad key count');
  const keys: TapeKey[] = [];
  let ms = 0;
  let qd = 0;
  let qt: Vec3 = [0, 0, 0];
  for (let i = 0; i < keyCount; i += 1) {
    ms += r.varint();
    const { q, distanceChanged, targetChanged } = readQuat(r);
    if (distanceChanged) qd += r.zigzag();
    if (targetChanged) qt = [qt[0] + r.zigzag(), qt[1] + r.zigzag(), qt[2] + r.zigzag()];
    keys.push({ t: ms / 1000, q, d: dequantizeDistance(qd, ref), target: dequantizeTarget(qt, ref) });
  }
  const eventCount = r.varint();
  if (eventCount > TAPE_MAX_EVENTS) throw new TapeFormatError('too many events');
  const events: TapeEvent[] = [];
  let eventMs = 0;
  for (let i = 0; i < eventCount; i += 1) {
    eventMs += r.varint();
    const kind = EVENT_KINDS[r.u8()];
    if (!kind) throw new TapeFormatError('unknown event');
    events.push(readEvent(r, eventMs / 1000, kind));
  }
  const last = keys[keys.length - 1].t;
  return {
    version: TAPE_VERSION,
    moment,
    gesture,
    duration: Math.max(duration, last),
    fov: fov > 0 ? fov : 50,
    aspect: aspect > 0 ? aspect : 1,
    frame,
    still: (flags & FLAG_STILL) !== 0,
    keys,
    events,
  };
}

// ─── base64url ────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array | null {
  const clean = text.replace(/[=\s]/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = B64.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** The `replay=` value for a tape. */
export function encodeTape(tape: Tape): string {
  return toBase64Url(encodeTapeBytes(tape));
}

/** A `replay=` value back into a tape; null if it is not a tape this build can play. */
export function decodeTape(token: string | null | undefined): Tape | null {
  if (!token || token.length > TAPE_MAX_TOKEN) return null;
  const bytes = fromBase64Url(token);
  if (!bytes || bytes.length < 8) return null;
  try {
    return decodeTapeBytes(bytes);
  } catch (error) {
    if (!(error instanceof TapeFormatError)) console.warn('[lupi] replay tape could not be read', error);
    return null;
  }
}
