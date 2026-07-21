import {
  EXTERNAL_RESEARCH_DATASETS,
  externalResearchLoadPath,
  getElementSpec,
  type ExternalResearchDataset,
} from '@atlas/core';

type JsonRecord = Record<string, unknown>;

export type ScienceDataRouteResult = Response | null;

const HF_DATASET_VIEWER_ORIGIN = 'https://datasets-server.huggingface.co';
const OMOL_LICENSE = 'CC-BY-4.0';
const OMOL_ATTRIBUTION_URL = 'https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit';
const OMOL_PAPER_URL = 'https://arxiv.org/abs/2505.08762';
const OMOL_MAX_PAGE_SIZE = 36;
const OMOL_MAX_ATOMS = 1_000;
const MAX_EXTERNAL_RESEARCH_BYTES = 16 * 1024 * 1024;

export interface OmolDatasetDefinition {
  id: string;
  label: string;
  dataset: string;
  config: string;
  split: string;
  indexedRows: number;
  estimatedRows: number;
  coverage: 'complete' | 'indexed-preview';
  description: string;
}

/**
 * Public ColabFit conversions of OMol25. The complete neutral splits are the
 * reliable large-scale browsing lane today. Hugging Face's Dataset Viewer has
 * indexed only a bounded window of the broader train/validation repositories,
 * so those entries stay explicitly marked as previews rather than being
 * presented as complete access to the ~83M-system source corpus.
 */
export const OMOL_DATASETS: readonly OmolDatasetDefinition[] = [
  {
    id: 'neutral-train',
    label: 'Neutral train',
    dataset: 'colabfit/OMol25_train_neutral',
    config: 'default',
    split: 'train',
    indexedRows: 34_335_828,
    estimatedRows: 34_335_828,
    coverage: 'complete',
    description: 'Complete public neutral training split, streamed one row at a time.',
  },
  {
    id: 'neutral-validation',
    label: 'Neutral validation',
    dataset: 'colabfit/OMol25_neutral_validation',
    config: 'default',
    split: 'train',
    indexedRows: 27_697,
    estimatedRows: 27_697,
    coverage: 'complete',
    description: 'Complete public neutral validation split.',
  },
  {
    id: 'all-train-preview',
    label: 'All train (indexed window)',
    dataset: 'colabfit/OMol25_train',
    config: 'default',
    split: 'train',
    indexedRows: 841_736,
    estimatedRows: 65_331_709,
    coverage: 'indexed-preview',
    description: 'Hugging Face indexed window of the broader charged + neutral training repository.',
  },
  {
    id: 'train-4m-preview',
    label: '4M train (indexed window)',
    dataset: 'colabfit/OMol25_train_4M',
    config: 'default',
    split: 'train',
    indexedRows: 1_000_000,
    estimatedRows: 2_657_915,
    coverage: 'indexed-preview',
    description: 'Hugging Face indexed window of the OMol25 4M training repository.',
  },
  {
    id: 'validation-preview',
    label: 'Validation (indexed window)',
    dataset: 'colabfit/OMol25_validation',
    config: 'default',
    split: 'train',
    indexedRows: 800_000,
    estimatedRows: 1_842_258,
    coverage: 'indexed-preview',
    description: 'Hugging Face indexed window of the broader validation repository.',
  },
] as const;

const OMOL_DATASET_BY_ID = new Map(OMOL_DATASETS.map((dataset) => [dataset.id, dataset]));

interface OmolCompactRow {
  rowIndex: number;
  id: string;
  configurationId: string | null;
  propertyId: string | null;
  formula: string;
  reducedFormula: string | null;
  elements: string[];
  atomCount: number;
  multiplicity: number | null;
  method: string | null;
  software: string | null;
  energy: number | null;
  maxForceNorm: number | null;
  name: string | null;
  loadUrl: string;
  coordinateProvenance: 'source';
  bondTopology: 'not-provided';
}

/** Route the public, storage-light scientific data API. */
export async function routeScienceData(request: Request): Promise<ScienceDataRouteResult> {
  const url = new URL(request.url);

  if (url.pathname === '/v1/datasets/omol25') {
    if (!isGetOrHead(request)) return methodNotAllowed(['GET', 'HEAD']);
    return bodyForMethod(request, jsonResponse(omolManifest(), {
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    }));
  }

  const rowsMatch = url.pathname.match(/^\/v1\/datasets\/omol25\/([a-z0-9-]+)\/rows$/);
  if (rowsMatch) {
    if (!isGetOrHead(request)) return methodNotAllowed(['GET', 'HEAD']);
    const dataset = OMOL_DATASET_BY_ID.get(rowsMatch[1]);
    if (!dataset) return jsonResponse({ error: 'Unknown OMol25 collection.' }, { status: 404 });
    return bodyForMethod(request, await browseOmolRows(url, dataset));
  }

  const structureMatch = url.pathname.match(
    /^\/v1\/datasets\/omol25\/([a-z0-9-]+)\/structures\/(\d+)\.xyz$/,
  );
  if (structureMatch) {
    if (!isGetOrHead(request)) return methodNotAllowed(['GET', 'HEAD']);
    const dataset = OMOL_DATASET_BY_ID.get(structureMatch[1]);
    if (!dataset) return jsonResponse({ error: 'Unknown OMol25 collection.' }, { status: 404 });
    const rowIndex = parseInteger(structureMatch[2], 'row index', 0, dataset.indexedRows - 1);
    if (rowIndex instanceof Response) return rowIndex;
    return bodyForMethod(request, await omolXyzResponse(dataset, rowIndex));
  }

  if (url.pathname === '/v1/datasets/research') {
    if (!isGetOrHead(request)) return methodNotAllowed(['GET', 'HEAD']);
    return bodyForMethod(request, jsonResponse(researchManifest(), {
      headers: { 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' },
    }));
  }

  if (url.pathname.startsWith('/v1/datasets/research/')) {
    if (!isGetOrHead(request)) return methodNotAllowed(['GET', 'HEAD']);
    const dataset = EXTERNAL_RESEARCH_DATASETS.find(
      (candidate) => externalResearchLoadPath(candidate) === url.pathname,
    );
    if (!dataset) return jsonResponse({ error: 'Unknown external research dataset.' }, { status: 404 });
    if (url.search) return jsonResponse({ error: 'External research asset URLs do not accept query parameters.' }, { status: 400 });
    return proxyResearchDataset(request, dataset);
  }

  return null;
}

function researchManifest() {
  return {
    id: 'lupi-external-research-v1',
    title: 'External LAMMPS research data',
    description: 'Versioned, source-cited LAMMPS structures and trajectories fetched from Zenodo only when selected.',
    storageModel: 'catalog metadata in Lupi; source payloads remain on Zenodo',
    safety: {
      proxy: 'fixed catalog allowlist; no arbitrary upstream URLs',
      maximumBytes: MAX_EXTERNAL_RESEARCH_BYTES,
      redirects: 'blocked',
      atomTypes: 'source type IDs stay opaque unless an explicit element map is present',
      bonds: 'source topology only; viewer inference is labeled separately',
    },
    datasets: EXTERNAL_RESEARCH_DATASETS.map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      summary: dataset.summary,
      domain: dataset.domain,
      format: dataset.format,
      sequenceKind: dataset.sequenceKind,
      representation: dataset.representation,
      atomCount: dataset.atomCount,
      frameCount: dataset.frameCount,
      elements: dataset.elements,
      typeMap: dataset.typeMap,
      bytes: dataset.remote.bytes,
      checksum: dataset.remote.checksum,
      loadUrl: externalResearchLoadPath(dataset),
      upstreamUrl: dataset.remote.url,
      verifiedAt: dataset.remote.verifiedAt,
      provenance: dataset.provenance,
      parser: dataset.parser,
      sourceTruth: dataset.sourceTruth,
    })),
  };
}

async function proxyResearchDataset(request: Request, dataset: ExternalResearchDataset): Promise<Response> {
  if (dataset.remote.bytes > MAX_EXTERNAL_RESEARCH_BYTES) {
    return jsonResponse({ error: 'The catalog asset exceeds Lupi\'s raw-text loading ceiling.' }, { status: 413 });
  }

  const range = parseByteRange(request.headers.get('range'), dataset.remote.bytes);
  if (range === 'invalid') {
    return jsonResponse({ error: 'Only one satisfiable byte range is supported.' }, {
      status: 416,
      headers: { 'content-range': `bytes */${dataset.remote.bytes}` },
    });
  }

  const out = researchResponseHeaders(dataset);
  if (request.method === 'HEAD') {
    out.set('content-length', String(range ? range.end - range.start + 1 : dataset.remote.bytes));
    if (range) out.set('content-range', `bytes ${range.start}-${range.end}/${dataset.remote.bytes}`);
    return new Response(null, { status: range ? 206 : 200, headers: out });
  }

  // Zenodo's API content endpoint rejects Cloudflare Worker egress in some
  // regions. The version-pinned record file route serves the identical,
  // checksum-addressed bytes and is stable for a fixed record version.
  const zenodoFileUrl = new URL(
    `/records/${dataset.remote.recordId}/files/${encodeURIComponent(dataset.remote.fileKey)}`,
    'https://zenodo.org',
  );
  zenodoFileUrl.searchParams.set('download', '1');
  let upstream: Response;
  try {
    upstream = await fetch(zenodoFileUrl, {
      method: 'GET',
      headers: {
        accept: 'application/octet-stream',
        'user-agent': 'Lupi/0.3 scientific-data proxy (+https://lupi.live)',
      },
      redirect: 'manual',
    });
  } catch {
    return jsonResponse({
      error: 'The external research source is temporarily unavailable.',
      dataset: dataset.id,
    }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return jsonResponse({ error: 'The catalog source attempted an unverified redirect.' }, { status: 502 });
  }
  if (!upstream.ok) {
    return jsonResponse({
      error: 'The external research source is temporarily unavailable.',
      dataset: dataset.id,
      upstreamStatus: upstream.status,
    }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }

  const reportedLength = parseOptionalHeaderInteger(upstream.headers.get('content-length'));
  if (reportedLength !== dataset.remote.bytes) {
    return jsonResponse({ error: 'The external research asset no longer matches its pinned byte length.' }, { status: 502 });
  }

  let payload: ArrayBuffer;
  try {
    payload = await readExactBody(upstream, dataset.remote.bytes);
  } catch {
    return jsonResponse({ error: 'The external research asset exceeded its pinned byte boundary.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const digest = await sha256Hex(payload);
  if (digest !== dataset.remote.checksum.value) {
    return jsonResponse({ error: 'The external research asset failed its pinned SHA-256 integrity check.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' },
    });
  }

  copyHeader(upstream.headers, out, 'last-modified');
  out.set('x-lupi-integrity-verified', `sha256:${digest}`);
  const body = range ? payload.slice(range.start, range.end + 1) : payload;
  out.set('content-length', String(body.byteLength));
  if (range) out.set('content-range', `bytes ${range.start}-${range.end}/${dataset.remote.bytes}`);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: out,
  });
}

function researchResponseHeaders(dataset: ExternalResearchDataset): Headers {
  const out = new Headers();
  out.set('accept-ranges', 'bytes');
  out.set('etag', `"sha256-${dataset.remote.checksum.value}"`);
  out.set('content-type', 'text/plain; charset=utf-8');
  out.set('content-disposition', `inline; filename="${dataset.remote.fileKey}"`);
  out.set('cache-control', 'public, max-age=31536000, immutable');
  out.set('x-lupi-data-source', 'zenodo-fixed-catalog');
  out.set('x-lupi-data-license', dataset.provenance.license);
  out.set('x-lupi-content-checksum', `${dataset.remote.checksum.algorithm}:${dataset.remote.checksum.value}`);
  out.set('x-lupi-source-checksum', `md5:${dataset.remote.checksum.sourceMd5}`);
  out.set('x-lupi-research-dataset', dataset.id);
  return out;
}

function omolManifest() {
  return {
    id: 'omol25',
    title: 'Open Molecules 2025',
    description: 'Remote, row-level access to public ColabFit OMol25 conversions. No dataset shards are stored by Lupi.',
    sourceDataset: 'facebook/OMol25',
    sourceAccess: 'gated',
    publicConversion: 'ColabFit Exchange',
    license: OMOL_LICENSE,
    attributionUrl: OMOL_ATTRIBUTION_URL,
    paperUrl: OMOL_PAPER_URL,
    sourceTruth: {
      coordinates: 'OMol25 source coordinates',
      bondTopology: 'not provided; any viewer bonds are display inference',
    },
    browserContract: {
      maxRowsPerRequest: OMOL_MAX_PAGE_SIZE,
      storageModel: 'metadata pages and one selected XYZ are fetched on demand',
      completePublicLane: 'neutral-train',
    },
    collections: OMOL_DATASETS.map((dataset) => ({
      id: dataset.id,
      label: dataset.label,
      description: dataset.description,
      repository: dataset.dataset,
      indexedRows: dataset.indexedRows,
      estimatedRows: dataset.estimatedRows,
      coverage: dataset.coverage,
      rowsUrl: `/v1/datasets/omol25/${dataset.id}/rows`,
    })),
  };
}

async function browseOmolRows(url: URL, dataset: OmolDatasetDefinition): Promise<Response> {
  const offset = parseInteger(url.searchParams.get('offset') ?? '0', 'offset', 0, dataset.indexedRows - 1);
  if (offset instanceof Response) return offset;
  const requestedLimit = parseInteger(
    url.searchParams.get('limit') ?? '24',
    'limit',
    1,
    OMOL_MAX_PAGE_SIZE,
  );
  if (requestedLimit instanceof Response) return requestedLimit;
  // A normal page-size request at the tail should return the remaining rows,
  // not become invalid merely because fewer than 24 records remain.
  const limit = Math.min(requestedLimit, dataset.indexedRows - offset);

  const query = cleanSearchValue(url.searchParams.get('query'), 'query');
  if (query instanceof Response) return query;
  const formula = cleanFormula(url.searchParams.get('formula'));
  if (formula instanceof Response) return formula;
  if (query && formula) {
    return jsonResponse({ error: 'Use either query or formula, not both.' }, { status: 400 });
  }

  const upstream = new URL(query ? '/search' : formula ? '/filter' : '/rows', HF_DATASET_VIEWER_ORIGIN);
  upstream.searchParams.set('dataset', dataset.dataset);
  upstream.searchParams.set('config', dataset.config);
  upstream.searchParams.set('split', dataset.split);
  upstream.searchParams.set('offset', String(offset));
  upstream.searchParams.set('length', String(limit));
  if (query) upstream.searchParams.set('query', query);
  if (formula) upstream.searchParams.set('where', `"chemical_formula_hill"='${formula}'`);

  const upstreamResponse = await fetch(upstream, {
    headers: { accept: 'application/json', 'user-agent': 'Lupi/OMol25-edge' },
  });
  const payload = await readJsonObject(upstreamResponse);
  if (!upstreamResponse.ok) return upstreamFailure(upstreamResponse, payload, dataset);

  const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = sourceRows.flatMap((entry) => {
    const compact = compactOmolRow(entry, dataset);
    return compact ? [compact] : [];
  });
  const upstreamTotal = numberOrNull(payload.num_rows_total);

  return jsonResponse({
    dataset: dataset.id,
    repository: dataset.dataset,
    coverage: dataset.coverage,
    indexedRows: dataset.indexedRows,
    estimatedRows: dataset.estimatedRows,
    offset,
    limit,
    returnedRows: rows.length,
    matchedRows: upstreamTotal,
    partial: payload.partial === true || dataset.coverage === 'indexed-preview',
    query: query ?? null,
    formula: formula ?? null,
    rows,
    provenance: {
      license: OMOL_LICENSE,
      attributionUrl: OMOL_ATTRIBUTION_URL,
      coordinates: 'source',
      bondTopology: 'not-provided',
    },
  }, {
    headers: scienceHeaders('public, max-age=300, stale-while-revalidate=3600'),
  });
}

async function omolXyzResponse(dataset: OmolDatasetDefinition, rowIndex: number): Promise<Response> {
  const upstream = new URL('/rows', HF_DATASET_VIEWER_ORIGIN);
  upstream.searchParams.set('dataset', dataset.dataset);
  upstream.searchParams.set('config', dataset.config);
  upstream.searchParams.set('split', dataset.split);
  upstream.searchParams.set('offset', String(rowIndex));
  upstream.searchParams.set('length', '1');

  const upstreamResponse = await fetch(upstream, {
    headers: { accept: 'application/json', 'user-agent': 'Lupi/OMol25-edge' },
  });
  const payload = await readJsonObject(upstreamResponse);
  if (!upstreamResponse.ok) return upstreamFailure(upstreamResponse, payload, dataset);

  const first = Array.isArray(payload.rows) ? payload.rows[0] : undefined;
  if (!isRecord(first) || !isRecord(first.row) || numberOrNull(first.row_idx) !== rowIndex) {
    return jsonResponse({ error: 'OMol25 row was not available from the upstream index.' }, { status: 404 });
  }

  let atomicNumbers: unknown;
  try {
    atomicNumbers = typeof first.row.atomic_numbers === 'string'
      ? JSON.parse(first.row.atomic_numbers)
      : first.row.atomic_numbers;
  } catch {
    return jsonResponse({ error: 'OMol25 row has invalid atomic-number data.' }, { status: 502 });
  }
  const positions = first.row.positions;
  if (!Array.isArray(atomicNumbers) || !Array.isArray(positions) || atomicNumbers.length !== positions.length) {
    return jsonResponse({ error: 'OMol25 row has inconsistent coordinate data.' }, { status: 502 });
  }
  if (atomicNumbers.length === 0 || atomicNumbers.length > OMOL_MAX_ATOMS) {
    return jsonResponse({ error: 'OMol25 row atom count is outside the supported safety bound.' }, { status: 502 });
  }

  const coordinateLines: string[] = [];
  for (let index = 0; index < atomicNumbers.length; index += 1) {
    const atomicNumber = atomicNumbers[index];
    const position = positions[index];
    if (!Number.isInteger(atomicNumber) || atomicNumber < 1 || atomicNumber > 118 || !isFiniteTriplet(position)) {
      return jsonResponse({ error: 'OMol25 row contains an invalid atom or coordinate.' }, { status: 502 });
    }
    coordinateLines.push(
      `${getElementSpec(atomicNumber).symbol} ${formatCoordinate(position[0])} ${formatCoordinate(position[1])} ${formatCoordinate(position[2])}`,
    );
  }

  const formula = stringOrNull(first.row.chemical_formula_hill) ?? `OMol25-${rowIndex}`;
  const configurationId = compactCommentValue(first.row.configuration_id);
  const propertyId = compactCommentValue(first.row.property_id);
  const method = compactCommentValue(first.row.method);
  const comment = [
    `OMol25 ${dataset.id} row=${rowIndex}`,
    `formula=${compactCommentValue(formula) ?? 'unknown'}`,
    configurationId ? `configuration_id=${configurationId}` : '',
    propertyId ? `property_id=${propertyId}` : '',
    method ? `method=${method}` : '',
    'coordinates=source',
    'bonds=not-provided',
    `license=${OMOL_LICENSE}`,
    `source=${dataset.dataset}`,
  ].filter(Boolean).join(' | ');
  const xyz = `${coordinateLines.length}\n${comment}\n${coordinateLines.join('\n')}\n`;
  const headers = scienceHeaders('public, max-age=86400, stale-while-revalidate=604800');
  headers.set('content-type', 'chemical/x-xyz; charset=utf-8');
  headers.set('content-length', String(new TextEncoder().encode(xyz).byteLength));
  headers.set('content-disposition', `inline; filename="omol25-${dataset.id}-${rowIndex}.xyz"`);
  headers.set('x-lupi-coordinate-provenance', 'source');
  headers.set('x-lupi-bond-topology', 'not-provided');
  return new Response(xyz, { headers });
}

function compactOmolRow(entry: unknown, dataset: OmolDatasetDefinition): OmolCompactRow | null {
  if (!isRecord(entry) || !isRecord(entry.row)) return null;
  const rowIndex = numberOrNull(entry.row_idx);
  if (rowIndex === null || !Number.isInteger(rowIndex) || rowIndex < 0) return null;
  const row = entry.row;
  const configurationId = stringOrNull(row.configuration_id);
  const propertyId = stringOrNull(row.property_id);
  const formula = stringOrNull(row.chemical_formula_hill)
    ?? stringOrNull(row.chemical_formula_reduced)
    ?? `OMol25 row ${rowIndex}`;
  const names = stringArray(row.names);
  const atomCount = numberOrNull(row.nsites) ?? (Array.isArray(row.positions) ? row.positions.length : 0);
  const elements = stringArray(row.elements);
  return {
    rowIndex,
    id: configurationId ?? propertyId ?? `${dataset.id}-${rowIndex}`,
    configurationId,
    propertyId,
    formula,
    reducedFormula: stringOrNull(row.chemical_formula_reduced),
    elements,
    atomCount,
    multiplicity: numberOrNull(row.multiplicity),
    method: stringOrNull(row.method),
    software: stringOrNull(row.software),
    energy: numberOrNull(row.energy),
    maxForceNorm: numberOrNull(row.max_force_norm),
    name: names[0] ?? null,
    loadUrl: `/v1/datasets/omol25/${dataset.id}/structures/${rowIndex}.xyz`,
    coordinateProvenance: 'source',
    bondTopology: 'not-provided',
  };
}

function upstreamFailure(response: Response, payload: JsonRecord, dataset: OmolDatasetDefinition): Response {
  const message = stringOrNull(payload.error) ?? `Dataset Viewer returned HTTP ${response.status}.`;
  const warming = response.headers.get('x-error-code') === 'ResponseNotReady'
    || /index is loading|not ready/i.test(message);
  if (warming) {
    return jsonResponse({
      error: 'The upstream OMol25 search index is warming. Browse by page or retry the search shortly.',
      status: 'warming',
      dataset: dataset.id,
      retryAfterSeconds: 15,
    }, {
      status: 202,
      headers: { 'retry-after': '15', 'cache-control': 'no-store' },
    });
  }
  return jsonResponse({
    error: 'The upstream OMol25 dataset service is temporarily unavailable.',
    dataset: dataset.id,
    upstreamStatus: response.status,
  }, { status: 502, headers: { 'cache-control': 'no-store' } });
}

async function readJsonObject(response: Response): Promise<JsonRecord> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function parseInteger(value: string, label: string, min: number, max: number): number | Response {
  if (!/^\d+$/.test(value)) {
    return jsonResponse({ error: `${label} must be an integer between ${min} and ${max}.` }, { status: 400 });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return jsonResponse({ error: `${label} must be between ${min} and ${max}.` }, { status: 400 });
  }
  return parsed;
}

function cleanSearchValue(value: string | null, label: string): string | null | Response {
  if (value === null) return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 80 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    return jsonResponse({ error: `${label} must contain 1 to 80 printable characters.` }, { status: 400 });
  }
  return cleaned;
}

function cleanFormula(value: string | null): string | null | Response {
  if (value === null) return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 64 || !/^[A-Za-z0-9()[\]+.\-]+$/.test(cleaned)) {
    return jsonResponse({ error: 'formula must be a 1 to 64 character molecular formula.' }, { status: 400 });
  }
  return cleaned;
}

function compactCommentValue(value: unknown): string | null {
  const text = stringOrNull(value);
  return text ? text.replace(/[\r\n|]/g, ' ').slice(0, 180) : null;
}

function formatCoordinate(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

function isFiniteTriplet(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseOptionalHeaderInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseByteRange(
  value: string | null,
  totalBytes: number,
): { start: number; end: number } | null | 'invalid' {
  if (value === null) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return 'invalid';

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    return { start: Math.max(0, totalBytes - suffixLength), end: totalBytes - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalBytes - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= totalBytes
  ) return 'invalid';
  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}

async function readExactBody(response: Response, expectedBytes: number): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== expectedBytes) throw new Error('Unexpected body length.');
    return buffer;
  }

  const reader = response.body.getReader();
  const output = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > expectedBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new Error('Body exceeded pinned byte length.');
      }
      output.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  if (offset !== expectedBytes) throw new Error('Body ended before pinned byte length.');
  return output.buffer;
}

async function sha256Hex(payload: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name);
  if (value !== null) target.set(name, value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGetOrHead(request: Request): boolean {
  return request.method === 'GET' || request.method === 'HEAD';
}

function bodyForMethod(request: Request, response: Response): Response {
  return request.method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;
}

function scienceHeaders(cacheControl: string): Headers {
  const headers = new Headers();
  headers.set('cache-control', cacheControl);
  headers.set('x-lupi-data-source', 'huggingface-dataset-viewer');
  headers.set('x-lupi-data-license', OMOL_LICENSE);
  return headers;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(`${JSON.stringify(value, null, 2)}\n`, { ...init, headers });
}

function methodNotAllowed(methods: string[]): Response {
  return jsonResponse({ error: 'Method not allowed', allowedMethods: methods }, {
    status: 405,
    headers: { allow: methods.join(', ') },
  });
}
