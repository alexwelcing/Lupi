// @vitest-environment node
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Frame } from '@atlas/core/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fallbackMocks = vi.hoisted(() => ({
  gpuReady: false,
  gpuUnsupported: false,
  gpuCompute: vi.fn(async () => null),
  workerPostMessage: vi.fn(),
  workerTerminate: vi.fn(),
  deliverWorkerMessage: null as ((data: unknown) => void) | null,
}));

vi.mock('./useBondGpuPipeline', () => ({
  useBondGpuPipeline: () => ({
    ready: fallbackMocks.gpuReady,
    unsupported: fallbackMocks.gpuUnsupported,
    compute: fallbackMocks.gpuCompute,
  }),
}));

vi.mock('./bondWorker.ts?worker', () => ({
  default: class MockBondWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;

    constructor() {
      fallbackMocks.deliverWorkerMessage = (data) =>
        this.onmessage?.({ data } as MessageEvent);
    }

    postMessage(message: unknown, transfer: Transferable[]) {
      fallbackMocks.workerPostMessage(message, transfer);
    }

    terminate() {
      fallbackMocks.workerTerminate();
    }
  },
}));

import { Bonds } from './Bonds';

function inferableFrame(): Frame {
  return {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array([0, 4, 0, 4, 0, 4]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity: { kind: 'source-id', unique: true },
    ids: new Int32Array([1, 2]),
    types: new Int32Array([6, 8]),
    typeSemantics: {
      kind: 'atomic-number',
      provenance: 'source-element-symbol',
    },
    distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    positions: new Float32Array([0, 0, 0, 1.2, 0, 0]),
    bonds: new Int32Array(),
    properties: new Map(),
  };
}

describe('bond inference backend fallback', () => {
  beforeEach(() => {
    fallbackMocks.gpuReady = false;
    fallbackMocks.gpuUnsupported = false;
    fallbackMocks.gpuCompute.mockClear();
    fallbackMocks.workerPostMessage.mockClear();
    fallbackMocks.workerTerminate.mockClear();
    fallbackMocks.deliverWorkerMessage = null;
  });

  it('dispatches the unchanged frame to the CPU worker when GPU initialization becomes unsupported', async () => {
    const frame = inferableFrame();
    const onBondsUpdate = vi.fn();
    const render = (hiddenAtomTypes = new Set<number>()) =>
      React.createElement(Bonds, {
        frame,
        useGpu: true,
        inferenceAllowed: true,
        hiddenAtomTypes,
        onBondsUpdate,
      });
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = await ReactThreeTestRenderer.create(render());

    try {
      await vi.waitFor(() =>
        expect(fallbackMocks.gpuCompute).toHaveBeenCalledOnce(),
      );
      expect(fallbackMocks.workerPostMessage).not.toHaveBeenCalled();

      fallbackMocks.gpuUnsupported = true;
      await renderer.update(render());

      await vi.waitFor(() =>
        expect(fallbackMocks.workerPostMessage).toHaveBeenCalledOnce(),
      );
      expect(fallbackMocks.workerPostMessage.mock.calls[0]?.[0]).toMatchObject({
        natoms: 2,
        bonds: null,
      });

      const request = fallbackMocks.workerPostMessage.mock.calls[0]?.[0] as {
        requestId: number;
      };
      fallbackMocks.deliverWorkerMessage?.({
        requestId: request.requestId,
        bondPairs: new Int32Array([0, 1]),
        count: 1,
        distances: new Float32Array([1.2]),
      });
      await vi.waitFor(() =>
        expect(onBondsUpdate).toHaveBeenLastCalledWith({
          source: 'cpu',
          count: 1,
        }),
      );

      await renderer.update(render(new Set([6])));
      await vi.waitFor(() =>
        expect(onBondsUpdate).toHaveBeenLastCalledWith({
          source: 'cpu',
          count: 0,
        }),
      );
    } finally {
      await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});
