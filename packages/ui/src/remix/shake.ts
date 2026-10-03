/**
 * shake.ts — shake the phone to roll a Remix.
 *
 * Off until the visitor turns it on in the Remix sheet, and only offered on
 * touch devices that report motion. iOS asks for permission
 * (`DeviceMotionEvent.requestPermission`), which only works inside a tap: the
 * sheet's switch is that tap, and on a later visit the first tap anywhere
 * re-arms it (Safari remembers the answer). A refusal leaves the switch on
 * "Not allowed" and nothing listens.
 *
 * The detector wants a real shake, not a bump or a walk: three jolts above
 * 13 m/s² (gravity removed) within 0.9 s, then a 1.2 s rest before the next
 * roll. It ignores motion while the tab is hidden or a text field has focus.
 */
import { remixStore, type ShakeState } from './remixStore';

/** Linear acceleration (m/s²) a jolt must pass. */
const JOLT = 13;
/** Jolts closer than this are one jolt (ms). */
const JOLT_GAP_MS = 90;
/** This many jolts within the window make a shake. */
const JOLTS = 3;
const WINDOW_MS = 900;
/** After a roll, shakes are ignored this long (ms). */
const COOLDOWN_MS = 1200;

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied' | 'default'> };

function motionApi(): (typeof DeviceMotionEvent & PermissionApi) | null {
  if (typeof window === 'undefined' || typeof (window as { DeviceMotionEvent?: unknown }).DeviceMotionEvent === 'undefined') return null;
  return window.DeviceMotionEvent as typeof DeviceMotionEvent & PermissionApi;
}

/** Offered only where it can work: a touch device that reports motion. */
export function shakeSupported(): boolean {
  if (!motionApi()) return false;
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** iOS: motion needs a permission asked inside a tap. */
export function shakeNeedsPermission(): boolean {
  return typeof motionApi()?.requestPermission === 'function';
}

let onShake: (() => void) | null = null;
let listening = false;
let jolts: number[] = [];
let lastJolt = -Infinity;
let restUntil = 0;
const gravity = { x: 0, y: 0, z: 0, primed: false };

function typing(): boolean {
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (!active) return false;
  return active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT';
}

function onMotion(event: DeviceMotionEvent): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  let x = 0;
  let y = 0;
  let z = 0;
  const linear = event.acceleration;
  if (linear && linear.x !== null && linear.y !== null && linear.z !== null) {
    x = linear.x;
    y = linear.y;
    z = linear.z;
  } else {
    const raw = event.accelerationIncludingGravity;
    if (!raw || raw.x === null || raw.y === null || raw.z === null) return;
    // A low-pass estimate of gravity, taken away.
    if (!gravity.primed) {
      gravity.x = raw.x;
      gravity.y = raw.y;
      gravity.z = raw.z;
      gravity.primed = true;
    }
    gravity.x = gravity.x * 0.85 + raw.x * 0.15;
    gravity.y = gravity.y * 0.85 + raw.y * 0.15;
    gravity.z = gravity.z * 0.85 + raw.z * 0.15;
    x = raw.x - gravity.x;
    y = raw.y - gravity.y;
    z = raw.z - gravity.z;
  }
  const t = performance.now();
  if (t < restUntil || Math.hypot(x, y, z) < JOLT || t - lastJolt < JOLT_GAP_MS) return;
  lastJolt = t;
  jolts = jolts.filter((at) => t - at < WINDOW_MS);
  jolts.push(t);
  if (jolts.length < JOLTS || typing()) return;
  jolts = [];
  restUntil = t + COOLDOWN_MS;
  onShake?.();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('devicemotion', onMotion);
  listening = true;
}

function unlisten(): void {
  if (!listening || typeof window === 'undefined') return;
  window.removeEventListener('devicemotion', onMotion);
  listening = false;
  jolts = [];
  gravity.primed = false;
}

/** What a shake does (the Remix driver sets it); null stops calling. */
export function setShakeHandler(handler: (() => void) | null): void {
  onShake = handler;
}

/**
 * Turn shake to roll on. Call it inside a tap: iOS asks for permission here.
 * Resolves to the new state.
 */
export async function enableShake(): Promise<ShakeState> {
  const store = remixStore.getState();
  store.setShakePreferred(true);
  const api = motionApi();
  if (!api || !shakeSupported()) {
    store.setShake('unsupported');
    return 'unsupported';
  }
  if (typeof api.requestPermission === 'function') {
    try {
      const answer = await api.requestPermission();
      if (answer !== 'granted') {
        unlisten();
        store.setShake('denied');
        return 'denied';
      }
    } catch {
      // Not inside a tap (or blocked): wait for the next tap to ask.
      store.setShake('arming');
      return 'arming';
    }
  }
  listen();
  store.setShake('on');
  return 'on';
}

/** Turn shake to roll off (and forget the preference). */
export function disableShake(): void {
  unlisten();
  remixStore.getState().setShakePreferred(false);
  remixStore.getState().setShake('off');
}

/**
 * On a visit after the visitor turned it on: listen at once where no
 * permission is needed, else re-arm on the first tap. Returns the cleanup.
 */
export function resumeShake(): () => void {
  const store = remixStore.getState();
  if (!store.shakePreferred || typeof window === 'undefined') return () => {};
  if (!shakeSupported()) {
    store.setShake('unsupported');
    return () => {};
  }
  if (!shakeNeedsPermission()) {
    listen();
    store.setShake('on');
    return () => unlisten();
  }
  store.setShake('arming');
  const onTap = () => {
    window.removeEventListener('pointerup', onTap, true);
    void enableShake();
  };
  window.addEventListener('pointerup', onTap, true);
  return () => {
    window.removeEventListener('pointerup', onTap, true);
    unlisten();
  };
}
