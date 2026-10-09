import { describe, expect, it } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { frameFromAtoms, sodiumHexaaqua } from '../bonds/bondFixtures.test-utils';
import { listViewerBonds, readBondStatus } from './bondStatus';

function loadSalt() {
  resetStore();
  const frame = frameFromAtoms(sodiumHexaaqua(), 'charge=1 multiplicity=1 charge_source=record data_id=elytes');
  const trajectory = createMockTrajectory(1, frame.natoms);
  trajectory.frames[0] = frame;
  useStore.getState().setFile({ name: 'salt.xyz', size: 1, trajectory, thermo: null });
  useStore.setState({ showBonds: true });
}

describe('MCP bond status', () => {
  it('reports the molecular recipe, kinds (contacts are not bonds), evidence and chemistry', () => {
    loadSalt();
    const status = readBondStatus(useStore.getState());
    expect(status.bondRecipe).toBe('lupi-bonds.molecular.v1');
    expect(status.bondKinds).toEqual({ covalent: 12, coordination: 0, ionicContact: 6 });
    expect(status.bondCount).toBe(12);
    expect(status.bondEvidence).toEqual({ long: 0, removed: 0, nearMiss: 0, clashes: 0 });
    expect(status.bondToleranceAdjusted).toBe(false);
    expect(status.chemistry).toEqual({ totalCharge: 1, spinMultiplicity: 1, source: 'record', domain: 'elytes' });

    useStore.getState().setShowBondContacts(false);
    useStore.getState().setBondTolerance(0.6);
    const filtered = readBondStatus(useStore.getState());
    expect(filtered.bondKinds.ionicContact).toBe(0);
    expect(filtered.bondToleranceAdjusted).toBe(true);
  });

  it('lists the drawn graph as [i, j, kind, length, excess] with the filter it used', () => {
    loadSalt();
    const all = listViewerBonds(useStore.getState());
    expect(all.bonds).toHaveLength(18);
    expect(all.bondsTruncated).toBe(false);
    expect(all.bondsFilter).toEqual({ hiddenTypes: [], contacts: true });
    const contact = all.bonds.find((bond) => bond[0] === 0)!;
    expect(contact[2]).toBe('ionicContact');
    expect(contact[3]).toBeCloseTo(2.4, 3);

    useStore.setState({ hiddenAtomTypes: new Set([1]), showBondContacts: false });
    const filtered = listViewerBonds(useStore.getState());
    expect(filtered.bonds).toHaveLength(0);
    expect(filtered.bondsFilter).toEqual({ hiddenTypes: [1], contacts: false });

    useStore.setState({ hiddenAtomTypes: new Set<number>() });
    const capped = listViewerBonds(useStore.getState(), 5);
    expect(capped.bonds).toHaveLength(5);
    expect(capped.bondsTruncated).toBe(true);
  });

  it('keeps distance frames on the distance recipe with every bond covalent', () => {
    loadSalt();
    useStore.getState().setBondProfile('distance');
    const status = readBondStatus(useStore.getState());
    expect(status.bondRecipe).toBe('lupi-bonds.distance.v1');
    const list = listViewerBonds(useStore.getState());
    expect(list.bonds.every((bond) => bond[2] === 'covalent')).toBe(true);
  });
});
