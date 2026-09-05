import { resolveTypeDisplayRadius, type Frame } from '@atlas/core';

export type CameraVector3 = [number, number, number];

export interface PerspectiveCameraFitInput {
  bounds: {
    min: CameraVector3;
    max: CameraVector3;
  };
  cameraPosition: CameraVector3;
  cameraTarget: CameraVector3;
  verticalFovDegrees: number;
  viewportAspect: number;
  atomRadius: number;
  /** Optional decorative shell that Recenter should include in the frame. */
  enclosingRadius?: number;
  padding?: number;
  fallbackDirection?: CameraVector3;
}

export interface PerspectiveCameraFitResult {
  position: CameraVector3;
  target: CameraVector3;
  distance: number;
  contentRadius: number;
  horizontalHalfFovRadians: number;
  verticalHalfFovRadians: number;
}

export const DEFAULT_CAMERA_FIT_PADDING = 1.12;

const MIN_CONTENT_RADIUS = 1e-3;
const MIN_DIRECTION_LENGTH = 1e-8;

/**
 * Convert the real R3F Canvas CSS size to the perspective-camera aspect.
 * Invalid or not-yet-laid-out sizes intentionally fall back to a square
 * viewport until the Canvas reports its first usable measurement.
 */
export function viewportAspectFromSize(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 1;
  }
  return width / height;
}

/**
 * Fit a bounding sphere to the narrower perspective frustum dimension.
 * The sphere includes atom mesh radius, so position-only trajectory bounds
 * cannot clip the outer atoms. The current camera-to-target direction is
 * retained; fitting never silently changes a named camera preset's view.
 */
export function fitPerspectiveCameraToBounds(
  input: PerspectiveCameraFitInput,
): PerspectiveCameraFitResult {
  const target: CameraVector3 = [
    (input.bounds.min[0] + input.bounds.max[0]) / 2,
    (input.bounds.min[1] + input.bounds.max[1]) / 2,
    (input.bounds.min[2] + input.bounds.max[2]) / 2,
  ];
  const halfDiagonal = Math.hypot(
    (input.bounds.max[0] - input.bounds.min[0]) / 2,
    (input.bounds.max[1] - input.bounds.min[1]) / 2,
    (input.bounds.max[2] - input.bounds.min[2]) / 2,
  );
  const atomRadius = Number.isFinite(input.atomRadius)
    ? Math.max(0, input.atomRadius)
    : 0;
  const padding =
    Number.isFinite(input.padding) && input.padding! > 0
      ? input.padding!
      : DEFAULT_CAMERA_FIT_PADDING;
  const contentRadius =
    Math.max(MIN_CONTENT_RADIUS, halfDiagonal + atomRadius,
      Number.isFinite(input.enclosingRadius) ? input.enclosingRadius! : 0) * padding;

  const safeFov = Number.isFinite(input.verticalFovDegrees)
    ? Math.min(179, Math.max(1, input.verticalFovDegrees))
    : 50;
  const viewportAspect =
    Number.isFinite(input.viewportAspect) && input.viewportAspect > 0
      ? input.viewportAspect
      : 1;
  const verticalHalfFovRadians = (safeFov * Math.PI) / 360;
  const horizontalHalfFovRadians = Math.atan(
    Math.tan(verticalHalfFovRadians) * viewportAspect,
  );
  const limitingHalfFov = Math.min(
    verticalHalfFovRadians,
    horizontalHalfFovRadians,
  );

  const fallbackDirection = input.fallbackDirection ?? [0, 0, 1];
  const rawDirection: CameraVector3 = [
    input.cameraPosition[0] - input.cameraTarget[0],
    input.cameraPosition[1] - input.cameraTarget[1],
    input.cameraPosition[2] - input.cameraTarget[2],
  ];
  let directionLength = Math.hypot(...rawDirection);
  let direction = rawDirection;
  if (
    !Number.isFinite(directionLength) ||
    directionLength < MIN_DIRECTION_LENGTH
  ) {
    direction = fallbackDirection;
    directionLength = Math.hypot(...direction);
  }
  if (
    !Number.isFinite(directionLength) ||
    directionLength < MIN_DIRECTION_LENGTH
  ) {
    direction = [0, 0, 1];
    directionLength = 1;
  }
  const unitDirection: CameraVector3 = [
    direction[0] / directionLength,
    direction[1] / directionLength,
    direction[2] / directionLength,
  ];

  // For a sphere centered on the view axis, asin(radius / distance) is the
  // exact tangent angle. Using tan here would clip the sphere's near edge.
  const distance = contentRadius / Math.sin(limitingHalfFov);
  const position: CameraVector3 = [
    target[0] + unitDirection[0] * distance,
    target[1] + unitDirection[1] * distance,
    target[2] + unitDirection[2] * distance,
  ];

  return {
    position,
    target,
    distance,
    contentRadius,
    horizontalHalfFovRadians,
    verticalHalfFovRadians,
  };
}

/** Maximum world-space atom mesh radius for the active frame. */
export function maxRenderedAtomRadius(
  frame:
    | Pick<Frame, 'types' | 'typeSemantics' | 'distanceSemantics'>
    | undefined,
  atomScale: number,
  atomTypeScales: Record<number, number>,
): number {
  if (!frame) return 0;
  const safeAtomScale = Number.isFinite(atomScale) ? Math.max(0, atomScale) : 1;
  const seenTypes = new Set<number>();
  let maximum = 0;
  for (const rawType of frame.types) {
    if (seenTypes.has(rawType)) continue;
    seenTypes.add(rawType);
    const configuredScale = atomTypeScales[rawType];
    const typeScale = Number.isFinite(configuredScale)
      ? Math.max(0, configuredScale)
      : 1;
    maximum = Math.max(
      maximum,
      resolveTypeDisplayRadius(frame, rawType) * safeAtomScale * typeScale,
    );
  }
  return maximum;
}
