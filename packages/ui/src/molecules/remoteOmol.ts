import type { MoleculeHit } from './types';
import { scienceDataUrl } from './dataEndpoints';

export type RemoteOmolCollectionId =
  | 'neutral-train'
  | 'neutral-validation'
  | 'all-train-preview'
  | 'train-4m-preview'
  | 'validation-preview';

export interface RemoteOmolCollection {
  id: RemoteOmolCollectionId;
  label: string;
  description: string;
  repository: string;
  indexedRows: number;
  estimatedRows: number;
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

export interface RemoteOmolRow {
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

export interface RemoteOmolPage {
  dataset: RemoteOmolCollectionId;
  repository: string;
  coverage: 'complete' | 'indexed-preview';
  indexedRows: number;
  estimatedRows: number;
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

export const FALLBACK_OMOL_COLLECTIONS: readonly RemoteOmolCollection[] = [
  {
    id: 'neutral-train',
    label: 'Neutral train',
    description: 'Complete public neutral training split.',
    repository: 'colabfit/OMol25_train_neutral',
    indexedRows: 34_335_828,
    estimatedRows: 34_335_828,
    coverage: 'complete',
    rowsUrl: '/v1/datasets/omol25/neutral-train/rows',
  },
  {
    id: 'neutral-validation',
    label: 'Neutral validation',
    description: 'Complete public neutral validation split.',
    repository: 'colabfit/OMol25_neutral_validation',
    indexedRows: 27_697,
    estimatedRows: 27_697,
    coverage: 'complete',
    rowsUrl: '/v1/datasets/omol25/neutral-validation/rows',
  },
  {
    id: 'all-train-preview',
    label: 'All train',
    description: 'Indexed window of the broader charged + neutral training repository.',
    repository: 'colabfit/OMol25_train',
    indexedRows: 841_736,
    estimatedRows: 65_331_709,
    coverage: 'indexed-preview',
    rowsUrl: '/v1/datasets/omol25/all-train-preview/rows',
  },
  {
    id: 'train-4m-preview',
    label: '4M train',
    description: 'Indexed window of the OMol25 4M training repository.',
    repository: 'colabfit/OMol25_train_4M',
    indexedRows: 1_000_000,
    estimatedRows: 2_657_915,
    coverage: 'indexed-preview',
    rowsUrl: '/v1/datasets/omol25/train-4m-preview/rows',
  },
  {
    id: 'validation-preview',
    label: 'Validation',
    description: 'Indexed window of the broader validation repository.',
    repository: 'colabfit/OMol25_validation',
    indexedRows: 800_000,
    estimatedRows: 1_842_258,
    coverage: 'indexed-preview',
    rowsUrl: '/v1/datasets/omol25/validation-preview/rows',
  },
];

let manifestCache: Promise<RemoteOmolManifest> | null = null;

export function remoteOmolManifest(): Promise<RemoteOmolManifest> {
  if (!manifestCache) {
    manifestCache = fetchJson<RemoteOmolManifest>(scienceDataUrl('/v1/datasets/omol25'))
      .catch(() => ({
        id: 'omol25',
        title: 'Open Molecules 2025',
        description: 'Remote OMol25 access',
        license: 'CC-BY-4.0',
        attributionUrl: 'https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit',
        paperUrl: 'https://arxiv.org/abs/2505.08762',
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

export function remoteOmolHit(row: RemoteOmolRow): MoleculeHit {
  const method = row.method ? ` · ${row.method}` : '';
  const multiplicity = row.multiplicity && row.multiplicity !== 1 ? ` · multiplicity ${row.multiplicity}` : '';
  return {
    id: `${row.rowIndex}:${row.id}`,
    source: 'omol',
    title: row.formula,
    subtitle: `${row.atomCount} atoms${method}${multiplicity}`,
    formula: row.formula,
    elements: row.elements,
    tags: ['omol25', row.configurationId ?? '', row.propertyId ?? '', row.software ?? ''].filter(Boolean),
    load: { kind: 'url', url: scienceDataUrl(row.loadUrl) },
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
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `OMol25 request failed (${response.status}).`);
    }
    return payload as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
