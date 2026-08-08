// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DREI_ENVIRONMENT_ASSET_REVISION,
  SOFTBOX_ENVIRONMENT_FILE,
  SOFTBOX_ENVIRONMENT_REVISION,
  assertSceneEnvironmentReady,
  environmentAssetIdentity,
  installSceneEnvironmentPmrem,
  markSceneEnvironmentReady,
} from './sceneEnvironment';
import {
  SCIENTIFIC_STUDIO_RIG,
  buildScientificStudioScene,
  buildSoftboxFalloffTexture,
  installScientificStudioEnvironment,
} from './studioEnvironment';

describe('render environment identity', () => {
  it('accepts only the exact tagged PMREM texture requested by the artifact spec', () => {
    const texture = new THREE.Texture({ width: 768, height: 1024 });
    texture.mapping = THREE.CubeUVReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    markSceneEnvironmentReady(texture, 'studio');
    const expected = environmentAssetIdentity('studio');

    expect(() => assertSceneEnvironmentReady(texture, expected)).not.toThrow();
    expect(() => assertSceneEnvironmentReady(texture, {
      ...expected,
      assetRevision: '0'.repeat(40),
    })).toThrow(/not capture-ready/);
    expect(() => assertSceneEnvironmentReady(new THREE.Texture(), expected)).toThrow(/not capture-ready/);
    expect(DREI_ENVIRONMENT_ASSET_REVISION).toHaveLength(40);
  });

  it('requires an empty scene environment when the spec selects none', () => {
    expect(() => assertSceneEnvironmentReady(null, { preset: 'none' })).not.toThrow();
    expect(() => assertSceneEnvironmentReady(new THREE.Texture(), { preset: 'none' })).toThrow(
      /scene still has an environment texture/,
    );
  });

  it('identifies the procedural softbox studio with a contract-shaped identity', () => {
    const identity = environmentAssetIdentity('softbox');
    expect(identity).toEqual({
      preset: 'softbox',
      assetRevision: SOFTBOX_ENVIRONMENT_REVISION,
      file: SOFTBOX_ENVIRONMENT_FILE,
      colorSpace: 'srgb-linear',
    });
    // renderArtifact v1 requires a 40-64 char hex asset revision.
    expect(SOFTBOX_ENVIRONMENT_REVISION).toMatch(/^[0-9a-f]{40,64}$/);

    const texture = new THREE.Texture({ width: 768, height: 1024 });
    texture.mapping = THREE.CubeUVReflectionMapping;
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    markSceneEnvironmentReady(texture, 'softbox');
    expect(() => assertSceneEnvironmentReady(texture, identity)).not.toThrow();
    expect(() => assertSceneEnvironmentReady(texture, environmentAssetIdentity('studio'))).toThrow(
      /not capture-ready/,
    );
  });
});

describe('procedural scientific-studio softbox environment', () => {
  it('builds one emissive panel per rig entry plus the backdrop dome', () => {
    const built = buildScientificStudioScene();
    const meshes = built.scene.children.filter(child => (child as THREE.Mesh).isMesh);
    expect(meshes).toHaveLength(SCIENTIFIC_STUDIO_RIG.panels.length + 1);
    // Panels carry HDR emission (> 1) so PMREM produces real key/fill light.
    const key = meshes[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    expect(Math.max(key.material.color.r, key.material.color.g, key.material.color.b))
      .toBeGreaterThan(1);
    built.dispose();
  });

  it('feathers the softbox falloff so reflections have no hard rectangle edges', () => {
    const texture = buildSoftboxFalloffTexture(32, 0.4);
    const data = texture.image.data as Float32Array;
    const texel = (x: number, y: number) => data[(y * 32 + x) * 4];
    expect(texel(0, 0)).toBeLessThan(0.05);       // corner ~ black
    expect(texel(16, 16)).toBeCloseTo(1, 5);      // center fully lit
    expect(texel(8, 16)).toBeGreaterThan(0.05);   // mid-falloff is smooth,
    expect(texel(8, 16)).toBeLessThan(1);         // not a step function
    texture.dispose();
  });

  it('bakes once from scene, tags the softbox identity, and cleans up exactly once', () => {
    const scene = new THREE.Scene();
    const previous = new THREE.Texture();
    scene.environment = previous;
    const generated = new THREE.Texture({ width: 768, height: 1024 });
    generated.mapping = THREE.CubeUVReflectionMapping;
    generated.colorSpace = THREE.LinearSRGBColorSpace;
    const disposeTarget = vi.fn();
    const generator = {
      fromScene: vi.fn(() => ({ texture: generated, dispose: disposeTarget })),
      dispose: vi.fn(),
    };

    const cleanup = installScientificStudioEnvironment(scene, () => generator);
    expect(generator.fromScene).toHaveBeenCalledOnce();
    expect(generator.dispose).toHaveBeenCalledOnce();
    expect(scene.environment).toBe(generated);
    expect(() => assertSceneEnvironmentReady(
      generated,
      environmentAssetIdentity('softbox'),
    )).not.toThrow();

    cleanup();
    cleanup();
    expect(scene.environment).toBe(previous);
    expect(disposeTarget).toHaveBeenCalledOnce();
  });
});

describe('scene PMREM lifecycle ownership', () => {
  it('refuses a degenerate PMREM atlas and keeps the previous environment', () => {
    const scene = new THREE.Scene();
    const previous = new THREE.Texture();
    scene.environment = previous;
    // A 1px atlas would make three emit integer CUBEUV texel defines that
    // strict GLSL drivers reject for every environment-lit material.
    const generated = new THREE.Texture({ width: 1, height: 1 });
    generated.mapping = THREE.CubeUVReflectionMapping;
    generated.colorSpace = THREE.LinearSRGBColorSpace;
    const disposeTarget = vi.fn();
    const generator = {
      compileEquirectangularShader: vi.fn(),
      fromEquirectangular: vi.fn(() => ({ texture: generated, dispose: disposeTarget })),
      dispose: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const cleanup = installSceneEnvironmentPmrem(scene, new THREE.Texture(), 'studio', () => generator);
      expect(scene.environment).toBe(previous);
      expect(disposeTarget).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();
      cleanup();
      expect(scene.environment).toBe(previous);
    } finally {
      warn.mockRestore();
    }
  });

  it('commits in the effect transaction and restores/disposes exactly once', () => {
    const scene = new THREE.Scene();
    const previous = new THREE.Texture();
    scene.environment = previous;
    const source = new THREE.Texture();
    const generated = new THREE.Texture({ width: 768, height: 1024 });
    generated.mapping = THREE.CubeUVReflectionMapping;
    generated.colorSpace = THREE.LinearSRGBColorSpace;
    const disposeTarget = vi.fn();
    const generator = {
      compileEquirectangularShader: vi.fn(),
      fromEquirectangular: vi.fn(() => ({ texture: generated, dispose: disposeTarget })),
      dispose: vi.fn(),
    };

    const cleanup = installSceneEnvironmentPmrem(scene, source, 'studio', () => generator);
    expect(generator.compileEquirectangularShader).toHaveBeenCalledOnce();
    expect(generator.fromEquirectangular).toHaveBeenCalledWith(source);
    expect(generator.dispose).toHaveBeenCalledOnce();
    expect(scene.environment).toBe(generated);
    expect(() => assertSceneEnvironmentReady(
      generated,
      environmentAssetIdentity('studio'),
    )).not.toThrow();

    cleanup();
    cleanup();
    expect(scene.environment).toBe(previous);
    expect(disposeTarget).toHaveBeenCalledOnce();
  });
});
