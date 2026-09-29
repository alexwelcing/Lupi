import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  AtomsOptimized,
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  QUALITY_TIER_FULL_ATOM_LIMIT,
  QUALITY_TIER_IBL_ATOM_LIMIT,
  atomMaterialForTier,
  buildColormapTexture,
  buildMaterialPaletteTexture,
  buildPaletteTexture,
  buildRadiusPaletteTexture,
  buildTypeSlotLookup,
  createAtomImpostorResources,
  disposeAtomImpostorResources,
  resolveAtomQualityTier,
  resolveSlotRadius,
  createAtomInterpolationBoundingSphere,
  disposeOwnedMaterialTextures,
  markInstancedAttributeUpdateRange,
  resolveLoadedAtomCount,
  syncSurfaceMaterialUniforms,
  writePaletteTexture,
} from './AtomsOptimized';
import {
  ATOM_ATTR,
  ATOM_DATA_OCCLUSION,
  ATOM_DATA_SLOT,
  packAtomData,
  unpackAtomProp,
} from './tsl/atomImpostorMaterial';
import { getLupiUniforms, LUPI_UNIFORMS_KEY } from './tsl/lupiUniforms';
import { buildTypeRenderTable } from './typeRenderTable';

type AtomMesh = THREE.Mesh<THREE.InstancedBufferGeometry, MeshBasicNodeMaterial>;

/** No itemSize-1 8/16-bit attribute: WebGPU has no such vertex format (D4, K22). */
function narrowScalarAttributes(geometry: THREE.BufferGeometry): string[] {
  return Object.entries(geometry.attributes)
    .filter(([, attribute]) => attribute.itemSize === 1 && (
      attribute.array instanceof Uint8Array
      || attribute.array instanceof Int8Array
      || attribute.array instanceof Uint16Array
      || attribute.array instanceof Int16Array
    ))
    .map(([name]) => name);
}

function makeFrame(): Frame {
  return {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity: { kind: 'source-id', unique: true },
    ids: new Int32Array([1, 2]),
    types: new Int32Array([1, 1]),
    positions: new Float32Array([1, 1, 1, 2, 2, 2]),
    bonds: new Int32Array(),
    properties: new Map(),
  };
}

describe('AtomsOptimized material resource policy', () => {
  it('declares display color lookups as sRGB and keeps packed material data linear', () => {
    const palette = buildPaletteTexture(() => [0.5, 0.25, 0.75]);
    const colormap = buildColormapTexture(() => [0.1, 0.2, 0.3]);
    const material = buildMaterialPaletteTexture();

    expect(palette.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(colormap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.colorSpace).toBe(THREE.NoColorSpace);
    // Carbon roughness is authored as 0.7. Preserve the historical
    // Float32-to-byte path (178, not the double-precision half-step 179) so
    // an element-slot remap cannot silently invalidate approved pixels.
    expect((material.image.data as Uint8Array)[6 * 4 + 1]).toBe(178);

    // Palettes are rewritten in place: the texture identity never changes.
    const version = palette.version;
    writePaletteTexture(palette, () => [1, 0, 0]);
    expect((palette.image.data as Uint8Array).slice(0, 4)).toEqual(new Uint8Array([255, 0, 0, 255]));
    expect(palette.version).toBeGreaterThan(version);

    palette.dispose();
    colormap.dispose();
    material.dispose();
  });

  it('packs type slot, occlusion and a 16-bit property into one Uint8x4 word', () => {
    const out = new Uint8Array(8);
    for (const prop of [0, 1 / 65535, 0.25, 0.5, 0.7071, 1]) {
      packAtomData(out, 1, 7, 0.5, prop);
      expect(out[4 + ATOM_DATA_SLOT]).toBe(7);
      expect(out[4 + ATOM_DATA_OCCLUSION]).toBe(128);
      expect(Math.abs(unpackAtomProp(out, 1) - prop)).toBeLessThanOrEqual(1 / 65535);
    }
    packAtomData(out, 0, 300, 2, Number.NaN);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 0, 0]);
  });

  it('builds one node material per tier over shared uniforms and palettes', () => {
    const resources = createAtomImpostorResources();
    const tier0 = atomMaterialForTier(resources, 0);
    const tier2 = atomMaterialForTier(resources, 2);
    expect(atomMaterialForTier(resources, 0)).toBe(tier0);
    expect(tier2).not.toBe(tier0);
    for (const material of [tier0, atomMaterialForTier(resources, 1), tier2]) {
      expect((material as { isMeshBasicNodeMaterial?: boolean }).isMeshBasicNodeMaterial).toBe(true);
      expect(material.vertexNode).toBeTruthy();
      expect(material.depthNode).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
      expect(material.userData[LUPI_UNIFORMS_KEY]).toBe(resources.uniforms);
    }
    const bag = getLupiUniforms(tier2)!;
    for (const key of [
      'uProgress', 'uColorMode', 'uUniformColor', 'uTextureMode', 'uMaterialPreset',
      'uMaterialIntensity', 'uSurfaceRoughness', 'uSurfacePolish', 'uSurfaceClearcoat',
      'uPropEmission', 'uEtchAtomId', 'uHasEtch', 'uCullPixelRadius', 'uOcclusionStrength',
      'uPalette', 'uColormap', 'uRadiusPalette', 'uMaterialPalette', 'tEtchTexture',
    ]) {
      expect(bag[key], key).toBeDefined();
    }
    expect(bag.uPalette.value).toBe(resources.textures.palette);
    expect(bag.uRadiusPalette.value).toBe(resources.textures.radiusPalette);

    const materialDispose = vi.spyOn(tier2, 'dispose');
    const paletteDispose = vi.spyOn(resources.textures.palette, 'dispose');
    disposeAtomImpostorResources(resources);
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(paletteDispose).toHaveBeenCalledOnce();
  });

  it('uses current Three update ranges and replaces stale spans exactly', () => {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
    attribute.addUpdateRange(4, 8);

    markInstancedAttributeUpdateRange(attribute, 9);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 9 }]);
    expect(attribute.version).toBe(1);

    markInstancedAttributeUpdateRange(attribute, 3);
    expect(attribute.updateRanges).toEqual([{ start: 0, count: 3 }]);
    expect(attribute.version).toBe(2);

    markInstancedAttributeUpdateRange(attribute, 0);
    expect(attribute.updateRanges).toEqual([]);
    expect(attribute.version).toBe(2);
  });

  it('synchronizes every surface-character uniform, including clearcoat', () => {
    const uniforms = {
      uSurfaceRoughness: { value: 0 },
      uSurfacePolish: { value: 0 },
      uSurfaceClearcoat: { value: 0 },
    };

    syncSurfaceMaterialUniforms(uniforms, {
      surfaceRoughness: 0.2,
      surfacePolish: 0.3,
      surfaceClearcoat: 0.4,
    });

    expect(uniforms).toEqual({
      uSurfaceRoughness: { value: 0.2 },
      uSurfacePolish: { value: 0.3 },
      uSurfaceClearcoat: { value: 0.4 },
    });
  });

  it('disposes all textures owned by the material', () => {
    const paletteDispose = vi.fn();
    const colormapDispose = vi.fn();
    const materialPaletteDispose = vi.fn();
    const radiusPaletteDispose = vi.fn();
    const envDispose = vi.fn();

    disposeOwnedMaterialTextures({
      uPalette: { value: { dispose: paletteDispose } },
      uColormap: { value: { dispose: colormapDispose } },
      uMaterialPalette: { value: { dispose: materialPaletteDispose } },
      uRadiusPalette: { value: { dispose: radiusPaletteDispose } },
      tEnvMap: { value: { dispose: envDispose } },
    });

    expect(paletteDispose).toHaveBeenCalledOnce();
    expect(colormapDispose).toHaveBeenCalledOnce();
    expect(materialPaletteDispose).toHaveBeenCalledOnce();
    expect(radiusPaletteDispose).toHaveBeenCalledOnce();
    // The environment probe is scene-owned, never disposed here.
    expect(envDispose).not.toHaveBeenCalled();
  });

  it('lowers the shader quality tier with atom count, never above the device tier', () => {
    expect(resolveAtomQualityTier(2, 1_000)).toBe(2);
    expect(resolveAtomQualityTier(2, QUALITY_TIER_FULL_ATOM_LIMIT + 1)).toBe(1);
    expect(resolveAtomQualityTier(2, QUALITY_TIER_IBL_ATOM_LIMIT + 1)).toBe(0);
    expect(resolveAtomQualityTier(0, 10)).toBe(0);
    expect(resolveAtomQualityTier(1, 10)).toBe(1);
    expect(resolveAtomQualityTier(undefined, 10)).toBe(2);
  });

  it('resolves per-slot radii from scale, per-type scale and visibility', () => {
    const entry = { rawType: 3, displayRadius: 0.5 };
    expect(resolveSlotRadius(entry, 2)).toBeCloseTo(1);
    expect(resolveSlotRadius(entry, 2, null, { 3: 0.5 })).toBeCloseTo(0.5);
    expect(resolveSlotRadius(entry, 2, new Set([3]))).toBe(0);
    expect(resolveSlotRadius(undefined, 2)).toBe(0);
    const texture = buildRadiusPaletteTexture((slot) => (slot === 1 ? 0.75 : 0));
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.type).toBe(THREE.FloatType);
    expect((texture.image.data as Float32Array)[1]).toBeCloseTo(0.75);
    expect((texture.image.data as Float32Array)[0]).toBe(0);
    texture.dispose();
  });

  it('builds a dense slot lookup for compact raw type domains', () => {
    const frame = makeFrame();
    frame.types = new Int32Array([7, 3]);
    const table = buildTypeRenderTable(frame);
    const lookup = buildTypeSlotLookup(table);
    expect(lookup.dense).not.toBeNull();
    expect(lookup.base).toBe(3);
    expect(lookup.dense![7 - lookup.base]).toBe(table.byRawType.get(7)!.slot);
    expect(lookup.dense![3 - lookup.base]).toBe(table.byRawType.get(3)!.slot);
    expect(lookup.dense![5 - lookup.base]).toBe(-1);
  });

  it('keeps stable material resources alive across capacity growth and disposes them on unmount', async () => {
    const frame = makeFrame();
    const hiddenAtomTypes = new Set([1]);
    const elementColorOverrides = {};
    const artifactSpecId = 'artifact-hidden-atoms';
    const renderAtoms = (maxAtoms: number) => React.createElement(AtomsOptimized, {
      frame,
      maxAtoms,
      hiddenAtomTypes,
      elementColorOverrides,
      artifactSpecId,
    });
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = await ReactThreeTestRenderer.create(renderAtoms(1));
    let didUnmount = false;

    try {
      const atomMesh = renderer.scene.findByType('Mesh').instance as AtomMesh;
      expect(atomMesh.userData[LUPI_ARTIFACT_LAYER_KEY]).toBe(LUPI_ARTIFACT_ATOMS_LAYER);
      const initialGeometry = atomMesh.geometry;
      const material = atomMesh.material;
      const bag = getLupiUniforms(material)!;
      const palette = bag.uPalette.value as THREE.Texture;
      const colormap = bag.uColormap.value as THREE.Texture;
      const materialPalette = bag.uMaterialPalette.value as THREE.Texture;

      // D4: one normalized Uint8x4 word per atom, float positions, and no
      // itemSize-1 8/16-bit attribute anywhere.
      const data = initialGeometry.attributes[ATOM_ATTR.data] as THREE.InstancedBufferAttribute;
      expect(data.array).toBeInstanceOf(Uint8Array);
      expect(data.itemSize).toBe(4);
      expect(data.normalized).toBe(true);
      expect(initialGeometry.attributes[ATOM_ATTR.position].array).toBeInstanceOf(Float32Array);
      expect(initialGeometry.attributes[ATOM_ATTR.target]).toBe(initialGeometry.attributes[ATOM_ATTR.position]);
      expect(narrowScalarAttributes(initialGeometry)).toEqual([]);

      const geometryDispose = vi.spyOn(initialGeometry, 'dispose');
      const materialDispose = vi.spyOn(material, 'dispose');
      const paletteDispose = vi.spyOn(palette, 'dispose');
      const colormapDispose = vi.spyOn(colormap, 'dispose');
      const materialPaletteDispose = vi.spyOn(materialPalette, 'dispose');

      // An all-hidden frame is still fully applied scene state and must carry
      // the artifact receipt. Hidden atoms stay in the instance buffer and are
      // culled on the GPU by a zero radius in the radius palette.
      expect(initialGeometry.instanceCount).toBe(1);
      const radiusPalette = bag.uRadiusPalette.value as THREE.DataTexture;
      expect((radiusPalette.image.data as Float32Array)[0]).toBe(0);
      expect(material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe(artifactSpecId);

      await renderer.update(renderAtoms(2));

      const grownMesh = renderer.scene.findByType('Mesh').instance as AtomMesh;
      expect(grownMesh.geometry).not.toBe(initialGeometry);
      expect(grownMesh.material).toBe(material);
      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();
      expect(paletteDispose).not.toHaveBeenCalled();
      expect(colormapDispose).not.toHaveBeenCalled();
      expect(materialPaletteDispose).not.toHaveBeenCalled();
      expect(bag.uPalette.value).toBe(palette);
      expect(material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe(artifactSpecId);
      // The grown geometry got the type slot rewritten into its fresh buffer.
      const grownData = grownMesh.geometry.attributes[ATOM_ATTR.data].array as Uint8Array;
      expect(grownData[ATOM_DATA_OCCLUSION]).toBe(255);

      await renderer.unmount();
      didUnmount = true;

      expect(materialDispose).toHaveBeenCalled();
      expect(paletteDispose).toHaveBeenCalled();
      expect(colormapDispose).toHaveBeenCalled();
      expect(materialPaletteDispose).toHaveBeenCalled();
    } finally {
      if (!didUnmount) await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});

describe('AtomsOptimized frame identity guard', () => {
  it.each([
    {
      label: 'uploads the next positions when source IDs retain order',
      ids: [1, 2],
      expectedTargets: [1.5, 1, 1, 2.5, 2, 2],
    },
    {
      label: 'keeps current positions when the next frame shuffles source IDs',
      ids: [2, 1],
      expectedTargets: [1, 1, 1, 2, 2, 2],
    },
  ])('$label', async ({ ids, expectedTargets }) => {
    const current = makeFrame();
    const next: Frame = {
      ...makeFrame(),
      timestep: 1,
      ids: new Int32Array(ids),
      positions: new Float32Array([1.5, 1, 1, 2.5, 2, 2]),
    };
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = await ReactThreeTestRenderer.create(React.createElement(AtomsOptimized, {
      frame: current,
      nextFrame: next,
      interpolationFactor: 0.5,
      maxAtoms: 2,
      elementColorOverrides: {},
    }));

    try {
      const mesh = renderer.scene.findByType('Mesh').instance as AtomMesh;
      const targetPositions = mesh.geometry.attributes[ATOM_ATTR.target]
        .array as Float32Array;
      expect(Array.from(targetPositions.slice(0, 6))).toEqual(expectedTargets);
    } finally {
      await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});

describe('AtomsOptimized interpolation culling bounds', () => {
  it('contains current, PBC-unwrapped target, and every interpolated center', () => {
    const instanceRadius = 2;
    const sphere = createAtomInterpolationBoundingSphere({
      count: 1,
      finite: true,
      minX: 9.5,
      minY: -2,
      minZ: 1,
      maxX: 10.5,
      maxY: -2,
      maxZ: 1,
      maxInstanceRadius: instanceRadius,
    });

    for (const x of [9.5, 10, 10.5]) {
      const centerDistance = Math.hypot(
        x - sphere.center.x,
        -2 - sphere.center.y,
        1 - sphere.center.z,
      );
      expect(centerDistance + instanceRadius * 1.3).toBeLessThanOrEqual(
        sphere.radius + Number.EPSILON,
      );
    }
  });

  it('includes the largest visible scaled radius in the conservative sphere', () => {
    const sphere = createAtomInterpolationBoundingSphere({
      count: 2,
      finite: true,
      minX: -1,
      minY: -2,
      minZ: -3,
      maxX: 1,
      maxY: 2,
      maxZ: 3,
      maxInstanceRadius: 4,
    });

    expect(sphere.center.toArray()).toEqual([0, 0, 0]);
    expect(sphere.radius).toBeCloseTo(Math.hypot(1, 2, 3) + 4 * 1.3);
  });

  it('clamps progressive counts and fails open for invalid live bounds', () => {
    expect(resolveLoadedAtomCount(10)).toBe(10);
    expect(resolveLoadedAtomCount(10, 4.9)).toBe(4);
    expect(resolveLoadedAtomCount(10, 12)).toBe(10);
    expect(resolveLoadedAtomCount(10, -1)).toBe(0);
    expect(resolveLoadedAtomCount(10, Number.NaN)).toBe(0);

    const invalidSphere = createAtomInterpolationBoundingSphere({
      count: 1,
      finite: false,
      minX: Number.NaN,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
      maxInstanceRadius: 1,
    });
    expect(invalidSphere.radius).toBe(Number.POSITIVE_INFINITY);
  });
});
