import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { bondMaterialParams, createBondBoxGeometry } from './bondImpostor';
import {
  bondMaterialForTier,
  createBondImpostorResources,
  disposeBondImpostorResources,
} from './Bonds';
import { BOND_COLOR_STRIDE, writeBondColor } from './tsl/bondImpostorMaterial';
import { getLupiUniforms, LUPI_UNIFORMS_KEY } from './tsl/lupiUniforms';

describe('bond impostor', () => {
  it('builds a closed unit box with outward-facing triangles', () => {
    const geo = createBondBoxGeometry();
    const position = geo.getAttribute('position') as THREE.BufferAttribute;
    const index = geo.getIndex()!;
    expect(position.count).toBe(8);
    expect(index.count).toBe(36);
    // Every triangle's outward normal must point away from the box center.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const normal = ab.cross(ac);
      centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
    geo.dispose();
  });

  it('writes endpoint colours as one display-sRGB Uint8x4 word', () => {
    const out = new Uint8Array(2 * BOND_COLOR_STRIDE);
    writeBondColor(out, 1, [1, 0.5, -0.2]);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 255, 128, 0, 255]);
  });

  it('builds one node material per tier and program over one shared uniform bag', () => {
    const resources = createBondImpostorResources();
    const tier2 = bondMaterialForTier(resources, 2);
    const tier2Lerp = bondMaterialForTier(resources, 2, true);
    expect(bondMaterialForTier(resources, 2)).toBe(tier2);
    expect(tier2Lerp).not.toBe(tier2);
    for (const material of [bondMaterialForTier(resources, 0), bondMaterialForTier(resources, 1), tier2, tier2Lerp]) {
      expect((material as { isMeshBasicNodeMaterial?: boolean }).isMeshBasicNodeMaterial).toBe(true);
      expect(material.side).toBe(THREE.FrontSide);
      expect(material.vertexNode).toBeTruthy();
      expect(material.depthNode).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
      expect(material.userData[LUPI_UNIFORMS_KEY]).toBe(resources.uniforms);
    }
    const bag = getLupiUniforms(tier2)!;
    for (const key of [
      'uProgress', 'uMetalness', 'uRoughness', 'uSurfaceRoughness', 'uSurfacePolish',
      'uSurfaceClearcoat', 'uOpacity', 'uBondFadeStart', 'uBondFadeEnd', 'uCullPixelRadius',
    ]) {
      expect(bag[key], key).toBeDefined();
    }

    // A material built later inherits the layer's transparency.
    tier2.transparent = true;
    tier2Lerp.transparent = true;
    const late = bondMaterialForTier(resources, 1, true);
    expect(late.transparent).toBe(true);

    const dispose = vi.spyOn(tier2, 'dispose');
    disposeBondImpostorResources(resources);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('maps material presets to the same base parameters the physical material used', () => {
    expect(bondMaterialParams('default')).toEqual({ metalness: 0.35, roughness: 0.45, envIntensity: 1.0 });
    expect(bondMaterialParams('metallic')).toEqual({ metalness: 0.8, roughness: 0.2, envIntensity: 2.0 });
    expect(bondMaterialParams('transmission')).toEqual(bondMaterialParams('glass'));
    expect(bondMaterialParams('matte').roughness).toBeGreaterThan(bondMaterialParams('plastic').roughness);
  });
});
