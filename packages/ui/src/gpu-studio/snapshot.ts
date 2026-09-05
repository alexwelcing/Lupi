import { resolveTypeColor, resolveTypeDisplayRadius, resolveTypeLabel } from '@atlas/core';
import type { Frame } from '@atlas/core';

export const GPU_STUDIO_ATOM_LIMIT = 5_000;
export type StudioLook = 'studio' | 'contours';
export interface StudioSnapshot {
  name: string;
  frameNumber: number;
  atomCount: number;
  groups: Array<{
    label: string;
    color: string;
    radius: number;
    positions: number[];
  }>;
}

/** A bounded, owned copy of one source frame. Never retain streaming buffers. */
export function snapshotForStudio(
  frame: Frame | undefined,
  loadedAtomCount: number,
  name: string,
  frameNumber: number,
): StudioSnapshot {
  if (
    !frame ||
    !Number.isInteger(frame.natoms) ||
    frame.natoms < 1 ||
    loadedAtomCount < frame.natoms
  ) {
    throw new Error(
      'This frame is still loading. Return to the viewer and try again once it is ready.',
    );
  }
  if (frame.natoms > GPU_STUDIO_ATOM_LIMIT) {
    throw new Error(
      'GPU Studio currently supports up to 5,000 atoms. Your full model is still available in the regular viewer.',
    );
  }
  if (frame.positions.length < frame.natoms * 3 || frame.types.length < frame.natoms) {
    throw new Error(
      'This frame has incomplete coordinates. The regular viewer is still available.',
    );
  }
  const groups = new Map<number, StudioSnapshot['groups'][number]>();
  for (let i = 0; i < frame.natoms; i++) {
    const rawType = frame.types[i];
    let group = groups.get(rawType);
    if (!group) {
      group = {
        label: resolveTypeLabel(frame, rawType),
        color: resolveTypeColor(frame, rawType),
        radius: resolveTypeDisplayRadius(frame, rawType),
        positions: [],
      };
      groups.set(rawType, group);
    }
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = frame.positions[i * 3 + axis];
      if (!Number.isFinite(coordinate))
        throw new Error('This frame contains invalid coordinates. GPU Studio cannot display it.');
      group.positions.push(coordinate);
    }
  }
  return {
    name,
    frameNumber,
    atomCount: frame.natoms,
    groups: [...groups.values()],
  };
}
