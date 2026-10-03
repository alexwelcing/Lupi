/**
 * frameDemand.ts — Quiet Idle: the viewer draws only when something changed.
 *
 * The viewer canvas runs fiber's `demand` frameloop. A demand root draws only
 * when invalidated, so everything that changes what is on screen asks for
 * frames here (or through fiber's own `invalidate`):
 *
 * - `requestLupiFrames()` — something just changed (a store write, an async
 *   upload, a gesture, a resize): draw at least `frames` more frames and keep
 *   drawing for a short settle window, so layout effects, post-commit effects
 *   and GPU uploads that land right after the change are drawn too.
 * - `keepLupiAwake(name, isActive)` — an animator (the camera rig, display
 *   motion, playback, a fade): polled once per drawn frame; while any returns
 *   true the loop keeps going. A keeper is only polled while the loop runs,
 *   so whatever starts an animation also calls `requestLupiFrames()`.
 * - Ambient keepers (`{ ambient: true }`, e.g. a drifting procedural sky)
 *   keep the loop going at FRAME_DEMAND.ambientFps instead of the display
 *   rate when nothing else needs frames.
 *
 * `driveLupiFrameDemand()` is the per-frame driver: the viewer runs it in a
 * `finish` job (LUPI_JOB.frameDemand) and invalidates its root when it
 * returns true. `lupiFrameStats()` reports what the loop is doing
 * (`window.__lupiPlay.state().frames` and `.frameDemand`).
 *
 * Fiber facts this relies on (@pmndrs/scheduler 0.2.0):
 * - `invalidate(frames)` replaces a root's pending count, so this module
 *   keeps its own budget and asks for one frame at a time.
 * - A job that invalidates while its frame runs keeps the loop alive for the
 *   next frame (pending frames are consumed before jobs run).
 * - After a sleep, the first frame's delta is clamped to the last frame's, so
 *   delta-driven animators never jump.
 */
import { useLayoutEffect } from 'react';
import { invalidate } from '@react-three/fiber/webgpu';

export const FRAME_DEMAND = {
  /** Frames a plain request guarantees. */
  frames: 2,
  /** How long (ms) a request keeps the loop running after the change. */
  settleMs: 160,
  /** The cadence of ambient-only motion (a drifting background). */
  ambientFps: 24,
} as const;

export interface LupiKeepAwakeOptions {
  /** Ambient motion: draw at FRAME_DEMAND.ambientFps when nothing else needs frames. */
  ambient?: boolean;
}

interface Keeper {
  name: string;
  active: () => boolean;
  ambient: boolean;
}

export interface LupiFrameStats {
  /** Frames the viewer has drawn since the page loaded (all canvases that run the driver). */
  rendered: number;
  /** Will the loop draw another frame on its own? */
  awake: boolean;
  /** What kept the last frame's loop going ('request', 'settle', keeper names). Empty at rest. */
  awakeBy: string[];
  /** Milliseconds since the last drawn frame; -1 before the first. */
  lastFrameAgoMs: number;
  /** Requests since the page loaded. */
  requests: number;
}

const keepers = new Set<Keeper>();
const demand = {
  owed: 0,
  until: 0,
  rendered: 0,
  requests: 0,
  lastFrameAt: -1,
  awake: false,
  awakeBy: [] as string[],
  ambientTimer: null as ReturnType<typeof setTimeout> | null,
};

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clearAmbientTimer(): void {
  if (demand.ambientTimer !== null) {
    clearTimeout(demand.ambientTimer);
    demand.ambientTimer = null;
  }
}

/**
 * Something changed: draw at least `frames` more frames (now), and keep
 * drawing for `settleMs`. Safe to call from anywhere, any number of times,
 * with or without a canvas; it never takes frames away.
 */
export function requestLupiFrames(frames: number = FRAME_DEMAND.frames, settleMs: number = FRAME_DEMAND.settleMs): void {
  demand.requests += 1;
  if (Number.isFinite(frames) && frames > demand.owed) demand.owed = Math.min(600, Math.ceil(frames));
  if (Number.isFinite(settleMs) && settleMs > 0) demand.until = Math.max(demand.until, now() + settleMs);
  clearAmbientTimer();
  demand.awake = true;
  invalidate();
}

/**
 * Keep the loop drawing while `isActive()` returns true (polled once per
 * drawn frame). Registering requests frames, so a keeper that is already
 * active starts the loop. Returns the unregister.
 */
export function keepLupiAwake(name: string, isActive: () => boolean, options: LupiKeepAwakeOptions = {}): () => void {
  const keeper: Keeper = { name, active: isActive, ambient: options.ambient === true };
  keepers.add(keeper);
  requestLupiFrames(1, 0);
  return () => {
    keepers.delete(keeper);
  };
}

function isActive(keeper: Keeper): boolean {
  try {
    return keeper.active() === true;
  } catch (error) {
    console.error(`[lupi] frame keeper '${keeper.name}' threw`, error);
    keepers.delete(keeper);
    return false;
  }
}

/**
 * The per-frame driver. Counts the drawn frame and returns true when the next
 * frame is due now (the caller invalidates its root). Ambient-only motion
 * schedules its own next frame at FRAME_DEMAND.ambientFps and returns false.
 */
export function driveLupiFrameDemand(): boolean {
  const t = now();
  demand.rendered += 1;
  demand.lastFrameAt = t;
  if (demand.owed > 0) demand.owed -= 1;
  const reasons: string[] = [];
  if (demand.owed > 0) reasons.push('request');
  else if (t < demand.until) reasons.push('settle');
  let continuous = reasons.length > 0;
  let ambient = false;
  for (const keeper of keepers) {
    if (!isActive(keeper)) continue;
    reasons.push(keeper.name);
    if (keeper.ambient) ambient = true;
    else continuous = true;
  }
  demand.awakeBy = reasons;
  clearAmbientTimer();
  if (continuous) {
    demand.awake = true;
    return true;
  }
  if (ambient) {
    demand.awake = true;
    demand.ambientTimer = setTimeout(() => {
      demand.ambientTimer = null;
      invalidate();
    }, 1000 / FRAME_DEMAND.ambientFps);
    return false;
  }
  demand.awake = false;
  return false;
}

/** Stop a pending ambient frame (the canvas is going away). */
export function stopLupiFrameDemand(): void {
  clearAmbientTimer();
  demand.awake = false;
  demand.awakeBy = [];
}

export function lupiFrameStats(): LupiFrameStats {
  return {
    rendered: demand.rendered,
    awake: demand.awake,
    awakeBy: [...demand.awakeBy],
    lastFrameAgoMs: demand.lastFrameAt < 0 ? -1 : Math.round(now() - demand.lastFrameAt),
    requests: demand.requests,
  };
}

/**
 * Request frames on every commit of the calling component. For scene layers
 * whose commits write uniforms, attributes or textures imperatively (fiber
 * invalidates on its own only when it applies props to three objects): an
 * async result (worker bonds, the GPU bond readback, occlusion) re-renders
 * the layer, and the write is drawn.
 */
export function useLupiCommitFrames(): void {
  useLayoutEffect(() => {
    requestLupiFrames();
  });
}
