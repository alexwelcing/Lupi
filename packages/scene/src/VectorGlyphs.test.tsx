import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Frame, VectorFieldSpec } from '@atlas/core';
import {
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_LAYER_KEY,
} from './AtomsOptimized';
import { LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER, VectorGlyphs } from './VectorGlyphs';

const FIELD: VectorFieldSpec = {
  id: 'v',
  label: 'Velocity',
  kind: 'velocity',
  components: ['vx', 'vy', 'vz'],
  magnitudeProperty: '|v|',
};

function vectorFrame(offset = 0, ids: readonly number[] = [1, 2]): Frame {
  return {
    timestep: offset,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
    identity: { kind: 'source-id', unique: true },
    ids: new Int32Array(ids),
    types: new Int32Array([1, 1]),
    positions: new Float32Array([offset, 1, 2, 3 + offset, 4, 5]),
    bonds: new Int32Array(),
    properties: new Map([
      ['vx', new Float32Array([1 + offset, 0])],
      ['vy', new Float32Array([0, 2 + offset])],
      ['vz', new Float32Array([0, 0])],
    ]),
  };
}

describe('VectorGlyphs immutable artifact receipt', () => {
  it('commits buffers and colormap before publishing each exact spec revision', async () => {
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderGlyphs = (
      frame: Frame,
      colormap: 'viridis' | 'plasma',
      artifactSpecId: string,
      hiddenAtomTypes?: Set<number>,
    ) => React.createElement(VectorGlyphs, {
      frame,
      field: FIELD,
      colormap,
      artifactSpecId,
      hiddenAtomTypes,
    });
    const renderer = await ReactThreeTestRenderer.create(
      renderGlyphs(vectorFrame(), 'viridis', 'spec-a'),
    );

    try {
      const initialMesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      const material = initialMesh.material;
      const colormapTexture = material.uniforms.uColormap.value as THREE.DataTexture;
      const initialColormap = Array.from(
        colormapTexture.image.data as Uint8Array,
      );

      expect(colormapTexture.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
      expect(material.fragmentShader.indexOf('#include <colorspace_fragment>')).toBeGreaterThan(
        material.fragmentShader.indexOf('gl_FragColor = vec4(vColor * edge, 1.0);'),
      );
      expect(initialMesh.userData[LUPI_ARTIFACT_LAYER_KEY]).toBe(
        LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER,
      );
      expect(initialMesh.geometry.instanceCount).toBe(2);
      expect(material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe('spec-a');
      expect(Array.from(
        (initialMesh.geometry.attributes.instancePosition as THREE.InstancedBufferAttribute)
          .array.slice(0, 6),
      )).toEqual([0, 1, 2, 3, 4, 5]);

      await renderer.update(renderGlyphs(vectorFrame(1), 'plasma', 'spec-b'));
      const updatedMesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      const updatedColormap = Array.from(
        (updatedMesh.material.uniforms.uColormap.value as THREE.DataTexture).image.data as Uint8Array,
      );

      expect(updatedMesh.material).toBe(material);
      expect(updatedMesh.geometry.instanceCount).toBe(2);
      expect(updatedMesh.material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe('spec-b');
      expect(Array.from(
        (updatedMesh.geometry.attributes.instancePosition as THREE.InstancedBufferAttribute)
          .array.slice(0, 6),
      )).toEqual([1, 1, 2, 4, 4, 5]);
      expect(updatedColormap).not.toEqual(initialColormap);

      await renderer.update(renderGlyphs(vectorFrame(1), 'plasma', 'spec-hidden', new Set([1])));
      const hiddenMesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      expect(hiddenMesh.geometry.instanceCount).toBe(0);
      expect(hiddenMesh.material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY]).toBe('spec-hidden');
    } finally {
      await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});

describe('VectorGlyphs frame identity guard', () => {
  it.each([
    {
      label: 'uploads next-frame positions and vectors when source IDs retain order',
      ids: [1, 2],
      expectedPositions: [1, 1, 2, 4, 4, 5],
      expectedVectors: [2, 0, 0, 0, 3, 0],
    },
    {
      label: 'keeps current positions and vectors when the next frame shuffles source IDs',
      ids: [2, 1],
      expectedPositions: [0, 1, 2, 3, 4, 5],
      expectedVectors: [1, 0, 0, 0, 2, 0],
    },
  ])('$label', async ({ ids, expectedPositions, expectedVectors }) => {
    const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const renderer = await ReactThreeTestRenderer.create(React.createElement(VectorGlyphs, {
      frame: vectorFrame(),
      nextFrame: vectorFrame(1, ids),
      interpolationFactor: 0.5,
      field: FIELD,
      maxGlyphs: 2,
    }));

    try {
      const mesh = renderer.scene.findByType('Mesh')
        .instance as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
      const targetPositions = mesh.geometry.attributes.instanceTargetPosition
        .array as Float32Array;
      const targetVectors = mesh.geometry.attributes.instanceTargetVector
        .array as Float32Array;
      expect(Array.from(targetPositions.slice(0, 6))).toEqual(expectedPositions);
      expect(Array.from(targetVectors.slice(0, 6))).toEqual(expectedVectors);
    } finally {
      await renderer.unmount();
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});
