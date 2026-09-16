import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BOND_IMPOSTOR_FRAGMENT,
  BOND_IMPOSTOR_VERTEX,
  bondMaterialParams,
  createBondBoxGeometry,
} from './bondImpostor';

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

  it('keeps the extension directive first and the tier/depth defines gated', () => {
    expect(BOND_IMPOSTOR_FRAGMENT.trimStart().startsWith('#ifdef LUPI_CONSERVATIVE_DEPTH\n#extension GL_EXT_conservative_depth')).toBe(true);
    expect(BOND_IMPOSTOR_FRAGMENT).toContain('#if LUPI_QUALITY >= 1');
    expect(BOND_IMPOSTOR_FRAGMENT).toContain('gl_FragColor = sRGBTransferOETF(gl_FragColor);');
    expect(BOND_IMPOSTOR_VERTEX).toContain('mix(instanceStart, instanceStartTarget, uProgress)');
  });

  it('maps material presets to the same base parameters the physical material used', () => {
    expect(bondMaterialParams('default')).toEqual({ metalness: 0.35, roughness: 0.45, envIntensity: 1.0 });
    expect(bondMaterialParams('metallic')).toEqual({ metalness: 0.8, roughness: 0.2, envIntensity: 2.0 });
    expect(bondMaterialParams('transmission')).toEqual(bondMaterialParams('glass'));
    expect(bondMaterialParams('matte').roughness).toBeGreaterThan(bondMaterialParams('plastic').roughness);
  });
});
