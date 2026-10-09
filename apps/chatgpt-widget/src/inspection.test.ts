import { describe, expect, it } from 'vitest';
import { estimateOmol25Bonds, moleculeFromOmol25Xyz, omol25BondSummary } from '@atlas/core/omol25/widget';
import { perceiveBonds, MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { frameFromPubChemMolecule, parsePubChemRecord } from '@atlas/core/pubchem';
import { displayedPairCount, readMoleculeToolResult, type MoleculeCard } from './toolResult';
import { inspectionDetails, inspectionPairs, sameTarget, type InspectionPair } from './inspection';
import { cylinderHit, isInspectionTap, pickMolecule, sphereHit } from './pickMolecule';
import source2d from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-2d.json';

// Deliberately small synthetic geometries, not a live OMol25 retrieval receipt.
function payload(atoms = ['O 0 0 0', 'H 0.75 0.5 0', 'H -0.75 0.5 0']) {
  const molecule = moleculeFromOmol25Xyz(`${atoms.length}\nOMol25 neutral-train row=7 | bonds=not-provided\n${atoms.join('\n')}\n`, 'neutral-train', {
    rowIndex: 7, repository: 'colabfit/OMol25_train_neutral', coverage: 'complete',
    configurationId: 'config7', propertyId: 'prop7', name: 'Test geometry', formula: 'fixture', atomCount: atoms.length,
  });
  const view = { style: 'ball-and-stick' as const, highlightAtomIds: [], highlightElements: [] };
  return {
    structuredContent: {
      status: 'shown', structureRef: `omol25:neutral-train:7:${'a'.repeat(64)}`,
      source: 'OMol25', collection: molecule.collection, rowIndex: 7, repository: molecule.repository,
      name: molecule.name, atomIdKind: molecule.atomIdKind, chemistry: molecule.chemistry,
      ...omol25BondSummary(estimateOmol25Bonds(molecule)), view,
    },
    _meta: { molecule, view },
  };
}

const sourcePair: InspectionPair = { index: 0, a: 0, b: 1, kind: 'source', distance: 2, order: 1, excess: null };
const down = [0, 0, -1] as const;

describe('one inferred graph for source, rendering, and inspection', () => {
  it('matches the released viewer recipe exactly and leaves source bonds empty', () => {
    const p = payload();
    const card = readMoleculeToolResult(p);
    expect(card.perceivedBonds).toEqual(perceiveBonds({ atomicNumbers: card.frame.types, positions: card.frame.positions, natoms: card.frame.natoms, recipe: MOLECULAR_RECIPE_ID }));
    expect(card.frame.bonds).toHaveLength(0);
    expect(card.molecule.bonds.aid1).toHaveLength(0);
    expect(displayedPairCount(card)).toBe(2);
    expect(inspectionPairs(card).map((pair) => pair.order)).toEqual([null, null]);
  });

  it('keeps ionic contacts separate from covalent bonds and honors the toggle', () => {
    const card = readMoleculeToolResult(payload(['Na 0 0 0', 'O 2.3 0 0']));
    expect(card.perceivedBonds?.counts).toMatchObject({ covalent: 0, coordination: 0, ionicContact: 1 });
    expect(omol25BondSummary(card.perceivedBonds!).bondCount).toBe(0);
    expect(displayedPairCount(card)).toBe(1);
    expect(inspectionDetails(card, { kind: 'bond', index: 0 })).toMatchObject({ label: 'Estimated ionic contact', atomIds: [1, 2], sourceOrder: null });
    const hidden = { ...card, view: { ...card.view, showContacts: false } };
    expect(displayedPairCount(hidden)).toBe(0);
    expect(inspectionPairs(hidden)).toHaveLength(0);
    expect(inspectionDetails(hidden, { kind: 'bond', index: 0 })).toBeNull();
    expect(card.perceivedBonds?.counts.ionicContact).toBe(1);
  });

  it('represents transition-metal coordination separately', () => {
    const card = readMoleculeToolResult(payload(['Fe 0 0 0', 'N 2.0 0 0']));
    expect(inspectionPairs(card)[0].kind).toBe('coordination');
    expect(inspectionDetails(card, { kind: 'bond', index: 0 })).toMatchObject({ label: 'Estimated coordination', sourceOrder: null });
  });

  it.each(['bondCount', 'contactCount', 'bondRecipe', 'bondKinds', 'bondEvidence', 'bondParameters', 'bondOrders'])('rejects a mismatched model summary %s', (field) => {
    const p = payload();
    Object.assign(p.structuredContent, { [field]: 'tampered' });
    expect(() => readMoleculeToolResult(p)).toThrow(/estimate.*disagree/);
  });

  it('rejects chemical metadata that differs between the model and component', () => {
    const p = payload();
    Object.assign(p.structuredContent, { chemistry: { totalCharge: 99 } });
    expect(() => readMoleculeToolResult(p)).toThrow(/chemistry/);
  });

  it('reports source row IDs, unchanged coordinates and typed neighbors', () => {
    const card = readMoleculeToolResult(payload());
    expect(inspectionDetails(card, { kind: 'atom', index: 0 })).toMatchObject({ atomId: 1, atomIdKind: 'synthetic-row', atomicNumber: 8, coordinates: [0, 0, 0], neighbors: [
      { atomId: 2, kind: 'covalent', sourceOrder: null }, { atomId: 3, kind: 'covalent', sourceOrder: null },
    ] });
    expect(inspectionDetails(card, { kind: 'atom', index: 999 })).toBeNull();
    expect(inspectionDetails(card, { kind: 'atom', index: -1 })).toBeNull();
    expect(inspectionDetails(card, null)).toBeNull();
  });

  it('does not reinterpret a PubChem 2D depiction as a length measurement', () => {
    const molecule = parsePubChemRecord(source2d);
    const card: MoleculeCard = { molecule, frame: frameFromPubChemMolecule(molecule), structureRef: 'fixture', perceivedBonds: null, view: { style: 'ball-and-stick', highlightAtomIds: [], highlightElements: [] } };
    expect(inspectionDetails(card, { kind: 'bond', index: 0 })).toMatchObject({ label: 'Source bond', sourceOrder: 2, distance: null, lengthUnit: 'depiction' });
    expect(inspectionDetails(card, { kind: 'atom', index: 0 })).toMatchObject({ atomIdKind: 'source-id', coordinateUnits: 'depiction' });
  });

  it('changes the drawn count, not topology, in space-fill mode', () => {
    const card = readMoleculeToolResult(payload());
    expect(displayedPairCount({ ...card, view: { ...card.view, style: 'spacefill' } })).toBe(0);
    expect(card.perceivedBonds?.count).toBe(2);
  });
});

describe('sphere and bond surface picking', () => {
  it('uses the nearest visible atom surface, not nearest center', () => {
    expect(pickMolecule({ origin: [0, 0, 5], direction: down, positions: [0, 0, 0, 0, 0, 1], radii: [2, 0.1], pairs: [], showBonds: true })).toEqual({ kind: 'atom', index: 0 });
    expect(sphereHit([5, 0, 5], down, [0, 0, 0], 1)).toBe(Infinity);
    expect(sphereHit([0, 0, 0], down, [0, 0, 0], 1)).toBe(1);
  });

  it('picks a bond shaft but not empty space or a space-fill hidden bond', () => {
    const base = { origin: [0, 0, 5] as const, direction: down, positions: [-1, 0, 0, 1, 0, 0], radii: [0.2, 0.2], pairs: [sourcePair], showBonds: true };
    expect(pickMolecule(base)).toEqual({ kind: 'bond', index: 0 });
    expect(pickMolecule({ ...base, showBonds: false })).toBeNull();
    expect(pickMolecule({ ...base, origin: [0, 1, 5] })).toBeNull();
    expect(cylinderHit([0, 0, 5], down, [0, 0, 0], [0, 0, 0], 0.1)).toBeNull();
  });

  it('honors dashed gaps measured from the nearer endpoint, like the shader', () => {
    const base = { direction: down, positions: [0, 0, 0, 2, 0, 0], radii: [0.01, 0.01], pairs: [{ ...sourcePair, kind: 'coordination' as const }], showBonds: true };
    expect(pickMolecule({ ...base, origin: [0.25, 0, 5] })).toBeNull();
    expect(pickMolecule({ ...base, origin: [1.75, 0, 5] })).toBeNull();
    expect(pickMolecule({ ...base, origin: [0.35, 0, 5] })).toEqual({ kind: 'bond', index: 0 });
    expect(pickMolecule({ ...base, origin: [1.65, 0, 5] })).toEqual({ kind: 'bond', index: 0 });
  });

  it('accepts a tap, not a drag, pinch or cancelled pointer', () => {
    expect(isInspectionTap(3, 1, false)).toBe(true);
    expect(isInspectionTap(15, 1, false)).toBe(false);
    expect(isInspectionTap(0, 2, false)).toBe(false);
    expect(isInspectionTap(0, 1, true)).toBe(false);
    expect(sameTarget({ kind: 'atom', index: 1 }, { kind: 'atom', index: 1 })).toBe(true);
    expect(sameTarget({ kind: 'atom', index: 1 }, { kind: 'bond', index: 1 })).toBe(false);
  });
});
