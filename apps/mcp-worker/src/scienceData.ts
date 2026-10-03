import {
  EXTERNAL_RESEARCH_DATASETS,
  externalResearchLoadPath,
  getElementSpec,
  type ExternalResearchDataset,
} from '@atlas/core';
import {
  OMOL25_ATTRIBUTION_URL,
  OMOL25_CITATION,
  OMOL25_COLLECTIONS,
  OMOL25_PAPER_URL,
  OMOL25_VIEWER_BOND_RECIPE,
  omolStructurePath,
  type Omol25CollectionId,
} from '@atlas/core/omol25';

type JsonRecord = Record<string, unknown>;

export type ScienceDataRouteResult = Response | null;

export interface ScienceDataOptions {
  fetcher?: typeof fetch;
  /** Structure cache: undefined uses the Workers default cache when there is one; null disables caching. */
  cache?: Cache | null;
  /** Upstream budgets in ms; tests shorten them. */
  rowsTimeoutMs?: number;
  structureTimeoutMs?: number;
}

const HF_DATASET_VIEWER_ORIGIN = 'https://datasets-server.huggingface.co';
const OMOL_LICENSE = 'CC-BY-4.0';
const OMOL_MAX_PAGE_SIZE = 36;
const OMOL_MAX_ATOMS = 1_000;
const MAX_EXTERNAL_RESEARCH_BYTES = 16 * 1024 * 1024;
// The browser gives up at 20 s; answer well before it with an explicit state.
export const OMOL_ROWS_TIMEOUT_MS = 9_000;
export const OMOL_STRUCTURE_TIMEOUT_MS = 12_000;
/** Bump when the structure XYZ text changes, so cached copies are not served. */
export const OMOL_XYZ_CACHE_VERSION = 'omol25-xyz-v2';
const OMOL_XYZ_CACHE_ORIGIN = 'https://science-cache.lupi.live';

export interface OmolDatasetDefinition {
  id: Omol25CollectionId;
  label: string;
  dataset: string;
  config: string;
  split: string;
  indexedRows: number;
  /** Hugging Face's estimate; understates the larger repositories (see sourceRows). */
  estimatedRows: number;
  sourceRows: number;
  coverage: 'complete' | 'indexed-preview';
  description: string;
}

const OMOL_DESCRIPTIONS: Record<Omol25CollectionId, string> = {
  'neutral-train': 'Complete public neutral training split, streamed one row at a time.',
  'neutral-validation': 'Complete public neutral validation split.',
  'all-train-preview': 'Hugging Face indexed window of the broader charged + neutral training repository.',
  'train-4m-preview': 'Hugging Face indexed window of the OMol25 4M training repository.',
  'validation-preview': 'Hugging Face indexed window of the broader validation repository.',
};

/**
 * Public ColabFit conversions of OMol25 (from @atlas/core/omol25). The complete
 * neutral splits are the reliable large-scale browsing lane today. Hugging
 * Face's Dataset Viewer has indexed only a bounded window of the broader
 * train/validation repositories, so those entries stay explicitly marked as
 * previews rather than being presented as complete access to the source corpus.
 */
export const OMOL_DATASETS: readonly OmolDatasetDefinition[] = OMOL25_COLLECTIONS.map((collection) => ({
  id: collection.id,
  label: collection.coverage === 'indexed-preview' ? `${collection.label} (indexed window)` : collection.label,
  dataset: collection.repo,
  config: 'default',
  split: 'train',
  indexedRows: collection.indexedRows,
  estimatedRows: collection.hfEstimatedRows,
  sourceRows: collection.sourceRows,
  coverage: collection.coverage,
  description: OMOL_DESCRIPTIONS[collection.id],
}));

const OMOL_DATASET_BY_ID = new Map<string, OmolDatasetDefinition>(OMOL_DATASETS.map((dataset) => [dataset.id, dataset]));

type OmolChargeSource = 'record' | 'split-definition' | 'unavailable';

/** Charge, spin and domain of a row, with where they came from. */
interface OmolRecordChemistry {
  charge: number | null;
  spinMultiplicity: number | null;
  chargeSource: OmolChargeSource;
  domain: string | null;
  homoLumoGapEv: number | null;
  metaTruncated: boolean;
}

interface OmolCompactRow {
  rowIndex: number;
  id: string;
  configurationId: string | null;
  propertyId: string | null;
  formula: string;
  reducedFormula: string | null;
  elements: string[];
  atomCount: number;
  /** ColabFit column, not spin multiplicity (it reads 1 for open-shell records); see spinMultiplicity. */
  multiplicity: number | null;
  charge: number | null;
  spinMultiplicity: number | null;
  chargeSource: OmolChargeSource;
  domain: string | null;
  homoLumoGapEv: number | null;
  /** Present when Hugging Face truncated property_metadata, so charge and spin are unavailable. */
  metaTruncated?: true;
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
export async function routeScienceData(
  request: Request,
  options: ScienceDataOptions = {},
): Promise<ScienceDataRouteResult> {
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
    return bodyForMethod(request, await browseOmolRows(url, dataset, options));
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
    return bodyForMethod(request, await omolXyzResponse(dataset, rowIndex, options));
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
    attributionUrl: OMOL25_ATTRIBUTION_URL,
    paperUrl: OMOL25_PAPER_URL,
    citation: OMOL25_CITATION,
    sourceTruth: {
      coordinates: 'OMol25 source coordinates',
      bondTopology: 'not provided; viewer bonds are Lupi\'s labelled inference',
      chargeAndSpin: 'property_metadata where the split has it (record); neutral-train by split definition',
      viewerBonds: { recipe: OMOL25_VIEWER_BOND_RECIPE, provenance: 'inferred' },
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
      sourceRows: dataset.sourceRows,
      coverage: dataset.coverage,
      rowsUrl: `/v1/datasets/omol25/${dataset.id}/rows`,
    })),
  };
}

async function browseOmolRows(url: URL, dataset: OmolDatasetDefinition, options: ScienceDataOptions): Promise<Response> {
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

  const timeoutMs = options.rowsTimeoutMs ?? OMOL_ROWS_TIMEOUT_MS;
  const fetched = await fetchUpstreamJson(upstream, timeoutMs, options);
  if (typeof fetched === 'string') return upstreamUnavailable(fetched, dataset, timeoutMs);
  const { response: upstreamResponse, payload } = fetched;
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
    sourceRows: dataset.sourceRows,
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
      attributionUrl: OMOL25_ATTRIBUTION_URL,
      coordinates: 'source',
      bondTopology: 'not-provided',
      viewerBonds: { recipe: OMOL25_VIEWER_BOND_RECIPE, provenance: 'inferred' },
    },
  }, {
    headers: scienceHeaders('public, max-age=300, stale-while-revalidate=3600'),
  });
}

async function omolXyzResponse(
  dataset: OmolDatasetDefinition,
  rowIndex: number,
  options: ScienceDataOptions,
): Promise<Response> {
  const cache = options.cache === undefined
    ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null
    : options.cache;
  const cacheKey = new Request(
    `${OMOL_XYZ_CACHE_ORIGIN}/${OMOL_XYZ_CACHE_VERSION}/${dataset.id}/structures/${rowIndex}.xyz`,
  );
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return hit;
  }

  const upstream = new URL('/rows', HF_DATASET_VIEWER_ORIGIN);
  upstream.searchParams.set('dataset', dataset.dataset);
  upstream.searchParams.set('config', dataset.config);
  upstream.searchParams.set('split', dataset.split);
  upstream.searchParams.set('offset', String(rowIndex));
  upstream.searchParams.set('length', '1');

  const timeoutMs = options.structureTimeoutMs ?? OMOL_STRUCTURE_TIMEOUT_MS;
  const fetched = await fetchUpstreamJson(upstream, timeoutMs, options);
  if (typeof fetched === 'string') return upstreamUnavailable(fetched, dataset, timeoutMs);
  const { response: upstreamResponse, payload } = fetched;
  if (!upstreamResponse.ok) return upstreamFailure(upstreamResponse, payload, dataset);

  const first = Array.isArray(payload.rows) ? payload.rows[0] : undefined;
  if (!isRecord(first) || !isRecord(first.row) || numberOrNull(first.row_idx) !== rowIndex) {
    return jsonResponse({ error: 'OMol25 row was not available from the upstream index.' }, { status: 404 });
  }
  const truncated = stringArray(first.truncated_cells);
  if (truncated.includes('positions') || truncated.includes('atomic_numbers')) {
    return jsonResponse({
      error: 'OMol25 row is too large for the Hugging Face Dataset Viewer to return whole: its coordinates were truncated upstream.',
      dataset: dataset.id,
      row: rowIndex,
    }, { status: 502, headers: { 'cache-control': 'no-store' } });
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

  const chemistry = omolRecordChemistry(first, first.row, dataset);
  const xyz = `${coordinateLines.length}\n${omolCommentLine(dataset, rowIndex, first.row, chemistry)}\n${coordinateLines.join('\n')}\n`;
  const headers = scienceHeaders('public, max-age=86400, stale-while-revalidate=604800');
  headers.set('content-type', 'chemical/x-xyz; charset=utf-8');
  headers.set('content-length', String(new TextEncoder().encode(xyz).byteLength));
  headers.set('content-disposition', `inline; filename="omol25-${dataset.id}-${rowIndex}.xyz"`);
  headers.set('x-lupi-coordinate-provenance', 'source');
  headers.set('x-lupi-bond-topology', 'not-provided');
  headers.set('x-lupi-charge-provenance', chemistry.chargeSource);
  headers.set('x-lupi-bond-inference', OMOL25_VIEWER_BOND_RECIPE);
  const response = new Response(xyz, { headers });
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => undefined);
  return response;
}

/**
 * The XYZ comment line. Keys and order are a contract with the parser and the
 * featured-pick builder: values never contain spaces, charge= and
 * multiplicity= are omitted when unavailable, and there is no Properties=.
 */
function omolCommentLine(
  dataset: Pick<OmolDatasetDefinition, 'id' | 'dataset'>,
  rowIndex: number,
  row: JsonRecord,
  chemistry: OmolRecordChemistry,
): string {
  const formula = compactCommentValue(row.chemical_formula_hill) ?? `OMol25-${rowIndex}`;
  const configurationId = compactCommentValue(row.configuration_id);
  const propertyId = compactCommentValue(row.property_id);
  const method = compactCommentValue(row.method);
  const energy = numberOrNull(row.energy);
  const maxForce = numberOrNull(row.max_force_norm);
  const known = chemistry.chargeSource !== 'unavailable';
  return [
    `OMol25 ${dataset.id} row=${rowIndex}`,
    `collection=${dataset.id}`,
    `formula=${formula}`,
    configurationId ? `configuration_id=${configurationId}` : '',
    propertyId ? `property_id=${propertyId}` : '',
    method ? `method=${method}` : '',
    known && chemistry.charge !== null ? `charge=${chemistry.charge}` : '',
    known && chemistry.spinMultiplicity !== null ? `multiplicity=${chemistry.spinMultiplicity}` : '',
    `charge_source=${chemistry.chargeSource}`,
    chemistry.domain ? `data_id=${chemistry.domain}` : '',
    energy !== null ? `energy_eV=${formatCoordinate(energy)}` : '',
    maxForce !== null ? `max_force_eV_per_A=${formatCoordinate(maxForce)}` : '',
    chemistry.homoLumoGapEv !== null ? `homo_lumo_gap_eV=${formatCoordinate(chemistry.homoLumoGapEv)}` : '',
    'coordinates=source',
    'bonds=not-provided',
    `license=${OMOL_LICENSE}`,
    `source=${dataset.dataset}`,
  ].filter(Boolean).join(' | ');
}

/**
 * Charge and spin with their provenance. ColabFit's `multiplicity` column is
 * not spin (it reads 1 for a Pr triplet), so spin comes only from
 * property_metadata. neutral-train has no metadata column; the split is
 * charge-neutral singlets by definition (arXiv:2505.08762 Table 1).
 */
function omolRecordChemistry(entry: JsonRecord, row: JsonRecord, dataset: OmolDatasetDefinition): OmolRecordChemistry {
  if (dataset.id === 'neutral-train') {
    return { charge: 0, spinMultiplicity: 1, chargeSource: 'split-definition', domain: null, homoLumoGapEv: null, metaTruncated: false };
  }
  const unavailable = (metaTruncated: boolean, domain: string | null = null, gap: number | null = null): OmolRecordChemistry => ({
    charge: null, spinMultiplicity: null, chargeSource: 'unavailable', domain, homoLumoGapEv: gap, metaTruncated,
  });
  if (stringArray(entry.truncated_cells).includes('property_metadata')) return unavailable(true);
  let meta: unknown = row.property_metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return unavailable(false);
    }
  }
  if (!isRecord(meta)) return unavailable(false);
  const domain = typeof meta.data_id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(meta.data_id) ? meta.data_id : null;
  const gapList = Array.isArray(meta.homo_lumo_gap) ? meta.homo_lumo_gap[0] : meta.homo_lumo_gap;
  const gap = numberOrNull(gapList);
  const charge = meta.charge;
  const spin = meta.spin;
  if (
    typeof charge !== 'number' || !Number.isInteger(charge) || Math.abs(charge) > 10
    || typeof spin !== 'number' || !Number.isInteger(spin) || spin < 1 || spin > 11
  ) {
    return unavailable(false, domain, gap);
  }
  return { charge, spinMultiplicity: spin, chargeSource: 'record', domain, homoLumoGapEv: gap, metaTruncated: false };
}

export function compactOmolRow(entry: unknown, dataset: OmolDatasetDefinition): OmolCompactRow | null {
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
  const chemistry = omolRecordChemistry(entry, row, dataset);
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
    charge: chemistry.charge,
    spinMultiplicity: chemistry.spinMultiplicity,
    chargeSource: chemistry.chargeSource,
    domain: chemistry.domain,
    homoLumoGapEv: chemistry.homoLumoGapEv,
    ...(chemistry.metaTruncated ? { metaTruncated: true as const } : {}),
    method: stringOrNull(row.method),
    software: stringOrNull(row.software),
    energy: numberOrNull(row.energy),
    maxForceNorm: numberOrNull(row.max_force_norm),
    name: names[0] ?? null,
    loadUrl: omolStructurePath(dataset.id, rowIndex),
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

type UpstreamJson = { response: Response; payload: JsonRecord } | 'slow' | 'unreachable';

/** One Dataset Viewer call under a deadline that also covers reading the body. */
async function fetchUpstreamJson(url: URL, timeoutMs: number, options: ScienceDataOptions): Promise<UpstreamJson> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'Lupi/OMol25-edge' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload: JsonRecord = {};
    try {
      const value: unknown = JSON.parse(text);
      if (isRecord(value)) payload = value;
    } catch {
      // A non-JSON body is reported through the status code below.
    }
    return { response, payload };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError' ? 'slow' : 'unreachable';
  }
}

function upstreamUnavailable(kind: 'slow' | 'unreachable', dataset: OmolDatasetDefinition, timeoutMs: number): Response {
  if (kind === 'slow') {
    return jsonResponse({
      error: `The upstream OMol25 dataset service did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
      status: 'slow',
      dataset: dataset.id,
      timeoutSeconds: timeoutMs / 1000,
    }, { status: 504, headers: { 'cache-control': 'no-store' } });
  }
  return jsonResponse({
    error: 'The upstream OMol25 dataset service is temporarily unavailable.',
    dataset: dataset.id,
  }, { status: 502, headers: { 'cache-control': 'no-store' } });
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

/** A comment value with no whitespace or `|`, so `key=value` pairs parse as single tokens. */
function compactCommentValue(value: unknown): string | null {
  const text = stringOrNull(value);
  return text ? text.trim().replace(/[\s|]+/g, '_').slice(0, 180) || null : null;
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
