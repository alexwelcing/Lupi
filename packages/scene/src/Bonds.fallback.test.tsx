import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer/webgpu';
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

import type * as THREE from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { Bonds } from './Bonds';
import { BOND_ATTR, BOND_COLOR_STRIDE } from './tsl/bondImpostorMaterial';
import { getLupiUniforms } from './tsl/lupiUniforms';

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

      // The bond drawn by the node material: Uint8x4 normalized endpoint
      // colours and no itemSize-1 8/16-bit attribute (D4).
      const bondMesh = renderer.scene.findByType('Mesh').instance as THREE.Mesh<
        THREE.InstancedBufferGeometry,
        MeshBasicNodeMaterial
      >;
      expect(bondMesh.geometry.instanceCount).toBe(1);
      expect(getLupiUniforms(bondMesh.material)?.uProgress).toBeDefined();
      for (const name of [BOND_ATTR.colorStart, BOND_ATTR.colorEnd]) {
        const colors = bondMesh.geometry.attributes[name];
        expect(colors.array).toBeInstanceOf(Uint8Array);
        expect(colors.itemSize).toBe(BOND_COLOR_STRIDE);
        expect(colors.normalized).toBe(true);
        expect(colors.array[3]).toBe(255);
      }
      const narrow = Object.entries(bondMesh.geometry.attributes).filter(([, attribute]) =>
        attribute.itemSize === 1 && !(attribute.array instanceof Float32Array));
      expect(narrow.map(([name]) => name)).toEqual([]);

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

  it('reports the drawn bonds to the picker, collapsing a stale inferred pair, and null once none are drawn', async () => {
    const frame = inferableFrame();
    const reports: unknown[] = [];
    const onDrawnBonds = vi.fn((bonds: unknown) => {
      reports.push(bonds);
    });
    const render = (current: Frame, hiddenAtomTypes = new Set<number>()) =>
      React.createElement(Bonds, {
        frame: current,
        inferenceAllowed: true,
        hiddenAtomTypes,
        onDrawnBonds,
      });
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = await ReactThreeTestRenderer.create(render(frame));
    try {
      await vi.waitFor(() => expect(fallbackMocks.workerPostMessage).toHaveBeenCalled());
      expect(reports.at(-1)).toBeNull();
      const request = fallbackMocks.workerPostMessage.mock.calls.at(-1)?.[0] as { requestId: number };
      fallbackMocks.deliverWorkerMessage?.({
        requestId: request.requestId,
        bondPairs: new Int32Array([0, 1]),
        count: 1,
        distances: new Float32Array([1.2]),
      });
      await vi.waitFor(() => expect(reports.at(-1)).not.toBeNull());
      const drawn = reports.at(-1) as { pairs: Int32Array; radius: number; radii: Float32Array | null; fadeEnd: number };
      expect(Array.from(drawn.pairs)).toEqual([0, 1]);
      expect(drawn.radius).toBe(0.12);
      expect(Array.from(drawn.radii ?? [])).toEqual([Math.fround(0.12)]);
      expect(drawn.fadeEnd).toBe(200);

      // The same pair on a frame where the atoms moved apart: drawn collapsed.
      const apart: Frame = { ...frame, positions: new Float32Array([0, 0, 0, 3.5, 0, 0]) };
      await renderer.update(render(apart));
      await vi.waitFor(() => {
        const last = reports.at(-1) as { radii: Float32Array | null } | null;
        expect(last && Array.from(last.radii ?? [])).toEqual([0]);
      });

      await renderer.update(render(frame, new Set([6])));
      await vi.waitFor(() => expect(reports.at(-1)).toBeNull());
    } finally {
      await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
    expect(reports.at(-1)).toBeNull();
  });
});
