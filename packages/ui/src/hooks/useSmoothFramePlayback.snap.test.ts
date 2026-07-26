import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSmoothFramePlayback } from './useSmoothFramePlayback';

const frames = [
  { positions: new Float32Array([0, 0, 0]) },
  { positions: new Float32Array([1, 0, 0]) },
  { positions: new Float32Array([2, 0, 0]) },
  { positions: new Float32Array([3, 0, 0]) },
  { positions: new Float32Array([4, 0, 0]) },
] as never[];

describe('useSmoothFramePlayback snapToIntegers (NEB-discrete playback)', () => {
  it('snaps effectiveFrame to integers — NEB images never interpolate', () => {
    const { result } = renderHook(() =>
      useSmoothFramePlayback(false, { frames, snapToIntegers: true, onFrame: () => {} }),
    );
    act(() => {
      result.current.setFrame(2.4);
    });
    expect(result.current.currentState.frameIndex).toBe(2);
    expect(result.current.currentState.interpolationFactor).toBe(0);
    expect(result.current.currentState.isInterpolating).toBe(false);
    expect(result.current.currentState.effectiveFrame).toBe(2);
  });

  it('rounds to the nearest image for fractional input', () => {
    const { result } = renderHook(() =>
      useSmoothFramePlayback(false, { frames, snapToIntegers: true, onFrame: () => {} }),
    );
    act(() => {
      result.current.setFrame(2.6);
    });
    expect(result.current.currentState.frameIndex).toBe(3);
    expect(result.current.currentState.effectiveFrame).toBe(3);
  });

  it('preserves smooth interpolation when snapToIntegers is false (default)', () => {
    const { result } = renderHook(() =>
      useSmoothFramePlayback(false, { frames, onFrame: () => {} }),
    );
    act(() => {
      result.current.setFrame(2.4);
    });
    expect(result.current.currentState.frameIndex).toBe(2);
    expect(result.current.currentState.interpolationFactor).toBeCloseTo(0.4);
    expect(result.current.currentState.isInterpolating).toBe(true);
  });
});
