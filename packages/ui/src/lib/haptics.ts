/**
 * Haptics — a light vibration tick for toy feedback (detents, catches, flips,
 * resets), through `navigator.vibrate`.
 *
 * Opt-in and OFF by default, like the click sound (lib/clickSound.ts): state is
 * module-local (the hot path reads a plain boolean, no React), persisted to
 * localStorage 'lupi.haptics', and observable via {@link subscribeHaptics}.
 * Where the platform has no vibration (iOS Safari, most desktops that lack the
 * API) every call is a no-op and Settings says so.
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

/** True where the platform exposes the Vibration API. */
export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as { vibrate?: unknown }).vibrate === 'function';
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
