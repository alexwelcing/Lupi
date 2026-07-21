import {
  FUNCTIONAL_GROUPS,
  FUNCTIONAL_GROUP_BY_ID,
  type FunctionalGroupConcept,
  type FunctionalGroupId,
} from '../../organicFunctionalGroups';
import type { MoleculeHit, MoleculeProvider, MoleculeQuery } from '../types';
import { remoteOmolHit, remoteOmolPage } from '../remoteOmol';

/**
 * Meta / FAIR Open Molecules 2025 (OMol25) â€” request #2.
 *
 * Backed by a compact index built one-time from the public OMol25 neutral-
 * validation *structures* (colabfit/OMol25_neutral_validation: 27,697 molecules,
 * real DFT geometry) and hosted on GCS (gs://shed-489901-omol25). Each record
 * carries formula / elements / natoms / HOMO-LUMO gap / total energy / source,
 * enough to search and triage, plus method-derived functional-group screen tags.
 * A per-structure `.xyz` ships alongside the index at `structures/xyz/{id}.xyz`,
 * so a hit opens with its true coordinates
 * through the viewer's normal url -> parseXyzFile path (no resolver guess).
 * The `.xyz` structures do not carry OMol25 source bond topology; viewer bond
 * lines must stay labeled as display guides unless a separate provenance artifact
 * provides source or quantum-analysis bonds.
 *
 * Scaling note: this is the neutral-validation slice (~4 MB index, fetched +
 * filtered client-side like the NIST catalog; geometry fetched on demand, one
 * small file per click). The larger splits (val 620 MB, train 7.5 GB) should move
 * behind a server-side searchOmol endpoint rather than ship to the browser.
 */
// Versioned filename: the index and the per-structure .xyz files are published as
// one immutable set. Bumping the version (currently .v3.json) avoids any stale-edge
// cache window where an old index's nval-{i} would mismatch the new geometry.
const OMOL_INDEX_URL =
  (import.meta.env.VITE_LUPI_OMOL_INDEX as string | undefined)?.trim() ||
  'https://storage.googleapis.com/shed-489901-omol25/omol25_neutral_val.v3.json';

/** Base for per-structure geometry: the index dir + `structures/xyz/{id}.xyz`. */
const OMOL_STRUCTURES_BASE = OMOL_INDEX_URL.replace(/\/[^/]*$/, '/structures/xyz');

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

let cache: Promise<OmolRecord[]> | null = null;
function index(): Promise<OmolRecord[]> {
  if (!cache) {
    cache = fetch(OMOL_INDEX_URL)
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((j) => (Array.isArray(j?.records) ? (j.records as OmolRecord[]).map(normalizeRecord) : []))
      .catch(() => [] as OmolRecord[]);
  }
  return cache;
}

/** Expose the raw records (cached) so the OMol25 collection page can build its
 *  own facets without re-fetching the 4 MB index. */
export function omolRecords(): Promise<OmolRecord[]> {
  return index();
}

export function omolStructureUrl(id: string): string {
  return `${OMOL_STRUCTURES_BASE}/${id}.xyz`;
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

/** Precompute the dataset facets (element coverage + size range) once over the
 *  cached index â€” no extra network. */
export function omolFacets(): Promise<OmolFacets> {
  if (!facetCache) {
    facetCache = index().then(deriveFacets);
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
