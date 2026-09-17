/**
 * Bond impostor shaders — ray-cast cylinders on instanced boxes.
 *
 * One instance per bond. The vertex shader builds a tight box around the
 * cylinder from its two endpoints (GPU-interpolated between frames) and the
 * fragment shader ray-casts a finite cylinder with flat caps, writing exact
 * depth. Bonds are pixel-perfect round at any zoom with no radial segments,
 * and per-bond GPU data is 34 bytes (58 with a trajectory target) instead of
 * two 64-byte instance matrices plus colors and taper radii.
 *
 * Same conventions as the atom impostor (see AtomsOptimized.tsx): raw GLSL
 * ES 3.00, optional EXT_conservative_depth (box front faces are always in
 * front of any cylinder hit), quality-tier defines, shared IBL chunk, and
 * self-owned output color-space conversion.
 */

import * as THREE from 'three';

const CUBE_UV_CHUNK = THREE.ShaderChunk.cube_uv_reflection_fragment;

export const BOND_IMPOSTOR_VERTEX = /* glsl */ `
  precision highp float;
  precision highp int;

  // Unit box corner in {-1, 1}^3: x/z span the radius, y spans A -> B.
  in vec3 position;
  in vec3 instanceStart;
  in vec3 instanceEnd;
  in vec3 instanceStartTarget;
  in vec3 instanceEndTarget;
  in float instanceRadius;
  in vec3 instanceColorStart; // display-sRGB, normalized u8
  in vec3 instanceColorEnd;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uProgress;
  uniform float uPixelScale;
  uniform int uOrthographic;
  uniform float uCullPixelRadius;
  uniform float uBondFadeEnd;

  out vec3 vA;
  out vec3 vB;
  out float vRadius;
  out vec3 vViewPos;
  out vec3 vColorA;
  out vec3 vColorB;
  out float vPixelRadius;

  vec3 srgbToLinear(vec3 c) {
    return mix(pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), c * 0.0773993808, vec3(lessThanEqual(c, vec3(0.04045))));
  }

  void main() {
    vec3 a = mix(instanceStart, instanceStartTarget, uProgress);
    vec3 b = mix(instanceEnd, instanceEndTarget, uProgress);
    vec3 viewA = (modelViewMatrix * vec4(a, 1.0)).xyz;
    vec3 viewB = (modelViewMatrix * vec4(b, 1.0)).xyz;
    vec3 axis = viewB - viewA;
    float len = length(axis);
    float radius = instanceRadius;
    vec3 mid = 0.5 * (viewA + viewB);
    float viewDepth = max(-mid.z, 1e-4);
    float pixelRadius = uOrthographic == 1 ? radius * uPixelScale : radius * uPixelScale / viewDepth;

    // Degenerate, sub-pixel, or fully faded bonds collapse to nothing.
    if (len <= 1e-6 || radius <= 0.0 || pixelRadius < uCullPixelRadius || viewDepth > uBondFadeEnd) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vA = vec3(0.0); vB = vec3(0.0); vRadius = 0.0; vViewPos = vec3(0.0);
      vColorA = vec3(0.0); vColorB = vec3(0.0); vPixelRadius = 0.0;
      return;
    }

    vec3 dir = axis / len;
    vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 u = normalize(cross(dir, ref));
    vec3 v = cross(dir, u);
    // Slight expansion keeps the box conservative under float rounding.
    float expand = radius * 1.05;
    vec3 corner = mix(viewA, viewB, position.y * 0.5 + 0.5)
      + u * (position.x * expand)
      + v * (position.z * expand);

    vA = viewA;
    vB = viewB;
    vRadius = radius;
    vViewPos = corner;
    vColorA = srgbToLinear(instanceColorStart);
    vColorB = srgbToLinear(instanceColorEnd);
    vPixelRadius = pixelRadius;
    gl_Position = projectionMatrix * vec4(corner, 1.0);
  }
`;

export const BOND_IMPOSTOR_FRAGMENT = /* glsl */ `
#ifdef LUPI_CONSERVATIVE_DEPTH
#extension GL_EXT_conservative_depth : enable
#endif
  precision highp float;
  precision highp int;
  precision highp sampler2D;
#ifdef LUPI_CONSERVATIVE_DEPTH
  // Front faces of the bounding box are never behind a cylinder hit.
  layout (depth_greater) out highp float gl_FragDepth;
#endif
  #define texture2D texture
  #define saturate(a) clamp(a, 0.0, 1.0)

  in vec3 vA;
  in vec3 vB;
  in float vRadius;
  in vec3 vViewPos;
  in vec3 vColorA;
  in vec3 vColorB;
  in float vPixelRadius;

  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor

  uniform mat4 projectionMatrix;
  uniform float uMetalness;
  uniform float uRoughness;
  uniform float uSurfaceRoughness;
  uniform float uSurfacePolish;
  uniform float uSurfaceClearcoat;
  uniform float uOpacity;
  uniform float uBondFadeStart;
  uniform float uBondFadeEnd;
  uniform vec3 uLightDir;
  uniform vec3 uFillLightDir;
  uniform vec3 uRimLightDir;
  uniform vec3 uViewUp;
  uniform vec3 uFillLightColor;
  uniform vec3 uRimLightColor;
  uniform float uRimLight;
  uniform sampler2D tEnvMap;
  uniform float uEnvIntensity;
  uniform int uHasEnv;
  uniform int uOutputSrgb;
#if LUPI_QUALITY >= 1
  #define ENVMAP_TYPE_CUBE_UV
  #define envMap tEnvMap
  ${CUBE_UV_CHUNK}
#endif

  vec4 sRGBTransferOETF( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
  }

  vec3 analyticEnvironment(vec3 dir, float roughness) {
    float up = dot(dir, uViewUp);
    vec3 sky = vec3(0.86, 0.90, 0.97);
    vec3 horizon = vec3(0.62, 0.62, 0.64);
    vec3 ground = vec3(0.30, 0.28, 0.27);
    vec3 base = up >= 0.0 ? mix(horizon, sky, up) : mix(horizon, ground, -up);
    float band = smoothstep(0.35, 0.95, up) * (1.0 - roughness * 0.7);
    return base + vec3(0.55) * band;
  }

  void main() {
    // Ray from the eye through this box-surface point; finite cylinder A->B.
    vec3 d = normalize(vViewPos);
    vec3 axis = vB - vA;
    float len = length(axis);
    axis /= max(len, 1e-6);
    vec3 oc = -vA;
    float card = dot(axis, d);
    float caoc = dot(axis, oc);
    vec3 dPerp = d - card * axis;
    vec3 ocPerp = oc - caoc * axis;
    float a = dot(dPerp, dPerp);
    float b = dot(dPerp, ocPerp);
    float c = dot(ocPerp, ocPerp) - vRadius * vRadius;

    float t;
    float y;
    vec3 normal;
    bool sideHit = false;
    if (a > 1e-8) {
      float h = b * b - a * c;
      if (h < 0.0) discard;
      t = (-b - sqrt(h)) / a;
      y = caoc + t * card;
      sideHit = (y >= 0.0 && y <= len);
    }
    if (!sideHit) {
      // Try the flat caps.
      if (abs(card) < 1e-6) discard;
      // Choose the nearer cap that the ray actually enters through.
      float t0 = (0.0 - caoc) / card;
      float t1 = (len - caoc) / card;
      float tc = min(t0, t1);
      float yc = tc == t0 ? 0.0 : len;
      vec3 P = tc * d;
      vec3 rel = P - vA - yc * axis;
      if (dot(rel, rel) > vRadius * vRadius) {
        tc = max(t0, t1);
        yc = tc == t0 ? 0.0 : len;
        P = tc * d;
        rel = P - vA - yc * axis;
        if (dot(rel, rel) > vRadius * vRadius) discard;
      }
      t = tc;
      y = yc;
      normal = yc == 0.0 ? -axis : axis;
    } else {
      vec3 P = t * d;
      normal = normalize((P - vA) - y * axis);
    }
    if (t <= 0.0) discard;
    vec3 hitPoint = t * d;

    // Distance fade (LOD): far bonds thin out before the vertex cull removes them.
    float viewDist = -hitPoint.z;
    float fade = 1.0 - smoothstep(uBondFadeStart, uBondFadeEnd, viewDist);
    if (fade <= 0.001) discard;

    // Two-tone split at the geometric midpoint.
    vec3 baseColor = (y / max(len, 1e-6)) < 0.5 ? vColorA : vColorB;

    float metalness = clamp(uMetalness + uSurfacePolish, 0.0, 1.0);
    float roughness = clamp(uRoughness + uSurfaceRoughness, 0.0, 1.0);
    float aaRoughness = clamp(1.6 / max(vPixelRadius, 1.0), 0.0, 0.6);
    roughness = max(roughness, aaRoughness);

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 L = uLightDir;
    vec3 H = normalize(L + V);
    float NoL = max(dot(normal, L), 0.0);
    float NoV = max(dot(normal, V), 0.0);
    float NoH = max(dot(normal, H), 0.0);
    float LoH = max(dot(L, H), 0.0);

    float alpha = roughness * roughness;
    float a2 = alpha * alpha;
    float D_denom = (NoH * NoH) * (a2 - 1.0) + 1.0;
    float D = a2 / max(3.14159 * D_denom * D_denom, 1e-6);
    float k = (alpha + 1.0) * (alpha + 1.0) / 8.0;
    float G = (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
    vec3 F0 = mix(vec3(0.04), baseColor, metalness);
    float fresnelRamp = pow(1.0 - LoH, 5.0);
    vec3 F = F0 + (vec3(1.0) - F0) * fresnelRamp;
    vec3 specular = (D * G) * F / max(4.0 * NoL * NoV, 1e-6);

#if LUPI_QUALITY >= 2
    float clearcoat = uSurfaceClearcoat;
    if (clearcoat > 0.0) {
      float ccRoughness = max(0.1, aaRoughness);
      float ccAlpha = ccRoughness * ccRoughness;
      float ccAlphaSq = ccAlpha * ccAlpha;
      float ccD_denom = (NoH * NoH) * (ccAlphaSq - 1.0) + 1.0;
      float ccD = ccAlphaSq / max(3.14159 * ccD_denom * ccD_denom, 1e-6);
      float cck = (ccAlpha + 1.0) * (ccAlpha + 1.0) / 8.0;
      float ccG = (NoV / (NoV * (1.0 - cck) + cck)) * (NoL / (NoL * (1.0 - cck) + cck));
      vec3 ccF = vec3(0.04) + vec3(0.96) * fresnelRamp;
      vec3 ccSpecular = (ccD * ccG) * ccF / max(4.0 * NoL * NoV, 1e-6);
      specular = specular * (1.0 - ccF * clearcoat) + ccSpecular * clearcoat;
    }
#endif

    float wrapHalf = 0.5;
    float wrapNoL = max((dot(normal, L) + wrapHalf) / (1.0 + wrapHalf), 0.0);
    float wrapNoL2 = max((dot(normal, uFillLightDir) + wrapHalf) / (1.0 + wrapHalf), 0.0) * 0.3;
    vec3 kD = (vec3(1.0) - F) * (1.0 - metalness);
    float ambient = 0.15 + metalness * 0.25;

    float rim = pow(1.0 - NoV, 4.0);
    float rimDirMask = max(dot(normal, uRimLightDir), 0.0);
    vec3 rimColor = mix(vec3(1.0), baseColor, metalness) * rim * mix(0.15, 0.5, metalness)
      + uRimLightColor * rim * uRimLight * rimDirMask;

    vec3 reflectVec = reflect(-V, normal);
    vec3 envSpec;
    vec3 envAvg;
#if LUPI_QUALITY >= 1
    if (uHasEnv == 1) {
      envSpec = textureCubeUV(tEnvMap, reflectVec, max(roughness, 0.18)).rgb * uEnvIntensity;
      envAvg  = textureCubeUV(tEnvMap, normal,     1.0).rgb * uEnvIntensity;
    } else {
      envSpec = analyticEnvironment(reflectVec, max(roughness, 0.18));
      envAvg  = analyticEnvironment(normal, 1.0) * 0.8;
    }
#else
    envSpec = analyticEnvironment(reflectVec, max(roughness, 0.18));
    envAvg  = analyticEnvironment(normal, 1.0) * 0.8;
#endif

    vec3 diffuseIrradiance = envAvg * (ambient + 0.4) + vec3(1.0) * wrapNoL * 0.7 + uFillLightColor * wrapNoL2;
    vec3 color = kD * baseColor * diffuseIrradiance
      + F0 * envSpec * (0.5 + 0.5 * (1.0 - roughness))
      + specular * NoL * 1.5
      + rimColor;
    color = max(color, baseColor * 0.08);

    vec4 clipPos = projectionMatrix * vec4(hitPoint, 1.0);
    gl_FragDepth = (clipPos.z / clipPos.w) * 0.5 + 0.5;

    gl_FragColor = vec4(color, uOpacity * fade);
    if (uOutputSrgb == 1) {
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    }
  }
`;

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
