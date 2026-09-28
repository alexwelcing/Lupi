/**
 * clusterSplatMaterial.ts — the far-LOD cluster splat as a TSL node material
 * (port of the v9 GLSL in AtomClusters.tsx).
 *
 * One view-aligned quad per cluster (1.3 radii wide, at the cluster centre's
 * depth). The fragment casts the view ray against the cluster's bounding
 * sphere, discards misses and shades the hit with a fixed-light Lambert plus a
 * small Blinn-Phong highlight. Splats are transparent and fade in with view
 * distance between `uFadeNear` and `uFadeFar`, so they never smear over the
 * close-range atom detail. No depth write (the fade would cut hard holes into
 * the atoms behind a fading splat) and no per-fragment depth.
 *
 * Colour: the cluster colours are averaged display-sRGB element colours. v9
 * shaded them in display space and wrote the result raw; the port keeps that
 * shading and decodes the result to linear at the end (the renderer output
 * encodes it back, plan-final D14), so a splat reads like the atoms it stands
 * for.
 *
 * Instance layout: `instancePosition` (float32 ×3), `instanceRadius`
 * (float32 ×1) and `instanceColor` (float32 ×3), all straight from
 * ClusterBuilder's typed arrays.
 */
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import {
  Discard,
  Fn,
  attribute,
  cameraProjectionMatrix,
  clamp,
  dot,
  max,
  modelViewMatrix,
  normalize,
  positionGeometry,
  pow,
  sRGBTransferEOTF,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms, type LupiUniformBag } from './lupiUniforms';
import { orthographicFlag, raySphere, viewRay } from './impostorKit';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

export const CLUSTER_ATTR = {
  position: 'instancePosition',
  radius: 'instanceRadius',
  color: 'instanceColor',
} as const;

/** Quad half-size in cluster radii (v9 `expand`). */
export const CLUSTER_QUAD_SCALE = 1.3;

export interface ClusterSplatUniforms extends LupiUniformBag {
  /** View distance where splats start to appear (alpha 0 below it). */
  uFadeNear: UniformNode<'float', number>;
  /** View distance where splats are fully opaque. */
  uFadeFar: UniformNode<'float', number>;
}

export interface ClusterSplatMaterial {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: ClusterSplatUniforms;
}

export function createClusterSplatMaterial(
  { fadeNear = 80, fadeFar = 250 }: { fadeNear?: number; fadeFar?: number } = {},
): ClusterSplatMaterial {
  const uniforms: ClusterSplatUniforms = {
    uFadeNear: uniform(fadeNear),
    uFadeFar: uniform(fadeFar),
  };
  const u = uniforms as unknown as Record<keyof ClusterSplatUniforms, N>;
  const isOrtho: N = orthographicFlag().isOrtho;

  // ── Vertex stage ────────────────────────────────────────────────────
  const center: N = attribute(CLUSTER_ATTR.position, 'vec3');
  const radius: N = attribute(CLUSTER_ATTR.radius, 'float');
  const color: N = attribute(CLUSTER_ATTR.color, 'vec3');
  const viewCenter: N = modelViewMatrix.mul(vec4(center, 1.0)).xyz;
  // Up from invisible at uFadeNear to solid at uFadeFar (camera looks -z).
  const alpha: N = smoothstep(u.uFadeNear, u.uFadeFar, viewCenter.z.negate());
  const corner: N = positionGeometry.xy;
  const quadView: N = vec3(viewCenter.xy.add(corner.mul(radius.mul(CLUSTER_QUAD_SCALE))), viewCenter.z);

  const vViewCenter: N = varying(viewCenter, 'vClusterViewCenter');
  const vRadius: N = varying(radius, 'vClusterRadius');
  const vUv: N = varying(corner, 'vClusterUv');
  const vColor: N = varying(color, 'vClusterColor');
  const vAlpha: N = varying(alpha, 'vClusterAlpha');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'lupi-cluster-splat';
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.transparent = true;
  material.depthTest = true;
  // A fading splat must not reject the atoms behind it.
  material.depthWrite = false;

  material.vertexNode = cameraProjectionMatrix.mul(vec4(quadView, 1.0));

  material.colorNode = (Fn(() => {
    // Faded out: no point tracing a sphere that will not blend in.
    Discard(vAlpha.lessThan(0.01));
    const proxy = vViewCenter.add(vec3(vUv.mul(vRadius.mul(CLUSTER_QUAD_SCALE)), 0.0)).toVar();
    const { ro, rd } = viewRay(proxy, isOrtho);
    const hit = (raySphere(ro, rd, vViewCenter, vRadius) as N).toVar();
    Discard(hit.w.lessThan(0.0));
    const n = normalize(hit.xyz.sub(vViewCenter)).toVar();

    // Fixed view-space key light: far-view signal, not material identity.
    const L = normalize(vec3(0.4, 0.7, 0.6));
    const H = normalize(L.add(vec3(0.0, 0.0, 1.0)));
    const NoL = max(dot(n, L), 0.0);
    const NoH = max(dot(n, H), 0.0);
    const specular = pow(NoH, 24.0).mul(0.3);
    const display = vColor.mul(NoL.mul(0.7).add(0.25)).add(specular);
    const linear = sRGBTransferEOTF(clamp(display, 0.0, 1.0)) as N;
    return vec4(linear, vAlpha);
  }) as N)();

  material.userData[LUPI_SHADER_TAG_KEY] = 'cluster-splat';
  attachLupiUniforms(material, uniforms);
  return { material, uniforms };
}
