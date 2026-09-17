/**
 * Byte-level token scanners shared by the TypeScript molecular parsers.
 *
 * Molecular text formats are ASCII; scanning numbers straight out of a
 * Uint8Array avoids materializing a string per token (tens of millions of
 * allocations on a large file) while matching `Number()` for well-formed
 * decimal and exponent notation.
 */

export const NL = 10;
export const CR = 13;
export const SP = 32;
export const TAB = 9;

const POW10 = /* @__PURE__ */ (() => {
  const table = new Float64Array(23);
  for (let i = 0; i < table.length; i++) table[i] = Math.pow(10, i);
  return table;
})();

export function isSpace(c: number): boolean {
  return c === SP || c === TAB || c === CR;
}

/** Parse a float token in [start, end). Returns NaN for malformed tokens
 *  (numeric prefixes do not count: `1abc` is not the number 1). */
export function scanFloat(b: Uint8Array, start: number, end: number): number {
  let i = start;
  let c = b[i];
  let neg = false;
  if (c === 45 /* - */) { neg = true; c = b[++i]; }
  else if (c === 43 /* + */) { c = b[++i]; }
  let mant = 0;
  let exp10 = 0;
  let any = false;
  while (i < end && c >= 48 && c <= 57) { mant = mant * 10 + (c - 48); any = true; c = b[++i]; }
  if (i < end && c === 46 /* . */) {
    c = b[++i];
    while (i < end && c >= 48 && c <= 57) { mant = mant * 10 + (c - 48); exp10--; any = true; c = b[++i]; }
  }
  if (!any) return NaN;
  if (i < end && (c === 101 || c === 69 /* e E */)) {
    c = b[++i];
    let eneg = false;
    if (c === 45) { eneg = true; c = b[++i]; }
    else if (c === 43) { c = b[++i]; }
    let e = 0;
    let digit = false;
    while (i < end && c >= 48 && c <= 57) { e = e * 10 + (c - 48); digit = true; c = b[++i]; }
    if (!digit) return NaN;
    exp10 += eneg ? -e : e;
  }
  if (i !== end) return NaN;
  let v: number;
  if (exp10 === 0) v = mant;
  else if (exp10 > 0) v = exp10 <= 22 ? mant * POW10[exp10] : mant * Math.pow(10, exp10);
  else v = exp10 >= -22 ? mant / POW10[-exp10] : mant * Math.pow(10, exp10);
  return neg ? -v : v;
}

/** Parse an exact signed base-10 integer token in [start, end) into the
 *  int32 domain. Decimal or exponent spellings return undefined. */
export function scanInt32(b: Uint8Array, start: number, end: number): number | undefined {
  let i = start;
  let neg = false;
  if (b[i] === 43 /* + */) i++;
  else if (b[i] === 45 /* - */) { neg = true; i++; }
  if (i >= end) return undefined;
  let value = 0;
  for (; i < end; i++) {
    const digit = b[i] - 48;
    if (digit < 0 || digit > 9) return undefined;
    value = value * 10 + digit;
    if (value > 2147483648) return undefined;
  }
  if (neg) return value === 0 ? 0 : -value;
  return value > 2147483647 ? undefined : value;
}

/**
 * Split the token boundaries of a line in place. Fills `starts`/`ends` up to
 * their capacity and returns the number of tokens found (the line may hold
 * more tokens than the capacity; those are not scanned).
 */
export function tokenizeLine(
  b: Uint8Array,
  lineStart: number,
  lineEnd: number,
  starts: Int32Array,
  ends: Int32Array,
): number {
  let i = lineStart;
  let count = 0;
  const capacity = starts.length;
  while (i < lineEnd && count < capacity) {
    while (i < lineEnd && isSpace(b[i])) i++;
    if (i >= lineEnd) break;
    const tokenStart = i;
    while (i < lineEnd && !isSpace(b[i])) i++;
    starts[count] = tokenStart;
    ends[count] = i;
    count++;
  }
  return count;
}

/** Count whitespace-separated tokens in [lineStart, lineEnd). */
export function countTokens(b: Uint8Array, lineStart: number, lineEnd: number): number {
  let i = lineStart;
  let count = 0;
  while (i < lineEnd) {
    while (i < lineEnd && isSpace(b[i])) i++;
    if (i >= lineEnd) break;
    count++;
    while (i < lineEnd && !isSpace(b[i])) i++;
  }
  return count;
}
