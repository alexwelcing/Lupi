/**
 * exportStyle — single source of truth for how the *loaded* molecule is
 * styled when it leaves the viewer.
 *
 * The color / radius / covalent-radius / material resolvers here were
 * previously inlined inside ExportManager.handle3DExport (GLB / USDZ). They
 * are now shared so the transparent print-on-demand PNG renderer produces a
 * pixel-consistent asset with the 3D exports: same atom colors, same radii,
 * same material preset, same bond set. Change coloring in one place and every
 * export format follows.
 *
 * Pure data-in / resolvers-out: no React, no DOM, no offscreen GL. The heavy
 * scene construction still lives in exportSceneBuilder; this just feeds it.
 */

import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { getElementSpec } from '@atlas/core';
import type { useStore } from '../store';
import type { ExportMaterialPreset } from './exportSceneBuilder';

const SINGLE_TYPE_NORM_VALUE = 0.5;
const MIN_NUMERIC_RANGE = 1e-6;

type StoreState = ReturnType<typeof useStore.getState>;

export interface ExportStyle {
  resolveAtomColor: (atomIndex: number, typeId: number) => [number, number, number];
  displayRadiusForType: (typeId: number) => number;
  covalentRadii: Float32Array;
  hiddenTypes: ReadonlySet<number>;
  showBonds: boolean;
  bondTolerance: number;
  materialPreset: ExportMaterialPreset;
  surfacePolish: number;
  surfaceRoughness: number;
}

/**
 * Resolve the active viewer's atom coloring, radii, bonds, and material into
 * a set of pure functions the export scene builder can drive. Mirrors the
 * live viewer's element-aware bond test (d ≤ r_cov(A)+r_cov(B)+tolerance) and
 * the three coloring modes (type / property / uniform) exactly.
 *
 * `@atlas/scene`'s color/radius tables are dynamically imported so the export
 * path stays code-split out of the main bundle, matching how handle3DExport
 * loaded them before.
 */
export async function buildExportStyle(state: StoreState, frame: Frame): Promise<ExportStyle> {
  const { TYPE_COLORS, TYPE_RADII, DEFAULT_TYPE_COLOR, COLORMAPS } = await import('@atlas/scene');

  const mapFn = COLORMAPS[state.colormap] ?? COLORMAPS.viridis;

  const typeSet = new Set<number>();
  for (let i = 0; i < frame.natoms; i++) typeSet.add(frame.types[i]);
  const sortedTypes = Array.from(typeSet).sort((a, b) => a - b);
  const typeToNorm = new Map<number, number>();
  for (let i = 0; i < sortedTypes.length; i++) {
    typeToNorm.set(
      sortedTypes[i],
      sortedTypes.length > 1 ? i / (sortedTypes.length - 1) : SINGLE_TYPE_NORM_VALUE,
    );
  }

  const resolveTypeColor = (typeId: number): [number, number, number] => {
    if (state.atomColorSource === 'element') {
      const override = state.elementColorOverrides[typeId];
      if (override) return new THREE.Color(override).toArray() as [number, number, number];
      return TYPE_COLORS[typeId] ?? DEFAULT_TYPE_COLOR;
    }
    const t = typeToNorm.get(typeId) ?? SINGLE_TYPE_NORM_VALUE;
    return mapFn(t);
  };

  const propertyData = state.colorMode === 'property' && state.colorProperty
    ? frame.properties?.get(state.colorProperty)
    : null;
  let propertyMin = state.propRange[0];
  let propertyMax = state.propRange[1];
  if (propertyData && (!Number.isFinite(propertyMin) || !Number.isFinite(propertyMax) || propertyMin >= propertyMax)) {
    propertyMin = Infinity;
    propertyMax = -Infinity;
    for (let i = 0; i < propertyData.length; i++) {
      const v = propertyData[i];
      if (v < propertyMin) propertyMin = v;
      if (v > propertyMax) propertyMax = v;
    }
  }
  const propertyRange = Math.max(propertyMax - propertyMin, MIN_NUMERIC_RANGE);

  const resolveAtomColor = (atomIndex: number, atomType: number): [number, number, number] => {
    if (state.colorMode === 'property' && propertyData) {
      const t = Math.max(0, Math.min(1, (propertyData[atomIndex] - propertyMin) / propertyRange));
      return mapFn(t);
    }
    if (state.colorMode === 'uniform') {
      return new THREE.Color(state.uniformAtomColor).toArray() as [number, number, number];
    }
    return resolveTypeColor(atomType);
  };

  let maxTypeId = 0;
  for (const t of typeSet) if (t > maxTypeId) maxTypeId = t;
  const covalentRadii = new Float32Array(maxTypeId + 1);
  for (const t of typeSet) covalentRadii[t] = getElementSpec(t).radius;

  const displayRadiusForType = (typeId: number) =>
    (TYPE_RADII[typeId] ?? 1.0) * (state.atomScale ?? 1.0) * (state.atomTypeScales[typeId] ?? 1.0);

  return {
    resolveAtomColor,
    displayRadiusForType,
    covalentRadii,
    hiddenTypes: state.hiddenAtomTypes,
    showBonds: state.showBonds,
    bondTolerance: state.bondTolerance ?? 0.45,
    materialPreset: state.materialPreset,
    surfacePolish: state.surfacePolish || 0.0,
    surfaceRoughness: state.surfaceRoughness || 0.0,
  };
}
