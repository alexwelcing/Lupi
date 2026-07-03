import { describe, it, expect } from 'vitest';
import {
  computeMoleculeViewBounds,
  deriveViewDirection,
  DEFAULT_ISO_VIEW_DIRECTION,
} from './moleculePngRenderer';

/** Minimal frame + style stubs — the pure framing math needs only positions,
 *  types, per-type radii, and the hidden-type set. */
function frame(positions: number[], types: number[]) {
  return {
    natoms: types.length,
    positions: new Float32Array(positions),
    types: new Int32Array(types),
  };
}

const unitRadiusStyle = {
  displayRadiusForType: () => 1,
  hiddenTypes: new Set<number>(),
};

describe('computeMoleculeViewBounds', () => {
  it('centers on the atom cloud and encloses every atom surface', () => {
    // Two unit-radius atoms on the x-axis at ±3 → center at origin, sphere
    // radius = 3 (center→atom) + 1 (atom radius) = 4.
    const { center, radius } = computeMoleculeViewBounds(
      frame([-3, 0, 0, 3, 0, 0], [1, 1]),
      unitRadiusStyle,
    );
    expect(center[0]).toBeCloseTo(0, 6);
    expect(center[1]).toBeCloseTo(0, 6);
    expect(center[2]).toBeCloseTo(0, 6);
    expect(radius).toBeCloseTo(4, 6);
  });

  it('inflates the sphere by each atom draw radius so nothing clips', () => {
    // Single atom of radius 2.5 → the enclosing sphere must be at least 2.5.
    const { center, radius } = computeMoleculeViewBounds(
      frame([5, -5, 5], [1]),
      { displayRadiusForType: () => 2.5, hiddenTypes: new Set() },
    );
    expect(center).toEqual([5, -5, 5]);
    expect(radius).toBeCloseTo(2.5, 6);
  });

  it('ignores hidden atom types when framing', () => {
    // A far-flung hidden atom must not enlarge the sphere.
    const { center, radius } = computeMoleculeViewBounds(
      frame([0, 0, 0, 1000, 0, 0], [1, 2]),
      { displayRadiusForType: () => 1, hiddenTypes: new Set([2]) },
    );
    expect(center[0]).toBeCloseTo(0, 6);
    expect(radius).toBeCloseTo(1, 6);
  });

  it('returns a safe unit sphere when everything is hidden', () => {
    const { center, radius } = computeMoleculeViewBounds(
      frame([0, 0, 0], [9]),
      { displayRadiusForType: () => 1, hiddenTypes: new Set([9]) },
    );
    expect(center).toEqual([0, 0, 0]);
    expect(radius).toBe(1);
  });
});

describe('deriveViewDirection', () => {
  it('normalizes (camera − target) to a unit vector', () => {
    const dir = deriveViewDirection([0, 0, 10], [0, 0, 0]);
    expect(dir).toEqual([0, 0, 1]);
    const diag = deriveViewDirection([3, 4, 0], [0, 0, 0]);
    const len = Math.hypot(...diag);
    expect(len).toBeCloseTo(1, 6);
    expect(diag[0]).toBeCloseTo(0.6, 6);
    expect(diag[1]).toBeCloseTo(0.8, 6);
  });

  it('falls back to the iso hero angle when camera and target coincide', () => {
    expect(deriveViewDirection([2, 2, 2], [2, 2, 2])).toEqual(DEFAULT_ISO_VIEW_DIRECTION);
  });
});
