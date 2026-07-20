// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DREI_ENVIRONMENT_ASSET_REVISION,
  assertSceneEnvironmentReady,
  environmentAssetIdentity,
  installSceneEnvironmentPmrem,
  markSceneEnvironmentReady,
} from './sceneEnvironment';

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
});

describe('scene PMREM lifecycle ownership', () => {
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
