// Shared TSL pieces for the atom and bond impostors: view-space lighting
// uniforms, the analytic studio environment and the Cook-Torrance/wrap-diffuse
// BRDF, ported 1:1 from packages/scene/src/AtomsOptimized.tsx (quality tier 1
// analytic path; PMREM IBL, clearcoat, texture modes and etch are out of scope).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, mix, max, clamp, pow, dot, normalize, reflect,
  smoothstep, select, cameraNear, cameraFar, viewZToPerspectiveDepth, viewZToOrthographicDepth,
} from 'three/tsl';

type N = any; // TSL node (the @types/three node typings are too narrow for this spike)

/** Lighting uniforms shared by atoms and bonds (one "mood bus" in miniature). */
export const lights = {
  lightDir: uniform(new THREE.Vector3(0.4, 0.7, 0.6).normalize()),
  fillDir: uniform(new THREE.Vector3(-0.3, -0.2, 0.8).normalize()),
  rimDir: uniform(new THREE.Vector3(0, 0, -1)),
  viewUp: uniform(new THREE.Vector3(0, 1, 0)),
  fillColor: uniform(new THREE.Color('#8888ff')),
  rimColor: uniform(new THREE.Color('#ffffff')),
  rimLight: uniform(0.0),
};

/**
 * 1 when the camera being rendered is orthographic. `onRenderUpdate` replaces
 * the repo's onBeforeRender/syncImpostorRenderTargetUniforms plumbing.
 */
export const uOrtho = uniform(0).onRenderUpdate(({ camera }) =>
  (camera as THREE.OrthographicCamera | null)?.isOrthographicCamera ? 1 : 0,
);
export const isOrtho: N = uOrtho.greaterThan(0.5);

/** View-space ray for the current fragment through a view-space point on the proxy. */
export function viewRay(proxyViewPos: N): { ro: N; rd: N } {
  const ro = select(isOrtho, vec3(proxyViewPos.xy, 0), vec3(0, 0, 0));
  const rd = select(isOrtho, vec3(0, 0, -1), normalize(proxyViewPos));
  return { ro, rd };
}

/** Window-space [0,1] depth for a view-space z, for either camera type. Works on both backends. */
export function depthFromViewZ(viewZ: N): N {
  return select(
    isOrtho,
    viewZToOrthographicDepth(viewZ, cameraNear, cameraFar),
    viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar),
  );
}

export const analyticEnvironment = Fn(([dir, roughness]: [N, N]) => {
  const up = dot(dir, lights.viewUp);
  const sky = vec3(0.86, 0.9, 0.97);
  const horizon = vec3(0.62, 0.62, 0.64);
  const ground = vec3(0.3, 0.28, 0.27);
  const base = select(up.greaterThanEqual(0), mix(horizon, sky, up), mix(horizon, ground, up.negate()));
  const band = smoothstep(0.35, 0.95, up).mul(roughness.mul(0.7).oneMinus());
  return base.add(vec3(0.55).mul(band));
});

/**
 * Lupi's impostor BRDF: GGX D + Smith G + Schlick F specular, Burley wrap
 * diffuse, tinted fill, fresnel rim, analytic IBL and the 8% visibility floor.
 * All vectors in view space; V is +z as in the GLSL original.
 */
export const lupiShade = Fn(([N, baseColor, metalnessIn, roughnessIn, pixelRadius, occlusion, occlusionStrength, subsurface]: N[]) => {
  const V = vec3(0, 0, 1);
  const L = lights.lightDir;
  const H = normalize(L.add(V));
  const NoL = max(dot(N, L), 0.0);
  const NoV = max(dot(N, V), 0.0);
  const NoH = max(dot(N, H), 0.0);
  const LoH = max(dot(L, H), 0.0);

  const metalness = clamp(metalnessIn, 0.0, 1.0);
  const aaRoughness = clamp(float(1.6).div(max(pixelRadius, 1.0)), 0.0, 0.6);
  const roughness = max(clamp(roughnessIn, 0.0, 1.0), aaRoughness);

  const alpha = roughness.mul(roughness);
  const a2 = alpha.mul(alpha);
  const dDen = NoH.mul(NoH).mul(a2.sub(1.0)).add(1.0);
  const D = a2.div(max(dDen.mul(dDen).mul(3.14159), 1e-6));
  const k = alpha.add(1.0).mul(alpha.add(1.0)).div(8.0);
  const G = NoV.div(NoV.mul(k.oneMinus()).add(k)).mul(NoL.div(NoL.mul(k.oneMinus()).add(k)));
  const F0 = mix(vec3(0.04), baseColor, metalness);
  const fresnelRamp = pow(LoH.oneMinus(), 5.0);
  const F = F0.add(vec3(1.0).sub(F0).mul(fresnelRamp));
  const specular = F.mul(D.mul(G)).div(max(NoL.mul(NoV).mul(4.0), 1e-6));

  const wrapNoL = max(dot(N, L).add(0.5).div(1.5), 0.0);
  const backLight = pow(max(dot(N.negate(), L), 0.0), 3.0).mul(subsurface);
  const kD = vec3(1.0).sub(F).mul(metalness.oneMinus());
  const wrapNoL2 = max(dot(N, lights.fillDir).add(0.5).div(1.5), 0.0).mul(0.3);
  const ambient = float(0.15).add(subsurface.mul(0.15)).add(metalness.mul(0.25));
  const openness = mix(1.0, occlusion, occlusionStrength);
  const directOcclusion = mix(1.0, occlusion, occlusionStrength.mul(0.5));

  const rim = pow(NoV.oneMinus(), 4.0);
  const rimDirMask = max(dot(N, lights.rimDir), 0.0);
  const rimBase = mix(0.15, 0.5, metalness).add(subsurface.mul(0.4));
  const rimColor = mix(vec3(1.0), baseColor, metalness).mul(rim).mul(rimBase)
    .add(lights.rimColor.mul(rim).mul(lights.rimLight).mul(rimDirMask))
    .mul(openness);

  const R = reflect(V.negate(), N);
  const envSpec = analyticEnvironment(R, max(roughness, 0.18));
  const envAvg = analyticEnvironment(N, float(1.0)).mul(0.8);

  const envIrradiance = envAvg.mul(ambient.add(0.4)).mul(openness);
  const diffuseIrradiance = envIrradiance
    .add(vec3(1.0).mul(wrapNoL).mul(0.7).mul(directOcclusion))
    .add(lights.fillColor.mul(wrapNoL2).mul(openness));
  const color = kD.mul(baseColor).mul(diffuseIrradiance)
    .add(F0.mul(envSpec).mul(roughness.oneMinus().mul(0.5).add(0.5)).mul(openness))
    .add(specular.mul(NoL).mul(1.5).mul(directOcclusion))
    .add(baseColor.mul(backLight).mul(0.6))
    .add(rimColor);
  return max(color, baseColor.mul(0.08).mul(openness));
});
