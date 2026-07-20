import {
  hexToRgb,
  resolveAtomicNumber,
  resolveTypeColor,
  resolveTypeDisplayRadius,
} from '@atlas/core';
import type { Frame } from '@atlas/core/types';

/** The impostor shaders use an 8-bit palette coordinate. Raw source type IDs
 * are therefore mapped to dense slots; the raw integer is never used as a
 * texture index. */
export const MAX_RENDER_TYPE_SLOTS = 256;

export interface TypeRenderEntry {
  rawType: number;
  slot: number;
  atomicNumber?: number;
  color: [number, number, number];
  displayRadius: number;
}

export interface TypeRenderTable {
  entries: readonly TypeRenderEntry[];
  byRawType: ReadonlyMap<number, TypeRenderEntry>;
}

/**
 * Resolve the frame's raw type domain once per frame upload. Opaque LAMMPS
 * IDs receive stable categorical styling and a neutral radius; declared
 * elements receive element styling only through the core provenance gate.
 */
export function buildTypeRenderTable(
  frame: Frame,
  atomCount = frame.natoms,
): TypeRenderTable {
  if (!Number.isSafeInteger(atomCount) || atomCount < 0 || atomCount > frame.natoms) {
    throw new Error(`Invalid render atom count ${atomCount} for frame with ${frame.natoms} atoms.`);
  }
  if (frame.types.length < atomCount) {
    throw new Error('Frame type buffer does not contain every rendered atom.');
  }

  const unique = new Set<number>();
  for (let index = 0; index < atomCount; index += 1) unique.add(frame.types[index]);
  const rawTypes = Array.from(unique).sort((a, b) => a - b);
  if (rawTypes.length > MAX_RENDER_TYPE_SLOTS) {
    throw new Error(
      `Frame uses ${rawTypes.length} atom types; the renderer supports at most ${MAX_RENDER_TYPE_SLOTS} distinct types.`,
    );
  }

  const entries = rawTypes.map<TypeRenderEntry>((rawType, slot) => {
    const atomicNumber = resolveAtomicNumber(frame, rawType);
    return {
      rawType,
      slot,
      ...(atomicNumber === undefined ? {} : { atomicNumber }),
      color: hexToRgb(resolveTypeColor(frame, rawType)),
      displayRadius: resolveTypeDisplayRadius(frame, rawType),
    };
  });
  return {
    entries,
    byRawType: new Map(entries.map((entry) => [entry.rawType, entry])),
  };
}
