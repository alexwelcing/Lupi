import { describe, expect, it } from 'vitest';
import { frameFromOmol25Molecule, moleculeFromOmol25Xyz, validateOmol25Molecule } from './omol25';

const row = {
  rowIndex: 7,
  repository: 'colabfit/OMol25_train_neutral',
  coverage: 'complete' as const,
  configurationId: 'config-7',
  propertyId: 'property-7',
  name: 'Water',
  formula: 'H2O',
  atomCount: 3,
};
const xyz = '3\nOMol25 neutral-train row=7 | bonds=not-provided\nO 0 0 0\nH 0.75 0.5 0\nH -0.75 0.5 0\n';

describe('OMol25 embedded molecule boundary', () => {
  it('preserves source coordinates, row identity, and absent bond topology', () => {
    const molecule = moleculeFromOmol25Xyz(xyz, 'neutral-train', row);
    expect(molecule).toMatchObject({ source: 'OMol25', collection: 'neutral-train', rowIndex: 7, atomIdKind: 'synthetic-row', bondTopology: 'not-provided' });
    expect(molecule.atoms.ids).toEqual([1, 2, 3]);
    expect(molecule.atoms.elements).toEqual([8, 1, 1]);
    expect(molecule.atoms.positions).toEqual([0, 0, 0, 0.75, 0.5, 0, -0.75, 0.5, 0]);
    const frame = frameFromOmol25Molecule(molecule);
    expect(frame.bonds).toHaveLength(0);
    expect(frame.identity?.kind).toBe('synthetic-row');
    expect(Array.from(frame.positions)).toEqual(molecule.atoms.positions);
  });

  it('rejects a mismatched row or invented source bonds', () => {
    expect(() => moleculeFromOmol25Xyz(xyz.replace('row=7', 'row=8'), 'neutral-train', row)).toThrow(/provenance/);
    const molecule = moleculeFromOmol25Xyz(xyz, 'neutral-train', row);
    expect(() => validateOmol25Molecule({ ...molecule, bonds: { aid1: [1], aid2: [2], order: [1] } })).toThrow(/Invalid OMol25/);
  });
});
