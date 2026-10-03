/**
 * toyTape.ts — the Play layer's toys as inputs another view can replay.
 *
 * PlayLayer announces each toy input here as it happens (a poke, a stirred
 * ripple, a burst, a tug's grab, pull and release, heat on, rubbed and off, a
 * scatter, a reset), in world coordinates of the loaded file, and registers
 * a sink that plays the same inputs back. Instant Replay records the first
 * and drives the second; the toys themselves stay where they are.
 *
 * Amplitudes are recorded at Standard strength: the receiving view applies
 * its own Motion comfort (Gentle halves, Still plays nothing).
 */
import type { Vec3 } from '../camera/rigApi';

export type ToyEvent =
  | { kind: 'poke'; atom: number }
  | { kind: 'ripple'; point: Vec3; amplitude: number }
  | { kind: 'burst'; point: Vec3 }
  | { kind: 'tugGrab'; atom: number; point: Vec3 }
  | { kind: 'tugPull'; d: Vec3 }
  | { kind: 'tugRelease' }
  | { kind: 'heatOn' }
  | { kind: 'heatOff' }
  | { kind: 'heatRub'; amount: number }
  | { kind: 'scatter'; seed: number }
  | { kind: 'reset' };

/** Plays toy inputs back on the mounted Play layer. */
export interface ToyReplaySink {
  play(event: ToyEvent): void;
}

const listeners = new Set<(event: ToyEvent) => void>();
let sink: ToyReplaySink | null = null;

/** Called by PlayLayer as each toy input happens. */
export function emitToyEvent(event: ToyEvent): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (error) {
      console.error('[lupi] toy event listener threw', error);
    }
  }
}

export function onToyEvent(listener: (event: ToyEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** PlayLayer registers its sink while mounted; returns the unregister. */
export function registerToyReplaySink(next: ToyReplaySink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

export function getToyReplaySink(): ToyReplaySink | null {
  return sink;
}
