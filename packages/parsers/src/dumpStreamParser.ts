/**
 * Streaming LAMMPS dump parser — byte-level core.
 *
 * Two transport modes share one parsing core (`parseDumpStreamCore`):
 *   - `parseDumpStream(text)` — caller has the whole file in memory
 *     (encoded once and fed to the byte core).
 *   - `parseDumpStreamFromBytes(byteIter)` — caller has a ReadableStream /
 *     async iterable of byte chunks (from `Response.body.getReader()` or
 *     `File.stream()`). Atoms render before the file finishes downloading.
 *
 * The core parses RAW BYTES. LAMMPS dumps are pure ASCII, so there is
 * nothing a string layer adds except cost: the previous core decoded
 * every byte through TextDecoder into JS strings and paid for rope
 * management and slice copies on top — profiling showed the parser (not
 * the transcode writer) was 94% of ingest time. Here the only strings
 * ever materialized are the ~9 header lines per frame; atom rows are
 * scanned in place in a growable Uint8Array that recycles consumed
 * space with copyWithin (a memmove, not an allocation).
 *
 * Dialect coverage — the full common dump space, not a happy-path subset:
 *   - orthogonal AND triclinic boxes (tilt factors carried per frame),
 *   - unscaled (x y z), scaled (xs ys zs), and unwrapped (xu yu zu)
 *     coordinates — scaled coordinates are mapped to Cartesian with the
 *     proper triclinic bound correction,
 *   - extra per-atom columns (vx, c_pe, …) parsed into named Float32Array
 *     properties so property coloring works on streamed files,
 *   - variable atom counts and per-frame boxes (NPT) — every frame
 *     carries its own box.
 *
 * Multi-frame mode (`{ multiFrame: true }`) yields each frame past
 * frame 0 whole, one at a time, so a consumer (the transcode worker)
 * can process and release them — O(1 frame) memory for the initial
 * parse of a simulation over time. Frame 0 keeps the progressive
 * header/progress contract for the viewer's first paint.
 */

import type { Frame } from '@atlas/core/types';
import { analyzeDumpHead } from './dumpContract';

export type DumpParseErrorCode =
  | 'INVALID_ATOM_ID'
  | 'DUPLICATE_ATOM_ID';

export interface DumpParseErrorPayload {
  message: string;
  code: DumpParseErrorCode;
  frameIndex: number;
  timestep: number;
  atomRow: number;
  atomId?: number;
}

/**
 * Actionable scientific-data error raised when a LAMMPS atom-ID column
 * cannot be represented truthfully.  Consumers may branch on `code` without
 * scraping the message while people still get the exact frame, row, and ID.
 */
export class DumpParseError extends Error {
  readonly code: DumpParseErrorCode;
  readonly frameIndex: number;
  readonly timestep: number;
  readonly atomRow: number;
  readonly atomId?: number;

  constructor(
    code: DumpParseErrorCode,
    message: string,
    context: { frameIndex: number; timestep: number; atomRow: number; atomId?: number },
  ) {
    super(message);
    this.name = 'DumpParseError';
    this.code = code;
    this.frameIndex = context.frameIndex;
    this.timestep = context.timestep;
    this.atomRow = context.atomRow;
    this.atomId = context.atomId;
  }
}

/** Structured-clone-safe typed error metadata for parser workers. */
export function serializeDumpParseError(error: unknown): DumpParseErrorPayload | null {
  if (!(error instanceof DumpParseError)) return null;
  return {
    message: error.message,
    code: error.code,
    frameIndex: error.frameIndex,
    timestep: error.timestep,
    atomRow: error.atomRow,
    ...(error.atomId === undefined ? {} : { atomId: error.atomId }),
  };
}

/** Restore typed parser failures on the main thread; generic worker failures
 * stay generic Errors and cannot accidentally acquire scientific semantics. */
export function deserializeDumpParseError(payload: unknown): Error {
  const p = payload as Partial<DumpParseErrorPayload> | null;
  const message = typeof p?.message === 'string' ? p.message : 'Parser worker failed';
  if (
    (p?.code === 'INVALID_ATOM_ID' || p?.code === 'DUPLICATE_ATOM_ID') &&
    Number.isInteger(p.frameIndex) &&
    Number.isInteger(p.timestep) &&
    Number.isInteger(p.atomRow)
  ) {
    return new DumpParseError(p.code, message, {
      frameIndex: p.frameIndex!,
      timestep: p.timestep!,
      atomRow: p.atomRow!,
      ...(typeof p.atomId === 'number' ? { atomId: p.atomId } : {}),
    });
  }
  return new Error(message);
}

/**
 * Allocation-bounded uniqueness check for the Int32 identity domain. A
 * JavaScript Set costs several boxed allocations per atom; this open-addressed
 * table uses one Int32 slot per hash bucket and reserves zero as the empty
 * sentinel (LAMMPS atom IDs are required to be positive).
 */
class Int32IdSet {
  private readonly keys: Int32Array;
  private readonly mask: number;

  constructor(expectedSize: number) {
    let capacity = 2;
    while (capacity < expectedSize * 2) capacity *= 2;
    this.keys = new Int32Array(capacity);
    this.mask = capacity - 1;
  }

  add(value: number): boolean {
    let hash = value | 0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    let slot = (hash ^ (hash >>> 16)) & this.mask;
    while (true) {
      const existing = this.keys[slot];
      if (existing === 0) {
        this.keys[slot] = value;
        return true;
      }
      if (existing === value) return false;
      slot = (slot + 1) & this.mask;
    }
  }
}

/** Yield-after-this-many-atoms granularity. Sized so each chunk fits
 *  comfortably in a single animation frame's parse budget on a phone
 *  so the renderer keeps painting between chunks. */
export const ATOM_CHUNK_SIZE = 10_000;

export interface DumpStreamHeaderEvent {
  type: 'header';
  /** Pre-allocated Frame with positions / types / ids / properties sized
   *  to natoms but populated only up to `loadedAtoms` (initially 0). The
   *  renderer takes ownership immediately so it can grow
   *  geometry.instanceCount as `loadedAtoms` increases. */
  frame: Frame;
}

export interface DumpStreamProgressEvent {
  type: 'progress';
  /** Number of atoms populated so far in the frame's arrays. Indices in
   *  [0, loadedAtoms) are valid; the tail is uninitialized memory. */
  loadedAtoms: number;
}

/** Multi-frame mode only: a complete trajectory frame past frame 0.
 *  Frame 0 still arrives via `header` + `progress` (the progressive-paint
 *  contract); later frames arrive whole, one event each, so a consumer
 *  (e.g. the transcode worker) can process and release them one at a
 *  time — the parser never holds more than the frame being parsed. */
export interface DumpStreamFrameEvent {
  type: 'frame';
  /** Index of this frame within the trajectory (1-based past frame 0). */
  frameIndex: number;
  frame: Frame;
}

export interface DumpStreamCompleteEvent {
  type: 'complete';
  /** Final atom count actually parsed for frame 0 (≤ frame.natoms — a
   *  truncated file may stop short). */
  loadedAtoms: number;
  /** Single-frame mode: true when the source contained at least one more
   *  `ITEM: TIMESTEP` block after frame 0, so the caller can recognize a
   *  trajectory ("simulation over time") and route it to a path that
   *  captures every frame instead of silently rendering only frame 0.
   *  Multi-frame mode consumes everything, so this is always false there. */
  hasMoreFrames: boolean;
  /** Total frames parsed (1 in single-frame mode; the full trajectory
   *  length in multi-frame mode). */
  totalFrames: number;
}

export type DumpStreamEvent =
  | DumpStreamHeaderEvent
  | DumpStreamProgressEvent
  | DumpStreamFrameEvent
  | DumpStreamCompleteEvent;

/** A puller that returns the next chunk of bytes from some source.
 *  Returns `null` when the source is exhausted. */
type BytePuller = () => Promise<Uint8Array | null>;

/** Options for the parsing core (and its public wrappers). */
export interface DumpStreamOptions {
  /** Parse every frame in the trajectory, not just frame 0. */
  multiFrame?: boolean;
}

// ─── Fast ASCII number scanning (on bytes) ───────────────────────────
// `scanEnd` is a module-level cursor-out so the scanner returns a value
// without allocating a tuple.

let scanEnd = 0;

const POW10 = new Float64Array(23);
for (let i = 0; i < 23; i++) POW10[i] = Math.pow(10, i);

/** Parse a float starting at `i`. Handles sign, decimals, and e-notation
 *  (LAMMPS writes both `1.73148` and `2.169e+01` styles). Non-numeric
 *  tokens (e.g. an `element` column) yield NaN, with the cursor advanced
 *  past the token either way. Caller guarantees a terminator byte
 *  (newline) exists at or before `end`. Within float32 precision — where
 *  every parsed coordinate/property lands — results match parseFloat. */
function scanFloat(b: Uint8Array, i: number, end: number): number {
  let c = b[i];
  let neg = false;
  if (c === 45 /* - */) {
    neg = true;
    c = b[++i];
  } else if (c === 43 /* + */) {
    c = b[++i];
  }
  let mant = 0;
  let exp10 = 0;
  let any = false;
  while (c >= 48 && c <= 57) {
    mant = mant * 10 + (c - 48);
    any = true;
    c = b[++i];
  }
  if (c === 46 /* . */) {
    c = b[++i];
    while (c >= 48 && c <= 57) {
      mant = mant * 10 + (c - 48);
      exp10--;
      any = true;
      c = b[++i];
    }
  }
  if (!any) {
    // Not a number — skip the rest of the token so the caller stays in sync.
    while (i < end && c !== 32 && c !== 9 && c !== 13 && c !== 10) c = b[++i];
    scanEnd = i;
    return NaN;
  }
  if (c === 101 || c === 69 /* e E */) {
    c = b[++i];
    let eneg = false;
    if (c === 45) {
      eneg = true;
      c = b[++i];
    } else if (c === 43) {
      c = b[++i];
    }
    let e = 0;
    while (c >= 48 && c <= 57) {
      e = e * 10 + (c - 48);
      c = b[++i];
    }
    exp10 += eneg ? -e : e;
  }
  scanEnd = i;
  let v: number;
  if (exp10 === 0) v = mant;
  else if (exp10 > 0) v = exp10 <= 22 ? mant * POW10[exp10] : mant * Math.pow(10, exp10);
  else v = exp10 >= -22 ? mant / POW10[-exp10] : mant * Math.pow(10, exp10);
  return neg ? -v : v;
}

/** Parse an exact positive base-10 integer token into the storage domain used
 * by Frame.ids. Decimal/exponent spellings are rejected even when IEEE-754
 * rounding would make their numeric value look integral. */
function scanPositiveInt32Token(b: Uint8Array, start: number, tokenEnd: number): number | undefined {
  let i = start;
  if (b[i] === 43 /* + */) {
    i++;
  }
  if (i >= tokenEnd) return undefined;

  let value = 0;
  const limit = 2147483647;
  for (; i < tokenEnd; i++) {
    const digit = b[i] - 48;
    if (digit < 0 || digit > 9) return undefined;
    if (value > Math.floor((limit - digit) / 10)) return undefined;
    value = value * 10 + digit;
  }
  return value > 0 ? value : undefined;
}

// Per-column write targets for the row loop. Small ints dispatch faster
// than string comparisons and let one loop serve every dialect.
const T_SKIP = 0;
const T_ID = 1;
const T_TYPE = 2;
const T_X = 3;
const T_Y = 4;
const T_Z = 5;
const T_PROP = 6; // property index lives in a parallel slot array

const NL = 10;
const headerDecoder = /* @__PURE__ */ new TextDecoder('utf-8', { fatal: false });

/** Shared core. Pulls bytes from `puller` into a recycled buffer, parses
 *  header then atom rows incrementally per frame. */
async function* parseDumpStreamCore(
  puller: BytePuller,
  opts: DumpStreamOptions = {},
): AsyncGenerator<DumpStreamEvent> {
  const multiFrame = opts.multiFrame === true;

  // Growable byte buffer. Consumed prefix is recycled in place with
  // copyWithin when capacity is needed — no per-shift allocations. The
  // invariant `end < buf.length` (one spare byte) lets the tail-row path
  // plant a temporary newline terminator.
  let buf = new Uint8Array(1 << 20);
  let end = 0;
  let sourceDone = false;

  /** Append the next chunk, compacting/growing as needed. Returns the
   *  adjusted cursor (data may have moved), or -1 when the source is
   *  exhausted with nothing appended. */
  async function fill(cursor: number): Promise<number> {
    if (sourceDone) return -1;
    const chunk = await puller();
    if (chunk === null) {
      sourceDone = true;
      return -1;
    }
    if (end + chunk.length >= buf.length) {
      if (cursor > 0) {
        buf.copyWithin(0, cursor, end);
        end -= cursor;
        cursor = 0;
      }
      if (end + chunk.length >= buf.length) {
        let cap = buf.length * 2;
        while (cap <= end + chunk.length) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(buf.subarray(0, end));
        buf = next;
      }
    }
    buf.set(chunk, end);
    end += chunk.length;
    return cursor;
  }

  /** indexOf newline within the valid region. */
  const findNl = (from: number): number => {
    const i = buf.indexOf(NL, from);
    return i >= 0 && i < end ? i : -1;
  };

  const isWsByte = (c: number) => c === 32 || c === 9 || c === 13 || c === 10;

  const onlyWhitespaceLeft = (from: number): boolean => {
    for (let i = from; i < end; i++) if (!isWsByte(buf[i])) return false;
    return true;
  };

  let cursor = 0;
  let frameIndex = 0;
  let frame0Loaded = 0;
  let hasMoreFrames = false;

  frames: while (true) {
    // ─── Header phase: a small line-driven state machine. Header lines
    // are the only bytes ever decoded to strings (~9 per frame). ───
    let timestep = 0;
    let natoms = -1;
    const boxBounds = new Float64Array(6);
    const boxTilt = new Float64Array(3);
    let triclinic = false;
    let boundsRemaining = -1;
    let pending: 'ts' | 'natoms' | null = null;
    let columns: string[] | null = null;

    header: while (true) {
      let nl = findNl(cursor);
      while (nl === -1) {
        const adjusted = await fill(cursor);
        if (adjusted === -1) {
          if (frameIndex > 0 && onlyWhitespaceLeft(cursor)) break frames;
          throw new Error('streaming parser: stream ended before ATOMS header');
        }
        cursor = adjusted;
        nl = findNl(cursor);
      }
      const line = headerDecoder.decode(buf.subarray(cursor, nl)).trim();
      cursor = nl + 1;

      if (boundsRemaining > 0) {
        const parts = line.split(/\s+/);
        const dim = 3 - boundsRemaining;
        boxBounds[dim * 2] = parseFloat(parts[0]);
        boxBounds[dim * 2 + 1] = parseFloat(parts[1]);
        if (parts.length > 2) {
          boxTilt[dim] = parseFloat(parts[2]);
          triclinic = true;
        }
        boundsRemaining--;
        continue;
      }
      if (pending === 'ts') {
        timestep = parseInt(line, 10) | 0;
        pending = null;
        continue;
      }
      if (pending === 'natoms') {
        natoms = parseInt(line, 10) | 0;
        pending = null;
        continue;
      }
      if (line === 'ITEM: TIMESTEP') {
        pending = 'ts';
      } else if (line === 'ITEM: NUMBER OF ATOMS') {
        pending = 'natoms';
      } else if (line.startsWith('ITEM: BOX BOUNDS')) {
        triclinic = /\bxy\b|\bxz\b|\byz\b/.test(line);
        boundsRemaining = 3;
      } else if (line.startsWith('ITEM: ATOMS')) {
        columns = line.slice('ITEM: ATOMS'.length).trim().split(/\s+/);
        break header;
      }
      // Anything else (blank lines, ITEM: TIME, units lines) is skipped.
    }

    if (natoms < 0 || boundsRemaining !== 0 || !columns) {
      throw new Error('streaming parser: incomplete LAMMPS dump header');
    }

    // ─── Column resolution ────────────────────────────────────────
    const colIdx = (names: string[]) => {
      for (const n of names) {
        const i = columns!.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const idIdx = columns.indexOf('id');
    const typeIdx = columns.indexOf('type');
    const xIdx = colIdx(['x', 'xu', 'xs', 'xsu']);
    const yIdx = colIdx(['y', 'yu', 'ys', 'ysu']);
    const zIdx = colIdx(['z', 'zu', 'zs', 'zsu']);
    if (xIdx < 0 || yIdx < 0 || zIdx < 0 || typeIdx < 0) {
      throw new Error(`streaming parser: required columns missing (got [${columns.join(', ')}])`);
    }
    const scaled =
      columns[xIdx].startsWith('xs') || columns[yIdx].startsWith('ys') || columns[zIdx].startsWith('zs');

    // Box vectors for the scaled→Cartesian map. LAMMPS triclinic BOX
    // BOUNDS lines are *bounding-box* extents (xlo_bound = xlo +
    // min(0,xy,xz,xy+xz), etc.) — recover the true cell edges before
    // unscaling, or tilted cells reconstruct with sheared positions.
    // Tilt is zero for orthogonal boxes, so one formula covers both.
    const xy = boxTilt[0], xz = boxTilt[1], yz = boxTilt[2];
    let xlo = boxBounds[0], xhi = boxBounds[1];
    let ylo = boxBounds[2], yhi = boxBounds[3];
    const zlo = boxBounds[4];
    if (triclinic) {
      xlo -= Math.min(0, xy, xz, xy + xz);
      xhi -= Math.max(0, xy, xz, xy + xz);
      ylo -= Math.min(0, yz);
      yhi -= Math.max(0, yz);
    }
    const lx = xhi - xlo;
    const ly = yhi - ylo;
    const lz = boxBounds[5] - boxBounds[4];

    // Extra columns become named per-atom properties. Whether a column is
    // numeric (c_pe: yes, element: no) is decided from the first data row.
    const ncols = columns.length;
    const targets = new Int8Array(ncols).fill(T_SKIP);
    const propSlot = new Int32Array(ncols).fill(-1);
    if (idIdx >= 0) targets[idIdx] = T_ID;
    targets[typeIdx] = T_TYPE;
    targets[xIdx] = T_X;
    targets[yIdx] = T_Y;
    targets[zIdx] = T_Z;
    const extraCols: number[] = [];
    for (let c = 0; c < ncols; c++) if (targets[c] === T_SKIP) extraCols.push(c);

    const frame: Frame = {
      timestep,
      natoms,
      boxBounds,
      boxTilt,
      triclinic,
      columns,
      ids: new Int32Array(natoms),
      types: new Int32Array(natoms),
      positions: new Float32Array(natoms * 3),
      bonds: new Int32Array(0),
      properties: new Map(),
      // Source IDs cannot be called unique until every row has been scanned.
      // The same Frame object is upgraded after validation below; progressive
      // consumers therefore never observe an unverified stable-identity claim.
      identity: idIdx >= 0
        ? { kind: 'source-id', unique: false }
        : { kind: 'synthetic-row', unique: true },
    };
    const propArrays: Float32Array[] = [];

    // Numeric-probe the first complete data row (peek — cursor unmoved).
    if (extraCols.length > 0 && natoms > 0) {
      let probeNl = findNl(cursor);
      while (probeNl === -1) {
        const adjusted = await fill(cursor);
        if (adjusted === -1) break;
        cursor = adjusted;
        probeNl = findNl(cursor);
      }
      if (probeNl > cursor) {
        const probe = headerDecoder.decode(buf.subarray(cursor, probeNl)).trim().split(/\s+/);
        for (const c of extraCols) {
          if (c < probe.length && Number.isFinite(parseFloat(probe[c]))) {
            const arr = new Float32Array(natoms);
            frame.properties.set(columns[c], arr);
            propSlot[c] = propArrays.length;
            propArrays.push(arr);
            targets[c] = T_PROP;
          }
        }
      }
    }

    if (frameIndex === 0) {
      yield { type: 'header', frame };
    }

    // ─── Atom phase: the hot loop, raw bytes ─────────────────────
    const positions = frame.positions;
    const types = frame.types;
    const ids = frame.ids;
    const seenSourceIds = idIdx >= 0 ? new Int32IdSet(natoms) : null;

    let i = 0;
    let lastYieldAt = 0;
    let nextFrameFollows = false;

    while (i < natoms) {
      const lineEnd = findNl(cursor);

      if (lineEnd === -1) {
        const adjusted = await fill(cursor);
        if (adjusted === -1) break;
        cursor = adjusted;
        continue;
      }

      // Next-frame `ITEM:` marker check (cheap prefix test).
      if (
        buf[cursor] === 73 /* I */ &&
        buf[cursor + 1] === 84 /* T */ &&
        buf[cursor + 2] === 69 /* E */ &&
        buf[cursor + 3] === 77 /* M */
      ) {
        nextFrameFollows = true;
        break;
      }

      if (lineEnd === cursor) {
        cursor = lineEnd + 1;
        continue;
      }

      // Scan the row in place: per column, skip whitespace then parse the
      // token straight out of the byte buffer. The newline at lineEnd is
      // the guaranteed terminator for every numeric scan.
      let p = cursor;
      let rx = 0, ry = 0, rz = 0;
      let rowHasSourceId = false;
      for (let c = 0; c < ncols && p < lineEnd; c++) {
        let ch = buf[p];
        while (p < lineEnd && (ch === 32 || ch === 9 || ch === 13)) ch = buf[++p];
        if (p >= lineEnd) break;
        const tokenStart = p;
        const v = scanFloat(buf, p, lineEnd);
        p = scanEnd;
        switch (targets[c]) {
          case T_ID: {
            const exactId = scanPositiveInt32Token(buf, tokenStart, p);
            if (exactId === undefined) {
              throw new DumpParseError(
                'INVALID_ATOM_ID',
                `LAMMPS atom ID must be a positive integer in the Int32 range 1..2147483647; frame ${frameIndex} ` +
                  `(timestep ${timestep}), row ${i + 1} contains ${String(v)}. ` +
                  'Export a unique integer `id` column or omit it to use frame-local row identity.',
                { frameIndex, timestep, atomRow: i + 1, atomId: v },
              );
            }
            if (!seenSourceIds!.add(exactId)) {
              throw new DumpParseError(
                'DUPLICATE_ATOM_ID',
                `Duplicate LAMMPS atom ID ${exactId} in frame ${frameIndex} (timestep ${timestep}), ` +
                  `row ${i + 1}. Atom IDs must be unique within every frame before ` +
                  'cross-frame atom tracking is safe.',
                { frameIndex, timestep, atomRow: i + 1, atomId: exactId },
              );
            }
            ids[i] = exactId;
            rowHasSourceId = true;
            break;
          }
          case T_TYPE: types[i] = v | 0; break;
          case T_X: rx = v; break;
          case T_Y: ry = v; break;
          case T_Z: rz = v; break;
          case T_PROP: propArrays[propSlot[c]][i] = v; break;
        }
      }

      if (idIdx >= 0 && !rowHasSourceId) {
        throw new DumpParseError(
          'INVALID_ATOM_ID',
          `LAMMPS atom ID is missing in frame ${frameIndex} (timestep ${timestep}), ` +
            `row ${i + 1}. Every row must contain a unique integer ID, or the ` +
            '`id` column must be omitted to use frame-local row identity.',
          { frameIndex, timestep, atomRow: i + 1 },
        );
      }
      if (idIdx < 0) ids[i] = i + 1;

      const pi = i * 3;
      if (scaled) {
        // General (triclinic) fractional→Cartesian map; tilt terms vanish
        // for orthogonal boxes.
        positions[pi]     = xlo + rx * lx + ry * xy + rz * xz;
        positions[pi + 1] = ylo + ry * ly + rz * yz;
        positions[pi + 2] = zlo + rz * lz;
      } else {
        positions[pi]     = rx;
        positions[pi + 1] = ry;
        positions[pi + 2] = rz;
      }

      i++;
      cursor = lineEnd + 1;

      if (frameIndex === 0 && i - lastYieldAt >= ATOM_CHUNK_SIZE) {
        yield { type: 'progress', loadedAtoms: i };
        lastYieldAt = i;
      }
    }

    // An unterminated final row (no trailing newline at EOF) is a torn
    // write from a killed run — LAMMPS newline-terminates every row it
    // completes — so it is deliberately dropped rather than parsed as
    // potentially half-written numbers.

    // Reaching the end of the parsed rows without DumpParseError proves that
    // every present source ID was an Int32 integer and unique within this
    // frame. Upgrade only now, after the evidence exists.
    if (idIdx >= 0) frame.identity = { kind: 'source-id', unique: true };

    // Filled the frame cleanly — look just past it for the next frame's
    // `ITEM:` so trajectories whose frames align exactly are recognized.
    if (!nextFrameFollows) {
      while (true) {
        while (cursor < end && isWsByte(buf[cursor])) cursor++;
        if (cursor < end) {
          // Don't conclude on a partial marker ("ITE" at a chunk edge).
          if (end - cursor >= 5 || sourceDone) {
            nextFrameFollows =
              buf[cursor] === 73 && buf[cursor + 1] === 84 && buf[cursor + 2] === 69 &&
              buf[cursor + 3] === 77 && buf[cursor + 4] === 58 /* : */;
            break;
          }
          const adjusted = await fill(cursor);
          if (adjusted === -1) {
            nextFrameFollows =
              buf[cursor] === 73 && buf[cursor + 1] === 84 && buf[cursor + 2] === 69 &&
              buf[cursor + 3] === 77 && buf[cursor + 4] === 58;
            break;
          }
          cursor = adjusted;
          continue;
        }
        if (sourceDone) break;
        const adjusted = await fill(cursor);
        if (adjusted === -1) break;
        cursor = adjusted;
      }
    }

    const truncateFrameToCompleteRows = (count: number) => {
      if (count >= frame.natoms) return;
      frame.natoms = count;
      frame.ids = frame.ids.slice(0, count);
      frame.types = frame.types.slice(0, count);
      frame.positions = frame.positions.slice(0, count * 3);
      for (const [name, values] of frame.properties) {
        frame.properties.set(name, values.slice(0, count));
      }
    };

    if (frameIndex === 0) {
      frame0Loaded = i;
      // LAMMPS newline-terminates complete rows. If the final frame was
      // torn, keep only complete source rows instead of presenting the
      // zero-filled tail as atoms.
      truncateFrameToCompleteRows(i);
    } else if (i > 0) {
      // A truncated final frame reports the atoms it actually has.
      truncateFrameToCompleteRows(i);
      yield { type: 'frame', frameIndex, frame };
    } else {
      frameIndex--; // empty trailing frame — drop it
    }

    frameIndex++;

    if (!nextFrameFollows) break;
    if (!multiFrame) {
      hasMoreFrames = true;
      break;
    }
  }

  yield { type: 'complete', loadedAtoms: frame0Loaded, hasMoreFrames, totalFrames: frameIndex };
}

/** Parse a fully-buffered LAMMPS dump string (encoded once, then parsed
 *  on bytes like every other source). */
export async function* parseDumpStream(
  text: string,
  opts: DumpStreamOptions = {},
): AsyncGenerator<DumpStreamEvent> {
  let yielded = false;
  yield* parseDumpStreamCore(async () => {
    if (yielded) return null;
    yielded = true;
    return new TextEncoder().encode(text);
  }, opts);
}

/** Parse from an async iterable of byte chunks (fetch body, File.stream()).
 *  Chunks are consumed as-is — no intermediate string materialization. */
export async function* parseDumpStreamFromBytes(
  source: AsyncIterable<Uint8Array>,
  opts: DumpStreamOptions = {},
): AsyncGenerator<DumpStreamEvent> {
  const iter = source[Symbol.asyncIterator]();
  yield* parseDumpStreamCore(async () => {
    const r = await iter.next();
    return r.done ? null : r.value;
  }, opts);
}

type CanonicalDumpDecodeOptions = {
  onFrameDecoded?: (decodedFrames: number) => void;
};

async function collectCanonicalDumpFrames(
  events: AsyncGenerator<DumpStreamEvent>,
  options: CanonicalDumpDecodeOptions = {},
): Promise<Frame[]> {
  const frames: Frame[] = [];
  let reportedFrames = 0;
  const reportCompletedFrames = () => {
    while (reportedFrames < frames.length) {
      reportedFrames += 1;
      options.onFrameDecoded?.(reportedFrames);
    }
  };
  for await (const event of events) {
    if (event.type === 'header') {
      frames.push(event.frame);
    } else if (event.type === 'frame') {
      frames.push(event.frame);
      reportCompletedFrames();
    } else if (event.type === 'complete' && frames.length > 0) {
      reportCompletedFrames();
    }
  }
  if (frames.length === 0) throw new Error('No frames parsed; possibly wrong format.');
  return frames;
}

/** Decode buffered text through the same byte parser used by streaming. */
export function parseDumpFramesCanonical(
  text: string,
  options: CanonicalDumpDecodeOptions = {},
): Promise<Frame[]> {
  return collectCanonicalDumpFrames(parseDumpStream(text, { multiFrame: true }), options);
}

/** Decode a chunked source through the canonical LAMMPS dump implementation. */
export function parseDumpFramesFromBytesCanonical(
  source: AsyncIterable<Uint8Array>,
  options: CanonicalDumpDecodeOptions = {},
): Promise<Frame[]> {
  return collectCanonicalDumpFrames(
    parseDumpStreamFromBytes(source, { multiFrame: true }),
    options,
  );
}

/**
 * Decode a local dump Blob/File without selecting scientific behavior by
 * size or compression. Gzip is transport only and is detected by magic.
 */
export async function parseDumpBlobCanonical(
  blob: Blob,
  options: CanonicalDumpDecodeOptions = {},
): Promise<Frame[]> {
  let stream = blob.stream() as ReadableStream<Uint8Array>;
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (magic.length === 2 && magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Cannot decode gzip LAMMPS dump: DecompressionStream is unavailable.');
    }
    stream = stream.pipeThrough(
      new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
    );
  }
  return parseDumpFramesFromBytesCanonical(readableStreamToAsyncIterable(stream), options);
}

/** Adapt a `ReadableStream<Uint8Array>` to an `AsyncIterable<Uint8Array>`. */
export function readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          try {
            const r = await reader.read();
            if (r.done) {
              reader.releaseLock();
              return { value: undefined, done: true };
            }
            return { value: r.value, done: false };
          } catch (err) {
            try { reader.releaseLock(); } catch { /* already released */ }
            throw err;
          }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          try { await reader.cancel(); } catch { /* ignore */ }
          try { reader.releaseLock(); } catch { /* ignore */ }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/** Fast pre-flight: can the streaming parser take this content? Thin
 *  wrapper over the executable compatibility contract in
 *  `dumpContract.ts` — use `analyzeDumpHead` directly when you need the
 *  reasons, not just the verdict. */
export function canStreamDump(textHead: string): boolean {
  return analyzeDumpHead(textHead).tier === 'streamable';
}
