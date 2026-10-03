import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { openMolecule, openPubChemMolecule } = vi.hoisted(() => ({
  openMolecule: vi.fn(async () => ({ ok: true as const })),
  openPubChemMolecule: vi.fn(async () => ({ name: 'x', atomCount: 1, cid: 1 })),
}));
vi.mock('../viewer/openMolecule', () => ({ openMolecule }));
vi.mock('../molecules/pubchemLoad', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../molecules/pubchemLoad')>();
  return { ...actual, openPubChemMolecule };
});

import { MoleculeFinder, mergeFinderResults } from './MoleculeFinder';
import { MoleculeWall } from './MoleculeWall';
import { LOCAL_MOLECULES, searchLocalMolecules } from './moleculeIndex';

describe('MoleculeFinder', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    openMolecule.mockClear();
    openPubChemMolecule.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dictionary_terms: { compound: ['caffeine citrate', 'caffeic acid'] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows local matches on the first keystrokes and PubChem names after', async () => {
    render(<MoleculeFinder />);
    const input = screen.getByRole('combobox', { name: 'Type a molecule' });
    fireEvent.change(input, { target: { value: 'caf' } });
    expect(screen.getByRole('option', { name: /Caffeine/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('option', { name: /caffeic acid/ })).toBeTruthy());
    // The ink tiles also fetch the matches' drawings; PubChem is one of the calls.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringContaining('/rest/autocomplete/compound/caf/json'),
    );
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Caffeine');
    expect(options[options.length - 1].textContent).toContain('Look up on PubChem');
  });

  it('opens the top local result on Enter through the code-split gallery loader', async () => {
    render(<MoleculeFinder />);
    const input = screen.getByRole('combobox', { name: 'Type a molecule' });
    fireEvent.change(input, { target: { value: 'wat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(openMolecule).toHaveBeenCalledTimes(1));
    expect(openMolecule.mock.calls[0][0]).toEqual({ kind: 'gallery', id: 'water', history: 'push' });
    expect(openPubChemMolecule).not.toHaveBeenCalled();
  });

  it('sends names with no local match straight to PubChem', async () => {
    render(<MoleculeFinder />);
    const input = screen.getByRole('combobox', { name: 'Type a molecule' });
    fireEvent.change(input, { target: { value: 'ibuprofen' } });
    expect(searchLocalMolecules('ibuprofen')).toEqual([]);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('option', { name: /Look up on PubChem/ })).getByRole('button'));
    });
    expect(openPubChemMolecule).toHaveBeenCalledWith({ name: 'ibuprofen' });
    expect(openMolecule).not.toHaveBeenCalled();
  });

  it('merges local and remote hits without duplicates', () => {
    const local = searchLocalMolecules('caff', 3);
    const merged = mergeFinderResults('caff', local, ['Caffeine', 'caffeine citrate']);
    expect(merged.filter((r) => r.title.toLowerCase() === 'caffeine')).toHaveLength(1);
    expect(merged.map((r) => r.kind)).toEqual(['local', 'pubchem', 'pubchem']);
  });

  it('places up to three OMol25 picks after the gallery and before PubChem', () => {
    const local = searchLocalMolecules('Br', 6);
    expect(local.length).toBeGreaterThan(0);
    const merged = mergeFinderResults('Br', local, ['Bromine']);
    const kinds = merged.map((r) => r.kind);
    const omol = kinds.flatMap((kind, i) => (kind === 'omol' ? [i] : []));
    expect(omol.length).toBeGreaterThan(0);
    expect(omol.length).toBeLessThanOrEqual(3);
    expect(Math.min(...omol)).toBeGreaterThan(kinds.lastIndexOf('local'));
    expect(Math.max(...omol)).toBeLessThan(kinds.indexOf('pubchem'));
    const first = merged[omol[0]];
    expect(first.title).toMatch(/ \(OMol25\)$/);
    expect(first.detail).toMatch(/^OMol25 · .+ · \d+ atoms$/);
  });

  it('opens an OMol25 pick from its same-origin file and offers the formula handoff', async () => {
    render(<MoleculeFinder />);
    const input = screen.getByRole('combobox', { name: 'Type a molecule' });
    fireEvent.change(input, { target: { value: 'C15H17IO2S' } });
    const handoff = screen.getByRole('link', { name: /Find C15H17IO2S in OMol25’s 27,697-structure index/ });
    expect(handoff.getAttribute('href')).toBe('/library/omol25?view=facets&q=C15H17IO2S');
    const option = screen.getAllByRole('option').find((o) => o.textContent?.includes('C15H17IO2S (OMol25)'))!;
    const row = within(option).getByRole('link');
    expect(row.getAttribute('href')).toMatch(/^\/\?load=\/datasets\/omol25\/featured\/omol25_nv_\d+\.xyz$/);
    fireEvent.click(row);
    await waitFor(() => expect(openMolecule).toHaveBeenCalledTimes(1));
    expect(openMolecule.mock.calls[0][0]).toEqual({
      kind: 'url',
      url: row.getAttribute('href')!.replace('/?load=', ''),
      title: 'C15H17IO2S (OMol25)',
      history: 'push',
    });
  });

  it('links the scope line to OMol25 and offers no OMol25 handoff for a word', () => {
    render(<MoleculeFinder />);
    expect(screen.getByRole('link', { name: '34.3M in OMol25' }).getAttribute('href')).toBe('/library/omol25');
    fireEvent.change(screen.getByRole('combobox', { name: 'Type a molecule' }), { target: { value: 'HI' } });
    expect(screen.queryByRole('link', { name: /in OMol25’s/ })).toBeNull();
  });
});

describe('MoleculeWall', () => {
  afterEach(cleanup);
  it('renders a plain link per molecule and expands to the whole set', () => {
    render(<MoleculeWall />);
    expect(screen.getByRole('link', { name: 'Open Caffeine' }).getAttribute('href')).toBe('/m/caffeine');
    expect(screen.getAllByRole('link').length).toBeLessThan(LOCAL_MOLECULES.length);
    fireEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(screen.getAllByRole('link')).toHaveLength(LOCAL_MOLECULES.length);
  });
});
