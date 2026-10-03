import { describe, expect, it } from 'vitest';
import { parsePubChemRecord } from '@atlas/core/pubchem';
import { moleculeFromOmol25Xyz } from '@atlas/core/omol25/widget';
import source3d from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-3d.json';
import source2d from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-2d.json';
import sourceProperties from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-properties.json';
import { elementAtomIds, readMoleculeToolResult, selectedAtomFrame } from './toolResult';

const sourceIdentity = sourceProperties.PropertyTable.Properties[0];

function result(record: unknown = source3d) {
  const molecule = parsePubChemRecord(record, {
    expectedCid: sourceIdentity.CID,
    name: sourceIdentity.Title,
    formula: sourceIdentity.MolecularFormula,
    retrievedAt: '2026-09-29T19:00:00.000Z',
  });
  const view = { style: 'ball-and-stick', highlightAtomIds: [] as number[], highlightElements: [] as string[] };
  return {
    structuredContent: {
      status: 'shown',
      structureRef: `pubchem:${molecule.cid}:${molecule.dimension}:${'a'.repeat(64)}`,
      cid: molecule.cid,
      name: molecule.name,
      dimension: molecule.dimension,
      view: structuredClone(view),
    },
    _meta: { molecule, view: structuredClone(view) },
  };
}

describe('MCP molecule result boundary', () => {
  it('renders a pinned OMol25 row without inventing source bonds', () => {
    const molecule = moleculeFromOmol25Xyz(
      '3\nOMol25 neutral-train row=7 | bonds=not-provided\nO 0 0 0\nH 0.75 0.5 0\nH -0.75 0.5 0\n',
      'neutral-train',
      { rowIndex: 7, repository: 'colabfit/OMol25_train_neutral', coverage: 'complete', configurationId: 'config-7', propertyId: 'property-7', name: 'Water', formula: 'H2O', atomCount: 3 },
    );
    const view = { style: 'ball-and-stick', highlightAtomIds: [1], highlightElements: ['O'] };
    const payload = {
      structuredContent: {
        status: 'shown', structureRef: `omol25:neutral-train:7:${'a'.repeat(64)}`,
        source: 'OMol25', collection: 'neutral-train', rowIndex: 7,
        repository: molecule.repository, name: molecule.name, atomIdKind: 'synthetic-row', bondSource: 'not-provided',
        view,
      },
      _meta: { molecule, view },
    };
    const card = readMoleculeToolResult(payload);
    expect(card.frame.natoms).toBe(3);
    expect(card.frame.bonds).toHaveLength(0);
    expect(card.view.highlightAtomIds).toEqual([1]);
    expect(elementAtomIds(card.molecule, 8)).toEqual([1]);
    expect(() => readMoleculeToolResult({ ...payload, structuredContent: { ...payload.structuredContent, rowIndex: 8 } })).toThrow(/OMol25 row/);
  });
  it('renders the actual captured L-theanine source frame and preserves connectivity', () => {
    const card = readMoleculeToolResult(result());
    expect(card.molecule.cid).toBe(439378);
    expect(card.frame.natoms).toBe(26);
    expect(card.frame.bonds.length).toBe(50);
    expect(card.molecule.bonds.order.filter((order) => order === 2)).toHaveLength(2);
    expect(elementAtomIds(card.molecule, 7)).toEqual([4, 5]);
    expect(Array.from(card.frame.ids)).toEqual(card.molecule.atoms.ids);
  });

  it('highlights a subset using stable source AIDs and original source positions', () => {
    const payload = result();
    payload._meta.view.highlightAtomIds = [5, 4];
    payload._meta.view.highlightElements = ['N'];
    payload.structuredContent.view.highlightAtomIds = [4, 5];
    payload.structuredContent.view.highlightElements = ['N'];
    const card = readMoleculeToolResult(payload);
    const selected = selectedAtomFrame(card.frame, card.view.highlightAtomIds)!;
    expect(Array.from(selected.ids)).toEqual([4, 5]);
    expect(Array.from(selected.types)).toEqual([7, 7]);
    for (let index = 0; index < selected.natoms; index++) {
      const sourceIndex = card.molecule.atoms.ids.indexOf(selected.ids[index]);
      expect(Array.from(selected.positions.subarray(index * 3, index * 3 + 3)))
        .toEqual(Array.from(card.frame.positions.subarray(sourceIndex * 3, sourceIndex * 3 + 3)));
    }
    expect(card.frame.natoms).toBe(26);
    expect(selected.bonds).toHaveLength(0);
  });

  it.each(['cid', 'name', 'dimension'] as const)('rejects a mismatched %s between model summary and rendered data', (key) => {
    const payload = result();
    const replacements = { cid: 280, name: 'Carbon dioxide', dimension: '2d' };
    Object.assign(payload.structuredContent, { [key]: replacements[key] });
    expect(() => readMoleculeToolResult(payload)).toThrow(/disagree/);
  });

  it('rejects source AIDs absent from the displayed compound', () => {
    const payload = result();
    payload._meta.view.highlightAtomIds = [999999];
    payload.structuredContent.view.highlightAtomIds = [999999];
    expect(() => readMoleculeToolResult(payload)).toThrow(/does not belong/);
  });

  it('rejects a stable reference for a different compound even when summary CID matches', () => {
    const payload = result();
    payload.structuredContent.structureRef = `pubchem:280:3d:${'a'.repeat(64)}`;
    expect(() => readMoleculeToolResult(payload)).toThrow(/stable structure reference/);
  });

  it('rejects inconsistent model-visible and component-only selections', () => {
    const payload = result();
    payload._meta.view.highlightAtomIds = [4, 5];
    expect(() => readMoleculeToolResult(payload)).toThrow(/selection.*disagree/);
  });

  it('rejects element labels whose source atom IDs do not match the selection', () => {
    const payload = result();
    payload._meta.view.highlightElements = ['N'];
    payload.structuredContent.view.highlightElements = ['N'];
    payload._meta.view.highlightAtomIds = [1];
    payload.structuredContent.view.highlightAtomIds = [1];
    expect(() => readMoleculeToolResult(payload)).toThrow(/source atom IDs disagree/);
  });

  it('rejects incorrect molecule facts when included in the model-readable summary', () => {
    const payload = result();
    Object.assign(payload.structuredContent, { formula: 'CO2', atomCount: 3 });
    expect(() => readMoleculeToolResult(payload)).toThrow(/facts disagree/);
  });

  it('labels the actual 2D source as a depiction with no physical distance semantics', () => {
    const card = readMoleculeToolResult(result(source2d));
    expect(card.molecule.dimension).toBe('2d');
    expect(card.molecule.coordinateUnits).toBe('depiction');
    expect(card.frame.distanceSemantics?.kind).toBe('unknown');
  });

  it('fails closed if full source data or stable identity is absent', () => {
    expect(() => readMoleculeToolResult({ structuredContent: result().structuredContent })).toThrow();
    const payload = result();
    payload.structuredContent.structureRef = '';
    expect(() => readMoleculeToolResult(payload)).toThrow(/stable structure reference/);
    expect(() => readMoleculeToolResult({ isError: true })).toThrow(/did not return/);
  });
});
