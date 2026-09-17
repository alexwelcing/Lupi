/**
 * LAMMPS data file (`read_data` format) parser — byte-level TypeScript port
 * of the retired WASM implementation (wasm/src/data.rs), semantics preserved:
 *
 *   - header stats (`N atoms`, box bounds, `xy xz yz` tilt),
 *   - `Atoms` in atomic / charge / molecular / full styles, honoring a
 *     `# style` hint on the section line (accelerator suffixes ignored) and
 *     falling back to the token-count heuristic; trailing image flags and
 *     `# comments` ignored,
 *   - `Masses` rows mapped to elements by standard mass with the force-field
 *     label comment as the tiebreak, remapping every atom type to an atomic
 *     number only when all types resolve (raw type ids survive as `type_id`),
 *   - `Bonds` (atom ids → row indices), `Velocities` before or after Atoms,
 *   - `q` / `mol` / `vx vy vz` per-atom properties,
 *   - every other section (Pair Coeffs, Angles, ...) skipped.
 *
 * One pass over raw bytes writes straight into typed arrays: no whole-file
 * string, no line vector, no boxed-number bridge.
 */

import type { Frame } from '@atlas/core/types';
import { countTokens, isSpace, NL, scanFloat, scanInt32, tokenizeLine } from './byteScan';

/** Standard atomic masses (amu), atomic number = index + 1. Mirrors the WASM
 *  table exactly so mass-based element resolution keeps identical results. */
const ELEMENT_MASSES: readonly number[] = [
  1.008, 4.0026, 6.94, 9.0122, 10.811, 12.011, 14.007, 15.999, 18.998, 20.180,
  22.990, 24.305, 26.982, 28.085, 30.974, 32.06, 35.45, 39.948, 39.098, 40.078,
  44.956, 47.867, 50.942, 51.996, 54.938, 55.845, 58.933, 58.693, 63.546, 65.38,
  69.723, 72.630, 74.922, 78.971, 79.904, 83.798, 85.468, 87.62, 88.906, 91.224,
  92.906, 95.95, 98.0, 101.07, 102.91, 106.42, 107.87, 112.41, 114.82, 118.71,
  121.76, 127.60, 126.90, 131.29, 132.91, 137.33, 138.91, 140.12, 140.91, 144.24,
  145.0, 150.36, 151.96, 157.25, 158.93, 162.50, 164.93, 167.26, 168.93, 173.05,
  174.97, 178.49, 180.95, 183.84, 186.21, 190.23, 192.22, 195.08, 196.97, 200.59,
  204.38, 207.2, 208.98, 209.0, 210.0, 222.0, 223.0, 226.0, 227.0, 232.04,
  231.04, 238.03,
];

const ELEMENT_SYMBOLS: readonly string[] = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U',
];

/** Nearest standard element by mass, accepted only within ±0.5 amu so
 *  coarse-grained / united-atom masses fall through to the label fallback. */
export function elementFromMass(mass: number): number | undefined {
  let bestIndex = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < ELEMENT_MASSES.length; i++) {
    const diff = Math.abs(mass - ELEMENT_MASSES[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 && bestDiff <= 0.5 ? bestIndex + 1 : undefined;
}

/** Resolve a Masses comment label like "c3", "h2", "ow", "cl1" to an element:
 *  the leading alphabetic run, two letters first, then one. */
export function elementFromLabel(label: string): number | undefined {
  const first = label.trim().split(/\s+/)[0];
  if (!first) return undefined;
  let alpha = '';
  for (const ch of first) {
    if (!/[A-Za-z]/.test(ch)) break;
    alpha += ch;
  }
  for (const len of [2, 1]) {
    if (alpha.length >= len) {
      const candidate = alpha.slice(0, len).toLowerCase();
      const index = ELEMENT_SYMBOLS.findIndex((symbol) => symbol.toLowerCase() === candidate);
      if (index >= 0) return index + 1;
    }
  }
  return undefined;
}

/**
 * Combine the mass and label signals for one Masses row: trust the label iff
 * the file mass is plausible for that element (element − 0.5 .. element +
 * 4.6, the united-atom convention); otherwise the nearest standard mass wins,
 * with the label as the last resort.
 */
export function resolveElement(mass: number, label: string | null): number | undefined {
  const byLabel = label !== null ? elementFromLabel(label) : undefined;
  if (byLabel !== undefined) {
    const labelMass = ELEMENT_MASSES[byLabel - 1];
    if (mass >= labelMass - 0.5 && mass <= labelMass + 4.6) return byLabel;
  }
  return elementFromMass(mass) ?? byLabel;
}

type AtomStyle = 'atomic' | 'charge' | 'molecular' | 'full';

function styleFromHint(comment: string): AtomStyle | undefined {
  const first = comment.trim().split(/\s+/)[0];
  if (!first) return undefined;
  const base = first.split('/')[0].toLowerCase();
  if (base === 'full' || base === 'charge' || base === 'molecular' || base === 'atomic') return base;
  return undefined;
}

function styleFromTokenCount(count: number): AtomStyle {
  if (count >= 7) return 'full';
  if (count === 6) return 'charge';
  return 'atomic';
}

class GrowableInt32 {
  data = new Int32Array(1024);
  length = 0;
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
}

class GrowableFloat32 {
  data = new Float32Array(1024);
  length = 0;
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  trimmed(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

const textDecoder = /* @__PURE__ */ new TextDecoder('utf-8', { fatal: false });
const HASH = 35;

function isAlphabeticByte(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c >= 0x80;
}

function bytesEndWith(b: Uint8Array, start: number, end: number, suffix: string): boolean {
  if (end - start < suffix.length) return false;
  for (let i = 0; i < suffix.length; i++) {
    if (b[end - suffix.length + i] !== suffix.charCodeAt(i)) return false;
  }
  return true;
}

function bytesStartWith(b: Uint8Array, start: number, end: number, prefix: string): boolean {
  if (end - start < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (b[start + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

export interface LammpsDataFrameStats {
  bounds: [number, number, number, number, number, number];
  types: number[];
}

export interface LammpsDataParseResult {
  frame: Frame;
  stats: LammpsDataFrameStats;
  /** True when every atom type resolved to an element through Masses. */
  hasCompleteMassMapping: boolean;
}

export class LammpsDataParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LammpsDataParseError';
  }
}

/** Parse a LAMMPS data file from raw bytes. */
export function parseLammpsDataBytes(bytes: Uint8Array): LammpsDataParseResult {
  const length = bytes.length;
  let pos = 0;
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) pos = 3;

  type Section = 'header' | 'atoms' | 'bonds' | 'masses' | 'velocities' | 'skip';
  let section: Section = 'header';
  let titleSeen = false;
  let styleHint: AtomStyle | undefined;
  let natomsHint = 0;
  const boxBounds = new Float64Array(6);
  const boxTilt = new Float64Array(3);

  const ids = new GrowableInt32();
  const rawTypes = new GrowableInt32();
  const positions = new GrowableFloat32();
  const charges = new GrowableFloat32();
  const mols = new GrowableFloat32();
  const bondIds = new GrowableInt32();
  const velocityIds = new GrowableInt32();
  const velocityValues = new GrowableFloat32();
  const massesByType = new Map<number, number | undefined>();

  let style: AtomStyle | undefined;
  let molCol = -1, typeCol = 1, qCol = -1, xCol = 2;

  const starts = new Int32Array(16);
  const ends = new Int32Array(16);

  while (pos < length) {
    let lineEnd = bytes.indexOf(NL, pos);
    if (lineEnd < 0) lineEnd = length;
    const nextPos = lineEnd + 1;

    // Trim, then split at the first '#'.
    let s = pos;
    let e = lineEnd;
    while (s < e && isSpace(bytes[s])) s++;
    while (e > s && isSpace(bytes[e - 1])) e--;
    pos = nextPos;
    if (s === e) continue;
    if (bytes[s] === HASH) continue; // whole-line comment
    if (!titleSeen) { titleSeen = true; continue; }

    let bodyEnd = e;
    let commentStart = -1;
    for (let i = s; i < e; i++) {
      if (bytes[i] === HASH) { bodyEnd = i; commentStart = i + 1; break; }
    }
    while (bodyEnd > s && isSpace(bytes[bodyEnd - 1])) bodyEnd--;
    if (bodyEnd === s) continue;
    const comment = commentStart >= 0 ? textDecoder.decode(bytes.subarray(commentStart, e)).trim() : null;

    // Section keyword lines are the only alphabetic-leading lines outside
    // comments; header stat lines start with a number.
    if (isAlphabeticByte(bytes[s])) {
      if (bytesStartWith(bytes, s, bodyEnd, 'Atoms')) {
        section = 'atoms';
        styleHint = comment !== null ? styleFromHint(comment) : undefined;
        style = undefined;
      } else if (bytesStartWith(bytes, s, bodyEnd, 'Bonds')) {
        section = 'bonds';
      } else if (bytesStartWith(bytes, s, bodyEnd, 'Masses')) {
        section = 'masses';
      } else if (bytesStartWith(bytes, s, bodyEnd, 'Velocities')) {
        section = 'velocities';
      } else {
        section = 'skip';
      }
      continue;
    }

    switch (section) {
      case 'header': {
        const count = tokenizeLine(bytes, s, bodyEnd, starts, ends);
        if (bytesEndWith(bytes, s, bodyEnd, ' atoms')) {
          natomsHint = count > 0 ? (scanInt32(bytes, starts[0], ends[0]) ?? 0) : 0;
        } else if (bytesEndWith(bytes, s, bodyEnd, 'xlo xhi') && count >= 2) {
          boxBounds[0] = scanFloat(bytes, starts[0], ends[0]) || 0;
          boxBounds[1] = scanFloat(bytes, starts[1], ends[1]) || 0;
        } else if (bytesEndWith(bytes, s, bodyEnd, 'ylo yhi') && count >= 2) {
          boxBounds[2] = scanFloat(bytes, starts[0], ends[0]) || 0;
          boxBounds[3] = scanFloat(bytes, starts[1], ends[1]) || 0;
        } else if (bytesEndWith(bytes, s, bodyEnd, 'zlo zhi') && count >= 2) {
          boxBounds[4] = scanFloat(bytes, starts[0], ends[0]) || 0;
          boxBounds[5] = scanFloat(bytes, starts[1], ends[1]) || 0;
        } else if (bytesEndWith(bytes, s, bodyEnd, 'xy xz yz') && count >= 3) {
          boxTilt[0] = scanFloat(bytes, starts[0], ends[0]) || 0;
          boxTilt[1] = scanFloat(bytes, starts[1], ends[1]) || 0;
          boxTilt[2] = scanFloat(bytes, starts[2], ends[2]) || 0;
        }
        break;
      }
      case 'atoms': {
        if (style === undefined) {
          style = styleHint ?? styleFromTokenCount(countTokens(bytes, s, bodyEnd));
          switch (style) {
            case 'atomic': molCol = -1; typeCol = 1; qCol = -1; xCol = 2; break;
            case 'charge': molCol = -1; typeCol = 1; qCol = 2; xCol = 3; break;
            case 'molecular': molCol = 1; typeCol = 2; qCol = -1; xCol = 3; break;
            case 'full': molCol = 1; typeCol = 2; qCol = 3; xCol = 4; break;
          }
        }
        const count = tokenizeLine(bytes, s, bodyEnd, starts, ends);
        if (count < xCol + 3) break;
        ids.push(scanInt32(bytes, starts[0], ends[0]) ?? 1);
        rawTypes.push(scanInt32(bytes, starts[typeCol], ends[typeCol]) ?? 1);
        if (molCol >= 0) mols.push(scanFloat(bytes, starts[molCol], ends[molCol]) || 0);
        if (qCol >= 0) charges.push(scanFloat(bytes, starts[qCol], ends[qCol]) || 0);
        positions.push(scanFloat(bytes, starts[xCol], ends[xCol]) || 0);
        positions.push(scanFloat(bytes, starts[xCol + 1], ends[xCol + 1]) || 0);
        positions.push(scanFloat(bytes, starts[xCol + 2], ends[xCol + 2]) || 0);
        break;
      }
      case 'bonds': {
        const count = tokenizeLine(bytes, s, bodyEnd, starts, ends);
        if (count >= 4) {
          bondIds.push(scanInt32(bytes, starts[2], ends[2]) ?? 0);
          bondIds.push(scanInt32(bytes, starts[3], ends[3]) ?? 0);
        }
        break;
      }
      case 'masses': {
        const count = tokenizeLine(bytes, s, bodyEnd, starts, ends);
        if (count >= 2) {
          const typeId = scanInt32(bytes, starts[0], ends[0]);
          if (typeId === undefined) break;
          const mass = scanFloat(bytes, starts[1], ends[1]) || 0;
          massesByType.set(typeId, resolveElement(mass, comment));
        }
        break;
      }
      case 'velocities': {
        const count = tokenizeLine(bytes, s, bodyEnd, starts, ends);
        if (count >= 4) {
          const id = scanInt32(bytes, starts[0], ends[0]);
          if (id === undefined) break;
          velocityIds.push(id);
          velocityValues.push(scanFloat(bytes, starts[1], ends[1]) || 0);
          velocityValues.push(scanFloat(bytes, starts[2], ends[2]) || 0);
          velocityValues.push(scanFloat(bytes, starts[3], ends[3]) || 0);
        }
        break;
      }
      case 'skip':
        break;
    }
  }

  if (style === undefined) {
    throw new LammpsDataParseError('No Atoms section found in data file');
  }
  void natomsHint;

  const natoms = ids.length;
  const idArray = ids.data.slice(0, natoms);
  const typeArray = rawTypes.data.slice(0, natoms);
  const positionArray = positions.trimmed();

  // Data files usually come sorted by ID, but map defensively — bonds and
  // velocities reference atom IDs, not row indices. Later duplicates win,
  // matching the HashMap insert order of the original implementation.
  let minId = Infinity, maxId = -Infinity;
  for (let i = 0; i < natoms; i++) {
    const id = idArray[i];
    if (id < minId) minId = id;
    if (id > maxId) maxId = id;
  }
  let indexOfId: (id: number) => number;
  if (natoms > 0 && maxId - minId < natoms * 4 + 1024) {
    const dense = new Int32Array(maxId - minId + 1).fill(-1);
    for (let i = 0; i < natoms; i++) dense[idArray[i] - minId] = i;
    indexOfId = (id) => {
      const offset = id - minId;
      return offset >= 0 && offset < dense.length ? dense[offset] : -1;
    };
  } else {
    const map = new Map<number, number>();
    for (let i = 0; i < natoms; i++) map.set(idArray[i], i);
    indexOfId = (id) => map.get(id) ?? -1;
  }

  // Element remap only when every atom type resolves; the raw LAMMPS type id
  // survives as the 'type_id' property so per-type filtering still works.
  let types = typeArray;
  let typeIdProperty: Float32Array | null = null;
  if (natoms > 0) {
    const elements = new Int32Array(natoms);
    let complete = true;
    for (let i = 0; i < natoms; i++) {
      const element = massesByType.get(typeArray[i]);
      if (element === undefined) { complete = false; break; }
      elements[i] = element;
    }
    if (complete) {
      typeIdProperty = new Float32Array(natoms);
      for (let i = 0; i < natoms; i++) typeIdProperty[i] = typeArray[i];
      types = elements;
    }
  }

  // Bonds: atom ids → row indices; pairs with an unknown id are dropped.
  const bondsOut = new GrowableInt32();
  for (let k = 0; k < bondIds.length; k += 2) {
    const i1 = indexOfId(bondIds.data[k]);
    const i2 = indexOfId(bondIds.data[k + 1]);
    if (i1 >= 0 && i2 >= 0) {
      bondsOut.push(i1);
      bondsOut.push(i2);
    }
  }

  // Velocities (may precede Atoms in the file; ids resolve here).
  let vx: Float32Array | null = null;
  let vy: Float32Array | null = null;
  let vz: Float32Array | null = null;
  for (let k = 0; k < velocityIds.length; k++) {
    const index = indexOfId(velocityIds.data[k]);
    if (index < 0) continue;
    if (!vx || !vy || !vz) {
      vx = new Float32Array(natoms);
      vy = new Float32Array(natoms);
      vz = new Float32Array(natoms);
    }
    vx[index] = velocityValues.data[k * 3];
    vy[index] = velocityValues.data[k * 3 + 1];
    vz[index] = velocityValues.data[k * 3 + 2];
  }

  const properties = new Map<string, Float32Array>();
  if (charges.length > 0) properties.set('q', charges.trimmed());
  if (mols.length > 0) properties.set('mol', mols.trimmed());
  if (typeIdProperty) properties.set('type_id', typeIdProperty);
  if (vx && vy && vz) {
    properties.set('vx', vx);
    properties.set('vy', vy);
    properties.set('vz', vz);
  }

  // Per-frame stats for the trajectory summary.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const typeSet = new Set<number>();
  for (let i = 0; i < natoms; i++) {
    const x = positionArray[i * 3], y = positionArray[i * 3 + 1], z = positionArray[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    typeSet.add(types[i]);
  }

  const frame: Frame = {
    timestep: 0,
    natoms,
    boxBounds,
    boxTilt,
    triclinic: boxTilt[0] !== 0 || boxTilt[1] !== 0 || boxTilt[2] !== 0,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: idArray,
    types,
    positions: positionArray,
    bonds: bondsOut.data.slice(0, bondsOut.length),
    properties,
  };
  return {
    frame,
    stats: {
      bounds: [minX, maxX, minY, maxY, minZ, maxZ],
      types: Array.from(typeSet).sort((a, b) => a - b),
    },
    hasCompleteMassMapping: typeIdProperty !== null,
  };
}

/** Convenience wrapper for callers holding the file as text. */
export function parseLammpsDataText(text: string): LammpsDataParseResult {
  return parseLammpsDataBytes(new TextEncoder().encode(text));
}
