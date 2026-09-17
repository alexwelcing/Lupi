/**
 * XYZ / extended-XYZ parser — byte-level core.
 *
 * Replaces the WASM XYZ path. That path materialized the whole file as one
 * JS string, split it into a line vector, and returned frames through a
 * serde bridge that produced plain JavaScript arrays of boxed numbers: the
 * worker could not transfer them, the main thread structured-cloned them and
 * copied them again into typed arrays. For a large XYZ that meant several
 * full copies at 8-16 bytes per coordinate.
 *
 * This core scans raw bytes (XYZ is ASCII), writes straight into
 * `Float32Array` / `Int32Array` frames, and reports per-frame bounds and
 * type sets so callers never rescan atoms on the main thread.
 *
 * Dialect coverage:
 *   - plain XYZ (`count`, comment, `Symbol x y z` rows, extra columns ignored),
 *   - element tokens as symbols (case-insensitive) or atomic numbers 1..118;
 *     unknown tokens fail the frame rather than silently becoming hydrogen,
 *   - extended-XYZ `Lattice="ax ay az bx by bz cx cy cz"` (orthogonal
 *     lattices become the frame box; general lattices fall back to padded
 *     coordinate bounds), and `Properties=species:S:1:pos:R:3:...` column
 *     layouts with extra real/integer columns exposed as named per-atom
 *     properties (`vel`/`velocities` -> vx,vy,vz; `force(s)` -> fx,fy,fz;
 *     other 3-vectors -> `name[1..3]`),
 *   - a bare integer comment line, or `step=`/`timestep=`/`frame=` keys, set
 *     the frame timestep; otherwise frames are numbered in order,
 *   - CRLF line endings, a UTF-8 BOM, and blank lines between frames.
 */

import type { Frame } from '@atlas/core/types';
import { ELEMENT_DATA } from '@atlas/core/elements';
import { xyzFrameMetadata } from './workers/frameTransfer';
import { NL, isSpace, scanFloat } from './byteScan';

export interface XyzFrameStats {
  /** [minX, maxX, minY, maxY, minZ, maxZ] of the parsed coordinates. */
  bounds: [number, number, number, number, number, number];
  /** Sorted unique atom types (atomic numbers) in this frame. */
  types: number[];
}

export interface XyzParseResult {
  frames: Frame[];
  stats: XyzFrameStats[];
}

export interface XyzParseOptions {
  /** Called after each frame is complete (progress reporting). */
  onFrame?: (frameIndex: number, frame: Frame) => void;
  /** Stop after this many frames (default: all). */
  maxFrames?: number;
}

export class XyzParseError extends Error {
  readonly line: number;
  readonly frameIndex: number;
  constructor(message: string, line: number, frameIndex: number) {
    super(message);
    this.name = 'XyzParseError';
    this.line = line;
    this.frameIndex = frameIndex;
  }
}

const BOUNDS_PAD = 2.0;

const SYMBOL_TO_ATOMIC_NUMBER: ReadonlyMap<string, number> = /* @__PURE__ */ (() => {
  const map = new Map<string, number>();
  for (const [key, data] of Object.entries(ELEMENT_DATA)) {
    const atomicNumber = Number(key);
    if (atomicNumber >= 1 && atomicNumber <= 118) map.set(data.symbol.toLowerCase(), atomicNumber);
  }
  return map;
})();

const textDecoder = /* @__PURE__ */ new TextDecoder('utf-8', { fatal: false });

/** Decode an element token without inventing chemistry. */
export function xyzElementToType(token: string): number {
  const trimmed = token.trim();
  if (/^[+]?\d+$/.test(trimmed)) {
    const atomicNumber = Number(trimmed);
    if (atomicNumber >= 1 && atomicNumber <= 118) return atomicNumber;
    throw new Error(`atomic number ${atomicNumber} is outside 1..118`);
  }
  const atomicNumber = SYMBOL_TO_ATOMIC_NUMBER.get(trimmed.toLowerCase());
  if (atomicNumber === undefined) throw new Error(`unknown element token '${trimmed}'`);
  return atomicNumber;
}

interface ColumnSpec {
  name: string;
  kind: 'S' | 'R' | 'I' | 'L';
  count: number;
}

interface FrameLayout {
  /** Token index of the species column. */
  speciesToken: number;
  /** Token index of the first position component. */
  posToken: number;
  /** Total tokens the layout requires per row. */
  requiredTokens: number;
  /** Extra numeric columns exposed as properties: token index -> property name. */
  propertyTokens: Array<{ token: number; name: string }>;
  columns: string[];
}

const DEFAULT_LAYOUT: FrameLayout = {
  speciesToken: 0,
  posToken: 1,
  requiredTokens: 4,
  propertyTokens: [],
  columns: ['id', 'type', 'x', 'y', 'z'],
};

function propertyNames(name: string, count: number): string[] {
  if (count === 1) return [name];
  const lower = name.toLowerCase();
  if (count === 3) {
    if (lower === 'vel' || lower === 'velo' || lower === 'velocity' || lower === 'velocities') return ['vx', 'vy', 'vz'];
    if (lower === 'force' || lower === 'forces') return ['fx', 'fy', 'fz'];
    if (lower === 'momenta' || lower === 'momentum') return ['px', 'py', 'pz'];
  }
  return Array.from({ length: count }, (_, i) => `${name}[${i + 1}]`);
}

/** Interpret an extended-XYZ `Properties=` declaration. */
export function parseXyzProperties(spec: string): FrameLayout {
  const parts = spec.split(':');
  if (parts.length < 3 || parts.length % 3 !== 0) {
    throw new Error(`malformed Properties declaration '${spec}'`);
  }
  const columns: ColumnSpec[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    const kind = parts[i + 1].toUpperCase();
    const count = Number(parts[i + 2]);
    if ((kind !== 'S' && kind !== 'R' && kind !== 'I' && kind !== 'L') || !Number.isInteger(count) || count < 1) {
      throw new Error(`malformed Properties declaration '${spec}'`);
    }
    columns.push({ name: parts[i], kind: kind as ColumnSpec['kind'], count });
  }

  let token = 0;
  let speciesToken = -1;
  let posToken = -1;
  const propertyTokens: Array<{ token: number; name: string }> = [];
  for (const column of columns) {
    const lower = column.name.toLowerCase();
    if (speciesToken < 0 && column.kind === 'S' && column.count === 1
      && (lower === 'species' || lower === 'element' || lower === 'symbol' || lower === 'type')) {
      speciesToken = token;
    } else if (posToken < 0 && column.kind === 'R' && column.count === 3 && (lower === 'pos' || lower === 'position' || lower === 'positions')) {
      posToken = token;
    } else if (column.kind === 'R' || column.kind === 'I') {
      const names = propertyNames(column.name, column.count);
      for (let k = 0; k < column.count; k++) propertyTokens.push({ token: token + k, name: names[k] });
    }
    token += column.count;
  }
  if (speciesToken < 0) {
    const firstString = columns.findIndex((c) => c.kind === 'S' && c.count === 1);
    if (firstString < 0) throw new Error(`Properties declaration '${spec}' has no species column`);
    speciesToken = columns.slice(0, firstString).reduce((sum, c) => sum + c.count, 0);
  }
  if (posToken < 0) {
    let offset = 0;
    for (const column of columns) {
      if (column.kind === 'R' && column.count === 3) { posToken = offset; break; }
      offset += column.count;
    }
    if (posToken < 0) throw new Error(`Properties declaration '${spec}' has no pos:R:3 column`);
    // A generic R:3 that became the position column is not also a property.
    for (let k = propertyTokens.length - 1; k >= 0; k--) {
      if (propertyTokens[k].token >= posToken && propertyTokens[k].token < posToken + 3) propertyTokens.splice(k, 1);
    }
  }
  return {
    speciesToken,
    posToken,
    requiredTokens: token,
    propertyTokens,
    columns: ['id', 'type', 'x', 'y', 'z', ...propertyTokens.map((p) => p.name)],
  };
}

interface CommentInfo {
  timestep: number | null;
  lattice: number[] | null;
  layout: FrameLayout;
}

/** Read `key=value` / `key="quoted value"` pairs from an extended-XYZ comment. */
function parseComment(comment: string, frameIndex: number, lineNumber: number): CommentInfo {
  const trimmed = comment.trim();
  const info: CommentInfo = { timestep: null, lattice: null, layout: DEFAULT_LAYOUT };
  if (/^\d+$/.test(trimmed)) {
    info.timestep = Number(trimmed);
    return info;
  }
  const pairs = /([A-Za-z_][A-Za-z0-9_\-]*)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = pairs.exec(trimmed)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (key === 'lattice') {
      const numbers = value.trim().split(/\s+/).map(Number);
      if (numbers.length === 9 && numbers.every(Number.isFinite)) info.lattice = numbers;
    } else if (key === 'properties') {
      try {
        info.layout = parseXyzProperties(value.trim());
      } catch (error) {
        throw new XyzParseError(
          `Invalid extended-XYZ header at line ${lineNumber}: ${(error as Error).message}`,
          lineNumber,
          frameIndex,
        );
      }
    } else if ((key === 'step' || key === 'timestep' || key === 'frame') && info.timestep === null) {
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0) info.timestep = numeric;
    }
  }
  return info;
}

function orthogonalLatticeBox(lattice: number[] | null): Float64Array | null {
  if (!lattice) return null;
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = lattice;
  const offAxis = Math.abs(ay) + Math.abs(az) + Math.abs(bx) + Math.abs(bz) + Math.abs(cx) + Math.abs(cy);
  if (offAxis > 1e-9 || ax <= 0 || by <= 0 || cz <= 0) return null;
  return new Float64Array([0, ax, 0, by, 0, cz]);
}

/** Parse every frame of an XYZ byte buffer. */
export function parseXyzBytes(bytes: Uint8Array, options: XyzParseOptions = {}): XyzParseResult {
  const frames: Frame[] = [];
  const stats: XyzFrameStats[] = [];
  const metadata = xyzFrameMetadata();
  const maxFrames = options.maxFrames ?? Number.POSITIVE_INFINITY;
  const length = bytes.length;
  let pos = 0;
  let lineNumber = 0;
  // UTF-8 BOM
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) pos = 3;

  const nextLineEnd = (from: number): number => {
    const nl = bytes.indexOf(NL, from);
    return nl < 0 ? length : nl;
  };

  while (pos < length && frames.length < maxFrames) {
    // Atom count line (skip blank lines between frames).
    let lineEnd = nextLineEnd(pos);
    lineNumber++;
    let s = pos;
    while (s < lineEnd && isSpace(bytes[s])) s++;
    let e = lineEnd;
    while (e > s && isSpace(bytes[e - 1])) e--;
    if (s === e) { pos = lineEnd + 1; continue; }
    let natoms = 0;
    let countValid = e - s > 0;
    for (let i = s; i < e; i++) {
      const digit = bytes[i] - 48;
      if (digit < 0 || digit > 9) { countValid = false; break; }
      natoms = natoms * 10 + digit;
      if (natoms > 2_000_000_000) { countValid = false; break; }
    }
    if (!countValid) {
      throw new XyzParseError(
        `Expected atom count at line ${lineNumber}, got: '${textDecoder.decode(bytes.subarray(s, Math.min(e, s + 80)))}'`,
        lineNumber,
        frames.length,
      );
    }
    pos = lineEnd + 1;
    if (pos >= length) break;

    // Comment line.
    lineEnd = nextLineEnd(pos);
    lineNumber++;
    const commentLine = lineNumber;
    const comment = textDecoder.decode(bytes.subarray(pos, lineEnd));
    pos = lineEnd + 1;
    const info = parseComment(comment, frames.length, commentLine);
    const layout = info.layout;

    const positions = new Float32Array(natoms * 3);
    const types = new Int32Array(natoms);
    const ids = new Int32Array(natoms);
    const propertyArrays = layout.propertyTokens.map(() => new Float32Array(natoms));
    const tokenStarts = new Int32Array(layout.requiredTokens);
    const tokenEnds = new Int32Array(layout.requiredTokens);
    const typeSet = new Set<number>();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let atom = 0; atom < natoms; atom++) {
      if (pos >= length) {
        throw new XyzParseError(
          `Unexpected end of file while reading atom ${atom + 1} of frame ${frames.length + 1}`,
          lineNumber,
          frames.length,
        );
      }
      lineEnd = nextLineEnd(pos);
      lineNumber++;
      // Tokenize the row in place.
      let i = pos;
      let tokenCount = 0;
      while (i < lineEnd && tokenCount < layout.requiredTokens) {
        while (i < lineEnd && isSpace(bytes[i])) i++;
        if (i >= lineEnd) break;
        const tokenStart = i;
        while (i < lineEnd && !isSpace(bytes[i])) i++;
        tokenStarts[tokenCount] = tokenStart;
        tokenEnds[tokenCount] = i;
        tokenCount++;
      }
      if (tokenCount < layout.requiredTokens) {
        throw new XyzParseError(
          `Expected at least ${layout.requiredTokens} columns at line ${lineNumber}, got: '${textDecoder.decode(bytes.subarray(pos, Math.min(lineEnd, pos + 120)))}'`,
          lineNumber,
          frames.length,
        );
      }

      const speciesToken = textDecoder.decode(bytes.subarray(tokenStarts[layout.speciesToken], tokenEnds[layout.speciesToken]));
      let atomType: number;
      try {
        atomType = xyzElementToType(speciesToken);
      } catch (error) {
        throw new XyzParseError(
          `Invalid XYZ element at line ${lineNumber}: ${(error as Error).message}`,
          lineNumber,
          frames.length,
        );
      }

      const x = scanFloat(bytes, tokenStarts[layout.posToken], tokenEnds[layout.posToken]);
      const y = scanFloat(bytes, tokenStarts[layout.posToken + 1], tokenEnds[layout.posToken + 1]);
      const z = scanFloat(bytes, tokenStarts[layout.posToken + 2], tokenEnds[layout.posToken + 2]);
      if (Number.isNaN(x)) throw new XyzParseError(`Invalid x coordinate at line ${lineNumber}`, lineNumber, frames.length);
      if (Number.isNaN(y)) throw new XyzParseError(`Invalid y coordinate at line ${lineNumber}`, lineNumber, frames.length);
      if (Number.isNaN(z)) throw new XyzParseError(`Invalid z coordinate at line ${lineNumber}`, lineNumber, frames.length);

      const base = atom * 3;
      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;
      types[atom] = atomType;
      ids[atom] = atom + 1;
      typeSet.add(atomType);
      // Bounds track the stored float32 values so the padded box matches the
      // coordinates the renderer actually sees.
      const fx = positions[base];
      const fy = positions[base + 1];
      const fz = positions[base + 2];
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
      if (fz < minZ) minZ = fz;
      if (fz > maxZ) maxZ = fz;

      for (let p = 0; p < propertyArrays.length; p++) {
        const tokenIndex = layout.propertyTokens[p].token;
        const value = scanFloat(bytes, tokenStarts[tokenIndex], tokenEnds[tokenIndex]);
        propertyArrays[p][atom] = Number.isNaN(value) ? 0 : value;
      }

      pos = lineEnd + 1;
    }

    if (natoms === 0) {
      minX = minY = minZ = 0;
      maxX = maxY = maxZ = 0;
    }
    const latticeBox = orthogonalLatticeBox(info.lattice);
    const boxBounds = latticeBox ?? new Float64Array([
      minX - BOUNDS_PAD, maxX + BOUNDS_PAD,
      minY - BOUNDS_PAD, maxY + BOUNDS_PAD,
      minZ - BOUNDS_PAD, maxZ + BOUNDS_PAD,
    ]);

    const properties = new Map<string, Float32Array>();
    layout.propertyTokens.forEach((property, index) => {
      if (!properties.has(property.name)) properties.set(property.name, propertyArrays[index]);
    });

    const frame: Frame = {
      timestep: info.timestep ?? frames.length,
      natoms,
      boxBounds,
      boxTilt: new Float64Array([0, 0, 0]),
      triclinic: false,
      columns: layout.columns,
      ids,
      types,
      positions,
      bonds: new Int32Array(0),
      properties,
      identity: metadata.identity,
      typeSemantics: metadata.typeSemantics,
      distanceSemantics: metadata.distanceSemantics,
    };
    frames.push(frame);
    stats.push({
      bounds: [minX, maxX, minY, maxY, minZ, maxZ],
      types: Array.from(typeSet).sort((a, b) => a - b),
    });
    options.onFrame?.(frames.length - 1, frame);
  }

  if (frames.length === 0) {
    throw new XyzParseError('No valid XYZ frames found', lineNumber, 0);
  }
  return { frames, stats };
}

/** Convenience wrapper for callers that already hold the file as text. */
export function parseXyzText(text: string, options: XyzParseOptions = {}): XyzParseResult {
  return parseXyzBytes(new TextEncoder().encode(text), options);
}
