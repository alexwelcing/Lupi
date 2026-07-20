import type { Frame } from '@atlas/core';
import { describe, expect, it } from 'vitest';
import {
  captureMeasurement,
  measurementForInlineSnapshot,
  measurementValueLabel,
  resolveMeasurementAtomIndices,
  resolveMolecularMeasurement,
  sanitizeMolecularMeasurement,
} from './measurements';

type Position = readonly [number, number, number];

function makeFrame({
  ids = [10, 20, 30],
  positions = [[0, 0, 0], [3, 4, 0], [0, 1, 0]],
  identity = { kind: 'source-id', unique: true },
  distanceSemantics = { kind: 'angstrom', provenance: 'source-declared' },
}: {
  ids?: readonly number[];
  positions?: readonly Position[];
  identity?: Frame['identity'];
  distanceSemantics?: Frame['distanceSemantics'];
} = {}): Frame {
  return {
    timestep: 100,
    natoms: ids.length,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array(ids),
    identity,
    types: new Int32Array(ids.map(() => 6)),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics,
    positions: new Float32Array(positions.flat()),
    bonds: new Int32Array(),
    properties: new Map(),
  };
}

describe('molecular measurements', () => {
  it('reports a distance in angstroms only when the frame declares angstrom semantics', () => {
    const frame = makeFrame();
    const measurement = captureMeasurement(frame, 0, 'distance', [0, 1]);
    const resolved = resolveMolecularMeasurement(frame, 0, measurement);

    expect(measurement.atoms).toEqual([
      { identity: 'source-id', id: 10, capturedIndex: 0 },
      { identity: 'source-id', id: 20, capturedIndex: 1 },
    ]);
    expect(resolved).toMatchObject({
      status: 'ready',
      value: 5,
      unit: 'angstrom',
      unitLabel: 'Å',
      periodicTreatment: 'displayed-cartesian-no-minimum-image',
      message: 'Straight-line distance from the displayed Cartesian coordinates.',
    });
    expect(resolved?.coordinateProvenance).toContain('declared in angstroms');
    expect(resolved?.coordinateProvenance).toContain('source-declared');
    expect(measurementValueLabel(resolved!)).toBe('5.000 Å');
  });

  it('keeps an unknown coordinate scale in source units without implying angstroms', () => {
    const frame = makeFrame({
      distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' },
    });
    const measurement = captureMeasurement(frame, 0, 'distance', [0, 1]);
    const resolved = resolveMolecularMeasurement(frame, 0, measurement);

    expect(resolved).toMatchObject({
      status: 'ready',
      value: 5,
      unit: 'source-units',
      unitLabel: 'source units',
      periodicTreatment: 'displayed-cartesian-no-minimum-image',
    });
    expect(resolved?.coordinateProvenance).toContain('units are unknown');
    expect(resolved?.coordinateProvenance).toContain('lammps-dump');
    expect(resolved?.coordinateProvenance).toContain('no physical unit conversion');
    expect(measurementValueLabel(resolved!)).toBe('5.000 source units');
    expect(measurementValueLabel(resolved!)).not.toContain('Å');
  });

  it('computes angle A-B-C with B as the vertex', () => {
    const frame = makeFrame({
      positions: [[1, 0, 0], [0, 0, 0], [0, 1, 0]],
    });
    const measurement = captureMeasurement(frame, 2, 'angle', [0, 1, 2]);
    const resolved = resolveMolecularMeasurement(frame, 2, measurement);

    expect(resolved).toMatchObject({
      status: 'ready',
      value: 90,
      unit: 'degrees',
      unitLabel: '°',
      message: 'Angle A-B-C from the displayed Cartesian coordinates.',
    });
    expect(measurementValueLabel(resolved!)).toBe('90.00°');
  });

  it('resolves source atom IDs after trajectory rows are reordered', () => {
    const capturedFrame = makeFrame({
      ids: [101, 202],
      positions: [[0, 0, 0], [2, 0, 0]],
    });
    const reorderedFrame = makeFrame({
      ids: [202, 101],
      positions: [[0, 3, 0], [0, 0, 0]],
    });
    const measurement = captureMeasurement(capturedFrame, 0, 'distance', [0, 1]);

    expect(resolveMeasurementAtomIndices(reorderedFrame, 1, measurement)).toEqual([1, 0]);

    const resolved = resolveMolecularMeasurement(reorderedFrame, 1, measurement);
    expect(resolved?.status).toBe('ready');
    expect(resolved?.atoms.map((atom) => atom.id)).toEqual([101, 202]);
    expect(resolved?.value).toBeCloseTo(3);
    expect(resolved?.identityLabel).toContain('source atom ID across frames');
  });

  it('refuses to carry frame-row identity into a different frame', () => {
    const frame = makeFrame({
      ids: [1, 2],
      positions: [[0, 0, 0], [1, 0, 0]],
      identity: { kind: 'synthetic-row', unique: true },
    });
    const measurement = captureMeasurement(frame, 4, 'distance', [0, 1]);

    expect(measurement.atoms).toEqual([
      { identity: 'frame-row', row: 0, frame: 4 },
      { identity: 'frame-row', row: 1, frame: 4 },
    ]);
    expect(resolveMeasurementAtomIndices(frame, 4, measurement)).toEqual([0, 1]);
    expect(resolveMeasurementAtomIndices(frame, 5, measurement)).toEqual([]);

    const unavailable = resolveMolecularMeasurement(frame, 5, measurement);
    expect(unavailable).toMatchObject({ status: 'unavailable', value: null, atoms: [] });
    expect(unavailable?.message).toMatch(/capture frame|stable source IDs\/order/i);
  });

  it('rebinds a saved inline snapshot to frame-zero rows before reopen', () => {
    const sourceFrame = makeFrame({
      ids: [7, 9],
      positions: [[0, 0, 0], [0, 0, 5]],
    });
    const measurement = captureMeasurement(sourceFrame, 7, 'distance', [0, 1]);
    const snapshotMeasurement = measurementForInlineSnapshot(sourceFrame, 7, measurement);

    expect(snapshotMeasurement).toEqual({
      kind: 'distance',
      capturedFrame: 0,
      atoms: [
        { identity: 'frame-row', row: 0, frame: 0 },
        { identity: 'frame-row', row: 1, frame: 0 },
      ],
    });

    const reopenedFrame = makeFrame({
      ids: [1, 2],
      positions: [[0, 0, 0], [0, 0, 5]],
      identity: { kind: 'synthetic-row', unique: true },
      distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    });
    const reopened = resolveMolecularMeasurement(reopenedFrame, 0, snapshotMeasurement);
    expect(reopened).toMatchObject({ status: 'ready', value: 5, unit: 'angstrom' });
    expect(resolveMeasurementAtomIndices(reopenedFrame, 1, snapshotMeasurement)).toEqual([]);
  });

  it('keeps a partially selected distance explicitly incomplete', () => {
    const frame = makeFrame();
    const measurement = captureMeasurement(frame, 0, 'distance', [0]);
    const resolved = resolveMolecularMeasurement(frame, 0, measurement);

    expect(resolved).toMatchObject({
      status: 'incomplete',
      requiredAtoms: 2,
      value: null,
      message: 'Select 1 more atom in the viewer.',
    });
    expect(resolved?.atoms).toHaveLength(1);
  });

  it('reports a degenerate angle as unavailable instead of emitting a number', () => {
    const frame = makeFrame({
      positions: [[0, 0, 0], [0, 0, 0], [1, 0, 0]],
    });
    const measurement = captureMeasurement(frame, 0, 'angle', [0, 1, 2]);
    const resolved = resolveMolecularMeasurement(frame, 0, measurement);

    expect(resolved).toMatchObject({
      status: 'unavailable',
      value: null,
      message: 'The angle is undefined because one selected segment has zero length.',
    });
    expect(resolved?.atoms).toHaveLength(3);
  });

  it.each([
    ['unknown measurement kind', { kind: 'dihedral', capturedFrame: 0, atoms: [] }],
    ['fractional capture frame', { kind: 'distance', capturedFrame: 0.5, atoms: [] }],
    ['too many atoms for the kind', {
      kind: 'distance',
      capturedFrame: 0,
      atoms: [
        { identity: 'source-order', row: 0 },
        { identity: 'source-order', row: 1 },
        { identity: 'source-order', row: 2 },
      ],
    }],
    ['malformed source ID', {
      kind: 'distance',
      capturedFrame: 0,
      atoms: [{ identity: 'source-id', id: Number.POSITIVE_INFINITY, capturedIndex: 0 }],
    }],
    ['negative source row', {
      kind: 'distance',
      capturedFrame: 0,
      atoms: [{ identity: 'source-order', row: -1 }],
    }],
    ['negative frame-row frame', {
      kind: 'distance',
      capturedFrame: 0,
      atoms: [{ identity: 'frame-row', row: 0, frame: -1 }],
    }],
    ['unrecognized atom identity', {
      kind: 'distance',
      capturedFrame: 0,
      atoms: [{ identity: 'display-index', row: 0 }],
    }],
  ])('rejects unsafe persisted input: %s', (_label, value) => {
    expect(sanitizeMolecularMeasurement(value)).toBeNull();
  });
});
