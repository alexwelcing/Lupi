import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  bakeInstancedMeshesForExport,
  linearChannelToSrgbByte,
} from './instanceBake';

describe('USDZ palette color encoding', () => {
  it('encodes Three working-linear channels as sRGB texture bytes', () => {
    expect(linearChannelToSrgbByte(0)).toBe(0);
    expect(linearChannelToSrgbByte(1)).toBe(255);
    // 0.5 linear is about 0.735 sRGB, not the incorrectly dark byte 128.
    expect(linearChannelToSrgbByte(0.5)).toBe(188);
    // An authored sRGB 0.5 color is stored by Three near 0.214 linear and must
    // round-trip to the original display byte.
    const linearSrgbHalf = Math.pow((0.5 + 0.055) / 1.055, 2.4);
    expect(linearChannelToSrgbByte(linearSrgbHalf)).toBe(128);
  });

  it('clamps invalid and out-of-gamut working values deterministically', () => {
    expect(linearChannelToSrgbByte(Number.NaN)).toBe(0);
    expect(linearChannelToSrgbByte(-1)).toBe(0);
    expect(linearChannelToSrgbByte(2)).toBe(255);
  });
});

describe('transactional instanced-mesh baking', () => {
  it('restores prior swaps and disposes every accumulated replacement when later progress fails', async () => {
    const scene = new THREE.Scene();
    const first = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshStandardMaterial(),
      1,
    );
    first.name = 'first';
    first.setMatrixAt(0, new THREE.Matrix4());
    first.setColorAt(0, new THREE.Color('red'));

    const second = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshStandardMaterial(),
      1,
    );
    second.name = 'second';
    second.setMatrixAt(0, new THREE.Matrix4().makeTranslation(2, 0, 0));
    second.setColorAt(0, new THREE.Color('blue'));
    scene.add(first, second);

    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const progressError = new Error('progress consumer failed');

    try {
      await expect(bakeInstancedMeshesForExport(scene, {
        onProgress: (done, total) => {
          expect(total).toBe(2);
          if (done === 2) throw progressError;
        },
      })).rejects.toBe(progressError);

      expect(first.parent).toBe(scene);
      expect(second.parent).toBe(scene);
      expect(scene.getObjectByName('first_baked')).toBeUndefined();
      expect(scene.getObjectByName('second_baked')).toBeUndefined();
      expect(geometryDispose).toHaveBeenCalledTimes(2);
      expect(materialDispose).toHaveBeenCalledTimes(2);
      expect(textureDispose).toHaveBeenCalledTimes(2);
    } finally {
      geometryDispose.mockRestore();
      materialDispose.mockRestore();
      textureDispose.mockRestore();
      first.geometry.dispose();
      (first.material as THREE.Material).dispose();
      second.geometry.dispose();
      (second.material as THREE.Material).dispose();
    }
  });
});
