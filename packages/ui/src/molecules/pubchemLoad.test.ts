import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import {
  fetchPubChemCompound,
  formulaFromTypes,
  frameFromPubChemRecord,
  openPubChemMolecule,
  parseMoleculeParam,
  pubchemAutocomplete,
  pubchemSourceUrl,
} from './pubchemLoad';

const WATER_RECORD = {
  PC_Compounds: [
    {
      id: { id: { cid: 962 } },
      atoms: { aid: [1, 2, 3], element: [8, 1, 1] },
      bonds: { aid1: [1, 1], aid2: [2, 3], order: [1, 1] },
      coords: [{ conformers: [{ x: [0, 0.76, -0.76], y: [0, 0.59, 0.59], z: [0, 0, 0] }] }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    json: async () => body,
  } as unknown as Response;
}

describe('frameFromPubChemRecord', () => {
  it('builds a frame with atomic-number types, padded bounds and source bonds', () => {
    const { frame, cid, is3d } = frameFromPubChemRecord(WATER_RECORD, true);
    expect(cid).toBe(962);
    expect(is3d).toBe(true);
    expect(frame.natoms).toBe(3);
    expect(Array.from(frame.types)).toEqual([8, 1, 1]);
    expect(Array.from(frame.ids)).toEqual([1, 2, 3]);
    expect(frame.positions[3]).toBeCloseTo(0.76, 5);
    expect(Array.from(frame.bonds)).toEqual([0, 1, 0, 2]);
    expect(frame.boxBounds[0]).toBeCloseTo(-0.76 - 2, 5);
    expect(frame.boxBounds[1]).toBeCloseTo(0.76 + 2, 5);
    expect(frame.typeSemantics?.kind).toBe('atomic-number');
    expect(frame.distanceSemantics?.kind).toBe('angstrom');
  });

  it('flattens 2D records onto z = 0 and rejects records without coordinates', () => {
    const flat = {
      PC_Compounds: [{ atoms: { aid: [1], element: [6] }, coords: [{ conformers: [{ x: [1], y: [2] }] }] }],
    };
    const { frame } = frameFromPubChemRecord(flat, false);
    expect(Array.from(frame.positions)).toEqual([1, 2, 0]);
    expect(() => frameFromPubChemRecord({ PC_Compounds: [{ atoms: { element: [6] } }] }, true)).toThrow(/coordinates/);
  });
});

describe('formulaFromTypes / parseMoleculeParam / pubchemSourceUrl', () => {
  it('writes Hill-order formulas', () => {
    expect(formulaFromTypes(Int32Array.from([8, 1, 1]))).toBe('H2O');
    expect(formulaFromTypes(Int32Array.from([6, 6, 1, 1, 1, 1, 1, 1, 8]))).toBe('C2H6O');
  });
  it('parses names and CIDs from the deep-link param', () => {
    expect(parseMoleculeParam('caffeine')).toEqual({ name: 'caffeine' });
    expect(parseMoleculeParam('cid:2519')).toEqual({ cid: 2519 });
    expect(parseMoleculeParam('   ')).toBeNull();
    expect(pubchemSourceUrl({ name: 'Caffeine ' })).toBe('pubchem://name/caffeine');
    expect(pubchemSourceUrl({ cid: 5 })).toBe('pubchem://cid/5');
  });
});

describe('network paths', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useStore.getState().clearFile();
  });

  it('autocompletes names from the dictionary endpoint and caches by prefix', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ dictionary_terms: { compound: ['caffeine', 'caffeic acid'] } }));
    expect(await pubchemAutocomplete('c')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    const first = await pubchemAutocomplete('  Caff-test ', 5);
    expect(first).toEqual(['caffeine', 'caffeic acid']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/rest/autocomplete/compound/caff-test/json?limit=5');
    await pubchemAutocomplete('caff-test', 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back from the 3D conformer to the 2D record on 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse(WATER_RECORD));
    const structure = await fetchPubChemCompound({ name: 'water' });
    expect(structure.is3d).toBe(false);
    expect(structure.frame.natoms).toBe(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('record_type=3d');
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/record\/JSON$/);
  });

  it('loads the compound into the store and reflects it in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(WATER_RECORD));
    window.history.replaceState({}, '', '/?sim=caffeine');
    const result = await openPubChemMolecule({ name: 'water' });
    expect(result).toEqual({ name: 'Water', atomCount: 3, cid: 962 });
    const file = useStore.getState().file;
    expect(file?.name).toBe('Water');
    expect(file?.sourceUrl).toBe('pubchem://name/water');
    expect(file?.trajectory.atomTypes).toEqual([1, 8]);
    const params = new URLSearchParams(window.location.search);
    expect(params.get('molecule')).toBe('water');
    expect(params.has('sim')).toBe(false);
  });

  it('surfaces a readable error for unknown names', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(openPubChemMolecule({ name: 'unobtainium' }, { history: 'none' })).rejects.toThrow(/unobtainium/);
    expect(useStore.getState().error).toMatch(/unobtainium/);
    expect(useStore.getState().file).toBeNull();
  });
});
