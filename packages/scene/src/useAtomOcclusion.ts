/**
 * useAtomOcclusion — off-thread per-atom occlusion for large scenes.
 *
 * Mirrors the Bonds worker pattern: one lazily created Web Worker per hook,
 * a monotonically increasing request id so stale results are discarded, and
 * a short debounce so scrubbing through a trajectory does not queue a job per
 * frame. The previous result stays visible while a new one computes; it is
 * only released when the hook is disabled or the atom count changes.
 */

/// <reference path="./vite-env.d.ts" />
import { useEffect, useRef, useState } from 'react';
import type { Frame } from '@atlas/core/types';
import OcclusionWorkerCtor from './occlusionWorker.ts?worker';

export interface UseAtomOcclusionOptions {
  enabled: boolean;
  /** Kernel radius in the frame's distance units (see suggestOcclusionRadius). */
  radius: number;
  /** Debounce before dispatch, ms. */
  debounceMs?: number;
}

interface OcclusionWorkerOutput {
  requestId: number;
  occlusion: Uint8Array;
  referenceDensity: number;
}

export function useAtomOcclusion(
  frame: Frame | null | undefined,
  { enabled, radius, debounceMs = 120 }: UseAtomOcclusionOptions,
): Uint8Array | null {
  const [occlusion, setOcclusion] = useState<Uint8Array | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const resultAtomCountRef = useRef(0);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !frame || frame.natoms < 2 || !(radius > 0)) {
      requestRef.current += 1;
      resultAtomCountRef.current = 0;
      setOcclusion((previous) => (previous === null ? previous : null));
      return;
    }
    if (resultAtomCountRef.current !== frame.natoms) {
      // A different system: drop the stale map immediately rather than
      // painting one molecule's occlusion onto another.
      resultAtomCountRef.current = 0;
      setOcclusion((previous) => (previous === null ? previous : null));
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const natoms = frame.natoms;
    const positions = frame.positions;

    const timer = setTimeout(() => {
      let worker = workerRef.current;
      if (!worker) {
        try {
          worker = new OcclusionWorkerCtor();
        } catch (error) {
          console.warn('[AtomOcclusion] worker unavailable:', error);
          return;
        }
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<OcclusionWorkerOutput>) => {
          const { requestId: resultId, occlusion: result } = event.data;
          if (resultId !== requestRef.current) return;
          const map = result instanceof Uint8Array ? result : new Uint8Array(result);
          resultAtomCountRef.current = map.length;
          setOcclusion(map);
        };
        worker.onerror = (event) => {
          console.warn('[AtomOcclusion] worker failed:', event.message);
        };
      }
      // The renderer shares the frame's positions; hand the worker a copy it
      // can own outright (transferred, zero-copy on the receiving side).
      const copy = new Float32Array(positions.subarray(0, natoms * 3));
      worker.postMessage({ requestId, positions: copy, natoms, radius }, [copy.buffer]);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [enabled, frame, radius, debounceMs]);

  return enabled ? occlusion : null;
}
