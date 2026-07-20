import { ELEMENT_DATA } from './elements';
import type { AtomTypeSemantics, DistanceSemantics, Frame } from './types';

export const LEGACY_ATOM_TYPE_SEMANTICS: AtomTypeSemantics = Object.freeze({
  kind: 'opaque',
  provenance: 'legacy-unknown',
});

export const LEGACY_DISTANCE_SEMANTICS: DistanceSemantics = Object.freeze({
  kind: 'unknown',
  provenance: 'legacy-unknown',
});

/** A coordinate-space-neutral radius used when Ångström scale is not known. */
export const NEUTRAL_TYPE_DISPLAY_RADIUS = 0.5;

const OPAQUE_TYPE_COLORS = Object.freeze([
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
]);

export function normalizeAtomTypeSemantics(
  semantics: AtomTypeSemantics | null | undefined,
): AtomTypeSemantics {
  return semantics ?? LEGACY_ATOM_TYPE_SEMANTICS;
}

export function normalizeDistanceSemantics(
  semantics: DistanceSemantics | null | undefined,
): DistanceSemantics {
  return semantics ?? LEGACY_DISTANCE_SEMANTICS;
}

function isKnownAtomicNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Object.prototype.hasOwnProperty.call(ELEMENT_DATA, value)
  );
}

function resolveAtomicNumberFromSemantics(
  semantics: AtomTypeSemantics,
  rawType: number,
): number | undefined {
  let candidate: unknown;

  if (semantics.kind === 'atomic-number') {
    candidate = rawType;
  } else if (semantics.kind === 'explicit-element-map') {
    candidate = Object.prototype.hasOwnProperty.call(semantics.elementMap, rawType)
      ? semantics.elementMap[rawType]
      : undefined;
  } else {
    return undefined;
  }

  return isKnownAtomicNumber(candidate) ? candidate : undefined;
}

/**
 * Resolve a raw frame type to an atomic number only when the frame declares
 * element semantics and Lupi has a real periodic-table entry for the result.
 */
export function resolveAtomicNumber(
  frame: Pick<Frame, 'typeSemantics'>,
  rawType: number,
): number | undefined {
  const semantics = normalizeAtomTypeSemantics(frame.typeSemantics);
  return resolveAtomicNumberFromSemantics(semantics, rawType);
}

/** Whether every atom type actually used by the frame maps to a known element. */
export function hasCompleteElementMapping(
  frame: Pick<Frame, 'natoms' | 'types' | 'typeSemantics'>,
): boolean {
  if (!Number.isSafeInteger(frame.natoms) || frame.natoms < 0 || frame.types.length < frame.natoms) {
    return false;
  }
  const semantics = normalizeAtomTypeSemantics(frame.typeSemantics);
  if (semantics.kind === 'opaque') return false;

  for (let i = 0; i < frame.natoms; i++) {
    if (resolveAtomicNumberFromSemantics(semantics, frame.types[i]) === undefined) return false;
  }
  return true;
}

/** Stable categorical color for an opaque raw type ID; no chemistry implied. */
export function stableCategoricalColor(rawType: number): string {
  const integer = Number.isFinite(rawType) ? Math.trunc(rawType) : 0;
  const index = ((integer % OPAQUE_TYPE_COLORS.length) + OPAQUE_TYPE_COLORS.length)
    % OPAQUE_TYPE_COLORS.length;
  return OPAQUE_TYPE_COLORS[index];
}

export function resolveTypeLabel(
  frame: Pick<Frame, 'typeSemantics'>,
  rawType: number,
): string {
  const atomicNumber = resolveAtomicNumber(frame, rawType);
  return atomicNumber === undefined ? `Type ${rawType}` : ELEMENT_DATA[atomicNumber].symbol;
}

export function resolveTypeColor(
  frame: Pick<Frame, 'typeSemantics'>,
  rawType: number,
): string {
  const atomicNumber = resolveAtomicNumber(frame, rawType);
  return atomicNumber === undefined
    ? stableCategoricalColor(rawType)
    : ELEMENT_DATA[atomicNumber].color;
}

export function hasAngstromDistances(frame: Pick<Frame, 'distanceSemantics'>): boolean {
  return normalizeDistanceSemantics(frame.distanceSemantics).kind === 'angstrom';
}

/**
 * Resolve a display radius without applying Ångström-valued element radii to
 * coordinates whose physical scale is unknown.
 */
export function resolveTypeDisplayRadius(
  frame: Pick<Frame, 'typeSemantics' | 'distanceSemantics'>,
  rawType: number,
): number {
  if (!hasAngstromDistances(frame)) return NEUTRAL_TYPE_DISPLAY_RADIUS;
  const atomicNumber = resolveAtomicNumber(frame, rawType);
  return atomicNumber === undefined
    ? NEUTRAL_TYPE_DISPLAY_RADIUS
    : ELEMENT_DATA[atomicNumber].displayRadius;
}

/** Covalent-radius inference is valid only for known elements in Ångström. */
export function canInferCovalentBonds(
  frame: Pick<Frame, 'natoms' | 'types' | 'typeSemantics' | 'distanceSemantics'>,
): boolean {
  return hasAngstromDistances(frame) && hasCompleteElementMapping(frame);
}
