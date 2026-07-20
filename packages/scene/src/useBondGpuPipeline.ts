/** React ownership boundary for the optional WebGPU bond pipeline. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BondPipeline, initWebGPU } from '@atlas/renderer';
import type { BondReadback } from '@atlas/renderer';

const GRID_DIM = 32;
const MAX_ATOMS_PER_CELL = 64;
const INITIAL_MAX_ATOMS = 100_000;
const INITIAL_MAX_BONDS = INITIAL_MAX_ATOMS * 12;

function bondsPerAtomFactor(natoms: number): number {
  if (natoms >= 500_000) return 4;
  if (natoms >= 100_000) return 6;
  return 12;
}

function stagingPoolDepth(natoms: number): number {
  return natoms >= 500_000 ? 1 : 3;
}

export interface BondGpuComputeInput {
  positions: Float32Array;
  types: Int32Array;
  natoms: number;
  covalentRadii: Float32Array;
  tolerance: number;
  maxBondLength: number;
  origin?: [number, number, number];
  boxExtent?: number;
}

export interface UseBondGpuPipelineResult {
  ready: boolean;
  unsupported: boolean;
  compute: (input: BondGpuComputeInput) => Promise<BondReadback | null>;
}

interface InitPromise {
  generation: number;
  promise: Promise<boolean>;
}

interface InternalState {
  mounted: boolean;
  enabled: boolean;
  generation: number;
  device: GPUDevice | null;
  pipeline: BondPipeline | null;
  maxAtoms: number;
  maxBonds: number;
  initFailed: boolean;
  initPromise: InitPromise | null;
}

const destroyedDevices = new WeakSet<object>();
const destroyedPipelines = new WeakSet<object>();

function destroyDeviceOnce(device: GPUDevice | null): void {
  if (!device || destroyedDevices.has(device)) return;
  destroyedDevices.add(device);
  device.destroy();
}

function destroyPipelineOnce(pipeline: BondPipeline | null): void {
  if (!pipeline || destroyedPipelines.has(pipeline)) return;
  destroyedPipelines.add(pipeline);
  pipeline.destroy();
}

function ownsGeneration(state: InternalState, generation: number): boolean {
  return state.mounted && state.enabled && state.generation === generation;
}

function invalidateAndDestroy(state: InternalState, generation?: number): void {
  if (generation !== undefined && state.generation !== generation) return;
  if (!state.enabled && !state.device && !state.pipeline && !state.initPromise) return;

  // Invalidate before teardown so every resolving promise immediately sees
  // that it has lost ownership.
  state.generation += 1;
  state.enabled = false;
  const pipeline = state.pipeline;
  const device = state.device;
  state.pipeline = null;
  state.device = null;
  state.maxAtoms = 0;
  state.maxBonds = 0;
  state.initFailed = false;
  state.initPromise = null;

  destroyPipelineOnce(pipeline);
  destroyDeviceOnce(device);
}

function pipelineOptions(device: GPUDevice, maxAtoms: number, maxBonds: number) {
  return {
    device,
    maxAtoms,
    maxBonds,
    gridDimX: GRID_DIM,
    gridDimY: GRID_DIM,
    gridDimZ: GRID_DIM,
    maxAtomsPerCell: MAX_ATOMS_PER_CELL,
    stagingPoolDepth: stagingPoolDepth(maxAtoms),
  };
}

async function ensureInitialized(
  state: InternalState,
  generation: number,
  maxAtoms: number,
  maxBonds: number,
): Promise<boolean> {
  if (!ownsGeneration(state, generation)) return false;
  if (state.pipeline && state.device) return true;
  if (state.initFailed) return false;
  if (state.initPromise?.generation === generation) return state.initPromise.promise;

  const promise = (async () => {
    let result: Awaited<ReturnType<typeof initWebGPU>>;
    try {
      result = await initWebGPU();
    } catch (error) {
      if (ownsGeneration(state, generation)) {
        state.initFailed = true;
        console.warn('[BondPipeline] WebGPU initialization rejected:', error);
      }
      return false;
    }

    if (!result) {
      if (ownsGeneration(state, generation)) state.initFailed = true;
      return false;
    }
    if (!ownsGeneration(state, generation)) {
      destroyDeviceOnce(result.device);
      return false;
    }

    let pipeline: BondPipeline;
    try {
      pipeline = new BondPipeline(pipelineOptions(result.device, maxAtoms, maxBonds));
    } catch (error) {
      destroyDeviceOnce(result.device);
      if (ownsGeneration(state, generation)) {
        state.initFailed = true;
        console.warn('[BondPipeline] construction failed:', error);
      }
      return false;
    }

    if (!ownsGeneration(state, generation)) {
      destroyPipelineOnce(pipeline);
      destroyDeviceOnce(result.device);
      return false;
    }

    state.device = result.device;
    state.pipeline = pipeline;
    state.maxAtoms = maxAtoms;
    state.maxBonds = maxBonds;
    return true;
  })();

  const record = { generation, promise };
  state.initPromise = record;
  try {
    return await promise;
  } finally {
    if (state.initPromise === record) state.initPromise = null;
  }
}

async function growPipeline(
  state: InternalState,
  generation: number,
  newAtomCount: number,
): Promise<boolean> {
  const device = state.device;
  const oldPipeline = state.pipeline;
  const oldMaxAtoms = state.maxAtoms;
  if (!device || !oldPipeline || !ownsGeneration(state, generation)) return false;

  // Yield once so disable/unmount can invalidate a same-task growth request
  // before another large allocation begins.
  await Promise.resolve();
  if (!ownsGeneration(state, generation) || state.device !== device || state.pipeline !== oldPipeline) {
    return false;
  }

  const newMaxAtoms = Math.max(Math.ceil(newAtomCount * 1.5), oldMaxAtoms * 2);
  const newMaxBonds = newMaxAtoms * bondsPerAtomFactor(newAtomCount);
  let replacement: BondPipeline;
  try {
    replacement = new BondPipeline(pipelineOptions(device, newMaxAtoms, newMaxBonds));
  } catch (error) {
    // The old pipeline remains installed and usable.
    if (ownsGeneration(state, generation) && state.pipeline === oldPipeline) {
      console.warn('[BondPipeline] growth failed; keeping the previous capacity:', error);
    }
    return false;
  }

  // Construction is synchronous, but installation is a distinct ownership
  // commit. Give a queued disable/unmount a chance to invalidate between the
  // two; if it does, the uninstalled replacement is ours to destroy.
  await Promise.resolve();
  if (!ownsGeneration(state, generation) || state.device !== device || state.pipeline !== oldPipeline) {
    destroyPipelineOnce(replacement);
    return false;
  }

  // Install before release so the ref never points at a destroyed pipeline.
  state.pipeline = replacement;
  state.maxAtoms = newMaxAtoms;
  state.maxBonds = newMaxBonds;
  destroyPipelineOnce(oldPipeline);
  return true;
}

export function useBondGpuPipeline(enabled: boolean): UseBondGpuPipelineResult {
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const stateRef = useRef<InternalState>({
    mounted: true,
    enabled: false,
    generation: 0,
    device: null,
    pipeline: null,
    maxAtoms: 0,
    maxBonds: 0,
    initFailed: false,
    initPromise: null,
  });

  useEffect(() => {
    const state = stateRef.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      invalidateAndDestroy(state);
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (!enabled) {
      invalidateAndDestroy(state);
      setReady(false);
      setUnsupported(false);
      return;
    }

    state.enabled = true;
    state.initFailed = false;
    state.generation += 1;
    const generation = state.generation;
    setReady(false);
    setUnsupported(false);

    void ensureInitialized(state, generation, INITIAL_MAX_ATOMS, INITIAL_MAX_BONDS).then((ok) => {
      if (!ownsGeneration(state, generation)) return;
      setReady(ok);
      setUnsupported(!ok);
    });

    return () => invalidateAndDestroy(state, generation);
  }, [enabled]);

  const compute = useCallback(async (input: BondGpuComputeInput): Promise<BondReadback | null> => {
    const state = stateRef.current;
    const generation = state.generation;
    if (!ownsGeneration(state, generation)) return null;

    const target = Math.max(input.natoms, INITIAL_MAX_ATOMS);
    const targetBonds = Math.max(target * bondsPerAtomFactor(input.natoms), INITIAL_MAX_BONDS);
    const ok = await ensureInitialized(state, generation, target, targetBonds);
    if (!ownsGeneration(state, generation)) return null;
    if (!ok) {
      setReady(false);
      setUnsupported(true);
      return null;
    }
    setReady(true);
    setUnsupported(false);

    if (input.natoms > state.maxAtoms) {
      const grown = await growPipeline(state, generation, input.natoms);
      if (!grown || !ownsGeneration(state, generation)) return null;
    }

    const pipeline = state.pipeline;
    const device = state.device;
    if (!pipeline || !device) return null;

    const radiiPadded = new Float32Array(128);
    radiiPadded.set(input.covalentRadii.subarray(0, Math.min(input.covalentRadii.length, 128)));
    pipeline.updateElementRadii(radiiPadded);
    pipeline.updatePositions(input.positions, input.types);
    const minCellFromBox = (input.boxExtent ?? 0) / GRID_DIM;
    const cellSize = Math.max(input.maxBondLength, minCellFromBox);
    pipeline.updateConfig(input.natoms, state.maxBonds, input.tolerance, cellSize, input.origin);

    const encoder = device.createCommandEncoder({ label: 'BondPipeline.compute' });
    pipeline.computeBonds(encoder, input.natoms);
    device.queue.submit([encoder.finish()]);

    try {
      const result = await pipeline.readBondsAsync();
      if (!ownsGeneration(state, generation) || state.pipeline !== pipeline || state.device !== device) {
        return null;
      }
      return result;
    } catch (error) {
      // Teardown-caused readback rejection is cancellation. A still-current
      // rejection remains caller-visible.
      if (!ownsGeneration(state, generation) || state.pipeline !== pipeline || state.device !== device) {
        return null;
      }
      throw error;
    }
  }, []);

  return { ready, unsupported, compute };
}
