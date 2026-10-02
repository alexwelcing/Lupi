/**
 * intents.ts — the Lupi intent bus.
 *
 * Input is interpreted once (by the gesture arbiter, the keyboard shortcuts,
 * the Play pill) and announced here as a typed intent; toys, the picker and
 * the camera rig subscribe. Emission is synchronous and every listener is
 * isolated: a throwing listener is logged and the rest still run.
 *
 * This lives in scene (not ui) because scene's AtomPicker consumes it and
 * scene must not import ui.
 *
 * Contract file: additive edits only (append union members / exports).
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';
export type Vec3 = [number, number, number];

export type LupiIntent =
  | { type: 'canvas.tap'; clientX: number; clientY: number; pointerType: PointerKind; shiftKey: boolean }
  | { type: 'canvas.doubleTap'; clientX: number; clientY: number; pointerType: PointerKind }
  | { type: 'canvas.hover'; clientX: number; clientY: number }
  | { type: 'canvas.hoverEnd' }
  | { type: 'camera.gestureStart'; pointerType: PointerKind }
  | { type: 'camera.catch' }
  /** The rig came to rest. `viewDir` = normalize(camera.position − target); `detentLabel` names the detent it clicked into. */
  | { type: 'camera.rest'; viewDir: Vec3; detentLabel: string | null; userMoved: boolean }
  | { type: 'camera.detentStep'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { type: 'camera.home' }
  | { type: 'camera.focusAtom'; atomIndex: number }
  /** `factor` multiplies the camera distance (0.6 = 40 % closer), toward the point under the pointer. */
  | { type: 'camera.zoomToward'; clientX: number; clientY: number; factor: number }
  | { type: 'atom.tap'; atomIndex: number }
  | {
      type: 'verb.stroke';
      clientX: number;
      clientY: number;
      phase: 'start' | 'move' | 'end';
      pointerType: PointerKind;
    }
  | { type: 'play.toggleTray'; source: 'pill' | 'key' | 'contextmenu' | 'palette' }
  | { type: 'play.scatter' }
  | { type: 'play.spin' }
  | { type: 'play.reset' }
  | { type: 'spin.flip' };

export type LupiIntentType = LupiIntent['type'];
export type LupiIntentOf<T extends LupiIntentType> = Extract<LupiIntent, { type: T }>;

type AnyListener = (intent: LupiIntent) => void;

const listeners = new Map<LupiIntentType, Set<AnyListener>>();

/** Deliver `intent` to every listener of its type, synchronously. */
export function emitIntent(intent: LupiIntent): void {
  const set = listeners.get(intent.type);
  if (!set || set.size === 0) return;
  // Snapshot: a listener may unsubscribe (or subscribe) while we deliver.
  for (const listener of Array.from(set)) {
    try {
      listener(intent);
    } catch (error) {
      console.error(`[lupi] intent listener for "${intent.type}" threw`, error);
    }
  }
}

/** Listen for one intent type; returns the unsubscribe. */
export function onIntent<T extends LupiIntentType>(
  type: T,
  listener: (intent: LupiIntentOf<T>) => void,
): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  const entry = listener as AnyListener;
  set.add(entry);
  return () => {
    listeners.get(type)?.delete(entry);
  };
}

// ─── Canvas input source ─────────────────────────────────────────────
// While a canvas input source (the camera rig's gesture arbiter) is mounted,
// it owns raw pointers on the canvas and announces taps as intents; the
// picker's legacy window listeners stand down.

let inputSources = 0;
const inputSourceListeners = new Set<(active: boolean) => void>();

function notifyInputSource(active: boolean): void {
  for (const listener of Array.from(inputSourceListeners)) {
    try {
      listener(active);
    } catch (error) {
      console.error('[lupi] canvas input source listener threw', error);
    }
  }
}

/** Register a canvas input source while mounted; returns the unregister (idempotent). */
export function registerCanvasInputSource(): () => void {
  inputSources += 1;
  if (inputSources === 1) notifyInputSource(true);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    inputSources -= 1;
    if (inputSources === 0) notifyInputSource(false);
  };
}

export function isCanvasInputSourceActive(): boolean {
  return inputSources > 0;
}

/** Called with the new state whenever a canvas input source appears or goes away. */
export function subscribeCanvasInputSource(listener: (active: boolean) => void): () => void {
  inputSourceListeners.add(listener);
  return () => {
    inputSourceListeners.delete(listener);
  };
}
