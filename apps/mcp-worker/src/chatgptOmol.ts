/** OMol25 discovery for the ChatGPT plugin, backed by Lupi's existing data API. */
import { moleculeFromOmol25Xyz, type Omol25Molecule, type Omol25RowIdentity } from '@atlas/core/omol25';
import { OMOL_DATASETS, routeScienceData } from './scienceData';

type ScienceRoute = (request: Request) => Promise<Response | null>;
export const OMOL_STRUCTURE_REF = /^omol25:([a-z0-9-]+):(\d+):([a-f0-9]{64})$/;
const MAX_XYZ_BYTES = 128 * 1024;
const MAX_CACHE_ENTRIES = 64;

export interface OmolBrowseInput {
  collection: string;
  offset: number;
  limit: number;
  query?: string;
  formula?: string;
}

function collectionDefinition(id: string) {
  const collection = OMOL_DATASETS.find((candidate) => candidate.id === id);
  if (!collection) throw new Error('Unknown OMol25 collection. Use one of the advertised collection IDs.');
  return collection;
}

async function responseBody(response: Response | null): Promise<Record<string, unknown>> {
  if (!response) throw new Error('The OMol25 data route is unavailable.');
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 202 && payload.status === 'warming') {
    throw new Error('The OMol25 upstream index is warming. Retry shortly or browse another page.');
  }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `OMol25 request failed (${response.status}).`);
  return payload;
}

export async function omolStructureRef(molecule: Omol25Molecule): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: molecule.schemaVersion,
    collection: molecule.collection, rowIndex: molecule.rowIndex,
    repository: molecule.repository, configurationId: molecule.configurationId,
    propertyId: molecule.propertyId, formula: molecule.formula,
    atoms: molecule.atoms,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `omol25:${molecule.collection}:${molecule.rowIndex}:${hash}`;
}

export class OmolService {
  private readonly structures = new Map<string, Omol25Molecule>();
  private readonly rows = new Map<string, string>();
  private readonly pending = new Map<string, Promise<{ molecule: Omol25Molecule; structureRef: string }>>();

  constructor(private readonly route: ScienceRoute = routeScienceData) {}

  list() {
    return {
      source: 'OMol25' as const,
      license: 'CC-BY-4.0',
      defaultCollection: 'neutral-train',
      collections: OMOL_DATASETS.map(({ id, label, description, dataset, indexedRows, estimatedRows, coverage }) => ({
        id, label, description, repository: dataset, indexedRows, estimatedRows, coverage,
      })),
      note: 'The neutral training and validation collections are complete public ColabFit conversions. The other collections are indexed previews. OMol25 provides source coordinates but no bond table.',
    };
  }

  async browse(input: OmolBrowseInput) {
    const collection = collectionDefinition(input.collection);
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset >= collection.indexedRows
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 24) {
      throw new Error('OMol25 browse offset or limit is outside the advertised range.');
    }
    if (input.query && input.formula) throw new Error('Use either a text query or an exact formula, not both.');
    const url = new URL(`https://lupi.live/v1/datasets/omol25/${collection.id}/rows`);
    url.searchParams.set('offset', String(input.offset));
    url.searchParams.set('limit', String(input.limit));
    if (input.query) url.searchParams.set('query', input.query);
    if (input.formula) url.searchParams.set('formula', input.formula);
    const payload = await responseBody(await this.route(new Request(url)));
    if (payload.dataset !== collection.id || !Array.isArray(payload.rows)) throw new Error('OMol25 browse response has the wrong collection.');
    return {
      source: 'OMol25' as const,
      collection: collection.id,
      repository: collection.dataset,
      coverage: collection.coverage,
      indexedRows: collection.indexedRows,
      estimatedRows: collection.estimatedRows,
      offset: input.offset,
      matchedRows: typeof payload.matchedRows === 'number' ? payload.matchedRows : null,
      partial: payload.partial === true,
      rows: payload.rows.map((value) => {
        const row = value as Record<string, unknown>;
        return {
          rowIndex: row.rowIndex,
          formula: row.formula,
          name: row.name,
          atomCount: row.atomCount,
          elements: row.elements,
          configurationId: row.configurationId,
          propertyId: row.propertyId,
          energy: row.energy,
          method: row.method,
        };
      }),
      license: 'CC-BY-4.0',
      bondTopology: 'not-provided' as const,
    };
  }

  async load(collectionId: string, rowIndex: number): Promise<{ molecule: Omol25Molecule; structureRef: string; cacheHit: boolean }> {
    const collection = collectionDefinition(collectionId);
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= collection.indexedRows) {
      throw new Error('OMol25 row index is outside the selected collection.');
    }
    const key = `${collectionId}:${rowIndex}`;
    const cachedRef = this.rows.get(key);
    const cached = cachedRef ? this.structures.get(cachedRef) : undefined;
    if (cached && cachedRef) return { molecule: cached, structureRef: cachedRef, cacheHit: true };
    const inFlight = this.pending.get(key);
    if (inFlight) return { ...await inFlight, cacheHit: false };
    if (this.pending.size >= 4) throw new Error('Lupi is handling several OMol25 structures. Retry shortly.');
    const request = (async () => {
      const page = await this.browse({ collection: collectionId, offset: rowIndex, limit: 1 });
      const row = page.rows[0];
      if (!row || row.rowIndex !== rowIndex || typeof row.atomCount !== 'number' || typeof row.formula !== 'string') {
        throw new Error('The requested OMol25 row is unavailable.');
      }
      const identity: Omol25RowIdentity = {
        rowIndex, repository: collection.dataset, coverage: collection.coverage,
        configurationId: typeof row.configurationId === 'string' ? row.configurationId : null,
        propertyId: typeof row.propertyId === 'string' ? row.propertyId : null,
        name: typeof row.name === 'string' ? row.name : null,
        formula: row.formula, atomCount: row.atomCount,
      };
      const response = await this.route(new Request(`https://lupi.live/v1/datasets/omol25/${collectionId}/structures/${rowIndex}.xyz`));
      if (!response) throw new Error('The OMol25 structure route is unavailable.');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(typeof payload.error === 'string' ? payload.error : `OMol25 structure request failed (${response.status}).`);
      }
      const xyz = await response.text();
      if (new TextEncoder().encode(xyz).length > MAX_XYZ_BYTES) throw new Error('The OMol25 structure is too large for the embedded viewer.');
      const molecule = moleculeFromOmol25Xyz(xyz, collectionId, identity);
      const structureRef = await omolStructureRef(molecule);
      this.structures.set(structureRef, molecule);
      this.rows.set(key, structureRef);
      while (this.structures.size > MAX_CACHE_ENTRIES) {
        const oldest = this.structures.keys().next().value;
        if (!oldest) break;
        this.structures.delete(oldest);
      }
      return { molecule, structureRef };
    })();
    this.pending.set(key, request);
    try { return { ...await request, cacheHit: false }; }
    finally { this.pending.delete(key); }
  }

  async fromRef(structureRef: string) {
    const match = OMOL_STRUCTURE_REF.exec(structureRef);
    if (!match) throw new Error('Use an exact OMol25 structure reference returned by Lupi.');
    const cached = this.structures.get(structureRef);
    if (cached) return { molecule: cached, structureRef, cacheHit: true };
    const loaded = await this.load(match[1], Number(match[2]));
    if (loaded.structureRef !== structureRef) throw new Error('The OMol25 source row changed. Open the row again before continuing.');
    return loaded;
  }
}
