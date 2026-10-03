/**
 * <AtomsOptimized /> — ray-cast impostor sphere renderer
 *
 * The technique VMD, PyMOL and OVITO use:
 * - 1 quad per atom (2 triangles) instead of an 80-triangle sphere mesh
 * - the fragment stage ray-casts a pixel-exact sphere and writes its depth
 * - GPU-side colour lookup through palette textures: changing the colormap
 *   is instant
 * - per-instance data is uploaded once per frame change, never per animation
 *   frame; interpolation between two frames is a GPU lerp by `uProgress`
 *
 * The material is a TSL node material (`tsl/atomImpostorMaterial.ts`) on the
 * shared impostor kit (`tsl/impostorKit.ts`), so it compiles to WGSL on the
 * WebGPU backend and GLSL on the WebGL2 fallback. The renderer output pass
 * owns tone mapping and the sRGB encode (plan-final D14).
 *
 * Large-scene architecture (millions of atoms):
 * - Compact instance layout: 12 B position (plus 12 B target for
 *   trajectories) and one normalized Uint8×4 word per atom
 *   `[typeSlot, occlusion, propHi, propLo]` (plan-final D4). Radius,
 *   visibility and per-type scale live in a 256-entry radius palette, so
 *   scaling or hiding atom types is a texture update rather than an O(n)
 *   buffer re-upload. Static molecules alias the interpolation target buffer
 *   to the position buffer (no second copy).
 * - The atom index is the instance index: instances are never compacted,
 *   hidden atoms are culled on the GPU by a zero palette radius.
 * - Sub-pixel culling: atoms whose projected radius falls under a threshold
 *   collapse to a degenerate quad in the vertex stage (the far-LOD cluster
 *   splats carry the silhouette instead).
 * - Quality tiers build separate materials with or without image-based
 *   lighting; very large scenes drop to the analytic lighting model.
 *
 * Colour architecture:
 * - A 256×1 texture maps type slot → colour, another maps normalized
 *   property → colour; both are updated in place (a few hundred bytes), never
 *   per atom.
 */

import { useRef, useMemo, useEffect, useLayoutEffect, useCallback, useId } from 'react';
import { wrapDelta } from './interpolation';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Frame, ColormapName } from '@atlas/core/types';
import { SpatialHash3D } from './SpatialHash';

import { COLORMAPS, DEFAULT_TYPE_COLOR } from './constants';
import { DEFAULT_PROFILE, getElementProfile } from './materials';
import { framesShareAtomOrder, hexToRgb } from '@atlas/core';
import { buildTypeRenderTable, typeRenderTablesEqual, type TypeRenderTable } from './typeRenderTable';
import { LUPI_JOB, LUPI_PHASE } from './framePhases';
import { isLupiDisplayMotionActive } from './tsl/displayMotion';
import {
  createLupiEnvBinding,
  createLupiLightUniforms,
  lightDirection,
  materialPresetIndex,
  syncLupiEnvBinding,
} from './tsl/impostorKit';
import {
  CONTACT_TEXTURE_WIDTH,
  contactTextureRows,
  writeContactTexture,
  type ContactOcclusionBake,
} from './atomContactOcclusion';
import {
  ATOM_ATTR,
  ATOM_DATA_OCCLUSION,
  ATOM_DATA_PROP_HI,
  ATOM_DATA_PROP_LO,
  ATOM_DATA_SLOT,
  ATOM_DATA_STRIDE,
  ATOM_IMPOSTOR_QUAD_SCALE,
  createAtomImpostorMaterial,
  createAtomImpostorUniforms,
  emptyContactTexture,
  emptyEtchTexture,
  quantizeAtomProp,
  type AtomImpostorTextures,
  type AtomImpostorUniforms,
} from './tsl/atomImpostorMaterial';

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
   *  culled in the vertex stage. 0 disables culling. */
  cullPixelRadius?: number;
  /** Per-atom openness (0 = fully buried, 255 = fully exposed), typically
   *  from `computeAtomOcclusion`. Null leaves every atom fully lit. */
  occlusion?: Uint8Array | null;
  /** How strongly per-atom occlusion darkens ambient/environment light. */
  occlusionStrength?: number;
  /**
   * The contact-occlusion neighbour bake (atomContactOcclusion.ts) for this
   * frame's atoms, or null. Shaded per pixel as analytic sphere occlusion.
   */
  contactOcclusion?: ContactOcclusionBake | null;
  /** Gain on the summed contact occlusion (0 disables it). */
  contactOcclusionStrength?: number;
  /** Bond radius when bonds are drawn (0 when hidden): stubs darken where sticks meet balls. */
  bondStubRadius?: number;
  /** Neighbours nearer than this carry a bond stub (the bond cutoff). */
  bondStubReach?: number;
  /**
   * True while an occlusion bake for this frame is still computing. The layer
   * withholds its artifact receipt meanwhile, so a deterministic export never
   * captures a half-baked look (the export timeout is the fail-closed bound).
   */
  occlusionPending?: boolean;
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

const IMPOSTOR_BOUND_RADIUS_SCALE = ATOM_IMPOSTOR_QUAD_SCALE;

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

// ─── Palette textures ────────────────────────────────────────────────
// Every palette is a 256-texel DataTexture read by type slot (or property)
// in the vertex stage. The component owns one of each and rewrites its data
// in place (`write*`), so the node materials never rebind a texture.

function paletteBytes(tex: THREE.DataTexture): Uint8Array {
  return tex.image.data as Uint8Array;
}

/** Fill a 256×1 RGBA8 texture from a colour lookup (components 0..1). */
export function writePaletteTexture(
  tex: THREE.DataTexture,
  lookupFn: (index: number) => [number, number, number],
): void {
  const data = paletteBytes(tex);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = lookupFn(i);
    data[i * 4]     = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  tex.needsUpdate = true;
}

/** Build a 256×1 RGBA DataTexture from a color lookup function */
export function buildPaletteTexture(
  lookupFn: (index: number) => [number, number, number],
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
  // CPK/element palettes and scientific colormaps are authored as display
  // (sRGB) values. The sRGB texture format decodes them to linear in
  // hardware before the BRDF operates on them.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  writePaletteTexture(tex, lookupFn);
  return tex;
}

/** Fill a 256×1 R32F radius palette; non-finite or non-positive radii hide the slot. */
export function writeRadiusPaletteTexture(
  tex: THREE.DataTexture,
  lookupFn: (slot: number) => number,
): void {
  const data = tex.image.data as Float32Array;
  for (let slot = 0; slot < 256; slot += 1) {
    const radius = lookupFn(slot);
    data[slot] = Number.isFinite(radius) && radius > 0 ? radius : 0;
  }
  tex.needsUpdate = true;
}

/**
 * Build the 256×1 R32F radius palette. Slot → world-space impostor radius;
 * 0 hides the slot. Scaling, hiding, or per-type resizing atoms updates this
 * 1 KB texture instead of rewriting every instance.
 */
export function buildRadiusPaletteTexture(
  lookupFn: (slot: number) => number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(256), 256, 1, THREE.RedFormat, THREE.FloatType);
  tex.colorSpace = THREE.NoColorSpace;
  // Float textures are unfilterable on WebGPU; the shader uses textureLoad.
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  writeRadiusPaletteTexture(tex, lookupFn);
  return tex;
}

/**
 * World radius for one render slot given the viewer's scale controls.
 * Hidden types resolve to 0, which the vertex stage treats as "cull".
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

/** Fill the 256×2 per-element material palette (see buildMaterialPaletteTexture). */
export function writeMaterialPaletteTexture(
  tex: THREE.DataTexture,
  atomicNumberForSlot?: (slot: number) => number | undefined,
): void {
  const data = paletteBytes(tex);
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
  tex.needsUpdate = true;
}

/**
 * Build the per-element material palette texture. 256×2 RGBA:
 *   - row 0: material params (metalness, roughness, anisotropy, subsurface)
 *   - row 1: emission (r, g, b, intensity)
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
  const tex = new THREE.DataTexture(new Uint8Array(256 * 2 * 4), 256, 2, THREE.RGBAFormat);
  // Packed material coefficients and authored emission intensities are linear
  // data, not display colors. Never apply an sRGB transfer function here.
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  writeMaterialPaletteTexture(tex, atomicNumberForSlot);
  return tex;
}

function materialPaletteByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Math.fround(value) * 255)));
}

/** Fill a 256×1 RGBA8 colormap texture sampling `mapFn` over [0,1]. */
export function writeColormapTexture(
  tex: THREE.DataTexture,
  mapFn: (t: number) => [number, number, number],
): void {
  const data = paletteBytes(tex);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const [r, g, b] = mapFn(t);
    data[i * 4]     = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  tex.needsUpdate = true;
}

/** Build a 256×1 RGBA DataTexture sampling a colormap over [0,1] */
export function buildColormapTexture(
  mapFn: (t: number) => [number, number, number],
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  writeColormapTexture(tex, mapFn);
  return tex;
}

// ─── Component ───────────────────────────────────────────────────────

const MIN_CAPACITY = 50000;
/** Longest wait for idle time before the picking spatial hash is built anyway. */
const SPATIAL_HASH_IDLE_TIMEOUT_MS = 750;
/** Capacity headroom shrinks for very large scenes: 20% of 10M atoms is a
 *  lot of memory to reserve for growth that rarely happens. */
function capacityHeadroom(atomCount: number): number {
  return atomCount > 2_000_000 ? 1.05 : 1.2;
}

/** Default gain on contact occlusion (the Contact look; tuned for CPK on sage). */
export const DEFAULT_CONTACT_OCCLUSION_STRENGTH = 1.4;

export const LUPI_ARTIFACT_LAYER_KEY = 'lupiArtifactLayer';
export const LUPI_ARTIFACT_ATOMS_LAYER = 'atoms';
export const LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY = 'lupiAppliedArtifactSpecId';

/**
 * What one atom layer's node materials share: the owned palette textures,
 * the uniform bag, the light uniforms and the environment binding. The
 * per-tier materials are built on first use and kept for the layer's life.
 */
export interface AtomImpostorResources {
  textures: AtomImpostorTextures;
  uniforms: AtomImpostorUniforms;
  lights: ReturnType<typeof createLupiLightUniforms>;
  env: ReturnType<typeof createLupiEnvBinding>;
  /** Keyed by `atomMaterialKey(tier, interpolate)`. */
  materials: Map<string, MeshBasicNodeMaterial>;
}

function atomMaterialKey(tier: AtomQualityTier, interpolate: boolean): string {
  return `${tier}${interpolate ? ':lerp' : ''}`;
}

export function createAtomImpostorResources(): AtomImpostorResources {
  const textures: AtomImpostorTextures = {
    palette: buildPaletteTexture(() => DEFAULT_TYPE_COLOR),
    colormap: buildColormapTexture((t) => [t, t, t]),
    radiusPalette: buildRadiusPaletteTexture(() => 0),
    materialPalette: buildMaterialPaletteTexture(),
    etch: null,
    contact: null,
  };
  return {
    textures,
    uniforms: createAtomImpostorUniforms(textures),
    lights: createLupiLightUniforms(),
    env: createLupiEnvBinding(),
    materials: new Map(),
  };
}

/**
 * The layer's node material for one quality tier, static or interpolating
 * (built once each). An interpolating material needs a geometry whose target
 * positions are their own buffer (see tsl/atomImpostorMaterial.ts).
 */
export function atomMaterialForTier(
  resources: AtomImpostorResources,
  tier: AtomQualityTier,
  interpolate = false,
): MeshBasicNodeMaterial {
  const key = atomMaterialKey(tier, interpolate);
  let material = resources.materials.get(key);
  if (!material) {
    material = createAtomImpostorMaterial({
      tier,
      interpolate,
      uniforms: resources.uniforms,
      lights: resources.lights,
      env: resources.env,
    });
    resources.materials.set(key, material);
  }
  return material;
}

/**
 * Release the GPU resources of every tier's material and the owned palette
 * textures. The etch texture and the scene environment belong to others.
 * Three re-creates GPU resources on the next use, so a StrictMode replay may
 * keep rendering with the same objects.
 */
export function disposeAtomImpostorResources(resources: AtomImpostorResources): void {
  for (const material of resources.materials.values()) material.dispose();
  resources.textures.contact?.dispose();
  resources.textures.contact = null;
  resources.uniforms.tContactTexture.value = emptyContactTexture();
  resources.uniforms.uHasContact.value = 0;
  disposeOwnedMaterialTextures(
    resources.uniforms as unknown as Record<string, { value?: { dispose?: () => void } | null }>,
  );
}

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
  contactOcclusion = null,
  contactOcclusionStrength = DEFAULT_CONTACT_OCCLUSION_STRENGTH,
  bondStubRadius = 0,
  bondStubReach = 0,
  occlusionPending = false,
}: AtomsOptimizedProps) {
  void highlightedAtoms;
  const meshRef = useRef<THREE.Mesh>(null!);
  const spatialHashRef = useRef(new SpatialHash3D(3.0));
  const atomCountRef = useRef(0);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const uniformsJobId = `${LUPI_JOB.atomsUniforms}:${useId()}`;

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
    geo.setAttribute(ATOM_ATTR.position, posAttr);

    // Target positions (next frame, PBC-unwrapped). The vertex stage lerps
    // position -> target by uProgress on the GPU. Static molecules alias the
    // position attribute; a trajectory allocates its own target buffer on the
    // first interpolable frame pair.
    geo.setAttribute(ATOM_ATTR.target, posAttr);

    // One normalized Uint8×4 word per atom: [typeSlot, occlusion, propHi,
    // propLo] (unorm8x4 on WebGPU). Occlusion starts fully open (255).
    const atomData = new Uint8Array(capacity * ATOM_DATA_STRIDE);
    for (let i = ATOM_DATA_OCCLUSION; i < atomData.length; i += ATOM_DATA_STRIDE) atomData[i] = 255;
    const dataAttr = new THREE.InstancedBufferAttribute(atomData, ATOM_DATA_STRIDE, true);
    dataAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(ATOM_ATTR.data, dataAttr);

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
    const posAttr = geo.attributes[ATOM_ATTR.position] as THREE.InstancedBufferAttribute;
    const existing = geo.attributes[ATOM_ATTR.target] as THREE.InstancedBufferAttribute;
    if (existing !== posAttr) return existing;
    const tgtAttr = new THREE.InstancedBufferAttribute(new Float32Array(posAttr.array.length), 3);
    tgtAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(ATOM_ATTR.target, tgtAttr);
    return tgtAttr;
  }, []);

  // ─── Material: node material per quality tier ─────────────────────
  // Palettes, uniforms, lights and the environment binding are shared by the
  // tiers, so switching tier swaps only the (cached) material. A frame pair
  // that interpolates uses the lerping program; the upload below gives its
  // geometry a separate target buffer in the same commit.
  const resources = useMemo(() => createAtomImpostorResources(), []);
  const effectiveQualityTier = resolveAtomQualityTier(qualityTier, frame.natoms);
  const material = useMemo(
    () => atomMaterialForTier(resources, effectiveQualityTier, canInterpolateToNextFrame),
    [resources, effectiveQualityTier, canInterpolateToNextFrame],
  );

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

  // ─── Palettes and look uniforms (instant — no atom iteration) ──────
  // This state participates in immutable raster identity. Apply it during the
  // commit phase so an ExportManager capture scheduled by the same Zustand
  // update cannot reach the next Fiber frame with the previous palette or
  // material uniforms.
  useLayoutEffect(() => {
    const u = resources.uniforms;
    const lights = resources.lights;

    u.uColorMode.value = colorMode === 'property' ? 2 : colorMode === 'uniform' ? 1 : 0;
    u.uTextureMode.value = atomTexture === 'noise' ? 1 : atomTexture === 'scratched' ? 2 : 0;
    u.uMaterialPreset.value = materialPresetIndex(materialPreset);
    u.uMaterialIntensity.value = materialIntensity ?? 0.0;
    lights.rimLight.value = rimLightIntensity ?? 0.0;
    syncSurfaceMaterialUniforms(u, {
      surfaceRoughness,
      surfacePolish,
      surfaceClearcoat,
    });

    u.uPropEmission.value = propertyEmissionStrength;
    u.uCullPixelRadius.value = Number.isFinite(cullPixelRadius) ? Math.max(0, cullPixelRadius) : 0;
    u.uOcclusionStrength.value = occlusion
      ? Math.max(0, Math.min(1, occlusionStrength))
      : 0;
    u.uContactStrength.value = Number.isFinite(contactOcclusionStrength)
      ? Math.max(0, Math.min(4, contactOcclusionStrength))
      : 0;
    u.uBondStubRadius.value = Number.isFinite(bondStubRadius) ? Math.max(0, bondStubRadius) : 0;
    u.uBondStubReach.value = Number.isFinite(bondStubReach) ? Math.max(0, bondStubReach) : 0;

    lights.fillLightColor.value.set(fillLightColor);
    lights.rimLightColor.value.set(rimLightColor);

    // Etched annotation. The texture is owned by the caller (App.tsx builds
    // it from the active annotation text); -1 is the "no etch" atom id.
    u.tEtchTexture.value = etchTexture ?? emptyEtchTexture();
    u.uEtchAtomId.value = etchAtomId ?? -1;
    u.uHasEtch.value = (etchTexture && etchAtomId != null && etchAtomId >= 0) ? 1 : 0;

    if (colorMode === 'uniform') u.uUniformColor.value.set(uniformColor);

    if (atomColorSource === 'element') {
      // Element-natural colors from the periodic table data. Cu is warm, Au
      // is gold, O is red — no colormap mediation. Pairs with the per-element
      // material identity for a chemically-honest read.
      writePaletteTexture(resources.textures.palette, (slot) => {
        const entry = typeRenderTable.entries[slot];
        if (!entry) return DEFAULT_TYPE_COLOR;
        const override = elementColorOverrides[entry.rawType];
        return override ? hexToRgb(override) : entry.color;
      });
    } else {
      // 'colormap' — types mapped through the active colormap by rank.
      writePaletteTexture(resources.textures.palette, (slot) => {
        const t = typeRenderTable.entries.length > 1
          ? slot / (typeRenderTable.entries.length - 1)
          : 0.5;
        return mapFn(t);
      });
    }
    writeMaterialPaletteTexture(
      resources.textures.materialPalette,
      (slot) => typeRenderTable.entries[slot]?.atomicNumber,
    );
    writeColormapTexture(resources.textures.colormap, mapFn);
  }, [colorMode, colormap, mapFn, uniformColor, elementColorOverrides, atomColorSource, resources, typeRenderTable, atomTexture, materialPreset, propertyEmissionStrength, etchTexture, etchAtomId, materialIntensity, rimLightIntensity, surfaceRoughness, surfacePolish, surfaceClearcoat, fillLightColor, rimLightColor, cullPixelRadius, occlusion, occlusionStrength, contactOcclusionStrength, bondStubRadius, bondStubReach]);

  // ─── Radius palette: scale / visibility / per-type scale ──────────
  // A 1 KB texture upload replaces an O(n) instance rewrite whenever the user
  // hides a type or drags the atom-scale slider.
  useLayoutEffect(() => {
    writeRadiusPaletteTexture(resources.textures.radiusPalette, (slot) => resolveSlotRadius(
      typeRenderTable.entries[slot],
      scale,
      hiddenAtomTypes,
      atomTypeScales,
    ));
    applyBoundingSphere();
  }, [resources, typeRenderTable, scale, hiddenAtomTypes, atomTypeScales, applyBoundingSphere]);

  // ─── Lights: world-space directions ───────────────────────────────
  // The node graph converts them to view space with the camera it renders
  // with, so nothing camera-dependent is computed here per frame.
  useLayoutEffect(() => {
    const lights = resources.lights;
    lights.lightDir.value.copy(lightDirection(keyLightAzimuth ?? 40, keyLightElevation ?? 45));
    lights.fillLightDir.value.copy(lightDirection(fillLightAzimuth ?? -120, fillLightElevation ?? 10));
    lights.rimLightDir.value.copy(lightDirection(rimLightAzimuth ?? 160, rimLightElevation ?? 30));
  }, [resources, keyLightAzimuth, keyLightElevation, fillLightAzimuth, fillLightElevation, rimLightAzimuth, rimLightElevation]);

  // ─── Per-frame uniforms (phase lupi-uniforms) ─────────────────────
  useFrame(() => {
    syncLupiEnvBinding(resources.env, scene);

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
    resources.uniforms.uProgress.value = prog < 0 ? 0 : prog > 1 ? 1 : prog;

    // Display motion can carry atoms outside the rest bound (the arrival
    // cloud is 1.6× the radius): fail open while it is live.
    const mesh = meshRef.current;
    if (mesh) mesh.frustumCulled = !isLupiDisplayMotionActive();
  }, { phase: LUPI_PHASE.uniforms, id: uniformsJobId });

  // ─── Upload frame data to GPU (runs ONCE per frame change) ────────
  // Each record names the geometry it was written into: a capacity change
  // replaces the geometry (zeroed buffers), which forces a full rewrite.
  const uploadedTypesRef = useRef<{
    geometry: THREE.InstancedBufferGeometry | null;
    types: Int32Array | null;
    table: TypeRenderTable | null;
    count: number;
  }>({ geometry: null, types: null, table: null, count: 0 });
  const uploadedOcclusionRef = useRef<{
    geometry: THREE.InstancedBufferGeometry | null;
    occlusion: Uint8Array | null;
  }>({ geometry: null, occlusion: null });

  const uploadFrame = useCallback(() => {
    // Picking is paused during trajectory playback. Do not spend an O(n) pass
    // rebuilding a spatial hash for every source frame when there is no
    // consumer; rebuild once the callback returns on pause. The build waits
    // for idle time, but at most SPATIAL_HASH_IDLE_TIMEOUT_MS: a continuously
    // rendering canvas on a slow GPU may never go idle, and without the hash
    // atom picking never arms.
    let cleanupIdle = () => {};
    if (onSpatialHash) {
      const build = () => {
        spatialHashRef.current.build(frame.positions, frame.natoms);
        onSpatialHash(spatialHashRef.current);
      };
      if (typeof requestIdleCallback !== 'undefined') {
        const idleId = requestIdleCallback(build, { timeout: SPATIAL_HASH_IDLE_TIMEOUT_MS });
        cleanupIdle = () => cancelIdleCallback(idleId);
      } else {
        const timeoutId = setTimeout(build, 0);
        cleanupIdle = () => clearTimeout(timeoutId);
      }
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

    const posAttr = geometry.attributes[ATOM_ATTR.position] as THREE.InstancedBufferAttribute;
    const posArr = posAttr.array as Float32Array;
    // Read the array from the attribute on every upload: three may replace it.
    const dataAttr = geometry.attributes[ATOM_ATTR.data] as THREE.InstancedBufferAttribute;
    const dataArr = dataAttr.array as Uint8Array;
    let atomDataChanged = false;

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
    // -> raw delta. An interpolating frame pair always gets its own target
    // buffer (the lerping program must never see an aliased one); static
    // frames alias the position buffer instead.
    if (canInterpolateToNextFrame) {
      const tgtAttr = ensureTargetAttribute(geometry);
      const tgtArr = tgtAttr.array as Float32Array;
      if (nextPos && nextPos.length >= count * 3) {
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
      } else {
        // A next frame without every rendered atom yet: hold still.
        tgtArr.set(posArr.subarray(0, count * 3));
      }
      markInstancedAttributeUpdateRange(tgtAttr, count * 3);
    } else if (geometry.attributes[ATOM_ATTR.target] !== posAttr) {
      // Back to a static frame after a trajectory allocated its own target
      // buffer: mirror the positions so the GPU lerp is a no-op. (Re-aliasing
      // would strand the detached attribute's GPU buffer until dispose.)
      const tgtAttr = geometry.attributes[ATOM_ATTR.target] as THREE.InstancedBufferAttribute;
      (tgtAttr.array as Float32Array).set(posArr.subarray(0, count * 3));
      markInstancedAttributeUpdateRange(tgtAttr, count * 3);
    }

    // Type slots: rewrite only when the raw type buffer or slot table
    // changed. Trajectory frames sharing a type array skip this entirely.
    const uploadedTypes = uploadedTypesRef.current;
    if (
      uploadedTypes.geometry !== geometry
      || uploadedTypes.types !== types
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
          dataArr[i * ATOM_DATA_STRIDE + ATOM_DATA_SLOT] = slot < 0 ? 0 : slot;
        }
      } else {
        for (let i = 0; i < count; i++) {
          dataArr[i * ATOM_DATA_STRIDE + ATOM_DATA_SLOT] = lookup.sparse.get(types[i]) ?? 0;
        }
      }
      atomDataChanged = true;
      uploadedTypesRef.current = { geometry, types, table: typeRenderTable, count };
    }

    // Normalized property value (current frame), 16 bits split hi/lo.
    // Temporal color interpolation was dropped with the CPU position lerp — a
    // negligible visual effect that coupled this loop to the live
    // interpolation factor.
    if (propData) {
      const invRange = pMax > pMin ? 1 / (pMax - pMin) : 0;
      for (let i = 0; i < count; i++) {
        const prop = quantizeAtomProp(invRange > 0 ? (propData[i] - pMin) * invRange : 0.5);
        const base = i * ATOM_DATA_STRIDE;
        dataArr[base + ATOM_DATA_PROP_HI] = prop >> 8;
        dataArr[base + ATOM_DATA_PROP_LO] = prop & 0xff;
      }
      atomDataChanged = true;
    }

    // Per-atom occlusion: copy, or restore "fully open" after a scene that
    // carried occlusion data.
    const uploadedOcclusion = uploadedOcclusionRef.current;
    if (occlusion && occlusion.length >= count) {
      for (let i = 0; i < count; i++) dataArr[i * ATOM_DATA_STRIDE + ATOM_DATA_OCCLUSION] = occlusion[i];
      atomDataChanged = true;
      uploadedOcclusionRef.current = { geometry, occlusion };
    } else if (uploadedOcclusion.geometry === geometry && uploadedOcclusion.occlusion !== null) {
      for (let i = 0; i < count; i++) dataArr[i * ATOM_DATA_STRIDE + ATOM_DATA_OCCLUSION] = 255;
      atomDataChanged = true;
      uploadedOcclusionRef.current = { geometry, occlusion: null };
    }

    if (atomDataChanged) markInstancedAttributeUpdateRange(dataAttr, count * ATOM_DATA_STRIDE);

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

  // ─── Contact occlusion: the neighbour texture ─────────────────────
  // Rewritten only when the bake, the atoms' type slots or the count change;
  // radius, scale and hidden types reach the shader through the radius
  // palette, so they never touch it. Runs after the frame upload (same
  // commit), so an export never sees a new frame with an old bake.
  const contactTypes = frame.types;
  useLayoutEffect(() => {
    const u = resources.uniforms;
    const count = Math.min(renderAtomCount, capacity, frame.natoms);
    if (!contactOcclusion || contactOcclusion.natoms !== frame.natoms || count < 2) {
      u.uHasContact.value = 0;
      return;
    }
    const rows = contactTextureRows(count);
    let contactTexture = resources.textures.contact ?? null;
    if (!contactTexture || contactTexture.image.height !== rows) {
      contactTexture?.dispose();
      contactTexture = new THREE.DataTexture(
        new Uint8Array(CONTACT_TEXTURE_WIDTH * rows * 4),
        CONTACT_TEXTURE_WIDTH,
        rows,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );
      // Offsets and slots are data: no colour decode, no filtering.
      contactTexture.colorSpace = THREE.NoColorSpace;
      contactTexture.minFilter = THREE.NearestFilter;
      contactTexture.magFilter = THREE.NearestFilter;
      contactTexture.generateMipmaps = false;
      resources.textures.contact = contactTexture;
    }
    const lookup = buildTypeSlotLookup(typeRenderTable);
    const slotOf = lookup.dense
      ? (j: number) => {
        const idx = contactTypes[j] - lookup.base;
        const slot = idx >= 0 && idx < lookup.dense!.length ? lookup.dense![idx] : -1;
        return slot < 0 ? 0 : slot;
      }
      : (j: number) => lookup.sparse.get(contactTypes[j]) ?? 0;
    writeContactTexture(contactTexture.image.data as Uint8Array, contactOcclusion, count, slotOf);
    contactTexture.needsUpdate = true;
    u.tContactTexture.value = contactTexture;
    u.uContactRange.value = contactOcclusion.range;
    u.uHasContact.value = 1;
    // A worker bake lands between frames: draw it (on-demand frame loops too).
    invalidate();
  }, [capacity, contactOcclusion, contactTypes, frame.natoms, invalidate, renderAtomCount, resources, typeRenderTable]);

  // ExportManager consumes this only after the palette/material layout effect
  // and instance upload above have both committed. Store truth alone is not a
  // rendering receipt: the tagged Three mesh is the applied-scene receipt.
  // Every tier's material carries it, so a tier switch keeps the receipt.
  // A bake still computing withholds the receipt (see `occlusionPending`).
  useLayoutEffect(() => {
    const receipt = occlusionPending ? null : artifactSpecId ?? null;
    for (const tierMaterial of resources.materials.values()) {
      tierMaterial.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] = receipt;
    }
  }, [artifactSpecId, geometry, material, occlusionPending, resources, uploadFrame, contactOcclusion]);

  // Geometry is capacity-keyed and can be replaced while the component stays
  // mounted. Dispose only the retired geometry on a capacity change.
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  // Materials and their palette textures are component-owned and stable
  // across geometry growth. Their cleanup runs only when the layer's
  // resources retire (component unmount), never on a capacity change.
  useEffect(() => {
    const spatialHash = spatialHashRef.current;
    return () => {
      disposeAtomImpostorResources(resources);
      spatialHash.clear();
    };
  }, [resources]);

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
