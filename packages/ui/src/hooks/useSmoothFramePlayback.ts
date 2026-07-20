/**
 * useSmoothFramePlayback — Smooth interpolated playback between MD frames
 * 
 * Provides interpolated frame positions for butter-smooth playback
 * even when MD data is sparse (e.g., 1 frame every 1000 steps).
 * 
 * Features:
 * - Linear interpolation between MD frames
 * - Display-synced animation (requestAnimationFrame)
 * - Variable playback speeds
 * - Loop/bounce modes
 * - Statistics reporting
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { Frame } from '@atlas/core/types';

export type PlaybackLoopMode = 'loop' | 'bounce' | 'once';
export type PlaybackDirection = 1 | -1;

interface SmoothPlaybackOptions {
  /** Array of MD frames */
  frames: Array<Frame | undefined>;
  /** Initial playback speed (1.0 = real-time) */
  speed?: number;
  /** Target display rate (fps) */
  targetFPS?: number;
  /** MD source frame rate (fps) - default 30 */
  mdFrameRate?: number;
  /** React state sync rate for visual interpolation. Keep this low for huge
   *  datasets, but raise it for small cinematic trajectories where every
   *  generated subframe is part of the story. */
  stateSyncFPS?: number;
  /** Playback mode */
  loopMode?: PlaybackLoopMode;
  /** Return false for streamed frames that are not resident yet. */
  isFrameReady?: (frameIndex: number) => boolean;
  /** Called when playback reaches a streamed frame that needs buffering. */
  onFrameNeeded?: (frameIndex: number) => void;
  /** Called with interpolated frame data */
  onFrame: (state: InterpolatedFrameState) => void;
  /** Optional stats callback */
  onStats?: (stats: PlaybackStats) => void;
  /** Called exactly once when `once` playback reaches its terminal frame. */
  onPlaybackEnd?: () => void;
}

export interface InterpolatedFrameState {
  /** Current MD frame index */
  frameIndex: number;
  /** Next MD frame index (for interpolation) */
  nextFrameIndex: number;
  /** Interpolation factor: 0.0 = current, 1.0 = next */
  interpolationFactor: number;
  /** Whether we're currently interpolating (vs on exact frame) */
  isInterpolating: boolean;
  /** Current effective frame number (can be fractional) */
  effectiveFrame: number;
}

export interface PlaybackStats {
  /** Actual playback FPS */
  actualFPS: number;
  /** Number of MD frames advanced */
  framesAdvanced: number;
  /** Time spent in interpolation (ms) */
  interpolationTime: number;
}

export interface PlaybackAdvance {
  effectiveFrame: number;
  direction: PlaybackDirection;
  ended: boolean;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Advance a fractional trajectory playhead without losing overshoot.
 * Bounce is evaluated as a triangle wave, so one large delayed RAF tick has
 * the same result as many small ticks across any number of boundaries.
 */
export function advancePlaybackFrame(
  current: number,
  delta: number,
  mode: PlaybackLoopMode,
  direction: PlaybackDirection,
  totalFrames: number,
): PlaybackAdvance {
  const count = Number.isFinite(totalFrames) ? Math.max(0, Math.floor(totalFrames)) : 0;
  if (count <= 1) {
    return { effectiveFrame: 0, direction: 1, ended: mode === 'once' };
  }

  const safeCurrent = Number.isFinite(current) ? current : 0;
  const distance = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const lastIndex = count - 1;

  if (mode === 'loop') {
    return {
      effectiveFrame: positiveModulo(safeCurrent + distance, count),
      direction: 1,
      ended: false,
    };
  }

  if (mode === 'once') {
    const effectiveFrame = Math.min(lastIndex, Math.max(0, safeCurrent) + distance);
    return { effectiveFrame, direction: 1, ended: effectiveFrame >= lastIndex };
  }

  const period = 2 * lastIndex;
  const clampedCurrent = Math.max(0, Math.min(lastIndex, safeCurrent));
  const phase = direction === 1 ? clampedCurrent : period - clampedCurrent;
  const phaseInPeriod = positiveModulo(phase + distance, period);
  const effectiveFrame = lastIndex - Math.abs(phaseInPeriod - lastIndex);
  const nextDirection: PlaybackDirection = phaseInPeriod === 0 || phaseInPeriod < lastIndex ? 1 : -1;
  return { effectiveFrame, direction: nextDirection, ended: false };
}

function stateForEffectiveFrame(effectiveFrame: number, totalFrames: number): InterpolatedFrameState {
  if (totalFrames <= 1) {
    return {
      frameIndex: 0,
      nextFrameIndex: 0,
      interpolationFactor: 0,
      isInterpolating: false,
      effectiveFrame: 0,
    };
  }

  const lastIndex = totalFrames - 1;
  const safeEffective = Math.max(0, Math.min(totalFrames, effectiveFrame));
  const frameIndex = Math.min(lastIndex, Math.floor(safeEffective));
  const nextFrameIndex = Math.min(frameIndex + 1, lastIndex);
  const interpolationFactor = nextFrameIndex === frameIndex ? 0 : safeEffective - frameIndex;
  return {
    frameIndex,
    nextFrameIndex,
    interpolationFactor,
    isInterpolating: nextFrameIndex !== frameIndex && interpolationFactor > 0,
    effectiveFrame: safeEffective,
  };
}

function manualStep(
  currentFrame: number,
  step: PlaybackDirection,
  mode: PlaybackLoopMode,
  totalFrames: number,
): number {
  if (totalFrames <= 1) return 0;
  const lastIndex = totalFrames - 1;
  const current = Math.max(0, Math.min(lastIndex, Math.floor(currentFrame)));
  if (step === 1) {
    if (current < lastIndex) return current + 1;
    if (mode === 'loop') return 0;
    if (mode === 'bounce') return Math.max(0, lastIndex - 1);
    return lastIndex;
  }
  if (current > 0) return current - 1;
  if (mode === 'bounce') return Math.min(lastIndex, 1);
  if (mode === 'loop') return lastIndex;
  return 0;
}

export function useSmoothFramePlayback(
  isPlaying: boolean,
  options: SmoothPlaybackOptions
) {
  const {
    frames,
    speed = 1.0,
    loopMode = 'loop',
    onFrame,
    onStats,
    onPlaybackEnd,
    isFrameReady,
    onFrameNeeded,
    stateSyncFPS = 15,
  } = options;

  // Playback state — use ref for hot path, state only for UI sync
  const stateRef = useRef<InterpolatedFrameState>(stateForEffectiveFrame(0, frames.length));
  const [currentState, setCurrentState] = useState<InterpolatedFrameState>(stateRef.current);
  const directionRef = useRef<PlaybackDirection>(1);

  // RAF refs
  const rafIdRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const wasPlayingRef = useRef(false);
  const previousFramesRef = useRef(frames);
  const previousFrameCountRef = useRef(frames.length);
  const previousLoopModeRef = useRef(loopMode);
  const completionNotifiedRef = useRef(false);

  // Stats refs
  const frameCountRef = useRef(0);
  const lastStatsTimeRef = useRef(0);
  const totalInterpolationTimeRef = useRef(0);
  // PERF: Throttle React state sync by default; small cinematic artifacts
  // can opt into 120fps visual sync without changing the global viewer cost.
  const lastUISyncRef = useRef(0);

  // Frame timing based on MD data
  // Assume frames are evenly spaced in simulation time
  const mdFrameTime = 1000 / (options.mdFrameRate ?? 30); // ms per MD frame

  const loop = useCallback((time: number) => {
    if (lastTimeRef.current === undefined) {
      lastTimeRef.current = time;
    }

    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;

    // Fractional frames to advance based on elapsed wall-time, speed, and desired target MD framerate
    const effectiveDeltaFrames = (delta * speed) / mdFrameTime;
    
    if (effectiveDeltaFrames > 0) {
      const start = performance.now();

      // PERF: Update ref directly — no React setState in the hot loop
      const prev = stateRef.current;
      const totalFrames = frames.length;
      const advanced = advancePlaybackFrame(
        prev.effectiveFrame,
        effectiveDeltaFrames,
        loopMode,
        directionRef.current,
        totalFrames,
      );
      const state = stateForEffectiveFrame(advanced.effectiveFrame, totalFrames);

      const frameReady = isFrameReady?.(state.frameIndex) ?? true;
      const nextReady = state.isInterpolating
        ? (isFrameReady?.(state.nextFrameIndex) ?? true)
        : true;

      if (!frameReady || !nextReady) {
        onFrameNeeded?.(!frameReady ? state.frameIndex : state.nextFrameIndex);
        const heldIndex = Math.max(0, Math.min(prev.frameIndex, totalFrames - 1));
        const heldState: InterpolatedFrameState = {
          frameIndex: heldIndex,
          nextFrameIndex: heldIndex,
          interpolationFactor: 0,
          isInterpolating: false,
          effectiveFrame: heldIndex,
        };
        stateRef.current = heldState;

        const stateSyncInterval = 1000 / Math.max(1, stateSyncFPS);
        if (time - lastUISyncRef.current >= stateSyncInterval) {
          setCurrentState(heldState);
          lastUISyncRef.current = time;
        }
        totalInterpolationTimeRef.current += performance.now() - start;
        rafIdRef.current = requestAnimationFrame(loop);
        return;
      }

      directionRef.current = advanced.direction;
      stateRef.current = state;
      onFrame(state);

      const stateSyncInterval = 1000 / Math.max(1, stateSyncFPS);
      if (advanced.ended || time - lastUISyncRef.current >= stateSyncInterval) {
        setCurrentState(state);
        lastUISyncRef.current = time;
      }

      totalInterpolationTimeRef.current += performance.now() - start;
      frameCountRef.current++;

      if (advanced.ended) {
        rafIdRef.current = undefined;
        if (!completionNotifiedRef.current) {
          completionNotifiedRef.current = true;
          onPlaybackEnd?.();
        }
        return;
      }
    }

    // Stats reporting
    if (onStats && time - lastStatsTimeRef.current >= 1000) {
      const elapsed = (time - lastStatsTimeRef.current) / 1000;
      onStats({
        actualFPS: Math.round(frameCountRef.current / elapsed),
        framesAdvanced: frameCountRef.current,
        interpolationTime: totalInterpolationTimeRef.current,
      });
      frameCountRef.current = 0;
      totalInterpolationTimeRef.current = 0;
      lastStatsTimeRef.current = time;
    }

    rafIdRef.current = requestAnimationFrame(loop);
  }, [frames.length, speed, loopMode, onFrame, onStats, onPlaybackEnd, isFrameReady, onFrameNeeded, stateSyncFPS, mdFrameTime]);

  // A new trajectory cannot inherit a reverse bounce direction from the old
  // one. Clamp the old playhead if the replacement is shorter.
  useEffect(() => {
    const identityChanged = previousFramesRef.current !== frames;
    const lengthChanged = previousFrameCountRef.current !== frames.length;
    previousFramesRef.current = frames;
    previousFrameCountRef.current = frames.length;
    if (!identityChanged && !lengthChanged) return;

    directionRef.current = 1;
    const maxFrame = Math.max(0, frames.length - 1);
    const nextState = stateForEffectiveFrame(
      Math.min(stateRef.current.effectiveFrame, maxFrame),
      frames.length,
    );
    stateRef.current = nextState;
    setCurrentState(nextState);
  }, [frames, frames.length]);

  useEffect(() => {
    if (previousLoopModeRef.current === 'bounce' && loopMode !== 'bounce') {
      directionRef.current = 1;
    }
    previousLoopModeRef.current = loopMode;
  }, [loopMode]);

  // Start/stop playback
  useEffect(() => {
    if (!isPlaying) {
      if (rafIdRef.current !== undefined) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = undefined;
      }
      lastTimeRef.current = undefined;
      wasPlayingRef.current = false;
      completionNotifiedRef.current = false;
      return;
    }

    if (frames.length < 2) {
      if (rafIdRef.current !== undefined) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = undefined;
      }
      lastTimeRef.current = undefined;
      wasPlayingRef.current = true;
      if (loopMode === 'once' && !completionNotifiedRef.current) {
        completionNotifiedRef.current = true;
        onPlaybackEnd?.();
      }
      return;
    }

    if (!wasPlayingRef.current) {
      directionRef.current = 1;
      completionNotifiedRef.current = false;
    }
    wasPlayingRef.current = true;
    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current !== undefined) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = undefined;
      }
    };
  }, [isPlaying, frames.length, loopMode, loop, onPlaybackEnd]);

  // Control functions
  const setFrame = useCallback((frameIndex: number) => {
    directionRef.current = 1;
    if (frames.length === 0) {
      const emptyState = stateForEffectiveFrame(0, 0);
      stateRef.current = emptyState;
      setCurrentState(emptyState);
      return;
    }
    const clamped = Math.max(0, Math.min(frames.length - 1, frameIndex));
    const state = stateForEffectiveFrame(clamped, frames.length);
    if (isFrameReady && !isFrameReady(state.frameIndex)) {
      onFrameNeeded?.(state.frameIndex);
      return;
    }
    stateRef.current = state;
    setCurrentState(state);
    onFrame(state);
  }, [frames.length, onFrame, isFrameReady, onFrameNeeded]);

  const nextFrame = useCallback(() => {
    directionRef.current = 1;
    if (frames.length === 0) return;
    const newIndex = manualStep(stateRef.current.frameIndex, 1, loopMode, frames.length);
    const state = stateForEffectiveFrame(newIndex, frames.length);
    stateRef.current = state;
    setCurrentState(state);
    onFrame(state);
  }, [frames.length, loopMode, onFrame]);

  const prevFrame = useCallback(() => {
    directionRef.current = 1;
    if (frames.length === 0) return;
    const newIndex = manualStep(stateRef.current.frameIndex, -1, loopMode, frames.length);
    const state = stateForEffectiveFrame(newIndex, frames.length);
    stateRef.current = state;
    setCurrentState(state);
    onFrame(state);
  }, [frames.length, loopMode, onFrame]);

  return {
    currentState,
    setFrame,
    nextFrame,
    prevFrame,
    // Live ref (mutated every RAF tick, never triggers a render). AtomsOptimized
    // reads `effectiveFrame` from this to drive GPU interpolation at display rate.
    liveStateRef: stateRef,
  };
}

/**
 * Hook for simple frame stepping without interpolation
 * Use this when you want exact MD frames (no smoothing)
 */
export function useStepPlayback(
  isPlaying: boolean,
  options: {
    totalFrames: number;
    speed?: number;
    loopMode?: 'loop' | 'once';
    onFrame: (frameIndex: number) => void;
  }
) {
  const { totalFrames, speed = 1.0, loopMode = 'loop', onFrame } = options;
  const [frame, setFrame] = useState(0);

  const rafIdRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number | undefined>(undefined);
  const accumulatorRef = useRef(0);

  const loop = useCallback((time: number) => {
    if (lastTimeRef.current === undefined) {
      lastTimeRef.current = time;
    }

    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;

    // Assume MD is 30 fps
    accumulatorRef.current += delta * speed;
    const frameInterval = 1000 / 30;

    while (accumulatorRef.current >= frameInterval) {
      setFrame(prev => {
        let next = prev + 1;
        if (next >= totalFrames) {
          next = loopMode === 'loop' ? 0 : totalFrames - 1;
        }
        onFrame(next);
        return next;
      });
      accumulatorRef.current -= frameInterval;
    }

    rafIdRef.current = requestAnimationFrame(loop);
  }, [totalFrames, speed, loopMode, onFrame]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafIdRef.current !== undefined) {
        cancelAnimationFrame(rafIdRef.current);
      }
      return;
    }

    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafIdRef.current !== undefined) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isPlaying, loop]);

  return {
    frame,
    setFrame: (f: number) => {
      const clamped = Math.max(0, Math.min(totalFrames - 1, f));
      setFrame(clamped);
      onFrame(clamped);
    },
  };
}
