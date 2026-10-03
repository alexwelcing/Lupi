import { describe, expect, it, vi } from 'vitest';

vi.mock('../viewer/openMolecule', () => ({ openMolecule: vi.fn(async () => ({ ok: true })) }));
vi.mock('../molecules/pubchemLoad', () => ({
  openPubChemMolecule: vi.fn(async () => undefined),
  pubchemAutocomplete: vi.fn(async (prefix: string) => (prefix === 'caf' ? ['caffeine citrate', 'Caffeine'] : [])),
}));
vi.mock('../molecules/providers/omol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../molecules/providers/omol')>();
  return {
    ...actual,
    omolFacets: vi.fn(async () => ({ total: 3, elementCounts: [{ element: 'C', count: 3 }, { element: 'H', count: 3 }, { element: 'O', count: 1 }], functionalGroupCounts: [], natoms: { min: 5, max: 12, median: 9 } })),
    omolRecords: vi.fn(async () => [
      { id: 'nval-0', formula: 'C2H6O', elements: ['C', 'H', 'O'], natoms: 9, gap: null, src: 'x' },
      { id: 'nval-1', formula: 'C6H6', elements: ['C', 'H'], natoms: 12, gap: null, src: 'x' },
      { id: 'nval-2', formula: 'CH4', elements: ['C', 'H'], natoms: 5, gap: null, src: 'x' },
    ]),
  };
});

import { findSwitchCandidates, galleryCandidates, mergeCandidates, omolCandidates, omolPickCandidates, switchElementCounts } from './switchIndex';
import { LOCAL_MOLECULES } from '../landing/moleculeIndex';

describe('switch candidate index', () => {
  it('lists familiar gallery molecules first with no query and filters by element AND', () => {
    const all = galleryCandidates({ query: '', elements: [] });
    expect(all[0].title).toBe('Buckminsterfullerene'); // QUICK_PICK_IDS lead with C60, the home hero
    const withN = galleryCandidates({ query: '', elements: ['N', 'O'], limit: 50 });
    expect(withN.length).toBeGreaterThan(0);
    expect(withN.every((c) => c.elements.includes('N') && c.elements.includes('O'))).toBe(true);
    expect(withN.some((c) => c.elements.length === 0)).toBe(false);
  });

  it('lets a typed name override the element filter, and never lets OMol25 match a word', async () => {
    const withElements = galleryCandidates({ query: 'water', elements: ['C', 'N'] });
    expect(withElements[0]?.title).toBe('Water');
    expect(galleryCandidates({ query: 'ol', elements: ['N'] }).every((c) => c.elements.includes('N'))).toBe(true);
    expect(await omolCandidates({ query: 'water', elements: ['C', 'N'] })).toEqual([]);
    const merged = await findSwitchCandidates({ query: 'water', elements: ['C', 'N'] });
    expect(merged[0]?.title).toBe('Water');
  });

  it('lists entries by a facet word before Jev answers, and carries evidence and molar mass', () => {
    const metals = galleryCandidates({ query: 'metal', elements: [], limit: 50 }).map((candidate) => candidate.key);
    expect(metals).toEqual(expect.arrayContaining(['gallery:al_polycrystal', 'gallery:sand_w_cascade']));
    expect(metals).not.toContain('gallery:caffeine');
    const [water] = galleryCandidates({ query: 'water', elements: [] });
    expect(water.evidence).toMatchObject({ phase: 'liquid', density: 0.997 });
    expect(water.molarMass).toBeCloseTo(18.02, 1);
  });

  it('matches OMol25 by formula prefix or elements, smallest first', async () => {
    const byElements = await omolCandidates({ query: '', elements: ['C', 'O'] });
    expect(byElements.map((c) => c.title)).toEqual(['C2H6O (OMol25)']);
    const byFormula = await omolCandidates({ query: 'C', elements: [] });
    expect(byFormula.map((c) => c.formula)).toEqual(['CH4', 'C2H6O', 'C6H6']);
    expect(await omolCandidates({ query: 'benzene', elements: [] })).toEqual([]);
  });

  it('offers four of today’s OMol25 picks apart from the gallery, titled and drawn', () => {
    const picks = omolPickCandidates();
    expect(picks).toHaveLength(4);
    expect(new Set(picks.map((c) => c.key)).size).toBe(4);
    for (const pick of picks) {
      expect(pick.source).toBe('omol');
      expect(pick.title).toMatch(/^[A-Z][A-Za-z0-9]* \(OMol25\)$/);
      expect(pick.image).toMatch(/^\/og\/omol25\/omol25_nv_\d+-ink\.svg$/);
    }
    expect(LOCAL_MOLECULES.some((m) => m.title.includes('OMol25'))).toBe(false);
    expect(galleryCandidates({ query: '', elements: [], limit: 200 }).some((c) => c.source === 'omol')).toBe(false);
  });

  it('counts switchable structures per element, gallery first', async () => {
    const counts = await switchElementCounts();
    expect(['C', 'H']).toContain(counts[0].symbol);
    expect(counts.find((c) => c.symbol === 'C')?.omol).toBe(3);
    expect(counts.every((c) => c.gallery + c.omol > 0)).toBe(true);
  });

  it('merges gallery, OMol25, and PubChem without duplicate titles', async () => {
    const merged = await findSwitchCandidates({ query: 'caf', elements: [] });
    const titles = merged.map((c) => c.title.toLowerCase());
    expect(titles[0]).toBe('caffeine');
    expect(titles.filter((t) => t === 'caffeine')).toHaveLength(1);
    expect(merged.some((c) => c.source === 'pubchem' && c.title === 'caffeine citrate')).toBe(true);
    expect(mergeCandidates([[{ key: 'a', title: 'X', elements: [], atoms: 1, source: 'gallery', detail: '', open: async () => undefined }], [{ key: 'b', title: 'x', elements: [], atoms: 1, source: 'omol', detail: '', open: async () => undefined }]], 10)).toHaveLength(1);
  });
});
