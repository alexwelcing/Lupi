/**
 * <AtomsTransmission /> — Real-geometry refractive atom renderer.
 *
 * The impostor path (AtomsOptimized) fakes its 'glass' preset inside a custom
 * fragment shader; it cannot refract the scene behind an atom. This component
 * is the true-transmission alternative: one THREE.InstancedMesh of real
 * spheres driven by drei's MeshTransmissionMaterial, which renders the rest of
 * the scene into a transmission buffer and refracts it through each sphere.
 *
 * Per-atom coloring reuses the exact color rules of the impostor path
 * (type/element/property/uniform + element overrides) via instance colors, so
 * switching between the two renderers never changes what a color "means".
 *
 * Playback parity: like the impostor path, interpolation endpoints are
 * uploaded once per frame change (current + PBC-unwrapped target) and the
 * per-substep sweep runs at display rate — here as a useFrame matrix rewrite
 * driven by the live playback ref, instead of a GPU uProgress lerp.
 *
 * Transmission is a publish look, not a scale mode: real sphere geometry plus
 * a scene-sized FBO pass caps out far below the impostor path. Callers gate on
 * MAX_TRANSMISSION_ATOMS and fall back to the impostor 'glass' preset.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial } from '@react-three/drei';
import type { ColormapName, Frame } from '@atlas/core/types';
import { framesShareAtomOrder, hexToRgb } from '@atlas/core';
import { COLORMAPS, DEFAULT_TYPE_COLOR } from './constants';
import { wrapDelta } from './interpolation';
import { SpatialHash3D } from './SpatialHash';
import {
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
} from './AtomsOptimized';
import { buildTypeRenderTable, typeRenderTablesEqual, type TypeRenderTable } from './typeRenderTable';

/**
 * Hard ceiling for the transmission path. Above this the extra scene render
 * plus real sphere geometry stops paying for itself; callers fall back to the
 * impostor 'glass' preset which scales to millions of atoms.
 */
export const MAX_TRANSMISSION_ATOMS = 20_000;

export interface TransmissionSphereDetail {
  widthSegments: number;
  heightSegments: number;
}

/**
 * Sphere tessellation budget by atom count. Small molecules get hero-quality
 * silhouettes; crowded scenes drop to a level where the whole batch stays
 * within a few million triangles.
 */
export function transmissionSphereDetail(atomCount: number): TransmissionSphereDetail {
  if (atomCount <= 1_500) return { widthSegments: 32, heightSegments: 24 };
  if (atomCount <= 8_000) return { widthSegments: 20, heightSegments: 14 };
  return { widthSegments: 12, heightSegments: 10 };
}

export interface TransmissionQuality {
  samples: number;
  resolution: number;
}

/**
 * MeshTransmissionMaterial cost knobs by device tier (0 = low/mobile).
 * drei's defaults (10 samples, viewport-sized buffer) are tuned for a single
 * hero object; a molecule is hundreds of refractive surfaces, so both knobs
 * come down per drei's own performance guidance.
 *
 * These knobs change raster bytes, so the effective quality participates in
 * the renderer fingerprint (see @atlas/ui's transmissionRuntime) — two
 * executions on different tiers must never share an artifact key.
 */
export function transmissionQuality(qualityTier: number): TransmissionQuality {
  return qualityTier <= 0
    ? { samples: 4, resolution: 256 }
    : { samples: 6, resolution: 512 };
}

/**
 * Baseline micro-roughness of clear transmission glass. The store's
 * surfaceRoughness is an OFFSET added to this (and load-time scene directives
 * legitimately make it negative), so UI controls that present "frost" must
 * speak in the effective value: clamp(base + offset).
 */
export const TRANSMISSION_BASE_ROUGHNESS = 0.06;

/**
 * Blend strength → physical transmission. materialIntensity keeps its scene
 * semantics ("how strongly the preset overrides element identity") but a true
 * refractive material cannot partially fall back to the per-element BRDF, so
 * intensity scales transmission itself while never leaving the glassy range.
 */
export function transmissionStrength(materialIntensity: number): number {
  const clamped = Math.max(0, Math.min(1, materialIntensity));
  return 0.5 + 0.5 * clamped;
}

export interface AtomColorResolverOptions {
  colorMode: 'type' | 'uniform' | 'property';
  colormap: ColormapName;
  uniformColor: string;
  elementColorOverrides: Record<number, string>;
  atomColorSource: 'colormap' | 'element';
  typeRenderTable: TypeRenderTable;
  propData: Float32Array | number[] | null;
  propMin: number;
  propMax: number;
}

/**
 * Per-atom display-sRGB color, resolved with the same rules the impostor
 * shader applies through its palette textures. Returns display-space values;
 * the caller converts to working space when writing instance colors.
 */
export function createAtomColorResolver(options: AtomColorResolverOptions) {
  const {
    colorMode, colormap, uniformColor, elementColorOverrides,
    atomColorSource, typeRenderTable, propData, propMin, propMax,
  } = options;
  const mapFn = COLORMAPS[colormap] ?? COLORMAPS.viridis;

  if (colorMode === 'uniform') {
    const uniform = hexToRgb(uniformColor);
    return () => uniform;
  }

  if (colorMode === 'property' && propData) {
    return (atomIndex: number): [number, number, number] => {
      const value = propData[atomIndex];
      const t = propMax > propMin ? (value - propMin) / (propMax - propMin) : 0.5;
      return mapFn(Math.max(0, Math.min(1, t)));
    };
  }

  const slotCount = typeRenderTable.entries.length;
  const bySlot = typeRenderTable.entries.map((entry): [number, number, number] => {
    if (atomColorSource === 'element') {
      const override = elementColorOverrides[entry.rawType];
      return override ? hexToRgb(override) : entry.color;
    }
    const t = slotCount > 1 ? entry.slot / (slotCount - 1) : 0.5;
    return mapFn(t);
  });

  return (_atomIndex: number, slot: number): [number, number, number] =>
    bySlot[slot] ?? DEFAULT_TYPE_COLOR;
}

/**
 * Interpolation endpoints for one uploaded frame pair. `base` and `target`
 * are packed xyz in local space; `target` is already PBC-unwrapped onto the
 * short arc, so a plain lerp between them matches the impostor GPU sweep.
 */
export interface TransmissionInterpolationData {
  count: number;
  base: Float32Array;
  target: Float32Array;
  radius: Float32Array;
  interpolatable: boolean;
}

interface TransmissionMatrixTarget {
  setMatrixAt(index: number, matrix: THREE.Matrix4): void;
  instanceMatrix: { needsUpdate: boolean };
}

/**
 * Write every instance matrix at the given interpolation progress. This is the
 * display-rate hot path — one scratch matrix, no allocation, progress clamped
 * to the uploaded endpoint pair exactly like the impostor uProgress clamp.
 */
export function applyTransmissionInstanceMatrices(
  mesh: TransmissionMatrixTarget,
  data: TransmissionInterpolationData,
  progress: number,
  scratch: THREE.Matrix4 = new THREE.Matrix4(),
): void {
  const t = data.interpolatable ? (progress < 0 ? 0 : progress > 1 ? 1 : progress) : 0;
  for (let i = 0; i < data.count; i += 1) {
    const r = data.radius[i];
    const j = i * 3;
    scratch.makeScale(r, r, r);
    scratch.setPosition(
      data.base[j] + (data.target[j] - data.base[j]) * t,
      data.base[j + 1] + (data.target[j + 1] - data.base[j + 1]) * t,
      data.base[j + 2] + (data.target[j + 2] - data.base[j + 2]) * t,
    );
    mesh.setMatrixAt(i, scratch);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Procedural surface maps reusing the impostor path's texture vocabulary.
 * 'noise' is the same uniform grain, 'scratched' the same sparse streaks —
 * here rasterized once into a tiling roughness map instead of computed per
 * fragment, which is what a stock physical material expects.
 */
export function buildAtomSurfaceRoughnessMap(kind: 'noise' | 'scratched'): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Deterministic LCG so two sessions produce the identical map — exports and
  // saved views must not pick up per-load texture noise.
  let seed = 0x1edce0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  if (kind === 'noise') {
    const image = ctx.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 150 + Math.round(rand() * 105);
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  } else {
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < 46; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const len = 12 + rand() * 60;
      const angle = rand() * Math.PI;
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Roughness maps carry linear coefficients, not display colors.
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

interface AtomsTransmissionProps {
  frame: Frame;
  nextFrame?: Frame;
  interpolationFactor?: number;
  colorMode?: 'type' | 'uniform' | 'property';
  colorProperty?: string;
  colormap?: ColormapName;
  uniformColor?: string;
  elementColorOverrides?: Record<number, string>;
  atomColorSource?: 'colormap' | 'element';
  propRange?: [number, number];
  scale?: number;
  loadedAtomCount?: number;
  hiddenAtomTypes?: Set<number>;
  atomTypeScales?: Record<number, number>;
  materialIntensity?: number;
  surfaceRoughness?: number;
  surfaceClearcoat?: number;
  atomTexture?: 'none' | 'scratched' | 'noise';
  /** Device tier from deviceCapabilities: 0 = low/mobile. */
  qualityTier?: number;
  /** Integer index of the loaded `frame` within its trajectory. Paired with
   *  `liveStateRef` to drive interpolation progress at display rate. */
  frameIndex?: number;
  /** Live playback ref (updated every RAF tick by useSmoothFramePlayback).
   *  Its `effectiveFrame` minus `frameIndex` gives the substep progress at
   *  display rate with no React re-render. Falls back to
   *  `interpolationFactor` when absent. */
  liveStateRef?: { readonly current: { readonly effectiveFrame: number } | null };
  onSpatialHash?: (hash: SpatialHash3D) => void;
  artifactSpecId?: string;
}

export function AtomsTransmission({
  frame,
  nextFrame,
  interpolationFactor = 0,
  colorMode = 'type',
  colorProperty,
  colormap = 'viridis',
  uniformColor = '#1edce0',
  elementColorOverrides = {},
  atomColorSource = 'colormap',
  propRange,
  scale = 1.0,
  loadedAtomCount,
  hiddenAtomTypes,
  atomTypeScales,
  materialIntensity = 1.0,
  surfaceRoughness = 0.0,
  surfaceClearcoat = 0.0,
  atomTexture = 'none',
  qualityTier = 1,
  frameIndex,
  liveStateRef,
  onSpatialHash,
  artifactSpecId,
}: AtomsTransmissionProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const materialRef = useRef<ComponentRef<typeof MeshTransmissionMaterial> | null>(null);
  const spatialHashRef = useRef(new SpatialHash3D(3.0));
  const interpDataRef = useRef<TransmissionInterpolationData | null>(null);
  const appliedProgressRef = useRef(0);
  const scratchMatrix = useMemo(() => new THREE.Matrix4(), []);
  // Latest React-synced factor for hosts without a live playback ref, read
  // from effects/useFrame without forcing a re-upload per sync.
  const factorRef = useRef(interpolationFactor);
  factorRef.current = interpolationFactor;

  const renderAtomCount = Math.max(
    0,
    Math.min(frame.natoms, loadedAtomCount ?? frame.natoms),
  );
  const candidateTable = useMemo(
    () => buildTypeRenderTable(frame, renderAtomCount),
    [frame, renderAtomCount],
  );
  const stableTableRef = useRef(candidateTable);
  if (!typeRenderTablesEqual(stableTableRef.current, candidateTable)) {
    stableTableRef.current = candidateTable;
  }
  const typeRenderTable = stableTableRef.current;

  // Same gate as the impostor path: equal atom counts are NOT enough — frames
  // that reorder rows would interpolate each atom toward an unrelated atom.
  const canInterpolateToNextFrame = useMemo(
    () => Boolean(nextFrame && framesShareAtomOrder(frame, nextFrame)),
    [frame, nextFrame],
  );

  const detail = transmissionSphereDetail(renderAtomCount);
  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, detail.widthSegments, detail.heightSegments),
    [detail.widthSegments, detail.heightSegments],
  );
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  const surfaceMap = useMemo(
    () => (atomTexture === 'none' ? null : buildAtomSurfaceRoughnessMap(atomTexture)),
    [atomTexture],
  );
  useLayoutEffect(() => () => surfaceMap?.dispose(), [surfaceMap]);

  // ─── Property data (mirrors AtomsOptimized) ─────────────────────────
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
  const propMin = propRange?.[0] ?? autoMin;
  const propMax = propRange?.[1] ?? autoMax;

  // Mean visible radius drives thickness/attenuation so refraction depth
  // tracks the molecule's actual scale instead of a magic constant.
  const meanRadius = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const entry of typeRenderTable.entries) {
      if (hiddenAtomTypes?.has(entry.rawType)) continue;
      total += entry.displayRadius * scale * (atomTypeScales?.[entry.rawType] ?? 1);
      count += 1;
    }
    return count > 0 ? total / count : 1;
  }, [typeRenderTable, hiddenAtomTypes, atomTypeScales, scale]);

  // InstancedMesh count is fixed at construction; key the mesh on capacity so
  // growth (streaming) remounts with room. Grow-only, never shrink.
  const capacityRef = useRef(Math.max(1, frame.natoms));
  if (frame.natoms > capacityRef.current) capacityRef.current = frame.natoms;
  const capacity = Math.min(capacityRef.current, MAX_TRANSMISSION_ATOMS);

  const [visibleCount, setVisibleCount] = useState(0);

  const resolveLiveProgress = (interpolatable: boolean) => {
    if (!interpolatable) return 0;
    const live = liveStateRef?.current;
    const raw = live && frameIndex != null
      ? live.effectiveFrame - frameIndex
      : factorRef.current ?? 0;
    return raw < 0 ? 0 : raw > 1 ? 1 : raw;
  };

  // ─── Upload: endpoints + instance colors (once per frame/state change) ──
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!mesh.instanceColor || mesh.instanceColor.count < capacity) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(capacity * 3),
        3,
      );
    }

    const resolveColor = createAtomColorResolver({
      colorMode,
      colormap,
      uniformColor,
      elementColorOverrides,
      atomColorSource,
      typeRenderTable,
      propData,
      propMin,
      propMax,
    });

    const positions = frame.positions;
    const types = frame.types;
    const nextPositions = canInterpolateToNextFrame ? nextFrame!.positions : null;

    let bsx = 0, bsy = 0, bsz = 0;
    if (frame.boxBounds) {
      bsx = frame.boxBounds[1] - frame.boxBounds[0];
      bsy = frame.boxBounds[3] - frame.boxBounds[2];
      bsz = frame.boxBounds[5] - frame.boxBounds[4];
    }

    const base = new Float32Array(capacity * 3);
    const target = new Float32Array(capacity * 3);
    const radiusArr = new Float32Array(capacity);
    const color = new THREE.Color();
    const colorArray = mesh.instanceColor.array as Float32Array;

    let written = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let maxRadius = 0;
    let boundsAreFinite = true;

    for (let i = 0; i < renderAtomCount && written < capacity; i += 1) {
      const rawType = types[i];
      const entry = typeRenderTable.byRawType.get(rawType);
      if (!entry) continue;
      const radius = hiddenAtomTypes?.has(rawType)
        ? 0
        : entry.displayRadius * scale * (atomTypeScales?.[rawType] ?? 1);
      if (radius === 0) continue;

      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      let targetX = x;
      let targetY = y;
      let targetZ = z;
      if (nextPositions) {
        // Same PBC short-arc unwrap as the impostor GPU lerp.
        targetX = x + wrapDelta(nextPositions[i * 3] - x, bsx);
        targetY = y + wrapDelta(nextPositions[i * 3 + 1] - y, bsy);
        targetZ = z + wrapDelta(nextPositions[i * 3 + 2] - z, bsz);
      }

      const j = written * 3;
      base[j] = x;
      base[j + 1] = y;
      base[j + 2] = z;
      target[j] = targetX;
      target[j + 1] = targetY;
      target[j + 2] = targetZ;
      radiusArr[written] = radius;

      const [r, g, b] = resolveColor(i, entry.slot);
      // Palette values are display-sRGB (same authored values the impostor
      // palette textures decode); convert into the linear working space.
      color.setRGB(r, g, b, THREE.SRGBColorSpace);
      colorArray[j] = color.r;
      colorArray[j + 1] = color.g;
      colorArray[j + 2] = color.b;

      // Bound BOTH interpolation endpoints so the display-rate sweep can never
      // leave the culling sphere mid-substep.
      if (
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        && Number.isFinite(targetX) && Number.isFinite(targetY) && Number.isFinite(targetZ)
        && Number.isFinite(radius)
      ) {
        minX = Math.min(minX, x, targetX);
        minY = Math.min(minY, y, targetY);
        minZ = Math.min(minZ, z, targetZ);
        maxX = Math.max(maxX, x, targetX);
        maxY = Math.max(maxY, y, targetY);
        maxZ = Math.max(maxZ, z, targetZ);
        maxRadius = Math.max(maxRadius, radius);
      } else {
        boundsAreFinite = false;
      }

      written += 1;
    }

    const data: TransmissionInterpolationData = {
      count: written,
      base,
      target,
      radius: radiusArr,
      interpolatable: Boolean(nextPositions),
    };
    interpDataRef.current = data;

    const initialProgress = resolveLiveProgress(data.interpolatable);
    appliedProgressRef.current = initialProgress;
    applyTransmissionInstanceMatrices(mesh, data, initialProgress, scratchMatrix);

    mesh.count = written;
    mesh.instanceColor.needsUpdate = true;
    setVisibleCount(written);

    // InstancedMesh culls and raycasts against its OWN boundingSphere, and
    // three caches it after the first compute — install the exact bound for
    // this upload so a moving trajectory can never cull against stale extents.
    if (written > 0 && boundsAreFinite && Number.isFinite(minX)) {
      const center = new THREE.Vector3(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5,
      );
      const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + maxRadius;
      mesh.boundingSphere = new THREE.Sphere(center, radius);
    } else {
      // Invalid live data fails open: an infinite bound keeps the batch
      // visible instead of letting NaNs blank an otherwise-valid scene.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
    }

    if (!onSpatialHash) return;
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
    return () => cancelIdle(idleId as ReturnType<typeof setTimeout> & number);
    // The substep factor is deliberately NOT a dependency: uploads happen per
    // frame change; the useFrame sweep below owns per-substep motion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    frame, nextFrame, canInterpolateToNextFrame, renderAtomCount, capacity,
    geometry, typeRenderTable, hiddenAtomTypes, atomTypeScales, scale,
    colorMode, colormap, uniformColor, elementColorOverrides, atomColorSource,
    propData, propMin, propMax, onSpatialHash, scratchMatrix,
  ]);

  // ─── Display-rate interpolation sweep ───────────────────────────────
  // React syncs interpolationFactor at ~15fps during playback; the impostor
  // path stays smooth by reading the live playback ref each rAF. Do the same
  // here: rewrite instance matrices only when the live progress moves.
  useFrame(() => {
    const mesh = meshRef.current;
    const data = interpDataRef.current;
    if (!mesh || !data || !data.interpolatable || data.count === 0) return;
    const progress = resolveLiveProgress(true);
    if (Math.abs(progress - appliedProgressRef.current) < 1e-4) return;
    appliedProgressRef.current = progress;
    applyTransmissionInstanceMatrices(mesh, data, progress, scratchMatrix);
  });

  // Export receipt: ExportManager only trusts a capture when the atoms-layer
  // mesh's material carries the requested artifact spec id.
  useLayoutEffect(() => {
    const material = materialRef.current as unknown as THREE.Material | null;
    if (material) {
      material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] = artifactSpecId ?? null;
    }
  }, [artifactSpecId, visibleCount]);

  useLayoutEffect(() => {
    const hash = spatialHashRef.current;
    return () => hash.clear();
  }, []);

  const quality = transmissionQuality(qualityTier);

  return (
    <instancedMesh
      key={`transmission-${capacity}`}
      ref={meshRef}
      args={[geometry, undefined, capacity]}
      frustumCulled
      userData={{ [LUPI_ARTIFACT_LAYER_KEY]: LUPI_ARTIFACT_ATOMS_LAYER }}
    >
      <MeshTransmissionMaterial
        ref={materialRef}
        // Buffer pass cost knobs — see transmissionQuality().
        samples={quality.samples}
        resolution={quality.resolution}
        // Convex spheres in a crowd: the backside pass would double the buffer
        // renders for a face that is always overdrawn by a neighbor. Off, per
        // drei's guidance that backside suits solitary hero objects.
        backside={false}
        transmission={transmissionStrength(materialIntensity)}
        thickness={meanRadius * 1.35}
        ior={1.5}
        chromaticAberration={0.05}
        anisotropicBlur={0.12}
        // Deterministic renders are part of the export contract; the animated
        // distortion knobs would make two captures of one spec differ.
        distortion={0}
        temporalDistortion={0}
        roughness={Math.max(0, Math.min(1, TRANSMISSION_BASE_ROUGHNESS + surfaceRoughness))}
        roughnessMap={surfaceMap ?? undefined}
        clearcoat={surfaceClearcoat}
        clearcoatRoughness={0.08}
        attenuationDistance={meanRadius * 3}
        attenuationColor="#ffffff"
        envMapIntensity={1.2}
      />
    </instancedMesh>
  );
}
