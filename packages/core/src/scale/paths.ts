// Paths (scale-spec §4.1, §4.2, §4.4): steps, their canonical encoding,
// merging and the containment of removals. A path's size grows with the
// choices made, never with the depth: a tower step holds digit runs.

import { compareBytes, fail, Reader, Writer } from './bytes';

export interface DigitRun {
  digit: number;
  length: bigint;
}

export interface AtomRange {
  start: number;
  length: number;
}

export type AxisRuns = [DigitRun[], DigitRun[], DigitRun[]];

export type Step =
  | { tag: 'child'; index: number }
  | { tag: 'cells'; octants: number[] }
  | { tag: 'tower'; levels: bigint; runs: AxisRuns }
  | { tag: 'atoms'; ranges: AtomRange[] };

export const TAG = { child: 1, cells: 2, tower: 3, atoms: 4 } as const;

/** §1.9 limits on a path in a record or a reference. */
export const PATH_MAX_BYTES = 65536;
export const PATH_MAX_STEPS = 1024;
export const CELLS_MAX_OCTANTS = 64;
export const TOWER_MAX_RUNS = 4096;
export const ATOMS_MAX_RANGES = 4096;
export const ATOMS_INDEX_LIMIT = 4096;

// ─── Digit runs ───────────────────────────────────────────────────────

export function runsLength(runs: readonly DigitRun[]): bigint {
  let n = 0n;
  for (const r of runs) n += r.length;
  return n;
}

/** Appends a run, merging it into the last one when the digits match. */
export function pushRun(runs: DigitRun[], digit: number, length: bigint): void {
  if (length <= 0n) return;
  const last = runs[runs.length - 1];
  if (last && last.digit === digit) runs[runs.length - 1] = { digit, length: last.length + length };
  else runs.push({ digit, length });
}

export function concatRuns(a: readonly DigitRun[], b: readonly DigitRun[]): DigitRun[] {
  const out = a.map((r) => ({ ...r }));
  for (const r of b) pushRun(out, r.digit, r.length);
  return out;
}

/** Splits a run list after its first `count` digits. */
export function splitRuns(runs: readonly DigitRun[], count: bigint): [DigitRun[], DigitRun[]] {
  const head: DigitRun[] = [];
  const tail: DigitRun[] = [];
  let left = count;
  for (const r of runs) {
    if (left >= r.length) {
      head.push({ ...r });
      left -= r.length;
    } else if (left > 0n) {
      head.push({ digit: r.digit, length: left });
      tail.push({ digit: r.digit, length: r.length - left });
      left = 0n;
    } else {
      tail.push({ ...r });
    }
  }
  if (left > 0n) fail('path', 'digit runs shorter than their levels');
  return [head, tail];
}

export function runsEqual(a: readonly DigitRun[], b: readonly DigitRun[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].digit !== b[i].digit || a[i].length !== b[i].length) return false;
  }
  return true;
}

function runsCanonical(runs: readonly DigitRun[]): boolean {
  for (let i = 0; i < runs.length; i += 1) {
    if (runs[i].length < 1n) return false;
    if (i > 0 && runs[i].digit === runs[i - 1].digit) return false;
  }
  return true;
}

// ─── Atom ranges ──────────────────────────────────────────────────────

export function rangesCount(ranges: readonly AtomRange[]): number {
  let n = 0;
  for (const r of ranges) n += r.length;
  return n;
}

function rangesCanonical(ranges: readonly AtomRange[]): boolean {
  if (ranges.length < 1) return false;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    if (r.length < 1 || r.start < 0 || r.start + r.length > ATOMS_INDEX_LIMIT) return false;
    if (i > 0 && r.start <= ranges[i - 1].start + ranges[i - 1].length) return false;
  }
  return true;
}

/** The ascending indices a selection names. */
export function rangesIndices(ranges: readonly AtomRange[]): number[] {
  const out: number[] = [];
  for (const r of ranges) for (let i = 0; i < r.length; i += 1) out.push(r.start + i);
  return out;
}

/** Ascending, merged ranges from any set of indices. */
export function indicesToRanges(indices: readonly number[]): AtomRange[] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: AtomRange[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && last.start + last.length === i) last.length += 1;
    else out.push({ start: i, length: 1 });
  }
  return out;
}

/** §4.2 rule 1: the second selection indexes the first; the result is in the first's base indices. */
export function composeRanges(first: readonly AtomRange[], second: readonly AtomRange[]): AtomRange[] {
  const base = rangesIndices(first);
  const picked: number[] = [];
  for (const i of rangesIndices(second)) {
    if (i >= base.length) fail('path', 'atom range outside the selection');
    picked.push(base[i]);
  }
  return indicesToRanges(picked);
}

// ─── Steps ────────────────────────────────────────────────────────────

function cloneStep(step: Step): Step {
  switch (step.tag) {
    case 'child':
      return { tag: 'child', index: step.index };
    case 'cells':
      return { tag: 'cells', octants: [...step.octants] };
    case 'tower':
      return {
        tag: 'tower',
        levels: step.levels,
        runs: step.runs.map((axis) => axis.map((r) => ({ ...r }))) as AxisRuns,
      };
    case 'atoms':
      return { tag: 'atoms', ranges: step.ranges.map((r) => ({ ...r })) };
  }
}

function checkStep(step: Step): void {
  switch (step.tag) {
    case 'child':
      if (!Number.isInteger(step.index) || step.index < 0 || step.index > 0xffff) fail('range', 'child index');
      return;
    case 'cells':
      if (step.octants.length < 1) fail('canonical', 'empty cells step');
      if (step.octants.length > CELLS_MAX_OCTANTS) fail('limit', 'more than 64 octants');
      for (const o of step.octants) if (!Number.isInteger(o) || o < 0 || o > 7) fail('range', 'octant');
      return;
    case 'tower':
      if (step.levels < 1n) fail('canonical', 'tower step of no levels');
      for (const axis of step.runs) {
        if (axis.length > TOWER_MAX_RUNS) fail('limit', 'more than 4,096 runs on an axis');
        for (const r of axis) if (!Number.isInteger(r.digit) || r.digit < 0 || r.digit > 0xff) fail('range', 'digit');
        if (!runsCanonical(axis)) fail('canonical', 'digit runs');
      }
      return;
    case 'atoms':
      if (step.ranges.length > ATOMS_MAX_RANGES) fail('limit', 'more than 4,096 ranges');
      if (!rangesCanonical(step.ranges)) fail('canonical', 'atom ranges');
      return;
  }
}

/** §4.2: merges adjacent cells, tower and atoms steps, and normalizes runs and ranges. */
export function canonicalPath(steps: readonly Step[]): Step[] {
  const out: Step[] = [];
  for (const raw of steps) {
    let step = cloneStep(raw);
    if (step.tag === 'tower') {
      const runs = step.runs.map((axis) => {
        const merged: DigitRun[] = [];
        for (const r of axis) {
          if (r.length < 0n) fail('range', 'negative run length');
          pushRun(merged, r.digit, r.length);
        }
        return merged;
      }) as AxisRuns;
      step = { tag: 'tower', levels: step.levels, runs };
    } else if (step.tag === 'atoms') {
      for (const r of step.ranges) {
        if (!Number.isInteger(r.start) || !Number.isInteger(r.length) || r.start < 0 || r.length < 0) {
          fail('range', 'atom range');
        }
      }
      step = { tag: 'atoms', ranges: indicesToRanges(rangesIndices(step.ranges)) };
    }
    const last = out[out.length - 1];
    if (last && last.tag === step.tag && step.tag !== 'child') {
      if (last.tag === 'cells' && step.tag === 'cells') {
        out[out.length - 1] = { tag: 'cells', octants: [...last.octants, ...step.octants] };
      } else if (last.tag === 'tower' && step.tag === 'tower') {
        out[out.length - 1] = {
          tag: 'tower',
          levels: last.levels + step.levels,
          runs: [0, 1, 2].map((a) => concatRuns(last.runs[a], step.runs[a])) as AxisRuns,
        };
      } else if (last.tag === 'atoms' && step.tag === 'atoms') {
        out[out.length - 1] = { tag: 'atoms', ranges: composeRanges(last.ranges, step.ranges) };
      }
    } else {
      out.push(step);
    }
  }
  for (const step of out) checkStep(step);
  return out;
}

export function isCanonical(steps: readonly Step[]): boolean {
  for (let i = 0; i < steps.length; i += 1) {
    try {
      checkStep(steps[i]);
    } catch {
      return false;
    }
    if (i > 0 && steps[i].tag === steps[i - 1].tag && steps[i].tag !== 'child') return false;
  }
  return true;
}

/** One step's bytes: the tag and its payload (§4.1). The copy key hashes these (§3.4.5). */
export function writeStep(w: Writer, step: Step): void {
  switch (step.tag) {
    case 'child':
      w.u8(TAG.child).u16(step.index);
      return;
    case 'cells':
      w.u8(TAG.cells).u8(step.octants.length);
      for (const o of step.octants) w.u8(o);
      return;
    case 'tower':
      w.u8(TAG.tower).bigUInt(step.levels);
      for (const axis of step.runs) {
        w.u16(axis.length);
        for (const r of axis) w.u8(r.digit).bigUInt(r.length);
      }
      return;
    case 'atoms':
      w.u8(TAG.atoms).u16(step.ranges.length);
      for (const r of step.ranges) w.u16(r.start).u16(r.length);
      return;
  }
}

export function stepBytes(step: Step): Uint8Array {
  const w = new Writer(64);
  writeStep(w, step);
  return w.finish();
}

/** Canonical paths only (§4.2), within the §1.9 limits for records and references. */
export function encodePath(steps: readonly Step[], options: { unlimited?: boolean } = {}): Uint8Array {
  for (let i = 0; i < steps.length; i += 1) {
    checkStep(steps[i]);
    if (i > 0 && steps[i].tag === steps[i - 1].tag && steps[i].tag !== 'child') {
      fail('canonical', 'adjacent steps share a tag');
    }
  }
  if (steps.length > 0xffff) fail('limit', 'too many steps');
  if (!options.unlimited && steps.length > PATH_MAX_STEPS) fail('limit', 'more than 1,024 steps');
  const w = new Writer(64);
  w.u16(steps.length);
  for (const step of steps) writeStep(w, step);
  const bytes = w.finish();
  if (!options.unlimited && bytes.length > PATH_MAX_BYTES) fail('limit', 'path over 65,536 bytes');
  return bytes;
}

export function readStep(r: Reader): Step {
  const tag = r.u8();
  switch (tag) {
    case TAG.child:
      return { tag: 'child', index: r.u16() };
    case TAG.cells: {
      const n = r.u8();
      if (n === 0) fail('canonical', 'empty cells step');
      if (n > CELLS_MAX_OCTANTS) fail('limit', 'more than 64 octants');
      const octants: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const o = r.u8();
        if (o > 7) fail('range', 'octant');
        octants.push(o);
      }
      return { tag: 'cells', octants };
    }
    case TAG.tower: {
      const levels = r.bigUInt();
      if (levels < 1n) fail('canonical', 'tower step of no levels');
      const runs: DigitRun[][] = [];
      for (let a = 0; a < 3; a += 1) {
        const n = r.u16();
        if (n > TOWER_MAX_RUNS) fail('limit', 'more than 4,096 runs on an axis');
        const axis: DigitRun[] = [];
        for (let i = 0; i < n; i += 1) {
          const digit = r.u8();
          const length = r.bigUInt();
          axis.push({ digit, length });
        }
        if (!runsCanonical(axis)) fail('canonical', 'digit runs');
        runs.push(axis);
      }
      return { tag: 'tower', levels, runs: runs as AxisRuns };
    }
    case TAG.atoms: {
      const n = r.u16();
      if (n === 0) fail('canonical', 'empty atoms step');
      if (n > ATOMS_MAX_RANGES) fail('limit', 'more than 4,096 ranges');
      const ranges: AtomRange[] = [];
      for (let i = 0; i < n; i += 1) ranges.push({ start: r.u16(), length: r.u16() });
      if (!rangesCanonical(ranges)) fail('canonical', 'atom ranges');
      return { tag: 'atoms', ranges };
    }
    default:
      return fail('unsupported', `step tag ${tag}`);
  }
}

/** Reads a path from a Reader, leaving it after the path's last byte. */
export function readPath(r: Reader, options: { unlimited?: boolean } = {}): Step[] {
  const start = r.offset;
  const count = r.u16();
  if (!options.unlimited && count > PATH_MAX_STEPS) fail('limit', 'more than 1,024 steps');
  const steps: Step[] = [];
  for (let i = 0; i < count; i += 1) {
    const step = readStep(r);
    if (i > 0 && step.tag === steps[i - 1].tag && step.tag !== 'child') fail('canonical', 'adjacent steps share a tag');
    steps.push(step);
  }
  if (!options.unlimited && r.offset - start > PATH_MAX_BYTES) fail('limit', 'path over 65,536 bytes');
  return steps;
}

/** A whole buffer as one canonical path: no trailing bytes. */
export function decodePath(bytes: Uint8Array, options: { unlimited?: boolean } = {}): Step[] {
  const r = new Reader(bytes);
  const steps = readPath(r, options);
  r.done();
  return steps;
}

export function comparePaths(a: readonly Step[], b: readonly Step[]): number {
  return compareBytes(encodePath(a, { unlimited: true }), encodePath(b, { unlimited: true }));
}

// ─── Containment (§4.4) ───────────────────────────────────────────────

/** Leading digits of one axis compared over the shorter of the two lists. */
function axisPrefixMatch(a: readonly DigitRun[], b: readonly DigitRun[]): boolean {
  const n = runsLength(a) < runsLength(b) ? runsLength(a) : runsLength(b);
  return runsEqual(splitRuns(a, n)[0], splitRuns(b, n)[0]);
}

/**
 * Whether removal `a` contains removal `b`, both starting at one view: `a`
 * equals `b` or names one of its ancestors. It needs no start level, because
 * each tower step's run lengths give its digit counts per axis.
 */
export function pathContains(a: readonly Step[], b: readonly Step[]): boolean {
  for (let i = 0; ; i += 1) {
    if (i >= a.length) return true;
    if (i >= b.length) return false;
    const sa = a[i];
    const sb = b[i];
    if (sa.tag !== sb.tag) return false;
    if (sa.tag === 'child' && sb.tag === 'child') {
      if (sa.index !== sb.index) return false;
    } else if (sa.tag === 'cells' && sb.tag === 'cells') {
      const n = Math.min(sa.octants.length, sb.octants.length);
      for (let k = 0; k < n; k += 1) if (sa.octants[k] !== sb.octants[k]) return false;
      if (sa.octants.length < sb.octants.length) return true;
      if (sa.octants.length > sb.octants.length) return false;
    } else if (sa.tag === 'tower' && sb.tag === 'tower') {
      for (let ax = 0; ax < 3; ax += 1) if (!axisPrefixMatch(sa.runs[ax], sb.runs[ax])) return false;
      if (sa.levels < sb.levels) return true;
      if (sa.levels > sb.levels) return false;
    } else if (sa.tag === 'atoms' && sb.tag === 'atoms') {
      // Removals never hold an atoms step (§2.8); compare as sets for completeness.
      const bs = new Set(rangesIndices(sb.ranges));
      const as = rangesIndices(sa.ranges);
      if (as.length !== bs.size || as.some((x) => !bs.has(x))) return false;
    }
  }
}
