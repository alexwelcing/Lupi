/**
 * useAtomOcclusion / useAtomClusters — off-thread large-scene analysis.
 *
 * Mirrors the Bonds worker pattern: one lazily created Web Worker per hook,
 * a monotonically increasing request id so stale results are discarded, and
 * a short debounce so scrubbing through a trajectory does not queue a job per
 * frame. The previous result stays visible while a new one computes; it is
 * only released when the hook is disabled or the atom count changes.
 */

/// <reference path="./vite-env.d.ts" />
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Frame } from '@atlas/core/types';
import type { Clusters } from './ClusterBuilder';
import {
  CONTACT_OCCLUSION_MAX_ATOMS,
  CONTACT_OCCLUSION_SYNC_ATOMS,
  computeContactOcclusion,
  type ContactOcclusionBake,
} from './atomContactOcclusion';
import SceneAnalysisWorkerCtor from './occlusionWorker.ts?worker';

export interface UseAtomOcclusionOptions {
  enabled: boolean;
  /** Kernel radius in the frame's distance units (see suggestOcclusionRadius). */
  radius: number;
  /** Debounce before dispatch, ms. */
  debounceMs?: number;
}

export interface UseAtomClustersOptions {
  enabled: boolean;
  mobile?: boolean;
  hiddenAtomTypes?: ReadonlySet<number>;
  debounceMs?: number;
}

interface WorkerResult {
  kind: 'occlusion' | 'clusters' | 'contact';
  requestId: number;
  occlusion?: Uint8Array;
  clusters?: Clusters;
  contact?: ContactOcclusionBake;
}

/**
 * Shared lifecycle for one worker-backed analysis job. `buildMessage`
 * returns the request payload and transfer list, `pick` extracts the result.
 */
function useSceneAnalysisJob<T>(
  frame: Frame | null | undefined,
  enabled: boolean,
  dependencyKey: string,
  debounceMs: number,
  buildMessage: (frame: Frame, requestId: number) => { message: Record<string, unknown>; transfer: ArrayBuffer[] } | null,
  pick: (result: WorkerResult) => T | null,
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const resultAtomCountRef = useRef(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !frame || frame.natoms < 2) {
      requestRef.current += 1;
      resultAtomCountRef.current = 0;
      setValue((previous) => (previous === null ? previous : null));
      return;
    }
    if (resultAtomCountRef.current !== frame.natoms) {
      // A different system: drop the stale result immediately rather than
      // painting one molecule's analysis onto another.
      resultAtomCountRef.current = 0;
      setValue((previous) => (previous === null ? previous : null));
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const natoms = frame.natoms;

    const timer = setTimeout(() => {
      let worker = workerRef.current;
      if (!worker) {
        try {
          worker = new SceneAnalysisWorkerCtor();
        } catch (error) {
          console.warn('[SceneAnalysis] worker unavailable:', error);
          return;
        }
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<WorkerResult>) => {
          if (event.data.requestId !== requestRef.current) return;
          const picked = pickRef.current(event.data);
          if (picked === null) return;
          resultAtomCountRef.current = natoms;
          setValue(picked);
        };
        worker.onerror = (event) => {
          console.warn('[SceneAnalysis] worker failed:', event.message);
        };
      }
      const built = buildMessage(frame, requestId);
      if (!built) return;
      worker.postMessage(built.message, built.transfer);
    }, debounceMs);

    return () => clearTimeout(timer);
    // dependencyKey folds the option values that affect the job; buildMessage
    // and pick are read through the latest closure/ref on dispatch.
  }, [enabled, frame, debounceMs, dependencyKey]);

  return enabled ? value : null;
}

export function useAtomOcclusion(
  frame: Frame | null | undefined,
  { enabled, radius, debounceMs = 120 }: UseAtomOcclusionOptions,
): Uint8Array | null {
  return useSceneAnalysisJob<Uint8Array>(
    frame,
    enabled && radius > 0,
    String(radius),
    debounceMs,
    (source, requestId) => {
      // The renderer shares the frame's positions; hand the worker a copy it
      // can own outright (transferred, zero-copy on the receiving side).
      const positions = new Float32Array(source.positions.subarray(0, source.natoms * 3));
      return {
        message: { kind: 'occlusion', requestId, positions, natoms: source.natoms, radius },
        transfer: [positions.buffer],
      };
    },
    (result) => (result.kind === 'occlusion' && result.occlusion ? result.occlusion : null),
  );
}

export function useAtomClusters(
  frame: Frame | null | undefined,
  { enabled, mobile = false, hiddenAtomTypes, debounceMs = 60 }: UseAtomClustersOptions,
): Clusters | null {
  const hiddenKey = hiddenAtomTypes ? Array.from(hiddenAtomTypes).sort((a, b) => a - b).join(',') : '';
  return useSceneAnalysisJob<Clusters>(
    frame,
    enabled,
    `${mobile ? 'm' : 'd'}|${hiddenKey}`,
    debounceMs,
    (source, requestId) => {
      const positions = new Float32Array(source.positions.subarray(0, source.natoms * 3));
      const types = new Int32Array(source.types.subarray(0, source.natoms));
      return {
        message: {
          kind: 'clusters',
          requestId,
          positions,
          types,
          natoms: source.natoms,
          boxBounds: source.boxBounds ? new Float64Array(source.boxBounds) : null,
          typeSemantics: source.typeSemantics ?? null,
          distanceSemantics: source.distanceSemantics ?? null,
          mobile,
          hiddenAtomTypes: hiddenKey ? hiddenKey.split(',').map(Number) : [],
        },
        transfer: [positions.buffer, types.buffer],
      };
    },
    (result) => (result.kind === 'clusters' && result.clusters ? result.clusters : null),
  );
}

export interface UseContactOcclusionOptions {
  enabled: boolean;
  /** Neighbour search radius (see suggestContactRange). */
  range: number;
  debounceMs?: number;
}

export interface ContactOcclusionState {
  /** The bake for the source frame, or the last one while a new one computes. */
  bake: ContactOcclusionBake | null;
  /**
   * True while the bake for the current source frame has not arrived yet.
   * Deterministic exports wait on it (the atom layer withholds its receipt).
   */
  pending: boolean;
}

/**
 * Contact occlusion (atomContactOcclusion.ts) for `frame`: synchronous up to
 * CONTACT_OCCLUSION_SYNC_ATOMS (the first frame already has it, and an export
 * never waits), in the scene-analysis worker up to
 * CONTACT_OCCLUSION_MAX_ATOMS, off above. Pass an undefined frame while a
 * trajectory plays: the last bake stays (the look does not pop), and the
 * paused frame re-bakes.
 */
export function useContactOcclusion(
  frame: Frame | null | undefined,
  { enabled, range, debounceMs = 60 }: UseContactOcclusionOptions,
): ContactOcclusionState {
  const natoms = frame?.natoms ?? 0;
  const active = enabled && range > 0;
  const sync = active && Boolean(frame) && natoms >= 2 && natoms <= CONTACT_OCCLUSION_SYNC_ATOMS;
  const viaWorker = active && Boolean(frame) && natoms > CONTACT_OCCLUSION_SYNC_ATOMS && natoms <= CONTACT_OCCLUSION_MAX_ATOMS;

  const syncBake = useMemo(
    () => (sync && frame ? computeContactOcclusion({ positions: frame.positions, natoms: frame.natoms, range }) : null),
    [sync, frame, range],
  );

  const requestFrames = useRef(new Map<number, Frame>());
  const workerResult = useSceneAnalysisJob<{ bake: ContactOcclusionBake; frame: Frame | null }>(
    frame,
    viaWorker,
    String(range),
    debounceMs,
    (source, requestId) => {
      requestFrames.current.clear();
      requestFrames.current.set(requestId, source);
      const positions = new Float32Array(source.positions.subarray(0, source.natoms * 3));
      return {
        message: { kind: 'contact', requestId, positions, natoms: source.natoms, range },
        transfer: [positions.buffer],
      };
    },
    (result) => (result.kind === 'contact' && result.contact
      ? { bake: result.contact, frame: requestFrames.current.get(result.requestId) ?? null }
      : null),
  );

  // While playing (no source frame) keep the last bake of the same system.
  const lastRef = useRef<ContactOcclusionBake | null>(null);
  let bake: ContactOcclusionBake | null = null;
  let pending = false;
  if (!enabled || range <= 0) {
    lastRef.current = null;
  } else if (frame) {
    if (sync) bake = syncBake;
    else if (viaWorker) {
      bake = workerResult?.bake ?? null;
      pending = workerResult?.frame !== frame;
      if (bake && bake.natoms !== natoms) bake = null;
      // While the new frame bakes, keep the last bake of the same system on
      // screen (no pop); `pending` still holds exports back.
      if (!bake && lastRef.current?.natoms === natoms) bake = lastRef.current;
    }
    if (bake) lastRef.current = bake;
    else if (!viaWorker) lastRef.current = null;
  } else {
    bake = lastRef.current;
  }
  return { bake, pending };
}
