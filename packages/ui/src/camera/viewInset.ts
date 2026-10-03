/**
 * viewInset.ts — phone overlays make room for the molecule.
 *
 * Every phone sheet, card or tray that covers part of the canvas declares the
 * client rectangle it covers (`setViewOccluder`). The canvas-side driver
 * (ViewInsetDriver) finds the largest rectangle that the overlays and the
 * fixed chrome (header capsule, Play pill, command deck) leave free, and eases
 * the live view so the molecule sits in it: a shift, plus a zoom-out when the
 * molecule would not fit (never a zoom-in). Both are one projection view
 * offset on the live camera. With nothing declared the view is untouched, so
 * desktop (where nothing declares) never changes.
 *
 * Display only. The camera pose, the store, saved views, share URLs and the
 * axes gizmo never see it; captures, thumbnails and video clear it; picking,
 * hover, Poke and the toys raycast through the live projection, so they hit
 * what is drawn; the rig's drag math works in canvas pixels and never reads
 * it. A zoom anchors on the point that will be under the finger once the
 * framing has settled (`liveClientPoint`).
 */

/** A client rectangle (CSS px, viewport coordinates). */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewOccluder {
  /** What the overlay covers (client px). */
  rect: ScreenRect;
  /**
   * A tap on the canvas opens or closes it (the atom card): the view holds
   * for one double-tap window first, so a second tap lands on what the first
   * one touched.
   */
  tapBorn?: boolean;
  /** The visitor is dragging it (a sheet handle): the view follows it tightly. */
  tracking?: boolean;
  /**
   * A quick menu (the Play tray): the view waits this long (ms) after it
   * appears before making room, so a pick that closes it at once moves nothing.
   */
  lingerMs?: number;
}

/**
 * Where the live view draws a base pixel b (CSS px):
 * `canvasCentre + (x, y) + scale · (b − canvasCentre)`.
 */
export interface ViewFraming {
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY_FRAMING: Readonly<ViewFraming> = Object.freeze({ x: 0, y: 0, scale: 1 });

/** Breathing room (CSS px) between the free area and what bounds it. */
export const FREE_GAP_PX = 12;
/** A free area narrower or shorter than this (CSS px) is no room at all: the view stays put. */
export const MIN_FREE_PX = 96;
/** The view never shrinks the molecule below this share of its size. */
export const MIN_SCALE = 0.42;
/** The view never moves by more than this share of the canvas width or height. */
export const MAX_SHIFT_FRACTION = 0.45;
/** A molecule that has to shrink fills this share of the free area. */
const FIT_FILL = 0.94;
/**
 * Share of the free slack kept clear on each side when the molecule moves:
 * a molecule already in the middle of the free area stays where it is, one
 * near an edge moves into the middle 40 %.
 */
const SLACK_MARGIN = 0.3;

export interface OccluderChange {
  id: string;
  appeared: boolean;
  gone: boolean;
  tapBorn: boolean;
  lingerMs: number;
}

const occluders = new Map<string, Required<ViewOccluder>>();
const listeners = new Set<(change: OccluderChange) => void>();

function validRect(rect: ScreenRect | null | undefined): rect is ScreenRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.right) &&
      Number.isFinite(rect.bottom) &&
      rect.right - rect.left >= 1 &&
      rect.bottom - rect.top >= 1,
  );
}

function roundRect(rect: ScreenRect): ScreenRect {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  };
}

function sameRect(a: ScreenRect, b: ScreenRect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

function notify(change: OccluderChange): void {
  for (const listener of Array.from(listeners)) listener(change);
}

/**
 * Declare (or, with null, withdraw) the screen area an overlay covers. Ids are
 * the overlay's own ('atom-card', 'panel', 'learn', 'play-tray', …); several
 * may be declared at once.
 */
export function setViewOccluder(id: string, occluder: ViewOccluder | null): void {
  const previous = occluders.get(id) ?? null;
  if (!occluder || !validRect(occluder.rect)) {
    if (!previous) return;
    occluders.delete(id);
    notify({ id, appeared: false, gone: true, tapBorn: previous.tapBorn, lingerMs: previous.lingerMs });
    return;
  }
  const next: Required<ViewOccluder> = {
    rect: roundRect(occluder.rect),
    tapBorn: Boolean(occluder.tapBorn),
    tracking: Boolean(occluder.tracking),
    lingerMs: occluder.lingerMs !== undefined && occluder.lingerMs > 0 ? occluder.lingerMs : 0,
  };
  if (
    previous &&
    sameRect(previous.rect, next.rect) &&
    previous.tracking === next.tracking &&
    previous.tapBorn === next.tapBorn &&
    previous.lingerMs === next.lingerMs
  ) {
    return;
  }
  occluders.set(id, next);
  notify({ id, appeared: !previous, gone: false, tapBorn: next.tapBorn, lingerMs: next.lingerMs });
}

export function viewOccluders(): ReadonlyArray<Required<ViewOccluder>> {
  return Array.from(occluders.values());
}

/** Whether the visitor is dragging any declared overlay right now. */
export function occluderTracking(): boolean {
  for (const occluder of occluders.values()) if (occluder.tracking) return true;
  return false;
}

export function subscribeViewOccluders(listener: (change: OccluderChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let current: ViewFraming = { ...IDENTITY_FRAMING };
let target: ViewFraming = { ...IDENTITY_FRAMING };

/** The driver's report, each frame it moves: the framing on screen now, and where it is heading. */
export function reportViewFraming(now: ViewFraming, heading: ViewFraming): void {
  current = { x: now.x, y: now.y, scale: now.scale };
  target = { x: heading.x, y: heading.y, scale: heading.scale };
}

export function viewFraming(): { current: ViewFraming; target: ViewFraming; occluders: string[] } {
  return { current: { ...current }, target: { ...target }, occluders: Array.from(occluders.keys()) };
}

/**
 * The client point to raycast through the live projection now, to reach what
 * will be under the client point (x, y) once the framing has settled.
 */
export function liveClientPoint(
  x: number,
  y: number,
  canvas: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (!(canvas.width > 0) || !(canvas.height > 0) || !(target.scale > 0)) return { x, y };
  const cx = canvas.left + canvas.width / 2;
  const cy = canvas.top + canvas.height / 2;
  const bx = cx + (x - cx - target.x) / target.scale;
  const by = cy + (y - cy - target.y) / target.scale;
  const lx = cx + current.x + current.scale * (bx - cx);
  const ly = cy + current.y + current.scale * (by - cy);
  return Number.isFinite(lx) && Number.isFinite(ly) ? { x: lx, y: ly } : { x, y };
}

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function clip(rect: ScreenRect, bounds: ScreenRect): ScreenRect | null {
  const out = {
    left: Math.max(rect.left, bounds.left),
    top: Math.max(rect.top, bounds.top),
    right: Math.min(rect.right, bounds.right),
    bottom: Math.min(rect.bottom, bounds.bottom),
  };
  return out.right > out.left && out.bottom > out.top ? out : null;
}

/**
 * The largest axis-aligned rectangle (by area) inside `bounds` that overlaps
 * none of `blockers`; null when the blockers cover everything. Exhaustive over
 * the blockers' edges, which is exact and cheap for the handful of overlays a
 * phone shows at once.
 */
export function largestFreeRect(bounds: ScreenRect, blockers: ReadonlyArray<ScreenRect>): ScreenRect | null {
  if (!validRect(bounds)) return null;
  const inside = blockers.map((blocker) => clip(blocker, bounds)).filter((rect): rect is ScreenRect => rect !== null);
  if (inside.length === 0) return { ...bounds };
  const edges = (lo: number, hi: number, pick: (rect: ScreenRect) => [number, number]) =>
    Array.from(new Set([lo, hi, ...inside.flatMap(pick)])).sort((a, b) => a - b);
  const xs = edges(bounds.left, bounds.right, (rect) => [rect.left, rect.right]);
  const ys = edges(bounds.top, bounds.bottom, (rect) => [rect.top, rect.bottom]);
  const fullHeight = bounds.bottom - bounds.top;
  let best: ScreenRect | null = null;
  let bestArea = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = xs.length - 1; j > i; j -= 1) {
      const width = xs[j] - xs[i];
      // Narrower columns cannot beat the best even at full height.
      if (width * fullHeight <= bestArea) break;
      for (let k = 0; k < ys.length - 1; k += 1) {
        for (let l = ys.length - 1; l > k; l -= 1) {
          const area = width * (ys[l] - ys[k]);
          if (area <= bestArea) break;
          const candidate = { left: xs[i], right: xs[j], top: ys[k], bottom: ys[l] };
          if (inside.some((blocker) => overlaps(candidate, blocker))) continue;
          best = candidate;
          bestArea = area;
          break;
        }
      }
    }
  }
  return best;
}

/** The free area (client px) the overlays and chrome leave on the canvas, inset by the gap; null when there is none. */
export function freeArea(
  canvas: ScreenRect,
  overlays: ReadonlyArray<ScreenRect>,
  chrome: ReadonlyArray<ScreenRect>,
): ScreenRect | null {
  const rect = largestFreeRect(canvas, [...overlays, ...chrome]);
  if (!rect) return null;
  const inset = {
    left: rect.left + FREE_GAP_PX,
    top: rect.top + FREE_GAP_PX,
    right: rect.right - FREE_GAP_PX,
    bottom: rect.bottom - FREE_GAP_PX,
  };
  return inset.right > inset.left && inset.bottom > inset.top ? inset : null;
}

function isShown(element: Element): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05;
}

/**
 * The fixed chrome that floats over the canvas on a phone (the header
 * capsule, the Play pill, the command deck), as client rects. Hidden or
 * stowed chrome does not count.
 */
export function chromeRects(root: ParentNode = document): ScreenRect[] {
  const rects: ScreenRect[] = [];
  for (const selector of ['.lupine-status-bar', '.lupi-play-pill', '.lupine-command-deck']) {
    const element = root.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0) || !isShown(element)) continue;
    rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return rects;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Where a span of `size` centred at `centre` settles inside [lo, hi] (see SLACK_MARGIN). */
function settleInto(centre: number, size: number, lo: number, hi: number): number {
  const slack = hi - lo - size;
  if (!(slack > 0)) return (lo + hi) / 2;
  const margin = slack * SLACK_MARGIN;
  return clamp(centre, lo + size / 2 + margin, hi - size / 2 - margin);
}

export interface FramingInput {
  /** The canvas (client px). */
  canvas: ScreenRect;
  /** The free area (client px), from `freeArea`. */
  free: ScreenRect | null;
  /** The molecule's screen rectangle at identity framing (client px); null for the whole canvas. */
  subject: ScreenRect | null;
}

/**
 * The framing that puts the molecule in the free area: shrunk to fit (never
 * grown, never below MIN_SCALE), then moved the least that brings it into the
 * middle of the free area. Only the part of the molecule on the canvas counts,
 * so a molecule zoomed past the edges fits what was visible. Identity when the
 * free area is missing or too small to be worth moving into.
 */
export function insetFraming({ canvas, free, subject }: FramingInput): ViewFraming {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  if (!(width > 0) || !(height > 0) || !free) return { ...IDENTITY_FRAMING };
  const freeWidth = free.right - free.left;
  const freeHeight = free.bottom - free.top;
  if (!(freeWidth >= MIN_FREE_PX) || !(freeHeight >= MIN_FREE_PX)) return { ...IDENTITY_FRAMING };
  const seen = (subject && validRect(subject) ? clip(subject, canvas) : null) ?? canvas;
  const subjectWidth = seen.right - seen.left;
  const subjectHeight = seen.bottom - seen.top;
  const scale = clamp(
    Math.min(1, (FIT_FILL * freeWidth) / subjectWidth, (FIT_FILL * freeHeight) / subjectHeight),
    MIN_SCALE,
    1,
  );
  const cx = canvas.left + width / 2;
  const cy = canvas.top + height / 2;
  // The molecule's centre once scaled about the canvas centre.
  const sx = cx + scale * ((seen.left + seen.right) / 2 - cx);
  const sy = cy + scale * ((seen.top + seen.bottom) / 2 - cy);
  const nx = settleInto(sx, scale * subjectWidth, free.left, free.right);
  const ny = settleInto(sy, scale * subjectHeight, free.top, free.bottom);
  const x = clamp(nx - sx, -width * MAX_SHIFT_FRACTION, width * MAX_SHIFT_FRACTION);
  const y = clamp(ny - sy, -height * MAX_SHIFT_FRACTION, height * MAX_SHIFT_FRACTION);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return { ...IDENTITY_FRAMING };
  return { x, y, scale };
}

export function isIdentityFraming(framing: ViewFraming): boolean {
  return Math.abs(framing.x) < 0.01 && Math.abs(framing.y) < 0.01 && Math.abs(framing.scale - 1) < 1e-4;
}
