// The scale axis (scale-spec §8.7, §8.8) as the page shows it: φ from λ and
// back, the magnification readout, and the slider, which gives the ±32
// decades where fingers map one to one most of its length and the rest of
// a googolplex's decades of decades the remainder.

import { formatMagnitude, lnBig, magnitude, type Magnification } from '@atlas/core/scale';

export const LINEAR_DECADES = 32;

export function phiOfLambda(lambda: number): number {
  return Math.abs(lambda) <= LINEAR_DECADES ? lambda : Math.sign(lambda) * LINEAR_DECADES * (1 + Math.log(Math.abs(lambda) / LINEAR_DECADES));
}

export function lambdaOfPhi(phi: number): number {
  return Math.abs(phi) <= LINEAR_DECADES ? phi : Math.sign(phi) * LINEAR_DECADES * Math.exp(Math.abs(phi) / LINEAR_DECADES - 1);
}

/** u · log10 f, the decades the anchor's unit holds; Infinity past binary64. */
export function unitDecades(m: Magnification): number {
  return Number(m.u) * Math.log10(m.f);
}

/** λ in binary64: exact to the last decade while |λ| < 2⁵⁰, a value beyond. */
export function lambdaOfMagnification(m: Magnification): number {
  return m.ell - unitDecades(m);
}

/** φ from the exact pair (§8.7): finite for every v1 tower. */
export function phiOfMagnification(m: Magnification): number {
  if (unitDecades(m) < 2 ** 50) return phiOfLambda(lambdaOfMagnification(m));
  const lnAbs = lnBig(m.u) + Math.log(Math.log10(m.f));
  return -LINEAR_DECADES * (1 + lnAbs - Math.log(LINEAR_DECADES));
}

const MINUS = '−';

/** m × 10^e with four significant digits, for an ordinary binary64 value. */
export function scientificNumber(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return String(v);
  let e = Math.floor(Math.log10(v));
  let m = v / 10 ** e;
  m = Math.round(m * 1000) / 1000;
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  const mantissa = trimZeros(m.toFixed(3));
  if (e === 0) return mantissa;
  return `${mantissa} × 10^${e < 0 ? MINUS : ''}${Math.abs(e)}`;
}

const trimZeros = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

/**
 * §8.7's readout: "life size" within half a hundredth of a decade, "shown
 * m × 10^e times life size" within ±32 decades, and beyond, "shown 10^λ
 * times life size" with λ in scientific form, or in the tower's base when a
 * decimal exponent would not be exact.
 */
export function magnificationText(m: Magnification): string {
  const decades = unitDecades(m);
  const lambda = m.ell - decades;
  if (decades < 2 ** 50 && Math.abs(lambda) <= LINEAR_DECADES) {
    if (Math.abs(lambda) < 0.005) return 'life size';
    return `shown ${scientificNumber(10 ** lambda)} times life size`;
  }
  if (m.f === 10 || decades < 2 ** 50) {
    const abs = Math.abs(lambda);
    const text = abs < 1e6 ? abs.toFixed(2) : scientificNumber(abs);
    return `shown 10^(${lambda < 0 ? MINUS : ''}${text}) times life size`;
  }
  const exponent = formatMagnitude(magnitude(m.u)).replace(/^≈ /, '');
  return `shown ${m.f}^(${MINUS}${exponent}) times life size`;
}

/** The share of the track the ±32 decades take when an entry reaches past them. */
export const LINEAR_SHARE = 0.55;

export interface SliderRange {
  phiMin: number;
  phiMax: number;
}

/**
 * Slider position in [0, 1] from φ: one straight segment for the decades
 * beyond −32 and one for the ±32 decades, so the decades of decades do not
 * squeeze a billion-ion cube into a pixel.
 */
export function sliderOfPhi(phi: number, range: SliderRange): number {
  const { phiMin, phiMax } = range;
  const p = Math.min(phiMax, Math.max(phiMin, phi));
  if (phiMin >= -LINEAR_DECADES) return (p - phiMin) / Math.max(phiMax - phiMin, 1e-9);
  const knee = -LINEAR_DECADES;
  if (p <= knee) return ((p - phiMin) / (knee - phiMin)) * (1 - LINEAR_SHARE);
  return 1 - LINEAR_SHARE + ((p - knee) / Math.max(phiMax - knee, 1e-9)) * LINEAR_SHARE;
}

export function phiOfSlider(s: number, range: SliderRange): number {
  const { phiMin, phiMax } = range;
  const x = Math.min(1, Math.max(0, s));
  if (phiMin >= -LINEAR_DECADES) return phiMin + x * (phiMax - phiMin);
  const knee = -LINEAR_DECADES;
  if (x <= 1 - LINEAR_SHARE) return phiMin + (x / (1 - LINEAR_SHARE)) * (knee - phiMin);
  return knee + ((x - (1 - LINEAR_SHARE)) / LINEAR_SHARE) * (phiMax - knee);
}

/**
 * A pinch or wheel of `ratio` as a change of φ: one to one within the ±32
 * decades, and beyond, a tenfold pinch takes |λ| through `decadesOfDecades`
 * powers of ten (dφ/dlog10|λ| is 32 ln 10 there).
 */
export function phiDeltaOfRatio(ratio: number, phiNow: number, decadesOfDecades = 4): number {
  const d = Math.log10(ratio);
  if (Math.abs(phiNow) <= LINEAR_DECADES) return d;
  return d * decadesOfDecades * LINEAR_DECADES * Math.LN10;
}

/** A landmark label on the slider: where its tick sits (0 to 1) and how wide it prints (px). */
export interface TickLabel {
  pos: number;
  width: number;
}

/** Whether a landmark's label prints, and how far (px) it moves off its tick to stay on the track. */
export interface TickPlacement {
  shown: boolean;
  nudge: number;
}

/**
 * Which landmark labels the slider prints, so that none touches another:
 * the deepest landmark first (a dive ends there), then the largest, then
 * the rest from the deep end up, each only where it clears every label
 * already placed by `gap` px. Landmarks run from the largest piece to one
 * ion. A label at either end moves inward to stay within `overhang` px of
 * the track. A hidden label keeps its tick.
 */
export function placeTickLabels(labels: readonly TickLabel[], trackWidth: number, gap: number, overhang = 0): TickPlacement[] {
  const out = labels.map<TickPlacement>(() => ({ shown: false, nudge: 0 }));
  const n = labels.length;
  if (!(trackWidth > 0) || n === 0) return out;
  const order = [n - 1];
  if (n > 1) order.push(0);
  for (let i = n - 2; i >= 1; i -= 1) order.push(i);
  const placed: Array<[number, number]> = [];
  for (const i of order) {
    const { pos, width } = labels[i];
    if (!(width > 0)) continue;
    const centred = pos * trackWidth - width / 2;
    const left = Math.max(-overhang, Math.min(trackWidth + overhang - width, centred));
    const right = left + width;
    if (placed.some(([l, r]) => left < r + gap && right > l - gap)) continue;
    placed.push([left, right]);
    out[i] = { shown: true, nudge: left - centred };
  }
  return out;
}
