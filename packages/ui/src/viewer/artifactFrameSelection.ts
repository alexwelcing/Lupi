import type { Frame } from '@atlas/core';
import type { InterpolatedFrameState } from '../hooks/useSmoothFramePlayback';

export interface ViewerFrameSelection {
  readonly frame: Frame | undefined;
  readonly nextFrame: Frame | undefined;
  readonly interpolationFactor: number;
  readonly frameKey: number;
}

/**
 * Select the exact arrays rendered by atoms/vectors/bonds. An immutable image
 * capture takes priority over the playback clock and is always an integer,
 * non-interpolated source frame. Missing addressed frames remain missing so the
 * capture transaction can fail closed instead of substituting plausible data.
 */
export function selectViewerFrames(
  frames: readonly (Frame | undefined)[],
  displayFrameIndex: number,
  interpolation: InterpolatedFrameState,
  artifactCaptureFrameIndex: number | null,
): ViewerFrameSelection {
  if (artifactCaptureFrameIndex !== null) {
    return {
      frame: frames[artifactCaptureFrameIndex],
      nextFrame: undefined,
      interpolationFactor: 0,
      frameKey: artifactCaptureFrameIndex,
    };
  }

  const frame = frames[interpolation.frameIndex] ?? frames[displayFrameIndex];
  const nextFrame = interpolation.isInterpolating
    ? frames[interpolation.nextFrameIndex]
    : undefined;
  return {
    frame,
    nextFrame,
    interpolationFactor: nextFrame ? interpolation.interpolationFactor : 0,
    frameKey: frame === frames[interpolation.frameIndex]
      ? interpolation.frameIndex
      : displayFrameIndex,
  };
}
