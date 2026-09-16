/**
 * <AtomsOptimized /> — Impostor Billboard Sphere Renderer
 *
 * Professional molecular visualization technique used by VMD, PyMOL, OVITO:
 * - 1 quad per atom (2 triangles) instead of 80-triangle sphere meshes
 * - Fragment shader ray-traces pixel-perfect spheres with correct depth
 * - GPU-side color lookup via palette textures — changing colormap is instant
 * - Per-instance data uploaded ONCE per frame change, not per animation frame
 * - 40× triangle reduction, zero per-frame CPU→GPU copies during orbit
 *
 * Large-scene architecture (millions of atoms):
 * - Compact instance layout: 12 B position + 1 B type slot + 2 B property +
 *   1 B occlusion per atom. Radius, visibility and per-type scale live in a
 *   256-entry radius palette, so scaling or hiding atom types is a texture
 *   update rather than an O(n) buffer re-upload. Static molecules alias the
 *   interpolation target buffer to the position buffer (no second copy).
 * - The atom index is `gl_InstanceID` — instances are never compacted, hidden
 *   atoms are culled on the GPU by a zero palette radius.
 * - Sub-pixel culling: atoms whose projected radius falls under a threshold
 *   collapse to a degenerate quad in the vertex shader (the far-LOD cluster
 *   splats carry the silhouette instead).
 * - Quality tiers compile the fragment shader with or without image-based
 *   lighting; very large scenes drop to an analytic hemisphere model.
 * - When the browser exposes EXT_conservative_depth, the fragment shader
 *   declares `layout(depth_greater)` and the billboard sits on the front
 *   tangent plane, so the hardware keeps early-Z rejection even though the
 *   ray-cast sphere writes its own depth. Dense scenes with heavy overdraw
 *   skip most shading work for occluded fragments.
 *
 * The material is a RawShaderMaterial (GLSL ES 3.00): the `#extension`
 * directive must precede every non-preprocessor token, and Three's managed
 * prefix begins with precision statements. The shader therefore owns its
 * output color-space conversion, mirroring Three's rule (sRGB to the screen,
 * linear into render targets).
 *
 * Color architecture:
 * - Instance attributes store typeId (u8 slot) and propValue (u16 normalized)
 * - A 256×1 DataTexture (uPalette) maps typeId → RGB color
 * - A 256×1 DataTexture (uColormap) maps normalized property → RGB color
 * - Changing colormap/colorMode updates only tiny textures, not 1M atoms
 */

import { useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { wrapDelta } from './interpolation';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Frame, ColormapName } from '@atlas/core/types';
import { SpatialHash3D } from './SpatialHash';

import { COLORMAPS, DEFAULT_TYPE_COLOR } from './constants';
import { DEFAULT_PROFILE, getElementProfile } from './materials';
import { framesShareAtomOrder, hexToRgb } from '@atlas/core';
import { buildTypeRenderTable, typeRenderTablesEqual, type TypeRenderTable } from './typeRenderTable';

// ─── Types ───────────────────────────────────────────────────────────
export type AtomQualityTier = 0 | 1 | 2;

interface AtomsOptimizedProps {
  frame: Frame;
  nextFrame?: Frame;
  interpolationFactor?: number;
  colorMode?: 'type' | 'uniform' | 'property';
  colorProperty?: string;
  colormap?: ColormapName;
  uniformColor?: string;
  elementColorOverrides?: Record<number, string>;
  propRange?: [number, number];
  scale?: number;
  maxAtoms?: number;
  onSpatialHash?: (hash: SpatialHash3D) => void;
  highlightedAtoms?: Set<number>;
  hiddenAtomTypes?: Set<number>;
  atomTypeScales?: Record<number, number>;
  /** 'transmission' has no impostor implementation; this renderer treats it
   *  as 'glass' so oversized scenes falling back from AtomsTransmission still
   *  read glassy. */
  materialPreset?: 'default' | 'matte' | 'metallic' | 'glass' | 'plastic' | 'transmission';
  /** 0 = pure per-element identity, 1 = full preset override. Scenes can
   *  blend, e.g. 0.7 means 70% preset + 30% element character. */
  materialIntensity?: number;
  /** Rim / backlight intensity. Adds a backlit edge for depth separation.
   *  0 = material-driven only, >0 = additive rim boost. */
  rimLightIntensity?: number;
  surfaceRoughness?: number;
  surfacePolish?: number;
  surfaceClearcoat?: number;
  keyLightAzimuth?: number;
  keyLightElevation?: number;
  fillLightAzimuth?: number;
  fillLightElevation?: number;
  rimLightAzimuth?: number;
  rimLightElevation?: number;
  fillLightColor?: string;
  rimLightColor?: string;
  atomTexture?: 'none' | 'scratched' | 'noise';
  /** Where per-type atom colors come from. Overrides the legacy
   *  colormap-only behavior. 'colormap' is the original default. */
  atomColorSource?: 'colormap' | 'element';
  /** Etched annotation texture — text rasterized via Canvas2D, alpha
   *  channel used as the stamp mask. When set together with `etchAtomId`,
   *  the impostor shader engraves it onto that atom's surface. */
  etchTexture?: THREE.Texture | null;
  /** Atom index whose surface gets the etched text. -1 / null disables. */
  etchAtomId?: number | null;
  /** Strength of property-driven emission (0..1). When > 0 and colorMode
   *  is 'property', atoms glow proportional to their normalized property
   *  value × this strength × the colormap-mapped color. Reads as
   *  "this atom is energetic". */
  propertyEmissionStrength?: number;
  /** How many atoms have been uploaded so far (for progressive streaming).
   *  Defaults to frame.natoms when not set. */
  loadedAtomCount?: number;
  /** Integer index of the loaded `frame` within its trajectory. Paired with
   *  `liveStateRef` to drive GPU interpolation progress at display rate. */
  frameIndex?: number;
  /** Live playback ref (updated every RAF tick by useSmoothFramePlayback). Its
   *  `effectiveFrame` minus `frameIndex` gives uProgress at 60fps with no React
   *  re-render. Falls back to `interpolationFactor` when absent. */
  liveStateRef?: { readonly current: { readonly effectiveFrame: number } | null };
  /** Artifact revision this mesh has applied to geometry and material state. */
  artifactSpecId?: string;
  /** Fragment-shader complexity requested by the device profile. The
   *  renderer lowers it further for very large atom counts. */
  qualityTier?: AtomQualityTier;
  /** Atoms whose projected radius is below this many device pixels are
   *  culled in the vertex shader. 0 disables culling. */
  cullPixelRadius?: number;
  /** Per-atom openness (0 = fully buried, 255 = fully exposed), typically
   *  from `computeAtomOcclusion`. Null leaves every atom fully lit. */
  occlusion?: Uint8Array | null;
  /** How strongly per-atom occlusion darkens ambient/environment light. */
  occlusionStrength?: number;
}

interface ScalarMaterialUniforms {
  uSurfaceClearcoat: { value: number };
  uSurfacePolish: { value: number };
  uSurfaceRoughness: { value: number };
}

interface SurfaceUniformValues {
  surfaceClearcoat?: number;
  surfacePolish?: number;
  surfaceRoughness?: number;
}

export function syncSurfaceMaterialUniforms(
  uniforms: ScalarMaterialUniforms,
  values: SurfaceUniformValues,
): void {
  uniforms.uSurfaceRoughness.value = values.surfaceRoughness ?? 0;
  uniforms.uSurfacePolish.value = values.surfacePolish ?? 0;
  uniforms.uSurfaceClearcoat.value = values.surfaceClearcoat ?? 0;
}

const OWNED_MATERIAL_TEXTURE_UNIFORMS = [
  'uPalette',
  'uColormap',
  'uMaterialPalette',
  'uRadiusPalette',
] as const;

export function disposeOwnedMaterialTextures(
  uniforms: Record<string, { value?: { dispose?: () => void } | null }>,
): void {
  for (const name of OWNED_MATERIAL_TEXTURE_UNIFORMS) {
    uniforms[name]?.value?.dispose?.();
  }
}

const IMPOSTOR_BOUND_RADIUS_SCALE = 1.3;

export interface AtomInterpolationExtents {
  count: number;
  finite: boolean;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  maxInstanceRadius: number;
}

/**
 * Build a conservative local-space bound for every position the GPU can draw.
 * The caller accumulates both interpolation endpoints; linear interpolation
 * then stays inside their shared AABB for every clamped uProgress value.
 */
export function createAtomInterpolationBoundingSphere(
  extents: AtomInterpolationExtents,
): THREE.Sphere {
  if (extents.count <= 0) {
    return new THREE.Sphere(new THREE.Vector3(), 0);
  }

  if (!extents.finite || ![
    extents.minX,
    extents.minY,
    extents.minZ,
    extents.maxX,
    extents.maxY,
    extents.maxZ,
    extents.maxInstanceRadius,
  ].every(Number.isFinite)) {
    // Invalid live data must fail open: keep the batch visible instead of
    // allowing a NaN bound to make an otherwise-valid batch disappear.
    return new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
  }

  const center = new THREE.Vector3(
    (extents.minX + extents.maxX) * 0.5,
    (extents.minY + extents.maxY) * 0.5,
    (extents.minZ + extents.maxZ) * 0.5,
  );
  const halfX = (extents.maxX - extents.minX) * 0.5;
  const halfY = (extents.maxY - extents.minY) * 0.5;
  const halfZ = (extents.maxZ - extents.minZ) * 0.5;
  const radius = Math.hypot(halfX, halfY, halfZ)
    + Math.abs(extents.maxInstanceRadius) * IMPOSTOR_BOUND_RADIUS_SCALE;

  return Number.isFinite(radius)
    ? new THREE.Sphere(center, radius)
    : new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
}

export function resolveLoadedAtomCount(
  frameAtomCount: number,
  loadedAtomCount?: number,
): number {
  const frameCount = Number.isFinite(frameAtomCount)
    ? Math.max(0, Math.trunc(frameAtomCount))
    : 0;
  if (loadedAtomCount === undefined) return frameCount;
  if (!Number.isFinite(loadedAtomCount)) return 0;
  return Math.max(0, Math.min(frameCount, Math.trunc(loadedAtomCount)));
}

/**
 * Mark the exact component span written this upload using Three's current
 * BufferAttribute range API. `updateRange` was removed; stale ranges must be
 * cleared before adding the next frame's smaller or larger span.
 */
export function markInstancedAttributeUpdateRange(
  attribute: THREE.InstancedBufferAttribute,
  componentCount: number,
): void {
  attribute.clearUpdateRanges();
  const safeCount = Number.isFinite(componentCount)
    ? Math.max(0, Math.min(attribute.array.length, Math.trunc(componentCount)))
    : 0;
  if (safeCount === 0) return;
  attribute.addUpdateRange(0, safeCount);
  attribute.needsUpdate = true;
}

/**
 * Effective fragment-shader tier for a scene. Device tiers describe what the
 * GPU can sustain per pixel; atom count multiplies that per-pixel cost by
 * overdraw, so very large scenes drop to the analytic lighting model even on
 * a discrete GPU. Image-based lighting is the dominant per-fragment cost.
 */
export const QUALITY_TIER_IBL_ATOM_LIMIT = 2_000_000;
export const QUALITY_TIER_FULL_ATOM_LIMIT = 400_000;

export function resolveAtomQualityTier(
  requestedTier: AtomQualityTier | undefined,
  atomCount: number,
): AtomQualityTier {
  const requested = requestedTier === 0 || requestedTier === 1 ? requestedTier : 2;
  const byCount: AtomQualityTier = atomCount > QUALITY_TIER_IBL_ATOM_LIMIT
    ? 0
    : atomCount > QUALITY_TIER_FULL_ATOM_LIMIT
      ? 1
      : 2;
  return Math.min(requested, byCount) as AtomQualityTier;
}

/**
 * Dense-slot lookup from a frame's raw type ids to palette slots. Raw LAMMPS
 * and glimbin types are small non-negative integers, so a typed array beats a
 * Map lookup per atom by an order of magnitude on million-atom uploads.
 */
export function buildTypeSlotLookup(
  table: TypeRenderTable,
): { dense: Int16Array | null; base: number; sparse: ReadonlyMap<number, number> } {
  let minRaw = Number.POSITIVE_INFINITY;
  let maxRaw = Number.NEGATIVE_INFINITY;
  for (const entry of table.entries) {
    if (entry.rawType < minRaw) minRaw = entry.rawType;
    if (entry.rawType > maxRaw) maxRaw = entry.rawType;
  }
  const sparse = new Map<number, number>();
  for (const entry of table.entries) sparse.set(entry.rawType, entry.slot);
  if (
    table.entries.length === 0
    || !Number.isInteger(minRaw)
    || !Number.isInteger(maxRaw)
    || maxRaw - minRaw > 65_535
  ) {
    return { dense: null, base: 0, sparse };
  }
  const dense = new Int16Array(maxRaw - minRaw + 1).fill(-1);
  for (const entry of table.entries) dense[entry.rawType - minRaw] = entry.slot;
  return { dense, base: minRaw, sparse };
}

// ─── GLSL Shaders ────────────────────────────────────────────────────

// Three.js exports `cube_uv_reflection_fragment` (and the `defines`-style
// constants it needs) — including this chunk gives our shader the
// `textureCubeUV(envMap, direction, roughness)` function that decodes the
// octahedral-packed cubeUV atlas drei's <Environment> produces. This is
// the same machinery MeshStandardMaterial uses for PMREM-prefiltered
// scene.environment.
const CUBE_UV_CHUNK = THREE.ShaderChunk.cube_uv_reflection_fragment;

export const IMPOSTOR_VERTEX = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  // Quad corner in [-1, 1]
  in vec3 position;
  // Per-instance attributes. Type slot is an unsigned byte read as a float,
  // property is a normalized u16, occlusion a normalized u8.
  in vec3 instancePosition;
  in vec3 instanceTargetPosition;
  in float instanceTypeId;
  in float instancePropValue;
  in float instanceOcclusion;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  // Uniforms for GPU color lookup
  uniform sampler2D uPalette;        // 256×1: typeId → color
  uniform sampler2D uColormap;       // 256×1: propValue [0,1] → color
  uniform sampler2D uRadiusPalette;  // 256×1 R32F: typeId → world radius (0 = hidden)
  uniform int uColorMode;            // 0=type, 1=uniform, 2=property
  uniform vec3 uUniformColor;
  uniform float uProgress;           // 0..1 GPU lerp: instancePosition -> instanceTargetPosition
  // Device pixels per world unit at unit view depth (perspective) or per
  // world unit (orthographic). Drives sub-pixel culling and specular AA.
  uniform float uPixelScale;
  uniform int uOrthographic;
  uniform float uCullPixelRadius;

  // Passed to fragment
  out vec3 vColor;
  out vec2 vUv;
  out vec3 vViewCenter;
  out float vRadius;
  out float vTypeId;
  out float vPropValue;
  out float vAtomId;
  out float vPixelRadius;
  out float vOcclusion;

  void main() {
    float slotU = (instanceTypeId + 0.5) / 256.0;
    float radius = texture(uRadiusPalette, vec2(slotU, 0.5)).r;

    // GPU-side frame interpolation: lerp current -> target by the global progress
    // uniform. The CPU re-uploads the two position buffers only on a frame change,
    // not per interpolation substep — uProgress alone sweeps the motion.
    vec3 lerpedPos = mix(instancePosition, instanceTargetPosition, uProgress);
    vec4 viewCenter4 = modelViewMatrix * vec4(lerpedPos, 1.0);

    float viewDepth = max(-viewCenter4.z, 1e-4);
    float pixelRadius = uOrthographic == 1
      ? radius * uPixelScale
      : radius * uPixelScale / viewDepth;

    // Hidden types carry a zero palette radius. Sub-pixel atoms collapse to a
    // degenerate clip-space point: no fragments, no shading, no depth writes.
    if (radius <= 0.0 || pixelRadius < uCullPixelRadius) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec3(0.0);
      vUv = vec2(0.0);
      vViewCenter = vec3(0.0);
      vRadius = 0.0;
      vTypeId = 0.0;
      vPropValue = 0.0;
      vAtomId = -1.0;
      vPixelRadius = 0.0;
      vOcclusion = 1.0;
      return;
    }

    vTypeId = instanceTypeId;
    vPropValue = instancePropValue;
    vAtomId = float(gl_InstanceID);
    vPixelRadius = pixelRadius;
    vOcclusion = instanceOcclusion;

    // ─── GPU-side color lookup ───
    if (uColorMode == 2) {
      // Property mode: sample colormap by normalized property value
      vColor = texture(uColormap, vec2(instancePropValue, 0.5)).rgb;
    } else if (uColorMode == 1) {
      // Uniform mode
      vColor = uUniformColor;
    } else {
      // Type mode: sample palette by typeId
      vColor = texture(uPalette, vec2(slotU, 0.5)).rgb;
    }

    vUv = position.xy;
    vRadius = radius;
    vViewCenter = viewCenter4.xyz;

    // Billboard: offset the quad corner in view space. The quad sits on the
    // sphere's front tangent plane (center.z + radius, toward the camera) so
    // every ray-cast hit is at or behind the rasterized quad depth — the
    // invariant EXT_conservative_depth's depth_greater relies on.
    vec3 viewPos = viewCenter4.xyz;
    float expand = radius * 1.3;
    viewPos.xy += position.xy * expand;
    viewPos.z += radius;

    gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  }
`;

export const IMPOSTOR_FRAGMENT = /* glsl */ `
#ifdef LUPI_CONSERVATIVE_DEPTH
#extension GL_EXT_conservative_depth : enable
#endif
  precision highp float;
  precision highp int;
  precision highp sampler2D;
#ifdef LUPI_CONSERVATIVE_DEPTH
  // The billboard is on the front tangent plane, so the sphere hit depth is
  // always >= the interpolated quad depth. Declaring that lets the GPU keep
  // early depth rejection despite the gl_FragDepth write.
  layout (depth_greater) out highp float gl_FragDepth;
#endif
  #define texture2D texture
  #define saturate(a) clamp(a, 0.0, 1.0)

  in vec3 vColor;
  in vec2 vUv;
  in vec3 vViewCenter;
  in float vRadius;
  in float vTypeId;
  in float vPropValue;
  in float vAtomId;
  in float vPixelRadius;
  in float vOcclusion;

  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor

  uniform mat4 projectionMatrix;
  // Etched annotation: a Canvas2D-rasterized text texture stamped onto the
  // facing hemisphere of a single targeted atom. Activated when uHasEtch=1
  // and the fragment's vAtomId matches uEtchAtomId. Uses the view-space
  // normal as the stamp UV so the text always reads to camera (it follows
  // the silhouette, not the world). The alpha channel of the texture
  // darkens the surface to give an engraved feel.
  uniform sampler2D tEtchTexture;
  uniform float uEtchAtomId;
  uniform int uHasEtch;
  uniform int uTextureMode; // 0: none, 1: noise, 2: scratched
  uniform int uColorMode; // 0=type, 1=uniform, 2=property — same scheme as vertex
  uniform int uMaterialPreset; // 0: per-element (default), 1: matte, 2: metallic, 3: glass, 4: plastic
  // 0..1: blend between per-element identity (0) and preset override (1).
  // Lets Material Scenes partially preserve element character while
  // applying a global look.
  uniform float uMaterialIntensity;
  // User-controllable rim light boost (additive over the material-driven rim).
  uniform float uRimLight;
  // Granular Surface Character overrides.
  // uSurfaceRoughness and uSurfacePolish act as offsets to the active material profile.
  uniform float uSurfaceRoughness;
  uniform float uSurfacePolish;
  uniform float uSurfaceClearcoat;
  uniform vec3 uLightDir;
  uniform vec3 uFillLightDir;
  uniform vec3 uRimLightDir;
  uniform vec3 uViewUp;
  uniform vec3 uFillLightColor;
  uniform vec3 uRimLightColor;
  // 256×2 RGBA: row 0 = (metalness, roughness, anisotropy, subsurface),
  //             row 1 = (emission r, emission g, emission b, intensity).
  uniform sampler2D uMaterialPalette;
  // IBL — single source of truth. tEnvMap is drei's <Environment> output:
  // a PMREM-prefiltered, octahedral-packed cubeUV atlas (Three.js's
  // CubeUVReflectionMapping). textureCubeUV (provided by the
  // cube_uv_reflection_fragment chunk injected below) decodes it correctly,
  // including roughness-based mip selection. uHasEnv=0 ('diagram' preset)
  // falls back to an analytic hemisphere so atoms still read as solid.
  uniform sampler2D tEnvMap;
  uniform float uEnvIntensity;
  uniform int uHasEnv;
  // Per-atom occlusion strength (0 = ignore the occlusion attribute).
  uniform float uOcclusionStrength;
  // 1 when rendering straight to the sRGB canvas; 0 into linear targets.
  uniform int uOutputSrgb;
#if LUPI_QUALITY >= 1
  // ENVMAP_TYPE_CUBE_UV gates Three.js's cube_uv_reflection_fragment chunk
  // so its textureCubeUV() definition is visible to us. CUBEUV_TEXEL_*
  // and CUBEUV_MAX_MIP are injected from the actual PMREM atlas dimensions.
  // The chunk also requires the uniform
  // be named "envMap" (not tEnvMap) — alias it.
  #define ENVMAP_TYPE_CUBE_UV
  #define envMap tEnvMap
  ${CUBE_UV_CHUNK}
#endif
  // Property-driven emission strength. 0 disables; >0 makes atoms glow
  // proportional to their normalized property value × colormap-mapped color.
  uniform float uPropEmission;

  // Three-light setup in view space
  // Key, fill, and rim light dirs are dynamic and passed via uniforms.

  // Simple pseudo-random noise function
  float rand(vec2 co) {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
  }

  vec4 sRGBTransferOETF( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
  }

  // Analytic studio environment used when no PMREM probe is installed (and
  // by the fast tier). A cool sky / warm-neutral ground hemisphere plus a
  // broad overhead softbox band gives metals and dielectrics a believable
  // reflection without any texture fetch.
  vec3 analyticEnvironment(vec3 dir, float roughness) {
    float up = dot(dir, uViewUp);
    vec3 sky = vec3(0.86, 0.90, 0.97);
    vec3 horizon = vec3(0.62, 0.62, 0.64);
    vec3 ground = vec3(0.30, 0.28, 0.27);
    vec3 base = up >= 0.0 ? mix(horizon, sky, up) : mix(horizon, ground, -up);
    // Softbox: a wide highlight band overhead, blurred by roughness.
    float band = smoothstep(0.35, 0.95, up) * (1.0 - roughness * 0.7);
    return base + vec3(0.55) * band;
  }

  void main() {
    // Ray-sphere intersection in view space. The fragment lies on the front
    // tangent plane (see the vertex shader).
    float expand = vRadius * 1.3;
    vec3 fragViewPos = vViewCenter + vec3(vUv * expand, vRadius);

    vec3 rayDir = normalize(fragViewPos);
    vec3 oc = -vViewCenter;

    float b = dot(oc, rayDir);
    float c = dot(oc, oc) - vRadius * vRadius;
    float discriminant = b * b - c;

    if (discriminant < 0.0) {
      discard;
    }

    float t = -b - sqrt(discriminant);
    vec3 hitPoint = rayDir * t;
    vec3 normal = normalize(hitPoint - vViewCenter);

    // ─── Material lookup ────────────────────────────────────────────
    // Always sample per-element profile from the material palette first.
    // Then, if a preset override is active (uMaterialPreset > 0), blend
    // between per-element and preset based on uMaterialIntensity.
    // This is the key upgrade: Material Scenes can partially preserve
    // element character (Au still looks gold-ish on a partial Forge blend).
    float metalness, roughness, subsurface;
    vec3 emissionColor = vec3(0.0);
    float emissionIntensity = 0.0;

    // Step 1: per-element identity (always sampled)
    vec2 paletteUv = vec2((vTypeId + 0.5) / 256.0, 0.25);
    vec4 elemMat = texture2D(uMaterialPalette, paletteUv);
    float elemMetal = elemMat.r;
    float elemRough = elemMat.g;
    float elemSSS   = elemMat.a;

    vec4 e = texture2D(uMaterialPalette, vec2(paletteUv.x, 0.75));
    emissionColor = e.rgb;
    emissionIntensity = e.a;

    // Step 2: preset override values
    float presetMetal, presetRough, presetSSS;
    if (uMaterialPreset == 1)      { presetMetal = 0.05; presetRough = 0.85; presetSSS = 0.0; }
    else if (uMaterialPreset == 2) { presetMetal = 0.8;  presetRough = 0.2;  presetSSS = 0.0; }
    else if (uMaterialPreset == 3) { presetMetal = 0.1;  presetRough = 0.1;  presetSSS = 0.4; }
    else if (uMaterialPreset == 4) { presetMetal = 0.0;  presetRough = 0.4;  presetSSS = 0.0; }
    else                           { presetMetal = elemMetal; presetRough = elemRough; presetSSS = elemSSS; }

    // Step 3: blend by materialIntensity
    metalness  = mix(elemMetal, presetMetal, uMaterialIntensity);
    roughness  = mix(elemRough, presetRough, uMaterialIntensity);
    subsurface = mix(elemSSS,   presetSSS,   uMaterialIntensity);

    // Step 4: apply granular user offsets (Polish/Roughness)
    metalness = clamp(metalness + uSurfacePolish, 0.0, 1.0);
    roughness = clamp(roughness + uSurfaceRoughness, 0.0, 1.0);

    // Step 5: specular anti-aliasing. On a sphere only a few pixels wide
    // the normal sweeps the whole hemisphere inside one pixel; a sharp
    // lobe then strobes as the camera moves. Widen the lobe as the atom's
    // pixel footprint shrinks (geometric specular AA, footprint-driven).
    float aaRoughness = clamp(1.6 / max(vPixelRadius, 1.0), 0.0, 0.6);
    roughness = max(roughness, aaRoughness);

    // ─── Cook-Torrance microfacet shading ───────────────────────────
    //   - GGX D + Smith G + Schlick F microfacet specular
    //   - Burley-style wrap diffuse for soft shadow rolloff
    //   - Subsurface backlight: light "transmits" to the shadow side for
    //     translucent atoms (H, O, noble gases) — they read as dewdrops
    //     not painted balls
    //   - Schlick fresnel ramps reflectivity at grazing — gives Cu/Au/Ag
    //     the chrome-edge that distinguishes them from plastic
    //
    // We're in view space here, so the camera direction is +z from any
    // fragment. That simplifies F/G calculations.
    vec3 V = vec3(0.0, 0.0, 1.0); // view direction in view space, fragment-relative
    vec3 L = uLightDir;
    vec3 H = normalize(L + V);
    float NoL = max(dot(normal, L), 0.0);
    float NoV = max(dot(normal, V), 0.0);
    float NoH = max(dot(normal, H), 0.0);
    float LoH = max(dot(L, H), 0.0);

    // Isotropic GGX. alpha grows with roughness² (the standard
    // perceptually-linear remap).
    float alpha = roughness * roughness;
    float a2 = alpha * alpha;
    float D_denom = (NoH * NoH) * (a2 - 1.0) + 1.0;
    float D = a2 / max(3.14159 * D_denom * D_denom, 1e-6);

    // Smith G (height-correlated approximation). Cheap.
    float k = (alpha + 1.0) * (alpha + 1.0) / 8.0;
    float G_V = NoV / (NoV * (1.0 - k) + k);
    float G_L = NoL / (NoL * (1.0 - k) + k);
    float G = G_V * G_L;

    // Schlick fresnel. F0 is 0.04 for dielectrics (typical glass/plastic),
    // base color for metals. The (1-F0)*(1-LoH)^5 ramp gives chrome the
    // bright edge.
    vec3 F0 = mix(vec3(0.04), vColor, metalness);
    float fresnelRamp = pow(1.0 - LoH, 5.0);
    vec3 F = F0 + (vec3(1.0) - F0) * fresnelRamp;

    // Cook-Torrance specular term. The 4 NoL NoV in the denominator is
    // standard; the max protects against divide-by-zero at silhouettes.
    vec3 specular = (D * G) * F / max(4.0 * NoL * NoV, 1e-6);

#if LUPI_QUALITY >= 2
    // ─── Clearcoat ──────────────────────────────────────────────────
    // A secondary specular lobe on top of the base material.
    // Fixed low roughness, high F0 to simulate a polished resin/varnish layer.
    float clearcoat = uSurfaceClearcoat;
    if (clearcoat > 0.0) {
      float ccRoughness = max(0.1, aaRoughness);
      float ccAlpha = ccRoughness * ccRoughness;
      float ccAlphaSq = ccAlpha * ccAlpha;
      float ccD_denom = (NoH * NoH) * (ccAlphaSq - 1.0) + 1.0;
      float ccD = ccAlphaSq / max(3.14159 * ccD_denom * ccD_denom, 1e-6);

      float cck = (ccAlpha + 1.0) * (ccAlpha + 1.0) / 8.0;
      float ccG_V = NoV / (NoV * (1.0 - cck) + cck);
      float ccG_L = NoL / (NoL * (1.0 - cck) + cck);
      float ccG = ccG_V * ccG_L;

      // Clearcoat F0 is fixed at 0.04 (IOR ~1.5)
      vec3 ccF0 = vec3(0.04);
      vec3 ccF = ccF0 + (vec3(1.0) - ccF0) * fresnelRamp;

      vec3 ccSpecular = (ccD * ccG) * ccF / max(4.0 * NoL * NoV, 1e-6);

      // Add clearcoat specular, and energy conserve the base layer
      specular = specular * (1.0 - ccF * clearcoat) + ccSpecular * clearcoat;
    }
#endif

    // ─── Diffuse with subsurface ──────────────────────────────────────
    // Burley wrap: smooths the shadow terminator. wrapHalf=1 is half-Lambert.
    float wrapHalf = 0.5; // tuneable; higher = softer transition
    float wrapNoL = max((dot(normal, L) + wrapHalf) / (1.0 + wrapHalf), 0.0);

    // Subsurface backlight: when the normal points away from the light,
    // simulate light transmitting through the material to the shadow side.
    // This is what makes a dewdrop, milky glass, or noble-gas atom read as
    // "lit from within" rather than as a painted shadow.
    float backLight = max(dot(-normal, L), 0.0);
    backLight = pow(backLight, 3.0) * subsurface;

    // Combine: dielectric portion uses (1-F) energy conservation; metalness
    // attenuates the diffuse term entirely (metals don't have diffuse).
    vec3 kD = (vec3(1.0) - F) * (1.0 - metalness);

    // Secondary fill light — wrap-shaded for consistency.
    float wrapNoL2 = max((dot(normal, uFillLightDir) + wrapHalf) / (1.0 + wrapHalf), 0.0) * 0.3;

    // Ambient floor — raised for metals since they have near-zero kD
    // (no diffuse channel) and depend entirely on env reflections.
    // When the PMREM probe is missing, metals would be invisible.
    float ambient = 0.15 + subsurface * 0.15 + metalness * 0.25;

    // Per-atom occlusion: buried atoms receive less ambient/environment light
    // and a softer key light. This is view-independent and survives any
    // zoom level, unlike screen-space AO.
    float openness = mix(1.0, vOcclusion, uOcclusionStrength);
    float directOcclusion = mix(1.0, vOcclusion, uOcclusionStrength * 0.5);

    // Rim — Schlick-style fresnel rim for visual depth. Material-driven
    // base + user-controllable uRimLight additive boost for depth separation.
    float rim = pow(1.0 - NoV, 4.0);
    float rimDirMask = max(dot(normal, uRimLightDir), 0.0);
    float rimBase = mix(0.15, 0.5, metalness) + subsurface * 0.4;
    // Base rim comes from all sides (white/vColor), extra rim light is directional and tinted
    vec3 rimBaseColor = mix(vec3(1.0), vColor, metalness) * rim * rimBase;
    vec3 rimDirColor = uRimLightColor * rim * uRimLight * rimDirMask;
    vec3 rimColor = (rimBaseColor + rimDirColor) * openness;

    // Apply texture based on uniform
    vec3 texColor = vColor;
#if LUPI_QUALITY >= 2
    if (uTextureMode == 1) {
      // Noise
      float noiseVal = rand(vUv * 500.0);
      texColor *= mix(0.7, 1.0, noiseVal);
    } else if (uTextureMode == 2) {
      // Scratched (procedural lines)
      float line = rand(floor(vUv * 100.0));
      if (line > 0.95 && rand(vUv * 50.0) > 0.5) {
        texColor *= 0.5;
      }
    }
#endif

    // ─── Environment lighting ────────────────────────────────────────
    // tEnvMap is drei's <Environment>, processed by Three's PMREMGenerator.
    // textureCubeUV (from cube_uv_reflection_fragment) decodes the
    // octahedral-packed atlas and selects the right mip from roughness.
    // Specular probe: along reflection vector. Diffuse irradiance: along
    // surface normal at near-max roughness (acts as a tinted ambient).
    vec3 reflectVec = reflect(-V, normal);
    vec3 envSpec;
    vec3 envAvg;
#if LUPI_QUALITY >= 1
    if (uHasEnv == 1) {
      // Roughness floor for the mip select: impostor-sphere normals vary
      // fast across a pixel, so sampling the sharpest env mips on low-
      // roughness metals aliased into a crawling shimmer under motion.
      // Clamping to ~0.18 costs negligible sharpness, kills the strobe.
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

    // Final combine — Cook-Torrance + Burley diffuse + subsurface backlight + rim + IBL + emission.
    //   - Diffuse uses Burley wrap (wrapNoL) which softens the shadow line.
    //   - kD = (1-F)(1-metalness) implements energy conservation: metals
    //     have no diffuse contribution, dielectrics share energy with spec.
    //   - IBL specular: F0 * envSpec gives metals a real-feeling environment
    //     reflection that varies with viewing angle.
    //   - IBL diffuse: envAvg as the ambient-irradiance color (tinted!).
    //   - Specular is the full Cook-Torrance term × NoL.
    //   - backLight × texColor gives translucent atoms a subtle glow on
    //     the shadow side — dewdrop / glass / noble gas read.
    //   - Rim is fresnel-driven, color-tinted by metalness.
    //   - Emission: per-element baseline glow from the palette row 1.
    vec3 envIrradiance = envAvg * (ambient + 0.4) * openness;
    // Main directional light is considered white, fill light is tinted
    vec3 diffuseIrradiance = envIrradiance
      + vec3(1.0) * wrapNoL * 0.7 * directOcclusion
      + uFillLightColor * wrapNoL2 * openness;
    vec3 diffuseTerm = kD * texColor * diffuseIrradiance;
    vec3 iblSpecular = F0 * envSpec * (0.5 + 0.5 * (1.0 - roughness)) * openness;
    vec3 specularTerm = specular * NoL * 1.5 * directOcclusion;
    vec3 backTerm = texColor * backLight * 0.6;
    // Per-element emission baseline + property-driven emission boost.
    //   - Baseline: per-element emission × intensity (radioactives glow).
    //   - Property-driven: when in property color mode, atoms with high
    //     normalized property emit additional light tinted by the colormap-
    //     mapped color. Reads as "this atom is doing something."
    vec3 emissive = emissionColor * emissionIntensity;
    if (uColorMode == 2 && uPropEmission > 0.0) {
      emissive += vColor * vPropValue * uPropEmission;
    }
    vec3 color = diffuseTerm + iblSpecular + specularTerm + backTerm + rimColor + emissive;

    // ─── Minimum visibility floor ──────────────────────────────────
    // Guarantee atoms are always distinguishable from the background,
    // even when the env map fails to load or metallic BRDF zeroes out
    // the diffuse channel. This is a perceptual safety net, not a
    // physical term — it adds a tiny amount of base color so no atom
    // ever renders as pure black.
    vec3 minFloor = texColor * 0.08 * openness;
    color = max(color, minFloor);

    // ─── Etched annotation overlay ────────────────────────────────────
    // Only the targeted atom executes this branch. We project the
    // view-space normal into a stamp UV: the camera-facing pole maps to
    // (0.5, 0.5), edges of the visible hemisphere fall outside [0,1].
    // etchScale > 1.0 keeps the text inside a small central patch of the
    // silhouette so it reads as a label, not a tattoo wrapping around.
    if (uHasEtch == 1 && abs(vAtomId - uEtchAtomId) < 0.5) {
      float etchScale = 1.5;
      vec2 etchUv = vec2(normal.x * etchScale + 0.5, -normal.y * etchScale + 0.5);
      if (etchUv.x > 0.0 && etchUv.x < 1.0 && etchUv.y > 0.0 && etchUv.y < 1.0) {
        float etchAlpha = texture2D(tEtchTexture, etchUv).a;
        // Darken where text is (engraved depth) plus a subtle warm tint so
        // it reads as a stamped marker rather than a paint splotch.
        vec3 engraved = color * 0.32;
        color = mix(color, engraved, etchAlpha);
      }
    }

    // Correct depth via projected hit point
    vec4 clipPos = projectionMatrix * vec4(hitPoint, 1.0);
    float ndcDepth = clipPos.z / clipPos.w;
    gl_FragDepth = ndcDepth * 0.5 + 0.5;

    gl_FragColor = vec4(color, 1.0);
    // Output color space: Three applies sRGBTransferOETF when the target is
    // the canvas and none into linear render targets. A raw material owns
    // that rule itself (uOutputSrgb is set in onBeforeRender).
    if (uOutputSrgb == 1) {
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    }
  }
`;

export interface CubeUvShaderDefines {
  CUBEUV_TEXEL_WIDTH: number;
  CUBEUV_TEXEL_HEIGHT: number;
  CUBEUV_MAX_MIP: number;
}

export function cubeUvShaderDefinesForAtlas(
  atlasWidth: number,
  atlasHeight: number,
): CubeUvShaderDefines {
  if (!Number.isFinite(atlasWidth) || atlasWidth <= 0 || !Number.isFinite(atlasHeight) || atlasHeight <= 0) {
    throw new Error('CubeUV atlas dimensions must be finite and positive.');
  }
  const cubeSize = Math.min(atlasWidth / 3, atlasHeight / 4);
  return {
    CUBEUV_TEXEL_WIDTH: 1 / atlasWidth,
    CUBEUV_TEXEL_HEIGHT: 1 / atlasHeight,
    CUBEUV_MAX_MIP: Math.max(0, Math.floor(Math.log2(cubeSize))),
  };
}

export function cubeUvShaderDefinesForTexture(texture: THREE.Texture): CubeUvShaderDefines | null {
  const image = texture.image as { width?: unknown; height?: unknown } | undefined;
  const width = typeof image?.width === 'number' ? image.width : Number.NaN;
  const height = typeof image?.height === 'number' ? image.height : Number.NaN;
  if (!(width > 0) || !(height > 0)) return null;
  return cubeUvShaderDefinesForAtlas(width, height);
}

const EMPTY_CUBE_UV_DEFINES = cubeUvShaderDefinesForAtlas(1, 1);

function glslFloatDefine(value: number): string {
  const literal = String(value);
  return /[.eE]/.test(literal) ? literal : `${literal}.0`;
}

export function materialCubeUvDefines(defines: CubeUvShaderDefines): Record<string, string> {
  return {
    // Three injects these values as preprocessor tokens. Integer-looking
    // JavaScript numbers become GLSL ints, and SwiftShader correctly rejects
    // `vec2.y *= int`. Serialize every CubeUV constant as a float literal,
    // including the 1x1 no-environment fallback used on first render.
    CUBEUV_TEXEL_WIDTH: glslFloatDefine(defines.CUBEUV_TEXEL_WIDTH),
    CUBEUV_TEXEL_HEIGHT: glslFloatDefine(defines.CUBEUV_TEXEL_HEIGHT),
    CUBEUV_MAX_MIP: glslFloatDefine(defines.CUBEUV_MAX_MIP),
  };
}

/** Sync one exact CubeUV atlas and recompile only when its dimensions change. */
export function syncCubeUvEnvironment(
  material: THREE.ShaderMaterial,
  environment: THREE.Texture | null,
): void {
  const validEnvironment = environment?.mapping === THREE.CubeUVReflectionMapping
    ? environment
    : null;
  const nextDefines = validEnvironment
    ? cubeUvShaderDefinesForTexture(validEnvironment)
    : EMPTY_CUBE_UV_DEFINES;
  const usableEnvironment = validEnvironment && nextDefines ? validEnvironment : null;
  const resolvedDefines = nextDefines ?? EMPTY_CUBE_UV_DEFINES;
  const materialDefines = materialCubeUvDefines(resolvedDefines);
  const current = material.defines;
  if (
    current.CUBEUV_TEXEL_WIDTH !== materialDefines.CUBEUV_TEXEL_WIDTH
    || current.CUBEUV_TEXEL_HEIGHT !== materialDefines.CUBEUV_TEXEL_HEIGHT
    || current.CUBEUV_MAX_MIP !== materialDefines.CUBEUV_MAX_MIP
  ) {
    material.defines = { ...material.defines, ...materialDefines };
    material.needsUpdate = true;
  }
  material.uniforms.tEnvMap.value = usableEnvironment;
  material.uniforms.uHasEnv.value = usableEnvironment ? 1 : 0;
}

/**
 * Sync the compile-time quality/early-Z defines. Returns true when the
 * material was flagged for recompilation.
 */
export function syncAtomShaderDefines(
  material: THREE.ShaderMaterial,
  qualityTier: AtomQualityTier,
  conservativeDepth: boolean,
): boolean {
  const current = material.defines;
  const nextQuality = String(qualityTier);
  const wantsConservative = conservativeDepth ? '1' : undefined;
  if (
    current.LUPI_QUALITY === nextQuality
    && current.LUPI_CONSERVATIVE_DEPTH === wantsConservative
  ) {
    return false;
  }
  const defines: Record<string, string> = { ...current, LUPI_QUALITY: nextQuality };
  if (wantsConservative) defines.LUPI_CONSERVATIVE_DEPTH = wantsConservative;
  else delete defines.LUPI_CONSERVATIVE_DEPTH;
  material.defines = defines;
  material.needsUpdate = true;
  return true;
}

/** Cached per-context probe for EXT_conservative_depth. */
const conservativeDepthSupport = new WeakMap<object, boolean>();

export function rendererSupportsConservativeDepth(
  renderer: { getContext?: () => unknown } | null | undefined,
): boolean {
  if (!renderer || typeof renderer.getContext !== 'function') return false;
  let context: unknown;
  try {
    context = renderer.getContext();
  } catch {
    return false;
  }
  if (!context || typeof context !== 'object') return false;
  const cached = conservativeDepthSupport.get(context);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    const gl = context as { getExtension?: (name: string) => unknown };
    supported = typeof gl.getExtension === 'function'
      && Boolean(gl.getExtension('EXT_conservative_depth'));
  } catch {
    supported = false;
  }
  conservativeDepthSupport.set(context, supported);
  return supported;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build a 256×1 RGBA DataTexture from a color lookup function */
export function buildPaletteTexture(
  lookupFn: (index: number) => [number, number, number],
): THREE.DataTexture {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = lookupFn(i);
    data[i * 4]     = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  // CPK/element palettes and scientific colormaps are authored as display
  // (sRGB) values. Marking the texture lets Three decode samples into its
  // Linear-sRGB working space before the BRDF operates on them.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the 256×1 R32F radius palette. Slot → world-space impostor radius;
 * 0 hides the slot. Scaling, hiding, or per-type resizing atoms updates this
 * 1 KB texture instead of rewriting every instance.
 */
export function buildRadiusPaletteTexture(
  lookupFn: (slot: number) => number,
): THREE.DataTexture {
  const data = new Float32Array(256);
  for (let slot = 0; slot < 256; slot += 1) {
    const radius = lookupFn(slot);
    data[slot] = Number.isFinite(radius) && radius > 0 ? radius : 0;
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RedFormat, THREE.FloatType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * World radius for one render slot given the viewer's scale controls.
 * Hidden types resolve to 0, which the vertex shader treats as "cull".
 */
export function resolveSlotRadius(
  entry: { rawType: number; displayRadius: number } | undefined,
  scale: number,
  hiddenAtomTypes?: { has(type: number): boolean } | null,
  atomTypeScales?: Record<number, number> | null,
): number {
  if (!entry) return 0;
  if (hiddenAtomTypes?.has(entry.rawType)) return 0;
  const radius = entry.displayRadius * scale * (atomTypeScales?.[entry.rawType] ?? 1);
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/**
 * Build the per-element material palette texture. 256×2 RGBA:
 *   - row 0 (sampled at v=0.25): material params (metalness, roughness, anisotropy, subsurface)
 *   - row 1 (sampled at v=0.75): emission (r, g, b, intensity)
 *
 * Stored as 8-bit; both material params (0..1) and emission color (0..1)
 * fit. Emission intensity in alpha is also 0..1.
 *
 * Reads the entire periodic table from `materials/elementProfiles.ts`,
 * so adding a new element override there immediately reflects here.
 */
export function buildMaterialPaletteTexture(
  atomicNumberForSlot?: (slot: number) => number | undefined,
): THREE.DataTexture {
  const data = new Uint8Array(256 * 2 * 4);
  const resolveSlot = atomicNumberForSlot ?? ((slot: number) => slot);
  for (let slot = 0; slot < 256; slot += 1) {
    const atomicNumber = resolveSlot(slot);
    const profile = atomicNumber === undefined ? DEFAULT_PROFILE : getElementProfile(atomicNumber);
    const materialBase = slot * 4;
    // Preserve the byte-identical quantization of the original
    // buildMaterialPaletteData() path. That implementation staged authored
    // coefficients through Float32Array before converting them to bytes; doing
    // the multiplication directly in double precision changes half-step values
    // such as 0.7 * 255 by one byte and invalidates an otherwise identical
    // owner-approved render golden.
    data[materialBase] = materialPaletteByte(profile.metalness);
    data[materialBase + 1] = materialPaletteByte(profile.roughness);
    data[materialBase + 2] = materialPaletteByte(profile.anisotropy);
    data[materialBase + 3] = materialPaletteByte(profile.subsurface);
    const emissionBase = 256 * 4 + slot * 4;
    data[emissionBase] = materialPaletteByte(profile.emission[0]);
    data[emissionBase + 1] = materialPaletteByte(profile.emission[1]);
    data[emissionBase + 2] = materialPaletteByte(profile.emission[2]);
    data[emissionBase + 3] = materialPaletteByte(profile.emissionIntensity);
  }
  const tex = new THREE.DataTexture(data, 256, 2, THREE.RGBAFormat);
  // Packed material coefficients and authored emission intensities are linear
  // data, not display colors. Never apply an sRGB transfer function here.
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function materialPaletteByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Math.fround(value) * 255)));
}

/** Build a 256×1 RGBA DataTexture sampling a colormap over [0,1] */
export function buildColormapTexture(
  mapFn: (t: number) => [number, number, number],
): THREE.DataTexture {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const [r, g, b] = mapFn(t);
    data[i * 4]     = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ─── Component ───────────────────────────────────────────────────────

const MIN_CAPACITY = 50000;
/** Capacity headroom shrinks for very large scenes: 20% of 10M atoms is a
 *  lot of memory to reserve for growth that rarely happens. */
function capacityHeadroom(atomCount: number): number {
  return atomCount > 2_000_000 ? 1.05 : 1.2;
}

export const LUPI_ARTIFACT_LAYER_KEY = 'lupiArtifactLayer';
export const LUPI_ARTIFACT_ATOMS_LAYER = 'atoms';
export const LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY = 'lupiAppliedArtifactSpecId';

export function AtomsOptimized({
  frame,
  nextFrame,
  interpolationFactor,
  colorMode = 'type',
  colorProperty,
  colormap = 'viridis',
  uniformColor = '#1edce0',
  elementColorOverrides = {},
  propRange,
  scale = 1.0,
  maxAtoms,
  onSpatialHash,
  highlightedAtoms,
  hiddenAtomTypes,
  atomTypeScales,
  atomColorSource = 'colormap',
  etchTexture = null,
  etchAtomId = null,
  propertyEmissionStrength = 0,
  materialPreset = 'default',
  materialIntensity = 0.0,
  rimLightIntensity = 0.0,
  surfaceRoughness = 0.0,
  surfacePolish = 0.0,
  surfaceClearcoat = 0.0,
  keyLightAzimuth = 40,
  keyLightElevation = 45,
  fillLightAzimuth = -120,
  fillLightElevation = 10,
  rimLightAzimuth = 160,
  rimLightElevation = 30,
  fillLightColor = '#8888ff',
  rimLightColor = '#ffffff',
  atomTexture = 'none',
  loadedAtomCount,
  frameIndex,
  liveStateRef,
  artifactSpecId,
  qualityTier,
  cullPixelRadius = 0,
  occlusion = null,
  occlusionStrength = 0.55,
}: AtomsOptimizedProps) {
  void highlightedAtoms;
  const meshRef = useRef<THREE.Mesh>(null!);
  const spatialHashRef = useRef(new SpatialHash3D(3.0));
  const atomCountRef = useRef(0);
  const { scene, gl } = useThree();

  // Large-scene callers intentionally remove the picking callback. Release
  // the previous scene's grid immediately rather than retaining it until the
  // whole R3F atom layer unmounts.
  useEffect(() => {
    if (!onSpatialHash) spatialHashRef.current.clear();
  }, [onSpatialHash]);
  const canInterpolateToNextFrame = useMemo(
    () => Boolean(nextFrame && framesShareAtomOrder(frame, nextFrame)),
    [frame, nextFrame],
  );
  const renderAtomCount = resolveLoadedAtomCount(frame.natoms, loadedAtomCount);
  const candidateTypeRenderTable = useMemo(
    () => buildTypeRenderTable(frame, renderAtomCount),
    [frame, renderAtomCount],
  );
  const stableTypeRenderTableRef = useRef(candidateTypeRenderTable);
  if (!typeRenderTablesEqual(stableTypeRenderTableRef.current, candidateTypeRenderTable)) {
    stableTypeRenderTableRef.current = candidateTypeRenderTable;
  }
  const typeRenderTable = stableTypeRenderTableRef.current;

  // Capacity — grows with headroom, shrinks only on a much smaller molecule
  // so a large scene followed by a small one releases its buffers.
  const capacityRef = useRef(Math.max(MIN_CAPACITY, Math.ceil(frame.natoms * capacityHeadroom(frame.natoms))));
  if (frame.natoms > capacityRef.current) {
    capacityRef.current = Math.max(
      Math.ceil(capacityRef.current * 1.5),
      Math.ceil(frame.natoms * capacityHeadroom(frame.natoms)),
    );
  } else if (capacityRef.current > MIN_CAPACITY && frame.natoms * 4 < capacityRef.current) {
    capacityRef.current = Math.max(MIN_CAPACITY, Math.ceil(frame.natoms * capacityHeadroom(frame.natoms)));
  }
  let capacity = capacityRef.current;
  if (maxAtoms !== undefined && capacity > maxAtoms) {
    capacity = maxAtoms;
  }

  // ─── Geometry: one quad, instanced ────────────────────────────────
  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();

    // Quad vertices: 4 corners in [-1, 1]
    const quadPos = new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1,  1, 0,
    ]);
    const quadIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);

    geo.setAttribute('position', new THREE.BufferAttribute(quadPos, 3));
    geo.setIndex(new THREE.BufferAttribute(quadIdx, 1));

    // Per-instance attributes
    const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instancePosition', posAttr);

    // Target positions (next frame, PBC-unwrapped). The vertex shader lerps
    // instancePosition -> instanceTargetPosition by uProgress on the GPU.
    // Static molecules alias the position attribute; a trajectory allocates
    // its own target buffer on the first interpolable frame pair.
    geo.setAttribute('instanceTargetPosition', posAttr);

    // Type slot (u8, read as an integer-valued float) — the shader does the
    // color, material and radius lookups.
    const typeAttr = new THREE.InstancedBufferAttribute(new Uint8Array(capacity), 1, false);
    typeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceTypeId', typeAttr);

    // Normalized property value (u16 → [0,1]).
    const propAttr = new THREE.InstancedBufferAttribute(new Uint16Array(capacity), 1, true);
    propAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instancePropValue', propAttr);

    // Per-atom openness (u8 → [0,1]); 255 = unoccluded.
    const occlusionArray = new Uint8Array(capacity);
    occlusionArray.fill(255);
    const occAttr = new THREE.InstancedBufferAttribute(occlusionArray, 1, true);
    occAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceOcclusion', occAttr);

    geo.instanceCount = 0;
    // Until the layout-effect upload installs the first exact bound, fail open
    // so Three cannot derive a tiny bound from the shared billboard quad.
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      Number.POSITIVE_INFINITY,
    );

    return geo;
  }, [capacity]);

  /** Lazily allocate the interpolation target buffer for trajectories. */
  const ensureTargetAttribute = useCallback((geo: THREE.InstancedBufferGeometry): THREE.InstancedBufferAttribute => {
    const posAttr = geo.attributes.instancePosition as THREE.InstancedBufferAttribute;
    const existing = geo.attributes.instanceTargetPosition as THREE.InstancedBufferAttribute;
    if (existing !== posAttr) return existing;
    const tgtAttr = new THREE.InstancedBufferAttribute(new Float32Array(posAttr.array.length), 3);
    tgtAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceTargetPosition', tgtAttr);
    return tgtAttr;
  }, []);

  // ─── Material: custom shader with GPU color lookup ─────────────────
  const material = useMemo(() => {
    const paletteTex = buildPaletteTexture(() => DEFAULT_TYPE_COLOR);
    const colormapTex = buildColormapTexture((t) => [t, t, t]);
    const materialPaletteTex = buildMaterialPaletteTexture();
    const radiusPaletteTex = buildRadiusPaletteTexture(() => 0);

    const mat = new THREE.RawShaderMaterial({
      vertexShader: IMPOSTOR_VERTEX,
      fragmentShader: IMPOSTOR_FRAGMENT,
      glslVersion: THREE.GLSL3,
      defines: { ...materialCubeUvDefines(EMPTY_CUBE_UV_DEFINES), LUPI_QUALITY: '2' },
      uniforms: {
        uPalette: { value: paletteTex },
        uColormap: { value: colormapTex },
        uRadiusPalette: { value: radiusPaletteTex },
        uColorMode: { value: 0 },
        uUniformColor: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
        uTextureMode: { value: 0 },
        uMaterialPreset: { value: 0 },
        uMaterialIntensity: { value: 0.0 },
        uRimLight: { value: 0.0 },
        uSurfaceRoughness: { value: 0.0 },
        uSurfacePolish: { value: 0.0 },
        uSurfaceClearcoat: { value: 0.0 },
        uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.6) },
        uProgress: { value: 0 },
        uFillLightDir: { value: new THREE.Vector3(-0.3, -0.2, 0.8) },
        uRimLightDir: { value: new THREE.Vector3(0.0, 0.0, -1.0) },
        uViewUp: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
        uFillLightColor: { value: new THREE.Color('#8888ff') },
        uRimLightColor: { value: new THREE.Color('#ffffff') },
        // Static — periodic table doesn't change at runtime.
        uMaterialPalette: { value: materialPaletteTex },
        // PMREM env (synced from scene.environment via useFrame below).
        tEnvMap: { value: null as THREE.Texture | null },
        uEnvIntensity: { value: 1.0 },
        uHasEnv: { value: 0 },
        // Etched annotation — synced from props in the effect below.
        tEtchTexture: { value: null as THREE.Texture | null },
        uEtchAtomId: { value: -1 },
        uHasEtch: { value: 0 },
        // Property-driven emission strength
        uPropEmission: { value: 0 },
        // Screen-space footprint + culling
        uPixelScale: { value: 1 },
        uOrthographic: { value: 0 },
        uCullPixelRadius: { value: 0 },
        // Per-atom occlusion
        uOcclusionStrength: { value: 0 },
        // Output transfer function
        uOutputSrgb: { value: 1 },
      },
      depthWrite: true,
      depthTest: true,
      transparent: false,
      side: THREE.DoubleSide,
    });
    return mat;
  }, []);

  // ─── Compile-time quality + early-Z defines ───────────────────────
  const effectiveQualityTier = resolveAtomQualityTier(qualityTier, frame.natoms);
  const conservativeDepth = useMemo(() => rendererSupportsConservativeDepth(gl), [gl]);
  useLayoutEffect(() => {
    syncAtomShaderDefines(material, effectiveQualityTier, conservativeDepth);
  }, [material, effectiveQualityTier, conservativeDepth]);

  // ─── Property data ─────────────────────────────────────────────────
  const propData = useMemo(() => {
    if (colorMode !== 'property' || !colorProperty) return null;
    return frame.properties?.get(colorProperty) ?? null;
  }, [frame, colorMode, colorProperty]);

  const [autoMin, autoMax] = useMemo(() => {
    if (!propData) return [0, 1];
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < propData.length; i++) {
      if (propData[i] < mn) mn = propData[i];
      if (propData[i] > mx) mx = propData[i];
    }
    return [mn === Infinity ? 0 : mn, mx === -Infinity ? 1 : mx];
  }, [propData]);

  const pMin = propRange?.[0] ?? autoMin;
  const pMax = propRange?.[1] ?? autoMax;
  const mapFn = COLORMAPS[colormap] ?? COLORMAPS.viridis;

  // Extents of the last uploaded positions (both interpolation endpoints),
  // kept so radius-only changes can refresh the culling bound without an
  // O(n) rescan.
  const extentsRef = useRef<AtomInterpolationExtents>({
    count: 0, finite: true, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, maxInstanceRadius: 0,
  });

  const maxSlotRadius = useMemo(() => {
    let maxRadius = 0;
    for (const entry of typeRenderTable.entries) {
      const r = resolveSlotRadius(entry, scale, hiddenAtomTypes, atomTypeScales);
      if (r > maxRadius) maxRadius = r;
    }
    return maxRadius;
  }, [typeRenderTable, scale, hiddenAtomTypes, atomTypeScales]);
  // Read through a ref so a radius-only change never invalidates the frame
  // upload callback (which would trigger a full O(n) re-upload).
  const maxSlotRadiusRef = useRef(maxSlotRadius);
  maxSlotRadiusRef.current = maxSlotRadius;

  const applyBoundingSphere = useCallback(() => {
    geometry.boundingSphere = createAtomInterpolationBoundingSphere({
      ...extentsRef.current,
      maxInstanceRadius: maxSlotRadiusRef.current,
    });
  }, [geometry]);

  // ─── Update palette textures (instant — no atom iteration) ─────────
  // This state participates in immutable raster identity. Apply it during the
  // commit phase so an ExportManager capture scheduled by the same Zustand
  // update cannot reach the next Fiber frame with the previous palette or
  // material uniforms. A passive effect races the browser's rAF and allowed
  // one artifactKey to produce stale grey pixels on its first export.
  useLayoutEffect(() => {
    const uniforms = material.uniforms;

    // Update color mode uniform
    uniforms.uColorMode.value = colorMode === 'property' ? 2 : colorMode === 'uniform' ? 1 : 0;

    // Update texture mode uniform
    let texMode = 0;
    if (atomTexture === 'noise') texMode = 1;
    if (atomTexture === 'scratched') texMode = 2;
    uniforms.uTextureMode.value = texMode;

    let matMode = 0;
    if (materialPreset === 'matte') matMode = 1;
    if (materialPreset === 'metallic') matMode = 2;
    if (materialPreset === 'glass' || materialPreset === 'transmission') matMode = 3;
    if (materialPreset === 'plastic') matMode = 4;
    uniforms.uMaterialPreset.value = matMode;
    uniforms.uMaterialIntensity.value = materialIntensity ?? 0.0;
    uniforms.uRimLight.value = rimLightIntensity ?? 0.0;
    syncSurfaceMaterialUniforms(uniforms as unknown as ScalarMaterialUniforms, {
      surfaceRoughness,
      surfacePolish,
      surfaceClearcoat,
    });

    uniforms.uPropEmission.value = propertyEmissionStrength;
    uniforms.uCullPixelRadius.value = Number.isFinite(cullPixelRadius) ? Math.max(0, cullPixelRadius) : 0;
    uniforms.uOcclusionStrength.value = occlusion
      ? Math.max(0, Math.min(1, occlusionStrength))
      : 0;

    uniforms.uFillLightColor.value.set(fillLightColor);
    uniforms.uRimLightColor.value.set(rimLightColor);

    // Etched annotation sync. The texture itself is owned by the caller
    // (App.tsx builds it from the active annotation text); we just point
    // the uniform at it and flip the gating int. -1 atomId is the sentinel
    // for "no etch" — fragments compare via abs(diff) < 0.5 so any value
    // outside the live atom range trivially fails.
    uniforms.tEtchTexture.value = etchTexture ?? null;
    uniforms.uEtchAtomId.value = etchAtomId ?? -1;
    uniforms.uHasEtch.value = (etchTexture && etchAtomId != null && etchAtomId >= 0) ? 1 : 0;

    if (colorMode === 'uniform') {
      const color = new THREE.Color(uniformColor);
      uniforms.uUniformColor.value.set(color.r, color.g, color.b);
    }

    // Rebuild the 256×1 type palette (768 bytes, instant)
    const oldPalette = uniforms.uPalette.value as THREE.DataTexture;

    // Source the per-type palette from one of two places.
    if (atomColorSource === 'element') {
      // Element-natural colors from the periodic table data. Cu is warm, Au
      // is gold, O is red — no colormap mediation. Pairs with the per-element
      // material identity for a chemically-honest read.
      uniforms.uPalette.value = buildPaletteTexture((slot) => {
        const entry = typeRenderTable.entries[slot];
        if (!entry) return DEFAULT_TYPE_COLOR;
        const override = elementColorOverrides[entry.rawType];
        return override ? hexToRgb(override) : entry.color;
      });
    } else {
      // 'colormap' — types mapped through the active colormap by rank.
      // Generic, abstract; fine when chemistry isn't the point.
      uniforms.uPalette.value = buildPaletteTexture((slot) => {
        const t = typeRenderTable.entries.length > 1
          ? slot / (typeRenderTable.entries.length - 1)
          : 0.5;
        return mapFn(t);
      });
    }

    oldPalette.dispose();

    const oldMaterialPalette = uniforms.uMaterialPalette.value as THREE.DataTexture;
    uniforms.uMaterialPalette.value = buildMaterialPaletteTexture(
      (slot) => typeRenderTable.entries[slot]?.atomicNumber,
    );
    oldMaterialPalette.dispose();

    // Rebuild the 256×1 colormap texture (768 bytes, instant)
    const oldColormap = uniforms.uColormap.value as THREE.DataTexture;
    uniforms.uColormap.value = buildColormapTexture(mapFn);
    oldColormap.dispose();

  }, [colorMode, colormap, mapFn, uniformColor, elementColorOverrides, atomColorSource, material, typeRenderTable, atomTexture, materialPreset, propertyEmissionStrength, etchTexture, etchAtomId, materialIntensity, rimLightIntensity, surfaceRoughness, surfacePolish, surfaceClearcoat, fillLightColor, rimLightColor, cullPixelRadius, occlusion, occlusionStrength]);

  // ─── Radius palette: scale / visibility / per-type scale ──────────
  // A 1 KB texture upload replaces the former O(n) instance rewrite whenever
  // the user hides a type or drags the atom-scale slider.
  useLayoutEffect(() => {
    const uniforms = material.uniforms;
    const oldRadiusPalette = uniforms.uRadiusPalette.value as THREE.DataTexture;
    uniforms.uRadiusPalette.value = buildRadiusPaletteTexture((slot) => resolveSlotRadius(
      typeRenderTable.entries[slot],
      scale,
      hiddenAtomTypes,
      atomTypeScales,
    ));
    oldRadiusPalette.dispose();
    applyBoundingSphere();
  }, [material, typeRenderTable, scale, hiddenAtomTypes, atomTypeScales, applyBoundingSphere]);

  // ─── PMREM env sync and dynamic lighting ───────────────────────────────────────────────
  // SceneLighting owns an explicit PMREM CubeUV target. Never hand the custom
  // textureCubeUV shader a raw equirectangular texture: Three's built-in
  // materials can prefilter one internally, but ShaderMaterial cannot.
  // Light WORLD directions depend only on the azimuth/elevation props, so build
  // them once per angle change (not per frame). Only the view-space transform is
  // camera-dependent and stays in useFrame, reusing a single scratch vector — so
  // the hot path does zero allocation and no trig.
  const lightWorldDirs = useMemo(() => {
    const dir = (azDeg: number, elDeg: number) => {
      const az = (azDeg * Math.PI) / 180;
      const el = (elDeg * Math.PI) / 180;
      return new THREE.Vector3(
        Math.cos(el) * Math.sin(az),
        Math.sin(el),
        Math.cos(el) * Math.cos(az),
      ).normalize();
    };
    return {
      key: dir(keyLightAzimuth ?? 40, keyLightElevation ?? 45),
      fill: dir(fillLightAzimuth ?? -120, fillLightElevation ?? 10),
      rim: dir(rimLightAzimuth ?? 160, rimLightElevation ?? 30),
      up: new THREE.Vector3(0, 1, 0),
    };
  }, [keyLightAzimuth, keyLightElevation, fillLightAzimuth, fillLightElevation, rimLightAzimuth, rimLightElevation]);
  const lightScratch = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const sceneEnvironment = (scene as any).environment as THREE.Texture | null;
    const u = material.uniforms;
    syncCubeUvEnvironment(material, sceneEnvironment);

    // Transform the precomputed world dirs into view space (camera-relative) for
    // the impostor shader. One scratch vector, reused — no per-frame allocation.
    const inv = camera.matrixWorldInverse;
    u.uLightDir.value.copy(lightScratch.copy(lightWorldDirs.key).transformDirection(inv));
    u.uFillLightDir.value.copy(lightScratch.copy(lightWorldDirs.fill).transformDirection(inv));
    u.uRimLightDir.value.copy(lightScratch.copy(lightWorldDirs.rim).transformDirection(inv));
    u.uViewUp.value.copy(lightScratch.copy(lightWorldDirs.up).transformDirection(inv));

    // GPU frame-interpolation progress. Read it live (display rate) from the
    // playback ref so motion is smooth regardless of the React state-sync FPS;
    // clamp to [0,1] so a lagging React buffer reload can't overshoot the loaded
    // current->target pair. Falls back to the (slower) prop when no ref is wired.
    const live = liveStateRef?.current;
    const prog = canInterpolateToNextFrame && live && frameIndex != null
      ? live.effectiveFrame - frameIndex
      : canInterpolateToNextFrame
        ? (interpolationFactor ?? 0)
        : 0;
    u.uProgress.value = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  });

  // Per-draw state that depends on the active render target: output transfer
  // function and the device-pixel scale used for culling and specular AA.
  const drawingBufferScratch = useMemo(() => new THREE.Vector2(), []);
  const onBeforeRender = useCallback((
    renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    const u = material.uniforms;
    const target = renderer.getRenderTarget();
    let outputSrgb: boolean;
    let targetHeight: number;
    if (target === null) {
      outputSrgb = renderer.outputColorSpace === THREE.SRGBColorSpace;
      targetHeight = renderer.getDrawingBufferSize(drawingBufferScratch).y;
    } else if ((target as { isXRRenderTarget?: boolean }).isXRRenderTarget === true) {
      outputSrgb = target.texture.colorSpace === THREE.SRGBColorSpace;
      targetHeight = target.height;
    } else {
      outputSrgb = THREE.ColorManagement.workingColorSpace === THREE.SRGBColorSpace;
      targetHeight = target.height;
    }
    u.uOutputSrgb.value = outputSrgb ? 1 : 0;
    const projection = camera.projectionMatrix.elements;
    const ortho = (camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true;
    u.uOrthographic.value = ortho ? 1 : 0;
    u.uPixelScale.value = Math.abs(projection[5]) * Math.max(1, targetHeight) * 0.5;
  }, [material, drawingBufferScratch]);
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.onBeforeRender = onBeforeRender as THREE.Mesh['onBeforeRender'];
    return () => {
      if (mesh.onBeforeRender === onBeforeRender) mesh.onBeforeRender = () => {};
    };
  }, [onBeforeRender]);

  // ─── Upload frame data to GPU (runs ONCE per frame change) ────────
  const uploadedTypesRef = useRef<{ types: Int32Array | null; table: TypeRenderTable | null; count: number }>({
    types: null, table: null, count: 0,
  });
  const uploadedOcclusionRef = useRef<Uint8Array | null>(null);

  const uploadFrame = useCallback(() => {
    // Picking is paused during trajectory playback. Do not spend an O(n) pass
    // rebuilding a spatial hash for every source frame when there is no
    // consumer; rebuild once the callback returns on pause.
    let cleanupIdle = () => {};
    if (onSpatialHash) {
      const idleCallback = (typeof requestIdleCallback !== 'undefined')
        ? requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 0);
      const cancelIdle = (typeof cancelIdleCallback !== 'undefined')
        ? cancelIdleCallback
        : clearTimeout;
      const idleId = idleCallback(() => {
        spatialHashRef.current.build(frame.positions, frame.natoms);
        onSpatialHash(spatialHashRef.current);
      });
      cleanupIdle = () => cancelIdle(idleId as any);
    }

    const positions = frame.positions;
    const types = frame.types;
    const nextPos = canInterpolateToNextFrame ? nextFrame!.positions : null;

    let bsx = 0, bsy = 0, bsz = 0;
    const hasBounds = !!frame.boxBounds;
    if (hasBounds) {
      bsx = frame.boxBounds![1] - frame.boxBounds![0];
      bsy = frame.boxBounds![3] - frame.boxBounds![2];
      bsz = frame.boxBounds![5] - frame.boxBounds![4];
    }

    // Instances map 1:1 onto atom indices; capacity clamps only the tail.
    const count = Math.min(renderAtomCount, capacity, Math.floor(positions.length / 3));

    const posAttr = geometry.attributes.instancePosition as THREE.InstancedBufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const typeAttr = geometry.attributes.instanceTypeId as THREE.InstancedBufferAttribute;
    const typeArr = typeAttr.array as Uint8Array;
    const propAttr = geometry.attributes.instancePropValue as THREE.InstancedBufferAttribute;
    const propArr = propAttr.array as Uint16Array;
    const occAttr = geometry.attributes.instanceOcclusion as THREE.InstancedBufferAttribute;
    const occArr = occAttr.array as Uint8Array;

    // Positions: one bulk copy, then a tight bounds pass over the copy.
    posArr.set(positions.subarray(0, count * 3));
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let boundsAreFinite = true;
    for (let i = 0, end = count * 3; i < end; i += 3) {
      const x = posArr[i];
      const y = posArr[i + 1];
      const z = posArr[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (count > 0 && !(Number.isFinite(minX) && Number.isFinite(maxX)
      && Number.isFinite(minY) && Number.isFinite(maxY)
      && Number.isFinite(minZ) && Number.isFinite(maxZ))) {
      boundsAreFinite = false;
    }
    markInstancedAttributeUpdateRange(posAttr, count * 3);

    // Interpolation targets: PBC-unwrapped on the SHORT arc across the cell
    // (unit-tested in interpolation.test.ts). hasBounds === false -> boxSize 0
    // -> raw delta. Static frames alias the position buffer instead.
    if (nextPos && nextPos.length >= count * 3) {
      const tgtAttr = ensureTargetAttribute(geometry);
      const tgtArr = tgtAttr.array as Float32Array;
      const bx = hasBounds ? bsx : 0;
      const by = hasBounds ? bsy : 0;
      const bz = hasBounds ? bsz : 0;
      for (let i = 0, end = count * 3; i < end; i += 3) {
        const x = posArr[i];
        const y = posArr[i + 1];
        const z = posArr[i + 2];
        const tx = x + wrapDelta(nextPos[i] - x, bx);
        const ty = y + wrapDelta(nextPos[i + 1] - y, by);
        const tz = z + wrapDelta(nextPos[i + 2] - z, bz);
        tgtArr[i] = tx;
        tgtArr[i + 1] = ty;
        tgtArr[i + 2] = tz;
        if (tx < minX) minX = tx;
        if (tx > maxX) maxX = tx;
        if (ty < minY) minY = ty;
        if (ty > maxY) maxY = ty;
        if (tz < minZ) minZ = tz;
        if (tz > maxZ) maxZ = tz;
      }
      if (count > 0 && !(Number.isFinite(minX) && Number.isFinite(maxX)
        && Number.isFinite(minY) && Number.isFinite(maxY)
        && Number.isFinite(minZ) && Number.isFinite(maxZ))) {
        boundsAreFinite = false;
      }
      markInstancedAttributeUpdateRange(tgtAttr, count * 3);
    } else if (geometry.attributes.instanceTargetPosition !== posAttr) {
      // Back to a static frame after a trajectory allocated its own target
      // buffer: mirror the positions so the GPU lerp is a no-op. (Re-aliasing
      // would strand the detached attribute's GL buffer until dispose.)
      const tgtAttr = geometry.attributes.instanceTargetPosition as THREE.InstancedBufferAttribute;
      (tgtAttr.array as Float32Array).set(posArr.subarray(0, count * 3));
      markInstancedAttributeUpdateRange(tgtAttr, count * 3);
    }

    // Type slots: re-upload only when the raw type buffer or slot table
    // changed. Trajectory frames sharing a type array skip this entirely.
    const uploadedTypes = uploadedTypesRef.current;
    if (
      uploadedTypes.types !== types
      || uploadedTypes.table !== typeRenderTable
      || uploadedTypes.count !== count
    ) {
      const lookup = buildTypeSlotLookup(typeRenderTable);
      if (lookup.dense) {
        const dense = lookup.dense;
        const base = lookup.base;
        for (let i = 0; i < count; i++) {
          const idx = types[i] - base;
          const slot = idx >= 0 && idx < dense.length ? dense[idx] : -1;
          typeArr[i] = slot < 0 ? 0 : slot;
        }
      } else {
        for (let i = 0; i < count; i++) {
          typeArr[i] = lookup.sparse.get(types[i]) ?? 0;
        }
      }
      markInstancedAttributeUpdateRange(typeAttr, count);
      uploadedTypesRef.current = { types, table: typeRenderTable, count };
    }

    // Normalized property value (current frame). Temporal color interpolation
    // was dropped with the CPU position lerp — a negligible visual effect that
    // coupled this loop to the live interpolation factor.
    if (propData) {
      const invRange = pMax > pMin ? 1 / (pMax - pMin) : 0;
      for (let i = 0; i < count; i++) {
        const t = invRange > 0 ? (propData[i] - pMin) * invRange : 0.5;
        propArr[i] = t <= 0 ? 0 : t >= 1 ? 65535 : Math.round(t * 65535);
      }
      markInstancedAttributeUpdateRange(propAttr, count);
    }

    // Per-atom occlusion: bulk copy, or restore "fully open" after a scene
    // that carried occlusion data.
    if (occlusion && occlusion.length >= count) {
      occArr.set(occlusion.subarray(0, count));
      markInstancedAttributeUpdateRange(occAttr, count);
      uploadedOcclusionRef.current = occlusion;
    } else if (uploadedOcclusionRef.current !== null) {
      occArr.fill(255, 0, count);
      markInstancedAttributeUpdateRange(occAttr, count);
      uploadedOcclusionRef.current = null;
    }

    atomCountRef.current = count;
    geometry.instanceCount = count;
    extentsRef.current = {
      count,
      finite: boundsAreFinite,
      minX, minY, minZ, maxX, maxY, maxZ,
      maxInstanceRadius: 0,
    };
    applyBoundingSphere();

    return cleanupIdle;
  }, [
    frame, nextFrame, canInterpolateToNextFrame, propData, pMin, pMax,
    onSpatialHash, capacity, geometry, renderAtomCount, typeRenderTable,
    ensureTargetAttribute, applyBoundingSphere, occlusion,
  ]);

  useLayoutEffect(() => {
    return uploadFrame();
  }, [uploadFrame]);

  // ExportManager consumes this only after the palette/material layout effect
  // and instance upload above have both committed. Store truth alone is not a
  // rendering receipt: the tagged Three mesh is the applied-scene receipt.
  useLayoutEffect(() => {
    material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] =
      artifactSpecId ?? null;
  }, [artifactSpecId, geometry, material, uploadFrame]);

  // Geometry is capacity-keyed and can be replaced while the component stays
  // mounted. Dispose only the retired geometry on a capacity change.
  useEffect(() => {
    uploadedTypesRef.current = { types: null, table: null, count: 0 };
    uploadedOcclusionRef.current = null;
    return () => geometry.dispose();
  }, [geometry]);

  // Material and its palette textures are component-owned and intentionally
  // stable across geometry growth. Their cleanup must run only when this
  // stable material is retired (normally component unmount), never when a
  // capacity-keyed geometry is replaced.
  useEffect(() => {
    return () => {
      material.dispose();
      disposeOwnedMaterialTextures(material.uniforms);
      spatialHashRef.current.clear();
    };
  }, [material]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled
      userData={{ [LUPI_ARTIFACT_LAYER_KEY]: LUPI_ARTIFACT_ATOMS_LAYER }}
    />
  );
}

// Export spatial hash for external use
export { SpatialHash3D };
