// Magnitude (scale-spec §5.1, §5.2, §5.4, §5.5): exact non-negative integers
// up to and past a googolplex. A value below 2⁶⁵⁵³⁶ is a bigint; a larger
// one is base-r digit runs in its root base, and every operation on runs
// costs O(runs), never O(digits).

import { bitLength, fail } from './bytes';
import type { DigitRun } from './paths';

export const PLAIN_LIMIT_BITS = 65536;
const PLAIN_LIMIT = 1n << 65536n;

/** The root base of a display base: 2 for {2, 4, 8, 16}, 3 for {3, 9}, else itself (§5.1). */
export function rootBase(f: number): number {
  if (f === 4 || f === 8 || f === 16) return 2;
  if (f === 9) return 3;
  return f;
}

/** f = root^j. */
const rootPower = (f: number): number => Math.round(Math.log(f) / Math.log(rootBase(f)));

function checkBase(f: number): void {
  if (!Number.isInteger(f) || f < 2 || f > 16) fail('range', `base ${f}`);
}

export class Magnitude {
  /** Chooses only how format() prints the value, never what it is. */
  readonly displayBase: number;
  /** The value when it is below 2⁶⁵⁵³⁶ (canonically plain). */
  readonly plain: bigint | null;
  /** Otherwise: root-base digit runs, most significant first, canonical. */
  readonly root: number;
  readonly runs: readonly DigitRun[] | null;

  private constructor(displayBase: number, plain: bigint | null, root: number, runs: readonly DigitRun[] | null) {
    this.displayBase = displayBase;
    this.plain = plain;
    this.root = root;
    this.runs = runs;
  }

  /** @internal */
  static make(displayBase: number, plain: bigint | null, root: number, runs: readonly DigitRun[] | null): Magnitude {
    return new Magnitude(displayBase, plain, root, runs);
  }

  get isPlain(): boolean {
    return this.plain !== null;
  }

  toString(): string {
    return formatMagnitude(this);
  }
}

// ─── Digit runs (most significant first unless named LSD) ─────────────

function pushLsd(out: DigitRun[], digit: number, length: bigint): void {
  if (length <= 0n) return;
  const last = out[out.length - 1];
  if (last && last.digit === digit) last.length += length;
  else out.push({ digit, length });
}

/** Runs of a digit string (base ≤ 16, most significant first). */
function runsOfDigits(text: string): DigitRun[] {
  const out: DigitRun[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && text[j] === text[i]) j += 1;
    out.push({ digit: parseInt(text[i], 16), length: BigInt(j - i) });
    i = j;
  }
  return out;
}

const runsDigitCount = (runs: readonly DigitRun[]): bigint => runs.reduce((s, r) => s + r.length, 0n);

/** Strips leading zero runs (most significant first). */
function stripLeading(runs: DigitRun[]): DigitRun[] {
  let i = 0;
  while (i < runs.length && runs[i].digit === 0) i += 1;
  return runs.slice(i);
}

/** Exact value of base-r runs; callers keep it below a few times 2⁶⁵⁵³⁶. */
function runsValue(runs: readonly DigitRun[], r: number): bigint {
  const R = BigInt(r);
  let v = 0n;
  for (const run of runs) {
    const pow = R ** run.length;
    v = v * pow + (BigInt(run.digit) * (pow - 1n)) / (R - 1n);
  }
  return v;
}

function runsFitPlain(runs: readonly DigitRun[], r: number): boolean {
  const n = runsDigitCount(runs);
  if (n === 0n) return true;
  const bitsPerDigit = Math.log2(r);
  if (Number(n - 1n) * bitsPerDigit >= PLAIN_LIMIT_BITS + 1) return false;
  if (Number(n) * bitsPerDigit <= PLAIN_LIMIT_BITS - 1) return true;
  return runsValue(runs, r) < PLAIN_LIMIT;
}

function normalize(displayBase: number, root: number, runsMsd: DigitRun[]): Magnitude {
  const runs = stripLeading(runsMsd);
  if (runsFitPlain(runs, root)) return Magnitude.make(displayBase, runsValue(runs, root), 0, null);
  return Magnitude.make(displayBase, null, root, runs);
}

function fromBig(value: bigint, displayBase: number): Magnitude {
  if (value < 0n) fail('range', 'negative magnitude');
  if (value < PLAIN_LIMIT) return Magnitude.make(displayBase, value, 0, null);
  const root = rootBase(displayBase);
  return Magnitude.make(displayBase, null, root, runsOfDigits(value.toString(root)));
}

/** A plain count; display base 10 unless given. */
export function magnitude(value: bigint | number, displayBase = 10): Magnitude {
  checkBase(displayBase);
  return fromBig(BigInt(value), displayBase);
}

/** §5.1: s · f^k, the base-f digits of s followed by k zeros, display base f. */
export function towerMagnitude(seedCount: bigint, factor: number, levels: bigint): Magnitude {
  checkBase(factor);
  if (seedCount < 0n || levels < 0n) fail('range', 'negative tower count');
  if (seedCount === 0n) return Magnitude.make(factor, 0n, 0, null);
  const bits = bitLength(seedCount) + Number(levels) * Math.log2(factor);
  if (bits <= PLAIN_LIMIT_BITS + 64) return fromBig(seedCount * BigInt(factor) ** levels, factor);
  const root = rootBase(factor);
  const runs = runsOfDigits(seedCount.toString(root));
  pushLsdMsd(runs, 0, levels * BigInt(rootPower(factor)));
  return Magnitude.make(factor, null, root, runs);
}

/** Appends a run at the least significant end of a most-significant-first list. */
function pushLsdMsd(runs: DigitRun[], digit: number, length: bigint): void {
  if (length <= 0n) return;
  const last = runs[runs.length - 1];
  if (last && last.digit === digit) last.length += length;
  else runs.push({ digit, length });
}

/** Root-base runs of any magnitude, most significant first. */
function rootRuns(m: Magnitude, root: number): DigitRun[] {
  if (m.plain !== null) return m.plain === 0n ? [] : runsOfDigits(m.plain.toString(root));
  if (m.root !== root) fail('base', 'magnitudes of different families');
  return m.runs!.map((r) => ({ ...r }));
}

/** Aligned digit-run arithmetic from the least significant end (§5.2). */
function runsArith(a: readonly DigitRun[], b: readonly DigitRun[], r: number, subtract: boolean): DigitRun[] {
  const la = [...a].reverse();
  const lb = [...b].reverse();
  const out: DigitRun[] = [];
  let ia = 0;
  let ib = 0;
  let restA = la.length > 0 ? la[0].length : 0n;
  let restB = lb.length > 0 ? lb[0].length : 0n;
  let carry = 0;
  while (ia < la.length || ib < lb.length) {
    const da = ia < la.length ? la[ia].digit : 0;
    const db = ib < lb.length ? lb[ib].digit : 0;
    let len: bigint;
    if (ia >= la.length) len = restB;
    else if (ib >= lb.length) len = restA;
    else len = restA < restB ? restA : restB;
    const x = subtract ? da - db : da + db;
    // At most two positions differ before the carry (or borrow) settles.
    const first = subtract ? x - carry : x + carry;
    const c1 = subtract ? (first < 0 ? 1 : 0) : first >= r ? 1 : 0;
    pushLsd(out, ((first % r) + r) % r, 1n);
    if (len > 1n) {
      const rest = subtract ? x - c1 : x + c1;
      pushLsd(out, ((rest % r) + r) % r, len - 1n);
    }
    carry = c1;
    if (ia < la.length) {
      restA -= len;
      if (restA === 0n) {
        ia += 1;
        restA = ia < la.length ? la[ia].length : 0n;
      }
    }
    if (ib < lb.length) {
      restB -= len;
      if (restB === 0n) {
        ib += 1;
        restB = ib < lb.length ? lb[ib].length : 0n;
      }
    }
  }
  if (carry) {
    if (subtract) fail('range', 'negative magnitude');
    pushLsd(out, carry, 1n);
  }
  return out.reverse();
}

function combine(a: Magnitude, b: Magnitude, subtract: boolean): Magnitude {
  if (a.plain !== null && b.plain !== null) {
    const v = subtract ? a.plain - b.plain : a.plain + b.plain;
    if (v < 0n) fail('range', 'negative magnitude');
    return fromBig(v, a.displayBase);
  }
  const root = a.plain === null ? a.root : b.root;
  return normalize(a.displayBase, root, runsArith(rootRuns(a, root), rootRuns(b, root), root, subtract));
}

/** §5.2. Throws ScaleError('base') across families above 2⁶⁵⁵³⁶. */
export const addMagnitude = (a: Magnitude, b: Magnitude): Magnitude => combine(a, b, false);

/** §5.2. A negative result is ScaleError('range'). */
export const subMagnitude = (a: Magnitude, b: Magnitude): Magnitude => combine(a, b, true);

/** §5.2: repeated doubling, for any plain k (a unit mass in µDa reaches 2²⁸⁵). */
export function mulSmallMagnitude(m: Magnitude, k: bigint): Magnitude {
  if (k < 0n || bitLength(k) > PLAIN_LIMIT_BITS) fail('range', 'mulSmall factor');
  if (m.plain !== null) return fromBig(m.plain * k, m.displayBase);
  let result = Magnitude.make(m.displayBase, 0n, 0, null);
  let addend = m;
  for (let bits = k; bits > 0n; bits >>= 1n) {
    if (bits & 1n) result = addMagnitude(result, addend);
    addend = addMagnitude(addend, addend);
  }
  return result;
}

function compareRuns(a: readonly DigitRun[], b: readonly DigitRun[]): -1 | 0 | 1 {
  const na = runsDigitCount(a);
  const nb = runsDigitCount(b);
  if (na !== nb) return na < nb ? -1 : 1;
  let ia = 0;
  let ib = 0;
  let restA = a.length > 0 ? a[0].length : 0n;
  let restB = b.length > 0 ? b[0].length : 0n;
  while (ia < a.length && ib < b.length) {
    if (a[ia].digit !== b[ib].digit) return a[ia].digit < b[ib].digit ? -1 : 1;
    const len = restA < restB ? restA : restB;
    restA -= len;
    restB -= len;
    if (restA === 0n) {
      ia += 1;
      restA = ia < a.length ? a[ia].length : 0n;
    }
    if (restB === 0n) {
      ib += 1;
      restB = ib < b.length ? b[ib].length : 0n;
    }
  }
  return 0;
}

/** §5.2: numeric order; ScaleError('base') across families above 2⁶⁵⁵³⁶. */
export function compareMagnitude(a: Magnitude, b: Magnitude): -1 | 0 | 1 {
  if (a.plain !== null && b.plain !== null) return a.plain < b.plain ? -1 : a.plain > b.plain ? 1 : 0;
  if (a.plain !== null) return -1;
  if (b.plain !== null) return 1;
  if (a.root !== b.root) fail('base', 'magnitudes of different families');
  return compareRuns(a.runs!, b.runs!);
}

/** The canonical form, for equality and maps: the display base never matters (§5.2). */
export function magnitudeKey(m: Magnitude): string {
  if (m.plain !== null) return `p:${m.plain.toString(16)}`;
  return `r${m.root}:${m.runs!.map((r) => `${r.digit.toString(16)}x${r.length.toString(16)}`).join(',')}`;
}

export const magnitudeEquals = (a: Magnitude, b: Magnitude): boolean => magnitudeKey(a) === magnitudeKey(b);

export const fitsPlain = (m: Magnitude): boolean => m.plain !== null;

export function toPlain(m: Magnitude): bigint {
  if (m.plain === null) fail('range', 'magnitude above 2^65536');
  return m.plain;
}

export function withDisplayBase(m: Magnitude, f: number): Magnitude {
  checkBase(f);
  if (m.plain === null && rootBase(f) !== m.root) fail('base', 'display base outside the family');
  return Magnitude.make(f, m.plain, m.root, m.runs);
}

/**
 * The base digits are counted in: the display base, unless a sum kept a left
 * display base from another family, when the value's own root base is used.
 */
function digitBase(m: Magnitude): number {
  return m.plain === null && rootBase(m.displayBase) !== m.root ? m.root : m.displayBase;
}

/**
 * Digits in display base f, most significant first. For runs in root r with
 * f = r^j, digits group j at a time from the least significant end; a long
 * run of 0 or r − 1 stays one run, so this is O(runs) for every v1 value.
 */
export function displayRuns(m: Magnitude): DigitRun[] {
  const f = digitBase(m);
  if (m.plain !== null) return m.plain === 0n ? [] : runsOfDigits(m.plain.toString(f));
  const r = m.root;
  const j = rootPower(f);
  if (j === 1) return m.runs!.map((x) => ({ ...x }));
  const lsd = [...m.runs!].reverse();
  const out: DigitRun[] = [];
  let partial = 0;
  let filled = 0;
  for (const run of lsd) {
    let left = run.length;
    while (filled > 0 && left > 0n) {
      partial += run.digit * r ** filled;
      filled += 1;
      left -= 1n;
      if (filled === j) {
        pushLsd(out, partial, 1n);
        partial = 0;
        filled = 0;
      }
    }
    const whole = left / BigInt(j);
    if (whole > 0n) pushLsd(out, (run.digit * (f - 1)) / (r - 1), whole);
    left -= whole * BigInt(j);
    for (let i = 0n; i < left; i += 1n) {
      partial += run.digit * r ** filled;
      filled += 1;
    }
  }
  if (filled > 0) pushLsd(out, partial, 1n);
  return stripLeading(out.reverse());
}

// ─── Formatting (§5.4) ────────────────────────────────────────────────

const MINUS = '−';
const TEN15 = 10n ** 15n;

export function groupDigits(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (i > 0 && (text.length - i) % 3 === 0) out += ',';
    out += text[i];
  }
  return out;
}

/** Decimal digits as runs, with positional queries that never expand them. */
class Digits {
  readonly runs: readonly DigitRun[];
  readonly len: bigint;
  constructor(runs: readonly DigitRun[]) {
    this.runs = runs;
    this.len = runsDigitCount(runs);
  }

  /** Digits [from, to) as a string; callers keep the span small. */
  slice(from: bigint, to: bigint): string {
    let out = '';
    let at = 0n;
    for (const r of this.runs) {
      const lo = at > from ? at : from;
      const end = at + r.length;
      const hi = end < to ? end : to;
      for (let i = lo; i < hi; i += 1n) out += String(r.digit);
      at = end;
      if (at >= to) break;
    }
    return out;
  }

  /** Whether every digit in [from, to) is d (true for an empty span). */
  all(from: bigint, to: bigint, d: number): boolean {
    let at = 0n;
    for (const r of this.runs) {
      const end = at + r.length;
      if (end > from && at < to && r.digit !== d) return false;
      at = end;
      if (at >= to) break;
    }
    return true;
  }

  trailingZeros(): bigint {
    const last = this.runs[this.runs.length - 1];
    return last && last.digit === 0 ? last.length : 0n;
  }
}

const stripZeros = (text: string): string => text.replace(/0+$/, '') || '0';

/** E(k) of §5.4.1: plain digits below 10¹⁵, else (format(k)). */
function exponentText(k: bigint): string {
  if (k < 0n) return `${MINUS}${exponentText(-k)}`;
  return k < TEN15 ? k.toString() : `(${formatDecimal(new Digits(runsOfDigits(k.toString()))).text})`;
}

/** Rule 2's print of a significand c (digits, no trailing zeros) at exponent K. */
function roundText(c: string, k: bigint): string {
  if (c === '1') return `10^${exponentText(k)}`;
  const mantissa = c.length > 1 ? `${c[0]}.${c.slice(1)}` : c;
  return `${mantissa} × 10^${exponentText(k)}`;
}

interface Formatted {
  text: string;
  /** The §5.4.1 rule that matched: '4a' and '4b' are sums and differences. */
  rule: '1' | '2' | '3' | '4a' | '4b' | '5' | 'f1' | 'f3';
}

function formatDecimal(d: Digits): Formatted {
  const len = d.len;
  if (len === 0n) return { text: '0', rule: '1' };
  if (len <= 15n) return { text: groupDigits(d.slice(0n, len)), rule: '1' };
  const k = len - 1n;
  const z = d.trailingZeros();
  if (len - z <= 15n) return { text: roundText(d.slice(0n, len - z), k), rule: '2' };
  if (len <= 24n) return { text: groupDigits(d.slice(0n, len)), rule: '3' };
  const c15 = d.slice(0n, 15n);
  const t = len - 15n;
  const w = t < 15n ? t : 15n;
  if (d.all(15n, len - w, 0)) {
    const r = BigInt(d.slice(len - w, len));
    const head = stripZeros(c15);
    if (r > 0n && BigInt(head) < 10000n) {
      return { text: `${roundText(head, k)} + ${groupDigits(r.toString())}`, rule: '4a' };
    }
  }
  if (d.all(15n, len - w, 9)) {
    const r = 10n ** w - BigInt(d.slice(len - w, len));
    let h = BigInt(c15) + 1n;
    let kk = k;
    if (h === TEN15) {
      h = 1n;
      kk = k + 1n;
    }
    const head = stripZeros(h.toString());
    if (r > 0n && r < TEN15 && BigInt(head) < 10000n) {
      return { text: `${roundText(head, kk)} ${MINUS} ${groupDigits(r.toString())}`, rule: '4b' };
    }
  }
  // Rule 5: four digits, half to even on the exact digit string.
  const lead = d.slice(0n, 5n);
  let four = Number(lead.slice(0, 4));
  const fifth = Number(lead[4]);
  const up = fifth > 5 || (fifth === 5 && (!d.all(5n, len, 0) || four % 2 === 1));
  let kk = k;
  if (up) four += 1;
  if (four === 10000) {
    four = 1000;
    kk += 1n;
  }
  const s = String(four);
  return { text: `≈ ${s[0]}.${s.slice(1)} × 10^${exponentText(kk)}`, rule: '5' };
}

function decimalDigits(m: Magnitude): Digits {
  if (m.plain !== null) return new Digits(m.plain === 0n ? [] : runsOfDigits(m.plain.toString(10)));
  if (m.root !== 10) fail('base', 'not a decimal family');
  return new Digits(m.runs!);
}

function formatOtherBase(m: Magnitude): Formatted | null {
  const f = digitBase(m);
  const runs = displayRuns(m);
  const n = runsDigitCount(runs);
  const last = runs[runs.length - 1];
  const z = last && last.digit === 0 ? last.length : 0n;
  // Rule 1: c followed by z zeros with c < 10^15 (c has at most 50 digits in any base ≥ 2).
  if (n - z <= 50n) {
    const c = runsValue(runs.slice(0, z > 0n ? runs.length - 1 : runs.length), f);
    if (c < TEN15) {
      return { text: c === 1n ? `${f}^${exponentText(z)}` : `${groupDigits(c.toString())} × ${f}^${exponentText(z)}`, rule: 'f1' };
    }
  }
  if (m.plain !== null) return null;
  // Rule 3: the leading 16 digits, factors of f moved into the exponent.
  const [head] = splitDigits(runs, 16n);
  let c = runsValue(head, f);
  let k = n - 16n;
  const F = BigInt(f);
  while (c % F === 0n) {
    c /= F;
    k += 1n;
  }
  return { text: `≈ ${groupDigits(c.toString())} × ${f}^${exponentText(k)}`, rule: 'f3' };
}

function splitDigits(runs: readonly DigitRun[], count: bigint): [DigitRun[], DigitRun[]] {
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
    } else tail.push({ ...r });
  }
  return [head, tail];
}

/** @internal: the matching rule as well, for the formula text's parentheses (§5.3). */
export function formatMagnitudeDetailed(m: Magnitude): Formatted {
  if (digitBase(m) !== 10 && !(m.plain !== null && m.plain < TEN15)) {
    const other = formatOtherBase(m);
    if (other) return other;
  }
  return formatDecimal(decimalDigits(m));
}

/** §5.4: the one function that prints every count on every surface. */
export const formatMagnitude = (m: Magnitude): string => formatMagnitudeDetailed(m).text;

// ─── Approximate quantities (§5.5) [V] ────────────────────────────────

function leadingDisplay(m: Magnitude): { n: bigint; c: number } {
  const runs = displayRuns(m);
  const n = runsDigitCount(runs);
  const [head] = splitDigits(runs, 16n);
  return { n, c: Number(runsValue(head, digitBase(m))) };
}

/** ln M = N · ln f + ln c in binary64; +∞ when that overflows. */
export function lnMagnitude(m: Magnitude): number {
  const { n, c } = leadingDisplay(m);
  if (n === 0n) return -Infinity;
  const N = n > 16n ? n - 16n : 0n;
  return Number(N) * Math.log(digitBase(m)) + Math.log(c);
}

/** ln N for a bigint N, from its bit length and top 53 bits when it passes 2⁵³. */
export function lnBig(N: bigint): number {
  const bits = bitLength(N);
  if (bits <= 53) return Math.log(Number(N));
  const top = N >> BigInt(bits - 53);
  return (bits - 53) * Math.LN2 + Math.log(Number(top));
}

/** lnln M for M ≥ 3, finite for every v1 value. */
export function lnlnMagnitude(m: Magnitude): number {
  const { n, c } = leadingDisplay(m);
  const f = digitBase(m);
  const N = n > 16n ? n - 16n : 0n;
  if (N < 1n << 53n) return Math.log(Math.log(f)) + Math.log(Number(N) + Math.log(c) / Math.log(f));
  return Math.log(Math.log(f)) + lnBig(N);
}

export const log10Magnitude = (m: Magnitude): number => lnMagnitude(m) / Math.LN10;

/** Four significant digits, half to even on the binary64 value. */
function fourDigits(m: number): string {
  let text = m.toPrecision(4);
  // toPrecision breaks exact ties upward; a binary64 tie is exact, so check it.
  const exp = Math.floor(Math.log10(m));
  const scaled = m * 10 ** (3 - exp);
  if (Number.isInteger(scaled * 2) && !Number.isInteger(scaled) && Math.floor(scaled) % 2 === 0) {
    text = (Math.floor(scaled) / 10 ** (3 - exp)).toPrecision(4);
  }
  return text;
}

/**
 * §5.5 scientific display of Q = M × q (q a binary64 constant such as kg per
 * µDa): ≈ m × b^E, in base 10 for plain or decimal values and otherwise in
 * M's display base, the only base in which its exponent is exact. [V]
 */
export function scientific(m: Magnitude, q: number): string {
  const b = m.plain !== null || digitBase(m) === 10 ? 10 : digitBase(m);
  const runs = m.plain !== null ? (m.plain === 0n ? [] : runsOfDigits(m.plain.toString(b))) : displayRuns(m);
  const n = runsDigitCount(runs);
  if (n === 0n) return '0';
  const [head] = splitDigits(runs, 17n);
  const c = Number(runsValue(head, b));
  const logb = Math.log(c * q) / Math.log(b);
  let whole = Math.floor(logb);
  let mantissa = b ** (logb - whole);
  if (mantissa >= b) {
    mantissa /= b;
    whole += 1;
  }
  let text = fourDigits(mantissa);
  if (Number(text) >= b) {
    text = fourDigits(Number(text) / b);
    whole += 1;
  }
  const e = (n > 17n ? n - 17n : 0n) + BigInt(whole);
  return `≈ ${text} × ${b}^${exponentText(e)}`;
}

/** kg per µDa (CODATA 2018 atomic mass constant × 10⁻⁶), §5.5. */
export const KG_PER_MICRO_DALTON = 1.6605390666e-33;
