import { describe, expect, it } from 'vitest';
import { artifactToLoadedFile, type MdTrajectoryArtifact } from './MlipArtifactLoader';

function artifact(
  frames: MdTrajectoryArtifact['frames'],
  materialId = 'Xe-test',
): MdTrajectoryArtifact {
  return {
    schema: 'lupine.mlip.md_trajectory.v1',
    material_id: materialId,
    mlip_id: 'test-mlip',
    frames,
  };
}

describe('MLIP artifact frame semantics', () => {
  it('preserves full-periodic-table symbols, declared angstroms, and stable source order', () => {
    const loaded = artifactToLoadedFile(artifact([
      {
        step: 0,
        positions_angstrom: [[0, 0, 0], [1, 0, 0]],
        symbols: ['Xe', 'Og'],
      },
      {
        step: 1,
        positions_angstrom: [[0.1, 0, 0], [1.1, 0, 0]],
        symbols: ['Xe', 'Og'],
      },
    ]), 'memory://mlip');

    expect(Array.from(loaded.trajectory.frames[0]!.types)).toEqual([54, 118]);
    expect(loaded.trajectory.frames[0]).toMatchObject({
      identity: { kind: 'source-order', unique: true },
      typeSemantics: { kind: 'atomic-number', provenance: 'mlip-symbol' },
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    });
    expect(loaded.trajectory.frames[1]!.identity).toEqual({ kind: 'source-order', unique: true });
    expect(loaded.trajectory.atomTypes).toEqual([54, 118]);
  });

  it('labels single-element material-id recovery as inferred rather than declared', () => {
    const loaded = artifactToLoadedFile(artifact([
      { positions_angstrom: [[0, 0, 0], [1, 0, 0]] },
    ], 'Al-fcc'), 'memory://mlip');

    expect(Array.from(loaded.trajectory.frames[0]!.types)).toEqual([13, 13]);
    expect(loaded.trajectory.frames[0]!.typeSemantics).toEqual({
      kind: 'atomic-number',
      provenance: 'mlip-material-id-inferred',
    });
  });

  it('rejects missing or unsupported chemistry instead of silently inventing hydrogen', () => {
    expect(() => artifactToLoadedFile(artifact([
      { positions_angstrom: [[0, 0, 0]], symbols: ['NotAnElement'] },
    ]), 'memory://mlip')).toThrow(/unsupported element symbol/i);

    expect(() => artifactToLoadedFile(artifact([
      { positions_angstrom: [[0, 0, 0]] },
    ], 'LiFePO4'), 'memory://mlip')).toThrow(/not an unambiguous single element/i);
  });

  it('fails closed on cross-frame row changes', () => {
    const loaded = artifactToLoadedFile(artifact([
      { positions_angstrom: [[0, 0, 0], [1, 0, 0]], symbols: ['C', 'O'] },
      { positions_angstrom: [[1, 0, 0], [0, 0, 0]], symbols: ['O', 'C'] },
    ]), 'memory://mlip');

    expect(loaded.trajectory.frames[0]!.identity).toEqual({ kind: 'synthetic-row', unique: true });
    expect(loaded.trajectory.frames[1]!.identity).toEqual({ kind: 'synthetic-row', unique: true });
  });
});
