import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_RESEARCH_DATASETS,
  externalResearchLoadPath,
} from '@atlas/core';
import { OMOL_DATASETS, routeScienceData } from './scienceData';

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://lupi.live${path}`, init);
}

function jsonUpstream(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(value), { ...init, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('external science-data routes', () => {
  it('publishes truthful OMol25 coverage without fetching a dataset shard', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await routeScienceData(req('/v1/datasets/omol25'));
    expect(response).not.toBeNull();
    const body = await response!.json() as {
      license: string;
      sourceTruth: { coordinates: string; bondTopology: string };
      browserContract: { maxRowsPerRequest: number; completePublicLane: string };
      collections: Array<{
        id: string;
        indexedRows: number;
        estimatedRows: number;
        coverage: string;
      }>;
    };

    expect(response!.status).toBe(200);
    expect(response!.headers.get('cache-control')).toContain('max-age=3600');
    expect(body.license).toBe('CC-BY-4.0');
    expect(body.sourceTruth).toMatchObject({
      coordinates: expect.stringContaining('source'),
      bondTopology: expect.stringContaining('not provided'),
    });
    expect(body.browserContract).toEqual(expect.objectContaining({
      maxRowsPerRequest: 36,
      completePublicLane: 'neutral-train',
    }));
    expect(body.collections).toHaveLength(OMOL_DATASETS.length);
    expect(body.collections.find((entry) => entry.id === 'neutral-train')).toEqual(expect.objectContaining({
      indexedRows: 34_335_828,
      estimatedRows: 34_335_828,
      coverage: 'complete',
    }));
    expect(body.collections.find((entry) => entry.id === 'all-train-preview')).toEqual(expect.objectContaining({
      indexedRows: 841_736,
      estimatedRows: 65_331_709,
      coverage: 'indexed-preview',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams compact OMol25 pages from the Dataset Viewer', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => jsonUpstream({
      rows: [{
        row_idx: 12,
        row: {
          configuration_id: 'cfg-12',
          property_id: 'prop-12',
          chemical_formula_hill: 'H2O',
          chemical_formula_reduced: 'H2O',
          elements: ['H', 'O'],
          nsites: 3,
          multiplicity: 1,
          method: 'PBE',
          software: 'VASP',
          energy: -76.4,
          max_force_norm: 0.015,
          names: ['water'],
          positions: [[0, 0, 0], [0.7, 0, 0], [-0.2, 0.6, 0]],
          atomic_numbers: '[8,1,1]',
        },
      }],
      num_rows_total: 34_335_828,
      partial: false,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?offset=12&limit=2'));
    const body = await response!.json() as {
      dataset: string;
      offset: number;
      limit: number;
      returnedRows: number;
      rows: Array<Record<string, unknown>>;
      provenance: Record<string, unknown>;
    };

    expect(response!.status).toBe(200);
    expect(response!.headers.get('x-lupi-data-source')).toBe('huggingface-dataset-viewer');
    expect(body).toMatchObject({
      dataset: 'neutral-train',
      offset: 12,
      limit: 2,
      returnedRows: 1,
      provenance: {
        license: 'CC-BY-4.0',
        coordinates: 'source',
        bondTopology: 'not-provided',
      },
    });
    expect(body.rows[0]).toMatchObject({
      rowIndex: 12,
      id: 'cfg-12',
      formula: 'H2O',
      elements: ['H', 'O'],
      atomCount: 3,
      loadUrl: '/v1/datasets/omol25/neutral-train/structures/12.xyz',
      coordinateProvenance: 'source',
      bondTopology: 'not-provided',
    });
    expect(body.rows[0]).not.toHaveProperty('positions');
    expect(body.rows[0]).not.toHaveProperty('atomic_numbers');

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${upstreamUrl.origin}${upstreamUrl.pathname}`).toBe('https://datasets-server.huggingface.co/rows');
    expect(upstreamUrl.searchParams.get('dataset')).toBe('colabfit/OMol25_train_neutral');
    expect(upstreamUrl.searchParams.get('offset')).toBe('12');
    expect(upstreamUrl.searchParams.get('length')).toBe('2');
  });

  it('synthesizes a source-attributed XYZ only for the selected OMol25 row', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => jsonUpstream({
      rows: [{
        row_idx: 7,
        row: {
          atomic_numbers: '[8,1,1]',
          positions: [[0, 0, 0], [0.75, 0, 0], [-0.25, 0.7, 0]],
          chemical_formula_hill: 'H2O',
          configuration_id: 'cfg|7',
          property_id: 'prop-7',
          method: 'DFT\nPBE',
        },
      }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await routeScienceData(req('/v1/datasets/omol25/neutral-train/structures/7.xyz'));
    const xyz = await response!.text();

    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toContain('chemical/x-xyz');
    expect(response!.headers.get('x-lupi-coordinate-provenance')).toBe('source');
    expect(response!.headers.get('x-lupi-bond-topology')).toBe('not-provided');
    expect(Number(response!.headers.get('content-length'))).toBe(new TextEncoder().encode(xyz).byteLength);
    expect(xyz.split('\n').slice(0, 6)).toEqual([
      '3',
      expect.stringContaining('formula=H2O'),
      'O 0 0 0',
      'H 0.75 0 0',
      'H -0.25 0.7 0',
      '',
    ]);
    expect(xyz).toContain('configuration_id=cfg 7');
    expect(xyz).toContain('coordinates=source');
    expect(xyz).toContain('bonds=not-provided');

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstreamUrl.pathname).toBe('/rows');
    expect(upstreamUrl.searchParams.get('offset')).toBe('7');
    expect(upstreamUrl.searchParams.get('length')).toBe('1');
  });

  it('turns Dataset Viewer index warming into a retryable response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonUpstream(
      { error: 'The search index is loading.' },
      { status: 500, headers: { 'x-error-code': 'ResponseNotReady' } },
    )));

    const response = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?query=water'));
    const body = await response!.json() as Record<string, unknown>;

    expect(response!.status).toBe(202);
    expect(response!.headers.get('retry-after')).toBe('15');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ status: 'warming', dataset: 'neutral-train', retryAfterSeconds: 15 });
  });

  it('rejects unsafe or contradictory OMol25 requests before upstream fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const badLimit = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?limit=37'));
    const contradictory = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?query=water&formula=H2O'));
    const badFormula = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?formula=H2O%27%20or%201=1'));
    const unknown = await routeScienceData(req('/v1/datasets/omol25/not-real/rows'));

    expect(badLimit!.status).toBe(400);
    expect(contradictory!.status).toBe(400);
    expect(badFormula!.status).toBe(400);
    expect(unknown!.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes an allowlisted, provenance-rich research manifest', async () => {
    const response = await routeScienceData(req('/v1/datasets/research'));
    const body = await response!.json() as {
      storageModel: string;
      safety: { maximumBytes: number; redirects: string; atomTypes: string };
      datasets: Array<Record<string, unknown>>;
    };

    expect(response!.status).toBe(200);
    expect(body.storageModel).toContain('source payloads remain on Zenodo');
    expect(body.safety).toMatchObject({
      maximumBytes: 16 * 1024 * 1024,
      redirects: 'blocked',
      atomTypes: expect.stringContaining('opaque'),
    });
    expect(body.datasets).toHaveLength(EXTERNAL_RESEARCH_DATASETS.length);
    expect(body.datasets.find((entry) => entry.id === 'gst-phase-change-ace-start')).toEqual(expect.objectContaining({
      atomCount: 504,
      frameCount: 1,
      loadUrl: '/v1/datasets/research/gst-phase-change-ace-start/files/GST_config.data',
      bytes: 65_631,
      provenance: expect.objectContaining({ license: 'CC-BY-4.0' }),
      sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
    }));
  });

  it('proxies only an exact pinned research asset with integrity metadata', async () => {
    const dataset = EXTERNAL_RESEARCH_DATASETS.find((entry) => entry.id === 'gst-phase-change-ace-start')!;
    const upstreamBytes = new Uint8Array(dataset.remote.bytes);
    upstreamBytes.set(new TextEncoder().encode('LAMMPS source bytes'));
    const digestBuffer = await crypto.subtle.digest('SHA-256', upstreamBytes);
    const digest = Array.from(new Uint8Array(digestBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const originalDigest = dataset.remote.checksum.value;
    dataset.remote.checksum.value = digest;
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(upstreamBytes, {
      status: 200,
      headers: {
        'content-length': String(dataset.remote.bytes),
        etag: '"pinned-etag"',
        'last-modified': 'Mon, 20 Jul 2026 12:00:00 GMT',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const response = await routeScienceData(req(externalResearchLoadPath(dataset)));

      expect(response!.status).toBe(200);
      const responseBytes = new Uint8Array(await response!.arrayBuffer());
      expect(responseBytes).toHaveLength(dataset.remote.bytes);
      expect(new TextDecoder().decode(responseBytes.slice(0, 19))).toBe('LAMMPS source bytes');
      expect(response!.headers.get('cache-control')).toContain('immutable');
      expect(response!.headers.get('x-lupi-data-source')).toBe('zenodo-fixed-catalog');
      expect(response!.headers.get('x-lupi-data-license')).toBe('CC-BY-4.0');
      expect(response!.headers.get('x-lupi-content-checksum')).toBe(`sha256:${digest}`);
      expect(response!.headers.get('x-lupi-source-checksum')).toBe(
        `md5:${dataset.remote.checksum.sourceMd5}`,
      );
      expect(response!.headers.get('x-lupi-integrity-verified')).toBe(`sha256:${digest}`);
      expect(response!.headers.get('x-lupi-research-dataset')).toBe(dataset.id);

      const [input, init] = fetchMock.mock.calls[0];
      expect(String(input)).toBe('https://zenodo.org/records/12173540/files/GST_config.data?download=1');
      expect(init).toEqual(expect.objectContaining({ method: 'GET', redirect: 'manual' }));
    } finally {
      dataset.remote.checksum.value = originalDigest;
    }
  });

  it('refuses a same-length research payload whose SHA-256 does not match', async () => {
    const dataset = EXTERNAL_RESEARCH_DATASETS.find((entry) => entry.id === 'gst-phase-change-ace-start')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(dataset.remote.bytes), {
      status: 200,
      headers: { 'content-length': String(dataset.remote.bytes) },
    })));

    const response = await routeScienceData(req(externalResearchLoadPath(dataset)));

    expect(response!.status).toBe(502);
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expect(await response!.json()).toMatchObject({
      error: expect.stringContaining('SHA-256'),
    });
  });

  it('blocks arbitrary research paths, query mutation, invalid ranges, and redirects', async () => {
    const dataset = EXTERNAL_RESEARCH_DATASETS[0];
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { location: 'https://example.test/unverified' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const arbitrary = await routeScienceData(req('/v1/datasets/research/arbitrary/files/file.dump'));
    const mutated = await routeScienceData(req(`${externalResearchLoadPath(dataset)}?download=elsewhere`));
    const badRange = await routeScienceData(req(externalResearchLoadPath(dataset), {
      headers: { range: 'bytes=0-1,4-5' },
    }));
    const redirected = await routeScienceData(req(externalResearchLoadPath(dataset)));

    expect(arbitrary!.status).toBe(404);
    expect(mutated!.status).toBe(400);
    expect(badRange!.status).toBe(416);
    expect(redirected!.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await redirected!.json()).toMatchObject({
      error: expect.stringContaining('unverified redirect'),
    });
  });

  it('preserves HEAD semantics and method boundaries', async () => {
    const head = await routeScienceData(req('/v1/datasets/omol25', { method: 'HEAD' }));
    const post = await routeScienceData(req('/v1/datasets/research', { method: 'POST' }));
    const unrelated = await routeScienceData(req('/v1/other'));

    expect(head!.status).toBe(200);
    expect(await head!.text()).toBe('');
    expect(head!.headers.get('content-type')).toContain('application/json');
    expect(post!.status).toBe(405);
    expect(post!.headers.get('allow')).toBe('GET, HEAD');
    expect(unrelated).toBeNull();
  });
});
