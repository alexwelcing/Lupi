import {
  OMOL25_ATTRIBUTION_URL,
  OMOL25_CITATION,
  OMOL25_COLLECTIONS,
  OMOL25_LICENSE_URL,
  OMOL25_PAPER_URL,
  omol25Collection,
  omolChargeSpin,
  omolDomainCaveat,
  omolGeometryState,
  parseOmolStructurePath,
  type Omol25CollectionId,
} from '@atlas/core/omol25';
import type { MoleculeHit } from './types';
import { scienceDataUrl } from './dataEndpoints';

export type RemoteOmolCollectionId = Omol25CollectionId;

export interface RemoteOmolCollection {
  id: RemoteOmolCollectionId;
  label: string;
  description: string;
  repository: string;
  indexedRows: number;
  /** Hugging Face's estimate; understates the larger repositories. Prefer sourceRows. */
  estimatedRows: number;
  /** Configurations in the source split (ColabFit cards); absent from an older edge. */
  sourceRows?: number;
  coverage: 'complete' | 'indexed-preview';
  rowsUrl: string;
}

export interface RemoteOmolManifest {
  id: 'omol25';
  title: string;
  description: string;
  license: string;
  attributionUrl: string;
  paperUrl: string;
  collections: RemoteOmolCollection[];
}

export type RemoteOmolChargeSource = 'record' | 'split-definition' | 'unavailable';

export interface RemoteOmolRow {
  rowIndex: number;
  id: string;
  configurationId: string | null;
  propertyId: string | null;
  formula: string;
  reducedFormula: string | null;
  elements: string[];
  atomCount: number;
  /** ColabFit column, not spin multiplicity; no UI reads it. Use spinMultiplicity. */
  multiplicity: number | null;
  /** The next five are absent from rows an older edge served. */
  charge?: number | null;
  spinMultiplicity?: number | null;
  chargeSource?: RemoteOmolChargeSource;
  domain?: string | null;
  homoLumoGapEv?: number | null;
  /** Hugging Face truncated property_metadata, so charge and spin are unavailable. */
  metaTruncated?: boolean;
  method: string | null;
  software: string | null;
  energy: number | null;
  maxForceNorm: number | null;
  name: string | null;
  loadUrl: string;
  coordinateProvenance: 'source';
  bondTopology: 'not-provided';
}

export interface RemoteOmolPage {
  dataset: RemoteOmolCollectionId;
  repository: string;
  coverage: 'complete' | 'indexed-preview';
  indexedRows: number;
  estimatedRows: number;
  sourceRows?: number;
  offset: number;
  limit: number;
  returnedRows: number;
  matchedRows: number | null;
  partial: boolean;
  query: string | null;
  formula: string | null;
  rows: RemoteOmolRow[];
}

export class RemoteOmolWarmingError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 15) {
    super(message);
    this.name = 'RemoteOmolWarmingError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The edge gave up on the upstream (HTTP 504 {status:'slow'}); retrying later can work. */
export class OmolSlowError extends Error {
  readonly timeoutSeconds: number | null;

  constructor(message: string, timeoutSeconds: number | null = null) {
    super(message);
    this.name = 'OmolSlowError';
    this.timeoutSeconds = timeoutSeconds;
  }
}

const FALLBACK_DESCRIPTIONS: Record<RemoteOmolCollectionId, string> = {
  'neutral-train': 'Complete public neutral training split.',
  'neutral-validation': 'Complete public neutral validation split.',
  'all-train-preview': 'Indexed window of the broader charged + neutral training repository.',
  'train-4m-preview': 'Indexed window of the OMol25 4M training repository.',
  'validation-preview': 'Indexed window of the broader validation repository.',
};

export const FALLBACK_OMOL_COLLECTIONS: readonly RemoteOmolCollection[] = OMOL25_COLLECTIONS.map((collection) => ({
  id: collection.id,
  label: collection.label,
  description: FALLBACK_DESCRIPTIONS[collection.id],
  repository: collection.repo,
  indexedRows: collection.indexedRows,
  estimatedRows: collection.hfEstimatedRows,
  sourceRows: collection.sourceRows,
  coverage: collection.coverage,
  rowsUrl: `/v1/datasets/omol25/${collection.id}/rows`,
}));

let manifestCache: Promise<RemoteOmolManifest> | null = null;

export function remoteOmolManifest(): Promise<RemoteOmolManifest> {
  if (!manifestCache) {
    manifestCache = fetchJson<RemoteOmolManifest>(scienceDataUrl('/v1/datasets/omol25'))
      .catch(() => ({
        id: 'omol25',
        title: 'Open Molecules 2025',
        description: 'Remote OMol25 access',
        license: 'CC-BY-4.0',
        attributionUrl: OMOL25_ATTRIBUTION_URL,
        paperUrl: OMOL25_PAPER_URL,
        collections: [...FALLBACK_OMOL_COLLECTIONS],
      }));
  }
  return manifestCache;
}

export async function remoteOmolPage(options: {
  collection: RemoteOmolCollectionId;
  offset?: number;
  limit?: number;
  query?: string;
  formula?: string;
}): Promise<RemoteOmolPage> {
  const url = new URL(
    scienceDataUrl(`/v1/datasets/omol25/${options.collection}/rows`),
    typeof window === 'undefined' ? 'https://lupi.live' : window.location.origin,
  );
  url.searchParams.set('offset', String(options.offset ?? 0));
  url.searchParams.set('limit', String(options.limit ?? 24));
  if (options.query) url.searchParams.set('query', options.query);
  if (options.formula) url.searchParams.set('formula', options.formula);
  const path = url.origin === (typeof window === 'undefined' ? 'https://lupi.live' : window.location.origin)
    ? `${url.pathname}${url.search}`
    : url.toString();
  return fetchJson<RemoteOmolPage>(path);
}

/** arXiv's DataCite DOI for the OMol25 paper. */
const OMOL25_PAPER_DOI = '10.48550/arXiv.2505.08762';

export function remoteOmolHit(row: RemoteOmolRow): MoleculeHit {
  const method = row.method ? ` · ${row.method}` : '';
  const chemistry = row.chargeSource && row.chargeSource !== 'unavailable'
    && typeof row.charge === 'number' && typeof row.spinMultiplicity === 'number'
    ? ` · ${omolChargeSpin({ totalCharge: row.charge, spinMultiplicity: row.spinMultiplicity, source: row.chargeSource })}`
    : '';
  const collection = parseOmolStructurePath(row.loadUrl)?.collection;
  const notice = [omolGeometryState(row.maxForceNorm), omolDomainCaveat(row.domain ?? null)]
    .filter((line): line is string => Boolean(line))
    .map((line) => (line.endsWith('.') ? line : `${line}.`))
    .join(' ');
  return {
    id: `${row.rowIndex}:${row.id}`,
    source: 'omol',
    title: row.formula,
    subtitle: `${row.atomCount} atoms${method}${chemistry}`,
    formula: row.formula,
    elements: row.elements,
    tags: ['omol25', row.configurationId ?? '', row.propertyId ?? '', row.software ?? '', row.domain ?? ''].filter(Boolean),
    ...(notice ? { notice } : {}),
    load: { kind: 'url', url: scienceDataUrl(row.loadUrl) },
    provenance: {
      sourceUrl: collection
        ? `https://huggingface.co/datasets/${omol25Collection(collection).repo}`
        : OMOL25_ATTRIBUTION_URL,
      doi: OMOL25_PAPER_DOI,
      citation: OMOL25_CITATION,
      license: 'CC-BY-4.0',
      licenseUrl: OMOL25_LICENSE_URL,
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 202 && payload.status === 'warming') {
      throw new RemoteOmolWarmingError(
        typeof payload.error === 'string' ? payload.error : 'The upstream search index is warming.',
        typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : 15,
      );
    }
    if (response.status === 504 && payload.status === 'slow') {
      throw new OmolSlowError(
        typeof payload.error === 'string' ? payload.error : 'The upstream OMol25 dataset service did not answer in time.',
        typeof payload.timeoutSeconds === 'number' ? payload.timeoutSeconds : null,
      );
    }
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `OMol25 request failed (${response.status}).`);
    }
    return payload as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
