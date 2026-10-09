// Composition, formula and mass (scale-spec §5.3): exact per-element counts
// as unit × copies − removed, the Hill formula, the plaque's formula text,
// and mass in micro-daltons from the frozen lupi.mass.v1 table.

import { ELEMENT_DATA } from '../elements';
import { fail } from './bytes';
import {
  formatMagnitudeDetailed,
  magnitude,
  magnitudeKey,
  mulSmallMagnitude,
  subMagnitude,
  type Magnitude,
} from './magnitude';

export interface Composition {
  /** One copy's counts (a tower's seed copy, substitution applied), or the whole node's. */
  unit: Map<number, bigint>;
  copies: Magnitude;
  /** Counts removed from inside seed copies. */
  removed: Map<number, bigint>;
}

/**
 * lupi.mass.v1 (§5.3): each mass of packages/core/src/elements.ts read as its
 * decimal literal and scaled by 10⁶ exactly. Frozen: a change is a new table.
 */
// prettier-ignore
export const MICRO_DA_V1: readonly number[] = [0,
  1008000, 4002600, 6940000, 9012200, 10810000, 12011000, 14007000, 15999000, 18998000, 20180000,
  22990000, 24305000, 26982000, 28085000, 30974000, 32060000, 35450000, 39950000, 39098000, 40078000,
  44956000, 47867000, 50942000, 51996000, 54938000, 55845000, 58933000, 58693000, 63546000, 65380000,
  69723000, 72630000, 74922000, 78971000, 79904000, 83798000, 85468000, 87620000, 88906000, 91224000,
  92906000, 95950000, 98000000, 101070000, 102910000, 106420000, 107870000, 112410000, 114820000, 118710000,
  121760000, 127600000, 126900000, 131290000, 132910000, 137330000, 138910000, 140120000, 140910000, 144240000,
  145000000, 150360000, 151960000, 157250000, 158930000, 162500000, 164930000, 167260000, 168930000, 173050000,
  174970000, 178490000, 180950000, 183840000, 186210000, 190230000, 192220000, 195080000, 196970000, 200590000,
  204380000, 207200000, 208980000, 209000000, 210000000, 222000000, 223000000, 226000000, 227000000, 232040000,
  231040000, 238030000, 237000000, 244000000, 243000000, 247000000, 247000000, 251000000, 252000000, 257000000,
  258000000, 259000000, 266000000, 267000000, 268000000, 269000000, 270000000, 269000000, 278000000, 281000000,
  282000000, 285000000, 286000000, 289000000, 290000000, 293000000, 294000000, 294000000,
];

/**
 * A mass's decimal literal scaled by 10⁶ in exact integer arithmetic: never
 * the binary64 product (65.38 × 10⁶ is 65,379,999.99999999 there).
 */
export function microDaltonsFromLiteral(mass: number): bigint {
  const text = String(mass);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) fail('range', `mass literal ${text}`);
  const frac = m[2] ?? '';
  if (frac.length > 6) fail('range', `mass ${text} has more than 6 decimals`);
  return BigInt(m[1] + frac.padEnd(6, '0'));
}

export function microDaltons(z: number): bigint {
  const v = MICRO_DA_V1[z];
  if (!Number.isInteger(z) || z < 1 || v === undefined) fail('range', `element ${z}`);
  return BigInt(v);
}

export const elementSymbol = (z: number): string => {
  const spec = ELEMENT_DATA[z];
  if (!spec) fail('range', `element ${z}`);
  return spec.symbol;
};

export function addCounts(into: Map<number, bigint>, from: ReadonlyMap<number, bigint>, sign = 1n): Map<number, bigint> {
  for (const [z, n] of from) {
    const v = (into.get(z) ?? 0n) + sign * n;
    if (v < 0n) fail('range', 'negative element count');
    if (v === 0n) into.delete(z);
    else into.set(z, v);
  }
  return into;
}

export function countsOf(z: ArrayLike<number>): Map<number, bigint> {
  const out = new Map<number, bigint>();
  for (let i = 0; i < z.length; i += 1) out.set(z[i], (out.get(z[i]) ?? 0n) + 1n);
  return out;
}

/** Hill order: with carbon, C then H then alphabetical; without, all alphabetical. */
export function hillFormula(counts: ReadonlyMap<number, bigint>): string {
  const entries = [...counts].filter(([, n]) => n > 0n).map(([z, n]) => [elementSymbol(z), n] as const);
  const hasC = entries.some(([s]) => s === 'C');
  const rank = (s: string): string => (hasC && s === 'C' ? '\u0000' : hasC && s === 'H' ? '\u0001' : s);
  entries.sort((a, b) => (rank(a[0]) < rank(b[0]) ? -1 : rank(a[0]) > rank(b[0]) ? 1 : 0));
  return entries.map(([s, n]) => (n === 1n ? s : `${s}${n}`)).join('');
}

/** §5.3's plaque text: formula, × copies (parenthesized when a sum or difference), − removed. */
export function formulaText(c: Composition): string {
  let text = hillFormula(c.unit);
  if (magnitudeKey(c.copies) !== magnitudeKey(magnitude(1))) {
    const f = formatMagnitudeDetailed(c.copies);
    text += f.rule === '4a' || f.rule === '4b' ? ` × (${f.text})` : ` × ${f.text}`;
  }
  if ([...c.removed.values()].some((n) => n > 0n)) text += ` − ${hillFormula(c.removed)}`;
  return text;
}

/** massµDa = (Σ unit[Z] µDa(Z)) × copies − Σ removed[Z] µDa(Z), exact. */
export function massMicroDa(c: Composition): Magnitude {
  let unit = 0n;
  for (const [z, n] of c.unit) unit += n * microDaltons(z);
  let removed = 0n;
  for (const [z, n] of c.removed) removed += n * microDaltons(z);
  return subMagnitude(mulSmallMagnitude(c.copies, unit), magnitude(removed, c.copies.displayBase));
}

/** Total count of a composition, the same Magnitude count() returns. */
export function compositionCount(c: Composition): Magnitude {
  let unit = 0n;
  for (const n of c.unit.values()) unit += n;
  let removed = 0n;
  for (const n of c.removed.values()) removed += n;
  return subMagnitude(mulSmallMagnitude(c.copies, unit), magnitude(removed, c.copies.displayBase));
}
