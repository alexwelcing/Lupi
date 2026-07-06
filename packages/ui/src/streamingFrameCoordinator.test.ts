// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Frame, Trajectory } from '@atlas/core/types';
import { createMockFrame } from '@atlas/core/test-utils';
import { resetStore } from './test-utils';
import { useStore } from './store';
import {
  clearStreamingFrameCoordinator,
  installStreamingFrameCoordinator,
  requestStreamingFrame,
} from './streamingFrameCoordinator';

function sparseTrajectory(frames: Array<Frame | undefined>): Trajectory {
  return {
    frames: frames as Frame[],
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
    expect(fetchFrame).toHaveBeenCalledWith(1);
    expect(fetchFrame).toHaveBeenCalledWith(2);
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
    expect(fetchFrame).toHaveBeenCalledWith(2);
    expect(fetchFrame).toHaveBeenCalledWith(1);
    expect(state.file?.trajectory.frames[2]).toBe(loaded[2]);
    expect(state.file?.trajectory.frames[1]).toBe(loaded[1]);
  });
});
