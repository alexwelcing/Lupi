/**
 * <AtomClusters /> — coarse splat mesh used for far-LOD rendering.
 *
 * Pairs with <AtomsOptimized /> for huge scenes. The atoms mesh has
 * per-vertex sub-pixel culling that drops far atoms (fragment cost
 * doesn't scale with atom count when most are < 1 px), but that
 * leaves the far view EMPTY. The splat-viewer trick is to aggregate
 * those vanished atoms into one representative billboard per spatial
 * cell, so the user still sees structure at distance.
 *
 * This component renders the cluster set produced by ClusterBuilder.
 * Same impostor-sphere pattern as AtomsOptimized — quad billboard,
 * fragment ray-traces the sphere — as a TSL node material
 * (tsl/clusterSplatMaterial.ts). Splats write no depth: they fade.
 *
 * What's intentionally simpler than AtomsOptimized:
 *   - Color is direct per-instance vec3, not a palette lookup. Each
 *     cluster's average color is baked in at build time.
 *   - No property mode, no etched annotations,
 *     no per-bond gradient — splats are display-only signal, not
 *     interactive picking targets.
 *   - Single quality tier (Lambertian + tiny specular). Far-view
 *     splats don't need IBL — they're fading out before any reflection
 *     detail would be perceptible.
 *
 * The render is gated by a CPU-side `visible` prop; App.tsx drives
 * the LOD switch by computing the average atom pixel-radius and
 * showing splats only when atoms are too small to carry the scene.
 */

import { useEffect, useId, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Clusters } from './ClusterBuilder';
import { LUPI_JOB, LUPI_PHASE } from './framePhases';
import { CLUSTER_ATTR, createClusterSplatMaterial } from './tsl/clusterSplatMaterial';
import { useLupiCommitFrames } from './frameDemand';

export interface AtomClustersProps {
  clusters: Clusters | null;
  /** Hide the mesh entirely (no draw call). When true the LOD logic
   *  has decided the atoms mesh covers this view. */
  visible?: boolean;
  /** View-space distance at which splats begin to appear. Below this,
   *  alpha = 0 — atom mesh owns the close range. */
  fadeNear?: number;
  /** View-space distance at which splats are fully opaque. Beyond this
   *  the cluster mesh carries the entire scene. */
  fadeFar?: number;
}

export function AtomClusters({
  clusters,
  visible = true,
  fadeNear = 80,
  fadeFar = 250,
}: AtomClustersProps) {
  // Imperative uniform/attribute writes on commit (and async results) get drawn.
  useLupiCommitFrames();
  const meshRef = useRef<THREE.Mesh>(null!);
  const count = clusters?.count ?? 0;

  // Rebuild the geometry whenever the cluster set identity changes.
  // For a single load, that's once (post-streaming, when ClusterBuilder
  // returns). The geometry is keyed by the Clusters reference.
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1,  1, 0,
    ]), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    if (clusters && clusters.count > 0) {
      // Buffers fed straight from the typed arrays the ClusterBuilder
      // returned — no per-cluster CPU work per frame.
      geo.setAttribute(CLUSTER_ATTR.position, new THREE.InstancedBufferAttribute(clusters.positions, 3));
      geo.setAttribute(CLUSTER_ATTR.radius, new THREE.InstancedBufferAttribute(clusters.radii, 1));
      geo.setAttribute(CLUSTER_ATTR.color, new THREE.InstancedBufferAttribute(clusters.colors, 3));
      geo.instanceCount = clusters.count;

      // Bounding sphere from the cluster centroid spread; lets Three.js
      // frustum-cull the whole splat mesh when the camera looks away.
      const center = new THREE.Vector3();
      let maxR = 0;
      for (let i = 0; i < clusters.count; i++) {
        center.x += clusters.positions[i * 3];
        center.y += clusters.positions[i * 3 + 1];
        center.z += clusters.positions[i * 3 + 2];
      }
      center.multiplyScalar(1 / clusters.count);
      for (let i = 0; i < clusters.count; i++) {
        const dx = clusters.positions[i * 3] - center.x;
        const dy = clusters.positions[i * 3 + 1] - center.y;
        const dz = clusters.positions[i * 3 + 2] - center.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + clusters.radii[i];
        if (d > maxR) maxR = d;
      }
      geo.boundingSphere = new THREE.Sphere(center, maxR);
    } else {
      geo.instanceCount = 0;
    }
    return geo;
  }, [clusters]);

  // Transparent, no depth write (a fading splat must not cut holes into the
  // atoms behind it), distance fade in the vertex stage.
  const { material, uniforms } = useMemo(
    () => createClusterSplatMaterial({ fadeNear, fadeFar }),
    // The fade range reaches the material through the uniforms job below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Geometry changes per cluster build; material is stable for the component
  // lifetime. Dispose them independently so replacing geometry never leaves
  // the live mesh holding a disposed shader material.
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  // Push the fade range into the splat uniforms before the render. The id is
  // per instance: the scheduler keys jobs by id.
  const uniformsJobId = `${LUPI_JOB.clustersUniforms}:${useId()}`;
  useFrame(() => {
    uniforms.uFadeNear.value = fadeNear;
    uniforms.uFadeFar.value = fadeFar;
  }, { phase: LUPI_PHASE.uniforms, id: uniformsJobId });

  if (!visible || count === 0) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={true} />
  );
}
