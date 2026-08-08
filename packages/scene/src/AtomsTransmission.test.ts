import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MAX_TRANSMISSION_ATOMS,
  applyTransmissionInstanceMatrices,
  createAtomColorResolver,
  transmissionQuality,
  transmissionSphereDetail,
  transmissionStrength,
  type TransmissionInterpolationData,
} from './AtomsTransmission';
import { COLORMAPS, DEFAULT_TYPE_COLOR } from './constants';
import type { TypeRenderTable, TypeRenderEntry } from './typeRenderTable';

function makeTable(entries: Array<Partial<TypeRenderEntry> & { rawType: number; slot: number }>): TypeRenderTable {
  const full = entries.map((entry): TypeRenderEntry => ({
    color: [0.5, 0.5, 0.5],
    displayRadius: 1,
    ...entry,
  }));
  return {
    entries: full,
    byRawType: new Map(full.map((entry) => [entry.rawType, entry])),
  };
}

const baseResolverOptions = {
  colorMode: 'type' as const,
  colormap: 'viridis' as const,
  uniformColor: '#ff8800',
  elementColorOverrides: {},
  atomColorSource: 'colormap' as const,
  propData: null,
  propMin: 0,
  propMax: 1,
};

describe('transmissionSphereDetail', () => {
  it('gives small molecules hero tessellation and crowds a budget mesh', () => {
    expect(transmissionSphereDetail(24)).toEqual({ widthSegments: 32, heightSegments: 24 });
    expect(transmissionSphereDetail(5_000)).toEqual({ widthSegments: 20, heightSegments: 14 });
    expect(transmissionSphereDetail(MAX_TRANSMISSION_ATOMS)).toEqual({ widthSegments: 12, heightSegments: 10 });
  });
});

describe('transmissionQuality', () => {
  it('halves samples and buffer size on the low device tier', () => {
    expect(transmissionQuality(0)).toEqual({ samples: 4, resolution: 256 });
    expect(transmissionQuality(1)).toEqual({ samples: 6, resolution: 512 });
    expect(transmissionQuality(2)).toEqual({ samples: 6, resolution: 512 });
  });
});

describe('transmissionStrength', () => {
  it('maps intensity into the glassy range and clamps out-of-range inputs', () => {
    expect(transmissionStrength(1)).toBe(1);
    expect(transmissionStrength(0)).toBe(0.5);
    expect(transmissionStrength(0.5)).toBeCloseTo(0.75);
    expect(transmissionStrength(-4)).toBe(0.5);
    expect(transmissionStrength(9)).toBe(1);
  });
});

describe('applyTransmissionInstanceMatrices', () => {
  function makeMesh() {
    const matrices: THREE.Matrix4[] = [];
    return {
      matrices,
      instanceMatrix: { needsUpdate: false },
      setMatrixAt(index: number, matrix: THREE.Matrix4) {
        matrices[index] = matrix.clone();
      },
    };
  }

  const data: TransmissionInterpolationData = {
    count: 2,
    base: new Float32Array([0, 0, 0, 10, 0, 0]),
    target: new Float32Array([4, 8, 0, 10, 0, 6]),
    radius: new Float32Array([1, 2.5]),
    interpolatable: true,
  };

  function positionOf(matrix: THREE.Matrix4): [number, number, number] {
    const v = new THREE.Vector3().setFromMatrixPosition(matrix);
    return [v.x, v.y, v.z];
  }

  it('lerps every instance toward its PBC-unwrapped target and flags the upload', () => {
    const mesh = makeMesh();
    applyTransmissionInstanceMatrices(mesh, data, 0.5);
    expect(positionOf(mesh.matrices[0])).toEqual([2, 4, 0]);
    expect(positionOf(mesh.matrices[1])).toEqual([10, 0, 3]);
    expect(new THREE.Vector3().setFromMatrixScale(mesh.matrices[1]).x).toBeCloseTo(2.5);
    expect(mesh.instanceMatrix.needsUpdate).toBe(true);
  });

  it('clamps progress to the uploaded endpoint pair', () => {
    const mesh = makeMesh();
    applyTransmissionInstanceMatrices(mesh, data, 4.2);
    expect(positionOf(mesh.matrices[0])).toEqual([4, 8, 0]);
    applyTransmissionInstanceMatrices(mesh, data, -1);
    expect(positionOf(mesh.matrices[0])).toEqual([0, 0, 0]);
  });

  it('pins non-interpolatable uploads to the base positions', () => {
    const mesh = makeMesh();
    applyTransmissionInstanceMatrices(mesh, { ...data, interpolatable: false }, 0.9);
    expect(positionOf(mesh.matrices[0])).toEqual([0, 0, 0]);
    expect(positionOf(mesh.matrices[1])).toEqual([10, 0, 0]);
  });
});

describe('createAtomColorResolver', () => {
  it('returns the uniform color for every atom in uniform mode', () => {
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      colorMode: 'uniform',
      typeRenderTable: makeTable([{ rawType: 1, slot: 0 }]),
    });
    expect(resolve(0, 0)).toEqual([1, 136 / 255, 0]);
    expect(resolve(7, 0)).toEqual([1, 136 / 255, 0]);
  });

  it('normalizes property values through the colormap like the impostor path', () => {
    const propData = new Float32Array([0, 5, 10]);
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      colorMode: 'property',
      propData,
      propMin: 0,
      propMax: 10,
      typeRenderTable: makeTable([{ rawType: 1, slot: 0 }]),
    });
    expect(resolve(0, 0)).toEqual(COLORMAPS.viridis(0));
    expect(resolve(1, 0)).toEqual(COLORMAPS.viridis(0.5));
    expect(resolve(2, 0)).toEqual(COLORMAPS.viridis(1));
  });

  it('falls back to mid-colormap when the property range is degenerate', () => {
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      colorMode: 'property',
      propData: new Float32Array([3, 3]),
      propMin: 3,
      propMax: 3,
      typeRenderTable: makeTable([{ rawType: 1, slot: 0 }]),
    });
    expect(resolve(1, 0)).toEqual(COLORMAPS.viridis(0.5));
  });

  it('uses element colors with per-type overrides when the source is element', () => {
    const table = makeTable([
      { rawType: 3, slot: 0, color: [0.9, 0.1, 0.1] },
      { rawType: 8, slot: 1, color: [0.1, 0.2, 0.9] },
    ]);
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      atomColorSource: 'element',
      elementColorOverrides: { 8: '#00ff00' },
      typeRenderTable: table,
    });
    expect(resolve(0, 0)).toEqual([0.9, 0.1, 0.1]);
    expect(resolve(0, 1)).toEqual([0, 1, 0]);
  });

  it('ranks types across the colormap when the source is colormap', () => {
    const table = makeTable([
      { rawType: 1, slot: 0 },
      { rawType: 2, slot: 1 },
      { rawType: 3, slot: 2 },
    ]);
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      typeRenderTable: table,
    });
    expect(resolve(0, 0)).toEqual(COLORMAPS.viridis(0));
    expect(resolve(0, 1)).toEqual(COLORMAPS.viridis(0.5));
    expect(resolve(0, 2)).toEqual(COLORMAPS.viridis(1));
  });

  it('returns the neutral default for a slot outside the table', () => {
    const resolve = createAtomColorResolver({
      ...baseResolverOptions,
      typeRenderTable: makeTable([{ rawType: 1, slot: 0 }]),
    });
    expect(resolve(0, 99)).toEqual(DEFAULT_TYPE_COLOR);
  });
});
