// @vitest-environment node
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import {
  AtomsOptimized,
  IMPOSTOR_FRAGMENT,
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  QUALITY_TIER_FULL_ATOM_LIMIT,
  QUALITY_TIER_IBL_ATOM_LIMIT,
  buildColormapTexture,
  buildMaterialPaletteTexture,
  buildPaletteTexture,
  buildRadiusPaletteTexture,
  buildTypeSlotLookup,
  cubeUvShaderDefinesForAtlas,
  rendererSupportsConservativeDepth,
  resolveAtomQualityTier,
  resolveSlotRadius,
  syncAtomShaderDefines,
  createAtomInterpolationBoundingSphere,
  disposeOwnedMaterialTextures,
  markInstancedAttributeUpdateRange,
  materialCubeUvDefines,
  resolveLoadedAtomCount,
  syncSurfaceMaterialUniforms,
  syncCubeUvEnvironment,
} from './AtomsOptimized';
import { buildTypeRenderTable } from './typeRenderTable';

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
  it('declares display color lookups as sRGB, keeps packed material data linear, and converts shader output', () => {
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
    expect(IMPOSTOR_FRAGMENT.indexOf('gl_FragColor = vec4(color, 1.0);')).toBeGreaterThan(-1);
    // The raw material owns its output transfer function: sRGB encode after
    // the final color is assembled, gated by the render-target uniform.
    expect(IMPOSTOR_FRAGMENT.indexOf('gl_FragColor = sRGBTransferOETF(gl_FragColor);')).toBeGreaterThan(
      IMPOSTOR_FRAGMENT.indexOf('gl_FragColor = vec4(color, 1.0);'),
    );
    // The conservative-depth extension directive must be the first
    // non-comment token so ANGLE accepts it in ESSL 3.00.
    expect(IMPOSTOR_FRAGMENT.trimStart().startsWith('#ifdef LUPI_CONSERVATIVE_DEPTH\n#extension GL_EXT_conservative_depth')).toBe(true);

    palette.dispose();
    colormap.dispose();
    material.dispose();
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

  it('derives Three r184 CubeUV lookup defines from the real PMREM atlas', () => {
    expect(cubeUvShaderDefinesForAtlas(768, 1024)).toEqual({
      CUBEUV_TEXEL_WIDTH: 1 / 768,
      CUBEUV_TEXEL_HEIGHT: 1 / 1024,
      CUBEUV_MAX_MIP: 8,
    });
    expect(materialCubeUvDefines(cubeUvShaderDefinesForAtlas(1, 1))).toEqual({
      CUBEUV_TEXEL_WIDTH: '1.0',
      CUBEUV_TEXEL_HEIGHT: '1.0',
      CUBEUV_MAX_MIP: '0.0',
    });
    expect(materialCubeUvDefines(cubeUvShaderDefinesForAtlas(768, 1024))).toEqual({
      CUBEUV_TEXEL_WIDTH: String(1 / 768),
      CUBEUV_TEXEL_HEIGHT: String(1 / 1024),
      CUBEUV_MAX_MIP: '8.0',
    });
  });

  it('recompiles the atom shader only when the CubeUV atlas dimensions change', () => {
    const material = new THREE.ShaderMaterial({
      defines: { ...cubeUvShaderDefinesForAtlas(1, 1) },
      uniforms: {
        tEnvMap: { value: null },
        uHasEnv: { value: 0 },
      },
    });
    const texture = new THREE.Texture({ width: 768, height: 1024 });
    texture.mapping = THREE.CubeUVReflectionMapping;

    syncCubeUvEnvironment(material, texture);
    const compiledVersion = material.version;
    expect(material.uniforms.tEnvMap.value).toBe(texture);
    expect(material.uniforms.uHasEnv.value).toBe(1);
    expect(material.defines).toMatchObject({
      CUBEUV_TEXEL_WIDTH: String(1 / 768),
      CUBEUV_TEXEL_HEIGHT: String(1 / 1024),
      CUBEUV_MAX_MIP: '8.0',
    });

    const sameSizeTexture = new THREE.Texture({ width: 768, height: 1024 });
    sameSizeTexture.mapping = THREE.CubeUVReflectionMapping;
    syncCubeUvEnvironment(material, sameSizeTexture);
    expect(material.version).toBe(compiledVersion);
    expect(material.uniforms.tEnvMap.value).toBe(sameSizeTexture);

    const resized = new THREE.Texture({ width: 384, height: 512 });
    resized.mapping = THREE.CubeUVReflectionMapping;
    syncCubeUvEnvironment(material, resized);
    expect(material.version).toBe(compiledVersion + 1);

    material.dispose();
    texture.dispose();
    sameSizeTexture.dispose();
    resized.dispose();
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

  it('flags a recompile only when quality or early-Z defines change', () => {
    const material = new THREE.ShaderMaterial({ defines: { LUPI_QUALITY: '2' } });
    const version = material.version;
    expect(syncAtomShaderDefines(material, 2, false)).toBe(false);
    expect(material.version).toBe(version);
    expect(syncAtomShaderDefines(material, 1, true)).toBe(true);
    expect(material.defines).toMatchObject({ LUPI_QUALITY: '1', LUPI_CONSERVATIVE_DEPTH: '1' });
    expect(syncAtomShaderDefines(material, 1, false)).toBe(true);
    expect(material.defines.LUPI_CONSERVATIVE_DEPTH).toBeUndefined();
    material.dispose();
  });

  it('probes EXT_conservative_depth once per context and fails closed', () => {
    const getExtension = vi.fn((name: string) => (name === 'EXT_conservative_depth' ? {} : null));
    const context = { getExtension };
    const renderer = { getContext: () => context };
    expect(rendererSupportsConservativeDepth(renderer)).toBe(true);
    expect(rendererSupportsConservativeDepth(renderer)).toBe(true);
    expect(getExtension).toHaveBeenCalledTimes(1);
    expect(rendererSupportsConservativeDepth({ getContext: () => ({ getExtension: () => null }) })).toBe(false);
    expect(rendererSupportsConservativeDepth({ getContext: () => { throw new Error('lost'); } })).toBe(false);
    expect(rendererSupportsConservativeDepth(null)).toBe(false);
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
      const atomMesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      expect(atomMesh.userData[LUPI_ARTIFACT_LAYER_KEY]).toBe(LUPI_ARTIFACT_ATOMS_LAYER);
      const initialGeometry = atomMesh.geometry;
      const material = atomMesh.material;
      const palette = material.uniforms.uPalette.value as THREE.Texture;
      const colormap = material.uniforms.uColormap.value as THREE.Texture;
      const materialPalette = material.uniforms.uMaterialPalette.value as THREE.Texture;

      const geometryDispose = vi.spyOn(initialGeometry, 'dispose');
      const materialDispose = vi.spyOn(material, 'dispose');
      const paletteDispose = vi.spyOn(palette, 'dispose');
      const colormapDispose = vi.spyOn(colormap, 'dispose');
      const materialPaletteDispose = vi.spyOn(materialPalette, 'dispose');

      // An all-hidden frame is still fully applied scene state and must carry
      // the artifact receipt. Hidden atoms stay in the instance buffer and are
      // culled on the GPU by a zero radius in the radius palette.
      expect(initialGeometry.instanceCount).toBe(1);
      const radiusPalette = material.uniforms.uRadiusPalette.value as THREE.DataTexture;
      expect((radiusPalette.image.data as Float32Array)[0]).toBe(0);
      expect(material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe(artifactSpecId);

      await renderer.update(renderAtoms(2));

      const grownMesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      expect(grownMesh.geometry).not.toBe(initialGeometry);
      expect(grownMesh.material).toBe(material);
      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();
      expect(paletteDispose).not.toHaveBeenCalled();
      expect(colormapDispose).not.toHaveBeenCalled();
      expect(materialPaletteDispose).not.toHaveBeenCalled();
      expect(material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe(artifactSpecId);

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
      const mesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      const targetPositions = mesh.geometry.attributes.instanceTargetPosition
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
