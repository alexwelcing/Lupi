import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Frame } from '@atlas/core/types';
import {
  advancePlaybackFrame,
  useSmoothFramePlayback,
  type PlaybackLoopMode,
} from './useSmoothFramePlayback';

function frames(count: number): Frame[] {
  return Array.from({ length: count }, () => ({}) as Frame);
}

describe('advancePlaybackFrame', () => {
  it('keeps the last-frame interval in loop mode and wraps by totalFrames', () => {
    expect(advancePlaybackFrame(3.5, 1, 'loop', 1, 5)).toMatchObject({
      effectiveFrame: 4.5,
      direction: 1,
      ended: false,
    });
    expect(advancePlaybackFrame(4.5, 0.75, 'loop', 1, 5).effectiveFrame).toBeCloseTo(0.25);
  });

  it('reflects exact bounce endpoints with the next correct direction', () => {
    expect(advancePlaybackFrame(3, 1, 'bounce', 1, 5)).toEqual({
      effectiveFrame: 4,
      direction: -1,
      ended: false,
    });
    expect(advancePlaybackFrame(1, 1, 'bounce', -1, 5)).toEqual({
      effectiveFrame: 0,
      direction: 1,
      ended: false,
    });
  });

  it('preserves arbitrary multi-boundary bounce overshoot', () => {
    // Five frames have triangle-wave period eight. 1 + 19 lands at phase 4.
    expect(advancePlaybackFrame(1, 19, 'bounce', 1, 5)).toEqual({
      effectiveFrame: 4,
      direction: -1,
      ended: false,
    });
    expect(advancePlaybackFrame(4, 13, 'bounce', -1, 5)).toEqual({
      effectiveFrame: 1,
      direction: 1,
      ended: false,
    });
  });

  it('handles two-frame bounce as a true ping-pong', () => {
    const atEnd = advancePlaybackFrame(0, 1, 'bounce', 1, 2);
    expect(atEnd).toEqual({ effectiveFrame: 1, direction: -1, ended: false });
    expect(advancePlaybackFrame(atEnd.effectiveFrame, 1, 'bounce', atEnd.direction, 2)).toEqual({
      effectiveFrame: 0,
      direction: 1,
      ended: false,
    });
  });

  it('pins zero/one-frame inputs without modulo or negative indices', () => {
    expect(advancePlaybackFrame(99, 12, 'loop', -1, 0)).toEqual({
      effectiveFrame: 0,
      direction: 1,
      ended: false,
    });
    expect(advancePlaybackFrame(-4, 12, 'once', -1, 1)).toEqual({
      effectiveFrame: 0,
      direction: 1,
      ended: true,
    });
  });

  it('clamps once mode and reports completion', () => {
    expect(advancePlaybackFrame(1.5, 10, 'once', -1, 4)).toEqual({
      effectiveFrame: 3,
      direction: 1,
      ended: true,
    });
  });
});

describe('useSmoothFramePlayback', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  function tick(time: number) {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(time);
  }

  beforeEach(() => {
    callbacks = new Map();
    nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId++;
      callbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)));
  });

  afterEach(() => vi.unstubAllGlobals());

  function setup(initial: {
    isPlaying?: boolean;
    frameSet?: Frame[];
    loopMode?: PlaybackLoopMode;
  } = {}) {
    const onFrame = vi.fn();
    const onPlaybackEnd = vi.fn();
    const initialProps = {
      isPlaying: initial.isPlaying ?? true,
      frameSet: initial.frameSet ?? frames(5),
      loopMode: initial.loopMode ?? 'loop' as PlaybackLoopMode,
    };
    const hook = renderHook(
      ({ isPlaying, frameSet, loopMode }) => useSmoothFramePlayback(isPlaying, {
        frames: frameSet,
        speed: 1,
        mdFrameRate: 1,
        stateSyncFPS: 120,
        loopMode,
        onFrame,
        onPlaybackEnd,
      }),
      { initialProps },
    );
    return { ...hook, onFrame, onPlaybackEnd, props: initialProps };
  }

  it('ends once playback and schedules no additional RAF', () => {
    const { onFrame, onPlaybackEnd } = setup({ frameSet: frames(3), loopMode: 'once' });
    act(() => tick(0));
    expect(callbacks.size).toBe(1);
    act(() => tick(2500));

    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveFrame: 2 }));
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });

  it('completes once immediately for a single-frame trajectory without RAF', () => {
    const { onPlaybackEnd } = setup({ frameSet: frames(1), loopMode: 'once' });
    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });

  it('resets direction on explicit frame set and playback restart', () => {
    const { result, rerender, onFrame, props } = setup({ loopMode: 'bounce' });
    act(() => tick(0));
    act(() => tick(4500)); // frame 3.5, travelling backward after the endpoint
    act(() => result.current.setFrame(1));
    rerender({ ...props, isPlaying: false });
    rerender({ ...props, isPlaying: true });
    act(() => tick(5000));
    act(() => tick(5500));

    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveFrame: 1.5 }));
  });

  it('resets reverse bounce direction when trajectory identity changes', () => {
    const { rerender, onFrame, props } = setup({ loopMode: 'bounce' });
    act(() => tick(0));
    act(() => tick(4500));
    const replacement = frames(5);
    rerender({ ...props, frameSet: replacement });
    act(() => tick(5000));

    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveFrame: 4 }));
  });

  it.each(['loop', 'once'] as const)('resets reverse direction when switching bounce to %s', (mode) => {
    const { rerender, onFrame, props } = setup({ loopMode: 'bounce' });
    act(() => tick(0));
    act(() => tick(4500)); // effective 3.5, reverse
    rerender({ ...props, loopMode: mode });
    act(() => tick(5000));

    const expected = mode === 'loop' ? 4 : 4;
    expect(onFrame).toHaveBeenLastCalledWith(expect.objectContaining({ effectiveFrame: expected }));
  });

  it('keeps manual controls safe for empty and single-frame trajectories', () => {
    const empty = setup({ isPlaying: false, frameSet: frames(0) });
    act(() => {
      empty.result.current.setFrame(4);
      empty.result.current.nextFrame();
      empty.result.current.prevFrame();
    });
    expect(empty.result.current.currentState).toMatchObject({ frameIndex: 0, effectiveFrame: 0 });
    expect(empty.onFrame).not.toHaveBeenCalled();
    empty.unmount();

    const single = setup({ isPlaying: false, frameSet: frames(1), loopMode: 'bounce' });
    act(() => {
      single.result.current.nextFrame();
      single.result.current.prevFrame();
    });
    expect(single.result.current.currentState).toMatchObject({ frameIndex: 0, effectiveFrame: 0 });
    expect(single.onFrame).toHaveBeenCalledTimes(2);
  });
});
