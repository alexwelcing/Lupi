import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core';
import { selectViewerFrames } from './artifactFrameSelection';

function frame(timestep: number): Frame {
  return {
    timestep,
    natoms: 1,
    boxBounds: new Float64Array([0, 1, 0, 1, 0, 1]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1]),
    types: new Int32Array([6]),
    positions: new Float32Array([timestep, 0, 0]),
    properties: new Map(),
  };
}

describe('artifact frame selection', () => {
  it('freezes an addressed integer frame despite stale fractional playback state', () => {
    const frames = [frame(0), frame(1), frame(2)];
    const selection = selectViewerFrames(frames, 2, {
      frameIndex: 0,
      nextFrameIndex: 1,
      interpolationFactor: 0.75,
      isInterpolating: true,
      effectiveFrame: 0.75,
    }, 2);

    expect(selection).toEqual({
      frame: frames[2],
      nextFrame: undefined,
      interpolationFactor: 0,
      frameKey: 2,
    });
  });

  it('keeps an evicted addressed frame absent instead of substituting playback data', () => {
    const frames = [frame(0), undefined, frame(2)];
    expect(selectViewerFrames(frames, 0, {
      frameIndex: 0,
      nextFrameIndex: 2,
      interpolationFactor: 0.5,
      isInterpolating: true,
      effectiveFrame: 0.5,
    }, 1)).toEqual({
      frame: undefined,
      nextFrame: undefined,
      interpolationFactor: 0,
      frameKey: 1,
    });
  });
});
