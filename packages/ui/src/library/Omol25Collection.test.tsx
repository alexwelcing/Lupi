import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteBrowser, compactCount } from './Omol25Collection';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const row = {
  rowIndex: 0,
  id: 'CO_1',
  configurationId: 'CO_1',
  propertyId: null,
  formula: 'C6H6',
  reducedFormula: 'CH',
  elements: ['C', 'H'],
  atomCount: 12,
  multiplicity: 1,
  method: 'ωB97M-V',
  software: 'ORCA',
  energy: -1,
  maxForceNorm: 0.1,
  name: null,
  loadUrl: '/v1/datasets/omol25/neutral-train/structures/0.xyz',
  coordinateProvenance: 'source',
  bondTopology: 'not-provided',
};

describe('OMol25 remote browser', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    window.history.replaceState({}, '', '/library/omol25');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders source rows with the no-bonds truth line and the coverage label', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/v1/datasets/omol25')
        ? jsonResponse(200, { collections: [] })
        : jsonResponse(200, {
            dataset: 'neutral-train',
            repository: 'colabfit/OMol25_train_neutral',
            coverage: 'complete',
            indexedRows: 34_335_828,
            estimatedRows: 34_335_828,
            offset: 0,
            limit: 24,
            returnedRows: 1,
            matchedRows: 34_335_828,
            partial: false,
            query: null,
            formula: null,
            rows: [row],
          }),
    );
    render(<RemoteBrowser />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open C6H6' })).toBeTruthy());
    expect(screen.getByText(/OMol25 supplies no bonds/)).toBeTruthy();
    expect(screen.getByText(/Complete split/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1–1 of 34,335,828');
  });

  it('shows the warming state honestly instead of an empty grid', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/v1/datasets/omol25')
        ? jsonResponse(200, { collections: [] })
        : jsonResponse(202, { status: 'warming', error: 'Index warming.', retryAfterSeconds: 15 }),
    );
    render(<RemoteBrowser />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/warming.*15 seconds/));
    expect(screen.queryByText('No exact match in this collection')).toBeNull();
  });

  it('formats counts compactly', () => {
    expect(compactCount(34_335_828)).toBe('34.3M');
    expect(compactCount(27_697)).toBe('27.7K');
    expect(compactCount(841_736)).toBe('842K');
  });
});
