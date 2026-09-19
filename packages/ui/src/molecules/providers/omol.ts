import {
  FUNCTIONAL_GROUPS,
  FUNCTIONAL_GROUP_BY_ID,
  type FunctionalGroupConcept,
  type FunctionalGroupId,
} from '../../organicFunctionalGroups';
import type { MoleculeHit, MoleculeProvider, MoleculeQuery } from '../types';
import { remoteOmolHit, remoteOmolPage } from '../remoteOmol';

/**
 * Meta / FAIR Open Molecules 2025 (OMol25).
 *
 * Two lanes share this provider:
 *
 *  - The complete public neutral splits are paged through the same-origin
 *    dataset edge (`remoteOmol.ts`), which streams rows from Hugging Face.
 *  - The complete 27,697-row neutral-validation slice also ships as a compact
 *    same-origin index (`/datasets/omol25/neutral-validation.v4.json`, built by
 *    `tools/build-omol25-validation-index.mjs`) so element and functional-group
 *    facets work over the whole slice without a server round trip. Record `i`
 *    of that index IS Hugging Face row `i`, verified against the edge when the
 *    index is built, so a hit opens through
 *    `/v1/datasets/omol25/neutral-validation/structures/{i}.xyz` with its
 *    true source coordinates. No external bucket is needed at runtime.
 *
 * OMol25 supplies no source bond topology in either lane. The functional-group
 * tags are a Lupi geometry screen over source coordinates, a search aid only.
 */
const OMOL_INDEX_URL =
  (import.meta.env.VITE_LUPI_OMOL_INDEX as string | undefined)?.trim()
  || '/datasets/omol25/neutral-validation.v4.json';
const OMOL_FACETS_URL = OMOL_INDEX_URL.replace(/\.json$/, '.facets.json');
const OMOL_STRUCTURE_URL = '/v1/datasets/omol25/neutral-validation/structures/{row}.xyz';

export interface OmolRecord {
  id: string;
  formula: string;
  elements: string[];
  natoms: number;
  gap: number | null;
  energy?: number | null;
  src: string;
  functionalGroups?: FunctionalGroupId[];
}

interface CompactIndex {
  schema?: string;
  groups?: unknown;
  structureUrl?: unknown;
  records?: unknown;
}

let structureUrlTemplate = OMOL_STRUCTURE_URL;

export function elementsFromFormula(formula: string): string[] {
  return [...new Set(formula.match(/[A-Z][a-z]?/g) ?? [])].sort();
}

/** Accept both the compact v4 index (`[formula, atoms, mask]` rows bound to
 *  edge row indexes) and the legacy v3 object records, so an environment
 *  override pointing at an older index still works. */
export function parseOmolIndex(payload: unknown): OmolRecord[] {
  const index = (payload ?? {}) as CompactIndex;
  if (!Array.isArray(index.records)) return [];
  if (typeof index.structureUrl === 'string' && index.structureUrl.includes('{row}')) {
    structureUrlTemplate = index.structureUrl;
  }
  const groups = Array.isArray(index.groups) ? (index.groups as unknown[]).filter((g): g is string => typeof g === 'string') : [];
  return index.records.flatMap((row, i): OmolRecord[] => {
    if (Array.isArray(row)) {
      const [formula, natoms, mask] = row as [unknown, unknown, unknown];
      if (typeof formula !== 'string' || typeof natoms !== 'number') return [];
      const tagged = typeof mask === 'number' && mask > 0 ? groups.filter((_, bit) => (mask & (1 << bit)) !== 0) : [];
      return [normalizeRecord({ id: `nval-${i}`, formula, elements: elementsFromFormula(formula), natoms, gap: null, src: 'colabfit/OMol25_neutral_validation', functionalGroups: tagged as FunctionalGroupId[] })];
    }
    if (row && typeof row === 'object') return [normalizeRecord(row as OmolRecord)];
    return [];
  });
}

let cache: Promise<OmolRecord[]> | null = null;
function index(): Promise<OmolRecord[]> {
  if (!cache) {
    cache = fetch(OMOL_INDEX_URL)
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then(parseOmolIndex)
      .catch(() => [] as OmolRecord[]);
  }
  return cache;
}

/** Expose the raw records (cached) so the OMol25 collection page can build its
 *  own facets without re-fetching the index. */
export function omolRecords(): Promise<OmolRecord[]> {
  return index();
}

/** Source coordinates for one validation record, served by the dataset edge. */
export function omolStructureUrl(id: string): string {
  const row = id.replace(/^nval-/, '');
  return structureUrlTemplate.replace('{row}', row);
}

export interface OmolFacets {
  /** Total structures in this index slice. */
  total: number;
  /** Element symbol â†’ number of structures that contain it, descending. */
  elementCounts: Array<{ element: string; count: number }>;
  /** Organic functional-group counts from Lupi's method-derived geometry screen. */
  functionalGroupCounts: Array<{
    id: FunctionalGroupId;
    label: string;
    family: string;
    color: string;
    count: number;
  }>;
  /** Atom-count distribution across the slice. */
  natoms: { min: number; max: number; median: number };
}

const GROUP_ORDER = new Map(FUNCTIONAL_GROUPS.map((group, index) => [group.id, index]));

function isFunctionalGroupId(value: unknown): value is FunctionalGroupId {
  return typeof value === 'string' && value in FUNCTIONAL_GROUP_BY_ID;
}

function normalizeFunctionalGroups(raw: unknown): FunctionalGroupId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<FunctionalGroupId>();
  for (const value of raw) {
    if (isFunctionalGroupId(value)) seen.add(value);
  }
  return [...seen].sort((a, b) => (GROUP_ORDER.get(a) ?? 999) - (GROUP_ORDER.get(b) ?? 999));
}

function normalizeRecord(record: OmolRecord): OmolRecord {
  const functionalGroups = normalizeFunctionalGroups((record as { functionalGroups?: unknown }).functionalGroups);
  return functionalGroups.length ? { ...record, functionalGroups } : { ...record, functionalGroups: undefined };
}

function groupConcepts(ids: FunctionalGroupId[] | undefined): FunctionalGroupConcept[] {
  return normalizeFunctionalGroups(ids).map((id) => FUNCTIONAL_GROUP_BY_ID[id]);
}

function groupSearchText(ids: FunctionalGroupId[] | undefined): string {
  return groupConcepts(ids)
    .flatMap((group) => [group.label, group.family, group.short, group.firstCourse, ...group.aliases])
    .join(' ');
}

/** Pure facet derivation over a record set â€” exported for unit testing.
 *  The neutral-validation slice carries no per-record HOMO-LUMO gap (all null)
 *  and a single internal source id, so neither is derived as a facet here. */
export function deriveFacets(records: OmolRecord[]): OmolFacets {
  const counts = new Map<string, number>();
  const groupCounts = new Map<FunctionalGroupId, number>();
  for (const r of records) {
    for (const el of r.elements) counts.set(el, (counts.get(el) ?? 0) + 1);
    for (const groupId of normalizeFunctionalGroups(r.functionalGroups)) {
      groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
    }
  }
  const elementCounts = [...counts.entries()]
    .map(([element, count]) => ({ element, count }))
    .sort((a, b) => b.count - a.count || a.element.localeCompare(b.element));
  const functionalGroupCounts = [...groupCounts.entries()]
    .map(([id, count]) => {
      const group = FUNCTIONAL_GROUP_BY_ID[id];
      return { id, label: group.label, family: group.family, color: group.color, count };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        (GROUP_ORDER.get(a.id) ?? 999) - (GROUP_ORDER.get(b.id) ?? 999),
    );
  const sizes = records.map((r) => r.natoms).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  return {
    total: records.length,
    elementCounts,
    functionalGroupCounts,
    natoms: { min: sizes[0] ?? 0, max: sizes[sizes.length - 1] ?? 0, median },
  };
}

let facetCache: Promise<OmolFacets> | null = null;

function facetsFromPrecomputed(payload: unknown): OmolFacets | null {
  const raw = payload as { total?: unknown; elementCounts?: unknown; functionalGroupCounts?: unknown; natoms?: unknown } | null;
  if (!raw || typeof raw.total !== 'number' || !Array.isArray(raw.elementCounts) || !Array.isArray(raw.functionalGroupCounts)) return null;
  const natoms = raw.natoms as { min?: number; max?: number; median?: number } | undefined;
  return {
    total: raw.total,
    elementCounts: (raw.elementCounts as Array<{ element: string; count: number }>).filter((e) => typeof e?.element === 'string' && typeof e?.count === 'number'),
    functionalGroupCounts: (raw.functionalGroupCounts as Array<{ id: string; count: number }>)
      .filter((g): g is { id: FunctionalGroupId; count: number } => isFunctionalGroupId(g?.id) && typeof g?.count === 'number')
      .map(({ id, count }) => {
        const group = FUNCTIONAL_GROUP_BY_ID[id];
        return { id, label: group.label, family: group.family, color: group.color, count };
      }),
    natoms: { min: natoms?.min ?? 0, max: natoms?.max ?? 0, median: natoms?.median ?? 0 },
  };
}

/** Dataset facets: the small precomputed file paints the periodic table before
 *  the index finishes downloading; derivation over the cached index is the
 *  fallback when the file is absent. */
export function omolFacets(): Promise<OmolFacets> {
  if (!facetCache) {
    facetCache = fetch(OMOL_FACETS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => facetsFromPrecomputed(payload))
      .catch(() => null)
      .then((precomputed) => precomputed ?? index().then(deriveFacets));
  }
  return facetCache;
}

/** Search only the compact, facet-enriched neutral-validation index. */
export async function searchOmolValidation(query: MoleculeQuery): Promise<MoleculeHit[]> {
  const records = await index();
  if (records.length === 0) return [];
  const q = query.text.toLowerCase().trim();
  const wantElements = query.elements ?? [];
  const wantGroups = normalizeFunctionalGroups(query.functionalGroups);
  let hits = records;
  if (wantElements.length) {
    hits = hits.filter((record) => wantElements.every((element) => record.elements.includes(element)));
  }
  if (wantGroups.length) {
    hits = hits.filter((record) => {
      const groups = normalizeFunctionalGroups(record.functionalGroups);
      return wantGroups.every((groupId) => groups.includes(groupId));
    });
  }
  if (q) {
    hits = hits.filter(
      (record) =>
        record.formula.toLowerCase().includes(q) ||
        record.elements.some((element) => element.toLowerCase() === q) ||
        groupSearchText(record.functionalGroups).toLowerCase().includes(q),
    );
  }
  return hits.slice(0, query.limit ?? 25).map((record) => {
    const concepts = groupConcepts(record.functionalGroups);
    const groupLabels = concepts.map((group) => group.label);
    const groupAliases = concepts.flatMap((group) => group.aliases);
    const functionalGroups = concepts.map((group) => group.id);
    return {
      id: record.id,
      source: 'omol',
      title: record.formula,
      subtitle: `${record.natoms} atoms${record.gap != null ? ` · gap ${record.gap.toFixed(2)} eV` : ''}`,
      formula: record.formula,
      elements: record.elements,
      tags: ['omol25', record.src, ...groupLabels, ...groupAliases],
      functionalGroups: functionalGroups.length ? functionalGroups : undefined,
      load: { kind: 'url', url: omolStructureUrl(record.id) },
      score:
        q && record.formula.toLowerCase() === q
          ? 0.9
          : q && groupSearchText(record.functionalGroups).toLowerCase().includes(q)
            ? 0.82
            : undefined,
    } satisfies MoleculeHit;
  });
}

export const omolProvider: MoleculeProvider = {
  id: 'omol',
  label: 'Meta OMol25',
  isAvailable: () => typeof fetch === 'function',
  async search(query: MoleculeQuery): Promise<MoleculeHit[]> {
    const rawQuery = query.text.trim();
    const wantElements = query.elements ?? [];
    const wantGroups = normalizeFunctionalGroups(query.functionalGroups);
    // Query-less browse and ordinary text/formula search use the edge-backed
    // complete neutral training split. Rich element/group facets stay on the
    // compact validation index, where those derived facets are available.
    if (wantElements.length === 0 && wantGroups.length === 0) {
      try {
        const looksLikeFormula = rawQuery.length > 0 && /^[A-Z][A-Za-z0-9()[\]+.\-]*$/.test(rawQuery);
        const page = await remoteOmolPage({
          collection: 'neutral-train',
          offset: 0,
          limit: query.limit ?? 25,
          ...(looksLikeFormula ? { formula: rawQuery } : rawQuery ? { query: rawQuery } : {}),
        });
        return page.rows.map(remoteOmolHit);
      } catch {
        // The HF search index can briefly warm. Fall through to the small,
        // always-compatible validation index instead of sinking federation.
      }
    }

    return searchOmolValidation(query);
  },
};
