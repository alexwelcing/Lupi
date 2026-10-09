import { describe, expect, it } from 'vitest';
import { estimateOmol25Bonds, omol25BondSummary, frameFromOmol25Molecule, moleculeFromOmol25Xyz, validateOmol25Molecule } from './widget';

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


describe('released OMol25 bond recipe in the plugin boundary', () => {
  it('estimates separately from source topology without mutating coordinates', () => {
    const molecule = moleculeFromOmol25Xyz(xyz, 'neutral-train', row);
    const before = JSON.stringify(molecule);
    const first = estimateOmol25Bonds(molecule);
    expect(omol25BondSummary(first)).toMatchObject({
      bondSource: 'inferred', sourceBondTopology: 'not-provided',
      bondRecipe: 'lupi-bonds.molecular.v1', bondCount: 2, contactCount: 0,
      bondKinds: { covalent: 2, coordination: 0, ionicContact: 0 }, bondOrders: 'not-estimated',
    });
    expect(estimateOmol25Bonds(molecule)).toEqual(first);
    expect(JSON.stringify(molecule)).toBe(before);
    expect(frameFromOmol25Molecule(molecule).bonds).toHaveLength(0);
  });

  it('preserves declared charge and spin, including zero charge', () => {
    const declared = xyz.replace(' | bonds=', ' | charge=0 | multiplicity=1 | charge_source=split-definition | data_id=test | bonds=');
    const molecule = moleculeFromOmol25Xyz(declared, 'neutral-train', row);
    expect(molecule.chemistry).toEqual({ totalCharge: 0, spinMultiplicity: 1, source: 'split-definition', domain: 'test' });
    expect(frameFromOmol25Molecule(molecule).chemistry).toEqual(molecule.chemistry);
    expect(frameFromOmol25Molecule(molecule).periodic).toBe(false);
  });

  it('does not fill absent charge or spin with a default', () => {
    expect(moleculeFromOmol25Xyz(xyz, 'neutral-train', row).chemistry).toEqual({ totalCharge: null, spinMultiplicity: null, source: 'unavailable', domain: null });
  });

  it.each(['charge=NaN | charge_source=record', 'multiplicity=0 | charge_source=record', 'charge=1 | charge_source=unavailable'])('rejects invalid declared chemistry: %s', (fields) => {
    expect(() => moleculeFromOmol25Xyz(xyz.replace(' | bonds=', ` | ${fields} | bonds=`), 'neutral-train', row)).toThrow(/chemistry/);
  });
});
