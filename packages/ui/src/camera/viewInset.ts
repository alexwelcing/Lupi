/**
 * viewInset.ts — a phone overlay makes room for the molecule.
 *
 * The phone atom card docks over the top of the canvas. It reports the
 * client y of its bottom edge here; the canvas-side driver
 * (ViewInsetDriver) turns that into a downward shift of the live view, a
 * projection view offset, so the camera target sits in the middle of the band
 * the card leaves free above the Play pill and the command deck.
 *
 * The shift is display only. The camera pose, the store, saved views and
 * share URLs never see it; captures, thumbnails and video clear it; picking
 * and Poke raycast through the live projection, so they hit what is drawn.
 * The rig adds `pendingViewShift()` to a zoom's pointer, so a zoom keeps the
 * point that will be under the finger once the shift has settled.
 */

/** The shift never moves the view by more than this share of the canvas height. */
export const MAX_SHIFT_FRACTION = 0.3;
/** Breathing room (CSS px) between the free band and what bounds it. */
export const FREE_BAND_GAP_PX = 12;

let occluderBottom: number | null = null;
let current = 0;
let target = 0;
const listeners = new Set<() => void>();

/**
 * The client y (CSS px) of the bottom edge of an overlay docked over the top
 * of the canvas, or null when none is open. One overlay at a time: the phone
 * atom card.
 */
export function setTopOccluder(bottom: number | null): void {
  const next = bottom !== null && Number.isFinite(bottom) ? Math.round(bottom) : null;
  if (next === occluderBottom) return;
  occluderBottom = next;
  for (const listener of Array.from(listeners)) listener();
}

export function topOccluder(): number | null {
  return occluderBottom;
}

export function subscribeTopOccluder(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The driver's report, each frame it moves: the shift on screen now, and where it is heading (CSS px, down). */
export function reportViewShift(now: number, heading: number): void {
  current = now;
  target = heading;
}

export function viewShift(): { current: number; target: number; occluder: number | null } {
  return { current, target, occluder: occluderBottom };
}

/**
 * The shift still to come off (current − target, CSS px). Add it to a client
 * y to find the point that will be under that client point once the shift
 * has settled.
 */
export function pendingViewShift(): number {
  return current - target;
}

export interface FreeBand {
  /** The canvas rectangle's top and height (client px). */
  canvasTop: number;
  canvasHeight: number;
  /** The free band between the overlay and the bottom chrome (client px). */
  freeTop: number;
  freeBottom: number;
}

/**
 * The downward shift (CSS px) that moves the canvas centre to the centre of
 * the free band, clamped to [0, MAX_SHIFT_FRACTION × height]. Zero when the
 * band is empty or the canvas has no size.
 */
export function insetShift({ canvasTop, canvasHeight, freeTop, freeBottom }: FreeBand): number {
  if (!(canvasHeight > 0) || !(freeBottom > freeTop)) return 0;
  const shift = (freeTop + freeBottom) / 2 - (canvasTop + canvasHeight / 2);
  if (!Number.isFinite(shift)) return 0;
  return Math.min(canvasHeight * MAX_SHIFT_FRACTION, Math.max(0, shift));
}

/**
 * The top of the lowest chrome that floats over the bottom of the canvas (the
 * Play pill, the command deck), or the canvas bottom without any. Chrome
 * outside the canvas's lower half (stowed, or a desktop rail) does not count.
 */
export function bottomChromeTop(canvas: { top: number; height: number }, root: ParentNode = document): number {
  const bottom = canvas.top + canvas.height;
  let edge = bottom;
  for (const selector of ['.lupi-play-pill', '.lupine-command-deck']) {
    const element = root.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!(rect.height > 0) || rect.top < canvas.top + canvas.height / 2 || rect.top >= bottom) continue;
    edge = Math.min(edge, rect.top);
  }
  return edge;
}
