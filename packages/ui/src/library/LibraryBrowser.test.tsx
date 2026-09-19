import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoleculeHit, MoleculeProvider } from '../molecules/types';

const { providers, searchMolecules } = vi.hoisted(() => {
  const hit = (over: Partial<MoleculeHit> & { id: string; title: string; source: MoleculeHit['source'] }): MoleculeHit => ({
    load: { kind: 'url', url: `/${over.id}.xyz` },
    ...over,
  });
  const matches = (h: MoleculeHit, q: { text: string; elements?: string[] }) =>
    (!q.text || h.title.toLowerCase().includes(q.text.toLowerCase())) && (q.elements ?? []).every((e) => h.elements?.includes(e));
  const gallery: MoleculeProvider = {
    id: 'gallery',
    label: 'Gallery',
    isAvailable: () => true,
    async search(q) {
      const all = [hit({ id: 'water', title: 'Water', source: 'gallery', elements: ['H', 'O'] }), hit({ id: 'benzene', title: 'Benzene', source: 'gallery', elements: ['C', 'H'] })];
      return all.filter((h) => matches(h, q));
    },
  };
  const research: MoleculeProvider = {
    id: 'research',
    label: 'Research',
    isAvailable: () => true,
    async search(q) {
      return [hit({ id: 'gst', title: 'Ge-Sb-Te phase-change start', source: 'research', elements: ['Ge', 'Sb', 'Te'] })].filter((h) => matches(h, q));
    },
  };
  const saved: MoleculeProvider = { id: 'saved', label: 'Saved', isAvailable: () => false, async search() { return []; } };
  return { providers: [gallery, research, saved], searchMolecules: vi.fn() };
});

vi.mock('../molecules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../molecules')>();
  searchMolecules.mockImplementation(actual.searchMolecules);
  return { ...actual, MOLECULE_PROVIDERS: providers, searchMolecules };
});

import { LibraryBrowser } from './LibraryBrowser';

describe('LibraryBrowser', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/library');
    searchMolecules.mockClear();
  });
  afterEach(cleanup);

  it('browses every available source with an empty query and names the source on each card', async () => {
    render(<LibraryBrowser />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^3 results from 2 sources$/));
    expect(screen.getByText('Ge-Sb-Te phase-change start')).toBeTruthy();
    const badges = document.querySelectorAll('.library-badge');
    expect([...badges].map((badge) => badge.textContent)).toEqual(['Lupi gallery', 'Lupi gallery', 'Zenodo research']);
  });

  it('narrows by source chip and element chip through the URL', async () => {
    render(<LibraryBrowser />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3 results/));
    fireEvent.click(screen.getByRole('button', { name: 'Zenodo research' }));
    expect(window.location.search).toBe('?source=research');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^1 result from 1 source$/));
    fireEvent.click(screen.getByRole('button', { name: 'All sources' }));
    fireEvent.click(screen.getByRole('button', { name: 'O' }));
    expect(window.location.search).toBe('?elements=O');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^1 result from 2 sources$/));
    expect(screen.getByText('Water')).toBeTruthy();
  });

  it('prefills from ?q= and recovers from no matches', async () => {
    window.history.replaceState({}, '', '/library?q=benzene');
    render(<LibraryBrowser />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('benzene');
    await waitFor(() => expect(screen.getByText('Benzene')).toBeTruthy());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'unobtainium' } });
    await waitFor(() => expect(screen.getByText('No matching structures')).toBeTruthy(), { timeout: 3000 });
    expect(window.location.search).toBe('?q=unobtainium');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3 results/));
    expect(window.location.search).toBe('');
  });
});
