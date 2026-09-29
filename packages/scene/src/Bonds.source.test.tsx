import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer/webgpu';
import type { Frame } from '@atlas/core/types';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sourceMocks = vi.hoisted(() => ({
  workerConstructed: vi.fn(),
  workerPostMessage: vi.fn(),
  workerTerminated: vi.fn(),
  deliver: null as ((data: unknown) => void) | null,
  gpuCompute: vi.fn(async () => null),
}));

vi.mock('./useBondGpuPipeline', () => ({
  useBondGpuPipeline: () => ({ ready: false, unsupported: false, compute: sourceMocks.gpuCompute }),
}));

vi.mock('./bondWorker.ts?worker', () => ({
  default: class InferenceWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor() {
      sourceMocks.workerConstructed();
      sourceMocks.deliver = (data) => this.onmessage?.({ data } as MessageEvent);
    }
    postMessage(message: unknown) { sourceMocks.workerPostMessage(message); }
    terminate() { sourceMocks.workerTerminated(); }
  },
}));

import { Bonds } from './Bonds';

function sourceFrame(bonds = new Int32Array([0, 2])): Frame {
  return {
    timestep: 0, natoms: 3, triclinic: false,
    boxBounds: new Float64Array([-1, 4, -1, 1, -1, 1]),
    boxTilt: new Float64Array(3),
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([4, 8, 12]),
    identity: { kind: 'source-id', unique: true },
    types: new Int32Array([6, 8, 7]),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics: { kind: 'unknown', provenance: 'legacy-unknown' },
    positions: new Float32Array([0, 0, 0, 0.9, 0, 0, 3, 0, 0]),
    bonds,
    properties: new Map(),
  };
}

describe('source topology without inference workers', () => {
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    sourceMocks.workerConstructed.mockClear();
    sourceMocks.workerPostMessage.mockClear();
    sourceMocks.workerTerminated.mockClear();
    sourceMocks.gpuCompute.mockClear();
    sourceMocks.deliver = null;
  });

  afterEach(() => { reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

  it('draws the exact validated source connection despite a tiny inference cutoff and no physical units', async () => {
    const frame = sourceFrame();
    const onBondsUpdate = vi.fn();
    const render = (hiddenAtomTypes = new Set<number>()) => React.createElement(Bonds, {
      frame, inferenceAllowed: false, maxBondLength: 0.01, hiddenAtomTypes, onBondsUpdate,
    });
    const renderer = await ReactThreeTestRenderer.create(render());
    try {
      await vi.waitFor(() => expect(onBondsUpdate).toHaveBeenLastCalledWith({ source: 'cpu', count: 1 }));
      expect(sourceMocks.workerConstructed).not.toHaveBeenCalled();
      expect(sourceMocks.workerPostMessage).not.toHaveBeenCalled();
      expect(sourceMocks.gpuCompute).not.toHaveBeenCalled();
      const mesh = renderer.scene.findByType('Mesh').instance as THREE.Mesh<THREE.InstancedBufferGeometry>;
      expect(mesh.geometry.instanceCount).toBe(1);
      expect(Array.from(frame.bonds)).toEqual([0, 2]);

      await renderer.update(render(new Set([7])));
      await vi.waitFor(() => expect(onBondsUpdate).toHaveBeenLastCalledWith({ source: 'cpu', count: 0 }));
      expect(sourceMocks.workerConstructed).not.toHaveBeenCalled();
    } finally {
      await renderer.unmount();
    }
  });

  it('keeps empty source-only topology empty without starting a worker', async () => {
    const onBondsUpdate = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(React.createElement(Bonds, {
      frame: sourceFrame(new Int32Array(0)), inferenceAllowed: false, onBondsUpdate,
    }));
    try {
      await vi.waitFor(() => expect(onBondsUpdate).toHaveBeenLastCalledWith({ source: 'none', count: 0 }));
      expect(sourceMocks.workerConstructed).not.toHaveBeenCalled();
      expect(sourceMocks.workerPostMessage).not.toHaveBeenCalled();
      expect(sourceMocks.gpuCompute).not.toHaveBeenCalled();
    } finally {
      await renderer.unmount();
    }
  });

  it('rejects a late inference reply after switching to a source topology', async () => {
    const inferred = sourceFrame(new Int32Array(0));
    inferred.distanceSemantics = { kind: 'angstrom', provenance: 'source-declared' };
    const onBondsUpdate = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(React.createElement(Bonds, {
      frame: inferred, inferenceAllowed: true, onBondsUpdate,
    }));
    try {
      await vi.waitFor(() => expect(sourceMocks.workerPostMessage).toHaveBeenCalledOnce());
      const request = sourceMocks.workerPostMessage.mock.calls[0][0] as { requestId: number };
      const oldDeliver = sourceMocks.deliver;
      await renderer.update(React.createElement(Bonds, {
        frame: sourceFrame(), inferenceAllowed: false, onBondsUpdate,
      }));
      await vi.waitFor(() => expect(onBondsUpdate).toHaveBeenLastCalledWith({ source: 'cpu', count: 1 }));
      expect(sourceMocks.workerTerminated).toHaveBeenCalledOnce();
      oldDeliver?.({ requestId: request.requestId, bondPairs: new Int32Array([0, 1, 1, 2]), distances: new Float32Array([0.9, 2.1]) });
      await renderer.update(React.createElement(Bonds, {
        frame: sourceFrame(), inferenceAllowed: false, onBondsUpdate,
      }));
      expect(onBondsUpdate).toHaveBeenLastCalledWith({ source: 'cpu', count: 1 });
      expect(sourceMocks.workerConstructed).toHaveBeenCalledOnce();
    } finally {
      await renderer.unmount();
    }
  });
});
