/**
 * Bond impostor geometry and look parameters.
 *
 * One instance per bond: the vertex stage builds a tight box around the
 * cylinder from its two endpoints (GPU-interpolated between frames) and the
 * fragment ray-casts a finite cylinder with flat caps, writing exact depth.
 * Bonds are pixel-perfect round at any zoom with no radial segments. The
 * node material lives in tsl/bondImpostorMaterial.ts.
 */

import * as THREE from 'three';

/** Unit box geometry shared by every bond instance: 8 corners, 12 triangles,
 *  front faces outward (counter-clockwise). */
export function createBondBoxGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const corners = new Float32Array([
    -1, -1, -1,  1, -1, -1,  1, 1, -1,  -1, 1, -1,
    -1, -1,  1,  1, -1,  1,  1, 1,  1,  -1, 1,  1,
  ]);
  const indices = new Uint16Array([
    // -z face, +z face
    0, 2, 1,  0, 3, 2,
    4, 5, 6,  4, 6, 7,
    // -x face, +x face
    0, 4, 7,  0, 7, 3,
    1, 2, 6,  1, 6, 5,
    // -y face (A end), +y face (B end)
    0, 1, 5,  0, 5, 4,
    3, 7, 6,  3, 6, 2,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(corners, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** Material preset → base metalness/roughness for the bond impostor. */
export function bondMaterialParams(
  preset: 'default' | 'matte' | 'metallic' | 'glass' | 'plastic' | 'transmission',
): { metalness: number; roughness: number; envIntensity: number } {
  switch (preset) {
    case 'matte': return { metalness: 0.05, roughness: 0.85, envIntensity: 1.0 };
    case 'metallic': return { metalness: 0.8, roughness: 0.2, envIntensity: 2.0 };
    case 'glass':
    case 'transmission': return { metalness: 0.3, roughness: 0.05, envIntensity: 1.5 };
    case 'plastic': return { metalness: 0.0, roughness: 0.4, envIntensity: 1.0 };
    default: return { metalness: 0.35, roughness: 0.45, envIntensity: 1.0 };
  }
}
