import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { openMolecule } = vi.hoisted(() => ({ openMolecule: vi.fn(async () => ({ ok: true as const })) }));
vi.mock('../viewer/openMolecule', () => ({ openMolecule }));
vi.mock('../molecules/pubchemLoad', () => ({ openPubChemMolecule: vi.fn(), pubchemAutocomplete: vi.fn(async () => []) }));
vi.mock('../molecules/providers/omol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../molecules/providers/omol')>();
  return {
    ...actual,
    omolRecords: vi.fn(async () => []),
    omolFacets: vi.fn(async () => ({ total: 0, elementCounts: [], functionalGroupCounts: [], natoms: { min: 0, max: 0, median: 0 } })),
  };
});

import { MoleculeSwitcher } from './MoleculeSwitcher';
import { resetJudgeAvailability } from './judgeSwitch';

describe('MoleculeSwitcher', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    openMolecule.mockClear();
    resetJudgeAvailability();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows familiar molecules immediately and switches on Enter', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ configured: false }), { headers: { 'content-type': 'application/json' } }));
    render(<MoleculeSwitcher />);
    const input = screen.getByRole('combobox', { name: 'Switch molecule' });
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').length).toBeGreaterThan(5));
    fireEvent.change(input, { target: { value: 'benz' } });
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option')[0].textContent).toContain('Benzene'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(openMolecule).toHaveBeenCalledWith({ kind: 'gallery', id: 'benzene', history: 'push' }));
  });

  it('filters by clicked elements and re-orders when Jev returns a confident best guess', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const last = body.candidates[body.candidates.length - 1].key;
      return new Response(JSON.stringify({ configured: true, model: 'jev-1.13.0', best: { key: last, confidence: 0.92 }, fit: {} }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    render(<MoleculeSwitcher />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nitrogen (N)' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Nitrogen (N)' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('containing N'));
    await waitFor(() => expect(screen.getByText('Best guess')).toBeTruthy(), { timeout: 3000 });
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0].textContent).toContain('Best guess');
    expect(screen.getByRole('status').textContent).toContain('best guess by Jev (inferred)');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear elements' }));
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('containing'));
  });
});
