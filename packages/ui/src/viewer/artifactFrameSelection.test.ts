import { describe, expect, it } from 'vitest';
import type { Frame } from '@atlas/core';
import { selectViewerFrames } from './artifactFrameSelection';

function frame(
  timestep: number,
  ids: readonly number[] = [1],
  identity: Frame['identity'] = { kind: 'source-id', unique: true },
): Frame {
  return {
    timestep,
    natoms: ids.length,
    boxBounds: new Float64Array([0, 1, 0, 1, 0, 1]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity,
    ids: new Int32Array(ids),
    types: new Int32Array(ids.map(() => 6)),
    positions: new Float32Array(ids.flatMap((_, index) => [timestep + index, 0, 0])),
    bonds: new Int32Array(),
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

  it('retains interpolation only when source atom IDs have the same order', () => {
    const frames = [frame(0, [10, 20]), frame(1, [10, 20])];

    expect(selectViewerFrames(frames, 0, {
      frameIndex: 0,
      nextFrameIndex: 1,
      interpolationFactor: 0.5,
      isInterpolating: true,
      effectiveFrame: 0.5,
    }, null)).toMatchObject({
      frame: frames[0],
      nextFrame: frames[1],
      interpolationFactor: 0.5,
    });
  });

  it('fails closed instead of interpolating shuffled source atom IDs', () => {
    const frames = [frame(0, [10, 20]), frame(1, [20, 10])];

    expect(selectViewerFrames(frames, 0, {
      frameIndex: 0,
      nextFrameIndex: 1,
      interpolationFactor: 0.5,
      isInterpolating: true,
      effectiveFrame: 0.5,
    }, null)).toMatchObject({
      frame: frames[0],
      nextFrame: undefined,
      interpolationFactor: 0,
    });
  });

  it.each(['synthetic-row', 'unknown'] as const)(
    'fails closed for %s identity even when row IDs happen to match',
    (identityKind) => {
      const frames = [
        frame(0, [10, 20], { kind: identityKind, unique: true }),
        frame(1, [10, 20], { kind: identityKind, unique: true }),
      ];

      expect(selectViewerFrames(frames, 0, {
        frameIndex: 0,
        nextFrameIndex: 1,
        interpolationFactor: 0.5,
        isInterpolating: true,
        effectiveFrame: 0.5,
      }, null)).toMatchObject({
        frame: frames[0],
        nextFrame: undefined,
        interpolationFactor: 0,
      });
    },
  );
});
