/**
 * usePhoneSheet — a viewer panel on a phone floats over the full-bleed canvas
 * and makes room for the molecule.
 *
 * - Portrait (`PHONE_SHEET_QUERY`): a bottom sheet over the command deck with
 *   three detents, Peek, Half and Full. The handle (and the panel's header)
 *   drags it; a flick carries it to the next detent; a drag or flick down
 *   past Peek closes it. A tap on the handle steps Peek → Half → Full → Peek,
 *   and the arrow keys, Home and End move it from the keyboard. Each panel
 *   reopens at the detent it was left at, for the session.
 * - Landscape (`PHONE_SIDE_QUERY`): a column on the right; no detents.
 * - Either way it declares the area it covers (camera/useViewOccluder.ts), so
 *   the molecule eases into the room left above or beside it, and rides the
 *   sheet while it is dragged.
 * - Motion: Still makes the sheet cut between detents (the molecule cuts
 *   too); Gentle still glides.
 * - Desktop (`mode` null): nothing changes; no handle, no declaration.
 *
 * The height lives in the `--lupi-sheet-height` custom property on the sheet,
 * written here directly (so a drag never re-renders the panel); global.css
 * owns the rest of the layout.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { glidesAnimate, useComfort } from '../motion/comfort';
import { useViewOccluder } from '../camera/useViewOccluder';

export type SheetDetent = 'peek' | 'half' | 'full';
export type PhoneSheetMode = 'sheet' | 'side' | null;

/** Phones held upright (and narrow windows): bottom sheets with detents. */
export const PHONE_SHEET_QUERY = '(max-width: 640px) and (orientation: portrait)';
/** Phones held sideways: a column on the right. */
export const PHONE_SIDE_QUERY = '(max-height: 500px) and (max-width: 900px) and (orientation: landscape)';

const DETENTS: ReadonlyArray<SheetDetent> = ['peek', 'half', 'full'];
export const SHEET_DETENT_LABEL: Readonly<Record<SheetDetent, string>> = {
  peek: 'Peek',
  half: 'Half',
  full: 'Full',
};

/** A drag shorter than this (CSS px) is a tap. */
const DRAG_SLOP_PX = 5;
/** A release carries on this long (ms) at its velocity when choosing a detent. */
const FLING_MS = 170;
/** How far past Full a drag stretches (as a share of the overshoot), and at most. */
const OVERSTRETCH = 0.28;
const OVERSTRETCH_MAX_PX = 36;
/** The sheet slides away this long (ms) when swiped closed. */
const DISMISS_MS = 200;

/** Each panel's last detent, for the session (never persisted). */
const remembered = new Map<string, SheetDetent>();

export interface SheetHeights {
  peek: number;
  half: number;
  full: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The three detent heights (CSS px) for a sheet whose container is
 * `containerHeight` tall, sits `bottomInset` above the container's bottom and
 * must stop `topLimit` below its top (under the header capsule).
 *
 * - Full reaches up to the header.
 * - Half keeps the top half of a phone for the molecule.
 * - Peek shows the panel's header and a first row, so most of the molecule stays in view.
 */
export function sheetHeights(containerHeight: number, bottomInset: number, topLimit: number): SheetHeights {
  const full = Math.max(160, Math.round(containerHeight - bottomInset - topLimit));
  const half = Math.min(full, clamp(Math.round(containerHeight * 0.44), 240, 400));
  const peek = Math.max(110, Math.min(half - 56, clamp(Math.round(containerHeight * 0.25), 150, 220)));
  return { peek, half, full };
}

function measureHeights(node: HTMLElement): SheetHeights | null {
  const container = node.offsetParent as HTMLElement | null;
  if (!container || typeof window === 'undefined') return null;
  const box = container.getBoundingClientRect();
  if (!(box.height > 0)) return null;
  const bottomInset = Number.parseFloat(window.getComputedStyle(node).bottom) || 0;
  const header = document.querySelector('.lupine-status-bar');
  const headerBottom = header ? header.getBoundingClientRect().bottom - box.top : 64;
  return sheetHeights(box.height, bottomInset, Math.max(8, headerBottom + 8));
}

function sameHeights(a: SheetHeights | null, b: SheetHeights | null): boolean {
  return a === b || (!!a && !!b && a.peek === b.peek && a.half === b.half && a.full === b.full);
}

function nearestDetent(height: number, heights: SheetHeights): SheetDetent {
  let best: SheetDetent = 'half';
  let distance = Infinity;
  for (const detent of DETENTS) {
    const d = Math.abs(heights[detent] - height);
    if (d < distance) {
      distance = d;
      best = detent;
    }
  }
  return best;
}

interface DragState {
  pointerId: number;
  startY: number;
  startHeight: number;
  height: number;
  moved: boolean;
  samples: Array<{ t: number; y: number }>;
}

/** Release velocity (CSS px per ms, positive downward) from the last ~100 ms of samples. */
function releaseVelocity(samples: ReadonlyArray<{ t: number; y: number }>): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const sample of samples) {
    if (last.t - sample.t <= 100) {
      first = sample;
      break;
    }
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

export interface PhoneSheetOptions {
  /** The overlay's id among those the live view makes room for. */
  id: string;
  /** Which panel the sheet shows (several panels share one sheet): its detent is remembered. */
  memoryKey: string;
  /** The sheet is on screen (mounted, not stowed). */
  open: boolean;
  /** A swipe down past Peek closes it. */
  onDismiss(): void;
  defaultDetent?: SheetDetent;
}

export interface PhoneSheet {
  mode: PhoneSheetMode;
  detent: SheetDetent;
  /** Attach to the sheet's outer element. */
  sheetRef(node: HTMLElement | null): void;
  /** Spread on the sheet's outer element. */
  sheetProps: Record<string, string | undefined>;
  /** Spread on the handle button (render it only when `mode === 'sheet'`). */
  handleProps: {
    type: 'button';
    className: string;
    'aria-label': string;
    title: string;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
    onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
    onClick(): void;
    onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  };
  /** Spread on the panel's header: it drags the sheet too (its buttons still work). */
  gripProps: {
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
    onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  };
  setDetent(detent: SheetDetent): void;
}

export function usePhoneSheet({
  id,
  memoryKey,
  open,
  onDismiss,
  defaultDetent = 'half',
}: PhoneSheetOptions): PhoneSheet {
  const portrait = useMediaQuery(PHONE_SHEET_QUERY);
  const sideways = useMediaQuery(PHONE_SIDE_QUERY);
  const mode: PhoneSheetMode = portrait ? 'sheet' : sideways ? 'side' : null;
  const comfort = useComfort();
  const cut = !glidesAnimate(comfort);
  const [detent, setDetentState] = useState<SheetDetent>(() => remembered.get(memoryKey) ?? defaultDetent);
  const [heights, setHeights] = useState<SheetHeights | null>(null);
  const [dragging, setDragging] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissing = useRef(false);
  /** The sheet has not been given a detent height since it opened: the first one lands without a transition. */
  const fresh = useRef(true);
  const { ref: occluderRef, setTracking } = useViewOccluder(id, open && mode !== null);
  const live = useRef({ memoryKey, onDismiss, cut, heights, mode, detent });
  live.current = { memoryKey, onDismiss, cut, heights, mode, detent };

  // Another panel in the same sheet: it opens at its own remembered detent.
  useEffect(() => {
    setDetentState(remembered.get(memoryKey) ?? defaultDetent);
  }, [memoryKey, defaultDetent]);

  // A sheet swiped closed and opened again starts whole.
  useEffect(() => {
    dismissing.current = false;
  }, [memoryKey, open]);

  const setDetent = useCallback((next: SheetDetent) => {
    remembered.set(live.current.memoryKey, next);
    setDetentState(next);
  }, []);

  const sheetRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      occluderRef(node);
    },
    [occluderRef],
  );

  // Detent heights follow the screen (rotation, the URL bar, the keyboard).
  useLayoutEffect(() => {
    if (mode !== 'sheet' || !open) {
      fresh.current = true;
      setHeights(null);
      return undefined;
    }
    const update = () => {
      const node = nodeRef.current;
      const next = node ? measureHeights(node) : null;
      setHeights((previous) => (sameHeights(previous, next) ? previous : next));
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [mode, open]);

  // The detent's height, written straight to the sheet (a drag writes it per move).
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (mode !== 'sheet' || !heights) {
      node.style.removeProperty('--lupi-sheet-height');
      return;
    }
    if (drag.current?.moved || dismissing.current) return;
    const height = `${heights[detent]}px`;
    if (!fresh.current) {
      node.style.setProperty('--lupi-sheet-height', height);
      return;
    }
    // Opening: rise straight to the detent rather than also growing to it.
    fresh.current = false;
    const transition = node.style.transition;
    node.style.transition = 'none';
    node.style.setProperty('--lupi-sheet-height', height);
    void node.offsetHeight;
    node.style.transition = transition;
  }, [mode, heights, detent, dragging, open]);

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const dismiss = useCallback(() => {
    const node = nodeRef.current;
    const { cut: cuts, onDismiss: close } = live.current;
    if (!node || cuts) {
      close();
      return;
    }
    // Slide it away (the molecule follows), then close.
    dismissing.current = true;
    node.style.setProperty('--lupi-sheet-height', '0px');
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      close();
    }, DISMISS_MS);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const { mode: current, heights: sizes } = live.current;
    suppressClick.current = false;
    if (current !== 'sheet' || !sizes || event.button > 0 || drag.current || dismissing.current) return;
    const target = event.target as Element | null;
    const onHandle = Boolean(target?.closest('.lupi-sheet-handle'));
    // The header's own controls (close, tabs, links) keep working.
    if (!onHandle && target?.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="tab"]')) return;
    const node = nodeRef.current;
    if (!node) return;
    const height = node.getBoundingClientRect().height;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      height,
      moved: false,
      samples: [{ t: event.timeStamp, y: event.clientY }],
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = drag.current;
      const sizes = live.current.heights;
      const node = nodeRef.current;
      if (!state || event.pointerId !== state.pointerId || !sizes || !node) return;
      const dy = event.clientY - state.startY;
      if (!state.moved) {
        if (Math.abs(dy) < DRAG_SLOP_PX) return;
        state.moved = true;
        setDragging(true);
        setTracking(true);
      }
      let height = state.startHeight - dy;
      if (height > sizes.full) {
        height = sizes.full + Math.min(OVERSTRETCH_MAX_PX, (height - sizes.full) * OVERSTRETCH);
      }
      height = Math.max(0, height);
      state.height = height;
      state.samples.push({ t: event.timeStamp, y: event.clientY });
      if (state.samples.length > 8) state.samples.shift();
      node.style.setProperty('--lupi-sheet-height', `${Math.round(height)}px`);
      event.preventDefault();
    },
    [setTracking],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const state = drag.current;
      if (!state || event.pointerId !== state.pointerId) return;
      drag.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (!state.moved) return;
      // A drag on the handle is not also a tap on it (reset on the next press).
      suppressClick.current = true;
      setDragging(false);
      setTracking(false);
      const sizes = live.current.heights;
      if (!sizes) return;
      const velocity = cancelled ? 0 : releaseVelocity(state.samples);
      const projected = state.height - velocity * FLING_MS;
      const closing =
        !cancelled && (projected < sizes.peek * 0.55 || (state.height < sizes.peek - 24 && velocity > 0.35));
      if (closing) {
        dismiss();
        return;
      }
      const next = nearestDetent(clamp(projected, sizes.peek, sizes.full), sizes);
      setDetent(next);
      // Same detent as before: the layout effect re-runs on `dragging` and snaps it back.
    },
    [dismiss, setDetent, setTracking],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, false), [finish]);
  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, true), [finish]);

  const onClick = useCallback(() => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const index = DETENTS.indexOf(live.current.detent);
    setDetent(DETENTS[(index + 1) % DETENTS.length]);
  }, [setDetent]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      suppressClick.current = false;
      const index = DETENTS.indexOf(live.current.detent);
      let next: SheetDetent | null = null;
      if (event.key === 'ArrowUp' || event.key === 'PageUp') next = DETENTS[Math.min(DETENTS.length - 1, index + 1)];
      else if (event.key === 'ArrowDown' || event.key === 'PageDown') next = DETENTS[Math.max(0, index - 1)];
      else if (event.key === 'Home') next = 'full';
      else if (event.key === 'End') next = 'peek';
      if (!next) return;
      event.preventDefault();
      setDetent(next);
    },
    [setDetent],
  );

  const sheetProps: Record<string, string | undefined> = {
    'data-sheet': mode ?? undefined,
    'data-detent': mode === 'sheet' ? detent : undefined,
    'data-sheet-dragging': dragging ? 'true' : undefined,
    'data-sheet-cut': mode && cut ? 'true' : undefined,
  };

  return {
    mode,
    detent,
    sheetRef,
    sheetProps,
    handleProps: {
      type: 'button',
      className: 'lupi-sheet-handle',
      'aria-label': `Panel height: ${SHEET_DETENT_LABEL[detent]}. Drag, tap, or use the arrow keys to change it`,
      title: 'Drag to resize · tap to step',
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClick,
      onKeyDown,
    },
    gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    setDetent,
  };
}
