import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_CAMERA_FIT_PADDING,
  fitPerspectiveCameraToBounds,
  maxRenderedAtomRadius,
  viewportAspectFromSize,
} from './cameraFit';

const BOUNDS = {
  min: [-4, -2, -1] as [number, number, number],
  max: [4, 2, 1] as [number, number, number],
};

function fitAtAspect(viewportAspect: number) {
  return fitPerspectiveCameraToBounds({
    bounds: BOUNDS,
    cameraPosition: [10, 10, 10],
    cameraTarget: [0, 0, 0],
    verticalFovDegrees: 50,
    viewportAspect,
    atomRadius: 0.7,
    padding: 1,
  });
}

function paddedBoundsCorners(padding: number) {
  const center = BOUNDS.min.map(
    (coordinate, index) => (coordinate + BOUNDS.max[index]) / 2,
  );
  const halfExtents = BOUNDS.min.map(
    (coordinate, index) => ((BOUNDS.max[index] - coordinate) / 2) * padding,
  );
  const corners: [number, number, number][] = [];
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        corners.push([
          center[0] + halfExtents[0] * xSign,
          center[1] + halfExtents[1] * ySign,
          center[2] + halfExtents[2] * zSign,
        ]);
      }
    }
  }
  return corners;
}

function expectPaddedBoundsInsideProjection(viewportAspect: number) {
  const fit = fitPerspectiveCameraToBounds({
    bounds: BOUNDS,
    cameraPosition: [10, 10, 10],
    cameraTarget: [0, 0, 0],
    verticalFovDegrees: 50,
    viewportAspect,
    atomRadius: 0.7,
  });
  const camera = new THREE.PerspectiveCamera(50, viewportAspect, 0.01, 1_000);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  for (const corner of paddedBoundsCorners(DEFAULT_CAMERA_FIT_PADDING)) {
    const projected = new THREE.Vector3(...corner).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(1);
    expect(Math.abs(projected.y)).toBeLessThan(1);
    expect(projected.z).toBeGreaterThan(-1);
    expect(projected.z).toBeLessThan(1);
  }
}

describe('perspective camera fit', () => {
  it('includes the atmosphere in a recentered portrait scene', () => {
    const fit = fitPerspectiveCameraToBounds({ bounds: BOUNDS, cameraPosition: [0, 0, 20], cameraTarget: [0, 0, 0],
      verticalFovDegrees: 50, viewportAspect: 390 / 844, atomRadius: .5, enclosingRadius: 12 });
    expect(fit.contentRadius).toBeCloseTo(12 * DEFAULT_CAMERA_FIT_PADDING);
    expect(fit.distance).toBeGreaterThan(fitAtAspect(390 / 844).distance);
  });
  it('uses the portrait horizontal FOV as the limiting projection', () => {
    const fit = fitAtAspect(390 / 844);
    const projectedHalfAngle = Math.asin(fit.contentRadius / fit.distance);

    expect(fit.horizontalHalfFovRadians).toBeLessThan(
      fit.verticalHalfFovRadians,
    );
    expect(projectedHalfAngle).toBeCloseTo(fit.horizontalHalfFovRadians, 10);
    expect(projectedHalfAngle).toBeLessThanOrEqual(fit.verticalHalfFovRadians);
    expectPaddedBoundsInsideProjection(390 / 844);
  });

  it('uses the landscape vertical FOV as the limiting projection', () => {
    const fit = fitAtAspect(844 / 390);
    const projectedHalfAngle = Math.asin(fit.contentRadius / fit.distance);

    expect(fit.horizontalHalfFovRadians).toBeGreaterThan(
      fit.verticalHalfFovRadians,
    );
    expect(projectedHalfAngle).toBeCloseTo(fit.verticalHalfFovRadians, 10);
    expect(fitAtAspect(390 / 844).distance).toBeGreaterThan(fit.distance);
    expectPaddedBoundsInsideProjection(844 / 390);
  });

  it('preserves view direction while including atom radius and padding', () => {
    const fit = fitPerspectiveCameraToBounds({
      bounds: { min: [2, 3, 4], max: [2, 3, 4] },
      cameraPosition: [5, 7, 9],
      cameraTarget: [2, 3, 4],
      verticalFovDegrees: 50,
      viewportAspect: 1,
      atomRadius: 2,
      padding: 1.25,
    });
    const fittedDirection = fit.position.map(
      (coordinate, index) => (coordinate - fit.target[index]) / fit.distance,
    );
    const originalLength = Math.hypot(3, 4, 5);

    expect(fit.target).toEqual([2, 3, 4]);
    expect(fit.contentRadius).toBe(2.5);
    expect(fittedDirection[0]).toBeCloseTo(3 / originalLength, 12);
    expect(fittedDirection[1]).toBeCloseTo(4 / originalLength, 12);
    expect(fittedDirection[2]).toBeCloseTo(5 / originalLength, 12);
  });

  it('derives aspect from the Canvas size and handles pre-layout dimensions', () => {
    expect(viewportAspectFromSize(390, 844)).toBeCloseTo(390 / 844);
    expect(viewportAspectFromSize(844, 390)).toBeCloseTo(844 / 390);
    expect(viewportAspectFromSize(0, 844)).toBe(1);
  });

  it('uses the largest scaled atom mesh radius', () => {
    const frame = {
      types: new Int32Array([1, 6, 6]),
      typeSemantics: { kind: 'atomic-number', provenance: 'test' } as const,
      distanceSemantics: { kind: 'angstrom', provenance: 'test' } as const,
    };

    expect(maxRenderedAtomRadius(frame, 2, { 6: 1.5 })).toBeCloseTo(1.14);
  });
});
