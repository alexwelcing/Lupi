/**
 * specimenShadow.ts — the Specimen floor shadow's parameters, shared by the
 * viewer (app/ViewerScene.tsx, LupiContactShadow) and the artifact adapter
 * (mcp/renderArtifactAdapter.ts), so an artifact spec's `contactShadows`
 * layer states exactly what the viewer draws.
 */

export const SPECIMEN_SHADOW = {
  /** LupiContactShadow blur (drei units). */
  blur: 2.2,
  color: '#04060c',
  /** Penumbra growth per unit height. */
  spread: 0.3,
  /** The shadow leans this fraction of the way to a true cast shadow. */
  lean: 0.33,
  /** Above this many atoms the CPU splat would stall the main thread. */
  maxAtoms: 50_000,
  /** Up to this many atoms the mask is 1024 px, above it 512. */
  highQualityAtoms: 5_000,
} as const;

export function specimenShadowEnabled(atomCount: number): boolean {
  return atomCount <= SPECIMEN_SHADOW.maxAtoms;
}

export function specimenShadowResolution(atomCount: number): 1024 | 512 {
  return atomCount <= SPECIMEN_SHADOW.highQualityAtoms ? 1024 : 512;
}

/** A touch deeper under the moody Looks. */
export function specimenShadowOpacity(postprocessPreset: string): number {
  return postprocessPreset === 'cinematic' || postprocessPreset === 'editorial' ? 0.62 : 0.5;
}

/**
 * World (x, z) offset per unit height: away from the key light, a third of
 * the way to a true cast shadow (cot of the elevation), so it stays a contact
 * shadow under the molecule rather than a long cast one.
 */
export function specimenShadowSkew(keyAzimuthDeg: number, keyElevationDeg: number): [number, number] {
  const az = (keyAzimuthDeg * Math.PI) / 180;
  const el = (Math.max(15, Math.min(89, keyElevationDeg)) * Math.PI) / 180;
  const lean = Math.min(1.5, 1 / Math.tan(el)) * SPECIMEN_SHADOW.lean;
  return [-Math.sin(az) * lean, -Math.cos(az) * lean];
}

/**
 * Where the Specimen floor shadow sits: under a molecule, on an invisible
 * table just below its lowest atom; under a crystal shown with its cell, on
 * the cell floor. Placement uses the trajectory's global bounds, so the
 * table never jumps between frames.
 */
export interface SpecimenShadowPlacement {
  center: [number, number, number];
  planeSize: number;
  /** Height above the plane at which atoms stop casting. */
  far: number;
}

export function specimenShadowPlacement(
  bounds: { min: ArrayLike<number>; max: ArrayLike<number> },
  maxAtomRadius: number,
  cellFloor: { x: number; y: number; z: number; dx: number; dz: number } | null,
): SpecimenShadowPlacement {
  if (cellFloor) {
    return {
      center: [cellFloor.x, cellFloor.y - 0.05, cellFloor.z],
      planeSize: Math.max(cellFloor.dx, cellFloor.dz) * 1.6,
      far: Math.max(20, cellFloor.dx * 0.6),
    };
  }
  const pad = Math.max(0, maxAtomRadius);
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const extent = Math.max(dx, dy, dz) + 2 * pad;
  const gap = Math.max(0.02, extent * 0.015);
  return {
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      bounds.min[1] - pad - gap,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
    planeSize: Math.max(4, extent * 2.6),
    far: Math.max(1, dy + 2 * pad) * 1.15,
  };
}
