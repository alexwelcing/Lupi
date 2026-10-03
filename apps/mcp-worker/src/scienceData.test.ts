import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTERNAL_RESEARCH_DATASETS,
  externalResearchLoadPath,
} from '@atlas/core';
import { handleRequest } from './index';
import { OMOL_DATASETS, compactOmolRow, routeScienceData } from './scienceData';

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
        sourceRows: number;
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
      sourceRows: 101_666_280,
      coverage: 'indexed-preview',
    }));
    expect(body.collections.map((entry) => entry.sourceRows)).toEqual([34_335_828, 27_697, 101_666_280, 3_986_754, 2_762_021]);
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
      charge: 0,
      spinMultiplicity: 1,
      chargeSource: 'split-definition',
      domain: null,
      homoLumoGapEv: null,
      loadUrl: '/v1/datasets/omol25/neutral-train/structures/12.xyz',
      coordinateProvenance: 'source',
      bondTopology: 'not-provided',
    });
    expect(body.rows[0]).not.toHaveProperty('metaTruncated');
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
    // Comment values never carry spaces, so each key=value parses as one token.
    expect(xyz).toContain('configuration_id=cfg_7');
    expect(xyz).toContain('method=DFT_PBE');
    expect(xyz).toContain('coordinates=source');
    expect(xyz).toContain('bonds=not-provided');
    expect(xyz).toContain('charge=0 | multiplicity=1 | charge_source=split-definition');
    expect(response!.headers.get('x-lupi-charge-provenance')).toBe('split-definition');
    expect(response!.headers.get('x-lupi-bond-inference')).toBe('lupi-bonds.molecular.v1');

    const upstreamUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstreamUrl.pathname).toBe('/rows');
    expect(upstreamUrl.searchParams.get('offset')).toBe('7');
    expect(upstreamUrl.searchParams.get('length')).toBe('1');
  });

  it('reads charge and spin from property_metadata, never from the ColabFit multiplicity column', () => {
    const dataset = OMOL_DATASETS.find((entry) => entry.id === 'validation-preview')!;
    const row = compactOmolRow({
      row_idx: 0,
      truncated_cells: [],
      row: {
        configuration_id: 'CO_1',
        chemical_formula_hill: 'C30H40N4Pr',
        multiplicity: 1,
        property_metadata: JSON.stringify({ charge: 1, spin: 3, data_id: 'metal_complexes', homo_lumo_gap: [2.5, 2.25] }),
      },
    }, dataset);
    expect(row).toMatchObject({
      charge: 1,
      spinMultiplicity: 3,
      chargeSource: 'record',
      multiplicity: 1,
      domain: 'metal_complexes',
      homoLumoGapEv: 2.5,
    });
  });

  it('marks truncated or implausible metadata unavailable without failing the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonUpstream({
      rows: [
        { row_idx: 4, truncated_cells: ['property_metadata'], row: { chemical_formula_hill: 'C2H6O', property_metadata: '{"charge": 0, "sp' } },
        { row_idx: 5, truncated_cells: [], row: { chemical_formula_hill: 'CH4', property_metadata: '{"charge": 0.5, "spin": 1}' } },
        { row_idx: 6, truncated_cells: [], row: { chemical_formula_hill: 'H2O', property_metadata: 'not json' } },
        { row_idx: 7, truncated_cells: [], row: { chemical_formula_hill: 'NH3', property_metadata: '{"charge": 0, "spin": 12}' } },
      ],
    })));

    const response = await routeScienceData(req('/v1/datasets/omol25/validation-preview/rows?offset=4&limit=4'));
    const body = await response!.json() as { rows: Array<Record<string, unknown>> };

    expect(response!.status).toBe(200);
    expect(body.rows).toHaveLength(4);
    expect(body.rows[0]).toMatchObject({ charge: null, spinMultiplicity: null, chargeSource: 'unavailable', metaTruncated: true });
    for (const row of body.rows.slice(1)) {
      expect(row).toMatchObject({ charge: null, spinMultiplicity: null, chargeSource: 'unavailable' });
      expect(row).not.toHaveProperty('metaTruncated');
    }
  });

  it('writes the record\'s chemistry into the structure comment in contract order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonUpstream({
      rows: [{
        row_idx: 273,
        truncated_cells: [],
        row: {
          atomic_numbers: [8, 1, 1],
          positions: [[0, 0, 0], [0.75, 0, 0], [-0.25, 0.7, 0]],
          chemical_formula_hill: 'H2O',
          configuration_id: 'CO_85',
          property_id: 'PO_10',
          method: 'ωB97M-V',
          multiplicity: 1,
          energy: -63330.86111298835,
          max_force_norm: 3.0829408336136006,
          property_metadata: JSON.stringify({ charge: 0, spin: 1, data_id: 'orbnet_denali', homo_lumo_gap: [6.386757202393212] }),
        },
      }],
    })));

    const response = await routeScienceData(req('/v1/datasets/omol25/neutral-validation/structures/273.xyz'), { cache: null });
    const comment = (await response!.text()).split('\n')[1];

    expect(response!.status).toBe(200);
    expect(comment).toBe([
      'OMol25 neutral-validation row=273',
      'collection=neutral-validation',
      'formula=H2O',
      'configuration_id=CO_85',
      'property_id=PO_10',
      'method=ωB97M-V',
      'charge=0',
      'multiplicity=1',
      'charge_source=record',
      'data_id=orbnet_denali',
      'energy_eV=-63330.861113',
      'max_force_eV_per_A=3.08294083361',
      'homo_lumo_gap_eV=6.38675720239',
      'coordinates=source',
      'bonds=not-provided',
      'license=CC-BY-4.0',
      'source=colabfit/OMol25_neutral_validation',
    ].join(' | '));
    expect(comment).not.toContain('Properties=');
    expect(comment).not.toMatch(/=\S*\s+[^|\s]/);
    expect(response!.headers.get('x-lupi-charge-provenance')).toBe('record');
    expect(response!.headers.get('x-lupi-bond-inference')).toBe('lupi-bonds.molecular.v1');
    expect(response!.headers.get('x-lupi-bond-topology')).toBe('not-provided');
  });

  it('omits charge and multiplicity when the record has none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonUpstream({
      rows: [{
        row_idx: 3,
        truncated_cells: ['property_metadata'],
        row: { atomic_numbers: [1, 1], positions: [[0, 0, 0], [0.74, 0, 0]], chemical_formula_hill: 'H2' },
      }],
    })));

    const response = await routeScienceData(req('/v1/datasets/omol25/validation-preview/structures/3.xyz'), { cache: null });
    const comment = (await response!.text()).split('\n')[1];

    expect(comment).toContain('charge_source=unavailable');
    expect(comment).not.toMatch(/\| charge=|\| multiplicity=/);
    expect(response!.headers.get('x-lupi-charge-provenance')).toBe('unavailable');
  });

  it('returns 504 slow when the upstream times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));
    const rows = await routeScienceData(req('/v1/datasets/omol25/neutral-train/rows?formula=H2O'));
    expect(rows!.status).toBe(504);
    expect(rows!.headers.get('cache-control')).toBe('no-store');
    expect(await rows!.json()).toMatchObject({ status: 'slow', dataset: 'neutral-train', timeoutSeconds: 9 });

    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    const structure = await routeScienceData(
      req('/v1/datasets/omol25/neutral-train/structures/1.xyz'),
      { cache: null, structureTimeoutMs: 5 },
    );
    expect(structure!.status).toBe(504);
    expect(await structure!.json()).toMatchObject({ status: 'slow' });
  });

  it('reports a truncated coordinate cell explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonUpstream({
      rows: [{ row_idx: 9, truncated_cells: ['positions'], row: { atomic_numbers: [8, 1, 1], positions: [[0, 0, 0]] } }],
    })));
    const response = await routeScienceData(req('/v1/datasets/omol25/validation-preview/structures/9.xyz'), { cache: null });
    expect(response!.status).toBe(502);
    expect(await response!.json()).toMatchObject({ error: expect.stringContaining('truncated') });
  });

  it('serves structures without a cache, and from an injected cache on the second call', async () => {
    const upstream = () => jsonUpstream({
      rows: [{ row_idx: 2, row: { atomic_numbers: '[8,1,1]', positions: [[0, 0, 0], [0.75, 0, 0], [-0.25, 0.7, 0]], chemical_formula_hill: 'H2O' } }],
    });
    const fetchMock = vi.fn(async () => upstream());
    vi.stubGlobal('fetch', fetchMock);

    expect((globalThis as { caches?: unknown }).caches).toBeUndefined();
    const uncached = await routeScienceData(req('/v1/datasets/omol25/neutral-train/structures/2.xyz'));
    expect(uncached!.status).toBe(200);
    expect(await uncached!.text()).toContain('formula=H2O');

    const store = new Map<string, Response>();
    const cache = {
      match: async (key: Request) => store.get(key.url)?.clone() ?? undefined,
      put: async (key: Request, value: Response) => { store.set(key.url, value); },
    } as unknown as Cache;
    fetchMock.mockClear();
    const first = await routeScienceData(req('/v1/datasets/omol25/neutral-train/structures/2.xyz'), { cache });
    const second = await routeScienceData(req('/v1/datasets/omol25/neutral-train/structures/2.xyz'), { cache });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...store.keys()]).toEqual([expect.stringContaining('omol25-xyz-v2')]);
    expect(await second!.text()).toBe(await first!.text());
    expect(second!.headers.get('x-lupi-charge-provenance')).toBe('split-definition');
  });

  it('exposes the provenance headers to browsers through CORS', async () => {
    const response = await handleRequest(req('/v1/datasets/omol25'));
    const exposed = response.headers.get('access-control-expose-headers') ?? '';
    expect(exposed.split(',')).toEqual(expect.arrayContaining([
      'x-lupi-coordinate-provenance',
      'x-lupi-bond-topology',
      'x-lupi-charge-provenance',
      'x-lupi-bond-inference',
    ]));
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
