import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OMOL_SLOW_COPY, OmolMasthead, RemoteBrowser, compactCount } from './Omol25Collection';

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

describe('OMol25 masthead', () => {
  afterEach(cleanup);

  it('keeps the no-bond-topology sentence and says which rows Lupi keeps', () => {
    render(<OmolMasthead />);
    const text = screen.getByRole('banner').textContent ?? '';
    expect(text).toMatch(/OMol25 supplies no bond topology/);
    expect(text).toContain('Lupi pages rows on demand and keeps 24 hand-picked rows, credited, for its shelves.');
    expect(text).toContain('Nearly all OMol25 geometries are snapshots away from a minimum.');
    expect(text).not.toMatch(/copies no rows/);
  });
});

describe('OMol25 remote browser failures', () => {
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

  it('names a slow host in plain words', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/v1/datasets/omol25')
        ? jsonResponse(200, { collections: [] })
        : jsonResponse(504, { status: 'slow', error: 'upstream timed out after 9 s' }),
    );
    render(<RemoteBrowser />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(OMOL_SLOW_COPY));
  });

  it('never shows raw abort text', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/datasets/omol25')) return jsonResponse(200, { collections: [] });
      throw new DOMException('signal is aborted without reason', 'AbortError');
    });
    render(<RemoteBrowser />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('OMol25’s host is slow to answer. Try again in a moment.'));
    expect(screen.getByRole('alert').textContent).not.toMatch(/abort/i);
  });
});
