// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parsePubChemRecord, frameFromPubChemMolecule } from '@atlas/core/pubchem';
import source3d from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-3d.json';
import source2d from '../../mcp-worker/test-fixtures/chatgpt/cid-439378-2d.json';
import { InspectionPanel } from './InspectionPanel';
import type { MoleculeCard } from './toolResult';
function Harness({ record = source3d, changed }: { record?: unknown; changed: (pair: [number, number] | undefined) => void }) {
  const molecule = parsePubChemRecord(record);
  const [pair, setPair] = useState<[number, number] | undefined>();
  const card: MoleculeCard = { molecule, frame: frameFromPubChemMolecule(molecule), structureRef: 'pinned-test', perceivedBonds: null, view: { style: 'ball-and-stick', highlightElements: [], highlightAtomIds: [], ...(pair ? { measureAtomIds: pair } : {}) } };
  return <InspectionPanel card={card} target={{ kind: 'atom', index: 0 }} pinned onPin={() => {}} onMeasure={next => { setPair(next); changed(next); }} />;
}
afterEach(cleanup);
describe('measurement in existing inspector', () => {
  it('selects, replaces and clears an explicit pair without using highlights', () => {
    const changed = vi.fn(); render(<Harness changed={changed} />);
    fireEvent.click(screen.getByText('Measure distance'));
    fireEvent.change(screen.getByLabelText('Measure atom A'), { target: { value: '1' } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Measure atom B'), { target: { value: '2' } });
    expect(changed).toHaveBeenLastCalledWith([1, 2]);
    expect(screen.getByRole('status').textContent).toMatch(/A 1 → B 2: .* Å/);
    fireEvent.change(screen.getByLabelText('Measure atom B'), { target: { value: '3' } });
    expect(changed).toHaveBeenLastCalledWith([1, 3]);
    fireEvent.click(screen.getByText('Clear distance'));
    expect(changed).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText('Measure atom A')).toHaveProperty('value', '');
  });
  it('retains atom information but withholds 2D physical distance', () => {
    render(<Harness record={source2d} changed={() => {}} />);
    fireEvent.click(screen.getByText('Measure distance'));
    fireEvent.change(screen.getByLabelText('Measure atom A'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Measure atom B'), { target: { value: '2' } });
    expect(screen.getByRole('status').textContent).toContain('no physical distance');
    expect(screen.getByText(/Atomic number/)).toBeTruthy();
  });
});
