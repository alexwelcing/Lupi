import {
  hasAngstromDistances,
  hasUsableSourceIds,
  resolveTypeLabel,
} from '@atlas/core';
import type { Frame } from '@atlas/core/types';

export type MeasurementKind = 'distance' | 'angle';
export type MeasurementTool = MeasurementKind | null;

export type MeasurementAtomReference =
  | { identity: 'source-id'; id: number; capturedIndex: number }
  | { identity: 'source-order'; row: number }
  | { identity: 'frame-row'; row: number; frame: number };

export interface MolecularMeasurement {
  kind: MeasurementKind;
  atoms: MeasurementAtomReference[];
  capturedFrame: number;
}

export interface ResolvedMeasurementAtom {
  index: number;
  id: number;
  label: string;
  position: [number, number, number];
}

export interface ResolvedMolecularMeasurement {
  kind: MeasurementKind;
  status: 'incomplete' | 'unavailable' | 'ready';
  atoms: ResolvedMeasurementAtom[];
  requiredAtoms: number;
  value: number | null;
  unit: 'angstrom' | 'source-units' | 'degrees';
  unitLabel: 'Å' | 'source units' | '°';
  identityLabel: string;
  coordinateProvenance: string;
  periodicTreatment: 'displayed-cartesian-no-minimum-image';
  message: string;
}

export function requiredMeasurementAtoms(kind: MeasurementKind): 2 | 3 {
  return kind === 'distance' ? 2 : 3;
}

export function sanitizeMolecularMeasurement(value: unknown): MolecularMeasurement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'distance' && candidate.kind !== 'angle') return null;
  if (!isBoundedIndex(candidate.capturedFrame)) return null;
  if (!Array.isArray(candidate.atoms)) return null;
  const required = requiredMeasurementAtoms(candidate.kind);
  if (candidate.atoms.length > required) return null;

  const atoms: MeasurementAtomReference[] = [];
  for (const rawAtom of candidate.atoms) {
    if (!rawAtom || typeof rawAtom !== 'object' || Array.isArray(rawAtom)) return null;
    const atom = rawAtom as Record<string, unknown>;
    if (atom.identity === 'source-id') {
      if (!isInt32(atom.id) || !isBoundedIndex(atom.capturedIndex)) return null;
      atoms.push({ identity: 'source-id', id: atom.id, capturedIndex: atom.capturedIndex });
      continue;
    }
    if (atom.identity === 'source-order') {
      if (!isBoundedIndex(atom.row)) return null;
      atoms.push({ identity: 'source-order', row: atom.row });
      continue;
    }
    if (atom.identity === 'frame-row') {
      if (!isBoundedIndex(atom.row) || !isBoundedIndex(atom.frame)) return null;
      atoms.push({ identity: 'frame-row', row: atom.row, frame: atom.frame });
      continue;
    }
    return null;
  }

  return {
    kind: candidate.kind,
    capturedFrame: candidate.capturedFrame,
    atoms,
  };
}

export function captureMeasurement(
  frame: Frame,
  frameIndex: number,
  kind: MeasurementKind,
  atomIndices: readonly number[],
): MolecularMeasurement {
  const required = requiredMeasurementAtoms(kind);
  const uniqueIndices = atomIndices
    .filter((index, position, values) => (
      Number.isSafeInteger(index)
      && index >= 0
      && index < frame.natoms
      && values.indexOf(index) === position
    ))
    .slice(-required);

  return {
    kind,
    capturedFrame: frameIndex,
    atoms: uniqueIndices.map((index): MeasurementAtomReference => {
      if (hasUsableSourceIds(frame)) {
        return { identity: 'source-id', id: frame.ids[index], capturedIndex: index };
      }
      if (frame.identity?.kind === 'source-order' && frame.identity.unique) {
        return { identity: 'source-order', row: index };
      }
      return { identity: 'frame-row', row: index, frame: frameIndex };
    }),
  };
}

export function resolveMeasurementAtomIndices(
  frame: Frame,
  frameIndex: number,
  measurement: MolecularMeasurement | null,
): number[] {
  if (!measurement) return [];
  const resolved: number[] = [];

  for (const atom of measurement.atoms) {
    let index = -1;
    if (atom.identity === 'source-id') {
      if (!hasUsableSourceIds(frame)) return [];
      index = atom.capturedIndex < frame.natoms && frame.ids[atom.capturedIndex] === atom.id
        ? atom.capturedIndex
        : frame.ids.indexOf(atom.id);
    } else if (atom.identity === 'source-order') {
      if (frame.identity?.kind !== 'source-order' || !frame.identity.unique) return [];
      index = atom.row;
    } else {
      if (atom.frame !== frameIndex) return [];
      index = atom.row;
    }

    if (index < 0 || index >= frame.natoms || resolved.includes(index)) return [];
    resolved.push(index);
  }

  return resolved;
}

/** Convert a measurement into the row identity of a one-frame inline snapshot.
 * Inline XYZ deliberately does not preserve source atom IDs or trajectory
 * identity, so carrying the original references would make reopen silently
 * lose the measurement. */
export function measurementForInlineSnapshot(
  frame: Frame,
  frameIndex: number,
  measurement: MolecularMeasurement | null,
): MolecularMeasurement | null {
  if (!measurement) return null;
  const indices = resolveMeasurementAtomIndices(frame, frameIndex, measurement);
  if (indices.length !== measurement.atoms.length) return null;
  return {
    kind: measurement.kind,
    capturedFrame: 0,
    atoms: indices.map((row) => ({ identity: 'frame-row', row, frame: 0 })),
  };
}

export function resolveMolecularMeasurement(
  frame: Frame,
  frameIndex: number,
  measurement: MolecularMeasurement | null,
): ResolvedMolecularMeasurement | null {
  if (!measurement) return null;

  const requiredAtoms = requiredMeasurementAtoms(measurement.kind);
  const indices = resolveMeasurementAtomIndices(frame, frameIndex, measurement);
  const identityLabel = measurementIdentityLabel(measurement);
  const distanceIsAngstrom = hasAngstromDistances(frame);
  const coordinateProvenance = distanceIsAngstrom
    ? `Source coordinates are declared in angstroms (${frame.distanceSemantics?.provenance ?? 'declared'}).`
    : `Source coordinate units are unknown (${frame.distanceSemantics?.provenance ?? 'legacy-unknown'}); no physical unit conversion is applied.`;

  if (indices.length !== measurement.atoms.length) {
    return {
      kind: measurement.kind,
      status: 'unavailable',
      atoms: [],
      requiredAtoms,
      value: null,
      unit: measurement.kind === 'angle' ? 'degrees' : distanceIsAngstrom ? 'angstrom' : 'source-units',
      unitLabel: measurement.kind === 'angle' ? '°' : distanceIsAngstrom ? 'Å' : 'source units',
      identityLabel,
      coordinateProvenance,
      periodicTreatment: 'displayed-cartesian-no-minimum-image',
      message: 'The selected atoms cannot be matched honestly in this frame. Return to the capture frame or use a trajectory with stable source IDs/order.',
    };
  }

  const atoms = indices.map((index): ResolvedMeasurementAtom => ({
    index,
    id: frame.ids[index] ?? index,
    label: `${resolveTypeLabel(frame, frame.types[index])} ${frame.ids[index] ?? index}`,
    position: [
      frame.positions[index * 3],
      frame.positions[index * 3 + 1],
      frame.positions[index * 3 + 2],
    ],
  }));

  if (atoms.length < requiredAtoms) {
    return {
      kind: measurement.kind,
      status: 'incomplete',
      atoms,
      requiredAtoms,
      value: null,
      unit: measurement.kind === 'angle' ? 'degrees' : distanceIsAngstrom ? 'angstrom' : 'source-units',
      unitLabel: measurement.kind === 'angle' ? '°' : distanceIsAngstrom ? 'Å' : 'source units',
      identityLabel,
      coordinateProvenance,
      periodicTreatment: 'displayed-cartesian-no-minimum-image',
      message: `Select ${requiredAtoms - atoms.length} more atom${requiredAtoms - atoms.length === 1 ? '' : 's'} in the viewer.`,
    };
  }

  const value = measurement.kind === 'distance'
    ? distance(atoms[0].position, atoms[1].position)
    : angleDegrees(atoms[0].position, atoms[1].position, atoms[2].position);

  if (!Number.isFinite(value)) {
    return {
      kind: measurement.kind,
      status: 'unavailable',
      atoms,
      requiredAtoms,
      value: null,
      unit: measurement.kind === 'angle' ? 'degrees' : distanceIsAngstrom ? 'angstrom' : 'source-units',
      unitLabel: measurement.kind === 'angle' ? '°' : distanceIsAngstrom ? 'Å' : 'source units',
      identityLabel,
      coordinateProvenance,
      periodicTreatment: 'displayed-cartesian-no-minimum-image',
      message: measurement.kind === 'angle'
        ? 'The angle is undefined because one selected segment has zero length.'
        : 'The selected coordinates do not produce a finite distance.',
    };
  }

  return {
    kind: measurement.kind,
    status: 'ready',
    atoms,
    requiredAtoms,
    value,
    unit: measurement.kind === 'angle' ? 'degrees' : distanceIsAngstrom ? 'angstrom' : 'source-units',
    unitLabel: measurement.kind === 'angle' ? '°' : distanceIsAngstrom ? 'Å' : 'source units',
    identityLabel,
    coordinateProvenance,
    periodicTreatment: 'displayed-cartesian-no-minimum-image',
    message: measurement.kind === 'angle'
      ? 'Angle A-B-C from the displayed Cartesian coordinates.'
      : 'Straight-line distance from the displayed Cartesian coordinates.',
  };
}

export function measurementValueLabel(resolved: ResolvedMolecularMeasurement): string {
  if (resolved.value === null) return '—';
  if (resolved.kind === 'angle') return `${resolved.value.toFixed(2)}°`;
  return `${formatDistance(resolved.value)} ${resolved.unitLabel}`;
}

function measurementIdentityLabel(measurement: MolecularMeasurement): string {
  if (measurement.atoms.every((atom) => atom.identity === 'source-id')) {
    return 'Tracked by source atom ID across frames.';
  }
  if (measurement.atoms.every((atom) => atom.identity === 'source-order')) {
    return 'Tracked by source-guaranteed atom order across frames.';
  }
  return `Tracked only by row in capture frame ${measurement.capturedFrame + 1}; cross-frame identity is unavailable.`;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function angleDegrees(a: readonly number[], vertex: readonly number[], c: readonly number[]): number {
  const ax = a[0] - vertex[0];
  const ay = a[1] - vertex[1];
  const az = a[2] - vertex[2];
  const cx = c[0] - vertex[0];
  const cy = c[1] - vertex[1];
  const cz = c[2] - vertex[2];
  const aLength = Math.hypot(ax, ay, az);
  const cLength = Math.hypot(cx, cy, cz);
  if (aLength === 0 || cLength === 0) return Number.NaN;
  const cosine = Math.max(-1, Math.min(1, (ax * cx + ay * cy + az * cz) / (aLength * cLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function formatDistance(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 100_000)) return value.toExponential(3);
  return value.toFixed(magnitude < 10 ? 3 : 2);
}

function isBoundedIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000;
}

function isInt32(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= -2_147_483_648 && (value as number) <= 2_147_483_647;
}
