/**
 * gestureArbiter.ts — one interpreter for every pointer on the viewer canvas.
 *
 * `createGestureMachine` is pure (normalized pointer records in, rig calls
 * and intents out), so its rules are testable without a DOM.
 * `attachGestureArbiter` adapts real DOM events on R3F's connected element
 * to it.
 *
 * The grammar:
 * - A press that stays within the slop is a tap. It emits `canvas.tap`
 *   (with shiftKey) at once. A second tap within 300 ms and 32 px emits only
 *   `canvas.doubleTap`.
 * - A press while the rig is visibly moving catches it. The rig stops, and
 *   that press never becomes a tap.
 * - Mouse:
 *   - left-drag orbits (strokes with the Poke verb); Shift+left pans;
 *   - middle-drag dollies;
 *   - right-drag pans (orbits with Poke);
 *   - a right click that barely moves toggles the Play tray.
 * - Touch and pen:
 *   - one finger orbits (strokes with Poke);
 *   - two fingers pinch-zoom about their midpoint and pan (orbit with Poke);
 *   - three or more are ignored.
 * - Overlays in the canvas wrapper (drei <Html> labels and cards): a wheel
 *   zooms unless the overlay scrolls; a press off their controls drags once
 *   it passes the slop, and below it stays the overlay's click.
 * - Release velocity comes from the event timestamps (releaseVelocity.ts). A
 *   cancel, a lost capture, a window blur or a hidden tab never coasts.
 */
import type { LupiIntent, PointerKind } from '@atlas/scene';
import type { PlayVerb } from '../play/playStore';
import { GESTURE, type GestureTokens } from './gestureTokens';
import { releaseVelocity, type PointerSample, type ReleaseVelocity } from './releaseVelocity';
import type { TouchMarks } from './touchMarks';

/** What the machine drives: the rig, plus the intent bus. */
export interface GestureSink {
  emit(intent: LupiIntent): void;
  verb(): PlayVerb;
  /** The rig takes camera input right now (not disabled for flythrough or recording). */
  canManipulate(): boolean;
  /** Visibly moving on its own: a press catches it. */
  isMoving(): boolean;
  /** Nothing in flight: hover picking may run. */
  isIdle(): boolean;
  catchMotion(): void;
  beginGesture(): void;
  endGesture(): void;
  startDrag(): void;
  orbitBy(dxPx: number, dyPx: number): void;
  panBy(dxPx: number, dyPx: number): void;
  zoomBy(logFactor: number, clientX: number | null, clientY: number | null): void;
  dollyBy(dyPx: number): void;
  /** Release: the orbit velocity (px/s) for a coast, or null for none. */
  endDrag(velocity: ReleaseVelocity | null): void;
}

/** One pointer event, normalized. */
export interface GesturePointer {
  id: number;
  pointerType: PointerKind;
  x: number;
  y: number;
  /** event.timeStamp (ms). */
  t: number;
  /** 0 left, 1 middle, 2 right (a Mac ctrl-click arrives as 2). */
  button: number;
  shiftKey: boolean;
  /** Coalesced samples for this move (oldest first); defaults to the event itself. */
  samples?: readonly PointerSample[];
}

export type GestureDrag = 'orbit' | 'pan' | 'dolly' | 'stroke' | 'two';
type Mode = 'none' | 'pending' | 'inert' | GestureDrag;

/** How a pointer's press ended: a tap (its click may pass) or anything else (its click is swallowed). */
export type GestureRelease = 'tap' | 'swallow' | 'none';

export interface GestureMachine {
  /** Returns whether the pointer is now tracked (capture it) and whether it caught motion. */
  down(e: GesturePointer): { tracked: boolean; caught: boolean };
  move(e: GesturePointer): void;
  up(e: GesturePointer): GestureRelease;
  cancel(id: number): void;
  cancelAll(): void;
  /** A buttonless mouse move over the canvas. */
  hover(x: number, y: number): void;
  /** The mouse left the canvas (or moved onto DOM over it). */
  hoverEnd(): void;
  isTracking(id: number): boolean;
  /** The current drag, or null. */
  drag(): GestureDrag | null;
}

interface Tracked {
  id: number;
  type: PointerKind;
  button: number;
  shiftKey: boolean;
  sx: number;
  sy: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  caught: boolean;
  noTap: boolean;
  samples: PointerSample[];
}

const SAMPLE_KEEP_MS = 200;
const SAMPLE_KEEP_MAX = 64;

export function createGestureMachine(tokens: GestureTokens = GESTURE, sink: GestureSink): GestureMachine {
  const pointers = new Map<number, Tracked>();
  let mode: Mode = 'none';
  let lastTap: { x: number; y: number; t: number; type: PointerKind } | null = null;
  let two = { a: -1, b: -1, mx: 0, my: 0, dist: 0 };

  const slop = (type: PointerKind) => tokens.slopPx[type] ?? 8;

  function stroke(p: Tracked, phase: 'start' | 'move' | 'end', x = p.x, y = p.y): void {
    sink.emit({ type: 'verb.stroke', clientX: x, clientY: y, phase, pointerType: p.type });
  }

  function dragKind(p: Tracked): GestureDrag {
    const poke = sink.verb() === 'poke';
    if (p.type === 'mouse') {
      if (p.button === 1) return 'dolly';
      if (p.button === 2) return poke ? 'orbit' : 'pan';
      if (p.shiftKey) return 'pan';
    }
    return poke ? 'stroke' : 'orbit';
  }

  function apply(kind: GestureDrag, dx: number, dy: number): void {
    if (kind === 'orbit') sink.orbitBy(dx, dy);
    else if (kind === 'pan') sink.panBy(dx, dy);
    else if (kind === 'dolly') sink.dollyBy(dy);
  }

  /** Leave whatever one pointer was doing (a second finger took over). */
  function endSingle(): void {
    if (mode === 'orbit' || mode === 'pan' || mode === 'dolly') sink.endDrag(null);
    else if (mode === 'stroke') {
      const p = pointers.values().next().value;
      if (p) stroke(p, 'end');
    }
  }

  function beginTwo(): void {
    const [a, b] = Array.from(pointers.values());
    two = { a: a.id, b: b.id, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    if (sink.canManipulate()) {
      sink.startDrag();
      mode = 'two';
    } else {
      mode = 'inert';
    }
  }

  function moveTwo(): void {
    const a = pointers.get(two.a);
    const b = pointers.get(two.b);
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > 1 && two.dist > 1) sink.zoomBy(Math.log(two.dist / dist), mx, my);
    const dx = mx - two.mx;
    const dy = my - two.my;
    if (dx !== 0 || dy !== 0) {
      if (sink.verb() === 'poke') sink.orbitBy(dx, dy);
      else sink.panBy(dx, dy);
    }
    two = { ...two, mx, my, dist };
  }

  /** A pointer (the only one left) starts over as a fresh press that can no longer tap. */
  function restartSingle(t: number): void {
    const p = pointers.values().next().value;
    mode = 'pending';
    if (!p) return;
    p.sx = p.x;
    p.sy = p.y;
    p.lastX = p.x;
    p.lastY = p.y;
    p.noTap = true;
    p.samples = [{ x: p.x, y: p.y, t }];
  }

  function tap(p: Tracked, t: number, shiftKey: boolean): GestureRelease {
    if (p.type === 'mouse' && p.button === 2) {
      if (Math.hypot(p.x - p.sx, p.y - p.sy) <= tokens.rightClickMaxPx) {
        sink.emit({ type: 'play.toggleTray', source: 'contextmenu' });
      }
      return 'none';
    }
    if (p.type === 'mouse' && p.button !== 0) return 'none';
    const previous = lastTap;
    if (
      previous &&
      previous.type === p.type &&
      t - previous.t <= tokens.doubleTapMs &&
      Math.hypot(p.sx - previous.x, p.sy - previous.y) <= tokens.doubleTapPx
    ) {
      lastTap = null;
      sink.emit({ type: 'canvas.doubleTap', clientX: p.sx, clientY: p.sy, pointerType: p.type });
    } else {
      lastTap = { x: p.sx, y: p.sy, t, type: p.type };
      sink.emit({ type: 'canvas.tap', clientX: p.sx, clientY: p.sy, pointerType: p.type, shiftKey: p.shiftKey || shiftKey });
    }
    return 'tap';
  }

  function release(p: Tracked, e: GesturePointer | null): GestureRelease {
    pointers.delete(p.id);
    let result: GestureRelease = 'swallow';
    if (pointers.size === 0) {
      if (mode === 'pending') {
        result = p.caught ? 'swallow' : p.noTap || !e ? 'swallow' : tap(p, e.t, e.shiftKey);
      } else if (mode === 'orbit') {
        sink.endDrag(e ? releaseVelocity(p.samples, e.t, { windowMs: tokens.flickWindowMs, pauseMs: tokens.flickPauseMs }) : null);
      } else if (mode === 'pan' || mode === 'dolly' || mode === 'two') {
        sink.endDrag(null);
      } else if (mode === 'stroke') {
        stroke(p, 'end');
      }
      mode = 'none';
      sink.endGesture();
      return result;
    }
    // Fingers remain.
    if (mode === 'two' || mode === 'inert') {
      if (mode === 'two') sink.endDrag(null);
      if (pointers.size === 2) beginTwo();
      else if (pointers.size === 1) restartSingle(e?.t ?? 0);
      else mode = 'inert';
    }
    return result;
  }

  return {
    down(e) {
      if (pointers.has(e.id)) return { tracked: true, caught: false };
      if (e.pointerType === 'mouse' && pointers.size > 0) return { tracked: false, caught: false };
      const p: Tracked = {
        id: e.id,
        type: e.pointerType,
        button: e.button,
        shiftKey: e.shiftKey,
        sx: e.x,
        sy: e.y,
        x: e.x,
        y: e.y,
        lastX: e.x,
        lastY: e.y,
        caught: false,
        noTap: pointers.size > 0,
        samples: [{ x: e.x, y: e.y, t: e.t }],
      };
      if (pointers.size === 0) {
        sink.emit({ type: 'camera.gestureStart', pointerType: e.pointerType });
        if (sink.isMoving()) {
          sink.catchMotion();
          p.caught = true;
          lastTap = null;
        }
        sink.beginGesture();
        pointers.set(e.id, p);
        mode = 'pending';
        return { tracked: true, caught: p.caught };
      }
      // Another finger: whatever one finger was doing ends, and nothing taps.
      endSingle();
      pointers.set(e.id, p);
      for (const q of pointers.values()) q.noTap = true;
      if (pointers.size === 2) beginTwo();
      else mode = 'inert';
      return { tracked: true, caught: false };
    },

    move(e) {
      const p = pointers.get(e.id);
      if (!p) return;
      const samples = e.samples && e.samples.length > 0 ? e.samples : [{ x: e.x, y: e.y, t: e.t }];
      for (const s of samples) p.samples.push({ x: s.x, y: s.y, t: s.t });
      const keepFrom = e.t - SAMPLE_KEEP_MS;
      let drop = 0;
      while (drop < p.samples.length - 1 && (p.samples[drop].t < keepFrom || p.samples.length - drop > SAMPLE_KEEP_MAX)) drop += 1;
      if (drop > 0) p.samples.splice(0, drop);
      p.x = e.x;
      p.y = e.y;
      switch (mode) {
        case 'pending': {
          if (Math.hypot(p.x - p.sx, p.y - p.sy) <= slop(p.type)) return;
          p.noTap = true;
          const kind = dragKind(p);
          if (kind === 'stroke') {
            mode = 'stroke';
            stroke(p, 'start', p.sx, p.sy);
            stroke(p, 'move');
          } else if (sink.canManipulate()) {
            mode = kind;
            sink.startDrag();
            // 1:1 from the press point: the slop is not lost.
            apply(kind, p.x - p.sx, p.y - p.sy);
          } else {
            mode = 'inert';
          }
          p.lastX = p.x;
          p.lastY = p.y;
          return;
        }
        case 'orbit':
        case 'pan':
        case 'dolly':
          apply(mode, p.x - p.lastX, p.y - p.lastY);
          p.lastX = p.x;
          p.lastY = p.y;
          return;
        case 'stroke':
          stroke(p, 'move');
          return;
        case 'two':
          moveTwo();
          return;
        default:
          return;
      }
    },

    up(e) {
      const p = pointers.get(e.id);
      if (!p) return 'none';
      if (e.x !== p.x || e.y !== p.y) {
        p.x = e.x;
        p.y = e.y;
        p.samples.push({ x: e.x, y: e.y, t: e.t });
      }
      return release(p, e);
    },

    cancel(id) {
      const p = pointers.get(id);
      if (!p) return;
      p.noTap = true;
      release(p, null);
    },

    cancelAll() {
      for (const id of Array.from(pointers.keys())) this.cancel(id);
    },

    hover(x, y) {
      if (pointers.size > 0 || !sink.isIdle()) return;
      sink.emit({ type: 'canvas.hover', clientX: x, clientY: y });
    },

    hoverEnd() {
      sink.emit({ type: 'canvas.hoverEnd' });
    },

    isTracking(id) {
      return pointers.has(id);
    },

    drag() {
      return mode === 'orbit' || mode === 'pan' || mode === 'dolly' || mode === 'stroke' || mode === 'two' ? mode : null;
    },
  };
}

// ─── DOM adapter ─────────────────────────────────────────────────────

export interface GestureArbiterOptions {
  /** R3F's connected element (the Canvas wrapper). */
  element: HTMLElement;
  canvas: HTMLCanvasElement | null;
  machine: GestureMachine;
  /** Wheel, trackpad pinch (ctrl+wheel) and Safari gesture zoom: a distance factor toward the client point. */
  onZoom(factor: number, clientX: number, clientY: number): void;
  marks?: TouchMarks | null;
}

export interface GestureArbiter {
  dispose(): void;
}

/**
 * A drag's or a catch's click is swallowed. The click arrives after the
 * pointerup, and on a busy main thread (a software renderer, a slow phone)
 * that can be seconds later, so the window is long; any new pointerdown ends
 * it, because a click always follows its own pointerdown.
 */
const CLICK_SWALLOW_MS = 3_000;
const ELEMENT_STYLES = ['touch-action', 'user-select', '-webkit-user-select', '-webkit-touch-callout'] as const;
/** Controls inside an overlay keep their presses. */
const OVERLAY_CONTROLS =
  'button, a[href], input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="slider"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"]';

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

function isMacLike(): boolean {
  try {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  } catch {
    return false;
  }
}

/** A press's button as the arbiter reads it: a Mac ctrl+left click is a right click (2). */
export function pressButton(e: Pick<PointerEvent, 'button' | 'ctrlKey' | 'pointerType'>, mac = isMacLike()): number {
  return mac && e.button === 0 && e.ctrlKey && e.pointerType === 'mouse' ? 2 : e.button;
}

/** Wheel delta → distance factor: a notch is ~15 %, a trackpad pinch (ctrl) is finer-grained but 4x. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean, viewportHeight: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1;
  const px = deltaY * unit * (ctrlKey ? 4 : 1);
  const clamped = Math.max(-240, Math.min(240, Number.isFinite(px) ? px : 0));
  return Math.exp(clamped * 0.0015);
}

export function attachGestureArbiter({ element, canvas, machine, onZoom, marks = null }: GestureArbiterOptions): GestureArbiter {
  const mac = isMacLike();
  const saved = ELEMENT_STYLES.map((name) => [name, element.style.getPropertyValue(name)] as const);
  element.style.setProperty('touch-action', 'none');
  element.style.setProperty('user-select', 'none');
  element.style.setProperty('-webkit-user-select', 'none');
  element.style.setProperty('-webkit-touch-callout', 'none');

  let swallowClickUntil = 0;
  let hovering = false;
  let hoverFrame = 0;
  let hoverX = 0;
  let hoverY = 0;
  let gestureScale = 1;
  // Touch and pen pointers the machine took. iOS and iPadOS fire GestureEvents
  // for a touch pinch too; while a finger is down the pinch is the pointer
  // path's, and a second zoom from gesturechange would overshoot.
  const touchIds = new Set<number>();
  const touchDown = (): boolean => {
    for (const id of touchIds) {
      if (machine.isTracking(id)) return true;
      touchIds.delete(id);
    }
    return false;
  };

  const isCanvasTarget = (target: EventTarget | null): boolean =>
    target === element || (canvas !== null && (target === canvas || target === canvas.parentElement));

  // drei <Html> overlays (knowledge labels, annotation cards, the atom card)
  // portal into this same element. A wheel over one zooms unless something
  // in it scrolls. A press on one (not on a control) stays the overlay's,
  // so its click lands, until it moves past the slop; then it is a canvas
  // drag from the press point.
  const overlayPresses = new Map<number, GesturePointer>();
  const isOverlayTarget = (target: EventTarget | null): target is Element => {
    if (!(target instanceof Element) || isCanvasTarget(target) || !element.contains(target)) return false;
    const control = target.closest(OVERLAY_CONTROLS);
    return !control || !element.contains(control);
  };
  const scrollsWithin = (target: Element): boolean => {
    for (let node: Element | null = target; node && node !== element; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) continue;
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) return true;
    }
    return false;
  };

  const normalize = (e: PointerEvent, samples?: readonly PointerSample[]): GesturePointer => {
    const button = pressButton(e, mac);
    return {
      id: e.pointerId,
      pointerType: pointerKind(e.pointerType),
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      button,
      shiftKey: e.shiftKey,
      samples,
    };
  };

  const coalesced = (e: PointerEvent): PointerSample[] | undefined => {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (!list || list.length === 0) return undefined;
    return list.map((c) => ({ x: c.clientX, y: c.clientY, t: c.timeStamp }));
  };

  const endHover = () => {
    if (!hovering) return;
    hovering = false;
    if (hoverFrame) cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    machine.hoverEnd();
  };

  // Any new press, anywhere, starts a new click sequence.
  const onAnyPointerDown = () => {
    swallowClickUntil = 0;
  };

  /** The machine takes a press: capture it, mark it, end hover. */
  const take = (down: GesturePointer): boolean => {
    const { tracked, caught } = machine.down(down);
    if (!tracked) return false;
    try {
      element.setPointerCapture(down.id);
    } catch {
      /* the pointer is already gone */
    }
    if (down.pointerType !== 'mouse') {
      touchIds.add(down.id);
      marks?.down(down.id, down.x, down.y);
    }
    if (caught) marks?.catchAt(down.x, down.y);
    if (down.pointerType === 'mouse') endHover();
    return true;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    if (isCanvasTarget(e.target)) {
      take(normalize(e));
      return;
    }
    const down = normalize(e);
    if (isOverlayTarget(e.target) && (down.pointerType !== 'mouse' || down.button === 0)) overlayPresses.set(e.pointerId, down);
  };

  const onPointerMove = (e: PointerEvent) => {
    const overlayPress = overlayPresses.get(e.pointerId);
    if (overlayPress && e.buttons === 0) {
      overlayPresses.delete(e.pointerId); // released where we could not see it
    } else if (overlayPress) {
      if (Math.hypot(e.clientX - overlayPress.x, e.clientY - overlayPress.y) <= GESTURE.slopPx[overlayPress.pointerType]) return;
      overlayPresses.delete(e.pointerId);
      if (!take(overlayPress)) return;
    }
    if (machine.isTracking(e.pointerId)) {
      machine.move(normalize(e, coalesced(e)));
      if (e.pointerType !== 'mouse') marks?.move(e.pointerId, e.clientX, e.clientY);
      return;
    }
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    if (!isCanvasTarget(e.target)) {
      endHover();
      return;
    }
    hovering = true;
    hoverX = e.clientX;
    hoverY = e.clientY;
    if (!hoverFrame) {
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (hovering) machine.hover(hoverX, hoverY);
      });
    }
  };

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (!machine.isTracking(e.pointerId)) return;
    const result = cancelled ? (machine.cancel(e.pointerId), 'swallow') : machine.up(normalize(e));
    if (result !== 'tap') swallowClickUntil = performance.now() + CLICK_SWALLOW_MS;
    if (e.pointerType !== 'mouse') marks?.up(e.pointerId);
    try {
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    overlayPresses.delete(e.pointerId);
    finish(e, false);
  };
  const onPointerCancel = (e: PointerEvent) => {
    overlayPresses.delete(e.pointerId);
    finish(e, true);
  };
  const onLostCapture = (e: PointerEvent) => {
    if (machine.isTracking(e.pointerId)) finish(e, true);
  };
  const onPointerLeave = () => endHover();

  const onClickCapture = (e: MouseEvent) => {
    if (swallowClickUntil === 0) return;
    const live = performance.now() <= swallowClickUntil;
    swallowClickUntil = 0;
    if (!live) return;
    const target = e.target as Node | null;
    if (target && element.contains(target)) {
      // The press was a drag or a catch: no pick, no deselect.
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };

  const viewportHeight = () => element.getBoundingClientRect().height || window.innerHeight || 800;

  const onWheel = (e: WheelEvent) => {
    if (!isCanvasTarget(e.target) && !(e.target instanceof Element && element.contains(e.target) && !scrollsWithin(e.target))) {
      // Never page-zoom the viewer (a trackpad pinch over a card is ctrl+wheel).
      if (e.ctrlKey) e.preventDefault();
      return;
    }
    e.preventDefault();
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey, viewportHeight());
    if (factor !== 1) onZoom(factor, e.clientX, e.clientY);
  };

  const onContextMenu = (e: MouseEvent) => {
    if (isCanvasTarget(e.target)) e.preventDefault();
  };

  // Safari trackpad pinch arrives as GestureEvents, not ctrl+wheel. A touch
  // pinch on iOS and iPadOS fires them as well; that one zooms through the
  // pointers, so a gesture is ignored while a finger is down.
  type SafariGesture = Event & { scale: number; clientX: number; clientY: number };
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    if (!isCanvasTarget(e.target)) return;
    const g = e as SafariGesture;
    if (!(g.scale > 0)) return;
    const factor = gestureScale / g.scale;
    gestureScale = g.scale;
    if (touchDown()) return;
    if (Number.isFinite(factor) && factor !== 1) onZoom(factor, g.clientX, g.clientY);
  };

  const onBlur = () => {
    overlayPresses.clear();
    machine.cancelAll();
    marks?.clear();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onBlur();
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onLostCapture);
  element.addEventListener('pointerleave', onPointerLeave);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);
  element.addEventListener('gesturestart', onGestureStart);
  element.addEventListener('gesturechange', onGestureChange);
  window.addEventListener('pointerdown', onAnyPointerDown, true);
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    dispose() {
      machine.cancelAll();
      marks?.clear();
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('lostpointercapture', onLostCapture);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
      window.removeEventListener('pointerdown', onAnyPointerDown, true);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const [name, value] of saved) {
        if (value) element.style.setProperty(name, value);
        else element.style.removeProperty(name);
      }
    },
  };
}
