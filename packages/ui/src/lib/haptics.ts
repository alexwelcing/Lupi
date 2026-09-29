/**
 * Haptics — a light vibration tick for toy feedback (detents, catches, flips,
 * resets), through `navigator.vibrate`.
 *
 * Opt-in and OFF by default, like the click sound (lib/clickSound.ts): state is
 * module-local (the hot path reads a plain boolean, no React), persisted to
 * localStorage 'lupi.haptics', and observable via {@link subscribeHaptics}.
 * Where nothing can vibrate (iOS Safari has no API; desktops expose it with no
 * motor behind it) every call is a no-op and Settings says so.
 *
 * A tick is at most {@link MAX_TICK_MS} long, and at most
 * {@link MAX_TICKS_PER_SECOND} fire in any one-second window: a burst of
 * detents must never turn into a buzz.
 */

const STORAGE_KEY = 'lupi.haptics';

/** The longest single tick, in ms. */
export const MAX_TICK_MS = 15;
/** Ticks allowed in any sliding one-second window. */
export const MAX_TICKS_PER_SECOND = 10;

function readEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // private mode / blocked storage: off
  }
}

let enabled = readEnabled();
const listeners = new Set<(value: boolean) => void>();
/** Times (ms, performance clock) of the ticks fired in the last second, oldest first. */
const recent: number[] = [];

export function isHapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(value: boolean): void {
  if (value === enabled) return;
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* storage blocked: keep the in-memory value, just don't persist */
  }
  for (const listener of Array.from(listeners)) listener(value);
}

/** Subscribe to enabled-state changes. Returns an unsubscribe fn. */
export function subscribeHaptics(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True where a tick can be felt: the platform exposes the Vibration API and
 * the device has a touch screen. Desktop Chrome and Edge expose
 * `navigator.vibrate` with no motor behind it, so a mouse-only device reports
 * false and Settings says "Not supported on this device" instead of offering a
 * switch that does nothing.
 */
export function isHapticsSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof (navigator as { vibrate?: unknown }).vibrate !== 'function') return false;
  try {
    return typeof matchMedia !== 'function' || matchMedia('(any-pointer: coarse)').matches;
  } catch {
    return true;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * One short vibration tick. A no-op while Haptics is off or unsupported;
 * clamped to {@link MAX_TICK_MS}; dropped past {@link MAX_TICKS_PER_SECOND}
 * in a second. Returns whether a tick was sent. Never throws.
 */
export function tick(ms: number): boolean {
  if (!enabled || !isHapticsSupported()) return false;
  const duration = Math.min(MAX_TICK_MS, Math.max(1, Math.round(Number.isFinite(ms) ? ms : 0)));
  const t = now();
  while (recent.length > 0 && t - recent[0] >= 1000) recent.shift();
  if (recent.length >= MAX_TICKS_PER_SECOND) return false;
  recent.push(t);
  try {
    // Browsers refuse without a user activation; that is fine, it is only a tick.
    navigator.vibrate(duration);
  } catch {
    /* vibration is non-essential feedback */
  }
  return true;
}
