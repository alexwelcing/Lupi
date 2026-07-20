// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER,
} from '@atlas/scene';
import {
  inspectArtifactAtomSceneReadiness,
  inspectArtifactVectorGlyphSceneReadiness,
} from './artifactSceneReadiness';

function addArtifactMesh(
  scene: THREE.Scene,
  layer: string,
  instanceCount: number,
  specId: string | null,
) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = instanceCount;
  const material = new THREE.ShaderMaterial();
  material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] = specId;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData[LUPI_ARTIFACT_LAYER_KEY] = layer;
  scene.add(mesh);
  return mesh;
}

function addAtomMesh(scene: THREE.Scene, instanceCount: number, specId: string | null) {
  return addArtifactMesh(scene, LUPI_ARTIFACT_ATOMS_LAYER, instanceCount, specId);
}

function addVectorGlyphMesh(scene: THREE.Scene, instanceCount: number, specId: string | null) {
  return addArtifactMesh(scene, LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER, instanceCount, specId);
}

describe('artifact atom scene readiness', () => {
  it('requires a populated tagged mesh with the exact applied spec revision', () => {
    const scene = new THREE.Scene();
    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a')).toEqual({
      ready: false,
      taggedMeshCount: 0,
      populatedMeshCount: 0,
      matchingRevisionCount: 0,
    });

    addAtomMesh(scene, 0, 'spec-a');
    addAtomMesh(scene, 3, 'spec-old');
    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: false,
      taggedMeshCount: 2,
      populatedMeshCount: 1,
      matchingRevisionCount: 1,
    });

    addAtomMesh(scene, 3, 'spec-a');
    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: false,
      populatedMeshCount: 2,
      matchingRevisionCount: 2,
    });
  });

  it('accepts one populated atom layer carrying the exact revision', () => {
    const scene = new THREE.Scene();
    addAtomMesh(scene, 3, 'spec-a');
    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: true,
      taggedMeshCount: 1,
      populatedMeshCount: 1,
      matchingRevisionCount: 1,
    });
  });

  it('accepts exact applied atom state which intentionally draws zero instances', () => {
    const scene = new THREE.Scene();
    addAtomMesh(scene, 0, 'spec-a');
    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: true,
      taggedMeshCount: 1,
      populatedMeshCount: 0,
      matchingRevisionCount: 1,
    });
  });
});

describe('artifact vector-glyph scene readiness', () => {
  it('does not let atom readiness stand in for the independently applied vector layer', () => {
    const scene = new THREE.Scene();
    addAtomMesh(scene, 3, 'spec-a');
    addVectorGlyphMesh(scene, 3, 'spec-old');

    expect(inspectArtifactAtomSceneReadiness(scene, 'spec-a').ready).toBe(true);
    expect(inspectArtifactVectorGlyphSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: false,
      taggedMeshCount: 1,
      populatedMeshCount: 1,
      matchingRevisionCount: 0,
    });
  });

  it('accepts exact vector state even when visibility intentionally draws zero glyphs', () => {
    const scene = new THREE.Scene();
    addVectorGlyphMesh(scene, 0, 'spec-a');
    expect(inspectArtifactVectorGlyphSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: true,
      taggedMeshCount: 1,
      populatedMeshCount: 0,
      matchingRevisionCount: 1,
    });

    addVectorGlyphMesh(scene, 3, 'spec-old');
    expect(inspectArtifactVectorGlyphSceneReadiness(scene, 'spec-a')).toMatchObject({
      ready: false,
      taggedMeshCount: 2,
      populatedMeshCount: 1,
      matchingRevisionCount: 1,
    });
  });
});
