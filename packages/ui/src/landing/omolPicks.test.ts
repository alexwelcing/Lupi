import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { openMolecule } = vi.hoisted(() => ({
  openMolecule: vi.fn(async () => ({ ok: true as const, fileName: 'x', atomCount: 1 })),
}));
vi.mock('../viewer/openMolecule', () => ({ openMolecule }));

import { OPEN_ENTRY_STORAGE_KEY } from '../analytics/openEntry';
import { OmolShelf } from './OmolShelf';
import { OMOL_PICKS, type OmolPick } from './omolShelf.data';
import {
  OMOL_FINDER_LIMIT,
  findOmolPicks,
  isFormulaShapedForOmol,
  matchOmolPicks,
  omolFormulaHandoffHref,
  omolIndexFormula,
  omolPickMark,
  omolShelfForDay,
} from './omolPicks';

const HOME = OMOL_PICKS.filter((pick) => pick.home);

describe('isFormulaShapedForOmol', () => {
  it('accepts formulas of OMol25 neutral-lane elements with a digit or mixed case', () => {
    for (const q of ['CO2', 'C6H6', 'NaCl', ' C15H17IO2S ']) expect(isFormulaShapedForOmol(q), q).toBe(true);
  });
  it('rejects words, acronyms and elements outside the neutral lane', () => {
    for (const q of ['HI', 'DNA', 'caffeine', 'Xx2', 'C', 'Fe2O3', 'C6 H6', '']) expect(isFormulaShapedForOmol(q), q).toBe(false);
  });
});

describe('omolShelfForDay', () => {
  it('is deterministic and gives six distinct home picks', () => {
    const a = omolShelfForDay(OMOL_PICKS, 12);
    expect(a).toEqual(omolShelfForDay(OMOL_PICKS, 12));
    expect(a).toHaveLength(6);
    expect(new Set(a.map((pick) => pick.id)).size).toBe(6);
    expect(a.every((pick) => pick.home)).toBe(true);
  });
  it('follows home[(day·6 + i) mod N], before the epoch too', () => {
    const n = HOME.length;
    for (const day of [-3, 0, 1, 7, 400]) {
      const expected = Array.from({ length: 6 }, (_, i) => HOME[(((day * 6 + i) % n) + n) % n].id);
      expect(omolShelfForDay(OMOL_PICKS, day).map((pick) => pick.id)).toEqual(expected);
    }
  });
  it('cycles through every home pick', () => {
    const seen = new Set<string>();
    for (let day = 0; day < HOME.length; day += 1) for (const pick of omolShelfForDay(OMOL_PICKS, day)) seen.add(pick.id);
    expect(seen.size).toBe(HOME.length);
  });
  it('gives the first of the day’s six when asked for fewer', () => {
    expect(omolShelfForDay(OMOL_PICKS, 5, 4)).toEqual(omolShelfForDay(OMOL_PICKS, 5).slice(0, 4));
  });
  it('never repeats a pick when there are fewer home picks than tiles', () => {
    const few: OmolPick[] = HOME.slice(0, 3);
    expect(omolShelfForDay(few, 2)).toHaveLength(3);
    expect(omolShelfForDay([], 2)).toEqual([]);
  });
});

describe('matchOmolPicks', () => {
  it('returns at most three picks, the exact formula first', () => {
    const conformer = OMOL_PICKS.find((pick) => pick.formula === 'C15H17IO2S')!;
    const hits = matchOmolPicks('C15H17IO2S');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(OMOL_FINDER_LIMIT);
    expect(hits[0].formula).toBe(conformer.formula);
    expect(matchOmolPicks('Br').length).toBe(OMOL_FINDER_LIMIT);
    expect(matchOmolPicks('Br').every((pick) => pick.elements.includes('Br'))).toBe(true);
  });
  it('honours written counts and ignores words', () => {
    expect(matchOmolPicks('Br2').every((pick) => /Br2(?![0-9])/.test(pick.formula))).toBe(true);
    expect(matchOmolPicks('caffeine')).toEqual([]);
    expect(matchOmolPicks('C')).toEqual([]);
    expect(matchOmolPicks('Fe')).toEqual([]);
  });
  it('lists picks for the dataset name', () => {
    expect(matchOmolPicks('omol25').length).toBe(OMOL_FINDER_LIMIT);
  });
  it('reads a missing subscript as one, so a small formula never names an unrelated pick', () => {
    for (const q of ['CO2', 'CH4', 'NaOH', 'LiOH', 'HCl', 'HNO3', 'CH4O']) {
      expect(findOmolPicks(q).named, q).toEqual([]);
    }
    expect(findOmolPicks('CH4').containing.every((pick) => /^CH4(?![0-9])/.test(pick.formula))).toBe(true);
  });
  it('names a pick by its formula in any element order', () => {
    expect(findOmolPicks('C4H4OF6').named.map((pick) => pick.formula)).toEqual(['C4H4F6O']);
    expect(findOmolPicks('C4H4F6O').containing).toEqual([]);
  });
  it('keeps picks that merely contain the formula apart from the named ones', () => {
    const { named, containing } = findOmolPicks('C15H17');
    expect(named).toEqual([]);
    expect(containing.length).toBeGreaterThan(0);
    expect(containing.every((pick) => /^C15H17(?![0-9])/.test(pick.formula))).toBe(true);
  });
});

describe('omolIndexFormula', () => {
  it('writes a formula as the OMol25 index does: C, then H, then alphabetical', () => {
    expect(omolIndexFormula('LiOH')).toBe('HLiO');
    expect(omolIndexFormula('C2H5OH')).toBe('C2H6O');
    expect(omolIndexFormula('CH3COOH')).toBe('C2H4O2');
    expect(omolIndexFormula('NaCl')).toBe('ClNa');
    expect(omolIndexFormula('BH3')).toBe('H3B');
    expect(omolIndexFormula(' C15H17IO2S ')).toBe('C15H17IO2S');
    expect(omolIndexFormula('caffeine')).toBeNull();
  });
});

describe('pick helpers', () => {
  it('marks a pick with its heaviest element and hands formulas to the facet view', () => {
    expect(omolPickMark({ ...OMOL_PICKS[0], elements: ['C', 'H', 'F', 'N', 'O'] })).toBe('F');
    expect(omolPickMark({ ...OMOL_PICKS[0], elements: ['C', 'H', 'I', 'O', 'S'] })).toBe('I');
    expect(omolFormulaHandoffHref(' C6H6 ')).toBe('/library/omol25?view=facets&q=C6H6');
    expect(omolFormulaHandoffHref('C2H5OH')).toBe('/library/omol25?view=facets&q=C2H6O');
  });
});

describe('OmolShelf', () => {
  const connection = Object.getOwnPropertyDescriptor(navigator, 'connection');
  beforeEach(() => {
    openMolecule.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    if (connection) Object.defineProperty(navigator, 'connection', connection);
    else delete (navigator as { connection?: unknown }).connection;
  });

  it('renders six linked ink tiles, the actions and the bond truth, with no canvas', () => {
    const { container } = render(createElement(OmolShelf));
    expect(screen.getByRole('heading', { name: 'From Open Molecules 2025' })).toBeTruthy();
    const tiles = container.querySelectorAll('a.omol-tile');
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) {
      expect(tile.getAttribute('href')).toMatch(/^\/\?load=\/datasets\/omol25\/featured\/omol25_nv_\d+\.xyz$/);
      expect(tile.textContent).toMatch(/\(OMol25\)/);
      expect(tile.querySelector('img.ink-tile')?.getAttribute('src')).toMatch(/^\/og\/omol25\/omol25_nv_\d+-ink\.svg$/);
    }
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.student-card')).toBeNull();
    expect(screen.getByRole('link', { name: /Browse OMol25/ }).getAttribute('href')).toBe('/library/omol25');
    expect(screen.getByRole('link', { name: /Surprise me.*one of 34,335,828/ }).getAttribute('href')).toBe('/library/random');
    expect(screen.getByRole('link', { name: /Filter by element/ }).getAttribute('href')).toBe('/library/omol25?view=facets');
    expect(screen.getByText(/OMol25 supplies no bonds/)).toBeTruthy();
  });

  it('shows text marks under Save-Data and when a drawing fails to load', () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    const saving = render(createElement(OmolShelf));
    expect(saving.container.querySelectorAll('img')).toHaveLength(0);
    expect(saving.container.querySelectorAll('.omol-tile__mark')).toHaveLength(6);
    cleanup();
    delete (navigator as { connection?: unknown }).connection;
    if (connection) Object.defineProperty(navigator, 'connection', connection);

    const { container } = render(createElement(OmolShelf));
    fireEvent.error(container.querySelector('img.ink-tile')!);
    expect(container.querySelectorAll('img.ink-tile')).toHaveLength(5);
    expect(container.querySelectorAll('.omol-tile__mark')).toHaveLength(1);
  });

  it('opens a tile in place through the code-split loader, tagged home-shelf', async () => {
    const { container } = render(createElement(OmolShelf));
    const tile = container.querySelector<HTMLAnchorElement>('a.omol-tile')!;
    fireEvent.click(tile);
    await waitFor(() => expect(openMolecule).toHaveBeenCalledTimes(1));
    const file = tile.getAttribute('href')!.replace('/?load=', '');
    expect(openMolecule.mock.calls[0][0]).toEqual({ kind: 'url', url: file, title: expect.stringMatching(/ \(OMol25\)$/), history: 'push' });
    expect(JSON.parse(sessionStorage.getItem(OPEN_ENTRY_STORAGE_KEY)!).entry).toBe('home-shelf');
  });
});
