import * as THREE from 'three';
import {
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER,
} from '@atlas/scene';

export interface ArtifactSceneLayerReadiness {
  readonly ready: boolean;
  readonly taggedMeshCount: number;
  readonly populatedMeshCount: number;
  readonly matchingRevisionCount: number;
}

export type ArtifactAtomSceneReadiness = ArtifactSceneLayerReadiness;

/**
 * Inspect applied Three scene state, not merely the Zustand intent which
 * generated a render spec. A raster artifact may not capture until at least
 * one tagged atom mesh confirms that exact spec revision. Zero visible
 * instances is valid applied state when visibility intentionally hides all
 * atoms, so readiness follows the receipt rather than draw count.
 */
export function inspectArtifactAtomSceneReadiness(
  scene: THREE.Scene,
  expectedSpecId: string,
): ArtifactAtomSceneReadiness {
  return inspectArtifactLayerSceneReadiness(scene, expectedSpecId, LUPI_ARTIFACT_ATOMS_LAYER);
}

/**
 * Require the vector glyph mesh to have committed its exact buffers, uniforms,
 * and colormap before immutable raster readback. Atom readiness alone cannot
 * prove this separately rendered Three layer is current.
 */
export function inspectArtifactVectorGlyphSceneReadiness(
  scene: THREE.Scene,
  expectedSpecId: string,
): ArtifactSceneLayerReadiness {
  return inspectArtifactLayerSceneReadiness(
    scene,
    expectedSpecId,
    LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER,
  );
}

function inspectArtifactLayerSceneReadiness(
  scene: THREE.Scene,
  expectedSpecId: string,
  layer: string,
): ArtifactSceneLayerReadiness {
  let taggedMeshCount = 0;
  let populatedMeshCount = 0;
  let matchingRevisionCount = 0;

  scene.traverse((object) => {
    if (object.userData?.[LUPI_ARTIFACT_LAYER_KEY] !== layer) return;
    taggedMeshCount += 1;

    const mesh = object as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material | THREE.Material[]>;
    const populated = mesh.geometry instanceof THREE.InstancedBufferGeometry
      && mesh.geometry.instanceCount > 0;
    if (populated) populatedMeshCount += 1;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length > 0 && materials.every(material => (
      material.userData?.[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] === expectedSpecId
    ))) {
      matchingRevisionCount += 1;
    }
  });

  return {
    ready: taggedMeshCount > 0 && matchingRevisionCount === taggedMeshCount,
    taggedMeshCount,
    populatedMeshCount,
    matchingRevisionCount,
  };
}
