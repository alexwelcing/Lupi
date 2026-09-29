/**
 * comfort.ts — the viewer's motion comfort level (Settings → Motion).
 *
 * - `standard`: coasts, arrivals, ripples and animated glides.
 * - `gentle`: no coast, half-strength display motion, glides still animate.
 * - `still`: nothing moves on its own; glides become cuts.
 *
 * Modelled on lib/clickSound.ts: module state (hot paths read a plain value,
 * no React), persisted to localStorage 'lupi.motion'. With nothing stored it
 * follows the OS `prefers-reduced-motion` setting live. Comfort never enters
 * buildStateDelta, URLs or saved views.
 *
 * Contract file: additive edits only.
 */
import { useSyncExternalStore } from 'react';

export type Comfort = 'standard' | 'gentle' | 'still';

const STORAGE_KEY = 'lupi.motion';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function isComfort(value: unknown): value is Comfort {
  return value === 'standard' || value === 'gentle' || value === 'still';
}

function readStored(): Comfort | null {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return isComfort(value) ? value : null;
  } catch {
    return null; // blocked storage: follow the OS setting
  }
}

function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  } catch {
    return null;
  }
}

let stored: Comfort | null = readStored();
const listeners = new Set<(comfort: Comfort) => void>();
let mediaQuery: MediaQueryList | null = null;
let lastNotified: Comfort | null = null;

export function getComfort(): Comfort {
  if (stored) return stored;
  return reducedMotionQuery()?.matches ? 'still' : 'standard';
}

function notify(): void {
  const comfort = getComfort();
  if (comfort === lastNotified) return;
  lastNotified = comfort;
  for (const listener of Array.from(listeners)) {
    try {
      listener(comfort);
    } catch (error) {
      console.error('[lupi] comfort listener threw', error);
    }
  }
}

function onMediaChange(): void {
  if (!stored) notify();
}

export function setComfort(comfort: Comfort): void {
  stored = comfort;
  try {
    localStorage.setItem(STORAGE_KEY, comfort);
  } catch {
    /* storage blocked: keep the in-memory value */
  }
  notify();
}

/** Subscribe to comfort changes (including OS reduced-motion changes while nothing is stored). */
export function subscribeComfort(listener: (comfort: Comfort) => void): () => void {
  if (listeners.size === 0) {
    lastNotified = getComfort();
    mediaQuery = reducedMotionQuery();
    mediaQuery?.addEventListener?.('change', onMediaChange);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      mediaQuery?.removeEventListener?.('change', onMediaChange);
      mediaQuery = null;
    }
  };
}

export function useComfort(): Comfort {
  return useSyncExternalStore(subscribeComfort, getComfort, () => 'standard');
}

/** Flicks keep coasting after release. */
export const coastEnabled = (comfort: Comfort = getComfort()): boolean => comfort === 'standard';
/** Camera glides animate (otherwise they cut). */
export const glidesAnimate = (comfort: Comfort = getComfort()): boolean => comfort !== 'still';
/** Scale for display-only motion amplitudes. */
export const displayMotionScale = (comfort: Comfort = getComfort()): 1 | 0.5 | 0 =>
  comfort === 'standard' ? 1 : comfort === 'gentle' ? 0.5 : 0;
