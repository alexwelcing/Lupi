// Wraps (scale-spec §8.8): a tower anchor moves by whole periods (three
// levels, a factor of f on every axis) while its pose and σ stay, so the
// picture stays exactly as it was and λ jumps by log10 f per period. That is
// how a dive crosses 10¹⁰⁰ levels in seconds: the anchor path gains one run
// per axis, never 10¹⁰⁰ steps.

import { canonicalPath, type AxisRuns, type DigitRun, type Step } from '@atlas/core/scale';

export interface TowerTail {
  /** Index of the anchor path's last step, a tower step. */
  index: number;
  step: Extract<Step, { tag: 'tower' }>;
}

/** The anchor path's last step when it is a tower step: the digits below the innermost tower root. */
export function towerTail(path: readonly Step[]): TowerTail | null {
  const last = path[path.length - 1];
  return last && last.tag === 'tower' ? { index: path.length - 1, step: last } : null;
}

export const runsCount = (runs: readonly DigitRun[]): bigint => runs.reduce((n, r) => n + r.length, 0n);

const allDigits = (runs: readonly DigitRun[], d: number): boolean => runs.every((r) => r.digit === d);

/** Which faces of the root an anchor with these digits on one axis touches; an axis with no digits spans the root. */
export function touches(runs: readonly DigitRun[], f: number): { low: boolean; high: boolean } {
  return { low: allDigits(runs, 0), high: allDigits(runs, f - 1) };
}

/** The number the digits spell, or `cap` when it is at least `cap` (O(runs) for any length). */
export function cappedValue(runs: readonly DigitRun[], f: number, cap: number): number {
  let v = 0;
  for (const r of runs) {
    for (let i = 0n; i < r.length; i += 1n) {
      v = v * f + r.digit;
      if (v >= cap) return cap;
      // A run of zeros on a zero value adds nothing however long it is.
      if (v === 0 && r.digit === 0) break;
    }
  }
  return v;
}

const complement = (runs: readonly DigitRun[], f: number): DigitRun[] => runs.map((r) => ({ digit: f - 1 - r.digit, length: r.length }));

/** The first `count` digits of a run list. */
export function prefixRuns(runs: readonly DigitRun[], count: bigint): DigitRun[] {
  const out: DigitRun[] = [];
  let left = count;
  for (const r of runs) {
    if (left <= 0n) break;
    const take = r.length < left ? r.length : left;
    out.push({ digit: r.digit, length: take });
    left -= take;
  }
  return out;
}

function appendRun(runs: readonly DigitRun[], digit: number, length: bigint): DigitRun[] {
  const out = runs.map((r) => ({ ...r }));
  const last = out[out.length - 1];
  if (last && last.digit === digit) last.length += length;
  else out.push({ digit, length });
  return out;
}

/**
 * Whether the anchor's neighbourhood is congruent before and after a wrap:
 * every axis has a digit (an axis without one spans the root, and a wrap
 * would bring neighbours into view), and on each axis the anchor either
 * touches a root face or sits at least two nodes from both (a face one node
 * away is in the neighbourhood but not touched, §8.8).
 */
export function digitsAllowWrap(runs: AxisRuns, f: number): boolean {
  for (const axis of runs) {
    if (axis.length === 0) return false;
    const t = touches(axis, f);
    if (t.low || t.high) continue;
    if (cappedValue(axis, f, 2) < 2 || cappedValue(complement(axis, f), f, 2) < 2) return false;
  }
  return true;
}

/** The digit a descending wrap repeats on an axis: the face the anchor touches, else the middle child. */
export function wrapDigit(runs: readonly DigitRun[], f: number): number {
  const t = touches(runs, f);
  if (t.high) return f - 1;
  if (t.low) return 0;
  return Math.floor(f / 2);
}

/** The last `count` digits of a run list. */
export function suffixRuns(runs: readonly DigitRun[], count: bigint): DigitRun[] {
  const total = runsCount(runs);
  const out: DigitRun[] = [];
  let skip = total - count;
  for (const r of runs) {
    if (skip >= r.length) {
      skip -= r.length;
      continue;
    }
    out.push({ digit: r.digit, length: r.length - skip });
    skip = 0n;
  }
  return out;
}

function concat(a: readonly DigitRun[], b: readonly DigitRun[]): DigitRun[] {
  let out = a.map((r) => ({ ...r }));
  for (const r of b) out = appendRun(out, r.digit, r.length);
  return out;
}

/**
 * Appends 3n levels: n constant digits per axis (§8.8). With `head` (each
 * axis's digit count when this dive's first wrap happened), the digits
 * between the head and the last `keep` are rewritten to the wrap digit too:
 * the rebase descents between wraps then never pile up runs, and the path
 * stays head, one run, a short tail per axis however long the dive. The
 * anchor's last digits and its face contacts are unchanged, so its
 * neighbourhood, and the picture, are too.
 */
export function descendTail(path: readonly Step[], n: bigint, f: number, head?: readonly bigint[], keep = 4n): Step[] {
  const tail = towerTail(path);
  if (!tail || n <= 0n) return [...path];
  const runs = tail.step.runs.map((axis, a) => {
    const d = wrapDigit(axis, f);
    const count = runsCount(axis);
    const h = head ? (head[a] < count ? head[a] : count) : count;
    const kept = count - h < keep ? count - h : keep;
    return concat(appendRun(prefixRuns(axis, h), d, count - h - kept + n), suffixRuns(axis, kept));
  }) as AxisRuns;
  return canonicalPath([...path.slice(0, tail.index), { tag: 'tower', levels: tail.step.levels + 3n * n, runs }]);
}

/** Removes the lowest 3n levels: the last n digits of each axis. */
export function ascendTail(path: readonly Step[], n: bigint): Step[] {
  const tail = towerTail(path);
  if (!tail || n <= 0n) return [...path];
  const runs = tail.step.runs.map((axis) => prefixRuns(axis, runsCount(axis) - n)) as AxisRuns;
  const levels = tail.step.levels - 3n * n;
  const head = path.slice(0, tail.index);
  return canonicalPath(levels > 0n ? [...head, { tag: 'tower', levels, runs }] : head);
}

/** Whether removing n digits per axis keeps every axis's face contacts and the two-node margin. */
function ascentKeepsPicture(runs: AxisRuns, n: bigint, f: number): boolean {
  for (const axis of runs) {
    const count = runsCount(axis);
    if (count - n < 1n) return false;
    const before = touches(axis, f);
    const prefix = prefixRuns(axis, count - n);
    const after = touches(prefix, f);
    if (before.low !== after.low || before.high !== after.high) return false;
    if (!after.low && !after.high && (cappedValue(prefix, f, 2) < 2 || cappedValue(complement(prefix, f), f, 2) < 2)) return false;
  }
  return true;
}

/** The most periods an ascending wrap can remove, at most `want` (binary search: the test is monotone in n). */
export function maxAscent(path: readonly Step[], f: number, want: bigint): bigint {
  const tail = towerTail(path);
  if (!tail || want <= 0n) return 0n;
  const runs = tail.step.runs;
  if (ascentKeepsPicture(runs, want, f)) return want;
  let lo = 0n;
  let hi = want;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (ascentKeepsPicture(runs, mid, f)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * How many whole periods the flight wraps this frame. λ = ℓ − u·log10 f, so
 * the anchor whose unit exponent lands λ on the target after the picture's
 * own step is u = (ℓ + picture − target) / log10 f, rounded; the difference
 * from the current u is the wrap, positive descending. Exact in bigint
 * however far apart the two are; small moves (within a period and V) do not
 * wrap.
 */
export function wrapPeriods(opts: { u: bigint; ell: number; f: number; picture: number; target: number; v: number }): bigint {
  const l10 = Math.log10(opts.f);
  const current = opts.ell - Number(opts.u) * l10;
  if (Math.abs(opts.target - (current + opts.picture)) <= l10 + opts.v) return 0n;
  const ideal = (opts.ell + opts.picture - opts.target) / l10;
  if (!Number.isFinite(ideal)) return 0n;
  const uAfter = ideal <= 0 ? 0n : BigInt(Math.round(ideal));
  return opts.u - uAfter;
}
