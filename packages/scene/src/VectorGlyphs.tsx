/**
 * <VectorGlyphs /> — Instanced per-atom vector arrows (forces, velocities).
 *
 * The first representation in Lupi beyond ball-and-stick: draws one arrow
 * per atom for any detected per-atom vector triplet (fx/fy/fz, vx/vy/vz,
 * compute outputs). Built on the same architecture as <AtomsOptimized />:
 *
 * - 1 quad per glyph (2 triangles), instanced — 100k arrows ≈ 200k tris
 * - The quad is oriented along the vector in world space and rotated
 *   about that axis to face the camera (a "cylindrical billboard"), then
 *   the fragment shader carves an anti-aliased shaft + head silhouette
 * - Magnitude → color via the same 256×1 colormap-texture trick
 * - GPU cross-frame interpolation: position AND vector lerp by uProgress,
 *   uploaded once per frame change, swept at display rate
 * - Auto-scale: arrows are sized so the p95 magnitude maps to a readable
 *   world length (outlier forces don't flatten the field), with a hard
 *   per-arrow length cap at 3× that reference
 */

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Frame, ColormapName } from '@atlas/core/types';
import type { VectorFieldSpec } from '@atlas/core';
import {
  getVectorComponents,
  ensureVectorMagnitude,
  magnitudePercentile,
} from '@atlas/core';
import { wrapDelta } from './interpolation';
import { COLORMAPS } from './constants';

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
}

const VERTEX = /* glsl */ `
  attribute vec3 instancePosition;
  attribute vec3 instanceTargetPosition;
  attribute vec3 instanceVector;
  attribute vec3 instanceTargetVector;

  uniform float uProgress;   // 0..1 frame interpolation
  uniform float uScale;      // world length per magnitude unit
  uniform float uMaxLen;     // world-length cap per arrow
  uniform float uWidth;      // arrow half-width at the head, world units
  uniform vec2  uMagRange;   // magnitude -> colormap normalization
  uniform sampler2D uColormap;

  varying vec3 vColor;
  varying vec2 vUv;          // x in [-1,1] across, y in [0,1] along
  varying float vLen;        // final world length (0 kills the glyph)

  void main() {
    vec3 P = mix(instancePosition, instanceTargetPosition, uProgress);
    vec3 V = mix(instanceVector, instanceTargetVector, uProgress);
    float mag = length(V);

    float t = clamp((mag - uMagRange.x) / max(uMagRange.y - uMagRange.x, 1e-20), 0.0, 1.0);
    vColor = texture2D(uColormap, vec2(t, 0.5)).rgb;

    float len = min(mag * uScale, uMaxLen);
    vLen = len;
    vUv = vec2(position.x, position.y);

    vec3 axis = mag > 1e-12 ? V / mag : vec3(0.0, 0.0, 1.0);

    // Cylindrical billboard: rotate the ribbon about the arrow axis so
    // its face points at the camera. Degenerates only when the axis runs
    // straight into the camera — then any side vector works.
    vec3 toCam = cameraPosition - P;
    vec3 side = cross(axis, toCam);
    float sideLen = length(side);
    side = sideLen > 1e-6 ? side / sideLen : normalize(cross(axis, vec3(0.0, 1.0, 0.01)));

    // Width tapers with very short arrows so tiny vectors don't read as blobs.
    float w = uWidth * clamp(len / max(uMaxLen * 0.35, 1e-6), 0.35, 1.0);

    vec3 world = P + axis * (position.y * len) + side * (position.x * w);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vLen;

  void main() {
    if (vLen <= 1e-6) discard;

    // Arrow silhouette in ribbon space: shaft up to y=0.62, head 0.62..1.
    float ax = abs(vUv.x);
    float inShaft = step(ax, 0.22) * step(vUv.y, 0.62);
    float headHalf = (1.0 - vUv.y) / 0.38;        // 1 at head base -> 0 at tip
    float inHead = step(0.62, vUv.y) * step(ax, headHalf);
    if (inShaft + inHead < 0.5) discard;

    // Cheap shading: darken toward the ribbon edge for a rounded read.
    float edge = 1.0 - 0.35 * smoothstep(0.0, 1.0, ax / max(headHalf, 0.22));
    gl_FragColor = vec4(vColor * edge, 1.0);
  }
`;

const MIN_CAPACITY = 1024;

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
}: VectorGlyphsProps) {
  const meshRef = useRef<THREE.Mesh>(null);

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

    for (const name of ['instancePosition', 'instanceTargetPosition', 'instanceVector', 'instanceTargetVector']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.instanceCount = 0;
    return geo;
  }, [capacity]);

  const material = useMemo(() => {
    const colormapTex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
    colormapTex.needsUpdate = true;
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uProgress: { value: 0 },
        uScale: { value: 1 },
        uMaxLen: { value: 3 },
        uWidth: { value: 0.25 },
        uMagRange: { value: new THREE.Vector2(0, 1) },
        uColormap: { value: colormapTex },
      },
      depthWrite: true,
      depthTest: true,
      transparent: false,
      side: THREE.DoubleSide,
    });
  }, []);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);
  useEffect(() => () => {
    (material.uniforms.uColormap.value as THREE.Texture)?.dispose();
    material.dispose();
  }, [material]);

  // ─── Colormap texture (256×1, instant to rebuild) ──────────────────
  useEffect(() => {
    const mapFn = COLORMAPS[colormap] ?? COLORMAPS.viridis;
    const tex = material.uniforms.uColormap.value as THREE.DataTexture;
    const data = tex.image.data as Uint8Array;
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = mapFn(i / 255);
      data[i * 4] = Math.round(r * 255);
      data[i * 4 + 1] = Math.round(g * 255);
      data[i * 4 + 2] = Math.round(b * 255);
      data[i * 4 + 3] = 255;
    }
    tex.needsUpdate = true;
  }, [colormap, material]);

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
    material.uniforms.uScale.value = worldPerMag;
    material.uniforms.uMaxLen.value = targetLen * 3;
    material.uniforms.uWidth.value = targetLen * 0.14;
    material.uniforms.uMagRange.value.set(0, ref > 0 ? ref : 1);

    const hasNext = !!(nextFrame && nextFrame.natoms === frame.natoms);
    const nextComps = hasNext ? getVectorComponents(nextFrame!, field) : null;
    const nextPos = hasNext ? nextFrame!.positions : null;

    let bsx = 0, bsy = 0, bsz = 0;
    if (frame.boxBounds) {
      bsx = frame.boxBounds[1] - frame.boxBounds[0];
      bsy = frame.boxBounds[3] - frame.boxBounds[2];
      bsz = frame.boxBounds[5] - frame.boxBounds[4];
    }

    const posArr = (geometry.attributes.instancePosition as THREE.InstancedBufferAttribute).array as Float32Array;
    const tgtArr = (geometry.attributes.instanceTargetPosition as THREE.InstancedBufferAttribute).array as Float32Array;
    const vecArr = (geometry.attributes.instanceVector as THREE.InstancedBufferAttribute).array as Float32Array;
    const tvecArr = (geometry.attributes.instanceTargetVector as THREE.InstancedBufferAttribute).array as Float32Array;

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
    for (const name of ['instancePosition', 'instanceTargetPosition', 'instanceVector', 'instanceTargetVector']) {
      (geometry.attributes[name] as THREE.InstancedBufferAttribute).needsUpdate = true;
    }

    onStats?.({
      refMagnitude: ref,
      magMin: magMin === Infinity ? 0 : magMin,
      magMax: magMax === -Infinity ? 0 : magMax,
      shownCount: shown,
    });
  }, [frame, nextFrame, field, scale, density, hiddenAtomTypes, capacity, geometry, material, onStats]);

  useEffect(() => {
    uploadGlyphs();
  }, [uploadGlyphs]);

  // Live interpolation progress — identical contract to AtomsOptimized.
  useFrame(() => {
    const live = liveStateRef?.current;
    const prog = (live && frameIndex != null)
      ? live.effectiveFrame - frameIndex
      : interpolationFactor;
    material.uniforms.uProgress.value = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}

export default VectorGlyphs;
