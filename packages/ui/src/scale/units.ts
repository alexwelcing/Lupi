// Physical sizes for the readout. A node's extent is a small number in its
// own units of f^u Å (scale-spec §2.8), with u exact; the length is printed
// in everyday units while binary64 holds it, and beyond in §5.5's form,
// ≈ m × 10^E m with E exact (in the tower's base when f is not 10).

import { formatMagnitude, magnitude } from '@atlas/core/scale';

const MINUS = '−';
const LIGHT_YEAR = 9.4607304725808e15;

function sig(x: number, digits = 3): string {
  const t = Number(x.toPrecision(digits));
  return t >= 1e4 ? t.toLocaleString('en-US') : String(t);
}

/** An exponent as §5.4's E(k): plain below 10^15, else in parentheses. */
function exponentText(e: bigint): string {
  const neg = e < 0n;
  const a = neg ? -e : e;
  const body = a < 10n ** 15n ? a.toString() : `(${formatMagnitude(magnitude(a))})`;
  return `${neg ? MINUS : ''}${body}`;
}

/** An ordinary length in metres, in the unit that reads best. */
export function metresText(m: number): string {
  if (!(m > 0) || !Number.isFinite(m)) return '';
  if (m < 1e-9) return `${sig(m * 1e12)} pm`;
  if (m < 1e-6) return `${sig(m * 1e9)} nm`;
  if (m < 1e-3) return `${sig(m * 1e6)} µm`;
  if (m < 1) return `${sig(m * 1e3)} mm`;
  if (m < 1e3) return `${sig(m)} m`;
  if (m < 1e7) return `${sig(m / 1e3)} km`;
  if (m < 0.1 * LIGHT_YEAR) {
    const e = Math.floor(Math.log10(m));
    return `${sig(m / 10 ** e)} × 10^${e} m`;
  }
  const ly = m / LIGHT_YEAR;
  if (ly < 1e6) return `${sig(ly)} light-years`;
  const e = Math.floor(Math.log10(ly));
  return `${sig(ly / 10 ** e)} × 10^${e} light-years`;
}

/**
 * The length of `extent` node units of f^u Å. Exact in its exponent at any
 * u: a googolplex bar is ≈ 2.82 × 10^(…) m long, with the exponent's digits
 * from u itself, never from a binary64 product.
 */
export function lengthText(extent: number, u: bigint, f: number): string {
  if (!(extent > 0)) return '';
  const decades = Number(u) * Math.log10(f);
  if (decades < 250) return metresText(extent * 10 ** decades * 1e-10);
  // log_f(metres) = u + log_f(extent × 10⁻¹⁰): the integer part splits exactly.
  const local = Math.log(extent * 1e-10) / Math.log(f);
  const whole = Math.floor(local);
  let mantissa = f ** (local - whole);
  let e = u + BigInt(whole);
  if (Number(mantissa.toFixed(3)) >= f) {
    mantissa /= f;
    e += 1n;
  }
  return `≈ ${mantissa.toFixed(3)} × ${f}^${exponentText(e)} m`;
}
