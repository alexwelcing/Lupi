import { FACETS, FACT_THRESHOLD, facetById, parseFacetMap, type FacetDefinition, type FacetId, type LibraryFactsFile } from '@atlas/core';
import rawFacts from './library-facts.json';

/**
 * The checked-in facet facts for the library (`tools/enrich-library.mts`).
 * Keys are source-qualified (`gallery:caffeine`). An entry that is not here
 * has no facts, which search treats as "unknown", never as "no".
 */
const FILE = rawFacts as unknown as LibraryFactsFile;

const FACTS = new Map<string, Partial<Record<FacetId, number>>>(
  Object.entries(FILE.entries).map(([key, entry]) => [key, parseFacetMap(entry.facts)]),
);
const DERIVED = new Map<string, ReadonlySet<string>>(Object.entries(FILE.entries).map(([key, entry]) => [key, new Set(entry.derived ?? [])]));

export const LIBRARY_FACTS_META = { taxonomy: FILE.taxonomy, prompt: FILE.prompt, model: FILE.model, generatedAt: FILE.generatedAt, entries: FACTS.size };

export function factsFor(key: string): Partial<Record<FacetId, number>> | undefined {
  return FACTS.get(key);
}

/** True when the reference sheet, not Jev, decided this facet for the entry. */
export function isDerivedFact(key: string, facet: FacetId): boolean {
  return DERIVED.get(key)?.has(facet) ?? false;
}

/** The facets an entry has, strongest first. */
export function facetsOf(key: string, threshold = FACT_THRESHOLD): FacetDefinition[] {
  const facts = FACTS.get(key);
  if (!facts) return [];
  return (Object.entries(facts) as Array<[FacetId, number]>)
    .filter(([, value]) => value >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => facetById(id)!)
    .filter(Boolean);
}

/** How many of `keys` have each facet; facets nobody has are omitted. */
export function facetCountsAmong(keys: Iterable<string>, threshold = FACT_THRESHOLD): Array<{ facet: FacetDefinition; count: number }> {
  const counts = new Map<FacetId, number>();
  for (const key of keys) {
    const facts = FACTS.get(key);
    if (!facts) continue;
    for (const [id, value] of Object.entries(facts)) if ((value ?? 0) >= threshold) counts.set(id as FacetId, (counts.get(id as FacetId) ?? 0) + 1);
  }
  return FACETS.filter((facet) => counts.has(facet.id)).map((facet) => ({ facet, count: counts.get(facet.id)! }));
}
