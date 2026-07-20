// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Frame, Trajectory } from '@atlas/core/types';
import { createMockFrame } from '@atlas/core/test-utils';
import { resetStore } from './test-utils';
import { useStore } from './store';
import {
  clearStreamingFrameCoordinator,
  DEFAULT_STREAMING_RESIDENT_BYTES,
  estimateFrameResidentBytes,
  installStreamingFrameCoordinator,
  requestStreamingFrame,
} from './streamingFrameCoordinator';

function sparseTrajectory(frames: Array<Frame | undefined>): Trajectory {
  return {
    frames,
    totalFrames: frames.length,
    atomTypes: [1, 2],
    globalBounds: {
      min: [0, 0, 0],
      max: [10, 10, 10],
    },
  };
}

async function flushAsyncWork() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('streamingFrameCoordinator', () => {
  beforeEach(() => {
    resetStore();
    clearStreamingFrameCoordinator();
  });

  afterEach(() => {
    clearStreamingFrameCoordinator();
  });

  it('warms missing startup frames into a sparse trajectory', async () => {
    const loaded = [
      createMockFrame({ timestep: 0 }),
      createMockFrame({ timestep: 1 }),
      createMockFrame({ timestep: 2 }),
    ];
    useStore.getState().setFile({
      name: 'demo.glimbin',
      size: 1024,
      trajectory: sparseTrajectory([loaded[0], undefined, undefined]),
      thermo: null,
      sourceUrl: 'https://example.test/demo.glimbin',
    });

    const fetchFrame = vi.fn(async (frameIndex: number) => loaded[frameIndex]!);
    installStreamingFrameCoordinator(
      { fetchFrame },
      {
        label: 'test-streaming',
        sourceUrl: 'https://example.test/demo.glimbin',
        initialLookahead: 2,
      },
    );

    await flushAsyncWork();

    const frames = useStore.getState().file?.trajectory.frames;
    expect(fetchFrame).toHaveBeenCalledWith(1, expect.anything());
    expect(fetchFrame).toHaveBeenCalledWith(2, expect.anything());
    expect(frames?.[1]).toBe(loaded[1]);
    expect(frames?.[2]).toBe(loaded[2]);
  });

  it('requests explicit buffered frames without moving the store playhead', async () => {
    const loaded = [
      createMockFrame({ timestep: 0 }),
      createMockFrame({ timestep: 1 }),
      createMockFrame({ timestep: 2 }),
    ];
    useStore.getState().setFile({
      name: 'scrub.glimbin',
      size: 1024,
      trajectory: sparseTrajectory([loaded[0], undefined, undefined]),
      thermo: null,
      sourceUrl: 'https://example.test/scrub.glimbin',
    });

    const fetchFrame = vi.fn(async (frameIndex: number) => loaded[frameIndex]!);
    installStreamingFrameCoordinator(
      { fetchFrame },
      {
        label: 'test-streaming',
        sourceUrl: 'https://example.test/scrub.glimbin',
        initialLookahead: 0,
      },
    );

    requestStreamingFrame(2, -1, 1);
    await flushAsyncWork();

    const state = useStore.getState();
    expect(state.frame).toBe(0);
    expect(fetchFrame).toHaveBeenCalledWith(2, expect.anything());
    expect(fetchFrame).toHaveBeenCalledWith(1, expect.anything());
    expect(state.file?.trajectory.frames[2]).toBe(loaded[2]);
    expect(state.file?.trajectory.frames[1]).toBe(loaded[1]);
  });

  it('keeps store and source-cache ownership within one aggregate resident budget', async () => {
    const loaded = Array.from({ length: 12 }, (_, timestep) => createMockFrame({ timestep }));
    useStore.getState().setFile({
      name: 'soak.glimbin',
      size: 4096,
      trajectory: sparseTrajectory([loaded[0], ...new Array(11)]),
      thermo: null,
      sourceUrl: 'https://example.test/soak.glimbin',
    });

    const sourceCache = new Set<number>([0]);
    const fetchFrame = vi.fn(async (frameIndex: number) => {
      sourceCache.add(frameIndex);
      return loaded[frameIndex]!;
    });
    const releaseFrame = vi.fn((frameIndex: number) => sourceCache.delete(frameIndex));
    installStreamingFrameCoordinator(
      { fetchFrame, releaseFrame },
      {
        label: 'bounded-soak',
        sourceUrl: 'https://example.test/soak.glimbin',
        initialLookahead: 0,
        idleLookahead: 0,
        playbackLookahead: 0,
        maxResidentFrames: 4,
      },
    );

    for (let frameIndex = 1; frameIndex < loaded.length; frameIndex += 1) {
      requestStreamingFrame(frameIndex, 1, 0);
      await flushAsyncWork();
      const slots = useStore.getState().file!.trajectory.frames;
      const residentIndices = slots.flatMap((frame, index) => frame ? [index] : []);
      expect(residentIndices.length).toBeLessThanOrEqual(4);
      expect(sourceCache.size).toBeLessThanOrEqual(4);
      expect(Array.from(sourceCache).sort((a, b) => a - b)).toEqual(residentIndices);
    }

    expect(useStore.getState().file?.trajectory.frames[1]).toBeUndefined();
    requestStreamingFrame(1, -1, 0);
    await flushAsyncWork();
    expect(useStore.getState().file?.trajectory.frames[1]).toBe(loaded[1]);
    expect(fetchFrame.mock.calls.filter(([index]) => index === 1)).toHaveLength(2);
    expect(releaseFrame).toHaveBeenCalled();
  });

  it('evicts an over-budget initial sparse store immediately', () => {
    const loaded = Array.from({ length: 6 }, (_, timestep) => createMockFrame({ timestep }));
    useStore.getState().setFile({
      name: 'preloaded.glimbin',
      size: 2048,
      trajectory: sparseTrajectory(loaded),
      thermo: null,
      sourceUrl: 'https://example.test/preloaded.glimbin',
    });
    const releaseFrame = vi.fn();

    installStreamingFrameCoordinator(
      { fetchFrame: vi.fn(async (index: number) => loaded[index]!), releaseFrame },
      {
        label: 'preloaded-budget',
        sourceUrl: 'https://example.test/preloaded.glimbin',
        initialLookahead: 0,
        maxResidentFrames: 3,
      },
    );

    const trajectory = useStore.getState().file!.trajectory;
    expect(trajectory.frames.filter(Boolean)).toHaveLength(3);
    expect(trajectory.frames[0]).toBe(loaded[0]);
    expect(trajectory.residency).toEqual({
      mode: 'sparse',
      maxResidentFrames: 3,
      maxResidentBytes: DEFAULT_STREAMING_RESIDENT_BYTES,
    });
    expect(releaseFrame).toHaveBeenCalledTimes(3);
  });

  it('aborts obsolete directional lookahead without reporting it as a data failure', async () => {
    const loaded = Array.from({ length: 8 }, (_, timestep) => createMockFrame({ timestep }));
    useStore.getState().setFile({
      name: 'direction.glimbin',
      size: 4096,
      trajectory: sparseTrajectory([loaded[0], ...new Array(7)]),
      thermo: null,
      sourceUrl: 'https://example.test/direction.glimbin',
    });

    const aborted: number[] = [];
    const fetchFrame = vi.fn((frameIndex: number, signal?: AbortSignal) => {
      if (frameIndex >= 5) return Promise.resolve(loaded[frameIndex]!);
      return new Promise<Frame>((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted.push(frameIndex);
          reject(new DOMException('The operation was aborted', 'AbortError'));
        }, { once: true });
        void resolve;
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    installStreamingFrameCoordinator(
      { fetchFrame },
      {
        label: 'direction-cancel',
        sourceUrl: 'https://example.test/direction.glimbin',
        initialLookahead: 2,
        maxResidentFrames: 5,
      },
    );
    requestStreamingFrame(5, 1, 1);
    await flushAsyncWork();
    await flushAsyncWork();

    expect(aborted.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(useStore.getState().file?.trajectory.frames[1]).toBeUndefined();
    expect(useStore.getState().file?.trajectory.frames[2]).toBeUndefined();
    expect(useStore.getState().file?.trajectory.frames[5]).toBe(loaded[5]);
    expect(useStore.getState().file?.trajectory.frames[6]).toBe(loaded[6]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([5_000, 250_000])(
    'bounds the aggregate scientific payload for %i-atom frames',
    async (natoms) => {
      const makeSizedFrame = (timestep: number): Frame => ({
        timestep,
        natoms,
        boxBounds: new Float64Array([0, 100, 0, 100, 0, 100]),
        boxTilt: new Float64Array(3),
        triclinic: false,
        columns: ['id', 'type', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
        ids: new Int32Array(natoms),
        types: new Int32Array(natoms),
        positions: new Float32Array(natoms * 3),
        bonds: new Int32Array(0),
        properties: new Map([
          ['vx', new Float32Array(natoms)],
          ['vy', new Float32Array(natoms)],
          ['vz', new Float32Array(natoms)],
        ]),
      });
      const scientificBytes = (frame: Frame) => (
        frame.ids.byteLength + frame.types.byteLength + frame.positions.byteLength +
        frame.bonds.byteLength + Array.from(frame.properties.values())
          .reduce((total, values) => total + values.byteLength, 0)
      );

      const frame0 = makeSizedFrame(0);
      const slots = new Array<Frame | undefined>(8);
      slots[0] = frame0;
      useStore.getState().setFile({
        name: `payload-${natoms}.glimbin`,
        size: scientificBytes(frame0) * slots.length,
        trajectory: sparseTrajectory(slots),
        thermo: null,
        sourceUrl: `https://example.test/payload-${natoms}.glimbin`,
      });

      const sourceCache = new Map<number, Frame>([[0, frame0]]);
      const fetchCounts = new Map<number, number>();
      const fetchFrame = async (frameIndex: number) => {
        fetchCounts.set(frameIndex, (fetchCounts.get(frameIndex) ?? 0) + 1);
        const frame = makeSizedFrame(frameIndex);
        sourceCache.set(frameIndex, frame);
        return frame;
      };
      const releaseFrame = (frameIndex: number) => {
        sourceCache.delete(frameIndex);
      };
      installStreamingFrameCoordinator(
        { fetchFrame, releaseFrame },
        {
          label: `payload-${natoms}`,
          sourceUrl: `https://example.test/payload-${natoms}.glimbin`,
          initialLookahead: 0,
          maxResidentFrames: 3,
        },
      );

      const perFrameBytes = scientificBytes(frame0);
      for (let frameIndex = 1; frameIndex < slots.length; frameIndex += 1) {
        requestStreamingFrame(frameIndex, 1, 0);
        await flushAsyncWork();
        const uniqueFrames = new Set<Frame>();
        for (const frame of useStore.getState().file!.trajectory.frames) {
          if (frame) uniqueFrames.add(frame);
        }
        for (const frame of sourceCache.values()) uniqueFrames.add(frame);
        const residentBytes = Array.from(uniqueFrames)
          .reduce((total, frame) => total + scientificBytes(frame), 0);
        expect(uniqueFrames.size).toBeLessThanOrEqual(3);
        expect(residentBytes).toBeLessThanOrEqual(perFrameBytes * 3);
      }

      expect(useStore.getState().file?.trajectory.frames[1]).toBeUndefined();
      requestStreamingFrame(1, -1, 0);
      await flushAsyncWork();
      expect(fetchCounts.get(1)).toBe(2);
    },
    30_000,
  );

  it('enforces a scientific-byte budget independently of the frame-count cap', async () => {
    const natoms = 250_000;
    const makeSizedFrame = (timestep: number): Frame => ({
      timestep,
      natoms,
      boxBounds: new Float64Array([0, 100, 0, 100, 0, 100]),
      boxTilt: new Float64Array(3),
      triclinic: false,
      columns: ['id', 'type', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
      ids: new Int32Array(natoms),
      types: new Int32Array(natoms),
      positions: new Float32Array(natoms * 3),
      bonds: new Int32Array(0),
      properties: new Map([
        ['vx', new Float32Array(natoms)],
        ['vy', new Float32Array(natoms)],
        ['vz', new Float32Array(natoms)],
      ]),
    });
    const frame0 = makeSizedFrame(0);
    const perFrameBytes = estimateFrameResidentBytes(frame0);
    const maxResidentBytes = perFrameBytes * 3;
    const slots = new Array<Frame | undefined>(10);
    slots[0] = frame0;
    useStore.getState().setFile({
      name: 'byte-budget.glimbin',
      size: perFrameBytes * slots.length,
      trajectory: sparseTrajectory(slots),
      thermo: null,
      sourceUrl: 'https://example.test/byte-budget.glimbin',
    });

    const sourceCache = new Map<number, Frame>([[0, frame0]]);
    installStreamingFrameCoordinator(
      {
        fetchFrame: async (frameIndex) => {
          const frame = makeSizedFrame(frameIndex);
          sourceCache.set(frameIndex, frame);
          return frame;
        },
        releaseFrame: (frameIndex) => sourceCache.delete(frameIndex),
      },
      {
        label: 'byte-budget',
        sourceUrl: 'https://example.test/byte-budget.glimbin',
        initialLookahead: 0,
        maxResidentFrames: 20,
        maxResidentBytes,
      },
    );

    for (let frameIndex = 1; frameIndex < slots.length; frameIndex += 1) {
      requestStreamingFrame(frameIndex, 1, 6);
      await flushAsyncWork();
      const resident = useStore.getState().file!.trajectory.frames.filter(
        (frame): frame is Frame => Boolean(frame),
      );
      expect(resident.length).toBeLessThanOrEqual(3);
      expect(resident.reduce(
        (total, frame) => total + estimateFrameResidentBytes(frame),
        0,
      )).toBeLessThanOrEqual(maxResidentBytes);
      expect(sourceCache.size).toBeLessThanOrEqual(3);
    }

    expect(useStore.getState().file?.trajectory.residency).toEqual({
      mode: 'sparse',
      maxResidentFrames: 20,
      maxResidentBytes,
    });
  }, 30_000);

  it('counts a shared ArrayBuffer once in the resident-byte estimate', () => {
    const shared = new ArrayBuffer(256);
    const frame: Frame = {
      timestep: 0,
      natoms: 8,
      boxBounds: new Float64Array(0),
      boxTilt: new Float64Array(0),
      triclinic: false,
      columns: ['id', 'type', 'x', 'y', 'z'],
      ids: new Int32Array(shared, 0, 8),
      types: new Int32Array(shared, 32, 8),
      positions: new Float32Array(shared, 64, 24),
      bonds: new Int32Array(shared, 160, 0),
      properties: new Map([['shared', new Float32Array(shared, 160, 24)]]),
    };

    expect(estimateFrameResidentBytes(frame)).toBe(shared.byteLength);
  });
});
