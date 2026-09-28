/**
 * <VectorGlyphs /> — Instanced per-atom vector arrows (forces, velocities).
 *
 * The first representation in Lupi beyond ball-and-stick: draws one arrow
 * per atom for any detected per-atom vector triplet (fx/fy/fz, vx/vy/vz,
 * compute outputs). Built on the same architecture as <AtomsOptimized />:
 *
 * - 1 quad per glyph (2 triangles), instanced — 100k arrows ≈ 200k tris
 * - The quad is oriented along the vector and rotated about that axis to
 *   face the camera (a "cylindrical billboard"), then the fragment carves
 *   the shaft + head silhouette (TSL node material:
 *   tsl/vectorGlyphMaterial.ts)
 * - Magnitude → color via the same 256×1 colormap-texture trick
 * - GPU cross-frame interpolation: position AND vector lerp by uProgress,
 *   uploaded once per frame change, swept at display rate
 * - Auto-scale: arrows are sized so the p95 magnitude maps to a readable
 *   world length (outlier forces don't flatten the field), with a hard
 *   per-arrow length cap at 3× that reference
 */

import { useMemo, useEffect, useId, useLayoutEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame, ColormapName } from '@atlas/core/types';
import type { VectorFieldSpec } from '@atlas/core';
import {
  getVectorComponents,
  ensureVectorMagnitude,
  framesShareAtomOrder,
  magnitudePercentile,
} from '@atlas/core';
import { wrapDelta } from './interpolation';
import { COLORMAPS } from './constants';
import {
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_LAYER_KEY,
} from './AtomsOptimized';
import { LUPI_JOB, LUPI_PHASE } from './framePhases';
import {
  GLYPH_ATTR,
  GLYPH_COLORMAP_SIZE,
  createGlyphColormapTexture,
  createVectorGlyphMaterial,
} from './tsl/vectorGlyphMaterial';

export interface VectorGlyphStats {
  /** p95 magnitude used as the color/scale reference. */
  refMagnitude: number;
  /** Min/max magnitude across shown glyphs (for legends). */
  magMin: number;
  magMax: number;
  /** Glyphs actually drawn after stride/hidden filtering. */
  shownCount: number;
}

interface VectorGlyphsProps {
  frame: Frame;
  nextFrame?: Frame;
  interpolationFactor?: number;
  /** Which vector field to draw (from detectFrameVectorFields). */
  field: VectorFieldSpec;
  /** User length multiplier on top of the auto p95 scale. Default 1. */
  scale?: number;
  /** Fraction of atoms to draw, (0, 1]. 1 = every atom. Strided
   *  deterministically so the sampled set is stable across frames. */
  density?: number;
  colormap?: ColormapName;
  hiddenAtomTypes?: Set<number>;
  /** Hard cap on drawn glyphs (default 250k). */
  maxGlyphs?: number;
  /** Playback live-ref pair — same contract as AtomsOptimized. */
  frameIndex?: number;
  liveStateRef?: { readonly current: { readonly effectiveFrame: number } | null };
  /** Reports magnitude range/reference for HUD legends. */
  onStats?: (stats: VectorGlyphStats) => void;
  /** Artifact revision this mesh has applied to buffers and material state. */
  artifactSpecId?: string;
}

const MIN_CAPACITY = 1024;

const GLYPH_ATTRIBUTES = [
  GLYPH_ATTR.position,
  GLYPH_ATTR.target,
  GLYPH_ATTR.vector,
  GLYPH_ATTR.targetVector,
] as const;

export const LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER = 'vectorGlyphs';

export function VectorGlyphs({
  frame,
  nextFrame,
  interpolationFactor = 0,
  field,
  scale = 1,
  density = 1,
  colormap = 'viridis',
  hiddenAtomTypes,
  maxGlyphs = 250_000,
  frameIndex,
  liveStateRef,
  onStats,
  artifactSpecId,
}: VectorGlyphsProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const canInterpolateToNextFrame = useMemo(
    () => Boolean(nextFrame && framesShareAtomOrder(frame, nextFrame)),
    [frame, nextFrame],
  );

  // Grow-only capacity, mirroring AtomsOptimized.
  const capacityRef = useRef(Math.max(MIN_CAPACITY, Math.ceil(frame.natoms * 1.2)));
  if (frame.natoms > capacityRef.current) {
    capacityRef.current = Math.max(capacityRef.current * 1.5, Math.ceil(frame.natoms * 1.2));
  }
  const capacity = Math.min(capacityRef.current, maxGlyphs);

  const geometry = useMemo(() => {
    const geo = new THREE.InstancedBufferGeometry();
    // Ribbon quad: x across [-1,1], y along [0,1].
    const quadPos = new Float32Array([
      -1, 0, 0,
       1, 0, 0,
       1, 1, 0,
      -1, 1, 0,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(quadPos, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    for (const name of GLYPH_ATTRIBUTES) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.instanceCount = 0;
    return geo;
  }, [capacity]);

  // Vector fields are an analytical overlay. With depth testing enabled,
  // arrows begin at atom centers and dense systems hide nearly every shaft
  // inside the atom cloud. A sparse deterministic sample rendered above the
  // structure keeps direction and magnitude readable at the compact viewport
  // sizes used by the Codex preview and mobile viewer (the material draws
  // with depthTest/depthWrite off).
  const { material, uniforms } = useMemo(
    () => createVectorGlyphMaterial(createGlyphColormapTexture()),
    [],
  );

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);
  useEffect(() => () => {
    uniforms.uColormap.value?.dispose();
    material.dispose();
  }, [material, uniforms]);

  // ─── Colormap texture (256×1, instant to rebuild) ──────────────────
  // Colormap pixels participate in immutable raster identity. Apply the
  // DataTexture during the React commit phase so a capture request committed
  // in the same update cannot reach Fiber with the previous colormap bytes.
  useLayoutEffect(() => {
    const mapFn = COLORMAPS[colormap] ?? COLORMAPS.viridis;
    const tex = uniforms.uColormap.value as THREE.DataTexture;
    const data = tex.image.data as Uint8Array;
    for (let i = 0; i < GLYPH_COLORMAP_SIZE; i++) {
      const [r, g, b] = mapFn(i / (GLYPH_COLORMAP_SIZE - 1));
      data[i * 4] = Math.round(r * 255);
      data[i * 4 + 1] = Math.round(g * 255);
      data[i * 4 + 2] = Math.round(b * 255);
      data[i * 4 + 3] = 255;
    }
    tex.needsUpdate = true;
  }, [colormap, uniforms]);

  // ─── Upload glyph data (once per frame/field change) ────────────────
  const uploadGlyphs = useCallback(() => {
    const comps = getVectorComponents(frame, field);
    if (!comps) {
      geometry.instanceCount = 0;
      return;
    }
    const [cx, cy, cz] = comps;
    const mag = ensureVectorMagnitude(frame, field);
    if (!mag) {
      geometry.instanceCount = 0;
      return;
    }

    // Auto-scale reference: p95 magnitude maps to ~3.5% of the box
    // diagonal (clamped to a readable absolute range). Robust to broken
    // frames where one force blows up.
    const ref = magnitudePercentile(mag, 0.95);
    let diag = 0;
    if (frame.boxBounds) {
      const dx = frame.boxBounds[1] - frame.boxBounds[0];
      const dy = frame.boxBounds[3] - frame.boxBounds[2];
      const dz = frame.boxBounds[5] - frame.boxBounds[4];
      diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const targetLen = Math.min(Math.max(0.035 * diag, 1.2), 8.0) * scale;
    const worldPerMag = ref > 0 ? targetLen / ref : 0;
    uniforms.uScale.value = worldPerMag;
    uniforms.uMaxLen.value = targetLen * 3;
    uniforms.uWidth.value = targetLen * 0.14;
    uniforms.uMagRange.value.set(0, ref > 0 ? ref : 1);

    const nextComps = canInterpolateToNextFrame ? getVectorComponents(nextFrame!, field) : null;
    const nextPos = canInterpolateToNextFrame ? nextFrame!.positions : null;

    let bsx = 0, bsy = 0, bsz = 0;
    if (frame.boxBounds) {
      bsx = frame.boxBounds[1] - frame.boxBounds[0];
      bsy = frame.boxBounds[3] - frame.boxBounds[2];
      bsz = frame.boxBounds[5] - frame.boxBounds[4];
    }

    const posArr = (geometry.attributes[GLYPH_ATTR.position] as THREE.InstancedBufferAttribute).array as Float32Array;
    const tgtArr = (geometry.attributes[GLYPH_ATTR.target] as THREE.InstancedBufferAttribute).array as Float32Array;
    const vecArr = (geometry.attributes[GLYPH_ATTR.vector] as THREE.InstancedBufferAttribute).array as Float32Array;
    const tvecArr = (geometry.attributes[GLYPH_ATTR.targetVector] as THREE.InstancedBufferAttribute).array as Float32Array;

    // Deterministic stride so the sampled subset is identical every frame.
    const stride = density >= 1 ? 1 : Math.max(1, Math.round(1 / Math.max(density, 1e-3)));

    let shown = 0;
    let magMin = Infinity;
    let magMax = -Infinity;
    const positions = frame.positions;
    const types = frame.types;

    for (let i = 0; i < frame.natoms; i += stride) {
      if (shown >= capacity) break;
      if (hiddenAtomTypes?.has(types[i])) continue;

      const pi = shown * 3;
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      posArr[pi] = x; posArr[pi + 1] = y; posArr[pi + 2] = z;

      if (nextPos) {
        // Short-arc PBC unwrap, same as the atom renderer.
        tgtArr[pi]     = x + wrapDelta(nextPos[i * 3]     - x, bsx);
        tgtArr[pi + 1] = y + wrapDelta(nextPos[i * 3 + 1] - y, bsy);
        tgtArr[pi + 2] = z + wrapDelta(nextPos[i * 3 + 2] - z, bsz);
      } else {
        tgtArr[pi] = x; tgtArr[pi + 1] = y; tgtArr[pi + 2] = z;
      }

      vecArr[pi] = cx[i]; vecArr[pi + 1] = cy[i]; vecArr[pi + 2] = cz[i];
      if (nextComps) {
        tvecArr[pi] = nextComps[0][i]; tvecArr[pi + 1] = nextComps[1][i]; tvecArr[pi + 2] = nextComps[2][i];
      } else {
        tvecArr[pi] = cx[i]; tvecArr[pi + 1] = cy[i]; tvecArr[pi + 2] = cz[i];
      }

      const m = mag[i];
      if (m < magMin) magMin = m;
      if (m > magMax) magMax = m;
      shown++;
    }

    geometry.instanceCount = shown;
    for (const name of GLYPH_ATTRIBUTES) {
      (geometry.attributes[name] as THREE.InstancedBufferAttribute).needsUpdate = true;
    }

    onStats?.({
      refMagnitude: ref,
      magMin: magMin === Infinity ? 0 : magMin,
      magMax: magMax === -Infinity ? 0 : magMax,
      shownCount: shown,
    });
  }, [frame, nextFrame, canInterpolateToNextFrame, field, scale, density, hiddenAtomTypes, capacity, geometry, uniforms, onStats]);

  // Positions, vectors, density, visibility, and scale are all addressed by
  // the artifact spec/source digest. Upload them during the commit phase; a
  // passive effect can lose a race with the next browser animation frame.
  useLayoutEffect(() => {
    uploadGlyphs();
  }, [uploadGlyphs]);

  // This receipt is intentionally installed after both layout effects above.
  // ExportManager may capture only when the tagged Three mesh carries the exact
  // spec revision whose vector buffers and colormap are now applied. A zero
  // instance result is still exact when visibility intentionally hides all.
  useLayoutEffect(() => {
    material.userData[LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY] =
      artifactSpecId ?? null;
  }, [artifactSpecId, geometry, material, uploadGlyphs, colormap]);

  // Live interpolation progress — identical contract to AtomsOptimized. The
  // job id is per instance: the scheduler keys jobs by id.
  const uniformsJobId = `${LUPI_JOB.glyphsUniforms}:${useId()}`;
  useFrame(() => {
    const live = liveStateRef?.current;
    const prog = canInterpolateToNextFrame && live && frameIndex != null
      ? live.effectiveFrame - frameIndex
      : canInterpolateToNextFrame
        ? interpolationFactor
        : 0;
    uniforms.uProgress.value = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  }, { phase: LUPI_PHASE.uniforms, id: uniformsJobId });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={1}
      userData={{ [LUPI_ARTIFACT_LAYER_KEY]: LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER }}
    />
  );
}

export default VectorGlyphs;
